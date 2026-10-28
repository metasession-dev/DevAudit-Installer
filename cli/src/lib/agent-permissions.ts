import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
  const home = deps.home ?? homedir();
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
