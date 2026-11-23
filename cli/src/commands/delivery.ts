import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';
import { resolveRepoRoot } from '../lib/git-root.js';
import { readSdlcConfig } from '../lib/sdlc-config.js';
import { DELIVERY_PHASES, type DeliveryPhase } from '../lib/delivery.js';
import { resolveReleaseByPrefix, type ReleaseLookup } from '../lib/releases-api.js';

/**
 * DevAudit-Installer#1273 — `devaudit delivery report`: posts one event of a DevAudit Delivery run to the
 * portal, so the workflow and the sdlc-implementer skill never hand-roll HTTP.
 *
 *   POST <base>/api/ci/delivery-runs/<run>/events
 *   { phase, reason?, releaseId?, usage?: { inputTokens?, outputTokens?, ciSeconds? } }
 *
 * Phases: running, awaiting_approval, succeeded, failed. It authenticates with the agent's portal key
 * (`DEVAUDIT_AGENT_PORTAL_KEY`, #1274), else `DEVAUDIT_API_KEY`. Exit codes: 0 sent, 1 the portal or the network
 * refused it (the body is printed), or the run cannot be reported awaiting approval because no release id is known,
 * 2 a usage error.
 *
 * A run that already reported `failed` stays failed: a later `awaiting_approval` or `succeeded` from the same
 * machine is sent as `failed` with the recorded reason (the agent may exit 0 after reporting, and the workflow's
 * closing step must not turn that into an approval request). The last phase, reason and release id are kept in a file
 * (`RUNNER_TEMP`, else the temp folder).
 *
 * DevAudit-Installer#1291 — the portal completes a run only when the release the run reported is released, so:
 *  - `--release-for <REQ>` looks the release up with the agent's own key (a delivery run has no viewer key) and sends
 *    its id; the id is recorded and reused by every later event of the run;
 *  - `awaiting_approval` with no release id is refused (exit 1);
 *  - every event carries the CI seconds of the whole job so far (`usage.ciSeconds`, cumulative, from
 *    `DEVAUDIT_JOB_STARTED`, an epoch time the workflow records in its first step), unless `--ci-seconds` says otherwise.
 */

export interface DeliveryReportOptions {
  readonly run?: string;
  readonly phase?: string;
  readonly reason?: string;
  readonly release?: string;
  /** The version (a REQ id, the core REQ of a bundle) whose portal release is resolved with the agent key (#1291). */
  readonly releaseFor?: string;
  /** Seconds to wait for CI to register the release named by `releaseFor` (default 300). */
  readonly releaseWait?: string;
  readonly costFile?: string;
  readonly ciSeconds?: string;
}

export interface DeliveryReportDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  /** Folder holding the last-phase file; defaults to `RUNNER_TEMP`, else the system temp folder. */
  readonly stateDir?: string;
  /** Folder to look for sdlc-config.json in (its `devaudit.base_url` and project slug); defaults to the repository root. */
  readonly cwd?: string;
  readonly sleep?: (ms: number) => Promise<void>;
  /** The clock in milliseconds; for the CI seconds since `DEVAUDIT_JOB_STARTED`. */
  readonly now?: () => number;
  /** Test seam: the release lookup (`GET /api/ci/releases/resolve`). */
  readonly lookupRelease?: (ctx: { baseUrl: string; projectSlug: string; apiKey: string }, versionPrefix: string) => Promise<ReleaseLookup>;
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
  /** The portal release this run reported; later events of the run reuse it (#1291). */
  readonly releaseId?: string;
}

/** How often the portal is asked whether CI has registered the release yet. */
const RELEASE_POLL_SECONDS = 15;
const DEFAULT_RELEASE_WAIT_SECONDS = 300;

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

async function resolveProjectSlug(cwd: string | undefined): Promise<string | null> {
  try {
    const cfg = await readSdlcConfig(await resolveRepoRoot(cwd ?? process.cwd()));
    const slug = cfg?.devaudit?.project_slug ?? cfg?.project_slug;
    return typeof slug === 'string' && slug !== '' ? slug : null;
  } catch {
    return null;
  }
}

/**
 * The portal release id of a version, read with the agent's own key (`GET /api/ci/releases/resolve`, which accepts the
 * uploader role: a delivery run has no viewer key). CI registers the release a few minutes after the first push, so
 * it is asked again every 15 seconds for up to `waitSeconds`. Undefined, with a warning, when it never appears.
 */
