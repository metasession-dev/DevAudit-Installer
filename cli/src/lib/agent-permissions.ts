import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { CLAUDE_HOME, CONFIG_FILE } from './paths.js';

/**
 * devaudit-installer#1098 — recommended agent permission rules: stop an agent session reaching the
 * personal access token (PAT), even if the skill text is ignored or a prompt is injected.
 *
 * This is layer 4 of the credential model (docs/credentials.md). It is RECOMMENDED, not required,
 * and defence in depth, not a sandbox: a permission rule matches the command text the agent writes,
 * so `/usr/bin/devaudit ...`, `sh -c '...'` or `node cli/bin/devaudit.js ...` are not matched (the
 * Claude Code permissions page says so itself). The installer never writes a user's agent settings;
 * `devaudit doctor` only reports whether the rules are present.
 *
 * The rule syntax below was verified against the Claude Code permissions documentation and by
 * running headless sessions (scripts/agent-permissions-smoke.sh, docs/agent-permissions.md).
 */

/** Subcommands that use the PAT or change portal state: an agent never runs these (docs/credentials.md). */
export const PAT_COMMAND_PATTERNS: readonly string[] = [
  'install*',
  'join*',
  'uninstall*',
  'auth *',
  'doctor *--fix*',
  'doctor *--fleet*',
];

/**
 * Program prefixes the CLI is run under. `devaudit` and `npx ... @metasession.co/devaudit-cli`;
 * global flags may sit between the program and the subcommand (`devaudit --json doctor --fix`).
 */
const PROGRAM_PREFIXES: readonly string[] = ['devaudit', 'npx *devaudit-cli'];

/** Credential-store locations, per operating system (env-paths: config dir of the app `devaudit`). */
export const CREDENTIAL_STORE_READ_RULES: readonly string[] = [
  'Read(~/.config/devaudit/**)', // Linux (XDG_CONFIG_HOME defaults to ~/.config)
  'Read(~/Library/Preferences/devaudit/**)', // macOS
  'Read(//**/AppData/Roaming/devaudit/**)', // Windows (%APPDATA%\devaudit)
];

export function patCommandRules(): string[] {
  const rules: string[] = [];
  for (const program of PROGRAM_PREFIXES) {
    for (const pattern of PAT_COMMAND_PATTERNS) {
      rules.push(`Bash(${program} ${pattern})`);
      rules.push(`Bash(${program} * ${pattern})`);
    }
  }
  return rules;
}

/** Every recommended Claude Code deny rule, in a stable order. */
export function claudeCodeDenyRules(): string[] {
  return [...patCommandRules(), ...CREDENTIAL_STORE_READ_RULES];
}

/** The ready-to-paste settings object for `.claude/settings.json` or `~/.claude/settings.json`. */
export function claudeCodeSettingsSnippet(): { permissions: { deny: string[] } } {
  return { permissions: { deny: claudeCodeDenyRules() } };
}

export type RuleGroup = 'pat-commands' | 'credential-store';

/**
 * The opt-in `env-files` group (DevAudit-Installer#1116 WP13, decision M5): reads of `.env*` files, which
 * can hold uploader or portal keys in a consuming repository. Not part of the default rules and not
 * counted by doctor unless applied (`apply --include-env-files`); it also blocks legitimate local
 * development reads of those files.
 */
export const ENV_FILE_READ_RULES: readonly string[] = ['Read(**/.env)', 'Read(**/.env.*)'];

export interface AgentPermissionsReport {
  /** Settings files that were found and parsed (paths, never contents). */
  readonly files: readonly string[];
  readonly present: number;
  readonly total: number;
  /** Groups with at least one recommended rule missing. */
  readonly missingGroups: readonly RuleGroup[];
}

export interface AgentPermissionsDeps {
  readonly repoRoot: string;
  readonly home?: string;
  readonly readFile?: (path: string) => Promise<string | null>;
}

const defaultRead = async (path: string): Promise<string | null> => fs.readFile(path, 'utf-8').catch(() => null);

