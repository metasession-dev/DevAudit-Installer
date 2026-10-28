import { execa } from 'execa';
import { resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import { logger, isJsonMode, emitJsonResult } from '../lib/logger.js';
import { runConfigChecks, type ConfigCheckDeps } from './doctor-config.js';
import { resolveRepoRoot } from '../lib/git-root.js';
import { discoverPlugins, buildPluginContext, runHook, type LoadedPlugin } from '../lib/plugin/index.js';
import { resolveInstallerRoot } from '../lib/installer-root.js';
import { loadHostAdapter } from '../lib/adapter.js';
import { resolveAdapters } from '../update/resolve-adapters.js';
import type { CheckResult, Proposal } from '../lib/doctor-types.js';
import { resolvePortalReadKey, resolveReleaseByPrefix } from '../lib/releases-api.js';
import {
  buildCredentialsReport,
  credentialsCheck,
  defaultCredentialsDeps,
  type CredentialsDeps,
} from '../lib/credentials-check.js';
import { makeTimer } from '../lib/timing.js';
import { buildDeferralContext, runDeferralChecks } from './doctor-deferral.js';
import { FIX_EXIT_UNAPPLIED, runFix, type FixDeps, type FixReport } from './doctor-fix.js';
import { commitsInRange, refExists, reqHasCommits } from '../lib/req-commits.js';

export interface DoctorOptions {
  readonly plugins?: readonly LoadedPlugin[];
  /**
   * `doctor --fix` (#956 phase 3b). Absent = plain read-only doctor, whose
   * behaviour and exit codes are unchanged.
   */
  readonly fix?: {
    readonly yes?: boolean;
    readonly reason?: string;
    readonly dryRun?: boolean;
    /** Test seam: replaces the default prompt/credential/portal wiring. */
    readonly deps?: Partial<FixDeps>;
  };
  /** Test seam for the #1040 config checks (gh runner, URL probe). */
  readonly configDeps?: ConfigCheckDeps;
  /** Test seam for the #1099 `credentials` check (no network in tests). */
  readonly credentialsDeps?: CredentialsDeps;
}

/**
 * `DEVAUDIT_DOCTOR_TIMING=1` prints one `[doctor-timing] <check>: <ms>ms` line per check on stderr
 * (devaudit-installer#1089): where a slow run spends its time.
 */
const timed = makeTimer('DEVAUDIT_DOCTOR_TIMING', 'doctor-timing');

/** Every child process doctor starts is bounded: a hang reports "timed out", never blocks the run. */
const TOOL_TIMEOUT_MS = 15_000;
const GH_TIMEOUT_MS = 20_000;

async function checkCommand(name: string, args: readonly string[]): Promise<CheckResult> {
  try {
    const result = await execa(name, args, { reject: false, timeout: TOOL_TIMEOUT_MS });
    if (result.timedOut) return { name, ok: false, detail: `timed out after ${TOOL_TIMEOUT_MS / 1000}s` };
    const ok = result.exitCode === 0;
    const firstLine = result.stdout.split('\n')[0] ?? '';
    return { name, ok, detail: ok ? firstLine : `exited ${result.exitCode}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name, ok: false, detail: message };
  }
}

async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.versions.node;
  const major = Number.parseInt(version.split('.')[0] ?? '0', 10);
  const ok = major >= 22;
  return { name: 'node', ok, detail: `v${version} (require >=22)` };
}

/**
 * Reconciliation safety-net (DevAudit-Installer#60): flag any release ticket
 * still in compliance/pending-releases/ whose portal release is already
 * `released` — i.e. a close-out that was missed (e.g. a dropped dispatch).
 * Non-fatal: a warning, not a tool-gate failure. Skips gracefully when not in
 * a consumer project or when no portal credentials are available.
 */
async function checkReleaseCloseoutDrift(): Promise<{ result: CheckResult; drifted: readonly string[] }> {
  const name = 'releases';
  const done = (result: CheckResult, drifted: readonly string[] = []) => ({ result, drifted });
  let cfg: { project_slug?: string; devaudit?: { project_slug?: string; base_url?: string } };
  let repoRoot: string;
  try {
    // sdlc-config.json lives at the repo root (#689 follow-up), not
    // necessarily cwd itself for a polyglot-monorepo target.
    repoRoot = await resolveRepoRoot(process.cwd());
    cfg = JSON.parse(await fs.readFile(`${repoRoot}/sdlc-config.json`, 'utf-8'));
  } catch {
    return done({ name, ok: true, detail: 'skipped (not a consumer project)' });
  }
  let entries: string[];
  try {
    // Repo-root relative (#956): a cwd-relative path missed the directory
    // whenever doctor ran from a subdirectory.
    entries = await fs.readdir(`${repoRoot}/compliance/pending-releases`);
  } catch {
    return done({ name, ok: true, detail: 'no pending-releases/' });
  }
  const reqs = entries
    .filter((f) => /^RELEASE-TICKET-REQ-\d+\.md$/.test(f))
    .map((f) => f.replace(/^RELEASE-TICKET-/, '').replace(/\.md$/, ''));
  if (reqs.length === 0) return done({ name, ok: true, detail: 'no pending release tickets' });

  const slug = cfg.devaudit?.project_slug ?? cfg.project_slug;
  const base = (cfg.devaudit?.base_url ?? '').replace(/\/$/, '');
  // Read-only portal access: the viewer key only, never the uploader key (#956, #1099).
  const key = await resolvePortalReadKey(repoRoot);
  if (!slug || !base || !key) {
    return done({
      name,
      ok: true,
      detail: `${reqs.length} pending ticket(s); portal drift check skipped (no viewer key: set DEVAUDIT_VIEWER_API_KEY or run 'devaudit auth viewer-key set'; needs devaudit.base_url)`,
    });
  }

  const drifted: string[] = [];
  for (const req of reqs) {
    // network/timeout/non-2xx — leave as a skip for this REQ
    const lookup = await resolveReleaseByPrefix({ baseUrl: base, projectSlug: slug, apiKey: key.key }, req);
    if (lookup.kind === 'found' && lookup.release.status === 'released') drifted.push(req);
  }
  if (drifted.length > 0) {
    return done(
      {
        name,
        ok: false,
        detail: `released on the portal but still in pending-releases/: ${drifted.join(', ')} — run ./scripts/close-out-release.sh <REQ>`,
      },
      drifted,
    );
  }
  return done({ name, ok: true, detail: `${reqs.length} pending ticket(s); none released on the portal` });
}

/**
 * devaudit-installer#826 — read sdlc-config.json from the repo root, same
 * "not a consumer project" skip shape checkReleaseCloseoutDrift already
 * uses. Shared by the onboarding-invariant checks below.
 */
async function readConsumerConfig(): Promise<{
  repoRoot: string;
  cfg: Record<string, unknown>;
} | null> {
  try {
    const repoRoot = await resolveRepoRoot(process.cwd());
    const cfg = JSON.parse(await fs.readFile(`${repoRoot}/sdlc-config.json`, 'utf-8')) as Record<
      string,
      unknown
    >;
    return { repoRoot, cfg };
  } catch {
    return null;
  }
}

/**
 * devaudit-installer#826 — docs/SRS.md is explicitly the one manual
 * bootstrap step nothing in the framework authors on a consumer's behalf
 * (requirements-aligner refuses to write one from scratch by design). Its
 * absence previously surfaced only deep into real work, when
 * requirements-aligner runs at Stage 1 of the first tracked requirement and
 * refuses to proceed — this catches it at `devaudit doctor` time instead,
 * for the cost of one existence check.
 */
async function checkSrsBootstrapped(): Promise<CheckResult> {
  const name = 'srs';
  const consumer = await readConsumerConfig();
  if (!consumer) return { name, ok: true, detail: 'skipped (not a consumer project)' };
  try {
    await fs.access(`${consumer.repoRoot}/docs/SRS.md`);
    return { name, ok: true, detail: 'docs/SRS.md present', suspectedOrigin: 'consumer-drift' };
  } catch {
    return {
      name,
      ok: false,
      detail: 'docs/SRS.md missing — bootstrap from SRS_TEMPLATE.md before your first tracked requirement (requirements-aligner will refuse to proceed without it)',
      suspectedOrigin: 'consumer-drift',
    };
  }
}

/**
 * devaudit-installer#826 — template sync writes an RTM skeleton (header row
 * only); this checks it was actually filled in with at least one real
 * requirement row, not just left as the generated skeleton.
 */
async function checkRtmInitialized(): Promise<CheckResult> {
  const name = 'rtm';
  const consumer = await readConsumerConfig();
  if (!consumer) return { name, ok: true, detail: 'skipped (not a consumer project)' };
  let content: string;
  try {
    content = await fs.readFile(`${consumer.repoRoot}/compliance/RTM.md`, 'utf-8');
  } catch {
    return { name, ok: false, detail: 'compliance/RTM.md missing — expected from template sync' };
  }
  const hasReqRow = /\|\s*REQ-\d/.test(content);
  return hasReqRow
    ? { name, ok: true, detail: 'compliance/RTM.md has at least one requirement row', suspectedOrigin: 'consumer-drift' }
    : {
        name,
        ok: false,
        detail: 'compliance/RTM.md has no REQ-XXX rows yet — still the generated skeleton',
        suspectedOrigin: 'consumer-drift',
      };
}

/**
 * devaudit-installer#867 — required GitHub repo secrets/variables present,
 * per what `install` step 7 (and, if opted in, the viewer-key step) should
 * have configured. `gh secret list --json name` only names secrets, never
 * values, so this can only confirm presence, not correctness. Skips
 * gracefully (not a failure) when `gh` lacks repo access or isn't
 * authenticated — same non-fatal shape as the other onboarding checks.
 *
 * `DEVAUDIT_USER_TOKEN` is deliberately NOT in this list (devaudit-installer#912)
 * — `install` no longer writes it as a repo secret, since nothing in any
 * generated CI workflow ever consumed it (the only reference was inside a
 * permanently-disabled step, deprecated per #122). It remains a real
 * credential — the operator's local `DEVAUDIT_USER_TOKEN` env var / cached
 * login still attributes UAT-submission actions — it's just never expected
 * to exist as a repo secret, so its absence is no longer a "gap" here.
 */
/**
 * devaudit-installer#1099 WP5 — information only (never a gap): agent sessions started from a
 * shell that exports `DEVAUDIT_USER_TOKEN` inherit the personal access token. Reports the
 * variable name, never the value.
 */
function checkPatInEnvironment(env: NodeJS.ProcessEnv = process.env): CheckResult[] {
  if (!env['DEVAUDIT_USER_TOKEN']) return [];
  return [
    {
      name: 'pat-env',
      ok: true,
      detail:
        'DEVAUDIT_USER_TOKEN is set in the environment: agent sessions started from this shell inherit it. Prefer `devaudit auth login` (cached login) and unset the variable',
      suspectedOrigin: 'unknown',
    },
  ];
}

async function checkCredentials(deps?: CredentialsDeps): Promise<CheckResult> {
  const name = 'credentials';
  const consumer = await readConsumerConfig();
  if (!consumer) return { name, ok: true, detail: 'skipped (not a consumer project)', suspectedOrigin: 'unknown' };
  try {
    const d = deps ?? (await defaultCredentialsDeps(consumer.repoRoot, consumer.cfg));
    return credentialsCheck(await buildCredentialsReport(d));
  } catch {
    return { name, ok: true, detail: 'skipped (unexpected error reading local state)', suspectedOrigin: 'unknown' };
  }
}

async function checkRequiredSecretsPresent(): Promise<CheckResult> {
  const name = 'secrets';
  const consumer = await readConsumerConfig();
  if (!consumer) return { name, ok: true, detail: 'skipped (not a consumer project)', suspectedOrigin: 'unknown' };
  const devaudit = (consumer.cfg['devaudit'] ?? {}) as {
    api_key_secret?: string;
    viewer_api_key_secret?: string;
  };
  const required = [devaudit.api_key_secret ?? 'DEVAUDIT_API_KEY'];

  // devaudit-installer#843 — fold in the resolved host adapter's own
  // required_secrets (e.g. RAILWAY_TOKEN) instead of a second, separate
  // secrets check. DEVAUDIT_API_KEY is skipped here since it's already
  // covered above under its (possibly renamed via api_key_secret) name; a
  // missing/unresolvable adapter degrades to the pre-#843 behaviour rather
  // than failing the whole check.
  try {
    const installerRoot = await resolveInstallerRoot();
    const { host } = await resolveAdapters(consumer.repoRoot, installerRoot);
    const hostAdapter = await loadHostAdapter(installerRoot, host);
    for (const secret of hostAdapter.required_secrets ?? []) {
      if (secret !== 'DEVAUDIT_API_KEY' && !required.includes(secret)) required.push(secret);
    }
  } catch {
    // best-effort — don't let an adapter-resolution failure block this check
  }

  let secretNames: string[];
  try {
    const result = await execa('gh', ['secret', 'list', '--json', 'name'], {
      cwd: consumer.repoRoot,
      reject: false,
      timeout: GH_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      return {
        name,
        ok: true,
        detail: 'skipped (gh secret list failed — not authenticated, or no repo access)',
        suspectedOrigin: 'unknown',
      };
    }
    secretNames = (JSON.parse(result.stdout) as Array<{ name: string }>).map((s) => s.name);
  } catch {
    return { name, ok: true, detail: 'skipped (gh secret list unavailable)', suspectedOrigin: 'unknown' };
  }

  const missing = required.filter((r) => !secretNames.includes(r));
  // devaudit-installer#1099 WP3: no CI workflow reads a viewer-key repo secret; one that still exists is unused.
  const unused = devaudit.viewer_api_key_secret && secretNames.includes(devaudit.viewer_api_key_secret) ? devaudit.viewer_api_key_secret : null;
  const unusedFindings = unused
    ? [{
        subject: unused,
        detail: `repo secret ${unused} is unused (the viewer key is per person, kept locally)`,
        remediation: { id: 'remove-unused-viewer-secret', tier: 'C' as const, summary: `Remove the unused repo secret ${unused}`, plan: [`gh secret delete ${unused}`], needsPortal: false },
      }]
    : [];
  const unusedNote = unused ? `; unused and removable: ${unused}` : '';
  return missing.length === 0
    ? { name, ok: true, detail: `all required secrets present (${required.join(', ')})${unusedNote}`, suspectedOrigin: 'consumer-drift', ...(unusedFindings.length > 0 ? { findings: unusedFindings } : {}) }
    : {
        name,
        ok: false,
        detail: `missing repo secret(s): ${missing.join(', ')} — expected from \`devaudit install\``,
        suspectedOrigin: 'consumer-drift',
      };
}

/**
 * devaudit-installer#867 — the pre-push hook is what enforces the
 * sdlc-implementer sentinel (`.sdlc-implementer-invoked`); its absence on an
 * onboarded project means either the hook framework bootstrap never ran or
 * it was hand-removed since. Either way it's this consumer's own state, not
 * a framework defect.
 */
async function checkPrePushHookPresent(): Promise<CheckResult> {
  const name = 'pre-push-hook';
  const consumer = await readConsumerConfig();
  if (!consumer) return { name, ok: true, detail: 'skipped (not a consumer project)', suspectedOrigin: 'unknown' };
  const candidates = [`${consumer.repoRoot}/.husky/pre-push`, `${consumer.repoRoot}/.git/hooks/pre-push`];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return { name, ok: true, detail: `present (${candidate})`, suspectedOrigin: 'consumer-drift' };
    } catch {
      // try next candidate
    }
  }
  return {
    name,
    ok: false,
    detail: 'no pre-push hook found under .husky/ or .git/hooks/ — bootstrap via `devaudit install`/`devaudit join`',
    suspectedOrigin: 'consumer-drift',
  };
}

