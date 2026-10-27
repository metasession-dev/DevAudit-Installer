import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { resolveToken } from './auth.js';
import type { CheckResult, Finding } from './doctor-types.js';
import { resolveRepoRoot } from './git-root.js';
import { logger } from './logger.js';

/**
 * devaudit-installer#1099 WP4 — the `credentials` doctor check and the
 * read-only "Credentials" block printed after `update` / `install` / `join`.
 *
 * Never returns, logs or prints a credential value: only variable names, file
 * names, sources and statuses. Every portal call has a 5 second timeout and is
 * skipped when its credential is absent; a timeout or an unreachable portal is
 * "not checked", never a failure. All I/O goes through `CredentialsDeps`, so
 * tests make no network calls.
 *
 * The personal access token is only ever sent to the portal from an
 * interactive terminal (`deps.interactive`): agent sessions run `doctor`
 * without a TTY, and agents never use the PAT (#1099 WP5).
 */

export type CredentialStatus = 'ok' | 'warn' | 'absent' | 'invalid' | 'not-checked';

export interface CredentialEntry {
  readonly status: CredentialStatus;
  /** Where it was found (`env`, `.env`, `file`), or null. */
  readonly source: string | null;
  readonly project: string | null;
  /** ISO date; null until the portal exposes it (metasession-dev/devaudit#922). */
  readonly expiresAt: string | null;
  readonly note: string;
}

export interface UploaderEntry extends CredentialEntry {
  /** Names of the places it was found: `env DEVAUDIT_API_KEY`, `.env`, a tracked file path. Never values. */
  readonly locations: readonly string[];
}

export interface CredentialsReport {
  readonly uploaderKey: UploaderEntry;
  readonly viewerKey: CredentialEntry;
  readonly pat: CredentialEntry;
}

/** HTTP status of a probe, or a transport failure. */
export type ProbeResult = { readonly status: number } | { readonly failure: 'timeout' | 'network' };

export interface CredentialsDeps {
  readonly repoRoot: string;
  readonly cfg: Record<string, unknown>;
  readonly env: NodeJS.ProcessEnv;
  /** Contents of a repo-root file, or null when absent. */
  readonly readRepoFile: (name: string) => Promise<string | null>;
  /** Tracked files that contain any of the literal values or a `dak_` key; names only. */
  readonly trackedFilesWithKeys: (values: readonly string[]) => Promise<readonly string[]>;
  /** `GET /api/ci/releases/resolve?projectSlug=<slug>&versionPrefix=REQ-` with the viewer key. */
  readonly probeViewer: (baseUrl: string, slug: string, key: string) => Promise<ProbeResult>;
  /** `GET /api/projects` with the PAT; slugs on 200. */
  readonly probePat: (baseUrl: string, token: string) => Promise<ProbeResult & { readonly slugs?: readonly string[] }>;
  readonly resolvePat: () => Promise<{ token: string; baseUrl: string; source: 'env' | 'file' } | null>;
  /** Only an interactive terminal may send the PAT to the portal. */
  readonly interactive: boolean;
}

const TIMEOUT_MS = 5000;

export function parseDotenv(content: string, name: string): string | null {
  for (const raw of content.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] !== name) continue;
    let value = m[2] ?? '';
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    return value.length > 0 ? value : null;
  }
  return null;
}

