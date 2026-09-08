import { runUninstall } from '../uninstall/index.js';
import { logger } from '../lib/logger.js';

export interface UninstallOptions {
  readonly path?: string;
  readonly token?: string;
  readonly baseUrl?: string;
  readonly target?: string;
  readonly dryRun?: boolean;
  readonly yes?: boolean;
}

export async function runUninstallCommand(options: UninstallOptions): Promise<void> {
  const log = logger();
  try {
    await runUninstall({
      ...(options.path !== undefined ? { path: options.path } : {}),
      ...(options.token !== undefined ? { token: options.token } : {}),
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      ...(options.target !== undefined ? { target: options.target } : {}),
      ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
      ...(options.yes !== undefined ? { nonInteractive: options.yes } : {}),
    });
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}
