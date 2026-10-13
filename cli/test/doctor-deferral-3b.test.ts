import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  buildDeferralContext,
  checkDeferredTicketNotOnPortal,
  checkPortalDeferredNotInTicket,
  checkStaleDeferrals,
  deferralReasonFromIntent,
} from '../src/commands/doctor-deferral.js';
import { readDeferralMaxAgeDays } from '../src/lib/sdlc-config.js';
import { fixtureRepo, writeTicket } from './helpers-doctor-fixture.js';

const BASE = 'https://devaudit.test';
const cfg = { project_slug: 'fixture', devaudit: { project_slug: 'fixture', base_url: BASE } };
const NOW = new Date('2026-10-12T00:00:00Z');

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  delete process.env['DEVAUDIT_VIEWER_API_KEY'];
  delete process.env['DEVAUDIT_API_KEY'];
});

type Latest = Record<string, unknown>;
const portal = (map: Record<string, Latest>, seen: string[] = []) =>
  http.get(`${BASE}/api/ci/releases/resolve`, ({ request }) => {
    seen.push(request.headers.get('authorization') ?? '');
    const l = map[new URL(request.url).searchParams.get('versionPrefix') ?? ''];
    return l ? HttpResponse.json({ latest: l }) : new HttpResponse(null, { status: 404 });
  });

async function ctxFor(dir: string, c: Record<string, unknown> = cfg) {
  return { ...(await buildDeferralContext(dir, c, async () => null)), now: () => NOW };
}

describe('readDeferralMaxAgeDays', () => {
  it('defaults to 30, accepts positive integers, rejects the rest', () => {
    expect(readDeferralMaxAgeDays({})).toEqual({ days: 30, invalid: false });
    expect(readDeferralMaxAgeDays({ deferral_max_age_days: 7 })).toEqual({ days: 7, invalid: false });
    for (const bad of [0, -3, 2.5, '10', null, true]) {
      expect(readDeferralMaxAgeDays({ deferral_max_age_days: bad })).toEqual({ days: 30, invalid: true });
    }
  });
});

describe('deferralReasonFromIntent', () => {
  it('strips the keyword and separator', () => {
    expect(deferralReasonFromIntent('deferred-to-next — PR closed')).toBe('PR closed');
    expect(deferralReasonFromIntent('deferred-to-next - x')).toBe('x');
    expect(deferralReasonFromIntent('deferred-to-next')).toBe('');
    expect(deferralReasonFromIntent(null)).toBe('');
  });
});

describe('D1 deferred-portal-sync', () => {
  it('flags a deferred ticket whose portal release is deferrable but not deferred (viewer key used)', async () => {
    process.env['DEVAUDIT_VIEWER_API_KEY'] = 'viewer-secret';
    const seen: string[] = [];
    server.use(portal({ 'REQ-030': { id: 'rel-30', status: 'uat_approved' } }, seen));
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-030', { intent: 'deferred-to-next — waiting on API' });
    const r = await checkDeferredTicketNotOnPortal(await ctxFor(dir));
    expect(r.ok).toBe(false);
    expect(r.findings?.[0]?.remediation).toMatchObject({
      id: 'defer-portal-release',
      tier: 'B',
      needsPortal: true,
      data: { version: 'REQ-030', releaseId: 'rel-30', reason: 'waiting on API' },
    });
    expect(seen).toEqual(['Bearer viewer-secret']);
    expect(JSON.stringify(r)).not.toContain('viewer-secret');
  });

  it('negatives: already deferred, released (not deferrable), not found, no deferred tickets', async () => {
    process.env['DEVAUDIT_VIEWER_API_KEY'] = 'k';
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-030', { intent: 'deferred-to-next — x' });
    server.use(portal({ 'REQ-030': { id: 'a', status: 'deferred' } }));
    expect((await checkDeferredTicketNotOnPortal(await ctxFor(dir))).ok).toBe(true);
    server.use(portal({ 'REQ-030': { id: 'a', status: 'released' } }));
    expect((await checkDeferredTicketNotOnPortal(await ctxFor(dir))).ok).toBe(true);
    server.use(portal({}));
    expect((await checkDeferredTicketNotOnPortal(await ctxFor(dir))).ok).toBe(true);
    const empty = await fixtureRepo(cfg);
    await writeTicket(empty, 'REQ-031');
    expect((await checkDeferredTicketNotOnPortal(await ctxFor(empty))).detail).toBe('no deferred tickets');
  });

  it('skips gracefully without a key, with a note, never failing', async () => {
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-030', { intent: 'deferred-to-next — x' });
    const r = await checkDeferredTicketNotOnPortal(await ctxFor(dir));
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/^skipped \(no DEVAUDIT_VIEWER_API_KEY/);
  });

  it('notes an unreachable portal instead of failing', async () => {
    process.env['DEVAUDIT_VIEWER_API_KEY'] = 'k';
    server.use(http.get(`${BASE}/api/ci/releases/resolve`, () => new HttpResponse(null, { status: 500 })));
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-030', { intent: 'deferred-to-next — x' });
    const r = await checkDeferredTicketNotOnPortal(await ctxFor(dir));
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('portal portal returned 500');
  });
});

