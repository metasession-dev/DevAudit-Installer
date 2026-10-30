import { logger, isJsonMode, emitJsonResult } from '../lib/logger.js';
import { resolveRepoRoot } from '../lib/git-root.js';
import * as prompts from '../lib/prompt.js';
import {
  APPLY_SCOPES,
  agentPermissionsReport,
  applyAgentPermissions,
  offerDeclinedForever,
  planApply,
  rememberOfferNever,
  rulesToApply,
  settingsPathFor,
  type ApplyScope,
} from '../lib/agent-permissions.js';

/**
 * DevAudit-Installer#1116 WP13 (#1127) — `devaudit agent-permissions apply`: add the recommended Claude Code
 * deny rules (docs/agent-permissions.md) to a settings file, after a confirmation.
 *
 * Exit codes: 0 applied or already present; 1 the settings file could not be read, parsed or written
 * (it is left untouched); 2 an invalid flag; 8 not applied (declined, or non-interactive without `--yes`).
 * An agent never runs this: the skills tell the operator to.
 */

export const APPLY_EXIT_FAILED = 1;
export const APPLY_EXIT_INVALID = 2;
export const APPLY_EXIT_UNAPPLIED = 8;

export interface ApplyOptions {
  readonly scope?: string;
  readonly yes?: boolean;
  readonly includeEnvFiles?: boolean;
}

export interface ApplyDeps {
  readonly cwd?: string;
  readonly home?: string;
  readonly ask?: Pick<typeof prompts, 'confirm' | 'nonInteractiveReason'>;
  readonly say?: (line: string) => void;
}

const SCOPE_NOTE: Readonly<Record<ApplyScope, string>> = {
  user: 'your user settings (all your projects; the stronger scope, because an agent that can edit a project file could weaken a rule there)',
  project: 'this project\'s shared settings (everyone who can commit can change them, so this is weaker)',
  local: 'your local settings for this project (just you)',
};

export async function runAgentPermissionsApply(options: ApplyOptions, deps: ApplyDeps = {}): Promise<number> {
  const log = logger();
  const say = deps.say ?? ((l: string) => log.log(l));
  const ask = deps.ask ?? prompts;
  const json = isJsonMode();
  const scope = options.scope ?? 'user';
  if (!(APPLY_SCOPES as readonly string[]).includes(scope)) {
    log.error(`--scope must be one of ${APPLY_SCOPES.join(', ')} (got "${scope}").`);
    return APPLY_EXIT_INVALID;
  }
  const sc = scope as ApplyScope;
  const repoRoot = sc === 'user' ? (deps.cwd ?? process.cwd()) : await resolveRepoRoot(deps.cwd ?? process.cwd());
  const path = settingsPathFor(sc, repoRoot, deps.home);
  const plan = await planApply(path, Boolean(options.includeEnvFiles));
  if (plan.refusal) {
    log.error(plan.refusal);
    if (json) emitJsonResult({ status: 'refused', scope: sc, path, message: plan.refusal });
    return APPLY_EXIT_FAILED;
  }
  if (plan.toAdd.length === 0) {
    const message = `already present: all ${plan.alreadyPresent} rules are in ${path}; nothing written, no backup made`;
    if (json) emitJsonResult({ status: 'already-present', scope: sc, path, added: [] });
    else log.success(message);
    return 0;
  }
  if (!json) {
    say(`Scope ${sc}: ${SCOPE_NOTE[sc]}.`);
    say(`File: ${path}${plan.exists ? '' : ' (will be created)'}`);
    say(`${plan.toAdd.length} of ${rulesToApply(Boolean(options.includeEnvFiles)).length} rules would be added to permissions.deny:`);
    for (const rule of plan.toAdd) say(`  + ${rule}`);
    say('Nothing else in the file changes; a timestamped backup is written beside it first.');
  }
  if (!options.yes) {
    const why = ask.nonInteractiveReason(json);
    if (why) {
      const message = `not applied: asking needs a terminal (${why}); run it in a terminal, or pass --yes`;
      if (json) emitJsonResult({ status: 'unapplied', scope: sc, path, message });
      else log.warn(message);
      return APPLY_EXIT_UNAPPLIED;
    }
    const answer = await ask.confirm(`Add these ${plan.toAdd.length} rules to ${path}?`, { json });
    if (answer !== true) {
      if (json) emitJsonResult({ status: 'unapplied', scope: sc, path, message: 'declined' });
      else log.warn('not applied');
      return APPLY_EXIT_UNAPPLIED;
    }
  }
  const result = await applyAgentPermissions(path, Boolean(options.includeEnvFiles));
  if (result.status === 'refused') {
    log.error(result.message);
    return APPLY_EXIT_FAILED;
  }
  if (json) emitJsonResult({ status: result.status, scope: sc, path, added: result.added, ...(result.backup ? { backup: result.backup } : {}) });
  else log.success(result.message);
  return 0;
}

/**
 * The one-time offer after `install`, `join` and `update`: "Add the recommended agent protection rules to your
 * user settings? [Y/n/never]". Silent with no TTY, in CI, with `--dry-run` or `--json`, when this machine said
 * "never", and when every rule is already present. Nothing is written without a confirmation.
 */
export async function offerAgentPermissions(
  opts: { readonly dryRun?: boolean; readonly cwd?: string },
  deps: { readonly home?: string; readonly configFile?: string; readonly ask?: Pick<typeof prompts, 'select' | 'nonInteractiveReason'>; readonly say?: (line: string) => void } = {},
): Promise<'applied' | 'declined' | 'never' | 'skipped'> {
  const ask = deps.ask ?? prompts;
  if (opts.dryRun || ask.nonInteractiveReason(isJsonMode())) return 'skipped';
  if (await offerDeclinedForever(deps.configFile)) return 'skipped';
  const root = await resolveRepoRoot(opts.cwd ?? process.cwd()).catch(() => opts.cwd ?? process.cwd());
  const report = await agentPermissionsReport({ repoRoot: root, ...(deps.home ? { home: deps.home } : {}) });
  if (report.missingGroups.length === 0) return 'skipped';
  const log = logger();
  const say = deps.say ?? ((l: string) => log.log(l));
  say('');
  say('Agent protection rules (recommended, not required): they keep an AI agent session away from your personal access token.');
  say('See docs/agent-permissions.md. Nothing is written unless you say yes.');
  const answer = await ask.select('Add the recommended agent protection rules to your user settings?', [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'Not now' },
    { value: 'never', label: 'Never ask again on this machine' },
  ]);
  if (answer === 'never') {
    await rememberOfferNever(deps.configFile);
    return 'never';
  }
  if (answer !== 'yes') return 'declined';
  const result = await applyAgentPermissions(settingsPathFor('user', root, deps.home), false);
  if (result.status === 'refused') log.warn(result.message);
  else log.success(result.message);
  return result.status === 'refused' ? 'declined' : 'applied';
}