/**
 * devaudit-installer#826 — informational only, not a hard gate: unlike
 * git/gh/jq/curl, no local hook depends on semgrep today (CI installs its
 * own venv-based copy independently), so its local absence doesn't block
 * anything a consumer would actually try to do. Reported alongside the
 * release-close-out-drift warning rather than in the gating `checks` array.
 */
async function checkSemgrepAvailable(): Promise<CheckResult> {
  const result = await checkCommand('semgrep', ['--version']);
  return result.ok
    ? result
    : {
        ...result,
        detail: 'not found locally (CI installs its own copy; only affects local pre-commit SAST runs)',
      };
}

/**
 * devaudit-installer#826 — e2e_regression_enabled and playwright.config.ts's
 * critical/regression projects are two independent places to declare the
 * same intent; nothing previously cross-checked them. Mirrors
 * e2e-regression.yml.template's own detection regex for the `critical`
 * project so this check agrees with what the generated workflow would
 * actually do.
 */
async function checkE2eRegressionConsistency(): Promise<CheckResult> {
  const name = 'e2e-regression';
  const consumer = await readConsumerConfig();
  if (!consumer) return { name, ok: true, detail: 'skipped (not a consumer project)' };
  const enabled = consumer.cfg['e2e_regression_enabled'] === true;
  // The pytest runner has no Playwright projects: its tiers are markers (devaudit-installer#1060).
  if (consumer.cfg['test_runner'] === 'pytest') {
    return { name, ok: true, detail: enabled ? 'pytest runner: tiers are pytest markers, checked by test-tiers' : 'not opted in' };
  }
  let playwrightConfig = '';
  try {
    playwrightConfig = await fs.readFile(`${consumer.repoRoot}/playwright.config.ts`, 'utf-8');
  } catch {
    if (enabled) {
      return {
        name,
        ok: false,
        detail: 'e2e_regression_enabled is true but playwright.config.ts was not found',
      };
    }
    return { name, ok: true, detail: 'skipped (no playwright.config.ts)' };
  }
  const hasCritical = /name:\s*['"]critical['"]/.test(playwrightConfig);
  const hasRegression = /name:\s*['"]regression['"]/.test(playwrightConfig);
  if (enabled && (!hasCritical || !hasRegression)) {
    const missing = [!hasCritical && 'critical', !hasRegression && 'regression']
      .filter(Boolean)
      .join(', ');
    return {
      name,
      ok: false,
      detail: `e2e_regression_enabled is true but playwright.config.ts is missing the ${missing} project(s) — e2e-regression.yml falls back to smoke on PR-to-main until this is fixed`,
    };
  }
  if (!enabled && hasCritical && hasRegression) {
    return {
      name,
      ok: false,
      detail: 'playwright.config.ts defines critical/regression projects but e2e_regression_enabled is not set — the full-regression safety-net workflow is not being generated despite the specs existing',
    };
  }
  return { name, ok: true, detail: enabled ? 'projects present, workflow enabled' : 'not opted in' };
}

/**
 * devaudit-installer#843/#1022 — `reconcile-deployment.yml`'s recovery path may
 * shell out to a host CLI (Railway's `railway`, #841). Which CLI, if any, is
 * the host adapter's data (`reconcile.required_cli`), not a hardcoded name.
 * Gated on the workflow file actually being present in this consumer's synced
 * set, so a host with no recovery workflow, or one whose lookup needs no CLI
 * (Vercel: curl + jq), never sees a false positive for a tool it will not
 * need. Named `railway-cli` before #1022.
 */
async function checkReconcileCliPresent(): Promise<CheckResult> {
  const name = 'reconcile-cli';
  const consumer = await readConsumerConfig();
  if (!consumer) return { name, ok: true, detail: 'skipped (not a consumer project)', suspectedOrigin: 'unknown' };
  try {
    await fs.access(`${consumer.repoRoot}/.github/workflows/reconcile-deployment.yml`);
  } catch {
    return { name, ok: true, detail: 'skipped (reconcile-deployment.yml not present)', suspectedOrigin: 'unknown' };
  }
  let requiredCli: string | null | undefined;
  try {
    const installerRoot = await resolveInstallerRoot();
    const { host } = await resolveAdapters(consumer.repoRoot, installerRoot);
    requiredCli = (await loadHostAdapter(installerRoot, host)).reconcile?.required_cli;
  } catch {
    return { name, ok: true, detail: 'skipped (host adapter could not be resolved)', suspectedOrigin: 'unknown' };
  }
  if (!requiredCli) {
    return { name, ok: true, detail: 'skipped (the host adapter\'s reconcile lookup needs no CLI)', suspectedOrigin: 'unknown' };
  }
  const result = await checkCommand(requiredCli, ['--version']);
  return result.ok
    ? { name, ok: true, detail: result.detail, suspectedOrigin: 'consumer-drift' }
    : {
        name,
        ok: false,
        detail:
          `${requiredCli} CLI not found on PATH — required by reconcile-deployment.yml's recovery workflow ` +
          '(devaudit-installer#841); install it for whichever user/account runs self-hosted-runner jobs',
        suspectedOrigin: 'consumer-drift',
      };
}

/**
 * devaudit-installer#942 — commitlint resolves its config via `cosmiconfig`
 * against a fixed, documented search-place order (package.json's
 * `commitlint` field first, then `.commitlintrc*` variants, then
 * `commitlint.config.{js,cjs,mjs,ts,cts}` —
 * https://commitlint.js.org/reference/configuration.html); the FIRST
 * candidate found on disk wins, regardless of which one DevAudit manages.
 * A legacy config left over from before DevAudit was synced (most often
 * `.cjs`, which sorts ahead of `.mjs` in that order) silently shadows the
 * managed `commitlint.config.mjs` — including its `Sdlc-Implementer-Sentinel:`
 * exemption (#814) — producing commit-msg rejections that look like a
 * DevAudit bug rather than a leftover local file. Mirroring commitlint's
 * fixed order here (rather than shelling out to the consumer's own
 * commitlint, which isn't guaranteed to be installed yet) lets this check
 * run even before the consumer's first `npm install`.
 */
const COMMITLINT_SEARCH_ORDER = [
  'package.json#commitlint',
  '.commitlintrc',
  '.commitlintrc.json',
  '.commitlintrc.yaml',
  '.commitlintrc.yml',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
  '.commitlintrc.mjs',
  '.commitlintrc.ts',
  '.commitlintrc.cts',
  'commitlint.config.js',
  'commitlint.config.cjs',
  'commitlint.config.mjs',
  'commitlint.config.ts',
  'commitlint.config.cts',
] as const;

const MANAGED_COMMITLINT_CONFIG = 'commitlint.config.mjs';

async function configChecksFor(deps?: ConfigCheckDeps): Promise<readonly CheckResult[]> {
  const consumer = await readConsumerConfig();
  if (!consumer) return [];
  try {
    return await runConfigChecks(consumer.repoRoot, consumer.cfg, deps);
  } catch (err) {
    return [
      {
        name: 'deploy-host',
        ok: true,
        detail: `skipped (${err instanceof Error ? err.message : 'config checks failed'})`,
        suspectedOrigin: 'unknown',
      },
    ];
  }
}

async function checkCommitlintConfigShadowing(): Promise<CheckResult> {
  const name = 'commitlint-config-shadowing';
  const consumer = await readConsumerConfig();
  if (!consumer) return { name, ok: true, detail: 'skipped (not a consumer project)', suspectedOrigin: 'unknown' };
  const { repoRoot } = consumer;
  try {
    await fs.access(`${repoRoot}/${MANAGED_COMMITLINT_CONFIG}`);
  } catch {
    return {
      name,
      ok: true,
      detail: `skipped (${MANAGED_COMMITLINT_CONFIG} not synced here)`,
      suspectedOrigin: 'unknown',
    };
  }
  const present: string[] = [];
  for (const candidate of COMMITLINT_SEARCH_ORDER) {
    if (candidate === 'package.json#commitlint') {
      try {
        const pkg = JSON.parse(await fs.readFile(`${repoRoot}/package.json`, 'utf-8')) as Record<string, unknown>;
        if (pkg['commitlint'] !== undefined) present.push(candidate);
      } catch {
        // no package.json, or unparsable — nothing to report here
      }
      continue;
    }
    try {
      await fs.access(`${repoRoot}/${candidate}`);
      present.push(candidate);
    } catch {
      // not present
    }
  }
  const winner = present[0];
  if (!winner || winner === MANAGED_COMMITLINT_CONFIG) {
    return {
      name,
      ok: true,
      detail: `only the managed ${MANAGED_COMMITLINT_CONFIG} is in effect`,
      suspectedOrigin: 'consumer-drift',
    };
  }
  return {
    name,
    ok: false,
    detail:
      `${winner} shadows the managed ${MANAGED_COMMITLINT_CONFIG} (commitlint loads the first match in: ` +
      `${COMMITLINT_SEARCH_ORDER.join(', ')}) — remove ${winner}, or merge anything it still needs into ` +
      `${MANAGED_COMMITLINT_CONFIG}`,
    suspectedOrigin: 'consumer-drift',
  };
}

/**
 * devaudit-installer#930 — surface every unresolved sync-manifest conflict
 * (a devaudit-managed file whose on-disk content diverged from what was
 * last synced, so the conflict policy kept the local file and wrote the
 * new upstream content to a sibling `.devaudit-new` instead of overwriting
 * it). Non-gating, same shape as the onboarding checks above: an
 * unresolved conflict is real drift worth surfacing, but never blocks
 * `devaudit doctor`'s own exit code.
 */
async function checkSyncConflicts(): Promise<CheckResult> {
  const name = 'sync-conflicts';
  const consumer = await readConsumerConfig();
  if (!consumer) return { name, ok: true, detail: 'skipped (not a consumer project)', suspectedOrigin: 'unknown' };
  const { readManifest } = await import('../update/sync-manifest.js');
  const manifest = await readManifest(consumer.repoRoot);
  if (!manifest) {
    return { name, ok: true, detail: 'skipped (no .devaudit/sync-manifest.json yet)', suspectedOrigin: 'unknown' };
  }
  const conflicts = Object.entries(manifest.files).filter(([, entry]) => entry.conflict === true);
  if (conflicts.length === 0) {
    return { name, ok: true, detail: 'no unresolved sync conflicts', suspectedOrigin: 'consumer-drift' };
  }
  const paths = conflicts.map(([path]) => path);
  return {
    name,
    ok: false,
    detail: `${conflicts.length} unresolved sync conflict(s): ${paths.join(', ')} — see the matching <path>.devaudit-new next to each, or re-run \`devaudit update\` for the current summary`,
    suspectedOrigin: 'consumer-drift',
  };
}

/**
 * devaudit-installer#1023 — surface every `.devaudit-patches/*.patch` the
 * last sync skipped because it no longer applies cleanly. A skipped patch is
 * correctly non-fatal (#921/#923), but without this the only trace was a
 * one-time warning in that run's output, so a consumer-side fix could revert
 * to the upstream template unnoticed (a consumer). Same shape as
 * `checkSyncConflicts`: non-gating, reads the persisted sync manifest.
 */
async function checkPatchConflicts(): Promise<CheckResult> {
  const name = 'patch-conflicts';
  const consumer = await readConsumerConfig();
  if (!consumer) return { name, ok: true, detail: 'skipped (not a consumer project)', suspectedOrigin: 'unknown' };
  const { readManifest } = await import('../update/sync-manifest.js');
  const manifest = await readManifest(consumer.repoRoot);
  if (!manifest) {
    return { name, ok: true, detail: 'skipped (no .devaudit/sync-manifest.json yet)', suspectedOrigin: 'unknown' };
  }
  const conflicts = Object.entries(manifest.patches ?? {}).filter(([, entry]) => entry.conflict === true);
  if (conflicts.length === 0) {
    return { name, ok: true, detail: 'no consumer patches in conflict', suspectedOrigin: 'consumer-drift' };
  }
  const described = conflicts.map(([patch, entry]) => {
    const issue = entry.upstream_issue ? ` (see ${entry.upstream_issue})` : '';
    return `${patch}${issue} since ${entry.detected_at}`;
  });
  return {
    name,
    ok: false,
    detail:
      `${conflicts.length} consumer patch(es) no longer apply cleanly and are being skipped — the affected file(s) carry the UNPATCHED upstream template: ${described.join('; ')}. ` +
      'Re-roll or remove each patch: docs/consuming-projects.md#re-rolling-a-conflicting-patch',
    suspectedOrigin: 'consumer-drift',
  };
}

/**
 * devaudit-installer#1016 / #1017 (R6) -- an accepted E2E failure or
 * accepted dependency risk is a documented, time-boxed exception, tracked as
 * an open GitHub issue labelled `accepted-e2e-failure` / `accepted-dependency-risk`
 * whose body carries `Review by: YYYY-MM-DD`. This flags every one whose review
 * date has passed (or that has no review date, so it can never expire), so an
 * exception cannot quietly become permanent. Non-gating, and skipped (not a
 * failure) when `gh` is unavailable or unauthenticated. The portal-side half of
 * R6 (unresolved failed regression executions) is read by `fleet-doctor`.
 */
const ACCEPTED_EXCEPTION_LABELS = ['accepted-e2e-failure', 'accepted-dependency-risk'] as const;

export function findOverdueExceptions(
  issues: ReadonlyArray<{ number: number; title?: string; body?: string | null }>,
  label: string,
  today: string,
): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    const m = /review by:\s*(\d{4}-\d{2}-\d{2})/i.exec(issue.body ?? '');
    if (!m || !m[1]) {
      out.push(`#${issue.number} (${label}) has no "Review by: YYYY-MM-DD" date, so it can never expire`);
    } else if (m[1] <= today) {
      out.push(`#${issue.number} (${label}) review date ${m[1]} has passed`);
    }
  }
  return out;
}

