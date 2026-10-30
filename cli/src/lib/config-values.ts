/**
 * DevAudit-Installer#1160 — which GitHub secrets and variables the configuration asks the generated workflows to read.
 *
 * `sdlc-config.json` env maps (`e2e_env`, `app_env`, ...) may hold `${{ secrets.NAME }}` or `${{ vars.NAME }}`. GitHub reads a
 * name that does not exist, or is not visible to the job (it lives only in an environment, or the pull request comes from a
 * fork or Dependabot), as an empty string and does not fail. The generated workflows therefore check the values that matter
 * before the dev server starts (`scripts/check-config-values.sh`), and `devaudit doctor` checks that each name exists.
 *
 * Only an entry that is exactly one reference counts. `${{ secrets.X || '' }}`, a literal, or a longer expression is left
 * alone: that is how a value that may be empty is written.
 */

/** The configuration maps whose values reach a generated workflow as environment variables. */
export const ENV_MAPS = ['app_env', 'build_env', 'e2e_env', 'database_env', 'typescript_check_env'] as const;
export type EnvMap = (typeof ENV_MAPS)[number];

export interface ValueRef {
  readonly map: EnvMap;
  /** The environment variable the job should have. */
  readonly env: string;
  readonly kind: 'secrets' | 'vars';
  /** The secret or variable it is read from. */
  readonly source: string;
}

const REFERENCE = /^\$\{\{\s*(secrets|vars)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function refsOf(cfg: Record<string, unknown>, map: EnvMap): ValueRef[] {
  const raw = cfg[map];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  const refs: ValueRef[] = [];
  for (const [env, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ENV_NAME.test(env) || typeof value !== 'string') continue;
    const m = REFERENCE.exec(value.trim());
    if (m) refs.push({ map, env, kind: m[1] as 'secrets' | 'vars', source: m[2]! });
  }
  return refs;
}

/** Every single-reference entry of the given maps, in map order. */
export function referencedValues(cfg: Record<string, unknown>, maps: readonly EnvMap[] = ENV_MAPS): ValueRef[] {
  return maps.flatMap((map) => refsOf(cfg, map));
}

/**
 * The entries the pre-flight step checks for a workflow whose dev server reads `maps` (later maps win on a shared key, as
 * the generated `env:` blocks do).
 */
export function preflightValues(cfg: Record<string, unknown>, maps: readonly EnvMap[]): ValueRef[] {
  const byEnv = new Map<string, ValueRef>();
  for (const map of maps) {
    const raw = cfg[map];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    for (const env of Object.keys(raw as Record<string, unknown>)) byEnv.delete(env);
    for (const ref of refsOf(cfg, map)) byEnv.set(ref.env, ref);
  }
  return [...byEnv.values()];
}

export interface WorkflowRef {
  readonly kind: 'secrets' | 'vars';
  readonly source: string;
}

const SOURCE_REF = /(?<![A-Za-z0-9_.])(secrets|vars)\.([A-Za-z_][A-Za-z0-9_]*)/g;
const CONDITIONAL = ['||', '&&', '==', '!='];

/**
 * The secrets and variables a workflow file reads through a bare `${{ secrets.X }}` / `${{ vars.X }}`. An expression with a
 * fallback or a comparison (`${{ secrets.X || github.token }}`, `${{ secrets.X != '' }}`) names a value that may be absent, so
 * it is left out. `secrets.GITHUB_TOKEN` and `secrets.inherit` are not repository secrets either.
 */
export function workflowReferences(text: string): WorkflowRef[] {
  const found = new Map<string, WorkflowRef>();
  let from = 0;
  for (;;) {
    const open = text.indexOf('${{', from);
    if (open === -1) break;
    const close = text.indexOf('}}', open + 3);
    if (close === -1) break;
    from = close + 2;
    const expression = text.slice(open + 3, close);
    if (CONDITIONAL.some((op) => expression.includes(op))) continue;
    for (const m of expression.matchAll(SOURCE_REF)) {
      const kind = m[1] as 'secrets' | 'vars';
      const source = m[2]!;
      if (kind === 'secrets' && (source === 'GITHUB_TOKEN' || source === 'inherit')) continue;
      found.set(`${kind}.${source}`, { kind, source });
    }
  }
  return [...found.values()];
}

/**
 * Names DevAudit itself manages (the portal key and its variables, the production URL, the dispatch token): other doctor checks
 * report those, so the workflow scan does not report them a second time. `api_key_secret` and `production_url_secret` name the
 * secrets the project chose.
 */
export function isManagedName(cfg: Record<string, unknown>, source: string): boolean {
  if (source.startsWith('DEVAUDIT_') || source === 'INSTALLER_DISPATCH_TOKEN') return true;
  const chosen = [cfg['api_key_secret'], cfg['production_url_secret'], (cfg['devaudit'] as { api_key_secret?: unknown } | undefined)?.api_key_secret];
  return chosen.some((c) => c === source);
}

/** The argument the script takes for one entry: `<map>.<ENV_NAME>=<secrets|vars>.<SOURCE_NAME>`. */
export const preflightArg = (ref: ValueRef): string => `${ref.map}.${ref.env}=${ref.kind}.${ref.source}`;