/**
 * Whether the recommended Claude Code deny rules are present in the project, local or user settings
 * (the union of their `permissions.deny` arrays: a deny at any scope applies). Reads only; a file
 * that cannot be read or parsed counts as absent.
 */
export async function agentPermissionsReport(deps: AgentPermissionsDeps): Promise<AgentPermissionsReport> {
  const read = deps.readFile ?? defaultRead;
  const home = deps.home ?? CLAUDE_HOME;
  const candidates = [
    join(deps.repoRoot, '.claude', 'settings.json'),
    join(deps.repoRoot, '.claude', 'settings.local.json'),
    join(home, '.claude', 'settings.json'),
  ];
  const denied = new Set<string>();
  const files: string[] = [];
  for (const path of candidates) {
    const text = await read(path);
    if (text === null) continue;
    try {
      const deny = (JSON.parse(text) as { permissions?: { deny?: unknown } }).permissions?.deny;
      files.push(path);
      if (Array.isArray(deny)) for (const rule of deny) if (typeof rule === 'string') denied.add(rule);
    } catch {
      // unparsable settings: treated as absent
    }
  }
  const pat = patCommandRules();
  const store = [...CREDENTIAL_STORE_READ_RULES];
  const all = [...pat, ...store];
  const missingGroups: RuleGroup[] = [];
  if (pat.some((r) => !denied.has(r))) missingGroups.push('pat-commands');
  if (store.some((r) => !denied.has(r))) missingGroups.push('credential-store');
  return { files, present: all.filter((r) => denied.has(r)).length, total: all.length, missingGroups };
}

// ---- apply (DevAudit-Installer#1116 WP13) ---------------------------------------------------------------------

export type ApplyScope = 'user' | 'project' | 'local';
export const APPLY_SCOPES: readonly ApplyScope[] = ['user', 'project', 'local'];

/** The settings file a scope writes: the only three paths `apply` ever touches. */
export function settingsPathFor(scope: ApplyScope, repoRoot: string, home: string = CLAUDE_HOME): string {
  if (scope === 'user') return join(home, '.claude', 'settings.json');
  if (scope === 'project') return join(repoRoot, '.claude', 'settings.json');
  return join(repoRoot, '.claude', 'settings.local.json');
}

export interface ApplyPlan {
  readonly path: string;
  readonly exists: boolean;
  /** Rules that would be appended to `permissions.deny`, in order. */
  readonly toAdd: readonly string[];
  readonly alreadyPresent: number;
  /** Set when the file cannot be used: it is left untouched. */
  readonly refusal?: string;
}

/** The rules `apply` writes: the recommended ones, plus `env-files` when asked. */
export function rulesToApply(includeEnvFiles: boolean): string[] {
  return [...claudeCodeDenyRules(), ...(includeEnvFiles ? ENV_FILE_READ_RULES : [])];
}

/** What `apply` would do to the file at `path`. Reads only. */
export async function planApply(path: string, includeEnvFiles: boolean): Promise<ApplyPlan> {
  const wanted = rulesToApply(includeEnvFiles);
  let text: string | null = null;
  try {
    text = await fs.readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { path, exists: false, toAdd: [], alreadyPresent: 0, refusal: `cannot read ${path}: ${(err as Error).message}` };
    }
  }
  let have: string[] = [];
  if (text !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { path, exists: true, toAdd: [], alreadyPresent: 0, refusal: `${path} is not valid JSON (${(err as Error).message}); it was left untouched` };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { path, exists: true, toAdd: [], alreadyPresent: 0, refusal: `${path} is not a JSON object; it was left untouched` };
    }
    const permissions = (parsed as { permissions?: unknown }).permissions;
    if (permissions !== undefined && (permissions === null || typeof permissions !== 'object' || Array.isArray(permissions))) {
      return { path, exists: true, toAdd: [], alreadyPresent: 0, refusal: `${path} has a "permissions" value that is not an object; it was left untouched` };
    }
    const deny = (permissions as { deny?: unknown } | undefined)?.deny;
    if (deny !== undefined && !Array.isArray(deny)) {
      return { path, exists: true, toAdd: [], alreadyPresent: 0, refusal: `${path} has a "permissions.deny" value that is not a list; it was left untouched` };
    }
    have = (deny ?? []).filter((r): r is string => typeof r === 'string');
  }
  const present = new Set(have);
  return { path, exists: text !== null, toAdd: wanted.filter((r) => !present.has(r)), alreadyPresent: wanted.filter((r) => present.has(r)).length };
}

