import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getReleaseStatus, type ReleaseStatusDeps } from '../src/commands/release-status.js';
import type { ReleaseLookup } from '../src/lib/releases-api.js';

const VIEWER = 'viewer-fixture-secret';
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

async function deps(over: Partial<ReleaseStatusDeps> & { tickets?: string[] } = {}): Promise<ReleaseStatusDeps & { urls: string[]; keys: string[] }> {
  const repoRoot = await fs.mkdtemp(join(tmpdir(), 'release-status-'));
  dirs.push(repoRoot);
  await fs.mkdir(join(repoRoot, 'compliance', 'pending-releases'), { recursive: true });
  for (const t of over.tickets ?? ['REQ-001']) await fs.writeFile(join(repoRoot, 'compliance', 'pending-releases', `RELEASE-TICKET-${t}.md`), '# t\n');
  const urls: string[] = [];
  const keys: string[] = [];
  return {
    repoRoot,
    cfg: { devaudit: { project_slug: 'example-app', base_url: 'https://portal.example' } },
    readKey: async () => VIEWER,
    fetchJson: async (url, key) => {
      urls.push(url);
      keys.push(key);
      return url.endsWith('/checks') ? { checks: [{ name: 'Quality Gates', state: 'success' }] } : [{ id: 'c1' }, { id: 'c2' }];
    },
    lookup: async (): Promise<ReleaseLookup> => ({ kind: 'found', release: { status: 'uat_review', id: 'rel-1', version: 'REQ-001' } }),
    ...over,
    urls,
    keys,
  };
}

describe('devaudit release status (#1099 WP3)', () => {
  it('reports status, checks, executions and the release URL, reading only with the viewer key', async () => {
    const d = await deps();
    const r = await getReleaseStatus(d);
    expect(r).toMatchObject({ ok: true, report: { project: 'example-app', version: 'REQ-001', releaseId: 'rel-1', status: 'uat_review', url: 'https://portal.example/projects/example-app/releases/rel-1' } });
    if (r.ok) {
      expect(r.report.checks).toEqual([{ name: 'Quality Gates', state: 'success' }]);
      expect(r.report.executions).toEqual([{ id: 'c1' }, { id: 'c2' }]);
      expect(JSON.stringify(r.report)).not.toContain(VIEWER);
    }
    expect(d.keys.every((k) => k === VIEWER)).toBe(true);
    expect(d.urls).toEqual([
      'https://portal.example/api/ci/releases/rel-1/checks',
      'https://portal.example/api/ci/releases/rel-1/cycles',
    ]);
  });

  it('still reports the status when checks or executions cannot be read', async () => {
    const r = await getReleaseStatus(await deps({ fetchJson: async () => null }));
    expect(r).toMatchObject({ ok: true, report: { status: 'uat_review', checks: null, executions: null } });
  });

  it('includes the deferral details of a deferred release', async () => {
    const lookup = async (): Promise<ReleaseLookup> => ({ kind: 'found', release: { status: 'deferred', id: 'rel-1', deferredReason: 'vendor', deferredUntil: '2026-12-01', deferredToVersion: 'REQ-050' } });
    const r = await getReleaseStatus(await deps({ lookup }));
    expect(r).toMatchObject({ ok: true, report: { deferred: { reason: 'vendor', until: '2026-12-01', toVersion: 'REQ-050' } } });
  });

  it('names the failure and the fix: no viewer key, unreadable portal, unknown release, ambiguous ticket', async () => {
    expect(await getReleaseStatus(await deps({ readKey: async () => null }))).toMatchObject({ ok: false, exitCode: 3, message: expect.stringContaining('viewer-key set') });
    expect(await getReleaseStatus(await deps({ lookup: async () => ({ kind: 'unavailable', reason: 'timeout' }) }))).toMatchObject({ ok: false, exitCode: 4 });
    expect(await getReleaseStatus(await deps({ lookup: async () => ({ kind: 'not-found' }) }))).toMatchObject({ ok: false, exitCode: 5 });
    expect(await getReleaseStatus(await deps({ tickets: ['REQ-001', 'REQ-002'] }))).toMatchObject({ ok: false, exitCode: 2 });
    expect(await getReleaseStatus(await deps({ tickets: ['REQ-001', 'REQ-002'] }), 'REQ-002')).toMatchObject({ ok: true });
  });
});
