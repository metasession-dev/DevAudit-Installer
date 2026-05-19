import type {
  PluginContext,
  PluginEvent,
  PluginLogger,
  PluginSdlcConfigView,
} from '@metasession.co/devaudit-plugin-sdk';
import { readSdlcConfig } from '../sdlc-config.js';
import { logger } from '../logger.js';

export interface BuildPluginContextOptions {
  readonly projectPath: string;
  readonly events?: PluginEvent[];
}

export async function buildPluginContext(opts: BuildPluginContextOptions): Promise<PluginContext> {
  const cfg = await readSdlcConfig(opts.projectPath);
  const sdlcConfig: PluginSdlcConfigView = (cfg as unknown as PluginSdlcConfigView) ?? {
    project_slug: '',
  };
  return {
    projectPath: opts.projectPath,
    sdlcConfig,
    logger: pluginLogger(),
    apiVersion: '1',
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
