import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  DeferralApiError,
  DeferralCredentialError,
  deferRelease,
  resolveDeferralCredential,
  resumeRelease,
} from '../src/lib/release-deferral-api.js';

const BASE = 'https://portal.test';
const PAT = 'mctok_fake_pat_value';
const ctx = { baseUrl: BASE, token: PAT, timeoutMs: 500 };

let seen: { headers: Headers; body: unknown; url: string } | null = null;
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  seen = null;
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

function stub(verb: 'defer' | 'resume', status: number, json: unknown) {
  server.use(
    http.post(`${BASE}/api/releases/:id/${verb}`, async ({ request }) => {
      seen = { headers: request.headers, body: await request.json(), url: request.url };
      return HttpResponse.json(json as never, { status });
    }),
  );
}

describe('deferRelease / resumeRelease', () => {
  it('sends the PAT header (never Authorization: Bearer) and the minimal body', async () => {
    stub('defer', 200, { status: 'deferred', uatApprovalIdsAtDefer: ['a1', 'a2'] });
    const r = await deferRelease(ctx, 'rel-1', { reason: 'PR closed', untilDate: '2026-12-01', toVersion: 'REQ-050' });
    expect(r).toEqual({ status: 'deferred', uatApprovalIdsAtDefer: ['a1', 'a2'] });
    expect(seen!.headers.get('x-devaudit-token')).toBe(PAT);
    expect(seen!.headers.get('authorization')).toBeNull();
    expect(seen!.body).toEqual({ reason: 'PR closed', deferredUntil: '2026-12-01', deferredToVersion: 'REQ-050' });
    expect(seen!.url).toBe(`${BASE}/api/releases/rel-1/defer`);
  });

  it('omits optional fields and tolerates a response without approval ids', async () => {
    stub('defer', 200, { status: 'deferred' });
    const r = await deferRelease(ctx, 'rel-1', { reason: 'x' });
    expect(r.uatApprovalIdsAtDefer).toEqual([]);
    expect(seen!.body).toEqual({ reason: 'x' });
  });

  it('resume posts to /resume', async () => {
    stub('resume', 200, { status: 'draft' });
    expect((await resumeRelease(ctx, 'rel-9')).status).toBe('draft');
    expect(seen!.url).toBe(`${BASE}/api/releases/rel-9/resume`);
  });

  it.each([
    [401, 'unauthenticated', /401/],
    [403, 'forbidden', /not a portal admin/],
    [404, 'not-found', /404/],
    [409, 'conflict', /409/],
    [422, 'invalid', /422/],
    [500, 'server', /Portal error/],
  ])('maps HTTP %i to a typed error that never leaks the token', async (status, kind, re) => {
    stub('defer', status, { error: `bad token ${PAT}` });
    const err = await deferRelease(ctx, 'rel-1', { reason: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(DeferralApiError);
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
    expect(err.message).toMatch(re);
    expect(err.message).not.toContain(PAT);
  });

  it('treats a sign-in redirect as "route does not accept a PAT", never success (#1099 WP5)', async () => {
    server.use(http.post(`${BASE}/api/releases/:id/defer`, () => HttpResponse.redirect(`${BASE}/auth/sign-in`, 307)));
    const err = await deferRelease(ctx, 'rel-1', { reason: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(DeferralApiError);
    expect(err.kind).toBe('unsupported-auth');
    expect(err.message).toMatch(/does not accept a personal access token; use the portal UI/);
  });

  it('treats a 2xx HTML body as unsupported-auth', async () => {
    server.use(http.post(`${BASE}/api/releases/:id/resume`, () => new HttpResponse('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    const err = await resumeRelease(ctx, 'rel-1').catch((e) => e);
    expect(err.kind).toBe('unsupported-auth');
  });

  it('treats a 2xx JSON body without `status` as unsupported-auth', async () => {
    stub('defer', 200, { ok: true });
    const err = await deferRelease(ctx, 'rel-1', { reason: 'x' }).catch((e) => e);
    expect(err.kind).toBe('unsupported-auth');
  });

  it('times out', async () => {
    server.use(http.post(`${BASE}/api/releases/:id/defer`, async () => new Promise(() => {})));
    const err = await deferRelease({ ...ctx, timeoutMs: 50 }, 'r', { reason: 'x' }).catch((e) => e);
    expect(err.kind).toBe('timeout');
  });

  it('reports network errors', async () => {
    server.use(http.post(`${BASE}/api/releases/:id/defer`, () => HttpResponse.error()));
    const err = await deferRelease(ctx, 'r', { reason: 'x' }).catch((e) => e);
    expect(err.kind).toBe('network');
  });
});

describe('resolveDeferralCredential', () => {
  beforeEach(() => {
    vi.stubEnv('DEVAUDIT_USER_TOKEN', '');
    vi.stubEnv('HOME', '/nonexistent-home-for-test');
    vi.stubEnv('XDG_CONFIG_HOME', '/nonexistent-home-for-test');
  });

  it('accepts a PAT from DEVAUDIT_USER_TOKEN', async () => {
    vi.stubEnv('DEVAUDIT_USER_TOKEN', PAT);
    vi.stubEnv('DEVAUDIT_BASE_URL', BASE);
    const c = await resolveDeferralCredential();
    expect(c.token).toBe(PAT);
    expect(c.baseUrl).toBe(BASE);
  });

  it('refuses when only API/viewer keys exist, without echoing them', async () => {
    vi.stubEnv('DEVAUDIT_API_KEY', 'api_key_secret_value');
    vi.stubEnv('DEVAUDIT_VIEWER_API_KEY', 'viewer_key_secret_value');
    const err = await resolveDeferralCredential().catch((e) => e);
    expect(err).toBeInstanceOf(DeferralCredentialError);
    expect(err.message).toMatch(/never accepted/);
    expect(err.message).not.toContain('secret_value');
  });

  it('refuses an API key placed in DEVAUDIT_USER_TOKEN', async () => {
    vi.stubEnv('DEVAUDIT_API_KEY', 'api_key_secret_value');
    vi.stubEnv('DEVAUDIT_USER_TOKEN', 'api_key_secret_value');
    const err = await resolveDeferralCredential().catch((e) => e);
    expect(err).toBeInstanceOf(DeferralCredentialError);
    expect(err.message).not.toContain('secret_value');
  });
});