/**
 * devaudit-installer#1017 -- entries of compliance/security/accepted-vulnerabilities.json
 * that have expired (the CI dependency gate fails again on them) or expire
 * within `windowDays`, so the renewal-or-fix happens before the gate goes red.
 */
export function findExpiringDependencyExceptions(
  doc: unknown,
  today: string,
  windowDays = 14,
): string[] {
  const out: string[] = [];
  const exceptions = (doc as { exceptions?: unknown })?.exceptions;
  if (!Array.isArray(exceptions)) return out;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + windowDays);
  const limitIso = limit.toISOString().slice(0, 10);
  for (const raw of exceptions) {
    const item = raw as { advisoryId?: string; package?: string; expiresAt?: string };
    const id = item.advisoryId ?? 'unknown advisory';
    const pkg = item.package ? ` (${item.package})` : '';
    if (typeof item.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.expiresAt)) {
      out.push(`${id}${pkg} has no valid expiresAt`);
    } else if (item.expiresAt <= today) {
      out.push(`${id}${pkg} expired on ${item.expiresAt} (the dependency gate fails on it again)`);
    } else if (item.expiresAt <= limitIso) {
      out.push(`${id}${pkg} expires on ${item.expiresAt}`);
    }
  }
  return out;
}

async function checkAcceptedExceptions(): Promise<CheckResult> {
  const name = 'accepted-exceptions';
  const consumer = await readConsumerConfig();
  if (!consumer) return { name, ok: true, detail: 'skipped (not a consumer project)', suspectedOrigin: 'unknown' };
  const today = new Date().toISOString().slice(0, 10);
  const overdue: string[] = [];
  let open = 0;
  // The repo-owned dependency exceptions file needs no gh at all.
  try {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(`${consumer.repoRoot}/compliance/security/accepted-vulnerabilities.json`, 'utf-8');
    overdue.push(...findExpiringDependencyExceptions(JSON.parse(raw), today).map((m) => `dependency exception ${m}`));
  } catch {
    // no file (or unparsable): evaluate-npm-audit.sh reports a malformed file in CI
  }
  for (const label of ACCEPTED_EXCEPTION_LABELS) {
    try {
      const result = await execa(
        'gh',
        ['issue', 'list', '--label', label, '--state', 'open', '--limit', '100', '--json', 'number,title,body'],
        { cwd: consumer.repoRoot, reject: false, timeout: GH_TIMEOUT_MS },
      );
      if (result.exitCode !== 0) {
        return overdue.length > 0
          ? { name, ok: false, detail: `${overdue.length} accepted exception(s) overdue for review: ${overdue.join('; ')} (gh issue list unavailable, so labelled tracking issues were not checked)`, suspectedOrigin: 'consumer-drift' }
          : { name, ok: true, detail: 'skipped (gh issue list failed — not authenticated, or no repo access)', suspectedOrigin: 'unknown' };
      }
      const issues = JSON.parse(result.stdout) as Array<{ number: number; title?: string; body?: string | null }>;
      open += issues.length;
      overdue.push(...findOverdueExceptions(issues, label, today));
    } catch {
      return overdue.length > 0
        ? { name, ok: false, detail: `${overdue.length} accepted exception(s) overdue for review: ${overdue.join('; ')} (gh issue list unavailable, so labelled tracking issues were not checked)`, suspectedOrigin: 'consumer-drift' }
        : { name, ok: true, detail: 'skipped (gh issue list unavailable)', suspectedOrigin: 'unknown' };
    }
  }
  if (overdue.length === 0) {
    return { name, ok: true, detail: open === 0 ? 'no open accepted exceptions' : `${open} open accepted exception(s), none past their review date`, suspectedOrigin: 'consumer-drift' };
  }
  return {
    name,
    ok: false,
    detail: `${overdue.length} accepted exception(s) overdue for review: ${overdue.join('; ')} — fix the underlying failure/advisory, or renew the exception with a new record and review date`,
    suspectedOrigin: 'consumer-drift',
  };
}

