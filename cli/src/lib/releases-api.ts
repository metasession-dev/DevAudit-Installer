import { promises as fs } from 'node:fs';
import { resolveViewerKey, type ViewerKeySource } from './viewer-keys.js';

/**
 * devaudit-installer#956 — READ-ONLY portal helpers for `devaudit doctor`.
 * Nothing here mutates the portal. Reads use the viewer key
 * (see `resolvePortalReadKey`). Key values
 * are never logged or returned in any message.
 */

export interface PortalKey {
  readonly key: string;
  readonly source: ViewerKeySource;
}

/**
 * The viewer key for this repo's project: `DEVAUDIT_VIEWER_API_KEY`, then the
 * config-folder `viewer-keys.json`, then the legacy repo-root `.env`. There is
 * no fallback to the uploader key `DEVAUDIT_API_KEY` (#1099): it is CI-only.
 */
export async function resolvePortalReadKey(repoRoot: string): Promise<PortalKey | null> {
  let baseUrl = '';
  let slug = '';
  try {
    const cfg = JSON.parse(await fs.readFile(`${repoRoot}/sdlc-config.json`, 'utf-8')) as Record<string, unknown>;
    const d = (cfg['devaudit'] ?? {}) as { project_slug?: string; base_url?: string };
    baseUrl = d.base_url ?? '';
    slug = d.project_slug ?? (cfg['project_slug'] as string | undefined) ?? '';
  } catch {
    // no readable config: env and .env still apply
  }
  return resolveViewerKey({ repoRoot, baseUrl, slug });
}

export interface PortalRelease {
  readonly status: string;
  /** Portal release id (needed by the admin defer/resume routes). */
  readonly id?: string;
  readonly version?: string;
  /** Populated by the portal for `deferred` releases (devaudit#895). */
  readonly deferredAt?: string | null;
  readonly deferredReason?: string | null;
  readonly deferredUntil?: string | null;
  readonly deferredToVersion?: string | null;
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
    const body = (await res.json()) as { latest?: Record<string, unknown> | null };
    const latest = body.latest;
    const status = latest?.['status'];
    if (typeof status !== 'string' || !latest) return { kind: 'not-found' };
    const str = (k: string): string | null => (typeof latest[k] === 'string' ? (latest[k] as string) : null);
    return {
      kind: 'found',
      release: {
        status,
        ...(str('id') ? { id: str('id') as string } : {}),
        ...(str('version') ? { version: str('version') as string } : {}),
        deferredAt: str('deferredAt'),
        deferredReason: str('deferredReason'),
        deferredUntil: str('deferredUntil'),
        deferredToVersion: str('deferredToVersion'),
      },
    };
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'network error';
    return { kind: 'unavailable', reason };
  } finally {
    clearTimeout(timer);
  }
}
