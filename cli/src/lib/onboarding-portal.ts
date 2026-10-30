import type { PortalApprovalPolicy, SoloApprover } from '@metasession.co/devaudit-core';

/**
 * DevAudit-Installer#1116 WP6 — the portal calls the guided onboarding makes.
 *
 * Reads use the person's viewer key on `/api/ci/*`; writes are tier B (a change to portal state): they
 * use the person's personal access token in `X-DevAudit-Token` and are only ever called after an
 * interactive confirmation. A portal that does not have a feature yet (`metasession-dev/devaudit#931`
 * approval policy, `#924` claimed standards) answers a read without the field, or a write with 400, 404
 * or 405; every such answer becomes `unavailable`, so the caller prints one plain line and goes on. No
 * secret is ever put in a message or returned.
 */

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

export interface PortalReadOptions {
  readonly baseUrl: string;
  readonly slug: string;
  readonly viewerKey: string | null;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

export type PolicyRead =
  | { readonly status: 'ok'; readonly policy: PortalApprovalPolicy }
  /** The project exists but the portal does not report an approval policy (it predates `#931`). */
  | { readonly status: 'unsupported' }
  /** The project is not on the portal yet, or there is no viewer key to read it with. */
  | { readonly status: 'unknown'; readonly reason: 'no-project' | 'no-key' | 'unreachable' };

const POLICIES: readonly string[] = ['independent', 'self_allowed_with_gap'];

async function getJson(url: string, key: string, opts: PortalReadOptions): Promise<{ status: number; body: unknown } | null> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, init) => fetch(u, init));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await doFetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const base = (opts: PortalReadOptions): string => opts.baseUrl.replace(/\/$/, '');

/** `GET /api/ci/projects/{slug}`: the project's approval policy, when the portal reports one. */
export async function readApprovalPolicy(opts: PortalReadOptions): Promise<PolicyRead> {
  if (!opts.viewerKey) return { status: 'unknown', reason: 'no-key' };
  const res = await getJson(`${base(opts)}/api/ci/projects/${encodeURIComponent(opts.slug)}`, opts.viewerKey, opts);
  if (res === null) return { status: 'unknown', reason: 'unreachable' };
  if (res.status === 404 || res.status === 403 || res.status === 401) return { status: 'unknown', reason: 'no-project' };
  if (res.status < 200 || res.status >= 300) return { status: 'unknown', reason: 'unreachable' };
  const policy = res.body !== null && typeof res.body === 'object' ? (res.body as Record<string, unknown>)['approval_policy'] : undefined;
  return typeof policy === 'string' && POLICIES.includes(policy) ? { status: 'ok', policy: policy as PortalApprovalPolicy } : { status: 'unsupported' };
}

/** Whether the portal allows a solo approver: yes when it reports a policy, no when the project exists without one, else unknown. */
export function soloApproverFrom(read: PolicyRead): SoloApprover {
  if (read.status === 'ok') return 'yes';
  if (read.status === 'unsupported') return 'no';
  return 'unknown';
}

export type StandardsRead =
  | { readonly status: 'ok'; readonly codes: string[] }
  /** The portal has no standards route for keys yet (it predates `#924`), or it cannot be read. */
  | { readonly status: 'unavailable' };

/** `GET /api/ci/projects/{slug}/frameworks` (`#924`): the standards the project has claimed. */
export async function readClaimedStandards(opts: PortalReadOptions): Promise<StandardsRead> {
  if (!opts.viewerKey) return { status: 'unavailable' };
  const res = await getJson(`${base(opts)}/api/ci/projects/${encodeURIComponent(opts.slug)}/frameworks`, opts.viewerKey, opts);
  if (res === null || res.status < 200 || res.status >= 300 || res.body === null || typeof res.body !== 'object') return { status: 'unavailable' };
  const list = (res.body as { frameworks?: unknown }).frameworks;
  if (!Array.isArray(list)) return { status: 'unavailable' };
  const codes = list.flatMap((f) => (f !== null && typeof f === 'object' && typeof (f as { code?: unknown }).code === 'string' ? [(f as { code: string }).code] : []));
  return { status: 'ok', codes };
}

export interface PortalWriteOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

export type WriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly unavailable: boolean; readonly message: string };

async function send(method: string, url: string, token: string, body: unknown, opts: PortalWriteOptions): Promise<WriteResult> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, init) => fetch(u, init));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await doFetch(url, {
      method,
      headers: { 'x-devaudit-token': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true };
    // An older portal answers an unknown route with 404/405, and ignores an unknown field with
    // "no valid fields to update" (400): all of them mean the feature is not there.
    const unavailable = res.status === 400 || res.status === 404 || res.status === 405 || (res.status >= 300 && res.status < 400);
    return { ok: false, unavailable, message: `the portal answered HTTP ${res.status}` };
  } catch {
    return { ok: false, unavailable: false, message: 'the portal could not be reached' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Set the project's approval policy (tier B). `PATCH /api/projects/{id}` with `{ approval_policy, reason }`,
 * the project admin's personal access token in `X-DevAudit-Token` (`metasession-dev/devaudit#931`).
 */
export async function setApprovalPolicy(opts: PortalWriteOptions, policy: PortalApprovalPolicy, reason: string): Promise<WriteResult> {
  return send('PATCH', `${opts.baseUrl.replace(/\/$/, '')}/api/projects/${encodeURIComponent(opts.projectId)}`, opts.token, { approval_policy: policy, reason }, opts);
}

/** Claim one standard (tier B). `POST /api/projects/{id}/frameworks` with `{ framework }` (`#924`). */
export async function claimStandard(opts: PortalWriteOptions, code: string): Promise<WriteResult> {
  return send('POST', `${opts.baseUrl.replace(/\/$/, '')}/api/projects/${encodeURIComponent(opts.projectId)}/frameworks`, opts.token, { framework: code }, opts);
}