export async function runDoctor(options: DoctorOptions = {}): Promise<void> {
  const log = logger();
  const jsonMode = isJsonMode();
  if (!jsonMode) log.info('Running devaudit doctor — checking required tools...\n');
  // The five tool probes are independent child processes: run them together (process spawn is
  // slow on a loaded Windows runner), report them in the usual order.
  const checks: readonly CheckResult[] = await Promise.all([
    timed('tool:node', () => checkNodeVersion()),
    timed('tool:git', () => checkCommand('git', ['--version'])),
    timed('tool:gh', () => checkCommand('gh', ['--version'])),
    timed('tool:jq', () => checkCommand('jq', ['--version'])),
    timed('tool:curl', () => checkCommand('curl', ['--version'])),
  ]);
  let allOk = true;
  for (const check of checks) {
    if (!check.ok) allOk = false;
    if (!jsonMode) {
      const marker = check.ok ? '✓' : '✗';
      log.log(`  ${marker} ${check.name.padEnd(8)} ${check.detail}`);
    }
  }
  // Reconciliation safety-net — reported but does not gate the tool check (#60).
  const { result: closeout, drifted: closeoutDrifted } = await timed('closeout-drift', () => checkReleaseCloseoutDrift());
  if (!jsonMode) {
    const closeoutMarker = closeout.ok ? '✓' : '⚠';
    log.log(`  ${closeoutMarker} ${closeout.name.padEnd(8)} ${closeout.detail}`);
    if (!closeout.ok) {
      log.warn('Release close-out drift detected — see above. (Does not affect the tool check.)');
    }
  }
  // Onboarding-checklist invariants — same non-gating shape as the
  // close-out check above (devaudit-installer#826, extended #867).
  const onboardingChecks: readonly CheckResult[] = [
    await timed('srs', () => checkSrsBootstrapped()),
    await timed('rtm', () => checkRtmInitialized()),
    await timed('semgrep', () => checkSemgrepAvailable()),
    await timed('e2e-regression', () => checkE2eRegressionConsistency()),
    await timed('secrets', () => checkRequiredSecretsPresent()),
    await timed('pre-push-hook', () => checkPrePushHookPresent()),
    await timed('reconcile-cli', () => checkReconcileCliPresent()),
    await timed('sync-conflicts', () => checkSyncConflicts()),
    await timed('patch-conflicts', () => checkPatchConflicts()),
    await timed('accepted-exceptions', () => checkAcceptedExceptions()),
    await timed('commitlint-config-shadowing', () => checkCommitlintConfigShadowing()),
    // devaudit-installer#1040: deploy host, production URL/probe, custom deploy, CI runner.
    ...(await timed('config-checks', () => configChecksFor(options.configDeps))),
    // devaudit-installer#1099 WP5: informational, only when the variable is set.
    ...checkPatInEnvironment(),
    // devaudit-installer#1099 WP4: uploader / viewer key / PAT, names and statuses only.
    await timed('credentials', () => checkCredentials(options.credentialsDeps)),
  ];
  let onboardingIssues = false;
  for (const check of onboardingChecks) {
    if (!check.ok) onboardingIssues = true;
    if (!jsonMode) {
      const marker = check.ok ? '✓' : '⚠';
      log.log(`  ${marker} ${check.name.padEnd(14)} ${check.detail}`);
    }
  }
  if (!jsonMode) {
    log.log('');
    if (onboardingIssues) {
      log.warn('Onboarding checklist gaps detected — see above. (Does not affect the tool check.)');
    }
  }
  // Release-deferral diagnosis (#956 phase 3a-2): read-only, non-gating, and
  // reported under a new additive JSON key so existing keys are untouched.
  const consumer = await readConsumerConfig();
  const deferralChecks: readonly CheckResult[] = consumer
    ? await runDeferralChecks(await buildDeferralContext(consumer.repoRoot, consumer.cfg))
    : [];
  let deferralIssues = false;
  for (const check of deferralChecks) {
    if (!check.ok) deferralIssues = true;
    if (!jsonMode) {
      const marker = check.ok ? '✓' : '⚠';
      log.log(`  ${marker} ${check.name.padEnd(18)} ${check.detail}`);
    }
  }
  if (!jsonMode && deferralIssues) {
    log.warn('Release-deferral findings detected — see above. (Read-only; does not affect the tool check.)');
  }
  const proposals: Proposal[] = [
    ...deferralChecks.flatMap((c) =>
      (c.findings ?? []).flatMap((f) =>
        f.remediation ? [{ check: c.name, subject: f.subject, detail: f.detail, remediation: f.remediation }] : [],
      ),
    ),
    ...closeoutDrifted.map((req) => ({
      check: closeout.name,
      subject: req,
      detail: `${req} is released on the portal but still in pending-releases/`,
      remediation: {
        id: 'close-out-release',
        // #984 — guidance: `--fix` never runs close-out-release.sh (it moves
        // files with git), so it is tier C (printed, not counted as unapplied).
        tier: 'C' as const,
        summary: `Close out ${req} locally`,
        plan: [`./scripts/close-out-release.sh ${req}`],
        needsPortal: false,
      },
    })),
    // devaudit-installer#1040 config findings, appended so existing proposal order is unchanged.
    ...onboardingChecks.flatMap((c) =>
      (c.findings ?? []).flatMap((f) =>
        f.remediation ? [{ check: c.name, subject: f.subject, detail: f.detail, remediation: f.remediation }] : [],
      ),
    ),
  ];
  let fixReport: FixReport | null = null;
  if (options.fix) {
    const fixOpts = {
      yes: Boolean(options.fix.yes),
      ...(options.fix.reason ? { reason: options.fix.reason } : {}),
      dryRun: Boolean(options.fix.dryRun),
      json: jsonMode,
    };
    if (!consumer) {
      fixReport = { dryRun: fixOpts.dryRun, outcomes: [], unapplied: 0 };
    } else {
      const devauditCfg = (consumer.cfg['devaudit'] ?? {}) as { base_url?: string };
      const deps: FixDeps = {
        repoRoot: consumer.repoRoot,
        baseUrl: (devauditCfg.base_url ?? '').replace(/\/$/, ''),
        commitsFor: async (req) => {
          const main = (await refExists(consumer.repoRoot, 'origin/main')) ? 'origin/main' : 'main';
          const dev = (await refExists(consumer.repoRoot, 'develop')) ? 'develop' : 'origin/develop';
          const commits = await commitsInRange(consumer.repoRoot, main, dev);
          return commits.filter((c) => reqHasCommits([c], req)).map((c) => c.subject);
        },
        ...options.fix.deps,
      };
      if (!jsonMode) log.log(`\nApplying fixes${fixOpts.dryRun ? ' (dry run: nothing will change)' : ''}...`);
      fixReport = await runFix(proposals, deps, fixOpts);
    }
    if (!jsonMode) {
      if (fixReport.outcomes.length === 0) log.log('  Nothing to fix.');
      for (const o of fixReport.outcomes) {
        const marker = { applied: '✓', unchanged: '=', planned: '~', unapplied: '⚠', failed: '✗', reported: 'i' }[o.status];
        log.log(`  ${marker} [${o.tier}] ${o.id} ${o.subject}: ${o.status} — ${o.message}`);
      }
      if (fixReport.unapplied > 0) {
        log.warn(`${fixReport.unapplied} proposal(s) remain unapplied. Re-run interactively, or pass --yes (tier A) / --yes --reason "<text>" (portal changes).`);
      }
    }
  }
  const plugins = options.plugins ?? (await discoverPlugins()).loaded;
  if (plugins.length > 0) {
    const ctx = await buildPluginContext({ projectPath: resolve(process.cwd()) });
    await runHook(plugins, 'onDoctor', ctx);
  }
  if (jsonMode) {
    emitJsonResult({
      ok: allOk,
      tools: checks,
      releaseCloseoutDrift: closeout,
      onboarding: onboardingChecks,
      // Additive (#956): release-deferral checks and inert remediation proposals.
      deferral: deferralChecks,
      proposals,
      ...(fixReport ? { fix: fixReport } : {}),
    });
  }
  if (allOk) {
    if (!jsonMode) log.success('All required tools present.');
    // `--fix` only: proposals left unapplied are a non-zero exit (maintainer decision on #956).
    process.exit(fixReport && fixReport.unapplied > 0 ? FIX_EXIT_UNAPPLIED : 0);
  } else {
    if (!jsonMode) {
      log.error('One or more required tools are missing. Install them and re-run `devaudit doctor`.');
    }
    process.exit(6);
  }
}
