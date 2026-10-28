import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { logger } from '../lib/logger.js';
import { resolveRepoRoot } from '../lib/git-root.js';
import { readPendingTickets } from '../lib/release-tickets.js';
import {
  resolvePortalReadKey,
  resolveReleaseByPrefix,
  type ReleaseLookup,
} from '../lib/releases-api.js';

/**
 * devaudit-installer#1099 WP2 — `devaudit release check [<REQ>] [--json]`.
 *
 * Read-only readiness check before a person clicks "Submit for UAT review" in
 * the portal (the submit script is retired). No portal writes, never uses the
 * personal access token: the portal state is read with the viewer key only.
 * Each result carries the fix to run; the exit code is 0 only when every
 * check passes.
 */

export interface ReleaseCheckResult {
  readonly name: 'working-tree' | 'integration-branch' | 'ci' | 'ticket' | 'portal';
  readonly ok: boolean;
  readonly detail: string;
  /** What to do when `ok` is false. */
  readonly fix?: string;
}

export interface ReleaseCheckReport {
  readonly ready: boolean;
  readonly version: string | null;
  readonly results: readonly ReleaseCheckResult[];
}

export interface CmdResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export interface ReleaseCheckDeps {
  readonly repoRoot: string;
  readonly cfg: Record<string, unknown>;
  /** Returns null when the tool cannot be run at all. */
  readonly git: (args: readonly string[]) => Promise<CmdResult | null>;
  readonly gh: (args: readonly string[]) => Promise<CmdResult | null>;
  readonly lookup: (baseUrl: string, slug: string, key: string, version: string) => Promise<ReleaseLookup>;
  /** Viewer key for the portal read; null when none is available. */
  readonly readKey: () => Promise<string | null>;
}

const PASSING_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

async function run(bin: 'git' | 'gh', cwd: string, args: readonly string[]): Promise<CmdResult | null> {
  try {
    const r = await execa(bin, [...args], { cwd, reject: false });
    return { exitCode: r.exitCode ?? 1, stdout: r.stdout };
  } catch {
    return null;
  }
}

