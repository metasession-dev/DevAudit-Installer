import { describe, it, expect } from 'vitest';
import {
  buildCredentialsReport,
  credentialsBlock,
  credentialsBlockFor,
  credentialsCheck,
  type CredentialsDeps,
  type ProbeResult,
} from '../src/lib/credentials-check.js';

const UPLOADER = 'dak_UPLOADERSECRETVALUE0123456789';
const VIEWER = 'viewer-fixture-secret-value';
const PAT = 'mctok_fixture_pat_secret_value';
const SECRETS = [UPLOADER, VIEWER, PAT];

const cfg = { devaudit: { project_slug: 'example-app', base_url: 'https://portal.example' } };

function deps(over: Partial<CredentialsDeps> & { files?: Record<string, string> } = {}): CredentialsDeps & { calls: string[] } {
  const calls: string[] = [];
  const files = over.files ?? {};
  const base: CredentialsDeps = {
    repoRoot: '/repo',
    cfg,
    env: {},
    readRepoFile: async (n) => files[n] ?? null,
    trackedFilesWithKeys: async () => [],
    probeViewer: async (): Promise<ProbeResult> => (calls.push('viewer'), { status: 200 }),
    probePat: async () => (calls.push('pat'), { status: 200, slugs: ['example-app'] }),
    resolvePat: async () => null,
    interactive: true,
  };
  return Object.assign({ ...base, ...over }, { calls });
}

const all = (v: unknown) => JSON.stringify(v);

