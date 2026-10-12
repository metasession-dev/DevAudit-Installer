import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execa } from 'execa';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { runFix, type FixDeps } from '../src/commands/doctor-fix.js';
import type { Proposal } from '../src/lib/doctor-types.js';
import { DeferralApiError, deferRelease, resumeRelease } from '../src/lib/release-deferral-api.js';
import { fixtureRepo, writeRtm, writeTicket } from './helpers-doctor-fixture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'devaudit.js');
const PAT = 'mctok_fake_pat_for_tests';

interface Hit { path: string; method: string; token: string | undefined; auth: string | undefined; body: unknown }
let srv: Server;
let base = '';
let hits: Hit[] = [];
let releases: Record<string, Record<string, unknown>> = {};
let postStatus = 200;
let postJson: Record<string, unknown> = { status: 'deferred', uatApprovalIdsAtDefer: ['appr-1'] };

beforeAll(async () => {
  srv = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://x');
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && u.pathname === '/api/ci/releases/resolve') {
        const l = releases[u.searchParams.get('versionPrefix') ?? ''];
        if (!l) { res.statusCode = 404; res.end(); return; }
        res.end(JSON.stringify({ latest: l }));
        return;
      }
      hits.push({
        path: u.pathname, method: req.method ?? '',
        token: req.headers['x-devaudit-token'] as string | undefined,
        auth: req.headers['authorization'] as string | undefined,
        body: raw ? JSON.parse(raw) : null,
      });
      res.statusCode = postStatus;
      res.end(JSON.stringify(postJson));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const a = srv.address();
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));
beforeEach(() => {
  hits = [];
  releases = {};
  postStatus = 200;
  postJson = { status: 'deferred', uatApprovalIdsAtDefer: ['appr-1'] };
});

const cfg = () => ({ project_slug: 'fixture', devaudit: { project_slug: 'fixture', base_url: base } });

async function env(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const home = await fsp.mkdtemp(join(tmpdir(), 'devaudit-fix-home-'));
  const e: NodeJS.ProcessEnv = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, USERPROFILE: home, ...extra };
  for (const k of ['CI', 'DEVAUDIT_API_KEY', 'DEVAUDIT_VIEWER_API_KEY', 'DEVAUDIT_USER_TOKEN', 'DEVAUDIT_BASE_URL']) {
    if (!(k in extra)) delete e[k];
  }
  return e;
}

interface FixJson { ok: boolean; proposals: Proposal[]; fix?: { dryRun: boolean; unapplied: number; outcomes: Array<{ id: string; tier: string; status: string; message: string; uatApprovalIdsAtDefer?: string[] }> } }
async function doctor(dir: string, args: string[], e: NodeJS.ProcessEnv) {
  const r = await execa('node', [BIN, 'doctor', ...args], { cwd: dir, env: e, reject: false });
  return { exitCode: r.exitCode, out: r.stdout, err: r.stderr, json: args.includes('--json') ? (JSON.parse(r.stdout) as FixJson) : null };
}
const read = (dir: string, rel: string) => fsp.readFile(join(dir, rel), 'utf-8');
const TICKET = 'compliance/pending-releases/RELEASE-TICKET-REQ-040.md';

/** D2: portal says deferred, local ticket/RTM unmarked. */
async function d2Fixture(): Promise<string> {
  releases['REQ-040'] = { id: 'rel-40', status: 'deferred', deferredReason: 'vendor outage', deferredAt: new Date().toISOString() };
  const dir = await fixtureRepo(cfg());
  await writeTicket(dir, 'REQ-040', { preds: 'None' });
  await writeRtm(dir, { 'REQ-040': 'TESTED - PENDING SIGN-OFF' });
  return dir;
}
/** D1: ticket deferred, portal release still draft. */
async function d1Fixture(): Promise<string> {
  releases['REQ-041'] = { id: 'rel-41', status: 'draft' };
  const dir = await fixtureRepo(cfg());
  await writeTicket(dir, 'REQ-041', { intent: 'deferred-to-next — waiting on vendor' });
  return dir;
}

describe('doctor --fix: plain doctor stays read-only', () => {
  it('does not mutate, does not call defer/resume, no `fix` key, exit code unchanged', async () => {
    const dir = await d1Fixture();
    const before = await read(dir, 'compliance/pending-releases/RELEASE-TICKET-REQ-041.md');
    const r = await doctor(dir, ['--json'], await env({ DEVAUDIT_USER_TOKEN: PAT, DEVAUDIT_VIEWER_API_KEY: 'v' }));
    expect([0, 6]).toContain(r.exitCode);
    expect(r.json!.fix).toBeUndefined();
    expect(r.json!.proposals.some((p) => p.remediation.id === 'defer-portal-release')).toBe(true);
    expect(hits).toEqual([]);
    expect(await read(dir, 'compliance/pending-releases/RELEASE-TICKET-REQ-041.md')).toBe(before);
  }, 30_000);
});