export async function defaultReleaseCheckDeps(cwd: string): Promise<ReleaseCheckDeps | null> {
  const repoRoot = await resolveRepoRoot(cwd);
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(await fs.readFile(join(repoRoot, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  return {
    repoRoot,
    cfg,
    git: (args) => run('git', repoRoot, args),
    gh: (args) => run('gh', repoRoot, args),
    lookup: (baseUrl, projectSlug, apiKey, version) => resolveReleaseByPrefix({ baseUrl, projectSlug, apiKey }, version),
    readKey: async () => (await resolvePortalReadKey(repoRoot))?.key ?? null,
  };
}

const ALREADY_SUBMITTED = new Set(['uat_review', 'uat_approved', 'uat_rejected', 'released']);

export async function runReleaseChecks(deps: ReleaseCheckDeps, requested?: string): Promise<ReleaseCheckReport> {
  const results: ReleaseCheckResult[] = [];
  const integration = typeof deps.cfg['integration_branch'] === 'string' ? (deps.cfg['integration_branch'] as string) : 'develop';

  // 1. Working tree clean.
  const status = await deps.git(['status', '--porcelain']);
  if (!status) results.push({ name: 'working-tree', ok: false, detail: 'git is not available', fix: 'Install git.' });
  else if (status.stdout.trim().length > 0) {
    results.push({ name: 'working-tree', ok: false, detail: 'uncommitted or untracked changes', fix: 'Commit or discard the changes (git status shows them).' });
  } else results.push({ name: 'working-tree', ok: true, detail: 'clean' });

  // 2. Integration branch up to date with origin.
  const fetched = await deps.git(['fetch', '--quiet', 'origin', integration]);
  const local = await deps.git(['rev-parse', '--verify', '--quiet', integration]);
  const remote = await deps.git(['rev-parse', '--verify', '--quiet', `origin/${integration}`]);
  let headSha: string | null = null;
  if (!fetched || fetched.exitCode !== 0 || !remote || remote.exitCode !== 0) {
    results.push({ name: 'integration-branch', ok: false, detail: `could not read origin/${integration}`, fix: `Check network access and that origin has a ${integration} branch.` });
  } else {
    headSha = remote.stdout.trim();
    if (!local || local.exitCode !== 0) {
      results.push({ name: 'integration-branch', ok: false, detail: `no local ${integration} branch`, fix: `git checkout ${integration}` });
    } else if (local.stdout.trim() !== headSha) {
      results.push({ name: 'integration-branch', ok: false, detail: `local ${integration} differs from origin/${integration}`, fix: `git checkout ${integration} && git pull --ff-only` });
    } else results.push({ name: 'integration-branch', ok: true, detail: `${integration} matches origin (${headSha.slice(0, 7)})` });
  }

  // 3. CI green on the integration branch head.
  if (!headSha) {
    results.push({ name: 'ci', ok: false, detail: 'not checked: integration branch head unknown', fix: 'Fix the integration-branch check first.' });
  } else {
    const runs = await deps.gh(['run', 'list', '--commit', headSha, '--json', 'name,status,conclusion', '--limit', '100']);
    let parsed: Array<{ name: string; status: string; conclusion: string }> | null = null;
    if (runs && runs.exitCode === 0) {
      try {
        parsed = JSON.parse(runs.stdout) as Array<{ name: string; status: string; conclusion: string }>;
      } catch {
        parsed = null;
      }
    }
    if (!parsed) results.push({ name: 'ci', ok: false, detail: 'could not read workflow runs with gh', fix: 'Run `gh auth login` and retry.' });
    else if (parsed.length === 0) results.push({ name: 'ci', ok: false, detail: `no workflow runs for ${headSha.slice(0, 7)}`, fix: 'Wait for CI to start on the integration branch head.' });
    else {
      const pending = parsed.filter((r) => r.status !== 'completed');
      const failed = parsed.filter((r) => r.status === 'completed' && !PASSING_CONCLUSIONS.has(r.conclusion));
      if (failed.length > 0) results.push({ name: 'ci', ok: false, detail: `failing: ${failed.map((r) => r.name).join(', ')}`, fix: 'Fix the failing runs (gh run list --commit ' + headSha.slice(0, 7) + ').' });
      else if (pending.length > 0) results.push({ name: 'ci', ok: false, detail: `still running: ${pending.map((r) => r.name).join(', ')}`, fix: 'Wait for the runs to finish, then rerun this check.' });
      else results.push({ name: 'ci', ok: true, detail: `${parsed.length} run(s) green on ${headSha.slice(0, 7)}` });
    }
  }

  // 4. Release ticket.
  let version: string | null = requested ?? null;
  const tickets = (await readPendingTickets(deps.repoRoot)) ?? [];
  if (!version) {
    const open = tickets.filter((t) => !t.deferred);
    if (open.length === 1) version = open[0]!.version;
    else if (open.length === 0) results.push({ name: 'ticket', ok: false, detail: 'no pending release ticket in compliance/pending-releases/', fix: 'Complete Phase 3 of the sdlc-implementer skill so the ticket is committed.' });
    else results.push({ name: 'ticket', ok: false, detail: `${open.length} pending tickets (${open.map((t) => t.version).join(', ')})`, fix: 'Name the release: devaudit release check <REQ-or-version>.' });
  }
  if (version) {
    const ticket = `compliance/pending-releases/RELEASE-TICKET-${version}.md`;
    const exists = await fs.stat(join(deps.repoRoot, ticket)).then(() => true, () => false);
    results.push(exists
      ? { name: 'ticket', ok: true, detail: ticket }
      : { name: 'ticket', ok: false, detail: `${ticket} is missing`, fix: 'Create it in Phase 3 of the sdlc-implementer skill, commit it to the integration branch.' });
  }

  // 5. Portal status, via the viewer key (never the PAT).
  const devaudit = (deps.cfg['devaudit'] ?? {}) as { project_slug?: string; base_url?: string };
  const slug = devaudit.project_slug ?? (deps.cfg['project_slug'] as string | undefined);
  const base = (devaudit.base_url ?? '').replace(/\/$/, '');
  const key = await deps.readKey();
  if (!version) results.push({ name: 'portal', ok: false, detail: 'not checked: release unknown', fix: 'Fix the ticket check first.' });
  else if (!slug || !base) results.push({ name: 'portal', ok: false, detail: 'no devaudit.project_slug/base_url in sdlc-config.json', fix: 'Set them with `devaudit configure set`.' });
  else if (!key) results.push({ name: 'portal', ok: false, detail: 'no viewer key available', fix: 'Set DEVAUDIT_VIEWER_API_KEY to your own viewer key (see docs/credentials.md).' });
  else {
    const found = await deps.lookup(base, slug, key, version);
    if (found.kind === 'unavailable') results.push({ name: 'portal', ok: false, detail: `portal not readable (${found.reason})`, fix: 'Check the viewer key and portal reachability.' });
    else if (found.kind === 'not-found') results.push({ name: 'portal', ok: false, detail: `no portal release for ${version}`, fix: 'CI creates it on the first push to the integration branch; check the Compliance Evidence Upload run.' });
    else if (found.release.status === 'draft') results.push({ name: 'portal', ok: true, detail: 'draft: ready to submit for UAT review' });
    else if (ALREADY_SUBMITTED.has(found.release.status)) results.push({ name: 'portal', ok: true, detail: `already submitted (${found.release.status})` });
    else results.push({ name: 'portal', ok: false, detail: `release is ${found.release.status}`, fix: found.release.status === 'deferred' ? 'Resume the release in the portal UI first.' : 'Check the release in the portal.' });
  }

  return { ready: results.every((r) => r.ok), version, results };
}

export async function runReleaseCheck(opts: { version?: string; json: boolean }, deps?: ReleaseCheckDeps | null): Promise<number> {
  const resolved = deps ?? (await defaultReleaseCheckDeps(process.cwd()));
  if (!resolved) {
    if (opts.json) process.stdout.write(JSON.stringify({ ready: false, version: null, results: [], error: 'not a consumer project (no sdlc-config.json)' }) + '\n');
    else logger().error('Not a consumer project: no sdlc-config.json found.');
    return 2;
  }
  const report = await runReleaseChecks(resolved, opts.version);
  if (opts.json) {
    process.stdout.write(JSON.stringify(report) + '\n');
  } else {
    const log = logger();
    for (const r of report.results) {
      log.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(18)} ${r.detail}`);
      if (!r.ok && r.fix) log.log(`      fix: ${r.fix}`);
    }
    log.log('');
    if (report.ready) log.success('Ready. Next: open the release in the portal and click "Submit for UAT review".');
    else log.warn('Not ready: fix the items above and rerun `devaudit release check`.');
  }
  return report.ready ? 0 : 1;
}