async function lookUpRelease(
  version: string,
  key: string,
  waitSeconds: number,
  env: NodeJS.ProcessEnv,
  deps: DeliveryReportDeps,
  sleep: (ms: number) => Promise<void>,
  log: ReturnType<typeof logger>,
): Promise<string | undefined> {
  const projectSlug = await resolveProjectSlug(deps.cwd);
  if (projectSlug === null) {
    log.warn(`There is no devaudit.project_slug in sdlc-config.json, so the portal release of ${version} cannot be looked up.`);
    return undefined;
  }
  const baseUrl = await resolveBaseUrl(env, deps.cwd);
  const lookup = deps.lookupRelease ?? ((ctx, prefix) => resolveReleaseByPrefix(ctx, prefix));
  for (let waited = 0; ; waited += RELEASE_POLL_SECONDS) {
    // eslint-disable-next-line no-await-in-loop
    const found = await lookup({ baseUrl, projectSlug, apiKey: key }, version);
    if (found.kind === 'found' && found.release.id) return found.release.id;
    if (waited + RELEASE_POLL_SECONDS > waitSeconds) {
      log.warn(
        `The portal has no release for ${version} yet${found.kind === 'unavailable' ? ` (${found.reason})` : ''}; CI registers it after the first push to the integration branch. The event is sent without a release id.`,
      );
      return undefined;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(RELEASE_POLL_SECONDS * 1000);
  }
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
  if (options.release !== undefined && options.releaseFor !== undefined) {
    return fail('--release and --release-for name the release twice: give the id, or the version to look it up by, not both.');
  }
  let releaseWaitSeconds = DEFAULT_RELEASE_WAIT_SECONDS;
  if (options.releaseWait !== undefined) {
    releaseWaitSeconds = Number(options.releaseWait);
    if (!Number.isInteger(releaseWaitSeconds) || releaseWaitSeconds < 0) return fail('--release-wait must be a whole number of seconds, 0 or more.');
  }
  const key = env['DEVAUDIT_AGENT_PORTAL_KEY'] || env['DEVAUDIT_API_KEY'];
  if (!key) return fail('No portal key: set DEVAUDIT_AGENT_PORTAL_KEY (or DEVAUDIT_API_KEY) in the environment.');

  let phase = options.phase as DeliveryPhase;
  let reason = options.reason;
  if (phase === 'succeeded') {
    log.warn('The portal ignores a succeeded event sent by the agent: a run succeeds only when its release is released.');
  }
  const stateFile = join(deps.stateDir ?? env['RUNNER_TEMP'] ?? tmpdir(), `devaudit-delivery-${options.run}.json`);
  const last = await readLast(stateFile);
  if (last?.phase === 'failed') {
    if (phase === 'awaiting_approval' || phase === 'succeeded') {
      log.warn(`This run already reported failed${last.reason ? ` (${last.reason})` : ''}; reporting failed instead of ${phase}.`);
      phase = 'failed';
    }
    if (phase === 'failed') reason = last.reason ?? reason;
  }

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // The portal release of this run (#1291): given, looked up with the agent's key (CI registers it after the first
  // push, so it may take a few minutes), or the one an earlier event of this run recorded. The portal completes a
  // run only when its release is released, so a run waiting for approval without one could never complete.
  let releaseId = options.release ?? undefined;
  if (releaseId === undefined && options.releaseFor !== undefined) {
    releaseId = await lookUpRelease(options.releaseFor, key, releaseWaitSeconds, env, deps, sleep, log);
  }
  releaseId ??= last?.releaseId;
  if (phase === 'awaiting_approval' && releaseId === undefined) {
    log.error(
      `Run ${options.run} cannot be reported as awaiting approval: no portal release id is known for it. The portal completes a run only when its release is released, so without one it would wait forever. Give --release <id>, or --release-for <REQ> once CI has registered the release.`,
    );
    return 1;
  }

  let usage: DeliveryUsage | undefined;
  if (options.costFile !== undefined) {
    const text = await fs.readFile(options.costFile, 'utf-8').catch(() => null);
    if (text === null) log.warn(`Cost file ${options.costFile} could not be read; the event is sent without token totals.`);
    usage = { ...(text !== null ? usageFromCostFile(text) : {}) };
  }
  // The CI time is a cumulative total for the whole job, on every event (#1291): the workflow records the job start in
  // DEVAUDIT_JOB_STARTED (epoch seconds), because `$SECONDS` of a step counts only that step's own shell.
  if (ciSeconds === undefined) {
    const started = Number(env['DEVAUDIT_JOB_STARTED']);
    if (env['DEVAUDIT_JOB_STARTED'] && Number.isInteger(started) && started > 0) {
      ciSeconds = Math.max(0, Math.floor((deps.now ?? Date.now)() / 1000) - started);
    }
  }
  if (ciSeconds !== undefined) usage = { ...(usage ?? {}), ciSeconds };

  const body = {
    phase,
    ...(reason ? { reason } : {}),
    ...(releaseId ? { releaseId } : {}),
    ...(usage && Object.keys(usage).length > 0 ? { usage } : {}),
  };
  const url = `${await resolveBaseUrl(env, deps.cwd)}/api/ci/delivery-runs/${encodeURIComponent(options.run)}/events`;
  const doFetch = deps.fetchImpl ?? fetch;

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
  await fs.writeFile(stateFile, JSON.stringify({ phase, ...(reason ? { reason } : {}), ...(releaseId ? { releaseId } : {}) }), 'utf-8').catch(() => undefined);
  log.success(`Reported ${phase} for delivery run ${options.run}.`);
  return 0;
}
