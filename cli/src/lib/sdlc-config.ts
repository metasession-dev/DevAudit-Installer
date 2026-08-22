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
  readonly production_url_secret?: string;
  readonly integration_branch?: string;
  readonly release_branch?: string;
  readonly devaudit?: {
    readonly base_url?: string;
    readonly project_slug?: string;
    readonly api_key_secret?: string;
  };
  readonly uat?: { readonly enabled?: boolean };
  readonly approval?: { readonly mode?: string };
  /**
   * Optional multi-target (polyglot monorepo) support — see #689. When
   * present, each entry describes an independently-gated stack living in a
   * subdirectory of this repo (e.g. a Next.js frontend + FastAPI backend
   * both wanting their own compliance project). When absent, the flat
   * top-level fields above describe a single implicit target — use
   * `resolveTargets()` rather than reading `targets` directly so both
   * shapes are handled uniformly.
   */
  readonly targets?: readonly Target[];
}

/** One independently-gated stack within a (possibly multi-target) repo. See #689. */
export interface Target {
  readonly name: string;
  readonly stack?: string;
  readonly working_directory?: string;
  readonly source_dirs?: string;
  readonly production_url_secret?: string;
  readonly devaudit?: {
    readonly base_url?: string;
    readonly project_slug?: string;
    readonly api_key_secret?: string;
  };
}

/**
 * Resolve a config's targets uniformly, regardless of whether it uses the
 * explicit `targets` array or the legacy flat single-target shape. Legacy
 * configs synthesize one implicit target (named `'default'`) from the
 * top-level fields, so every caller can iterate `resolveTargets(config)`
 * instead of branching on `config.targets` themselves.
 */
export function resolveTargets(config: SdlcConfig): readonly Target[] {
  if (config.targets && config.targets.length > 0) return config.targets;
  return [
    {
      name: 'default',
      stack: config.stack,
      working_directory: config.working_directory,
      source_dirs: config.source_dirs,
      production_url_secret: config.production_url_secret,
      devaudit: config.devaudit,
    },
  ];
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
