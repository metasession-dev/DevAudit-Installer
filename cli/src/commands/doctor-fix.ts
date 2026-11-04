import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Proposal } from '../lib/doctor-types.js';
import type { StepResult } from '../install/types.js';
import * as prompts from '../lib/prompt.js';
import { loadConfigContext, planConfigChange, writeConfigValue } from './configure.js';
import { readPendingTickets } from '../lib/release-tickets.js';
import { DevAuditApiError, viewerKeyRefusal } from '../lib/devaudit-api.js';
import { parseDotenv } from '../lib/credentials-check.js';
import { issueOwnViewerKey } from '../lib/viewer-key-issue.js';
import { VIEWER_KEYS_FILE } from '../lib/paths.js';
import { applyAgentPermissions, planApply, settingsPathFor, type ApplyScope } from '../lib/agent-permissions.js';
import { saveViewerKey, viewerKeyName } from '../lib/viewer-keys.js';
import { addPredecessor, clearReleaseIntent, setReleaseIntent, setRtmStatus } from '../lib/ticket-edit.js';
import {
  DeferralApiError,
  DeferralCredentialError,
  deferRelease,
  resolveDeferralCredential,
  resumeRelease,
  type DeferralCredential,
  type DeferralResult,
} from '../lib/release-deferral-api.js';

/**
 * devaudit-installer#956 phase 3b — `devaudit doctor --fix`.
 *
 * Tiers (from the proposal's `remediation.tier`):
 *  - A  local + reversible repo edits (ticket field, RTM row, predecessor
 *       line). Applied after a confirmation, or with `--yes`.
 *  - B  portal state change (defer/resume). Needs the operator's PAT, a typed
 *       reason AND an explicit confirmation at an interactive terminal: `--yes`
 *       never authorises it and there is no non-interactive path (#1099 WP5);
 *       use the portal UI instead. Never uses API/viewer keys (see
 *       release-deferral-api.ts).
 *  - C  git history / code: never executed, commands are printed.
 *
 * Non-interactive (`--json`, no TTY, `CI`): never prompts; a proposal that the
 * flags do not authorise stays `unapplied`, which makes `--fix` exit non-zero.
 * `--dry-run` prints `planned` steps and changes nothing (exit 0).
 */

export const FIX_EXIT_UNAPPLIED = 8;

export interface FixOptions {
  readonly yes: boolean;
  readonly reason?: string;
  readonly dryRun: boolean;
  readonly json: boolean;
}

export type FixStatus = 'applied' | 'unchanged' | 'planned' | 'unapplied' | 'failed' | 'reported';

export interface FixOutcome {
  readonly id: string;
  readonly check: string;
  readonly subject: string;
  readonly tier: 'A' | 'B' | 'C';
  readonly status: FixStatus;
  readonly message: string;
  /** Portal audit data returned by a defer (`uat_approval_ids_at_defer`). */
  readonly uatApprovalIdsAtDefer?: readonly string[];
}

export interface FixReport {
  readonly dryRun: boolean;
  readonly outcomes: readonly FixOutcome[];
  /** Proposals that still need an operator decision (tier C guidance excluded). */
  readonly unapplied: number;
}

