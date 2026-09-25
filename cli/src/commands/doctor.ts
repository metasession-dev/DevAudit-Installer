import { execa } from 'execa';
import { resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import { logger, isJsonMode, emitJsonResult } from '../lib/logger.js';
import { resolveRepoRoot } from '../lib/git-root.js';
import { discoverPlugins, buildPluginContext, runHook, type LoadedPlugin } from '../lib/plugin/index.js';

export interface DoctorOptions {
  readonly plugins?: readonly LoadedPlugin[];
}

/**
 * First-pass signal for `fleet-doctor` (devaudit-installer#867): whether a
 * failing check most likely points at this one consumer having drifted from
 * what onboarding/template-sync should have produced (`consumer-drift`), or
 * at the framework/portal itself (`framework`) -- e.g. every consumer would
 * fail the same way regardless of local state. `fleet-doctor` re-evaluates
 * this with cross-consumer evidence; it isn't taken as final here. Tool
 * preflight checks (node/git/gh/jq/curl) describe the operator's own
 * machine, not either repo, so they're tagged `unknown`.
 */
type SuspectedOrigin = 'framework' | 'consumer-drift' | 'unknown';

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly suspectedOrigin?: SuspectedOrigin;
}

async function checkCommand(name: string, args: readonly string[]): Promise<CheckResult> {
  try {
    const result = await execa(name, args, { reject: false });
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
async function checkReleaseCloseoutDrift(): Promise<CheckResult> {
  const name = 'releases';
  let cfg: { project_slug?: string; devaudit?: { project_slug?: string; base_url?: string } };
  try {
    // sdlc-config.json lives at the repo root (#689 follow-up), not
    // necessarily cwd itself for a polyglot-monorepo target.
    const repoRoot = await resolveRepoRoot(process.cwd());
    cfg = JSON.parse(await fs.readFile(`${repoRoot}/sdlc-config.json`, 'utf-8'));
  } catch {
    return { name, ok: true, detail: 'skipped (not a consumer project)' };
  }
  let entries: string[];
  try {
    entries = await fs.readdir('compliance/pending-releases');
  } catch {
    return { name, ok: true, detail: 'no pending-releases/' };
  }
  const reqs = entries
    .filter((f) => /^RELEASE-TICKET-REQ-\d+\.md$/.test(f))
    .map((f) => f.replace(/^RELEASE-TICKET-/, '').replace(/\.md$/, ''));
  if (reqs.length === 0) return { name, ok: true, detail: 'no pending release tickets' };

  const slug = cfg.devaudit?.project_slug ?? cfg.project_slug;
  const base = (cfg.devaudit?.base_url ?? '').replace(/\/$/, '');
  const apiKey = process.env['DEVAUDIT_API_KEY'];
  if (!slug || !base || !apiKey) {
    return {
      name,
      ok: true,
      detail: `${reqs.length} pending ticket(s); portal drift check skipped (set DEVAUDIT_API_KEY + devaudit.base_url)`,
    };
  }

  const drifted: string[] = [];
  for (const req of reqs) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(
        `${base}/api/ci/releases/resolve?projectSlug=${encodeURIComponent(slug)}&versionPrefix=${encodeURIComponent(req)}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: ctrl.signal },
      );
      clearTimeout(timer);
      if (!res.ok) continue;
      const body = (await res.json()) as { latest?: { status?: string } };
      if (body.latest?.status === 'released') drifted.push(req);
    } catch {
      // network/timeout — leave as a skip for this REQ
    }
  }
  if (drifted.length > 0) {
    return {
      name,
      ok: false,
      detail: `released on the portal but still in pending-releases/: ${drifted.join(', ')} — run ./scripts/close-out-release.sh <REQ>`,
    };
  }
  return { name, ok: true, detail: `${reqs.length} pending ticket(s); none released on the portal` };
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
 */
async function checkRequiredSecretsPresent(): Promise<CheckResult> {
  const name = 'secrets';
  const consumer = await readConsumerConfig();
  if (!consumer) return { name, ok: true, detail: 'skipped (not a consumer project)', suspectedOrigin: 'unknown' };
  const devaudit = (consumer.cfg['devaudit'] ?? {}) as {
    api_key_secret?: string;
    viewer_api_key_secret?: string;
  };
  const required = [devaudit.api_key_secret ?? 'DEVAUDIT_API_KEY', 'DEVAUDIT_USER_TOKEN'];
  if (devaudit.viewer_api_key_secret) required.push(devaudit.viewer_api_key_secret);

  let secretNames: string[];
  try {
    const result = await execa('gh', ['secret', 'list', '--json', 'name'], {
      cwd: consumer.repoRoot,
      reject: false,
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
  return missing.length === 0
    ? { name, ok: true, detail: `all required secrets present (${required.join(', ')})`, suspectedOrigin: 'consumer-drift' }
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

export async function runDoctor(options: DoctorOptions = {}): Promise<void> {
  const log = logger();
  const jsonMode = isJsonMode();
  if (!jsonMode) log.info('Running devaudit doctor — checking required tools...\n');
  const checks: readonly CheckResult[] = [
    await checkNodeVersion(),
    await checkCommand('git', ['--version']),
    await checkCommand('gh', ['--version']),
    await checkCommand('jq', ['--version']),
    await checkCommand('curl', ['--version']),
  ];
  let allOk = true;
  for (const check of checks) {
    if (!check.ok) allOk = false;
    if (!jsonMode) {
      const marker = check.ok ? '✓' : '✗';
      log.log(`  ${marker} ${check.name.padEnd(8)} ${check.detail}`);
    }
  }
  // Reconciliation safety-net — reported but does not gate the tool check (#60).
  const closeout = await checkReleaseCloseoutDrift();
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
    await checkSrsBootstrapped(),
    await checkRtmInitialized(),
    await checkSemgrepAvailable(),
    await checkE2eRegressionConsistency(),
    await checkRequiredSecretsPresent(),
    await checkPrePushHookPresent(),
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
    });
  }
  if (allOk) {
    if (!jsonMode) log.success('All required tools present.');
    process.exit(0);
  } else {
    if (!jsonMode) {
      log.error('One or more required tools are missing. Install them and re-run `devaudit doctor`.');
    }
    process.exit(6);
  }
}
