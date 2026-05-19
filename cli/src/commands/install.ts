import { runInstall } from '../install/index.js';
import { logger } from '../lib/logger.js';

export interface InstallOptions {
  readonly path?: string;
  readonly token?: string;
  readonly baseUrl?: string;
  readonly dryRun?: boolean;
  readonly yes?: boolean;
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
    });
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}
