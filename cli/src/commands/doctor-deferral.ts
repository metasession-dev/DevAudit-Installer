import { execa } from 'execa';
import type { CheckResult, Finding } from '../lib/doctor-types.js';
import {
  commitsInRange,
  defaultSinceRef,
  listReqsInCommits,
  refExists,
  reqHasCommits,
} from '../lib/req-commits.js';
import {
  archivedTicketDir,
  readBundleManifests,
  readPendingTickets,
  type PendingTicket,
} from '../lib/release-tickets.js';
import {
  resolvePortalReadKey,
  resolveReleaseByPrefix,
  type PortalReadContext,
  type ReleaseLookup,
} from '../lib/releases-api.js';
import { readDeferralMaxAgeDays } from '../lib/sdlc-config.js';

/**
 * devaudit-installer#956 phase 3a-2 — READ-ONLY release-deferral diagnosis
 * (situations D3, D4, D6, D7 of the issue; D8 is the pre-existing `releases`
 * check in doctor.ts). Every check degrades to an `ok: true` "skipped" result
 * when its data source is unavailable (no git ref, no `gh`, no portal key, no
 * network, no compliance/) and never throws. Like the other non-tool checks,
 * a finding sets `ok: false` for display but never gates doctor's exit code.
 * Remediation descriptors are inert data for the phase-3b `--fix`.
 */

export interface GhResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export interface DeferralContext {
  readonly repoRoot: string;
  /** Null when the portal cannot be read (no slug/base_url/key). */
  readonly portal: PortalReadContext | null;
  /** Why `portal` is null, for the skip notes. */
  readonly portalNote: string;
  /** Returns null when `gh` is not runnable at all. */
  readonly runGh: (args: readonly string[]) => Promise<GhResult | null>;
  /** `deferral_max_age_days` (D5): validated positive integer, default 30. */
  readonly deferralMaxAgeDays: number;
  /** Set when sdlc-config.json held an invalid `deferral_max_age_days`. */
  readonly deferralMaxAgeInvalid: boolean;
  /** Injectable clock for D5. */
  readonly now?: () => Date;
}

export async function buildDeferralContext(
  repoRoot: string,
  cfg: Record<string, unknown>,
  runGh?: DeferralContext['runGh'],
): Promise<DeferralContext> {
  const devaudit = (cfg['devaudit'] ?? {}) as { project_slug?: string; base_url?: string };
  const slug = devaudit.project_slug ?? (cfg['project_slug'] as string | undefined);
  const base = (devaudit.base_url ?? '').replace(/\/$/, '');
  const key = await resolvePortalReadKey(repoRoot);
  let portal: PortalReadContext | null = null;
  let portalNote = '';
  if (!slug || !base) portalNote = 'no devaudit.project_slug/base_url in sdlc-config.json';
  else if (!key) portalNote = 'no viewer key (set DEVAUDIT_VIEWER_API_KEY or run `devaudit auth viewer-key set`)';
  else portal = { baseUrl: base, projectSlug: slug, apiKey: key.key };
  const age = readDeferralMaxAgeDays(cfg);
  return {
    repoRoot,
    portal,
    portalNote,
    deferralMaxAgeDays: age.days,
    deferralMaxAgeInvalid: age.invalid,
    runGh:
      runGh ??
      (async (args) => {
        try {
          const r = await execa('gh', [...args], { cwd: repoRoot, reject: false, timeout: 20_000 });
          return { exitCode: r.exitCode ?? 1, stdout: r.stdout };
        } catch {
          return null;
        }
      }),
  };
}

async function safe(name: string, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await fn();
  } catch {
    return { name, ok: true, detail: 'skipped (unexpected error reading local state)', suspectedOrigin: 'unknown' };
  }
}

function skipped(name: string, why: string): CheckResult {
  return { name, ok: true, detail: `skipped (${why})`, suspectedOrigin: 'unknown' };
}