describe('doctor --fix: tier A (local edits)', () => {
  it('without --yes and without a TTY: nothing applied, exit 8, files untouched', async () => {
    const dir = await d2Fixture();
    const before = await read(dir, TICKET);
    const r = await doctor(dir, ['--fix', '--json'], await env({ DEVAUDIT_VIEWER_API_KEY: 'v' }));
    expect(r.exitCode).toBe(8);
    expect(r.json!.fix!.unapplied).toBe(1);
    expect(r.json!.fix!.outcomes[0]).toMatchObject({ id: 'mark-ticket-deferred', tier: 'A', status: 'unapplied' });
    expect(await read(dir, TICKET)).toBe(before);
  }, 30_000);

  it('CI set without --yes: same non-zero exit even though --json is absent', async () => {
    const dir = await d2Fixture();
    const r = await doctor(dir, ['--fix'], await env({ DEVAUDIT_VIEWER_API_KEY: 'v', CI: 'true' }));
    expect(r.exitCode).toBe(8);
    expect(r.out + r.err).toContain('remain unapplied');
    expect(await read(dir, TICKET)).not.toContain('Release intent');
  }, 30_000);

  it('--yes applies the ticket field and RTM DEFERRED; a second run changes nothing', async () => {
    const dir = await d2Fixture();
    const e = await env({ DEVAUDIT_VIEWER_API_KEY: 'v' });
    const r1 = await doctor(dir, ['--fix', '--yes', '--json'], e);
    expect(r1.exitCode).toBe(0);
    expect(r1.json!.fix!.outcomes[0]).toMatchObject({ status: 'applied' });
    const t1 = await read(dir, TICKET);
    const rtm1 = await read(dir, 'compliance/RTM.md');
    expect(t1).toContain('- **Release intent:** deferred-to-next — vendor outage');
    expect(rtm1).toContain('| REQ-040 | thing | DEFERRED |');
    const r2 = await doctor(dir, ['--fix', '--yes', '--json'], e);
    expect(r2.exitCode).toBe(0);
    expect(r2.json!.proposals.filter((p) => p.remediation.id === 'mark-ticket-deferred')).toEqual([]);
    expect(await read(dir, TICKET)).toBe(t1);
    expect(await read(dir, 'compliance/RTM.md')).toBe(rtm1);
    expect(hits).toEqual([]); // tier A never touches the portal
  }, 60_000);

  it('--dry-run prints planned steps, changes nothing, exits 0', async () => {
    const dir = await d2Fixture();
    const before = await read(dir, TICKET);
    const r = await doctor(dir, ['--fix', '--dry-run', '--json'], await env({ DEVAUDIT_VIEWER_API_KEY: 'v' }));
    expect(r.exitCode).toBe(0);
    expect(r.json!.fix).toMatchObject({ dryRun: true, unapplied: 0 });
    expect(r.json!.fix!.outcomes[0]).toMatchObject({ status: 'planned' });
    expect(await read(dir, TICKET)).toBe(before);
    const human = await doctor(dir, ['--fix', '--dry-run', '--yes'], await env({ DEVAUDIT_VIEWER_API_KEY: 'v' }));
    expect(human.out).toContain('dry run');
    expect(human.out).toContain('planned');
    expect(await read(dir, TICKET)).toBe(before);
  }, 60_000);
});

