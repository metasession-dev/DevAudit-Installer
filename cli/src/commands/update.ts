import { syncAll } from '../update/index.js';
import { logger } from '../lib/logger.js';

export interface UpdateOptions {
  readonly version?: string;
  readonly paths: readonly string[];
}

/**
 * Native TypeScript implementation of the SDLC template sync.
 *
 * The bash version (`scripts/sync-sdlc.sh`) tagged DevAudit-Installer before
 * sync. The CLI omits the tagging step — `devaudit release tag` will own that
 * concern in a future command. The version argument is accepted for parity
 * with the bash CLI but is currently used only in summary output.
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
  await syncAll(options.paths);
  log.success('=== Sync Complete ===');
  log.log('');
  log.log('Next steps for each consuming project:');
  log.log('  1. cd into the project directory');
  log.log('  2. Review the diff: git diff');
  log.log("  3. Commit: git add -A && git commit -m 'chore: sync SDLC templates from DevAudit'");
  log.log('  4. Push to develop');
  log.log('');
  log.warn('Do NOT auto-commit — review the changes first.');
}