export interface ApplyResult {
  readonly status: 'applied' | 'already-present' | 'refused';
  readonly path: string;
  readonly added: readonly string[];
  readonly backup?: string;
  readonly message: string;
}

/** The backup name beside the file: `<name>.devaudit-backup-<UTC timestamp>`. */
export function backupPathFor(path: string, now: Date = new Date()): string {
  return join(dirname(path), `${basename(path)}.devaudit-backup-${now.toISOString().replace(/[:.]/g, '-')}`);
}

/**
 * Merge the rules into `permissions.deny` of the file at `path`: existing entries are neither removed
 * nor reordered, only missing rules are appended, every other key is kept. A timestamped backup of the
 * original bytes is written first, but only when something changes; the write is atomic (a temporary
 * file renamed over the target, the file mode kept). Idempotent. `allow` and `ask` are never touched.
 */
export async function applyAgentPermissions(path: string, includeEnvFiles: boolean, now: Date = new Date()): Promise<ApplyResult> {
  const plan = await planApply(path, includeEnvFiles);
  if (plan.refusal) return { status: 'refused', path, added: [], message: plan.refusal };
  if (plan.toAdd.length === 0) return { status: 'already-present', path, added: [], message: `all ${plan.alreadyPresent} rules are already present in ${path}` };
  let original: Buffer | null = null;
  let mode = 0o600;
  try {
    original = await fs.readFile(path);
    mode = (await fs.stat(path)).mode & 0o777;
  } catch {
    original = null;
  }
  const doc: Record<string, unknown> = original === null ? {} : (JSON.parse(original.toString('utf-8')) as Record<string, unknown>);
  const permissions = { ...((doc['permissions'] as Record<string, unknown> | undefined) ?? {}) };
  const deny = Array.isArray(permissions['deny']) ? [...(permissions['deny'] as unknown[])] : [];
  permissions['deny'] = [...deny, ...plan.toAdd];
  doc['permissions'] = permissions;
  await fs.mkdir(dirname(path), { recursive: true });
  let backup: string | undefined;
  if (original !== null) {
    backup = backupPathFor(path, now);
    await fs.writeFile(backup, original, { mode });
  }
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode });
  await fs.rename(tmp, path);
  return {
    status: 'applied',
    path,
    added: plan.toAdd,
    ...(backup ? { backup } : {}),
    message: `added ${plan.toAdd.length} rule(s) to ${path}${backup ? ` (backup: ${backup})` : ''}`,
  };
}

// ---- the one-time offer ----------------------------------------------------------------------------------------

/** Whether this machine said "never" to the offer (stored in the CLI config folder, never in a repository). */
export async function offerDeclinedForever(file: string = CONFIG_FILE): Promise<boolean> {
  try {
    const cfg = JSON.parse(await fs.readFile(file, 'utf-8')) as { agentPermissionsOffer?: unknown };
    return cfg.agentPermissionsOffer === 'never';
  } catch {
    return false;
  }
}

/** Remember "never" for this machine; other keys in the file are kept. */
export async function rememberOfferNever(file: string = CONFIG_FILE): Promise<void> {
  let cfg: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) cfg = parsed as Record<string, unknown>;
  } catch {
    // no file yet
  }
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify({ ...cfg, agentPermissionsOffer: 'never' }, null, 2)}\n`);
}
