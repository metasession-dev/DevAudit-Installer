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
import { resolveViewerKey } from '../lib/viewer-keys.js';

/**
 * DevAudit-Installer#1272 — `delivery-workflow`: a repository that accepts DevAudit Delivery runs
 * (`delivery.enabled`) has the workflow the portal dispatches, its prompt file, the two repository secrets the run
 * reads, and the Claude Code version the CLI generates. Reported only while `delivery.enabled` is true; absent
 * otherwise, so a repository without delivery sees no new check. Names only: it never reads a secret's value.
 * Without a GitHub CLI session that can list secrets it skips the secret part and says so. Every finding is guidance
 * (tier C): `devaudit update` regenerates the files, `gh secret set` stores the secrets.
 *
 * DevAudit-Installer#1321 — it also asks the portal what it would refuse a run for (the DevAudit Agent GitHub App,
 * the delivery-agent key, the workflow on the default branch), with the viewer key; see `probePortalReadiness`.
 */

export interface DeliveryWorkflowDeps {
  readonly gh?: GhRunner;
  /** #1321: the portal read (tests fake it). */
  readonly fetchImpl?: typeof fetch;
  /** #1321: the environment the viewer key and the fleet marker are read from (default `process.env`). */
  readonly env?: NodeJS.ProcessEnv;
  /** #1321: the viewer-key store (default `~/.config/devaudit/viewer-keys.json`; tests point it at a temporary file). */
  readonly viewerKeysFile?: string;
}

/**
 * #1321: set by `doctor --fleet` on each child doctor. A viewer key stored per project still probes; a key in
 * `DEVAUDIT_VIEWER_API_KEY` is one key for every project in the sweep, so the probe is skipped for it.
 */
export const FLEET_CHILD_ENV = 'DEVAUDIT_DOCTOR_FLEET_CHILD';
const PROBE_TIMEOUT_MS = 5_000; // every doctor portal call is bounded at 5 s (#1089)
export const READINESS_CODES = ['repository_unsupported', 'no_agent_key', 'app_not_configured', 'app_not_installed', 'workflow_missing', 'check_failed'] as const;
type ReadinessCode = (typeof READINESS_CODES)[number];

const READINESS_FIX: Record<ReadinessCode, { summary: string; plan: string[] }> = {
  repository_unsupported: { summary: 'Set the project repository on the portal', plan: ["the portal delivers only into a project whose repository is a github.com URL: set it in the project's settings on the portal"] },
  no_agent_key: { summary: 'Issue the delivery-agent key', plan: [`devaudit install --delivery   (issues the delivery-agent portal key and stores it as ${DELIVERY_AGENT_PORTAL_SECRET}; a revoked or expired one is replaced)`] },
  app_not_configured: { summary: 'Ask the portal operator to set up the DevAudit Agent GitHub App', plan: ['the portal has no DevAudit Agent GitHub App, which it needs for every delivery run whatever the token source: registering it is operator work on the portal, nothing in this repository fixes it'] },
  app_not_installed: { summary: 'Install the DevAudit Agent GitHub App on this repository', plan: ['install the DevAudit Agent GitHub App on this repository (a GitHub organisation owner may have to approve it), then run devaudit doctor again'] },
  workflow_missing: { summary: 'Merge the delivery workflow into the default branch', plan: ['devaudit update   (on a fix branch), then merge and release it so .github/workflows/devaudit-delivery.yml is on the default branch: a dispatched workflow runs only from there'] },
  check_failed: { summary: 'Run the readiness check again', plan: ['the portal could not finish one of its checks (GitHub did not answer); run devaudit doctor again in a few minutes'] },
};

// eslint-disable-next-line no-control-regex
const clean = (v: string): string => v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
const notProbed = (why: string): { findings: Finding[]; note: string } => ({ findings: [], note: `; the portal side was not probed (${why})` });

/**
 * #1321: what the portal would refuse a delivery run for, read from `GET /api/ci/delivery-readiness`. Like every
 * other doctor portal read it uses the viewer key (`DEVAUDIT_VIEWER_API_KEY`, the config-folder store, the legacy
 * `.env`), never the CI-only uploader key; the portal takes the project from the key. Read-only; the key is only
 * sent as the Bearer header and never printed. Returns the portal's problems as findings, and a `note` for every
 * case where the probe could not run (no key, unreachable, a rejected key, an old portal, the rate limit), which
 * never fails the check.
 */
