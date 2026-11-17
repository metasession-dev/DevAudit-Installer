import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';
import { resolveRepoRoot } from '../lib/git-root.js';
import { readSdlcConfig } from '../lib/sdlc-config.js';
import { DELIVERY_PHASES, type DeliveryPhase } from '../lib/delivery.js';

/**
 * DevAudit-Installer#1273 — `devaudit delivery report`: posts one event of a DevAudit Delivery run to the
 * portal, so the workflow and the sdlc-implementer skill never hand-roll HTTP.
 *
 *   POST <base>/api/ci/delivery-runs/<run>/events
 *   { phase, reason?, releaseId?, usage?: { inputTokens?, outputTokens?, ciSeconds? } }
 *
 * Phases: running, awaiting_approval, succeeded, failed. It authenticates with the agent's portal key
 * (`DEVAUDIT_AGENT_PORTAL_KEY`, #1274), else `DEVAUDIT_API_KEY`. Exit codes: 0 sent, 1 the portal or the network
 * refused it (the body is printed), 2 a usage error.
 *
 * A run that already reported `failed` stays failed: a later `awaiting_approval` or `succeeded` from the same
 * machine is sent as `failed` with the recorded reason (the agent may exit 0 after reporting, and the workflow's
 * closing step must not turn that into an approval request). The last phase is kept in a file in the temp folder.
 */

export interface DeliveryReportOptions {
  readonly run?: string;
  readonly phase?: string;
  readonly reason?: string;
  readonly release?: string;
  readonly costFile?: string;
  readonly ciSeconds?: string;
}

export interface DeliveryReportDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  /** Folder holding the last-phase file; defaults to the system temp folder. */
  readonly stateDir?: string;
  /** Folder to look for sdlc-config.json in (its `devaudit.base_url`); defaults to the repository root. */
  readonly cwd?: string;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface DeliveryUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly ciSeconds?: number;
}

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_BASE_URL = 'https://devaudit.ai';
const MAX_ATTEMPTS = 3;

/**
 * Token totals from the JSON the headless session wrote (`claude -p --output-format json`): the `usage` of the
 * result object, or of the last object of a list. Input counts cache reads and writes too. Anything unreadable
 * gives no totals; a cost file never fails a report.
 */
export function usageFromCostFile(text: string): { readonly inputTokens?: number; readonly outputTokens?: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  const candidates = Array.isArray(parsed) ? [...parsed].reverse() : [parsed];
  for (const c of candidates) {
    const usage = c !== null && typeof c === 'object' ? (c as { usage?: unknown }).usage : undefined;
    if (usage === null || typeof usage !== 'object') continue;
    const u = usage as Record<string, unknown>;
    const num = (k: string): number => (typeof u[k] === 'number' && Number.isFinite(u[k]) ? (u[k] as number) : 0);
    const input = num('input_tokens') + num('cache_creation_input_tokens') + num('cache_read_input_tokens');
    const output = num('output_tokens');
    return { inputTokens: input, outputTokens: output };
  }
  return {};
}

interface LastReport {
  readonly phase: DeliveryPhase;
  readonly reason?: string;
}

async function readLast(file: string): Promise<LastReport | null> {
  try {
    const v = JSON.parse(await fs.readFile(file, 'utf-8')) as LastReport;
    return DELIVERY_PHASES.includes(v.phase) ? v : null;
  } catch {
    return null;
  }
}

async function resolveBaseUrl(env: NodeJS.ProcessEnv, cwd: string | undefined): Promise<string> {
  const fromEnv = env['DEVAUDIT_BASE_URL'];
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  try {
    const root = await resolveRepoRoot(cwd ?? process.cwd());
    const cfg = await readSdlcConfig(root);
    const fromConfig = cfg?.devaudit?.base_url;
    if (fromConfig) return fromConfig.replace(/\/$/, '');
  } catch {
    // no repository or no config: the default portal
  }
  return DEFAULT_BASE_URL;
}

export async function runDeliveryReport(options: DeliveryReportOptions, deps: DeliveryReportDeps = {}): Promise<number> {
  const log = logger();
  const env = deps.env ?? process.env;
  const fail = (message: string): number => {
    log.error(message);
    return 2;
  };

  if (!options.run || !RUN_ID.test(options.run)) return fail('--run needs the delivery run id (letters, digits, - and _ only).');
  if (!options.phase || !(DELIVERY_PHASES as readonly string[]).includes(options.phase)) {
    return fail(`--phase must be one of ${DELIVERY_PHASES.join(', ')}.`);
  }
  let ciSeconds: number | undefined;
  if (options.ciSeconds !== undefined) {
    ciSeconds = Number(options.ciSeconds);
    if (!Number.isInteger(ciSeconds) || ciSeconds < 0) return fail('--ci-seconds must be a whole number of seconds, 0 or more.');
  }
  const key = env['DEVAUDIT_AGENT_PORTAL_KEY'] || env['DEVAUDIT_API_KEY'];
  if (!key) return fail('No portal key: set DEVAUDIT_AGENT_PORTAL_KEY (or DEVAUDIT_API_KEY) in the environment.');

  let phase = options.phase as DeliveryPhase;
  let reason = options.reason;
  const stateFile = join(deps.stateDir ?? tmpdir(), `devaudit-delivery-${options.run}.json`);
  const last = await readLast(stateFile);
  if (last?.phase === 'failed') {
    if (phase === 'awaiting_approval' || phase === 'succeeded') {
      log.warn(`This run already reported failed${last.reason ? ` (${last.reason})` : ''}; reporting failed instead of ${phase}.`);
      phase = 'failed';
    }
    if (phase === 'failed') reason = last.reason ?? reason;
  }

  let usage: DeliveryUsage | undefined;
  if (options.costFile !== undefined) {
    const text = await fs.readFile(options.costFile, 'utf-8').catch(() => null);
    if (text === null) log.warn(`Cost file ${options.costFile} could not be read; the event is sent without token totals.`);
    usage = { ...(text !== null ? usageFromCostFile(text) : {}) };
  }
  if (ciSeconds !== undefined) usage = { ...(usage ?? {}), ciSeconds };

  const body = {
    phase,
    ...(reason ? { reason } : {}),
    ...(options.release ? { releaseId: options.release } : {}),
    ...(usage && Object.keys(usage).length > 0 ? { usage } : {}),
  };
  const url = `${await resolveBaseUrl(env, deps.cwd)}/api/ci/delivery-runs/${encodeURIComponent(options.run)}/events`;
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let status = 0;
  let text = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await doFetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      status = res.status;
      // eslint-disable-next-line no-await-in-loop
      text = await res.text().catch(() => '');
    } catch (err) {
      status = 0;
      text = err instanceof Error ? err.message : String(err);
    }
    if (status >= 200 && status < 300) break;
    const retriable = status === 0 || status === 429 || status >= 500;
    if (!retriable || attempt === MAX_ATTEMPTS) break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(1000 * 2 ** (attempt - 1));
  }

  if (status < 200 || status >= 300) {
    log.error(`The portal did not accept the ${phase} event for run ${options.run} (${status === 0 ? 'no response' : `HTTP ${status}`}): ${text.slice(0, 500)}`);
    return 1;
  }
  await fs.writeFile(stateFile, JSON.stringify({ phase, ...(reason ? { reason } : {}) }), 'utf-8').catch(() => undefined);
  log.success(`Reported ${phase} for delivery run ${options.run}.`);
  return 0;
}
