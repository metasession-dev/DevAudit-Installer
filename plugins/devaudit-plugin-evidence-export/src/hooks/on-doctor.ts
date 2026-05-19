import type { PluginContext } from '@metasession/devaudit-plugin-sdk';

export async function onDoctor(ctx: PluginContext): Promise<void> {
  if (process.env['DEVAUDIT_USER_TOKEN']) {
    ctx.logger.info('evidence-export: DEVAUDIT_USER_TOKEN present — bundle/list will work.');
    return;
  }
  ctx.logger.warn(
    'evidence-export: DEVAUDIT_USER_TOKEN is not set. Run `devaudit auth login` or export the env var before using `evidence-export list/bundle`.',
  );
}
