import { execa } from 'execa';
import { resolve } from 'node:path';
import { resolveInstallerRoot } from '../lib/installer-root.js';
import { logger } from '../lib/logger.js';

export interface InstallOptions {
  readonly path?: string;
}

/**
 * v0 implementation: thin wrapper around scripts/sdlc-onboard.sh.
 *
 * The interactive 11-step onboarding flow stays in bash for now; the CLI
 * forwards stdin/stdout/stderr so prompts feel native. Future iterations
 * port each step into native TS — see ../../../docs/devaudit-cli/build-plan.md
 * Workstream A milestone 3.
 */
export async function runInstall(options: InstallOptions): Promise<void> {
  const log = logger();
  const targetPath = resolve(options.path ?? process.cwd());
  const installerRoot = await resolveInstallerRoot();
  const script = resolve(installerRoot, 'scripts', 'sdlc-onboard.sh');
  log.info(`Running ${script} ${targetPath}`);
  try {
    await execa('bash', [script, targetPath], {
      stdio: 'inherit',
      cwd: installerRoot,
      env: process.env,
    });
  } catch (err) {
    const exitCode = (err as { exitCode?: number }).exitCode ?? 1;
    process.exit(exitCode);
  }
}