async function timed(url: string, headers: Record<string, string>): Promise<{ res: Response } | { failure: 'timeout' | 'network' }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return { res: await fetch(url, { headers, signal: ctrl.signal, redirect: 'manual' }) };
  } catch (err) {
    return { failure: err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export async function defaultCredentialsDeps(repoRoot: string, cfg: Record<string, unknown>): Promise<CredentialsDeps> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !isCi(process.env);
  return {
    repoRoot,
    cfg,
    env: process.env,
    readRepoFile: async (name) => fs.readFile(join(repoRoot, name), 'utf-8').catch(() => null),
    trackedFilesWithKeys: async (values) => {
      try {
        // Patterns go through stdin so a key value never appears in argv.
        const patterns = ['dak_[A-Za-z0-9_-]{16,}', ...values.map(escapeRegex)].join('\n');
        const r = await execa('git', ['grep', '-I', '-l', '-E', '-f', '-'], { cwd: repoRoot, reject: false, input: patterns });
        if (r.exitCode !== 0) return [];
        return r.stdout.split('\n').filter((l) => l.length > 0);
      } catch {
        return [];
      }
    },
    probeViewer: async (baseUrl, slug, key) => {
      const url = `${baseUrl.replace(/\/$/, '')}/api/ci/releases/resolve?projectSlug=${encodeURIComponent(slug)}&versionPrefix=REQ-`;
      const r = await timed(url, { Authorization: `Bearer ${key}` });
      return 'res' in r ? { status: r.res.status } : r;
    },
    probePat: async (baseUrl, token) => {
      const r = await timed(`${baseUrl.replace(/\/$/, '')}/api/projects`, { 'X-DevAudit-Token': token });
      if (!('res' in r)) return r;
      if (r.res.status !== 200) return { status: r.res.status };
      try {
        const json = (await r.res.json()) as { projects?: Array<{ slug: string }> } | Array<{ slug: string }>;
        const list = Array.isArray(json) ? json : (json.projects ?? []);
        return { status: 200, slugs: list.map((p) => p.slug) };
      } catch {
        return { status: 200, slugs: [] };
      }
    },
    resolvePat: () => resolveToken(),
    interactive,
  };
}

function isCi(env: NodeJS.ProcessEnv): boolean {
  const v = env['CI'];
  return v !== undefined && v !== '' && v !== '0' && v !== 'false';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function buildCredentialsReport(deps: CredentialsDeps): Promise<CredentialsReport> {
  const devaudit = (deps.cfg['devaudit'] ?? {}) as { project_slug?: string; base_url?: string; api_key_secret?: string };
  const slug = devaudit.project_slug ?? (deps.cfg['project_slug'] as string | undefined) ?? null;
  const baseUrl = (devaudit.base_url ?? '').replace(/\/$/, '');
  const project = slug;

  const dotenv = (await deps.readRepoFile('.env')) ?? '';
  const dotenvLocal = (await deps.readRepoFile('.env.local')) ?? '';

  // ---- uploader key: CI-only, so any local copy is a finding -------------
  const locations: string[] = [];
  const values: string[] = [];
  const envUploader = deps.env['DEVAUDIT_API_KEY'];
  if (envUploader) { locations.push('env DEVAUDIT_API_KEY'); values.push(envUploader); }
  for (const [file, content] of [['.env', dotenv], ['.env.local', dotenvLocal]] as const) {
    const v = parseDotenv(content, 'DEVAUDIT_API_KEY');
    if (v) { locations.push(`${file} DEVAUDIT_API_KEY`); values.push(v); }
  }
  for (const file of await deps.trackedFilesWithKeys(values)) locations.push(`tracked file ${file}`);
  const uploaderKey: UploaderEntry = locations.length === 0
    ? { status: 'ok', source: null, project, expiresAt: null, note: 'not present locally (CI only)', locations }
    : { status: 'warn', source: null, project, expiresAt: null, note: `found in: ${locations.join('; ')}`, locations };

  // ---- viewer key ---------------------------------------------------------
  const envViewer = deps.env['DEVAUDIT_VIEWER_API_KEY'];
  const dotenvViewer = parseDotenv(dotenv, 'DEVAUDIT_VIEWER_API_KEY');
  const viewerValue = envViewer || dotenvViewer || null;
  const viewerSource = envViewer ? 'env' : dotenvViewer ? '.env' : null;
  let viewerKey: CredentialEntry;
  if (!viewerValue) {
    viewerKey = { status: 'absent', source: null, project, expiresAt: null, note: 'no viewer key found' };
  } else if (!slug || !baseUrl) {
    viewerKey = { status: 'not-checked', source: viewerSource, project, expiresAt: null, note: 'no devaudit.project_slug/base_url in sdlc-config.json' };
  } else {
    const p = await deps.probeViewer(baseUrl, slug, viewerValue);
    let status: CredentialStatus;
    let note: string;
    if ('failure' in p) { status = 'not-checked'; note = `not checked (portal ${p.failure})`; }
    else if (p.status === 200) { status = viewerSource === '.env' ? 'warn' : 'ok'; note = viewerSource === '.env' ? 'authenticates, but only found in .env (legacy)' : 'authenticates for this project'; }
    else if (p.status === 401) { status = 'invalid'; note = 'rejected by the portal (401): invalid or revoked'; }
    else if (p.status === 403) { status = 'invalid'; note = 'rejected by the portal (403): the key belongs to another project'; }
    else if (p.status === 404) { status = 'invalid'; note = 'the project slug in sdlc-config.json does not exist on this portal (404)'; }
    else { status = 'not-checked'; note = `not checked (portal answered ${p.status})`; }
    viewerKey = { status, source: viewerSource, project, expiresAt: null, note };
  }

  // ---- personal access token ----------------------------------------------
  const pat = await deps.resolvePat();
  let patEntry: CredentialEntry;
  if (!pat) {
    patEntry = { status: 'absent', source: null, project, expiresAt: null, note: 'no personal access token (needed only for human-run CLI actions)' };
  } else if (!deps.interactive) {
    // Agents run non-interactively and must never cause the PAT to be sent.
    patEntry = { status: 'not-checked', source: pat.source, project, expiresAt: null, note: 'present; not sent to the portal from a non-interactive run. expiry: not available' };
  } else {
    const p = await deps.probePat(pat.baseUrl, pat.token);
    let status: CredentialStatus;
    let note: string;
    if ('failure' in p) { status = 'not-checked'; note = `not checked (portal ${p.failure})`; }
    else if (p.status === 401 || p.status === 403) { status = 'invalid'; note = `rejected by the portal (${p.status}): invalid, expired or revoked`; }
    else if (p.status !== 200) { status = 'not-checked'; note = `not checked (portal answered ${p.status})`; }
    else if (slug && !(p.slugs ?? []).includes(slug)) { status = 'invalid'; note = 'valid, but not a member of this project'; }
    else { status = 'ok'; note = 'valid and a member of this project. expiry: not available'; }
    patEntry = { status, source: pat.source, project, expiresAt: null, note };
  }

  return { uploaderKey, viewerKey, pat: patEntry };
}

const FIX_PAT = 'Portal Settings -> Tokens -> Create token, then run `devaudit auth login`';
const FIX_VIEWER = 'Set DEVAUDIT_VIEWER_API_KEY to your own viewer key (portal project settings -> API keys, role viewer)';

/** The `credentials` onboarding check: non-gating, findings carry tier C guidance. */
export function credentialsCheck(report: CredentialsReport): CheckResult & { readonly credentials: CredentialsReport } {
  const findings: Finding[] = [];
  const add = (id: string, summary: string, plan: string, detail: string): void => {
    findings.push({ subject: id, detail, remediation: { id, tier: 'C', summary, plan: [plan], needsPortal: false } });
  };
  const { uploaderKey, viewerKey, pat } = report;
  if (uploaderKey.status === 'warn') {
    add('remove-local-uploader-key', 'Remove the uploader key from this machine', 'Delete it from the places listed; if it was ever committed or shared, revoke it in the portal, issue a replacement and run `devaudit configure secret DEVAUDIT_API_KEY`', `uploader key (CI-only) ${uploaderKey.note}`);
  }
  if (viewerKey.status === 'absent') add('provide-viewer-key', 'Provide your viewer key', FIX_VIEWER, 'viewer key: none found');
  else if (viewerKey.status === 'invalid') add('replace-viewer-key', 'Replace the viewer key', FIX_VIEWER, `viewer key ${viewerKey.note}`);
  else if (viewerKey.status === 'warn') add('move-viewer-key', 'Move the viewer key out of .env', 'Export DEVAUDIT_VIEWER_API_KEY in your shell profile and remove the line from .env', `viewer key ${viewerKey.note}`);
  if (pat.status === 'invalid') add('renew-pat', 'Renew your personal access token', FIX_PAT, `personal access token ${pat.note}`);

  const notes = [
    `uploader key: ${uploaderKey.status === 'ok' ? 'not local' : 'FOUND LOCALLY'}`,
    `viewer key: ${viewerKey.status}${viewerKey.source ? ` (${viewerKey.source})` : ''}`,
    `PAT: ${pat.status}${pat.source ? ` (${pat.source})` : ''}`,
  ].join('; ');
  return findings.length === 0
    ? { name: 'credentials', ok: true, detail: notes, suspectedOrigin: 'unknown', credentials: report }
    : { name: 'credentials', ok: false, detail: `${findings.map((f) => f.detail).join(' | ')} [${notes}]`, suspectedOrigin: 'unknown', findings, credentials: report };
}

/**
 * Lines for the block printed after `update` / `install` / `join`. One heading;
 * one line per project when there are several, with fixes listed below.
 */
export function credentialsBlock(reports: ReadonlyArray<{ readonly label: string; readonly report: CredentialsReport }>): string[] {
  if (reports.length === 0) return [];
  const lines = ['Credentials:'];
  for (const { label, report } of reports) {
    const c = credentialsCheck(report);
    lines.push(`  ${c.ok ? '✓' : '⚠'} ${reports.length > 1 ? `${label}: ` : ''}${c.detail}`);
    for (const f of c.findings ?? []) lines.push(`      fix: ${f.remediation?.plan[0] ?? ''}`);
  }
  return lines;
}

/**
 * Read-only block for the end of `update` / `install` / `join`: no prompts, no
 * portal writes, never throws, skipped in CI. Returns the lines (empty when
 * skipped) so the caller prints them once per invocation. Repo roots shared by
 * several paths (polyglot monorepo targets) are reported once.
 */
export async function credentialsBlockFor(
  repoRoots: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  depsFor: (root: string, cfg: Record<string, unknown>) => Promise<CredentialsDeps> = defaultCredentialsDeps,
): Promise<string[]> {
  if (isCi(env) || env['GITHUB_ACTIONS']) return [];
  const reports: Array<{ label: string; report: CredentialsReport }> = [];
  for (const root of [...new Set(repoRoots)]) {
    try {
      const cfg = JSON.parse(await fs.readFile(join(root, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;
      const slug = ((cfg['devaudit'] ?? {}) as { project_slug?: string }).project_slug ?? (cfg['project_slug'] as string | undefined);
      reports.push({ label: slug ?? root, report: await buildCredentialsReport(await depsFor(root, cfg)) });
    } catch {
      // not a consumer project, or unreadable: nothing to report
    }
  }
  return credentialsBlock(reports);
}

/** Print the block once for the project at `path` (default: the current directory). */
export async function printCredentialsBlock(path?: string): Promise<void> {
  const root = await resolveRepoRoot(path ?? process.cwd());
  const lines = await credentialsBlockFor([root]);
  if (lines.length === 0) return;
  const log = logger();
  log.log('');
  for (const l of lines) log.log(l);
}
