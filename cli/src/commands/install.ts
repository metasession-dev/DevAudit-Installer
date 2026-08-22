import { runInstall } from '../install/index.js';
import { logger } from '../lib/logger.js';

export interface InstallOptions {
  readonly path?: string;
  readonly token?: string;
  readonly baseUrl?: string;
  readonly dryRun?: boolean;
  readonly yes?: boolean;
  /**
   * Re-enables the destructive steps even when dev-mode detection would have
   * skipped them — the project operator's rotation lane. Without this flag a
   * second-dev re-run on an onboarded project auto-routes to developer mode.
   */
  readonly forceTeamConfig?: boolean;
  /**
   * Append a new target to an existing multi-target `sdlc-config.json`
   * instead of refusing when the repo already configures a different
   * target. See #689 / #691.
   */
  readonly addTarget?: boolean;
}

export async function runInstallCommand(options: InstallOptions): Promise<void> {
  const log = logger();
  try {
    await runInstall({
      ...(options.path !== undefined ? { path: options.path } : {}),
      ...(options.token !== undefined ? { token: options.token } : {}),
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
      ...(options.yes !== undefined ? { nonInteractive: options.yes } : {}),
      ...(options.forceTeamConfig !== undefined
        ? { forceTeamConfig: options.forceTeamConfig }
        : {}),
      ...(options.addTarget !== undefined ? { addTarget: options.addTarget } : {}),
    });
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}