describe('doctor --fix: tier B (portal defer)', () => {
  it('--yes alone (no reason) never defers', async () => {
    const dir = await d1Fixture();
    const r = await doctor(dir, ['--fix', '--yes', '--json'], await env({ DEVAUDIT_USER_TOKEN: PAT, DEVAUDIT_VIEWER_API_KEY: 'v' }));
    expect(r.exitCode).toBe(8);
    expect(r.json!.fix!.outcomes[0]).toMatchObject({ id: 'defer-portal-release', tier: 'B', status: 'unapplied' });
    expect(r.json!.fix!.outcomes[0]!.message).toMatch(/--reason/);
    expect(hits).toEqual([]);
  }, 30_000);

  it('--reason without --yes (non-interactive) never defers', async () => {
    const dir = await d1Fixture();
    const r = await doctor(dir, ['--fix', '--reason', 'why', '--json'], await env({ DEVAUDIT_USER_TOKEN: PAT, DEVAUDIT_VIEWER_API_KEY: 'v' }));
    expect(r.exitCode).toBe(8);
    expect(hits).toEqual([]);
  }, 30_000);

  it('--yes --reason defers with the PAT header only, and surfaces the audit approval ids', async () => {
    const dir = await d1Fixture();
    const r = await doctor(dir, ['--fix', '--yes', '--reason', 'waiting on vendor', '--json'], await env({ DEVAUDIT_USER_TOKEN: PAT, DEVAUDIT_VIEWER_API_KEY: 'viewer-secret' }));
    expect(r.exitCode).toBe(0);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: '/api/releases/rel-41/defer', method: 'POST', token: PAT, body: { reason: 'waiting on vendor' } });
    expect(hits[0]!.auth).toBeUndefined();
    expect(r.json!.fix!.outcomes[0]).toMatchObject({ status: 'applied', uatApprovalIdsAtDefer: ['appr-1'] });
    expect(r.json!.fix!.outcomes[0]!.message).toContain('uat_approval_ids_at_defer: appr-1');
    expect(r.out + r.err).not.toContain(PAT);
    expect(r.out + r.err).not.toContain('viewer-secret');
  }, 30_000);

  it('refuses when only API/viewer keys exist (no PAT); never calls the portal, never prints the keys', async () => {
    const dir = await d1Fixture();
    const r = await doctor(dir, ['--fix', '--yes', '--reason', 'x', '--json'], await env({ DEVAUDIT_API_KEY: 'api-secret', DEVAUDIT_VIEWER_API_KEY: 'viewer-secret' }));
    expect(r.exitCode).toBe(8);
    expect(r.json!.fix!.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(r.json!.fix!.outcomes[0]!.message).toMatch(/personal access token/);
    expect(hits).toEqual([]);
    expect(r.out + r.err).not.toContain('api-secret');
    expect(r.out + r.err).not.toContain('viewer-secret');
  }, 30_000);

  it.each([
    [403, /not a portal admin/],
    [409, /409/],
    [422, /422/],
  ])('reports a portal %i as a failed (unapplied) outcome and exits 8', async (status, re) => {
    postStatus = status;
    postJson = { error: 'nope' };
    const dir = await d1Fixture();
    const r = await doctor(dir, ['--fix', '--yes', '--reason', 'x', '--json'], await env({ DEVAUDIT_USER_TOKEN: PAT, DEVAUDIT_VIEWER_API_KEY: 'v' }));
    expect(r.exitCode).toBe(8);
    expect(r.json!.fix!.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(r.json!.fix!.outcomes[0]!.message).toMatch(re);
  }, 30_000);
});

describe('doctor --fix: flag handling', () => {
  it('--fleet with --fix is rejected with a clear error (exit 2) and runs nothing', async () => {
    const dir = await d2Fixture();
    const r = await doctor(dir, ['--fleet', '--fix'], await env());
    expect(r.exitCode).toBe(2);
    expect(r.out + r.err).toMatch(/--fleet is read-only and never forwards --fix/);
    const r2 = await doctor(dir, ['--fleet', '--reason', 'x'], await env());
    expect(r2.exitCode).toBe(2);
  }, 30_000);

  it('--reason without --fix is rejected', async () => {
    const dir = await d2Fixture();
    const r = await doctor(dir, ['--reason', 'x'], await env());
    expect(r.exitCode).toBe(2);
  }, 30_000);

  it('JSON shape: existing keys kept, additive fix key', async () => {
    const dir = await d2Fixture();
    const r = await doctor(dir, ['--fix', '--json'], await env({ DEVAUDIT_VIEWER_API_KEY: 'v' }));
    expect(Object.keys(r.json!)).toEqual(expect.arrayContaining(['ok', 'tools', 'releaseCloseoutDrift', 'onboarding', 'deferral', 'proposals', 'fix']));
    expect(Object.keys(r.json!.fix!).sort()).toEqual(['dryRun', 'outcomes', 'unapplied']);
  }, 30_000);

  it('--help documents --fix and --reason', async () => {
    const r = await execa('node', [BIN, 'doctor', '--help'], { reject: false });
    expect(r.stdout).toContain('--fix');
    expect(r.stdout).toContain('--reason <text>');
  }, 30_000);
});

// ---- interactive paths, via injected prompts ------------------------------

const prop = (id: string, tier: 'A' | 'B' | 'C', data: Record<string, string> = {}): Proposal => ({
  check: 'x', subject: data['version'] ?? 'REQ-1', detail: 'd',
  remediation: { id, tier, summary: `do ${id}`, plan: ['p'], needsPortal: tier === 'B', data },
});