async function probePortalReadiness(consumer: { readonly repoRoot: string; readonly cfg: Record<string, unknown> }, deps: DeliveryWorkflowDeps): Promise<{ findings: Finding[]; note: string }> {
  const env = deps.env ?? process.env;
  const devaudit = (consumer.cfg['devaudit'] ?? {}) as { base_url?: unknown; project_slug?: unknown };
  const baseUrl = typeof devaudit.base_url === 'string' ? devaudit.base_url.replace(/\/$/, '') : '';
  const rawSlug = devaudit.project_slug ?? consumer.cfg['project_slug'];
  const slug = typeof rawSlug === 'string' ? rawSlug : '';
  if (!baseUrl) return notProbed('needs devaudit.base_url');
  const viewer = await resolveViewerKey({ repoRoot: consumer.repoRoot, baseUrl, slug, env, ...(deps.viewerKeysFile ? { file: deps.viewerKeysFile } : {}) });
  if (!viewer) return notProbed("no viewer key: set DEVAUDIT_VIEWER_API_KEY or run 'devaudit auth viewer-key set'");
  if (env[FLEET_CHILD_ENV] && viewer.source === 'env') {
    return notProbed('skipped under doctor --fleet: DEVAUDIT_VIEWER_API_KEY is one key for every project in the sweep; store a viewer key per project to probe each');
  }
  const key = viewer.key;
  let status = 0;
  let body = '';
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${baseUrl}/api/ci/delivery-readiness`, { method: 'GET', headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    status = res.status;
    body = await res.text().catch(() => '');
  } catch (err) {
    return notProbed(`the portal could not be reached: ${err instanceof Error ? clean(err.message.split(key).join('[key]')) : 'network error'}`);
  }
  if (status === 401 || status === 403) return notProbed(`the portal did not accept the viewer key (HTTP ${status}): it is revoked, expired or not this project's; 'devaudit auth viewer-key set' replaces it`);
  if (status === 404) return notProbed('the portal is too old to report Delivery readiness, or Delivery is switched off on it');
  if (status === 429) return notProbed('the portal allows this check 30 times per project per hour; try again later');
  if (status !== 200) return notProbed(`the portal answered HTTP ${status}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return notProbed('the portal answered something that is not JSON');
  }
  const problems = (parsed as { problems?: unknown } | null)?.problems;
  if (!Array.isArray(problems)) return notProbed('the portal answer has no problems list');
  const findings: Finding[] = [];
  for (const p of problems as Array<{ code?: unknown; message?: unknown; installUrl?: unknown } | null>) {
    const code = (READINESS_CODES as readonly unknown[]).includes(p?.code) ? (p?.code as ReadinessCode) : null;
    const message = typeof p?.message === 'string' ? clean(p.message) : '';
    const installUrl = typeof p?.installUrl === 'string' && /^https:\/\/\S+$/.test(p.installUrl) ? p.installUrl : null;
    const slugOf = (code ?? 'unknown').replace(/_/g, '-');
    const fix = code ? READINESS_FIX[code] : { summary: 'Fix what the portal reports', plan: ["the portal named a problem this CLI does not know: follow its message, and update the CLI"] };
    findings.push({
      subject: `portal-${slugOf}`,
      detail: `the portal would refuse a delivery run: ${message || code || 'unknown problem'}${installUrl ? ` Install: ${installUrl}` : ''}`,
      remediation: guidance(`delivery-readiness-${slugOf}`, fix.summary, installUrl ? [`install the DevAudit Agent GitHub App on this repository: ${installUrl}`, ...fix.plan.slice(1)] : fix.plan),
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
  const probe = await probePortalReadiness(consumer, deps);
  findings.push(...probe.findings);
  secretNote += probe.note;

  if (findings.length === 0) {
    const probed = probe.note === '' ? '; the portal reports Delivery ready' : '';
    const tokenNote = source === 'app' ? "; the agent's GitHub token is minted by the portal's GitHub App at run time (the portal checks the installation when it starts a run)" : `; the agent's GitHub token is the secret ${DELIVERY_AGENT_GITHUB_SECRET}`;
    return { name, ok: true, detail: `delivery workflow, prompt and secrets present; Claude Code ${DELIVERY_CLAUDE_CODE_VERSION}${tokenNote}${probed}${secretNote}`, suspectedOrigin: 'consumer-drift' };
  }
  return { name, ok: false, detail: `${findings.length} gap(s) a delivery run would stop at${secretNote}`, suspectedOrigin: 'consumer-drift', findings };
}
