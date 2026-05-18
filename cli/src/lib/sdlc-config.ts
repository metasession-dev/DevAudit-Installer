import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

export interface SdlcConfig {
  readonly project_slug: string;
  readonly stack?: string;
  readonly host?: string;
  readonly node_version?: string | number;
  readonly python_version?: string | number;
  readonly working_directory?: string;
  readonly source_dirs?: string;
  readonly devaudit?: {
    readonly base_url?: string;
    readonly project_slug?: string;
    readonly api_key_secret?: string;
  };
  readonly uat?: { readonly enabled?: boolean };
  readonly approval?: { readonly mode?: string };
}

export async function readSdlcConfig(projectPath: string): Promise<SdlcConfig | null> {
  const configPath = join(resolve(projectPath), 'sdlc-config.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw) as SdlcConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export interface FrameworkFileStatus {
  readonly path: string;
  readonly present: boolean;
}

export async function checkFrameworkFiles(
  projectPath: string,
  files: readonly string[],
): Promise<readonly FrameworkFileStatus[]> {
  const checks = await Promise.all(
    files.map(async (rel) => {
      try {
        await fs.access(join(projectPath, rel));
        return { path: rel, present: true };
      } catch {
        return { path: rel, present: false };
      }
    }),
  );
  return checks;
}