function result(name: string, findings: readonly Finding[], okDetail: string, notes: readonly string[] = []): CheckResult {
  const suffix = notes.length > 0 ? ` [${notes.join('; ')}]` : '';
  if (findings.length === 0) return { name, ok: true, detail: okDetail + suffix, suspectedOrigin: 'consumer-drift' };
  return {
    name,
    ok: false,
    detail: findings.map((f) => f.detail).join(' | ') + suffix,
    suspectedOrigin: 'consumer-drift',
    findings,
  };
}

const OPEN_PORTAL_STATES = new Set(['draft', 'uat_review', 'uat_approved']);

/** D3 — release PR closed unmerged while the portal release is still open and nothing is declared. */
export async function checkClosedReleasePr(ctx: DeferralContext): Promise<CheckResult> {
  const name = 'release-pr-closed';
  return safe(name, async () => {
    const tickets = await readPendingTickets(ctx.repoRoot);
    if (!tickets) return skipped(name, 'no compliance/pending-releases/');
    const candidates = tickets.filter((t) => t.intent === null && t.prNumber !== null);
    if (candidates.length === 0) return result(name, [], 'no undeclared pending ticket links a release PR');

    const notes: string[] = [];
    const closed: PendingTicket[] = [];
    let ghFailures = 0;
    for (const t of candidates) {
      const r = await ctx.runGh(['pr', 'view', String(t.prNumber), '--json', 'state,mergedAt']);
      if (!r || r.exitCode !== 0) {
        ghFailures++;
        continue;
      }
      try {
        const pr = JSON.parse(r.stdout) as { state?: string; mergedAt?: string | null };
        if (pr.state === 'CLOSED' && !pr.mergedAt) closed.push(t);
      } catch {
        ghFailures++;
      }
    }
    if (ghFailures === candidates.length) return skipped(name, '`gh pr view` unavailable — gh missing, unauthenticated, or no remote');
    if (ghFailures > 0) notes.push(`${ghFailures} PR lookup(s) skipped`);
    if (closed.length === 0) return result(name, [], 'no release PR closed unmerged', notes);
    if (!ctx.portal) {
      notes.push(`portal state not checked: ${ctx.portalNote}`);
      return result(name, [], `${closed.length} release PR(s) closed unmerged (${closed.map((t) => t.version).join(', ')})`, notes);
    }

    const findings: Finding[] = [];
    for (const t of closed) {
      const lookup = await resolveReleaseByPrefix(ctx.portal, t.version);
      if (lookup.kind === 'unavailable') {
        notes.push(`${t.version}: portal ${lookup.reason}`);
        continue;
      }
      if (lookup.kind !== 'found' || !OPEN_PORTAL_STATES.has(lookup.release.status)) continue;
      findings.push({
        subject: t.version,
        detail: `${t.version}: release PR #${t.prNumber} was closed unmerged but the portal release is still ${lookup.release.status} and the ticket declares no Release intent — defer, abandon, or reopen it`,
        remediation: {
          id: 'resolve-closed-release-pr',
          tier: 'B',
          summary: `Decide what happens to ${t.version}: defer, abandon, or reopen PR #${t.prNumber}`,
          plan: [
            `defer: add "- **Release intent:** deferred-to-next — <reason>" to ${t.path.replace(/\\/g, '/').replace(/^.*\/compliance\//, 'compliance/')} and defer the portal release`,
            'abandon: close out the release as abandoned',
            `reopen: reopen PR #${t.prNumber}`,
          ],
          needsPortal: true,
          data: {
            version: t.version,
            ticketPath: relTicketPath(t),
            ...(lookup.release.id ? { releaseId: lookup.release.id } : {}),
            prNumber: String(t.prNumber),
          },
        },
      });
    }
    return result(name, findings, 'no closed-unmerged release PR with an open portal release', notes);
  });
}

async function firstExistingRef(repoRoot: string, refs: readonly string[]): Promise<string | null> {
  for (const r of refs) if (await refExists(repoRoot, r)) return r;
  return null;
}

