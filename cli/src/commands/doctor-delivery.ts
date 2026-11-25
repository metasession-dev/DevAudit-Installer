import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Remediation } from '@metasession.co/devaudit-core';
import { defaultGh, type GhRunner } from '../lib/deploy-detect.js';
import type { CheckResult, Finding } from '../lib/doctor-types.js';
import {
  DELIVERY_AGENT_API_SECRET,
  DELIVERY_AGENT_GITHUB_SECRET,
  DELIVERY_AGENT_PORTAL_SECRET,
  DELIVERY_CLAUDE_CODE_VERSION,
  DELIVERY_GITHUB_TOKEN_SOURCES,
  type DeliveryGithubTokenSource,
  DELIVERY_PROMPT_FILE,
  DELIVERY_WORKFLOW_FILE,
} from '../lib/delivery.js';

/**
 * DevAudit-Installer#1272 — `delivery-workflow`: a repository that accepts DevAudit Delivery runs
 * (`delivery.enabled`) has the workflow the portal dispatches, its prompt file, the two repository secrets the run
 * reads, and the Claude Code version the CLI generates. Reported only while `delivery.enabled` is true; absent
 * otherwise, so a repository without delivery sees no new check. Names only: it never reads a secret's value.
 * Without a GitHub CLI session that can list secrets it skips the secret part and says so. Every finding is guidance
 * (tier C): `devaudit update` regenerates the files, `gh secret set` stores the secrets.
 */

export interface DeliveryWorkflowDeps {
  readonly gh?: GhRunner;
  /** #1321: the portal read (tests fake it). */
  readonly fetchImpl?: typeof fetch;
  /** #1321: the environment the portal key and base URL are read from (default `process.env`). */
  readonly env?: NodeJS.ProcessEnv;
}

/** #1321: set by `doctor --fleet` on each child: the one key in the environment belongs to one project, so the portal probe is skipped. */
export const SKIP_DELIVERY_PROBE_ENV = 'DEVAUDIT_DOCTOR_SKIP_DELIVERY_PROBE';
const DEFAULT_BASE_URL = 'https://devaudit.ai';
const PROBE_TIMEOUT_MS = 10_000;
export const READINESS_CODES = ['repository_unsupported', 'no_agent_key', 'app_not_configured', 'app_not_installed', 'workflow_missing', 'check_failed'] as const;
type ReadinessCode = (typeof READINESS_CODES)[number];

const READINESS_FIX: Record<ReadinessCode, { summary: string; plan: string[] }> = {
  repository_unsupported: { summary: 'Use a GitHub repository the portal can reach', plan: ['the portal runs Delivery only for a project whose repo_url is a github.com repository: set the project repository on the portal'] },
  no_agent_key: { summary: 'Issue the delivery-agent key', plan: ['devaudit install --delivery   (issues the delivery-agent portal key and stores it as DEVAUDIT_AGENT_PORTAL_KEY)'] },
  app_not_configured: { summary: 'Ask the portal operator to configure the DevAudit Agent GitHub App', plan: ['the portal has no GitHub App registered for Delivery: that is operator work on the portal, not something to fix in this repository', 'or use your own token: devaudit configure set delivery.github_token_source secret   (and set DEVAUDIT_AGENT_GITHUB_TOKEN)'] },
  app_not_installed: { summary: 'Install the DevAudit Agent GitHub App on this repository', plan: ['install the App on this repository, then run devaudit doctor again'] },
  workflow_missing: { summary: 'Merge the delivery workflow into the default branch', plan: ['devaudit update   (on a fix branch), then merge it so .github/workflows/devaudit-delivery.yml is on the default branch: a dispatched workflow runs only from there'] },
  check_failed: { summary: 'Try the readiness check again', plan: ['the portal could not complete one of its checks (for example GitHub did not answer); run devaudit doctor again shortly'] },
};

// eslint-disable-next-line no-control-regex
const clean = (v: string): string => v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);

