import { execa } from 'execa';
import type { PluginContext } from '@metasession-dev/devaudit-plugin-sdk';
import { detectPrismaLayout, SCHEMA_FILE } from '../util/prisma-paths.js';

export async function migrateStatus(ctx: PluginContext): Promise<void> {
  const layout = await detectPrismaLayout(ctx.projectPath);
  if (!layout.schemaExists) {
    ctx.logger.warn(`No ${SCHEMA_FILE} in ${ctx.projectPath} — nothing to check.`);
    return;
  }
  ctx.logger.info(`Running \`npx prisma migrate status\` in ${ctx.projectPath}...`);
  const res = await execa('npx', ['prisma', 'migrate', 'status'], {
    cwd: ctx.projectPath,
    reject: false,
    stdio: 'inherit',
  });
  if (res.exitCode === 0) {
    ctx.logger.info('Migrations are up to date.');
  } else {
    ctx.logger.warn(`prisma migrate status exited ${res.exitCode}. See output above.`);
  }
}
