import type { PluginContext } from '@metasession.co/devaudit-plugin-sdk';
import { hasAuth } from '../util/token.js';

export async function onDoctor(ctx: PluginContext): Promise<void> {
  if (await hasAuth(ctx)) {
    ctx.logger.info('evidence-export: a personal access token is available — list/bundle will work.');
    return;
  }
  ctx.logger.warn(
    'evidence-export: no personal access token available. Run `devaudit auth login` before using `evidence-export list/bundle`.',
  );
}