describe('credentials check (#1099 WP4)', () => {
  it('a clean machine with a working viewer key and PAT is ok', async () => {
    const d = deps({ env: { DEVAUDIT_VIEWER_API_KEY: VIEWER }, resolvePat: async () => ({ token: PAT, baseUrl: 'https://portal.example', source: 'file' }) });
    const r = await buildCredentialsReport(d);
    expect(r.uploaderKey.status).toBe('ok');
    expect(r.viewerKey).toMatchObject({ status: 'ok', source: 'env', project: 'example-app', expiresAt: null });
    expect(r.pat).toMatchObject({ status: 'ok', source: 'file' });
    expect(credentialsCheck(r).ok).toBe(true);
  });

  it('a missing viewer key is reported without calling the portal', async () => {
    const d = deps();
    const r = await buildCredentialsReport(d);
    expect(r.viewerKey.status).toBe('absent');
    expect(d.calls).not.toContain('viewer');
    // Tier B (portal): issue your own named key with your PAT.
    expect(credentialsCheck(r).findings?.[0]?.remediation).toMatchObject({ id: 'issue-viewer-key', tier: 'B', needsPortal: true, data: { slug: 'example-app', invalid: 'false' } });
  });

  it.each([
    [401, /invalid or revoked/],
    [403, /another project/],
    [404, /does not exist on this portal/],
  ])('a viewer key answered %i is invalid', async (status, re) => {
    const r = await buildCredentialsReport(deps({ env: { DEVAUDIT_VIEWER_API_KEY: VIEWER }, probeViewer: async () => ({ status }) }));
    expect(r.viewerKey.status).toBe('invalid');
    expect(r.viewerKey.note).toMatch(re);
    expect(credentialsCheck(r).ok).toBe(false);
    expect(credentialsCheck(r).findings?.[0]?.remediation).toMatchObject({ id: 'issue-viewer-key', tier: 'B', data: { invalid: 'true' } });
  });

  it('a viewer key only in .env is a legacy warning', async () => {
    const r = await buildCredentialsReport(deps({ files: { '.env': `DEVAUDIT_VIEWER_API_KEY=${VIEWER}\n` } }));
    expect(r.viewerKey).toMatchObject({ status: 'warn', source: '.env' });
    // Tier A (local): move it out of .env.
    expect(credentialsCheck(r).findings?.[0]?.remediation).toMatchObject({ id: 'move-viewer-key', tier: 'A', needsPortal: false, data: { slug: 'example-app' } });
  });

  it('an uploader key in the environment, .env, .env.local or a tracked file is a finding that names where, not the value', async () => {
    const d = deps({
      env: { DEVAUDIT_API_KEY: UPLOADER },
      files: { '.env': `DEVAUDIT_API_KEY=${UPLOADER}\n`, '.env.local': 'DEVAUDIT_API_KEY="dak_other0123456789abcdef"\n' },
      trackedFilesWithKeys: async () => ['scripts/deploy.sh'],
    });
    const r = await buildCredentialsReport(d);
    expect(r.uploaderKey.status).toBe('warn');
    expect(r.uploaderKey.locations).toEqual([
      'env DEVAUDIT_API_KEY',
      '.env DEVAUDIT_API_KEY',
      '.env.local DEVAUDIT_API_KEY',
      'tracked file scripts/deploy.sh',
    ]);
    const c = credentialsCheck(r);
    expect(c.ok).toBe(false);
    expect(c.findings?.[0]?.remediation).toMatchObject({ id: 'remove-local-uploader-key', tier: 'C' });
  });

  it('an unreachable or slow portal is "not checked", never a failure', async () => {
    for (const failure of ['timeout', 'network'] as const) {
      const r = await buildCredentialsReport(deps({
        env: { DEVAUDIT_VIEWER_API_KEY: VIEWER },
        probeViewer: async () => ({ failure }),
        resolvePat: async () => ({ token: PAT, baseUrl: 'x', source: 'env' }),
        probePat: async () => ({ failure }),
      }));
      expect(r.viewerKey.status).toBe('not-checked');
      expect(r.pat.status).toBe('not-checked');
      expect(credentialsCheck(r).ok).toBe(true);
    }
  });

  it('a project slug missing from sdlc-config.json skips the viewer probe', async () => {
    const d = deps({ cfg: {}, env: { DEVAUDIT_VIEWER_API_KEY: VIEWER } });
    const r = await buildCredentialsReport(d);
    expect(r.viewerKey.status).toBe('not-checked');
    expect(d.calls).toEqual([]);
  });

  describe('personal access token', () => {
    const pat = async () => ({ token: PAT, baseUrl: 'https://portal.example', source: 'env' as const });

    it('is never sent to the portal from a non-interactive run (agents never use it)', async () => {
      const d = deps({ resolvePat: pat, interactive: false });
      const r = await buildCredentialsReport(d);
      expect(d.calls).not.toContain('pat');
      expect(r.pat).toMatchObject({ status: 'not-checked', source: 'env' });
      expect(r.pat.note).toMatch(/expiry: not available/);
    });

    it('interactive: 401 is invalid, a non-member is invalid, a member is ok', async () => {
      const unauth = await buildCredentialsReport(deps({ resolvePat: pat, probePat: async () => ({ status: 401 }) }));
      expect(unauth.pat.status).toBe('invalid');
      expect(credentialsCheck(unauth).findings?.map((f) => f.remediation?.id)).toContain('renew-pat');
      const other = await buildCredentialsReport(deps({ resolvePat: pat, probePat: async () => ({ status: 200, slugs: ['other'] }) }));
      expect(other.pat).toMatchObject({ status: 'invalid', note: expect.stringContaining('not a member') });
      const member = await buildCredentialsReport(deps({ resolvePat: pat }));
      expect(member.pat.status).toBe('ok');
    });

    describe('expiry (GET /api/auth/token, metasession-dev/devaudit#922)', () => {
      const now = new Date('2026-11-01T12:00:00Z');
      const meta = (expiresAt: string | null) => async () => ({ status: 200, expiresAt });

      it('warns within 14 days, with a tier C renew-pat proposal', async () => {
        const r = await buildCredentialsReport(deps({ resolvePat: pat, probePatToken: meta('2026-11-10T00:00:00Z') }), now);
        expect(r.pat).toMatchObject({ status: 'warn', expiresAt: '2026-11-10T00:00:00Z' });
        expect(r.pat.note).toMatch(/expires on 2026-11-10 \(in 9 days\)/);
        const renew = credentialsCheck(r).findings?.find((f) => f.remediation?.id === 'renew-pat');
        expect(renew?.remediation).toMatchObject({ tier: 'C', summary: expect.stringContaining('before it expires') });
      });

      it('is ok outside the window, and DEVAUDIT_PAT_EXPIRY_WARN_DAYS widens it', async () => {
        const later = meta('2026-12-15T00:00:00Z');
        const ok = await buildCredentialsReport(deps({ resolvePat: pat, probePatToken: later }), now);
        expect(ok.pat).toMatchObject({ status: 'ok', note: expect.stringContaining('expires on 2026-12-15') });
        const wide = await buildCredentialsReport(deps({ resolvePat: pat, probePatToken: later, env: { DEVAUDIT_PAT_EXPIRY_WARN_DAYS: '60' } }), now);
        expect(wide.pat.status).toBe('warn');
        const junk = await buildCredentialsReport(deps({ resolvePat: pat, probePatToken: later, env: { DEVAUDIT_PAT_EXPIRY_WARN_DAYS: 'soon' } }), now);
        expect(junk.pat.status).toBe('ok');
      });

      it('a token with no expiry is ok; an expired one is invalid', async () => {
        const none = await buildCredentialsReport(deps({ resolvePat: pat, probePatToken: meta(null) }), now);
        expect(none.pat).toMatchObject({ status: 'ok', expiresAt: null, note: expect.stringContaining('expiry: none set') });
        const gone = await buildCredentialsReport(deps({ resolvePat: pat, probePatToken: meta('2026-10-01T00:00:00Z') }), now);
        expect(gone.pat).toMatchObject({ status: 'invalid', note: expect.stringContaining('expired on 2026-10-01') });
      });

      it('a portal without the route (404) or unreachable leaves "expiry: not available"', async () => {
        for (const probePatToken of [async () => ({ status: 404 }), async () => ({ failure: 'timeout' as const })]) {
          const r = await buildCredentialsReport(deps({ resolvePat: pat, probePatToken }), now);
          expect(r.pat).toMatchObject({ status: 'ok', expiresAt: null, note: expect.stringContaining('expiry: not available') });
        }
      });

      it('is never asked from a non-interactive run, nor for a rejected token', async () => {
        let asked = 0;
        const counting = async () => (asked += 1, { status: 200, expiresAt: '2026-11-02T00:00:00Z' });
        await buildCredentialsReport(deps({ resolvePat: pat, probePatToken: counting, interactive: false }), now);
        await buildCredentialsReport(deps({ resolvePat: pat, probePatToken: counting, probePat: async () => ({ status: 401 }) }), now);
        expect(asked).toBe(0);
      });
    });

    it('an absent PAT is not a warning on its own', async () => {
      const r = await buildCredentialsReport(deps({ env: { DEVAUDIT_VIEWER_API_KEY: VIEWER } }));
      expect(r.pat.status).toBe('absent');
      expect(credentialsCheck(r).ok).toBe(true);
    });
  });

  it('no output, JSON included, contains a fixture secret value', async () => {
    const d = deps({
      env: { DEVAUDIT_API_KEY: UPLOADER, DEVAUDIT_VIEWER_API_KEY: VIEWER },
      files: { '.env': `DEVAUDIT_API_KEY=${UPLOADER}\n` },
      probeViewer: async () => ({ status: 401 }),
      resolvePat: async () => ({ token: PAT, baseUrl: 'https://portal.example', source: 'env' }),
      probePat: async () => ({ status: 401 }),
    });
    const r = await buildCredentialsReport(d);
    const check = credentialsCheck(r);
    const out = all(check) + all(r) + credentialsBlock([{ label: 'example-app', report: r }]).join('\n');
    for (const secret of SECRETS) expect(out).not.toContain(secret);
  });
});

