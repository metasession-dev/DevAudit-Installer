import type { PluginContext } from '@metasession-dev/devaudit-plugin-sdk';
import { detectPrismaLayout } from '../util/prisma-paths.js';

export async function afterUpdate(ctx: PluginContext): Promise<void> {
  const layout = await detectPrismaLayout(ctx.projectPath);
  if (!layout.schemaExists) return;
  ctx.logger.info(
    'Prisma schema detected. After deploying, run `npx prisma migrate deploy` to apply any pending migrations.',
  );
}
