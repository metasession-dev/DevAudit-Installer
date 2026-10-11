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
} from '../lib/releases-api.js';

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
  else if (!key) portalNote = 'no DEVAUDIT_VIEWER_API_KEY (or DEVAUDIT_API_KEY) in env/.env';
  else portal = { baseUrl: base, projectSlug: slug, apiKey: key.key };
  return {
    repoRoot,
    portal,
    portalNote,
    runGh:
      runGh ??
      (async (args) => {
        try {
          const r = await execa('gh', [...args], { cwd: repoRoot, reject: false });
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

export async function runDeferralChecks(ctx: DeferralContext): Promise<readonly CheckResult[]> {
  return [
    await checkClosedReleasePr(ctx),
    await checkDeferredWillShip(ctx),
    await checkPredecessorsNone(ctx),
    await checkBundleMembers(ctx),
  ];
}
