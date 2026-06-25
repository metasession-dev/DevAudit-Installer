import { resolve } from 'node:path';
import { syncAll } from '../update/index.js';
import { logger } from '../lib/logger.js';
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
  if (options.version) {
    log.info(`Version (informational, no tag created): ${options.version}`);
  }
  if (options.paths.length === 0) {
    log.error('No project paths provided. Usage: devaudit update <version> <path> [path...]');
    process.exit(2);
  }
  if (options.dryRun) {
    log.warn('DRY RUN — no files will be written and no plugin hooks will fire');
    for (const projectPath of options.paths) {
      log.info(`  [dry-run] would sync SDLC templates via syncProject() against ${resolve(projectPath)}`);
    }
    log.success('=== Dry run complete (no mutations performed) ===');
    return;
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
}