function asks(over: Partial<NonNullable<FixDeps['ask']>> = {}): NonNullable<FixDeps['ask']> {
  return {
    confirm: async () => true,
    input: async () => 'typed reason',
    select: async () => 'defer',
    nonInteractiveReason: () => null,
    ...over,
  };
}

describe('runFix interactive behaviour', () => {
  const calls: Array<{ verb: string; reason?: string }> = [];
  const deps = async (over: Partial<FixDeps> = {}): Promise<FixDeps> => ({
    repoRoot: await fixtureRepo(cfg()),
    baseUrl: base,
    credential: async () => ({ token: PAT, baseUrl: base, source: 'env' }),
    defer: async (_c, _id, req) => (calls.push({ verb: 'defer', reason: req.reason }), { uatApprovalIdsAtDefer: [] }),
    resume: async (_c, _id, reason) => (calls.push({ verb: 'resume', ...(reason ? { reason } : {}) }), { uatApprovalIdsAtDefer: [] }),
    ...over,
  });
  const base0 = { yes: false, dryRun: false, json: false };
  beforeEach(() => { calls.length = 0; });

  it('tier B: typed reason + confirmation defers; a declined confirmation does not', async () => {
    const p = prop('defer-portal-release', 'B', { version: 'REQ-1', releaseId: 'r1' });
    const ok = await runFix([p], await deps({ ask: asks() }), base0);
    expect(ok.outcomes[0]).toMatchObject({ status: 'applied' });
    expect(calls).toEqual([{ verb: 'defer', reason: 'typed reason' }]);
    calls.length = 0;
    const no = await runFix([p], await deps({ ask: asks({ confirm: async () => false }) }), base0);
    expect(no.outcomes[0]).toMatchObject({ status: 'unapplied', message: 'declined' });
    expect(no.unapplied).toBe(1);
    expect(calls).toEqual([]);
  });

  it('tier B: an empty/cancelled reason applies nothing, even with --yes', async () => {
    const p = prop('defer-portal-release', 'B', { releaseId: 'r1' });
    const r = await runFix([p], await deps({ ask: asks({ input: async () => null }) }), { ...base0, yes: true });
    expect(r.outcomes[0]).toMatchObject({ status: 'unapplied' });
    expect(calls).toEqual([]);
  });

  it('tier B: --reason + --yes skip the prompts', async () => {
    const p = prop('defer-portal-release', 'B', { releaseId: 'r1' });
    const r = await runFix([p], await deps({ ask: asks({ confirm: async () => { throw new Error('no'); }, input: async () => { throw new Error('no'); } }) }), { ...base0, yes: true, reason: 'flag reason' });
    expect(r.outcomes[0]).toMatchObject({ status: 'applied' });
    expect(calls).toEqual([{ verb: 'defer', reason: 'flag reason' }]);
  });

  it('tier A: declined confirmation leaves the file untouched', async () => {
    const d = await deps({ ask: asks({ confirm: async () => false }) });
    const file = await writeTicket(d.repoRoot, 'REQ-1', { preds: 'None' });
    const before = await fsp.readFile(file, 'utf-8');
    const p = prop('fix-absorbed-predecessors', 'A', { version: 'REQ-1', candidate: 'REQ-2', ticketPath: 'compliance/pending-releases/RELEASE-TICKET-REQ-1.md' });
    const r = await runFix([p], d, base0);
    expect(r.outcomes[0]).toMatchObject({ status: 'unapplied', message: 'declined' });
    expect(await fsp.readFile(file, 'utf-8')).toBe(before);
    const ok = await runFix([p], await deps({ repoRoot: d.repoRoot, ask: asks() }), base0);
    expect(ok.outcomes[0]).toMatchObject({ status: 'applied' });
    expect(await fsp.readFile(file, 'utf-8')).toContain('releases:** REQ-2');
    const again = await runFix([p], await deps({ repoRoot: d.repoRoot, ask: asks() }), base0);
    expect(again.outcomes[0]).toMatchObject({ status: 'unchanged' });
    expect(again.unapplied).toBe(0);
  });

  it('tier C is reported, never executed, and does not count as unapplied', async () => {
    const r = await runFix([prop('revert-x', 'C')], await deps({ ask: asks() }), base0);
    expect(r.outcomes[0]).toMatchObject({ status: 'reported', tier: 'C' });
    expect(r.unapplied).toBe(0);
  });

  it('D3: abandon / reopen are guidance only; defer writes the ticket then calls the portal', async () => {
    const d = await deps({ ask: asks({ select: async () => 'abandon' }) });
    await writeTicket(d.repoRoot, 'REQ-3', { pr: '#9' });
    await writeRtm(d.repoRoot, { 'REQ-3': 'TESTED - PENDING SIGN-OFF' });
    const p = prop('resolve-closed-release-pr', 'B', { version: 'REQ-3', releaseId: 'r3', prNumber: '9', ticketPath: 'compliance/pending-releases/RELEASE-TICKET-REQ-3.md' });
    const a = await runFix([p], d, base0);
    expect(a.outcomes[0]).toMatchObject({ status: 'unapplied' });
    expect(calls).toEqual([]);
    const dd = await deps({ repoRoot: d.repoRoot, ask: asks({ select: async () => 'defer' }) });
    const r = await runFix([p], dd, base0);
    expect(r.outcomes[0]).toMatchObject({ status: 'applied' });
    expect(await fsp.readFile(join(d.repoRoot, 'compliance/pending-releases/RELEASE-TICKET-REQ-3.md'), 'utf-8')).toContain('deferred-to-next — typed reason');
    expect(await fsp.readFile(join(d.repoRoot, 'compliance/RTM.md'), 'utf-8')).toContain('DEFERRED');
    expect(calls).toEqual([{ verb: 'defer', reason: 'typed reason' }]);
  });

  it('D3 non-interactive needs both --yes and --reason', async () => {
    const ni = asks({ nonInteractiveReason: () => 'no TTY', select: async () => null, input: async () => null, confirm: async () => null });
    const d = await deps({ ask: ni });
    await writeTicket(d.repoRoot, 'REQ-3', {});
    const p = prop('resolve-closed-release-pr', 'B', { version: 'REQ-3', releaseId: 'r3', prNumber: '9', ticketPath: 'compliance/pending-releases/RELEASE-TICKET-REQ-3.md' });
    expect((await runFix([p], d, { ...base0, yes: true })).outcomes[0]!.status).toBe('unapplied');
    expect((await runFix([p], d, { ...base0, reason: 'r' })).outcomes[0]!.status).toBe('unapplied');
    expect(calls).toEqual([]);
    expect((await runFix([p], d, { ...base0, yes: true, reason: 'r' })).outcomes[0]!.status).toBe('applied');
  });

  it('resume clears the ticket intent and restores the RTM status', async () => {
    const d = await deps({ ask: asks() });
    await writeTicket(d.repoRoot, 'REQ-5', { intent: 'deferred-to-next — old' });
    await writeRtm(d.repoRoot, { 'REQ-5': 'DEFERRED' });
    const p = prop('resume-stale-deferral', 'B', { version: 'REQ-5', releaseId: 'r5', ticketPath: 'compliance/pending-releases/RELEASE-TICKET-REQ-5.md' });
    const r = await runFix([p], d, base0);
    expect(r.outcomes[0]).toMatchObject({ status: 'applied' });
    expect(calls[0]!.verb).toBe('resume');
    expect(await fsp.readFile(join(d.repoRoot, 'compliance/pending-releases/RELEASE-TICKET-REQ-5.md'), 'utf-8')).not.toContain('Release intent');
    expect(await fsp.readFile(join(d.repoRoot, 'compliance/RTM.md'), 'utf-8')).toContain('TESTED - PENDING SIGN-OFF');
  });

  it('list-deferred-predecessor needs exactly one next ticket', async () => {
    const d = await deps({ ask: asks() });
    await writeTicket(d.repoRoot, 'REQ-6', { intent: 'deferred-to-next — x' });
    const p = prop('list-deferred-predecessor', 'A', { deferred: 'REQ-6' });
    expect((await runFix([p], d, base0)).outcomes[0]!.message).toMatch(/no next release ticket/);
    await writeTicket(d.repoRoot, 'REQ-7', { preds: 'None' });
    const ok = await runFix([p], d, { ...base0, yes: true });
    expect(ok.outcomes[0]).toMatchObject({ status: 'applied' });
    await writeTicket(d.repoRoot, 'REQ-8', {});
    expect((await runFix([p], d, base0)).outcomes[0]!.message).toMatch(/candidate release tickets/);
  });
});

describe('real client error mapping through the fix path', () => {
  it('DeferralApiError is exported for callers', () => {
    expect(new DeferralApiError('forbidden', 'm', 403).kind).toBe('forbidden');
    expect(typeof deferRelease).toBe('function');
    expect(typeof resumeRelease).toBe('function');
  });
});
