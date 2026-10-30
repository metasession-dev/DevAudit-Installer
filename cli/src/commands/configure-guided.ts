import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { fsRepoReader } from '@metasession.co/devaudit-core/node';
import { COMPLIANCE_FRAMEWORK_CODES, findConfigKey } from '../lib/repo-config-keys.js';
import { deleteConfigPath, getConfigPath, setConfigPath } from '../lib/config-path.js';
import { resolveToken } from '../lib/auth.js';
import { DevAuditClient } from '../lib/devaudit-api.js';
import { logger } from '../lib/logger.js';
import { resolveViewerKey } from '../lib/viewer-keys.js';
import {
  readApprovalPolicy,
  readClaimedStandards,
  setApprovalPolicy,
  type FetchLike,
  type WriteResult,
} from '../lib/onboarding-portal.js';
import * as prompts from '../lib/prompt.js';
import { clackGuidedAsker } from '../install/prompts.js';
import { runGuided, type GuidedAsker, type GuidedBasics, type GuidedResult } from '../install/guided.js';
import { listHosts } from '../lib/adapter.js';
import { loadConfigContext, CONFIGURE_EXIT_UNAPPLIED } from './configure.js';

/**
 * DevAudit-Installer#1116 WP7 — `devaudit configure` with no arguments: the guided questions with the
 * project's current values as the defaults, a before/after summary, and a write of only what changed.
 */

export const NO_TERMINAL_MESSAGE =
  '`devaudit configure` without arguments asks questions; run it in a terminal, or use `devaudit configure set <key> <value>`.';

export interface ConfigureGuidedDeps {
  readonly ask?: GuidedAsker;
  readonly say?: (line: string) => void;
  readonly cwd?: string;
  readonly fetchImpl?: FetchLike;
  readonly viewerKey?: string | null;
  /** Sets the approval policy on the portal (tier B). Default: the personal token and `PATCH /api/projects/{id}`. */
  readonly setPolicy?: (policy: 'independent' | 'self_allowed_with_gap', reason: string) => Promise<WriteResult>;
  /** Overrides the terminal check (tests). */
  readonly terminalProblem?: string | null;
}

export interface Change {
  readonly key: string;
  readonly before: unknown;
  readonly after: unknown;
}

const show = (value: unknown): string => (value === undefined ? '(unset)' : JSON.stringify(value));

/** What the guided result changes in `cfg`: values that differ, keys of another preset that go, nothing else. */
export function diffGuided(cfg: Record<string, unknown>, result: GuidedResult, stack: string): { changes: Change[]; removals: Change[] } {
  const wanted: Record<string, unknown> = { ...result.config };
  const b = result.basics;
  // The basics only ever change a value the file already has: an unset key is not filled with a default.
  const basics: Record<string, unknown> = {
    host: b.host,
    [stack === 'node' ? 'node_version' : 'python_version']: b.runtimeVersion,
    source_dirs: b.sourceDirs,
    working_directory: b.workingDirectory,
    production_url_secret: b.prodUrlSecretName,
  };
  for (const [key, value] of Object.entries(basics)) if (getConfigPath(cfg, key) !== undefined) wanted[key] = value;
  const changes: Change[] = [];
  for (const [key, after] of Object.entries(wanted)) {
    const before = getConfigPath(cfg, key);
    // node_version/python_version are numbers or strings in existing files; compare as text.
    if (JSON.stringify(before) === JSON.stringify(after) || (before !== undefined && String(before) === String(after) && typeof after === 'string')) continue;
    changes.push({ key, before, after });
  }
  const removals = result.removeKeys.filter((k) => getConfigPath(cfg, k) !== undefined).map((key) => ({ key, before: getConfigPath(cfg, key), after: undefined }));
  return { changes, removals };
}