/** D4 — a deferred REQ's commits are on develop but no pending ticket lists it as a predecessor. */
export async function checkDeferredWillShip(ctx: DeferralContext): Promise<CheckResult> {
  const name = 'deferred-will-ship';
  return safe(name, async () => {
    const tickets = await readPendingTickets(ctx.repoRoot);
    if (!tickets) return skipped(name, 'no compliance/pending-releases/');
    const deferred = tickets.filter((t) => t.deferred);
    if (deferred.length === 0) return result(name, [], 'no deferred tickets');
    const develop = await firstExistingRef(ctx.repoRoot, ['develop', 'origin/develop']);
    const main = await firstExistingRef(ctx.repoRoot, ['origin/main', 'main']);
    if (!develop || !main) return skipped(name, 'develop and/or main not found in this checkout');

    const inRange = new Set(listReqsInCommits(await commitsInRange(ctx.repoRoot, main, develop)));
    const absorbed = new Set(tickets.filter((t) => !t.deferred).flatMap((t) => t.predecessors));
    const nextExists = tickets.some((t) => !t.deferred);
    const findings: Finding[] = [];
    for (const t of deferred) {
      if (!inRange.has(t.version) || absorbed.has(t.version)) continue;
      findings.push({
        subject: t.version,
        detail: `${t.version} is deferred but its commits are on ${develop} and ${nextExists ? 'no pending release ticket lists it' : 'no next release ticket exists yet'} under "Absorbed predecessor releases" — it will ship unapproved with the next release`,
        remediation: {
          id: 'list-deferred-predecessor',
          tier: 'A',
          summary: `List ${t.version} as an absorbed predecessor of the next release`,
          plan: [
            `add ${t.version} under "Absorbed predecessor releases" in the next release ticket`,
            `or revert ${t.version}'s commits from ${develop} (tier C: commands are printed, never run)`,
          ],
          needsPortal: false,
          data: { deferred: t.version, branch: develop },
        },
      });
    }
    return result(name, findings, 'every deferred REQ with commits on develop is listed as a predecessor');
  });
}

/**
 * D6 — a ticket says `Absorbed predecessor releases: None` while a pending
 * candidate ticket has commits in range.
 *
 * Port of the "None" guard in sdlc/files/_common/scripts/generate-bundled-changes.sh
 * (search "says 'Absorbed predecessor releases: None'"): same candidate set
 * (other pending tickets, minus the ticket's own declared-bundle co_tracked
 * members, REQ-<n> only) and the same req_has_commits_in_range() lookup over
 * SINCE..HEAD. doctor.test.ts runs both against one fixture to keep them aligned.
 */
export async function checkPredecessorsNone(ctx: DeferralContext): Promise<CheckResult> {
  const name = 'predecessors-none';
  return safe(name, async () => {
    const tickets = await readPendingTickets(ctx.repoRoot);
    if (!tickets) return skipped(name, 'no compliance/pending-releases/');
    const nones = tickets.filter((t) => t.predecessorsFieldPresent && t.predecessors.length === 0);
    if (nones.length === 0) return result(name, [], 'no ticket declares "Absorbed predecessor releases: None"');
    if (!(await refExists(ctx.repoRoot, 'HEAD'))) return skipped(name, 'no git history');
    const commits = await commitsInRange(ctx.repoRoot, await defaultSinceRef(ctx.repoRoot), 'HEAD');
    const manifests = await readBundleManifests(ctx.repoRoot);
    const findings: Finding[] = [];
    for (const t of nones) {
      const declared = new Set(manifests.find((m) => m.core === t.version)?.coTracked ?? []);
      for (const cand of tickets) {
        if (cand.version === t.version || declared.has(cand.version)) continue;
        if (!/^REQ-[0-9]+$/.test(cand.version) || !reqHasCommits(commits, cand.version)) continue;
        findings.push({
          subject: t.version,
          detail: `${t.version}'s ticket says "Absorbed predecessor releases: None" but pending ticket ${cand.version} has commits in range, so its code ships under ${t.version}`,
          remediation: {
            id: 'fix-absorbed-predecessors',
            tier: 'A',
            summary: `List ${cand.version} under "Absorbed predecessor releases" in ${t.version}'s ticket`,
            plan: [`edit RELEASE-TICKET-${t.version}.md: replace "None" with ${cand.version}`],
            needsPortal: false,
            data: { version: t.version, candidate: cand.version, ticketPath: relTicketPath(t) },
          },
        });
      }
    }
    return result(name, findings, 'no "None" ticket has a pending candidate with commits in range');
  });
}

