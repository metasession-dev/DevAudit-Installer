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
    expect(credentialsCheck(r).findings?.[0]?.remediation?.id).toBe('provide-viewer-key');
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
  });

  it('a viewer key only in .env is a legacy warning', async () => {
    const r = await buildCredentialsReport(deps({ files: { '.env': `DEVAUDIT_VIEWER_API_KEY=${VIEWER}\n` } }));
    expect(r.viewerKey).toMatchObject({ status: 'warn', source: '.env' });
    expect(credentialsCheck(r).findings?.[0]?.remediation?.id).toBe('move-viewer-key');
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
