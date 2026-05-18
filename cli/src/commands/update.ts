import { execa } from 'execa';
import { resolve } from 'node:path';
import { resolveInstallerRoot } from '../lib/installer-root.js';
import { logger } from '../lib/logger.js';

export interface UpdateOptions {
  readonly version: string;
  readonly paths: readonly string[];
}

/**
 * v0 implementation: thin wrapper around scripts/sync-sdlc.sh.
 *
 * Native TS port lives in Workstream A milestone 4 of
 * docs/devaudit-cli/build-plan.md.
 */
export async function runUpdate(options: UpdateOptions): Promise<void> {
  const log = logger();
  const installerRoot = await resolveInstallerRoot();
  const script = resolve(installerRoot, 'scripts', 'sync-sdlc.sh');
  const resolvedPaths = options.paths.map((p) => resolve(p));
  log.info(`Running ${script} ${options.version} ${resolvedPaths.join(' ')}`);
  try {
    await execa('bash', [script, options.version, ...resolvedPaths], {
      stdio: 'inherit',
      cwd: installerRoot,
      env: process.env,
    });
  } catch (err) {
    const exitCode = (err as { exitCode?: number }).exitCode ?? 1;
    process.exit(exitCode);
  }
}