export interface FixDeps {
  readonly repoRoot: string;
  /** Base URL from sdlc-config.json (`devaudit.base_url`); falls back to the credential's. */
  readonly baseUrl: string;
  readonly credential?: () => Promise<DeferralCredential>;
  readonly defer?: typeof deferRelease;
  readonly resume?: typeof resumeRelease;
  readonly ask?: Pick<typeof prompts, 'confirm' | 'input' | 'select' | 'nonInteractiveReason'>;
  /** Tier C: lists commit subjects for a REQ in develop but not main. */
  readonly commitsFor?: (req: string) => Promise<string[]>;
  /** Test seams for the viewer-key repairs (#1099 WP3b). */
  readonly issueViewerKey?: typeof issueOwnViewerKey;
  readonly viewerKeyName?: (cwd: string) => Promise<string>;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function editFile(path: string, edit: (c: string) => string | null): Promise<'changed' | 'unchanged' | 'missing'> {
  const cur = await readText(path);
  if (cur === null) return 'missing';
  const next = edit(cur);
  if (next === null) return 'unchanged';
  await fs.writeFile(path, next);
  return 'changed';
}

/** Mark a ticket deferred and flip its RTM row; returns a list of what changed. */
async function markDeferredLocally(repoRoot: string, version: string, ticketRel: string, reason: string): Promise<string[]> {
  const done: string[] = [];
  const t = await editFile(join(repoRoot, ticketRel), (c) => setReleaseIntent(c, reason));
  if (t === 'changed') done.push(`${ticketRel}: Release intent set`);
  if (t === 'missing') throw new Error(`${ticketRel} not found`);
  const r = await editFile(join(repoRoot, 'compliance', 'RTM.md'), (c) => setRtmStatus(c, version, 'DEFERRED'));
  if (r === 'changed') done.push(`compliance/RTM.md: ${version} -> DEFERRED`);
  return done;
}

export async function runFix(
  proposals: readonly Proposal[],
  deps: FixDeps,
  opts: FixOptions,
): Promise<FixReport> {
  const ask = deps.ask ?? prompts;
  const out: FixOutcome[] = [];
  const json = opts.json;
  const nonInteractive = ask.nonInteractiveReason(json);

  const mk = (p: Proposal, status: FixStatus, message: string, extra: Partial<FixOutcome> = {}): FixOutcome => ({
    id: p.remediation.id,
    check: p.check,
    subject: p.subject,
    tier: p.remediation.tier,
    status,
    message,
    ...extra,
  });

  /** Tier A gate: `--yes`, else a confirmation. */
  const authoriseA = async (p: Proposal): Promise<{ ok: boolean; why: string }> => {
    if (opts.yes) return { ok: true, why: '' };
    const answer = await ask.confirm(`${p.remediation.summary}?`, { json });
    if (answer === true) return { ok: true, why: '' };
    return {
      ok: false,
      why: answer === false ? 'declined' : `not confirmed (${nonInteractive ?? 'cancelled'}; pass --yes to accept)`,
    };
  };

  /** Tier B gate: typed reason + explicit confirmation, interactive terminal only. */
  const authoriseB = async (p: Proposal, verb: string): Promise<{ reason: string | null; why: string }> => {
    if (nonInteractive) {
      return { reason: null, why: `portal changes need an interactive terminal and a typed confirmation (${nonInteractive}); run \`devaudit doctor --fix\` at a terminal or use the portal UI` };
    }
    // `--reason` supplies the text; the terminal confirmation below is still required.
    const reason = opts.reason?.trim() || (await ask.input(`Reason for ${verb} ${p.subject}`, { json }))?.trim() || null;
    if (!reason) return { reason: null, why: 'needs a typed reason' };
    const answer = await ask.confirm(`${p.remediation.summary}, with reason "${reason}"?`, { json });
    return answer === true ? { reason, why: '' } : { reason: null, why: answer === false ? 'declined' : 'not confirmed' };
  };

  const portalCall = async (
    p: Proposal,
    verb: 'defer' | 'resume',
    reason: string,
    extra: { toVersion?: string; untilDate?: string } = {},
  ): Promise<{ result: DeferralResult } | { failed: string }> => {
    const releaseId = p.remediation.data?.['releaseId'];
    if (!releaseId) return { failed: 'no portal release id in the proposal (is the portal reachable with the viewer key?)' };
    try {
      const cred = await (deps.credential ?? resolveDeferralCredential)();
      const ctx = { baseUrl: deps.baseUrl || cred.baseUrl, token: cred.token };
      const result =
        verb === 'defer'
          ? await (deps.defer ?? deferRelease)(ctx, releaseId, { reason, ...extra })
          : await (deps.resume ?? resumeRelease)(ctx, releaseId, reason);
      return { result };
    } catch (err) {
      if (err instanceof DeferralCredentialError || err instanceof DeferralApiError) return { failed: err.message };
      return { failed: 'unexpected error calling the portal' };
    }
  };

  const approvalNote = (ids: readonly string[]): string =>
    ids.length > 0 ? ` (portal audit uat_approval_ids_at_defer: ${ids.join(', ')})` : '';

  /**
   * Resume the portal release, then undo the local deferral. Shared by the stale-deferral
   * decision (D5) and the undeclared-deferral decision (D2, #1083). Resume returns the
   * release to draft; it does not restore the UAT approvals the defer superseded.
   */
  const resumeAndClean = async (p: Proposal, d: Readonly<Record<string, string>>): Promise<FixOutcome> => {
    const g = await authoriseB(p, 'resuming');
    if (!g.reason) return mk(p, 'unapplied', g.why);
    const c = await portalCall(p, 'resume', g.reason);
    if ('failed' in c) return mk(p, 'failed', c.failed);
    // Resume returns the portal release to draft. The ticket field is the
    // sole declaration, so clear it (else D1 would re-propose deferring).
    // The RTM row goes back to TESTED - PENDING SIGN-OFF: only a finished
    // REQ (Phase 3 sets that status) can have its release PR closed and
    // be deferred, so that is the status it had before (#984).
    const notes = ['portal release resumed (back to draft)'];
    const ticket = d['ticketPath'] ? join(deps.repoRoot, d['ticketPath']) : null;
    if (ticket && (await editFile(ticket, clearReleaseIntent)) === 'changed') notes.push(`${d['ticketPath']}: Release intent removed`);
    const rtm = await editFile(join(deps.repoRoot, 'compliance', 'RTM.md'), (cur) => setRtmStatus(cur, d['version'] ?? p.subject, 'TESTED - PENDING SIGN-OFF', 'DEFERRED'));
    if (rtm === 'changed') notes.push(`compliance/RTM.md: ${d['version']} DEFERRED -> TESTED - PENDING SIGN-OFF`);
    return mk(p, 'applied', notes.join('; '));
  };

  for (const p of proposals) {
    const r = p.remediation;
    const d = r.data ?? {};
    try {
      // ---- Tier C: guidance only ------------------------------------------
      if (r.tier === 'C') {
        out.push(mk(p, 'reported', r.plan.join('; ')));
        continue;
      }

      if (opts.dryRun) {
        out.push(mk(p, 'planned', `would apply (tier ${r.tier}): ${r.plan.join('; ')}`));
        continue;
      }

      switch (r.id) {
        case 'set-config': {
          // devaudit-installer#1040: same validation as `devaudit configure set`.
          const key = d['key'] ?? '';
          const value = d['value'] ?? '';
          const ctx = await loadConfigContext(deps.repoRoot);
          const plan = await planConfigChange(ctx, key, value, { detection: null });
          if (plan.errors.length > 0) { out.push(mk(p, 'failed', plan.errors.join('; '))); break; }
          if (JSON.stringify(plan.before) === JSON.stringify(plan.after)) { out.push(mk(p, 'unchanged', `${key} is already ${value}`)); break; }
          const a = await authoriseA(p);
          if (!a.ok) { out.push(mk(p, 'unapplied', a.why)); break; }
          await writeConfigValue(ctx, key, plan.after);
          const next = ['run `devaudit update` to regenerate the workflows', ...plan.followUps];
          out.push(mk(p, 'applied', `sdlc-config.json ${key}: ${JSON.stringify(plan.before)} -> ${JSON.stringify(plan.after)}; ${next.join('; ')}`));
          break;
        }
        case 'apply-agent-permissions': {
          // DevAudit-Installer#1116 WP13: the same function as `devaudit agent-permissions apply`.
          const scope = (d['scope'] ?? 'user') as ApplyScope;
          const path = settingsPathFor(scope, deps.repoRoot);
          const plan = await planApply(path, false);
          if (plan.refusal) { out.push(mk(p, 'failed', plan.refusal)); break; }
          if (plan.toAdd.length === 0) { out.push(mk(p, 'unchanged', `all rules are already in ${path}`)); break; }
          const a = await authoriseA(p);
          if (!a.ok) { out.push(mk(p, 'unapplied', a.why)); break; }
          const r = await applyAgentPermissions(path, false);
          out.push(mk(p, r.status === 'refused' ? 'failed' : 'applied', r.message));
          break;
        }
        case 'move-viewer-key': {
          // #1099 WP3b (tier A): a viewer key found only in .env moves to the CLI config folder. The
          // .env line is removed after confirmation; nothing else in .env is touched.
          const envPath = join(deps.repoRoot, '.env');
          const content = await readText(envPath);
          const value = content === null ? null : parseDotenv(content, 'DEVAUDIT_VIEWER_API_KEY');
          if (content === null || !value) { out.push(mk(p, 'unchanged', 'no DEVAUDIT_VIEWER_API_KEY in .env')); break; }
          const slug = d['slug'] ?? '';
          if (!slug || !deps.baseUrl) { out.push(mk(p, 'failed', 'no project slug / base_url in sdlc-config.json to save the key under')); break; }
          const a = await authoriseA(p);
          if (!a.ok) { out.push(mk(p, 'unapplied', a.why)); break; }
          await saveViewerKey(deps.baseUrl, slug, { key: value, name: await (deps.viewerKeyName ?? viewerKeyName)(deps.repoRoot), createdAt: new Date().toISOString() });
          const kept = content.split(/\r?\n/).filter((l) => !/^\s*(?:export\s+)?DEVAUDIT_VIEWER_API_KEY\s*=/.test(l));
          await fs.writeFile(envPath, kept.join('\n'));
          out.push(mk(p, 'applied', `viewer key saved to ${VIEWER_KEYS_FILE} and its line removed from .env`));
          break;
        }
        case 'issue-viewer-key': {
          // #1099 WP3b (tier B): the person's own named viewer key, issued with their PAT. Interactive
          // terminal, typed reason and confirmation like every tier B change.
          const g = await authoriseB(p, 'issuing a viewer key for');
          if (!g.reason) { out.push(mk(p, 'unapplied', g.why)); break; }
          const slug = d['slug'] ?? '';
          if (!slug) { out.push(mk(p, 'failed', 'no project slug in sdlc-config.json')); break; }
          let name = '';
          try {
            const cred = await (deps.credential ?? resolveDeferralCredential)();
            const baseUrl = deps.baseUrl || cred.baseUrl;
            name = await (deps.viewerKeyName ?? viewerKeyName)(deps.repoRoot);
            const issue = deps.issueViewerKey ?? issueOwnViewerKey;
            let res = await issue({ baseUrl, token: cred.token, slug, name, revokeExisting: false });
            if (res.kind === 'exists-live') {
              const revoke = await ask.confirm(`A live portal key named '${name}' exists but is not usable on this machine (its value cannot be recovered). Revoke it and issue a new one?`, { json });
              if (revoke !== true) { out.push(mk(p, 'unapplied', `a live key '${name}' exists; revoke it in the portal or confirm replacing it`)); break; }
              res = await issue({ baseUrl, token: cred.token, slug, name, revokeExisting: true });
            }
            if (res.kind === 'project-not-found') { out.push(mk(p, 'failed', `project '${slug}' was not found on the portal for this token`)); break; }
            if (res.kind !== 'issued') { out.push(mk(p, 'failed', 'could not issue the viewer key')); break; }
            out.push(mk(p, 'applied', `issued '${name}'${res.revoked ? ' (revoked the previous key of that name)' : ''} and saved to ${VIEWER_KEYS_FILE}; reason: ${g.reason}`));
          } catch (err) {
            if (err instanceof DeferralCredentialError) { out.push(mk(p, 'failed', err.message)); break; }
            if (err instanceof DevAuditApiError) {
              out.push(mk(p, 'failed', viewerKeyRefusal(err, name)));
              break;
            }
            throw err;
          }
          break;
        }
        case 'resolve-undeclared-deferral': {
          // #1083 — a portal deferral that no ticket declares may be a mistake. Recording it in
          // the repo would make a mistake permanent, so it is a decision, never a default:
          // `--yes` (even with `--reason`) given for another proposal must not decide it.
          if (nonInteractive) {
            out.push(mk(p, 'unapplied', `an undeclared portal deferral needs an interactive decision (record / resume / leave; ${nonInteractive})`));
            break;
          }
          const decision = await ask.select(`${p.subject}: ${p.detail}. What now?`, [
            { value: 'record', label: 'Record: the deferral was intended (ticket Release intent + RTM DEFERRED)' },
            { value: 'resume', label: 'Resume: the deferral was a mistake (portal back to draft; superseded UAT approvals are not restored)' },
            { value: 'leave', label: 'Leave it as it is' },
          ], { json });
          if (decision === 'record') {
            const done = await markDeferredLocally(deps.repoRoot, d['version'] ?? p.subject, d['ticketPath'] ?? '', d['reason'] ?? '');
            out.push(done.length > 0 ? mk(p, 'applied', done.join('; ')) : mk(p, 'unchanged', 'ticket and RTM already marked deferred'));
          } else if (decision === 'resume') {
            out.push(await resumeAndClean(p, d));
          } else {
            out.push(mk(p, 'unapplied', 'no change: the portal release stays deferred and the ticket stays undeclared'));
          }
          break;
        }
        case 'fix-absorbed-predecessors': {
          const a = await authoriseA(p);
          if (!a.ok) { out.push(mk(p, 'unapplied', a.why)); break; }
          const res = await editFile(join(deps.repoRoot, d['ticketPath'] ?? ''), (c) => addPredecessor(c, d['candidate'] ?? ''));
          out.push(
            res === 'changed' ? mk(p, 'applied', `${d['ticketPath']}: ${d['candidate']} added under Absorbed predecessor releases`)
            : res === 'unchanged' ? mk(p, 'unchanged', `${d['candidate']} already listed`)
            : mk(p, 'failed', `${d['ticketPath']} not found`),
          );
          break;
        }
        case 'list-deferred-predecessor': {
          const tickets = (await readPendingTickets(deps.repoRoot)) ?? [];
          const next = tickets.filter((t) => !t.deferred);
          const req = d['deferred'] ?? p.subject;
          if (next.length !== 1 || !next[0]) {
            out.push(mk(p, 'unapplied', next.length === 0
              ? `no next release ticket exists yet: create it, then list ${req} under "Absorbed predecessor releases"`
              : `${next.length} candidate release tickets (${next.map((t) => t.version).join(', ')}): list ${req} in the right one by hand`));
            break;
          }
          const a = await authoriseA(p);
          if (!a.ok) { out.push(mk(p, 'unapplied', a.why)); break; }
          const res = await editFile(next[0].path, (c) => addPredecessor(c, req));
          out.push(res === 'changed' ? mk(p, 'applied', `${next[0].version}: ${req} added under Absorbed predecessor releases`) : mk(p, 'unchanged', `${req} already listed`));
          break;
        }
        case 'defer-portal-release': {
          const g = await authoriseB(p, 'deferring');
          if (!g.reason) { out.push(mk(p, 'unapplied', g.why)); break; }
          const c = await portalCall(p, 'defer', g.reason);
          if ('failed' in c) { out.push(mk(p, 'failed', c.failed)); break; }
          out.push(mk(p, 'applied', `portal release deferred${approvalNote(c.result.uatApprovalIdsAtDefer)}`, { uatApprovalIdsAtDefer: c.result.uatApprovalIdsAtDefer }));
          break;
        }
        case 'resume-stale-deferral': {
          // #984 — a stale deferral is a decision (resume / extend / abandon),
          // never a default: `--yes --reason` given for another proposal must
          // not resume every stale deferral, so non-interactive runs leave it
          // unapplied.
          if (nonInteractive) {
            out.push(mk(p, 'unapplied', `stale deferral needs an interactive decision (resume / extend / abandon; ${nonInteractive})`));
            break;
          }
          const decision = await ask.select(`${p.subject}: ${p.detail}. What now?`, [
            { value: 'resume', label: 'Resume (portal back to draft, ticket Release intent removed)' },
            { value: 'extend', label: 'Extend (guidance only)' },
            { value: 'abandon', label: 'Abandon (guidance only)' },
          ], { json });
          if (decision !== 'resume') {
            out.push(mk(p, 'unapplied', decision === 'extend'
              ? 'extend is not performed by this tool: re-review on the portal and set a new review-by date'
              : decision === 'abandon'
                ? 'abandon is not performed by this tool: close the release out as abandoned (see the sdlc-implementer skill)'
                : 'no decision taken'));
            break;
          }
          out.push(await resumeAndClean(p, d));
          break;
        }
        case 'resolve-closed-release-pr': {
          let choice: string | null = null;
          if (!nonInteractive) choice = await ask.select(`${p.subject}: release PR #${d['prNumber']} was closed unmerged. What now?`, [
            { value: 'defer', label: 'Defer to the next release (ticket field + portal defer)' },
            { value: 'abandon', label: 'Abandon (guidance only)' },
            { value: 'reopen', label: `Reopen PR #${d['prNumber']} (guidance only)` },
          ], { json });
          if (choice === 'abandon' || choice === 'reopen') {
            out.push(mk(p, 'unapplied', choice === 'abandon'
              ? 'abandon is not performed by this tool: close the release out as abandoned (see the sdlc-implementer skill)'
              : `reopen is not performed by this tool: gh pr reopen ${d['prNumber']}`));
            break;
          }
          if (choice !== 'defer') {
            out.push(mk(p, 'unapplied', `needs a decision (${nonInteractive ?? 'cancelled'}); portal changes are interactive-only`));
            break;
          }
          const g = await authoriseB(p, 'deferring');
          if (!g.reason) { out.push(mk(p, 'unapplied', g.why)); break; }
          const local = await markDeferredLocally(deps.repoRoot, d['version'] ?? p.subject, d['ticketPath'] ?? '', g.reason);
          const c = await portalCall(p, 'defer', g.reason);
          if ('failed' in c) { out.push(mk(p, 'failed', `local edits applied (${local.join('; ') || 'already in place'}) but the portal defer failed: ${c.failed}`)); break; }
          out.push(mk(p, 'applied', `${[...local, 'portal release deferred'].join('; ')}${approvalNote(c.result.uatApprovalIdsAtDefer)}`, { uatApprovalIdsAtDefer: c.result.uatApprovalIdsAtDefer }));
          break;
        }
        default:
          // e.g. close-out-release: a script with git moves; the tool prints it, never runs it.
          out.push(mk(p, 'unapplied', `not auto-applied: ${r.plan.join('; ')}`));
      }
    } catch (err) {
      out.push(mk(p, 'failed', err instanceof Error ? err.message : 'unexpected error'));
    }
  }

  // Tier C guidance for deferred REQs that will ship unapproved: print the
  // commands, never run them.
  for (const p of proposals) {
    if (p.remediation.id !== 'list-deferred-predecessor' || !deps.commitsFor) continue;
    const req = p.remediation.data?.['deferred'] ?? p.subject;
    const subjects = await deps.commitsFor(req).catch(() => [] as string[]);
    if (subjects.length === 0) continue;
    out.push({
      id: 'revert-deferred-commits',
      check: p.check,
      subject: req,
      tier: 'C',
      status: 'reported',
      message: `alternative to listing ${req} as a predecessor (never run by this tool): git revert <sha> for each of: ${subjects.join(' | ')}`,
    });
  }

  const unapplied = opts.dryRun ? 0 : out.filter((o) => o.tier !== 'C' && (o.status === 'unapplied' || o.status === 'failed')).length;
  return { dryRun: opts.dryRun, outcomes: out, unapplied };
}

/** Human-readable lines for the report, reusing the install StepResult vocabulary. */
export function toStepResults(report: FixReport): StepResult[] {
  return report.outcomes.map((o) => ({
    step: `${o.tier}:${o.id} ${o.subject}`,
    status:
      o.status === 'applied' || o.status === 'unchanged' ? 'ok'
      : o.status === 'planned' ? 'planned'
      : o.status === 'reported' ? 'skipped'
      : o.status === 'failed' ? 'fail'
      : 'warn',
    message: o.message,
  }));
}
