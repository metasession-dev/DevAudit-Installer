import { resolve } from 'node:path';
import { runInstall } from '../install/index.js';
import { isFile } from '../lib/fs-utils.js';
import { logger } from '../lib/logger.js';

export interface JoinOptions {
  readonly path?: string;
  readonly token?: string;
  readonly baseUrl?: string;
  readonly dryRun?: boolean;
  readonly yes?: boolean;
}

/**
 * `devaudit join` — the second-developer entry point. Runs the install flow
 * with `mode: 'developer'` pinned, so the destructive steps (write
 * sdlc-config, issue API key, set GitHub secrets, apply branch protection)
 * skip themselves and the team's CI token is left alone. See
 * `sdlc/files/_common/joining-an-existing-project.md` for the full guide.
 *
 * Pre-flight refuses to run when:
 *   - `sdlc-config.json` is absent (the project hasn't been onboarded yet —
 *     the operator should run `devaudit install`).
 *
 * Anything else (missing portal project, missing API key, missing repo
 * secret) is caught inside the install flow's mode detection — it'll log
 * a clear notice and routes back to operator mode if the detection fails;
 * if you really wanted developer mode, that's a signal the project is in
 * a half-onboarded state and the operator needs to finish it first.
 */
export async function runJoinCommand(options: JoinOptions): Promise<void> {
  const log = logger();
  const projectPath = resolve(options.path ?? process.cwd());
  const sdlcConfigExists = await isFile(`${projectPath}/sdlc-config.json`);
  if (!sdlcConfigExists) {
    log.error(
      `No sdlc-config.json at ${projectPath}. This project hasn't been onboarded yet — the project operator should run \`devaudit install\`. See SDLC/joining-an-existing-project.md (synced into onboarded repos) for the second-developer guide.`,
    );
    process.exit(7);
  }
  try {
    await runInstall({
      mode: 'developer',
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