describe('credentials block after update / install / join', () => {
  const okDeps = async (): Promise<CredentialsDeps> => deps({ env: { DEVAUDIT_VIEWER_API_KEY: VIEWER } });

  it('is skipped when CI or GITHUB_ACTIONS is set', async () => {
    expect(await credentialsBlockFor(['/nope'], { CI: 'true' }, okDeps)).toEqual([]);
    expect(await credentialsBlockFor(['/nope'], { GITHUB_ACTIONS: 'true' }, okDeps)).toEqual([]);
  });

  it('skips a path that is not a consumer project without failing', async () => {
    expect(await credentialsBlockFor(['/definitely/not/a/repo'], {}, okDeps)).toEqual([]);
  });

  it('prints one heading, and one line per project for several projects', () => {
    const rep = (status: 'ok' | 'warn') => ({
      uploaderKey: { status, source: null, project: 'p', expiresAt: null, note: 'n', locations: status === 'warn' ? ['.env DEVAUDIT_API_KEY'] : [] },
      viewerKey: { status: 'ok' as const, source: 'env', project: 'p', expiresAt: null, note: 'n' },
      pat: { status: 'absent' as const, source: null, project: 'p', expiresAt: null, note: 'n' },
    });
    const lines = credentialsBlock([
      { label: 'app-a', report: rep('ok') },
      { label: 'app-b', report: rep('warn') },
    ]);
    expect(lines.filter((l) => l === 'Credentials:')).toHaveLength(1);
    expect(lines.filter((l) => l.includes('app-a:') || l.includes('app-b:'))).toHaveLength(2);
    expect(lines.some((l) => l.includes('fix:'))).toBe(true);
  });
});