/** D7 — declared-bundle members: member tickets pending after the core released, or orphan portal drafts. */
export async function checkBundleMembers(ctx: DeferralContext): Promise<CheckResult> {
  const name = 'bundle-members';
  return safe(name, async () => {
    const tickets = await readPendingTickets(ctx.repoRoot);
    if (!tickets) return skipped(name, 'no compliance/pending-releases/');
    const manifests = await readBundleManifests(ctx.repoRoot);
    if (manifests.length === 0) return result(name, [], 'no declared bundles');
    const pending = new Set(tickets.map((t) => t.version));
    const notes: string[] = [];
    const findings: Finding[] = [];
    if (!ctx.portal) notes.push(`portal not checked: ${ctx.portalNote}`);
    for (const m of manifests) {
      let coreDone: string | null = null;
      if (!pending.has(m.core)) {
        const dir = await archivedTicketDir(ctx.repoRoot, m.core);
        if (dir) coreDone = `moved to ${dir}/`;
      } else if (ctx.portal) {
        const core = await resolveReleaseByPrefix(ctx.portal, m.core);
        if (core.kind === 'found' && core.release.status === 'released') coreDone = 'released on the portal';
        else if (core.kind === 'unavailable') notes.push(`${m.core}: portal ${core.reason}`);
      }
      for (const member of m.coTracked) {
        if (coreDone && pending.has(member)) {
          findings.push({
            subject: member,
            detail: `${member}: declared-bundle member of ${m.core} is still in pending-releases/ but ${m.core} is ${coreDone}`,
          });
        }
        if (!ctx.portal) continue;
        const lookup = await resolveReleaseByPrefix(ctx.portal, member);
        if (lookup.kind === 'unavailable') notes.push(`${member}: portal ${lookup.reason}`);
        else if (lookup.kind === 'found' && lookup.release.status === 'draft') {
          findings.push({
            subject: member,
            detail: `${member}: orphan portal draft — a declared bundle is one portal release (core ${m.core}); discard this draft on the portal`,
          });
        }
      }
    }
    return result(name, findings, `${manifests.length} declared bundle(s); no orphan drafts or stale members`, [...new Set(notes)]);
  });
}

const DEFERRABLE_PORTAL_STATES = new Set(['draft', 'uat_review', 'uat_rejected', 'uat_approved']);

const lookupCache = new WeakMap<DeferralContext, Map<string, ReleaseLookup>>();

/** Per-run memo so D1/D2/D5 share one portal lookup per version. */
async function lookupOnce(ctx: DeferralContext, version: string): Promise<ReleaseLookup> {
  if (!ctx.portal) return { kind: 'unavailable', reason: 'no portal' };
  let m = lookupCache.get(ctx);
  if (!m) lookupCache.set(ctx, (m = new Map()));
  let hit = m.get(version);
  if (!hit) m.set(version, (hit = await resolveReleaseByPrefix(ctx.portal, version)));
  return hit;
}