function baseUrlOf(cfg: Record<string, unknown>, env: NodeJS.ProcessEnv): string {
  const fromEnv = env['DEVAUDIT_BASE_URL'];
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const fromCfg = (cfg['devaudit'] as { base_url?: unknown } | undefined)?.base_url;
  return typeof fromCfg === 'string' && fromCfg !== '' ? fromCfg.replace(/\/$/, '') : DEFAULT_BASE_URL;
}

/**
 * #1321: what the portal would refuse a run for, read from `GET /api/ci/delivery-readiness` with the project's
 * delivery-agent key (`DEVAUDIT_AGENT_PORTAL_KEY`, else `DEVAUDIT_API_KEY`). Read-only; the key is only sent as the
 * Bearer header and never printed. Returns findings (the portal's own problems, a rejected key) and a `note` for
 * every case where the probe could not run, which never fails the check.
 */
async function probePortalReadiness(cfg: Record<string, unknown>, deps: DeliveryWorkflowDeps): Promise<{ findings: Finding[]; note: string }> {
  const env = deps.env ?? process.env;
  if (env[SKIP_DELIVERY_PROBE_ENV]) return { findings: [], note: '; the portal side was not probed (skipped under doctor --fleet: one key in the environment cannot speak for every project)' };
  const key = env['DEVAUDIT_AGENT_PORTAL_KEY'] || env['DEVAUDIT_API_KEY'];
  if (!key) return { findings: [], note: '; the portal side was not probed (set DEVAUDIT_AGENT_PORTAL_KEY or DEVAUDIT_API_KEY to the project key to check the GitHub App, the key and the default-branch workflow)' };
  const url = `${baseUrlOf(cfg, env)}/api/ci/delivery-readiness`;
  let status = 0;
  let body = '';
  try {
    const res = await (deps.fetchImpl ?? fetch)(url, { method: 'GET', headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    status = res.status;
    body = await res.text().catch(() => '');
  } catch (err) {
    const why = err instanceof Error ? clean(err.message.split(key).join('[key]')) : 'network error';
    return { findings: [], note: `; the portal side was not probed (the portal could not be reached: ${why})` };
  }
  if (status === 401 || status === 403) {
    return {
      findings: [
        {
          subject: 'portal-no-agent-key',
          detail: `could not probe the portal: it did not accept the key in the environment (HTTP ${status}); the delivery-agent key is revoked, expired or not this project's. A run would be refused the same way.`,
          remediation: guidance('reissue-delivery-key', READINESS_FIX.no_agent_key.summary, READINESS_FIX.no_agent_key.plan),
        },
      ],
      note: '',
    };
  }
  if (status === 404) return { findings: [], note: '; the portal side was not probed (the portal is too old to report Delivery readiness, or Delivery is switched off on it)' };
  if (status === 429) return { findings: [], note: '; the portal side was not probed (the portal limits this check to 30 per project per hour; try again later)' };
  if (status !== 200) return { findings: [], note: `; the portal side was not probed (the portal answered HTTP ${status})` };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { findings: [], note: '; the portal side was not probed (the portal answered something that is not JSON)' };
  }
  const problems = (parsed as { problems?: unknown } | null)?.problems;
  if (!Array.isArray(problems)) return { findings: [], note: '; the portal side was not probed (the portal answer has no problems list)' };
  const findings: Finding[] = [];
  for (const p of problems as Array<{ code?: unknown; message?: unknown; installUrl?: unknown } | null>) {
    const code = (READINESS_CODES as readonly unknown[]).includes(p?.code) ? (p?.code as ReadinessCode) : null;
    const message = typeof p?.message === 'string' ? clean(p.message) : '';
    const installUrl = typeof p?.installUrl === 'string' && /^https:\/\/\S+$/.test(p.installUrl) ? p.installUrl : null;
    const slug = (code ?? 'unknown').replace(/_/g, '-');
    const fix = code ? READINESS_FIX[code] : { summary: 'Fix what the portal reports', plan: ["the portal named a problem this CLI does not know; follow its message and update the CLI"] };
    findings.push({
      subject: `portal-${slug}`,
      detail: `the portal would refuse a run: ${message || code || 'unknown problem'}${installUrl ? ` Install: ${installUrl}` : ''}`,
      remediation: guidance(`delivery-readiness-${slug}`, fix.summary, installUrl ? [`install the DevAudit Agent GitHub App: ${installUrl}`] : fix.plan),
    });
  }
  return { findings, note: '' };
}

const guidance = (id: string, summary: string, plan: string[]): Remediation => ({ id, tier: 'C', summary, plan, needsPortal: false });

const PINNED = /@anthropic-ai\/claude-code@([0-9A-Za-z.+-]+)/;

export async function deliveryWorkflowCheck(
  consumer: { readonly repoRoot: string; readonly cfg: Record<string, unknown> },
  deps: DeliveryWorkflowDeps = {},
): Promise<CheckResult | null> {
  const name = 'delivery-workflow';
  const delivery = (consumer.cfg['delivery'] ?? {}) as { enabled?: unknown };
  if (delivery.enabled !== true) return null;

  const findings: Finding[] = [];
  // #1286: the agent's GitHub token must come from the secret or the portal's App; a repository that names neither cannot start CI from a run.
  const rawSource = (consumer.cfg['delivery'] as { github_token_source?: unknown } | undefined)?.github_token_source;
  const source = (DELIVERY_GITHUB_TOKEN_SOURCES as readonly unknown[]).includes(rawSource) ? (rawSource as DeliveryGithubTokenSource) : null;
  if (source === null) {
    findings.push({
      subject: 'token-source',
      detail: `delivery.github_token_source is ${rawSource === undefined ? 'not set' : JSON.stringify(rawSource)}; it must be secret (a machine user's token in ${DELIVERY_AGENT_GITHUB_SECRET}) or app (the portal's DevAudit Agent GitHub App). Without a token of its own a run's pushes start no CI.`,
      remediation: guidance('set-github-token-source', 'Choose where the delivery agent gets its GitHub token', [
        'devaudit configure set delivery.github_token_source app      (the portal mints a token from the DevAudit Agent GitHub App; install the App on this repository)',
        `devaudit configure set delivery.github_token_source secret   (a machine user's fine-grained token in the repository secret ${DELIVERY_AGENT_GITHUB_SECRET})`,
      ]),
    });
  }
  const workflow = await fs.readFile(join(consumer.repoRoot, '.github', 'workflows', DELIVERY_WORKFLOW_FILE), 'utf-8').catch(() => null);
  if (workflow === null) {
    findings.push({
      subject: 'workflow-missing',
      detail: `delivery.enabled is true but .github/workflows/${DELIVERY_WORKFLOW_FILE} does not exist, so the portal's dispatch starts nothing.`,
      remediation: guidance('regenerate-delivery-workflow', 'Generate the delivery workflow', ['devaudit update   (on a fix branch; the workflow must then reach the default branch for the portal to dispatch it)']),
    });
  } else {
    // A workflow from before #1286 falls back to the default token, which starts no CI.
    if (/\|\|\s*(github\.token|secrets\.GITHUB_TOKEN)/.test(workflow) || !workflow.includes('delivery github-token')) {
      findings.push({
        subject: 'workflow-token-stale',
        detail: 'the delivery workflow does not resolve the agent\'s GitHub token with `devaudit delivery github-token`, or falls back to the default token. A push made with the default token starts no CI, so the release\'s checks would never run.',
        remediation: guidance('regenerate-delivery-workflow', 'Regenerate the delivery workflow', ['devaudit update   (on a fix branch)']),
      });
    }
    const pinned = PINNED.exec(workflow)?.[1];
    if (pinned !== DELIVERY_CLAUDE_CODE_VERSION) {
      findings.push({
        subject: 'claude-code-version',
        detail: `the delivery workflow installs Claude Code ${pinned ?? '(no pinned version)'}; this CLI generates ${DELIVERY_CLAUDE_CODE_VERSION}.`,
        remediation: guidance('regenerate-delivery-workflow', 'Regenerate the delivery workflow', ['devaudit update   (on a fix branch)']),
      });
    }
  }
  const prompt = await fs.readFile(join(consumer.repoRoot, DELIVERY_PROMPT_FILE), 'utf-8').catch(() => null);
  if (prompt === null) {
    findings.push({
      subject: 'prompt-missing',
      detail: `${DELIVERY_PROMPT_FILE} does not exist; the headless session has no prompt to run.`,
      remediation: guidance('regenerate-delivery-workflow', 'Regenerate the delivery prompt', ['devaudit update   (on a fix branch)']),
    });
  }

  const gh = deps.gh ?? defaultGh;
  const listed = await gh(['secret', 'list', '--json', 'name'], consumer.repoRoot);
  let secretNote = '';
  if (listed.exitCode === 0) {
    let names: string[] = [];
    try {
      const parsed: unknown = JSON.parse(listed.stdout);
      if (Array.isArray(parsed)) names = parsed.map((x) => (x as { name?: unknown }).name).filter((n): n is string => typeof n === 'string');
    } catch {
      names = [];
    }
    if (source === 'secret' && !names.includes(DELIVERY_AGENT_GITHUB_SECRET)) {
      findings.push({
        subject: 'token-secret-missing',
        detail: `delivery.github_token_source is secret, but the repository secret ${DELIVERY_AGENT_GITHUB_SECRET} is not set. The workflow would ask the portal's GitHub App instead, and fails when the App is not installed.`,
        remediation: guidance('set-delivery-secret', `Set ${DELIVERY_AGENT_GITHUB_SECRET}`, [
          `gh secret set ${DELIVERY_AGENT_GITHUB_SECRET}   (a machine user's fine-grained token with Contents and Pull requests read/write and Issues read on this repository; you are prompted for the value)`,
          'or: devaudit configure set delivery.github_token_source app   (and install the DevAudit Agent GitHub App on this repository)',
        ]),
      });
    }
    const missing = [DELIVERY_AGENT_API_SECRET, DELIVERY_AGENT_PORTAL_SECRET].filter((secret) => !names.includes(secret));
    if (missing.length > 0) {
      findings.push({
        subject: 'secret-missing',
        detail: `the repository secret${missing.length > 1 ? 's' : ''} ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set, so a delivery run stops at its first step.`,
        remediation: guidance('set-delivery-secret', `Set ${missing.join(' and ')}`, [
          ...(missing.includes(DELIVERY_AGENT_PORTAL_SECRET) ? [`devaudit install --delivery   (issues the delivery-agent portal key and stores it as ${DELIVERY_AGENT_PORTAL_SECRET})`] : []),
          ...(missing.includes(DELIVERY_AGENT_API_SECRET) ? [`gh secret set ${DELIVERY_AGENT_API_SECRET}   (you are prompted for the value; it is never printed here)`] : []),
        ]),
      });
    }
  } else {
    secretNote = '; the secrets were not checked (the GitHub CLI cannot list them here)';
  }

  // #1321: the portal side (App installed, key, workflow on the default branch); never fails the check on its own.
  const probe = await probePortalReadiness(consumer.cfg, deps);
  findings.push(...probe.findings);
  secretNote += probe.note;

  if (findings.length === 0) {
    const probed = probe.note === '' ? '; the portal reports Delivery ready' : '';
    const tokenNote = source === 'app' ? "; the agent's GitHub token is minted by the portal's GitHub App at run time (the portal checks the installation when it starts a run)" : `; the agent's GitHub token is the secret ${DELIVERY_AGENT_GITHUB_SECRET}`;
    return { name, ok: true, detail: `delivery workflow, prompt and secrets present; Claude Code ${DELIVERY_CLAUDE_CODE_VERSION}${tokenNote}${probed}${secretNote}`, suspectedOrigin: 'consumer-drift' };
  }
  return { name, ok: false, detail: `${findings.length} gap(s) a delivery run would stop at${secretNote}`, suspectedOrigin: 'consumer-drift', findings };
}
