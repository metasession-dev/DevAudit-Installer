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
  /**
   * The @metasession.co/devaudit-cli version that last completed a
   * `devaudit update` sync of this project's templates. Written by
   * `stampVersion` (cli/src/update/stamp-version.ts) as the final step of
   * every sync. Consumed by sdlc-implementer's freshness check to decide
   * whether to run `devaudit update .` before starting a REQ — see
   * devaudit-installer#736. Absent means never synced by a stamping-aware
   * CLI version (treat as stale).
   */
  readonly devaudit_synced_version?: string;
  // Port the E2E dev server (started via e2e_start_command) listens on, for
  // CI's "Wait for dev server" step to poll. Defaults to 3000 (Next.js' own
  // default) when absent — override per-target (see Target.e2e_port) when a
  // target's dev script binds elsewhere, e.g. to avoid colliding with a
  // sibling target in the same polyglot-monorepo repo.
  readonly e2e_port?: string | number;
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
  readonly e2e_port?: string | number;
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
      working_directory: config.working_directory ?? '.',
      source_dirs: config.source_dirs,
      production_url_secret: config.production_url_secret,
      e2e_port: config.e2e_port,
      devaudit: {
        ...config.devaudit,
        project_slug: config.devaudit?.project_slug ?? config.project_slug,
      },
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
