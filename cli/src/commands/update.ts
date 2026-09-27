import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { syncAll } from '../update/index.js';
import { logger } from '../lib/logger.js';
import { resolveRepoRoot } from '../lib/git-root.js';
import { readSdlcConfig } from '../lib/sdlc-config.js';
import {
  discoverPlugins,
  buildPluginContext,
  runHook,
  type LoadedPlugin,
} from '../lib/plugin/index.js';

export interface UpdateOptions {
  readonly version?: string;
  readonly paths: readonly string[];
  readonly plugins?: readonly LoadedPlugin[];
  /**
   * Preview only — do not write any files or fire mutating plugin hooks.
   * Mirrors the `install` dry-run semantics (see install/sync-templates.ts):
   * the sync is short-circuited rather than run against a write-guarded fs.
   */
  readonly dryRun?: boolean;
  /**
   * devaudit-installer#876 — flip `e2e_regression_enabled` in
   * `sdlc-config.json` before syncing, replacing the manual-JSON-edit-only
   * procedure. Both absent (the default) leaves any existing value
   * completely untouched — a plain `devaudit update` must never silently
   * toggle this (it interacts with #869's `compliance-evidence.yml`
   * listener gating). Passing both at once is a usage error — validated in
   * `runUpdate` itself, not the CLI wiring, so it's exercised the same way
   * whether invoked via commander or directly (mirrors `runPush`'s own
   * validation style).
   */
  readonly enableE2eRegression?: boolean;
  readonly disableE2eRegression?: boolean;
}

/**
 * devaudit-installer#876 — the `--enable-e2e-regression`/
 * `--disable-e2e-regression` config-flip step. Resolves each path's repo
 * root (sdlc-config.json always lives there, not a polyglot-monorepo
 * target's own subdirectory — #689), flips just `e2e_regression_enabled`,
 * and writes the file back with every other field untouched. Actual
 * generation/removal of `e2e-regression.yml` + the `compliance-evidence.yml`
 * listener happens in the `syncAll` call that follows — `ci-templates.ts`
 * already reads `e2e_regression_enabled` straight off disk, so no change is
 * needed there.
 */
async function applyE2eRegressionFlag(
  paths: readonly string[],
  mode: 'enable' | 'disable',
  dryRun: boolean,
): Promise<void> {
  const log = logger();
  const enabled = mode === 'enable';
  const resolved = await Promise.all(
    paths.map(async (p) => ({ projectPath: p, repoRoot: await resolveRepoRoot(resolve(p)) })),
  );
  // Fail fast, all-or-nothing: report every unonboarded path before writing
  // anything, rather than partially flipping some paths and leaving others
  // for the operator to notice were silently skipped.
  const missing = await Promise.all(
    resolved.map(async ({ repoRoot }) => ({ repoRoot, config: await readSdlcConfig(repoRoot) })),
  );
  const unonboarded = missing.filter((m) => m.config === null);
  if (unonboarded.length > 0) {
    for (const { repoRoot } of unonboarded) {
      log.error(
        `No sdlc-config.json at ${repoRoot}. This project hasn't been onboarded yet — run \`devaudit install\` before --enable-e2e-regression/--disable-e2e-regression.`,
      );
    }
    process.exit(1);
  }
  for (const { repoRoot, config } of missing) {
    if (dryRun) {
      log.info(
        `  [dry-run] would set e2e_regression_enabled: ${enabled} in ${join(repoRoot, 'sdlc-config.json')}`,
      );
      continue;
    }
    const raw = config as unknown as Record<string, unknown>;
    const next = { ...raw, e2e_regression_enabled: enabled };
    const outPath = join(repoRoot, 'sdlc-config.json');
    await fs.writeFile(outPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    log.info(`  set e2e_regression_enabled: ${enabled} in ${outPath}`);
  }
}

/**
 * Native TypeScript implementation of the SDLC template sync — the canonical
 * sync path (the former `scripts/sync-sdlc.sh` has been removed).
 *
 * Tagging DevAudit-Installer before sync is intentionally out of scope here;
 * `devaudit release tag` will own that concern in a future command. The version
 * argument is accepted for summary output and forward compatibility.
 */
export async function runUpdate(options: UpdateOptions): Promise<void> {
  const log = logger();
  if (options.enableE2eRegression && options.disableE2eRegression) {
    log.error('--enable-e2e-regression and --disable-e2e-regression cannot be combined.');
    process.exit(2);
  }
  const e2eRegression = options.enableE2eRegression
    ? ('enable' as const)
    : options.disableE2eRegression
      ? ('disable' as const)
      : undefined;
  if (options.version) {
    log.info(`Version (informational, no tag created): ${options.version}`);
  }
  if (options.paths.length === 0) {
    log.error('No project paths provided. Usage: devaudit update <version> <path> [path...]');
    process.exit(2);
  }
  if (options.dryRun) {
    log.warn('DRY RUN — no files will be written and no plugin hooks will fire');
    if (e2eRegression) {
      await applyE2eRegressionFlag(options.paths, e2eRegression, true);
    }
    for (const projectPath of options.paths) {
      log.info(`  [dry-run] would sync SDLC templates via syncProject() against ${resolve(projectPath)}`);
    }
    log.success('=== Dry run complete (no mutations performed) ===');
    return;
  }
  if (e2eRegression) {
    await applyE2eRegressionFlag(options.paths, e2eRegression, false);
  }
  const plugins = options.plugins ?? (await discoverPlugins()).loaded;
  for (const projectPath of options.paths) {
    if (plugins.length > 0) {
      const ctx = await buildPluginContext({ projectPath });
      await runHook(plugins, 'beforeSync', ctx);
    }
  }
  await syncAll(options.paths);
  for (const projectPath of options.paths) {
    if (plugins.length > 0) {
      const ctx = await buildPluginContext({ projectPath });
      await runHook(plugins, 'afterSync', ctx);
    }
  }
  log.success('=== Sync Complete ===');
  log.log('');
  log.log('Next steps for each consuming project:');
  log.log('  1. Review the diff: git diff');
  log.log("  2. Commit: git add -A && git commit -m 'chore: sync SDLC templates from DevAudit [skip ci]'");
  log.log('  3. Push to develop');
  log.log('');
  log.warn('Do NOT auto-commit — review the changes first.');
  if (e2eRegression === 'enable') {
    log.log('');
    log.log('E2E regression tier enabled (devaudit-installer#876):');
    log.log(
      '  playwright.config.ts must define `critical`/`regression` named projects for the generated',
    );
    log.log(
      '  CI to actually run them — see docs/e2e-test-tiers.md#opting-into-the-3-tier-regression-gate.',
    );
    log.log('  Run `devaudit doctor` afterward — its e2e-regression check catches this drift directly.');
  }
}