describe('D2 deferred-ticket-sync', () => {
  it('flags a portal-deferred release whose ticket is not marked, carrying the portal reason', async () => {
    process.env['DEVAUDIT_API_KEY'] = 'k';
    server.use(portal({ 'REQ-040': { id: 'r40', status: 'deferred', deferredReason: 'blocked by vendor' } }));
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-040');
    const r = await checkPortalDeferredNotInTicket(await ctxFor(dir));
    expect(r.ok).toBe(false);
    expect(r.findings?.[0]?.remediation).toMatchObject({
      id: 'mark-ticket-deferred',
      tier: 'A',
      needsPortal: false,
      data: { version: 'REQ-040', ticketPath: 'compliance/pending-releases/RELEASE-TICKET-REQ-040.md', reason: 'blocked by vendor' },
    });
  });

  it('negatives: ticket already marked, portal not deferred, no key', async () => {
    process.env['DEVAUDIT_API_KEY'] = 'k';
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-040', { intent: 'deferred-to-next — x' });
    server.use(portal({ 'REQ-040': { id: 'r', status: 'deferred' } }));
    expect((await checkPortalDeferredNotInTicket(await ctxFor(dir))).detail).toMatch(/no undeclared/);
    const d2 = await fixtureRepo(cfg);
    await writeTicket(d2, 'REQ-041');
    server.use(portal({ 'REQ-041': { id: 'r', status: 'draft' } }));
    expect((await checkPortalDeferredNotInTicket(await ctxFor(d2))).ok).toBe(true);
    delete process.env['DEVAUDIT_API_KEY'];
    expect((await checkPortalDeferredNotInTicket(await ctxFor(d2))).detail).toMatch(/^skipped/);
  });
});

describe('D5 deferral-age', () => {
  const deferred = (over: Latest) => ({ id: 'r50', status: 'deferred', deferredAt: '2026-09-01T00:00:00Z', ...over });

  it('flags a deferral older than the default 30 days', async () => {
    process.env['DEVAUDIT_API_KEY'] = 'k';
    server.use(portal({ 'REQ-050': deferred({}) }));
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-050', { intent: 'deferred-to-next — x' });
    const r = await checkStaleDeferrals(await ctxFor(dir));
    expect(r.ok).toBe(false);
    expect(r.findings?.[0]?.detail).toContain('deferred 41 days (limit 30)');
    expect(r.findings?.[0]?.remediation).toMatchObject({ id: 'resume-stale-deferral', tier: 'B', data: { releaseId: 'r50' } });
  });

  it('honours deferral_max_age_days from sdlc-config.json', async () => {
    process.env['DEVAUDIT_API_KEY'] = 'k';
    server.use(portal({ 'REQ-050': deferred({}) }));
    const c = { ...cfg, deferral_max_age_days: 90 };
    const dir = await fixtureRepo(c);
    await writeTicket(dir, 'REQ-050', { intent: 'deferred-to-next — x' });
    expect((await checkStaleDeferrals(await ctxFor(dir, c))).ok).toBe(true);
  });

  it('notes an invalid setting and falls back to 30', async () => {
    process.env['DEVAUDIT_API_KEY'] = 'k';
    server.use(portal({ 'REQ-050': deferred({ deferredAt: '2026-10-10T00:00:00Z' }) }));
    const c = { ...cfg, deferral_max_age_days: -5 };
    const dir = await fixtureRepo(c);
    await writeTicket(dir, 'REQ-050', { intent: 'deferred-to-next — x' });
    const r = await checkStaleDeferrals(await ctxFor(dir, c));
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('invalid deferral_max_age_days');
  });

  it('flags a release past its review-by date even when young', async () => {
    process.env['DEVAUDIT_API_KEY'] = 'k';
    server.use(portal({ 'REQ-050': deferred({ deferredAt: '2026-10-10T00:00:00Z', deferredUntil: '2026-10-11' }) }));
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-050', { intent: 'deferred-to-next — x' });
    const r = await checkStaleDeferrals(await ctxFor(dir));
    expect(r.ok).toBe(false);
    expect(r.findings?.[0]?.detail).toContain('past its review-by date 2026-10-11');
  });

  it('is clean for a fresh deferral and skips without a key', async () => {
    process.env['DEVAUDIT_API_KEY'] = 'k';
    server.use(portal({ 'REQ-050': deferred({ deferredAt: '2026-10-10T00:00:00Z', deferredUntil: '2027-01-01' }) }));
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-050', { intent: 'deferred-to-next — x' });
    expect((await checkStaleDeferrals(await ctxFor(dir))).ok).toBe(true);
    delete process.env['DEVAUDIT_API_KEY'];
    expect((await checkStaleDeferrals(await ctxFor(dir))).detail).toMatch(/^skipped/);
  });
});
