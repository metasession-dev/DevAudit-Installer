import type { PluginContext } from '@metasession-dev/devaudit-plugin-sdk';
import { detectPrismaLayout, MIGRATIONS_DIR, SCHEMA_FILE } from '../util/prisma-paths.js';

export async function onDoctor(ctx: PluginContext): Promise<void> {
  const layout = await detectPrismaLayout(ctx.projectPath);
  if (!layout.schemaExists && !layout.migrationsExists) {
    ctx.logger.debug('No Prisma artifacts in this project — skipping prisma doctor checks.');
    return;
  }
  if (!layout.schemaExists) {
    ctx.logger.warn(`prisma/migrations/ exists but ${SCHEMA_FILE} is missing.`);
    return;
  }
  if (!layout.migrationsExists) {
    ctx.logger.warn(`${SCHEMA_FILE} exists but ${MIGRATIONS_DIR}/ is missing. Run \`npx prisma migrate dev --name init\`.`);
    return;
  }
  ctx.logger.info('Prisma layout looks healthy.');
}
