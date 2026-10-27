import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReleaseChecks, type ReleaseCheckDeps, type CmdResult } from '../src/commands/release-check.js';
import type { ReleaseLookup } from '../src/lib/releases-api.js';

const SHA = 'a'.repeat(40);
const VIEWER = 'viewer-secret-value';
const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

const ok = (stdout = ''): CmdResult => ({ exitCode: 0, stdout });

async function repo(tickets: string[]): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'release-check-'));
  dirs.push(dir);
  await fs.mkdir(join(dir, 'compliance', 'pending-releases'), { recursive: true });
  for (const t of tickets) await fs.writeFile(join(dir, 'compliance', 'pending-releases', `RELEASE-TICKET-${t}.md`), '# ticket\n');
  return dir;
}

async function deps(over: Partial<ReleaseCheckDeps> & { tickets?: string[] } = {}): Promise<ReleaseCheckDeps> {
  const repoRoot = await repo(over.tickets ?? ['REQ-001']);
  return {
    repoRoot,
    cfg: { integration_branch: 'develop', devaudit: { project_slug: 'example-app', base_url: 'https://portal.example' } },
    git: async (args) => {
      if (args[0] === 'status') return ok('');
      if (args[0] === 'fetch') return ok();
      if (args[0] === 'rev-parse') return ok(SHA);
      return null;
    },
    gh: async () => ok(JSON.stringify([{ name: 'CI', status: 'completed', conclusion: 'success' }])),
    lookup: async (): Promise<ReleaseLookup> => ({ kind: 'found', release: { status: 'draft' } }),
    readKey: async () => VIEWER,
    ...over,
  };
}

const byName = (r: Awaited<ReturnType<typeof runReleaseChecks>>, name: string) => r.results.find((x) => x.name === name)!;

describe('devaudit release check (#1099 WP2)', () => {
  it('is ready when the tree, branch, CI, ticket and draft portal release all pass', async () => {
    const r = await runReleaseChecks(await deps());
    expect(r.ready).toBe(true);
    expect(r.version).toBe('REQ-001');
    expect(byName(r, 'portal').detail).toMatch(/ready to submit/);
  });

  it('fails on a dirty working tree and says how to fix it', async () => {
    const r = await runReleaseChecks(await deps({ git: async (a) => (a[0] === 'status' ? ok(' M file.ts') : ok(SHA)) }));
    expect(r.ready).toBe(false);
    expect(byName(r, 'working-tree')).toMatchObject({ ok: false, fix: expect.stringContaining('Commit or discard') });
  });

  it('fails when the local integration branch differs from origin', async () => {
    const git = async (a: readonly string[]): Promise<CmdResult> =>
      a[0] === 'status' ? ok('') : a[0] === 'rev-parse' && a.includes('develop') ? ok('b'.repeat(40)) : ok(SHA);
    const r = await runReleaseChecks(await deps({ git }));
    expect(byName(r, 'integration-branch')).toMatchObject({ ok: false, fix: expect.stringContaining('pull --ff-only') });
  });

  it.each([
    ['a failing run', [{ name: 'CI', status: 'completed', conclusion: 'failure' }], /failing: CI/],
    ['a running run', [{ name: 'E2E', status: 'in_progress', conclusion: '' }], /still running: E2E/],
    ['no runs at all', [], /no workflow runs/],
  ])('CI is not green with %s', async (_n, runs, re) => {
    const r = await runReleaseChecks(await deps({ gh: async () => ok(JSON.stringify(runs)) }));
    expect(byName(r, 'ci').ok).toBe(false);
    expect(byName(r, 'ci').detail).toMatch(re);
  });

  it('fails when gh cannot be run', async () => {
    const r = await runReleaseChecks(await deps({ gh: async () => null }));
    expect(byName(r, 'ci')).toMatchObject({ ok: false, fix: expect.stringContaining('gh auth login') });
  });

  it('fails when the release ticket is missing, or several tickets need a name', async () => {
    const none = await runReleaseChecks(await deps({ tickets: [] }));
    expect(byName(none, 'ticket').ok).toBe(false);
    const many = await runReleaseChecks(await deps({ tickets: ['REQ-001', 'REQ-002'] }));
    expect(byName(many, 'ticket').detail).toMatch(/REQ-001, REQ-002/);
    const named = await runReleaseChecks(await deps({ tickets: ['REQ-001', 'REQ-002'] }), 'REQ-002');
    expect(byName(named, 'ticket').ok).toBe(true);
    const wrong = await runReleaseChecks(await deps({ tickets: ['REQ-001'] }), 'REQ-009');
    expect(byName(wrong, 'ticket')).toMatchObject({ ok: false, detail: expect.stringContaining('REQ-009') });
  });

  it('treats uat_review and later as already submitted, and deferred / missing / unreadable as not ready', async () => {
    for (const status of ['uat_review', 'uat_approved', 'uat_rejected', 'released']) {
      const r = await runReleaseChecks(await deps({ lookup: async () => ({ kind: 'found', release: { status } }) }));
      expect(byName(r, 'portal')).toMatchObject({ ok: true, detail: `already submitted (${status})` });
    }
    const deferred = await runReleaseChecks(await deps({ lookup: async () => ({ kind: 'found', release: { status: 'deferred' } }) }));
    expect(byName(deferred, 'portal')).toMatchObject({ ok: false, fix: expect.stringContaining('Resume') });
    const missing = await runReleaseChecks(await deps({ lookup: async () => ({ kind: 'not-found' }) }));
    expect(byName(missing, 'portal').ok).toBe(false);
    const down = await runReleaseChecks(await deps({ lookup: async () => ({ kind: 'unavailable', reason: 'timeout' }) }));
    expect(byName(down, 'portal').detail).toMatch(/timeout/);
  });

  it('fails the portal check without a viewer key and never prints the key', async () => {
    const none = await runReleaseChecks(await deps({ readKey: async () => null }));
    expect(byName(none, 'portal')).toMatchObject({ ok: false, fix: expect.stringContaining('DEVAUDIT_VIEWER_API_KEY') });
    const all = await runReleaseChecks(await deps());
    expect(JSON.stringify(all)).not.toContain(VIEWER);
  });

  it('reads the portal with the viewer key it is given, nothing else', async () => {
    const seen: string[] = [];
    await runReleaseChecks(await deps({ lookup: async (_b, _s, key) => (seen.push(key), { kind: 'found', release: { status: 'draft' } }) }));
    expect(seen).toEqual([VIEWER]);
  });
});
