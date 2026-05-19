import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { PluginContext } from '@metasession/devaudit-plugin-sdk';
import { detectPrismaLayout, MIGRATIONS_DIR } from '../util/prisma-paths.js';

interface MigrationDir {
  readonly name: string;
  readonly applied: boolean;
}

async function listMigrations(projectPath: string): Promise<readonly MigrationDir[]> {
  const dir = join(projectPath, MIGRATIONS_DIR);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const migrations: MigrationDir[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const appliedMarker = join(dir, e.name, 'migration.sql');
    let applied = true;
    try {
      await fs.access(appliedMarker);
    } catch {
      applied = false;
    }
    migrations.push({ name: e.name, applied });
  }
  return migrations.sort((a, b) => a.name.localeCompare(b.name));
}

export async function pending(ctx: PluginContext): Promise<void> {
  const layout = await detectPrismaLayout(ctx.projectPath);
  if (!layout.migrationsExists) {
    ctx.logger.warn(`No ${MIGRATIONS_DIR}/ in ${ctx.projectPath} — nothing to list.`);
    return;
  }
  const migrations = await listMigrations(ctx.projectPath);
  if (migrations.length === 0) {
    ctx.logger.info('No migrations found.');
    return;
  }
  ctx.logger.info(`Found ${migrations.length} migration(s):`);
  for (const m of migrations) {
    ctx.logger.info(`  ${m.applied ? '✓' : '·'} ${m.name}`);
  }
  ctx.emit({ type: 'prisma-migrations', payload: { count: migrations.length } });
}
