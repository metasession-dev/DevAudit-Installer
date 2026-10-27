import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';
import { resolveRepoRoot } from '../lib/git-root.js';
import { readPendingTickets } from '../lib/release-tickets.js';
import { resolvePortalReadKey, resolveReleaseByPrefix } from '../lib/releases-api.js';

/**
 * devaudit-installer#1099 WP3 — `devaudit release status [<REQ-or-version>] [--json]`.
 *
 * Read-only portal state for a release, for people and agents: the release
 * status, its required checks and its test executions. Uses the viewer key
 * only (never the uploader key or the personal access token). The checks and
 * executions are what the portal's read-back endpoints return, passed
 * through; if either cannot be read the field is `null` and the status is
 * still reported.
 *
 * JSON shape (documented in docs/credentials.md):
 * `{ project, version, releaseId, status, url, deferred?, checks, executions }`.
 */

export interface ReleaseStatusReport {
  readonly project: string;
  readonly version: string;
  readonly releaseId: string | null;
  readonly status: string;
  /** `<base_url>/projects/<slug>/releases/<id>`; null without a release id. */
  readonly url: string | null;
  readonly deferred?: { readonly reason: string | null; readonly until: string | null; readonly toVersion: string | null };
  readonly checks: unknown;
  readonly executions: unknown;
}

export type ReleaseStatusResult =
  | { readonly ok: true; readonly report: ReleaseStatusReport }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

export interface ReleaseStatusDeps {
  readonly repoRoot: string;
  readonly cfg: Record<string, unknown>;
  readonly readKey: () => Promise<string | null>;
  readonly fetchJson: (url: string, key: string) => Promise<unknown | null>;
  readonly lookup?: typeof resolveReleaseByPrefix;
}

async function getJson(url: string, key: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal, redirect: 'manual' });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function defaultReleaseStatusDeps(cwd: string): Promise<ReleaseStatusDeps | null> {
  const repoRoot = await resolveRepoRoot(cwd);
  try {
    const cfg = JSON.parse(await fs.readFile(join(repoRoot, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;
    return { repoRoot, cfg, readKey: async () => (await resolvePortalReadKey(repoRoot))?.key ?? null, fetchJson: getJson };
  } catch {
    return null;
  }
}

/** The `checks` / `cycles` arrays may arrive bare or wrapped in an object of the same name. */
const unwrap = (json: unknown, field: string): unknown => {
  if (json && typeof json === 'object' && !Array.isArray(json) && field in (json as Record<string, unknown>)) {
    return (json as Record<string, unknown>)[field];
  }
  return json;
};

export async function getReleaseStatus(deps: ReleaseStatusDeps, requested?: string): Promise<ReleaseStatusResult> {
  const d = (deps.cfg['devaudit'] ?? {}) as { project_slug?: string; base_url?: string };
  const slug = d.project_slug ?? (deps.cfg['project_slug'] as string | undefined);
  const base = (d.base_url ?? '').replace(/\/$/, '');
  if (!slug || !base) return { ok: false, exitCode: 2, message: 'No devaudit.project_slug/base_url in sdlc-config.json.' };

  let version = requested;
  if (!version) {
    const open = ((await readPendingTickets(deps.repoRoot)) ?? []).filter((t) => !t.deferred);
    if (open.length !== 1) {
      return { ok: false, exitCode: 2, message: open.length === 0 ? 'No pending release ticket; name the release: devaudit release status <REQ-or-version>.' : `Several pending tickets (${open.map((t) => t.version).join(', ')}); name the release.` };
    }
    version = open[0]!.version;
  }

  const key = await deps.readKey();
  if (!key) return { ok: false, exitCode: 3, message: 'No viewer key found. Save yours with `devaudit auth viewer-key set` or export DEVAUDIT_VIEWER_API_KEY.' };

  const found = await (deps.lookup ?? resolveReleaseByPrefix)({ baseUrl: base, projectSlug: slug, apiKey: key }, version);
  if (found.kind === 'unavailable') return { ok: false, exitCode: 4, message: `Portal not readable (${found.reason}). Check the viewer key and the portal URL.` };
  if (found.kind === 'not-found') return { ok: false, exitCode: 5, message: `No portal release for ${version}. CI creates it on the first push to the integration branch.` };

  const rel = found.release;
  const id = rel.id ?? null;
  const [checks, executions] = id
    ? await Promise.all([
        deps.fetchJson(`${base}/api/ci/releases/${encodeURIComponent(id)}/checks`, key),
        deps.fetchJson(`${base}/api/ci/releases/${encodeURIComponent(id)}/cycles`, key),
      ])
    : [null, null];

  const report: ReleaseStatusReport = {
    project: slug,
    version: rel.version ?? version,
    releaseId: id,
    status: rel.status,
    url: id ? `${base}/projects/${slug}/releases/${id}` : null,
    ...(rel.status === 'deferred'
      ? { deferred: { reason: rel.deferredReason ?? null, until: rel.deferredUntil ?? null, toVersion: rel.deferredToVersion ?? null } }
      : {}),
    checks: checks === null ? null : unwrap(checks, 'checks'),
    executions: executions === null ? null : unwrap(executions, 'cycles'),
  };
  return { ok: true, report };
}

const count = (v: unknown): string => (Array.isArray(v) ? String(v.length) : 'unavailable');

export async function runReleaseStatus(opts: { version?: string; json: boolean }, deps?: ReleaseStatusDeps | null): Promise<number> {
  const resolved = deps ?? (await defaultReleaseStatusDeps(process.cwd()));
  const log = logger();
  const fail = (exitCode: number, message: string): number => {
    if (opts.json) process.stdout.write(JSON.stringify({ ok: false, error: message }) + '\n');
    else log.error(message);
    return exitCode;
  };
  if (!resolved) return fail(2, 'Not a consumer project: no sdlc-config.json found.');
  const result = await getReleaseStatus(resolved, opts.version);
  if (!result.ok) return fail(result.exitCode, result.message);
  const r = result.report;
  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: true, ...r }) + '\n');
    return 0;
  }
  log.log(`${r.project} ${r.version}: ${r.status}`);
  if (r.deferred) log.log(`  deferred${r.deferred.reason ? `: ${r.deferred.reason}` : ''}${r.deferred.until ? ` (until ${r.deferred.until})` : ''}${r.deferred.toVersion ? ` -> ${r.deferred.toVersion}` : ''}`);
  log.log(`  required checks: ${count(r.checks)}`);
  log.log(`  test executions: ${count(r.executions)}`);
  if (r.url) log.log(`  ${r.url}`);
  return 0;
}
