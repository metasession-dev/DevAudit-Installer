import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export const SCHEMA_FILE = 'prisma/schema.prisma';
export const MIGRATIONS_DIR = 'prisma/migrations';

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export interface PrismaLayout {
  readonly schemaExists: boolean;
  readonly migrationsExists: boolean;
}

export async function detectPrismaLayout(projectPath: string): Promise<PrismaLayout> {
  return {
    schemaExists: await pathExists(join(projectPath, SCHEMA_FILE)),
    migrationsExists: await pathExists(join(projectPath, MIGRATIONS_DIR)),
  };
}
