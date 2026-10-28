import { resolveToken } from './auth.js';

/**
 * devaudit-installer#956 phase 3b — portal defer/resume client (ADMIN-ONLY).
 *
 * Authenticated by a human personal access token (PAT) ONLY, sent as
 * `X-DevAudit-Token` (the header scheme the portal's
 * `POST /api/releases/<id>/submit-review` accepts a PAT with). It is never given
 * `DEVAUDIT_API_KEY`, `DEVAUDIT_VIEWER_API_KEY` or any CI key; if the only
 * credential at hand is one of those, `resolveDeferralCredential` throws a
 * `DeferralCredentialError`. No secret is ever included in an error message.
 *
 * Only a JSON 2xx carrying `status` counts as success: the portal answers a PAT on
 * these session-only routes with a redirect to HTML sign-in (#1099 WP5).
 *
 * Request shape (verified against the portal route handlers
 * app/api/releases/[id]/defer|resume/route.ts; the portal returns 400 for
 * validation AND wrong-state errors, 409 only for a concurrent change):
 *   POST {base}/api/releases/{id}/defer   body {"reason": string, "deferredUntil"?: date string, "deferredToVersion"?: string}
 *   POST {base}/api/releases/{id}/resume  body {} (optional {"reason"})
 *   200/2xx JSON; optional `uatApprovalIdsAtDefer` (or `uat_approval_ids_at_defer`) array in the response.
 */

export type DeferralErrorKind =
  | 'unauthenticated' // 401
  | 'forbidden' // 403 — not an admin
  | 'not-found' // 404
  | 'conflict' // 409 — wrong state
  | 'invalid' // 422
  | 'unsupported-auth' // 3xx sign-in redirect, non-JSON or unexpected 2xx: route is session-only
  | 'server'
  | 'timeout'
  | 'network';

export class DeferralCredentialError extends Error {
  override readonly name = 'DeferralCredentialError';
}