export async function runConfigureGuided(opts: { readonly json: boolean }, deps: ConfigureGuidedDeps = {}): Promise<number> {
  const log = logger();
  const say = deps.say ?? ((line: string) => log.log(line));
  const problem = deps.terminalProblem !== undefined ? deps.terminalProblem : prompts.nonInteractiveReason(opts.json);
  if (problem) {
    log.error(NO_TERMINAL_MESSAGE);
    return CONFIGURE_EXIT_UNAPPLIED;
  }
  let ctx;
  try {
    ctx = await loadConfigContext(deps.cwd);
  } catch (err) {
    log.error((err as Error).message);
    return 1;
  }
  const cfg = ctx.cfg;
  const stack = cfg['stack'] === 'python' ? 'python' : 'node';
  const slug = typeof cfg['project_slug'] === 'string' ? (cfg['project_slug'] as string) : '';
  const devaudit = (cfg['devaudit'] ?? {}) as { base_url?: string };
  const baseUrl = devaudit.base_url ?? (await resolveToken().catch(() => null))?.baseUrl ?? 'https://devaudit.ai';
  const viewerKey = deps.viewerKey !== undefined ? deps.viewerKey : ((await resolveViewerKey({ repoRoot: ctx.repoRoot, baseUrl, slug }))?.key ?? null);
  const portalOpts = { baseUrl, slug, viewerKey, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) };
  const policy = await readApprovalPolicy(portalOpts);
  const standards = await readClaimedStandards(portalOpts);

  const basics: GuidedBasics = {
    host: typeof cfg['host'] === 'string' && cfg['host'] !== '' ? (cfg['host'] as string) : 'railway',
    projectSlug: slug,
    runtimeVersion: String(cfg[stack === 'node' ? 'node_version' : 'python_version'] ?? (stack === 'node' ? '20' : '3.11')),
    sourceDirs: typeof cfg['source_dirs'] === 'string' ? (cfg['source_dirs'] as string) : '',
    workingDirectory: typeof cfg['working_directory'] === 'string' ? (cfg['working_directory'] as string) : '.',
    prodUrlSecretName: typeof cfg['production_url_secret'] === 'string' ? (cfg['production_url_secret'] as string) : 'PROD_URL',
    prodUrlValue: '',
  };
  const result = await runGuided({
    basics,
    stack,
    existing: cfg,
    flagConfig: {},
    hosts: await listHosts(ctx.installerRoot),
    reader: fsRepoReader(ctx.repoRoot),
    policy,
    standards,
    ask: deps.ask ?? clackGuidedAsker,
    say,
  });

  // The project's name identifies it on the portal and is not changed here.
  const { changes, removals } = diffGuided(cfg, { ...result, basics: { ...result.basics, projectSlug: slug } }, stack);
  if (changes.length === 0 && removals.length === 0 && result.policyToSet === null) {
    say('');
    say('Nothing to change: sdlc-config.json already matches these answers.');
    return 0;
  }

  say('');
  say('These changes would be written to sdlc-config.json:');
  for (const c of changes) say(`  ${c.key}: ${show(c.before)} -> ${show(c.after)}`);
  for (const r of removals) say(`  ${r.key}: ${show(r.before)} -> removed (not part of the new preset)`);
  if (result.policyToSet !== null) {
    say(`  portal approval policy: ${policy.status === 'ok' ? policy.policy : '(not reported)'} -> ${result.policyToSet} (changed on the portal, needs a project admin)`);
  }
  const affected = [...new Set([...changes, ...removals].flatMap((c) => findConfigKey(c.key)?.affects ?? []))];
  if (affected.length > 0) {
    say('The next `devaudit update` regenerates:');
    for (const f of affected) say(`  - ${f}`);
  }
  if (!(await (deps.ask ?? clackGuidedAsker).confirm('Apply these changes?', true))) {
    log.warn('not applied');
    return CONFIGURE_EXIT_UNAPPLIED;
  }

  let next: Record<string, unknown> = cfg;
  let skipped: string[] = [];
  if (result.policyToSet !== null) {
    const reason = `Set by devaudit configure (preset ${result.preset ?? 'none'})`;
    const outcome = deps.setPolicy ? await deps.setPolicy(result.policyToSet, reason) : await setPolicyOnPortal(baseUrl, slug, result.policyToSet, reason, deps.fetchImpl);
    if (!outcome.ok) {
      if (result.policyToSet === 'self_allowed_with_gap') {
        // Never write "I approve my own" while the portal still blocks it.
        skipped = ['approval.mode', 'release_branch_required_reviews', 'onboarding_preset'];
        log.warn(`The portal did not accept the approval policy (${outcome.message}), so the approval settings are left as they are. Ask the portal's operator to upgrade or make you a project admin, then run \`devaudit configure\` again.`);
      } else {
        log.warn(`The portal did not accept the approval policy (${outcome.message}); it is unchanged.`);
      }
    }
  }
  for (const r of removals) next = deleteConfigPath(next, r.key);
  for (const c of changes) if (!skipped.includes(c.key)) next = setConfigPath(next, c.key, c.after);
  await fs.writeFile(join(ctx.repoRoot, 'sdlc-config.json'), `${JSON.stringify(next, null, 2)}\n`);
  log.success('updated sdlc-config.json.');
  const touched = [...changes, ...removals].map((c) => c.key);
  if (touched.includes('release_branch_required_reviews')) {
    say('Run `devaudit update` to apply the release branch review count on GitHub; lowering an existing branch asks for a confirmation and records a control gap.');
  }
  if (affected.length > 0) say('Run `devaudit update` to regenerate the workflows.');
  if (result.runnerLabel !== undefined) say(`Set the repository variable CI_RUNNER_LABEL to ${result.runnerLabel}: gh variable set CI_RUNNER_LABEL --body ${result.runnerLabel}`);
  const claim = result.frameworks.filter((f) => COMPLIANCE_FRAMEWORK_CODES.includes(f) && standards.status === 'ok' && !standards.codes.includes(f));
  if (claim.length > 0) say(`Claim ${claim.join(', ')} in the portal's project settings (the standards are saved in sdlc-config.json).`);
  return 0;
}

async function setPolicyOnPortal(
  baseUrl: string,
  slug: string,
  policy: 'independent' | 'self_allowed_with_gap',
  reason: string,
  fetchImpl: FetchLike | undefined,
): Promise<WriteResult> {
  const auth = await resolveToken().catch(() => null);
  if (!auth) return { ok: false, unavailable: false, message: 'no personal access token (run `devaudit auth login`)' };
  let projectId: string | undefined;
  try {
    projectId = (await new DevAuditClient({ token: auth.token, baseUrl }).getProjectBySlug(slug))?.id;
  } catch {
    projectId = undefined;
  }
  if (!projectId) return { ok: false, unavailable: false, message: 'the project was not found on the portal' };
  return setApprovalPolicy({ baseUrl, token: auth.token, projectId, ...(fetchImpl ? { fetchImpl } : {}) }, policy, reason);
}
