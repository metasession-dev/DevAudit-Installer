import { resolveToken } from '../auth.js';
import type {
  PluginContext,
  PluginEvent,
  PluginLogger,
  PluginSdlcConfigView,
} from '@metasession.co/devaudit-plugin-sdk';
import { readSdlcConfig } from '../sdlc-config.js';
import { logger } from '../logger.js';
import { resolveRepoRoot } from '../git-root.js';

export interface BuildPluginContextOptions {
  readonly projectPath: string;
  readonly events?: PluginEvent[];
}

export async function buildPluginContext(opts: BuildPluginContextOptions): Promise<PluginContext> {
  // sdlc-config.json lives at the repo root (#689 follow-up), not
  // necessarily projectPath itself for a polyglot-monorepo target.
  const repoRoot = await resolveRepoRoot(opts.projectPath);
  const cfg = await readSdlcConfig(repoRoot);
  const sdlcConfig: PluginSdlcConfigView = (cfg as unknown as PluginSdlcConfigView) ?? {
    project_slug: '',
  };
  return {
    projectPath: opts.projectPath,
    sdlcConfig,
    logger: pluginLogger(),
    apiVersion: '1',
    // devaudit-installer#1100: plugins get the person's PAT from the CLI instead of asking the
    // user to export DEVAUDIT_USER_TOKEN. Same resolution as `devaudit auth status`.
    getPersonalAuth: async () => {
      const resolved = await resolveToken();
      return resolved ? { token: resolved.token, baseUrl: resolved.baseUrl } : null;
    },
    emit: (event) => {
      opts.events?.push(event);
    },
  };
}

function pluginLogger(): PluginLogger {
  const log = logger();
  return {
    info: (m) => log.info(`[plugin] ${m}`),
    warn: (m) => log.warn(`[plugin] ${m}`),
    error: (m) => log.error(`[plugin] ${m}`),
    debug: (m) => log.debug(`[plugin] ${m}`),
  };
}