export class DeferralApiError extends Error {
  override readonly name = 'DeferralApiError';
  constructor(
    readonly kind: DeferralErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface DeferralCredential {
  readonly token: string;
  readonly baseUrl: string;
  readonly source: 'env' | 'file';
}

export interface DeferralClientContext {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
}

export interface DeferRequest {
  readonly reason: string;
  readonly untilDate?: string;
  readonly toVersion?: string;
}

export interface DeferralResult {
  readonly status?: string;
  readonly uatApprovalIdsAtDefer: readonly string[];
}

/**
 * Resolve the operator's PAT via `resolveToken()` (env DEVAUDIT_USER_TOKEN or
 * the `devaudit auth login` cache). Refuses explicitly when the token equals an
 * API/viewer key, and when no PAT exists says so (naming the API/viewer keys
 * as unusable, never their values).
 */
export async function resolveDeferralCredential(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeferralCredential> {
  const resolved = await resolveToken();
  const ciKeys = [env['DEVAUDIT_API_KEY'], env['DEVAUDIT_VIEWER_API_KEY']].filter(
    (k): k is string => typeof k === 'string' && k.length > 0,
  );
  if (resolved && ciKeys.includes(resolved.token)) {
    throw new DeferralCredentialError(
      'DEVAUDIT_USER_TOKEN holds an API/viewer key, not a personal access token. Defer/resume are admin-only: use a PAT from the portal (/settings/tokens).',
    );
  }
  if (!resolved) {
    const haveKeys = ciKeys.length > 0;
    throw new DeferralCredentialError(
      'No personal access token available. Defer/resume are admin-only and need a PAT (set DEVAUDIT_USER_TOKEN or run `devaudit auth login`)' +
        (haveKeys ? '; DEVAUDIT_API_KEY / DEVAUDIT_VIEWER_API_KEY are never accepted for this.' : '.'),
    );
  }
  return resolved;
}

function messageFor(kind: DeferralErrorKind, action: string, serverMsg: string | null): string {
  const tail = serverMsg ? ` (${serverMsg})` : '';
  switch (kind) {
    case 'unauthenticated':
      return `Portal rejected the token (401) for ${action}: it is missing, expired or revoked. Re-issue a PAT and run \`devaudit auth login\`.${tail}`;
    case 'forbidden':
      return `Portal refused ${action} (403): the token's user is not a portal admin for this project.${tail}`;
    case 'not-found':
      return `Portal release not found (404) for ${action}.${tail}`;
    case 'conflict':
      return `Portal refused ${action} (409): the release changed concurrently; re-run to pick up its current state.${tail}`;
    case 'invalid':
      return `Portal rejected the ${action} request (400/422): invalid reason, date or target version, or the release is not in a state that allows it (deferrable: draft, uat_review, uat_rejected, uat_approved; resume needs deferred).${tail}`;
    case 'unsupported-auth':
      return `Portal did not accept the personal access token for ${action}: this portal route does not accept a personal access token; use the portal UI.${tail}`;
    case 'server':
      return `Portal error during ${action}.${tail}`;
    case 'timeout':
      return `Portal timed out during ${action}.`;
    case 'network':
      return `Network error reaching the portal during ${action}.`;
  }
}

function kindForStatus(status: number): DeferralErrorKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 422 || status === 400) return 'invalid';
  return 'server';
}

async function post(
  ctx: DeferralClientContext,
  releaseId: string,
  verb: 'defer' | 'resume',
  body: Record<string, unknown>,
): Promise<DeferralResult> {
  const action = `release ${verb}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ctx.timeoutMs ?? 15000);
  try {
    const res = await fetch(
      `${ctx.baseUrl.replace(/\/$/, '')}/api/releases/${encodeURIComponent(releaseId)}/${verb}`,
      {
        method: 'POST',
        headers: { 'X-DevAudit-Token': ctx.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        // A session-only route answers a PAT with a redirect to the HTML sign-in page.
        // Following it would turn that into a 200, so surface it instead (#1099 WP5).
        redirect: 'manual',
      },
    );
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      throw new DeferralApiError('unsupported-auth', messageFor('unsupported-auth', action, null), res.status);
    }
    let json: Record<string, unknown> = {};
    let parsed = false;
    try {
      json = (await res.json()) as Record<string, unknown>;
      parsed = true;
    } catch {
      // empty / non-JSON body
    }
    if (!res.ok) {
      const kind = kindForStatus(res.status);
      // Server text is shown but defensively stripped of the token if echoed.
      let serverMsg = typeof json['error'] === 'string' ? (json['error'] as string) : null;
      if (serverMsg) serverMsg = serverMsg.split(ctx.token).join('[redacted]').slice(0, 200);
      throw new DeferralApiError(kind, messageFor(kind, action, serverMsg), res.status);
    }
    // A 2xx is only a success when the portal answered with its JSON `status`.
    if (!parsed || typeof json['status'] !== 'string') {
      throw new DeferralApiError('unsupported-auth', messageFor('unsupported-auth', action, null), res.status);
    }
    const ids = json['uatApprovalIdsAtDefer'] ?? json['uat_approval_ids_at_defer'];
    return {
      status: json['status'] as string,
      uatApprovalIdsAtDefer: Array.isArray(ids) ? ids.map(String) : [],
    };
  } catch (err) {
    if (err instanceof DeferralApiError) throw err;
    const kind: DeferralErrorKind = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network';
    throw new DeferralApiError(kind, messageFor(kind, action, null));
  } finally {
    clearTimeout(timer);
  }
}

export function deferRelease(
  ctx: DeferralClientContext,
  releaseId: string,
  req: DeferRequest,
): Promise<DeferralResult> {
  return post(ctx, releaseId, 'defer', {
    reason: req.reason,
    ...(req.untilDate ? { deferredUntil: req.untilDate } : {}),
    ...(req.toVersion ? { deferredToVersion: req.toVersion } : {}),
  });
}

export function resumeRelease(
  ctx: DeferralClientContext,
  releaseId: string,
  reason?: string,
): Promise<DeferralResult> {
  return post(ctx, releaseId, 'resume', reason ? { reason } : {});
}