function relTicketPath(t: PendingTicket): string {
  return t.path.replace(/\\/g, '/').replace(/^.*\/compliance\//, 'compliance/');
}

/** The free-text reason after `deferred-to-next` in a ticket's Release intent value. */
export function deferralReasonFromIntent(intent: string | null): string {
  if (!intent) return '';
  return intent.replace(/^deferred-to-next/, '').replace(/^\s*[\u2014\u2013:-]+\s*/, '').trim();
}

/** D1 — ticket declares `deferred-to-next`, but the portal release is not `deferred`. */
export async function checkDeferredTicketNotOnPortal(ctx: DeferralContext): Promise<CheckResult> {
  const name = 'deferred-portal-sync';
  return safe(name, async () => {
    const tickets = await readPendingTickets(ctx.repoRoot);
    if (!tickets) return skipped(name, 'no compliance/pending-releases/');
    const deferred = tickets.filter((t) => t.deferred);
    if (deferred.length === 0) return result(name, [], 'no deferred tickets');
    if (!ctx.portal) return skipped(name, ctx.portalNote);
    const notes: string[] = [];
    const findings: Finding[] = [];
    for (const t of deferred) {
      const lookup = await lookupOnce(ctx, t.version);
      if (lookup.kind === 'unavailable') {
        notes.push(`${t.version}: portal ${lookup.reason}`);
        continue;
      }
      if (lookup.kind !== 'found') continue;
      const status = lookup.release.status;
      if (status === 'deferred' || !DEFERRABLE_PORTAL_STATES.has(status) || !lookup.release.id) continue;
      findings.push({
        subject: t.version,
        detail: `${t.version}: ticket declares Release intent deferred-to-next but the portal release is ${status}, not deferred`,
        remediation: {
          id: 'defer-portal-release',
          tier: 'B',
          summary: `Defer the portal release for ${t.version} (admin PAT, typed reason)`,
          plan: [
            `POST /api/releases/${lookup.release.id}/defer with the reason from the ticket (or one you type)`,
            'requires a portal admin personal access token (DEVAUDIT_USER_TOKEN); API/viewer keys are never used',
          ],
          needsPortal: true,
          data: {
            version: t.version,
            releaseId: lookup.release.id,
            reason: deferralReasonFromIntent(t.intent),
          },
        },
      });
    }
    return result(name, findings, 'every deferred ticket is deferred on the portal (or not deferrable)', [...new Set(notes)]);
  });
}

/** D2 — portal release is `deferred`, but the ticket / RTM is not marked. */
export async function checkPortalDeferredNotInTicket(ctx: DeferralContext): Promise<CheckResult> {
  const name = 'deferred-ticket-sync';
  return safe(name, async () => {
    const tickets = await readPendingTickets(ctx.repoRoot);
    if (!tickets) return skipped(name, 'no compliance/pending-releases/');
    const candidates = tickets.filter((t) => !t.deferred && /^REQ-[0-9]+$/.test(t.version));
    if (candidates.length === 0) return result(name, [], 'no undeclared pending ticket to compare');
    if (!ctx.portal) return skipped(name, ctx.portalNote);
    const notes: string[] = [];
    const findings: Finding[] = [];
    for (const t of candidates) {
      const lookup = await lookupOnce(ctx, t.version);
      if (lookup.kind === 'unavailable') {
        notes.push(`${t.version}: portal ${lookup.reason}`);
        continue;
      }
      if (lookup.kind !== 'found' || lookup.release.status !== 'deferred') continue;
      const reason = lookup.release.deferredReason?.trim() || 'deferred on the portal';
      // devaudit-installer#1083 — a portal deferral nobody declared in the repo may be a
      // mistake (a wrong click). Recording it in the ticket would make the mistake permanent
      // and trip the promotion deferral gate, so this is a decision, never a default.
      findings.push({
        subject: t.version,
        detail: `${t.version}: the portal release is deferred but the ticket has no "Release intent: deferred-to-next" (the ticket field is the sole declaration) — record the deferral in the ticket if it was intended, or resume the portal release if it was a mistake`,
        remediation: {
          id: 'resolve-undeclared-deferral',
          tier: 'B',
          summary: `Decide whether the portal deferral of ${t.version} was intended`,
          plan: [
            `record (the deferral was intended): write "- **Release intent:** deferred-to-next — ${reason}" into ${relTicketPath(t)} and set the ${t.version} RTM row to DEFERRED`,
            `resume (the deferral was a mistake): POST /api/releases/${lookup.release.id ?? '<id>'}/resume (admin PAT, typed reason); the release returns to draft and the UAT approvals the defer superseded are not restored`,
            'leave: change nothing',
          ],
          needsPortal: true,
          data: {
            version: t.version,
            ticketPath: relTicketPath(t),
            reason,
            ...(lookup.release.id ? { releaseId: lookup.release.id } : {}),
          },
        },
      });
    }
    return result(name, findings, 'every portal-deferred release is declared in its ticket', [...new Set(notes)]);
  });
}

/** D5 — deferred longer than `deferral_max_age_days`, or past `deferredUntil`. */
export async function checkStaleDeferrals(ctx: DeferralContext): Promise<CheckResult> {
  const name = 'deferral-age';
  return safe(name, async () => {
    const tickets = await readPendingTickets(ctx.repoRoot);
    if (!tickets) return skipped(name, 'no compliance/pending-releases/');
    const deferred = tickets.filter((t) => t.deferred);
    if (deferred.length === 0) return result(name, [], 'no deferred tickets');
    if (!ctx.portal) return skipped(name, ctx.portalNote);
    const now = (ctx.now ?? (() => new Date()))().getTime();
    const dayMs = 86_400_000;
    const notes: string[] = [];
    if (ctx.deferralMaxAgeInvalid) {
      notes.push(`invalid deferral_max_age_days in sdlc-config.json, using ${ctx.deferralMaxAgeDays}`);
    }
    const findings: Finding[] = [];
    for (const t of deferred) {
      const lookup = await lookupOnce(ctx, t.version);
      if (lookup.kind === 'unavailable') {
        notes.push(`${t.version}: portal ${lookup.reason}`);
        continue;
      }
      if (lookup.kind !== 'found' || lookup.release.status !== 'deferred') continue;
      const r = lookup.release;
      const since = r.deferredAt ? Date.parse(r.deferredAt) : NaN;
      const until = r.deferredUntil ? Date.parse(r.deferredUntil) : NaN;
      const ageDays = Number.isNaN(since) ? null : Math.floor((now - since) / dayMs);
      const why: string[] = [];
      if (!Number.isNaN(until) && until < now) why.push(`past its review-by date ${r.deferredUntil}`);
      if (ageDays !== null && ageDays > ctx.deferralMaxAgeDays) {
        why.push(`deferred ${ageDays} days (limit ${ctx.deferralMaxAgeDays})`);
      }
      if (why.length === 0 || !r.id) continue;
      findings.push({
        subject: t.version,
        detail: `${t.version}: ${why.join('; ')} — extend, resume, or abandon it`,
        remediation: {
          id: 'resume-stale-deferral',
          tier: 'B',
          summary: `Resume the stale deferral of ${t.version} (returns the portal release to draft)`,
          plan: [
            `resume: POST /api/releases/${r.id}/resume (admin PAT, typed reason) and remove the ticket's Release intent`,
            'extend: re-review and decide a new review-by date on the portal (not performed by this tool)',
            'abandon: close the release out as abandoned (not performed by this tool)',
          ],
          needsPortal: true,
          data: { version: t.version, releaseId: r.id, ticketPath: relTicketPath(t) },
        },
      });
    }
    return result(name, findings, `no deferral older than ${ctx.deferralMaxAgeDays} days or past its review-by date`, [...new Set(notes)]);
  });
}

export async function runDeferralChecks(ctx: DeferralContext): Promise<readonly CheckResult[]> {
  return [
    await checkClosedReleasePr(ctx),
    await checkDeferredWillShip(ctx),
    await checkPredecessorsNone(ctx),
    await checkBundleMembers(ctx),
    await checkDeferredTicketNotOnPortal(ctx),
    await checkPortalDeferredNotInTicket(ctx),
    await checkStaleDeferrals(ctx),
  ];
}
