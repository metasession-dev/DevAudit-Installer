import { promises as fs } from 'node:fs';

/**
 * devaudit-installer#956 — READ-ONLY portal helpers for `devaudit doctor`.
 * Nothing here mutates the portal. Reads use the viewer key
 * (`DEVAUDIT_VIEWER_API_KEY`), falling back to `DEVAUDIT_API_KEY`. Key values
 * are never logged or returned in any message.
 */

export interface PortalKey {
  readonly key: string;
  readonly source: 'DEVAUDIT_VIEWER_API_KEY' | 'DEVAUDIT_API_KEY';
}

/** Parse the value of `name` out of a dotenv-style file; null when absent. */
function readDotenvValue(content: string, name: string): string | null {
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

export async function resolvePortalReadKey(repoRoot: string): Promise<PortalKey | null> {
  let dotenv = '';
  try {
    dotenv = await fs.readFile(`${repoRoot}/.env`, 'utf-8');
  } catch {
    // no .env — env vars only
  }
  for (const source of ['DEVAUDIT_VIEWER_API_KEY', 'DEVAUDIT_API_KEY'] as const) {
    const fromEnv = process.env[source];
    const key = fromEnv && fromEnv.length > 0 ? fromEnv : readDotenvValue(dotenv, source);
    if (key) return { key, source };
  }
  return null;
}

export interface PortalRelease {
  readonly status: string;
}

export type ReleaseLookup =
  | { readonly kind: 'found'; readonly release: PortalRelease }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface PortalReadContext {
  readonly baseUrl: string;
  readonly projectSlug: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
}

/**
 * Resolve a release by `versionPrefix` (a REQ id or bare-date version) via
 * `GET /api/ci/releases/resolve` — the same endpoint the `releases` check has
 * always used. Never throws; network errors and timeouts become `unavailable`.
 */
export async function resolveReleaseByPrefix(
  ctx: PortalReadContext,
  versionPrefix: string,
): Promise<ReleaseLookup> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ctx.timeoutMs ?? 10000);
  try {
    const res = await fetch(
      `${ctx.baseUrl.replace(/\/$/, '')}/api/ci/releases/resolve?projectSlug=${encodeURIComponent(ctx.projectSlug)}&versionPrefix=${encodeURIComponent(versionPrefix)}`,
      { headers: { Authorization: `Bearer ${ctx.apiKey}` }, signal: ctrl.signal },
    );
    if (res.status === 404) return { kind: 'not-found' };
    if (!res.ok) return { kind: 'unavailable', reason: `portal returned ${res.status}` };
    const body = (await res.json()) as { latest?: { status?: string } | null };
    const status = body.latest?.status;
    if (typeof status !== 'string') return { kind: 'not-found' };
    return { kind: 'found', release: { status } };
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'network error';
    return { kind: 'unavailable', reason };
  } finally {
    clearTimeout(timer);
  }
}
