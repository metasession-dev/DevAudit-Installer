import { describe, it, expect } from 'vitest';
import { cliVersionCheck, compareVersions, fetchLatestCliVersion, parseVersion, LATEST_URL } from '../src/commands/doctor-version.js';
import { CHECK_EXPLANATIONS, gapsFromCheck } from '../src/lib/doctor-explain.js';

// DevAudit-Installer#1265 — doctor warns when the installed CLI or the last sync is behind the latest published.

const latest = (v: string | null) => ({ fetchLatest: async () => v, env: {} as NodeJS.ProcessEnv });

describe('compareVersions', () => {
  it.each([
    ['1.14.0', '1.14.0', 0],
    ['1.14.0', '1.14.1', -1],
    ['1.14.9', '1.15.0', -1],
    ['2.0.0', '1.99.99', 1],
    ['1.10.0', '1.9.0', 1],
    ['v1.14.0', '1.14.0', 0],
    ['1.15.0-beta.1', '1.15.0', -1],
    ['1.15.0', '1.15.0-beta.1', 1],
    ['1.15.0-beta.2', '1.15.0-beta.10', -1],
    ['1.15.0-alpha', '1.15.0-beta', -1],
    ['1.15.0+build5', '1.15.0', 0],
  ])('%s vs %s is %i', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });

  it('is NaN for something that is not a version', () => {
    expect(compareVersions('latest', '1.0.0')).toBeNaN();
    expect(parseVersion('1.0')).toBeNull();
  });
});

describe('cliVersionCheck', () => {
  const consumer = (synced?: string) => ({ cfg: synced === undefined ? {} : { devaudit_synced_version: synced } });

  it('is silent when both the CLI and the last sync are current', async () => {
    const r = await cliVersionCheck(consumer('1.14.0'), { ...latest('1.14.0'), cliVersion: '1.14.0' });
    expect(r).toMatchObject({ name: 'cli-version', ok: true });
    expect(r.findings).toBeUndefined();
    expect(gapsFromCheck(r)).toEqual([]);
  });

  it('a CLI newer than the registry (a development build) is current', async () => {
    const r = await cliVersionCheck(consumer('1.14.0'), { ...latest('1.14.0'), cliVersion: '1.15.0-dev.3' });
    expect(r.findings).toBeUndefined();
  });

  it('warns, without failing, when the running CLI is behind, and prints both fixes', async () => {
    const r = await cliVersionCheck(consumer('1.14.0'), { ...latest('1.15.0'), cliVersion: '1.14.0' });
    expect(r.ok).toBe(true);
    expect(r.findings?.map((f) => f.subject)).toEqual(['installed-cli', 'synced-version']);
    const fix = r.findings![0]!.remediation!;
    expect(fix.tier).toBe('C');
    expect(fix.plan.join('\n')).toContain('npx @metasession.co/devaudit-cli@latest update');
    expect(fix.plan.join('\n')).toContain('npm install -g @metasession.co/devaudit-cli@latest');
    expect(r.detail).toContain('CLI 1.14.0 and templates 1.14.0');
  });

  it('warns about the sync alone when the CLI is current', async () => {
    const r = await cliVersionCheck(consumer('1.13.0'), { ...latest('1.14.0'), cliVersion: '1.14.0' });
    expect(r.findings?.map((f) => f.subject)).toEqual(['synced-version']);
    expect(r.findings![0]!.remediation!.plan).toEqual(['devaudit update   (on a fix branch)']);
  });

  it('warns about the CLI alone outside a consumer project', async () => {
    const r = await cliVersionCheck(null, { ...latest('1.15.0'), cliVersion: '1.14.0' });
    expect(r.findings?.map((f) => f.subject)).toEqual(['installed-cli']);
  });

  it('ignores a missing devaudit_synced_version', async () => {
    const r = await cliVersionCheck(consumer(), { ...latest('1.14.0'), cliVersion: '1.14.0' });
    expect(r.findings).toBeUndefined();
  });

  it('is skipped, with no finding, when the registry cannot be read', async () => {
    const r = await cliVersionCheck(consumer('1.0.0'), { ...latest(null), cliVersion: '1.0.0' });
    expect(r.ok).toBe(true);
    expect(r.findings).toBeUndefined();
    expect(r.detail).toMatch(/skipped/);
  });

  it('is skipped, and reads nothing, with DEVAUDIT_SKIP_VERSION_CHECK=1', async () => {
    let called = false;
    const r = await cliVersionCheck(consumer('1.0.0'), { fetchLatest: async () => ((called = true), '9.9.9'), env: { DEVAUDIT_SKIP_VERSION_CHECK: '1' } });
    expect(called).toBe(false);
    expect(r.detail).toMatch(/skipped/);
  });

  it('every finding has an explanation, and a gap is made from each', async () => {
    const r = await cliVersionCheck(consumer('1.0.0'), { ...latest('1.15.0'), cliVersion: '1.0.0' });
    expect(CHECK_EXPLANATIONS['cli-version']).toBeDefined();
    for (const f of r.findings!) expect(CHECK_EXPLANATIONS[`cli-version:${f.subject}`], f.subject).toBeDefined();
    expect(gapsFromCheck(r)).toHaveLength(2);
  });
});

describe('fetchLatestCliVersion', () => {
  const fake = (res: () => Promise<Response>) => (async () => res()) as unknown as typeof fetch;

  it('reads the version of the latest dist-tag', async () => {
    let url = '';
    const impl = (async (u: string) => ((url = u), new Response(JSON.stringify({ name: '@metasession.co/devaudit-cli', version: '1.15.0' })))) as unknown as typeof fetch;
    expect(await fetchLatestCliVersion(impl)).toBe('1.15.0');
    expect(url).toBe(LATEST_URL);
    expect(url).toContain('@metasession.co%2Fdevaudit-cli/latest');
  });

  it('is null on an error status, a network failure, a timeout, or an answer that has no version', async () => {
    expect(await fetchLatestCliVersion(fake(async () => new Response('', { status: 503 })))).toBeNull();
    expect(await fetchLatestCliVersion(fake(async () => Promise.reject(new Error('offline'))))).toBeNull();
    expect(await fetchLatestCliVersion(fake(async () => Promise.reject(new DOMException('timed out', 'TimeoutError'))))).toBeNull();
    expect(await fetchLatestCliVersion(fake(async () => new Response('{"name":"x"}')))).toBeNull();
    expect(await fetchLatestCliVersion(fake(async () => new Response('<html>')))).toBeNull();
    expect(await fetchLatestCliVersion(fake(async () => new Response('{"version":"latest"}')))).toBeNull();
  });
});
