import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { detectDeployHost, type GhRunner } from '../src/lib/deploy-detect.js';
import { parseConfigValue, findConfigKey } from '../src/lib/repo-config-keys.js';
import { loadConfigContext, planConfigChange, runConfigureSet, CONFIGURE_EXIT_INVALID, CONFIGURE_EXIT_UNAPPLIED } from '../src/commands/configure.js';
import { runConfigChecks, ciRunnerCheck, customDeployCheck } from '../src/commands/doctor-config.js';
import { runFix } from '../src/commands/doctor-fix.js';
import type { Proposal } from '../src/lib/doctor-types.js';

// devaudit-installer#1040 — detect the real deploy host, validate sdlc-config
// changes, and let doctor --fix correct a mismatched host (a consumer
// recorded as host railway whose production is deployed by Vercel).

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');

beforeAll(() => {
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function repo(cfg: Record<string, unknown>, files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-configure-'));
  dirs.push(dir);
  await execa('git', ['init', '-q'], { cwd: dir });
  await fs.writeFile(join(dir, 'sdlc-config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, rel)), { recursive: true });
    await fs.writeFile(join(dir, rel), content);
  }
  return dir;
}

/** Fake gh: answers by the first matching argument prefix. */
function fakeGh(routes: Record<string, unknown>, fail: readonly string[] = []): GhRunner {
  return async (args) => {
    const key = args.join(' ');
    if (fail.some((f) => key.startsWith(f))) return { exitCode: 1, stdout: '' };
    const hit = Object.keys(routes).find((k) => key.startsWith(k));
    return hit ? { exitCode: 0, stdout: JSON.stringify(routes[hit]) } : { exitCode: 1, stdout: '' };
  };
}

const vercelDeployments = fakeGh({
  'api repos/{owner}/{repo}/deployments?': [
    { id: 11, environment: 'Production', creator: { login: 'vercel[bot]' } },
    { id: 10, environment: 'Production', creator: { login: 'vercel[bot]' } },
    { id: 9, environment: 'Preview', creator: { login: 'vercel[bot]' } },
  ],
  'api repos/{owner}/{repo}/deployments/11/statuses': [{ state: 'success', environment_url: 'https://example-app.example.test' }],
  'secret list': [{ name: 'DEVAUDIT_API_KEY' }, { name: 'EXAMPLE_APP_PROD_URL' }],
  'variable list': [],
});

const BASE = { project_slug: 'example-app', stack: 'node', host: 'railway', production_url_secret: 'EXAMPLE_APP_PROD_URL', runner: 'ubuntu-latest' };

describe('detectDeployHost', () => {
  it('reads Vercel from who created the production deployments, with the latest URL', async () => {
    const dir = await repo(BASE);
    const d = await detectDeployHost(dir, 'railway', { gh: vercelDeployments });
    expect(d.detected).toBe('vercel');
    expect(d.confidence).toBe('high');
    expect(d.evidence[0]?.detail).toContain('2 recent production deployment(s) created by vercel[bot]');
    expect(d.environmentUrl).toBe('https://example-app.example.test');
  });

  it('falls back to repo files when gh is unavailable, and says what it could not check', async () => {
    const dir = await repo(BASE, { 'vercel.json': '{}' });
    const d = await detectDeployHost(dir, 'railway', { gh: fakeGh({}, ['api']) });
    expect(d.detected).toBe('vercel');
    expect(d.confidence).toBe('medium');
    expect(d.unchecked[0]).toMatch(/GitHub deployments/);
  });

  it('reports low confidence when evidence conflicts', async () => {
    const dir = await repo(BASE, { 'vercel.json': '{}', 'railway.toml': '' });
    const d = await detectDeployHost(dir, 'railway', { gh: fakeGh({}, ['api']) });
    expect(d.confidence).toBe('low');
  });

  it('finds nothing in a bare repo', async () => {
    const dir = await repo(BASE);
    const d = await detectDeployHost(dir, 'railway', { gh: fakeGh({}, ['api']) });
    expect(d.detected).toBeNull();
  });
});

describe('parseConfigValue', () => {
  it('parses each type and rejects bad input', () => {
    expect(parseConfigValue(findConfigKey('sast_baseline')!, '3').value).toBe(3);
    expect(parseConfigValue(findConfigKey('sast_baseline')!, 'x').error).toMatch(/whole number/);
    expect(parseConfigValue(findConfigKey('e2e_concurrency_cancel_in_progress')!, 'TRUE').value).toBe(true);
    expect(parseConfigValue(findConfigKey('deploy_secrets')!, 'AWS_KEY, AWS_SECRET').value).toEqual(['AWS_KEY', 'AWS_SECRET']);
    expect(parseConfigValue(findConfigKey('deploy_secrets')!, '["A"]').value).toEqual(['A']);
    expect(parseConfigValue(findConfigKey('app_env')!, '[1]').error).toMatch(/JSON object/);
  });
});

describe('planConfigChange', () => {
  it('refuses unknown keys, bad enums, bad secret names, non-https URLs and keys owned by another command', async () => {
    const ctx = await loadConfigContext(await repo({ ...BASE, host: 'custom' }));
    expect((await planConfigChange(ctx, 'nope', 'x', { detection: null })).errors[0]).toMatch(/unknown key/);
    expect((await planConfigChange(ctx, 'deploy_trigger', 'nightly', { detection: null })).errors[0]).toMatch(/push_to_main, git_tag, manual/);
    expect((await planConfigChange(ctx, 'production_url_secret', 'prod-url', { detection: null })).errors[0]).toMatch(/secret name/);
    expect((await planConfigChange(ctx, 'deployed_sha_url', 'http://x.test/v', { detection: null })).errors[0]).toMatch(/https/);
    expect((await planConfigChange(ctx, 'e2e_regression_enabled', 'true', { detection: null })).errors[0]).toMatch(/--enable-e2e-regression/);
    expect((await planConfigChange(ctx, 'host', 'netlify', { detection: null })).errors[0]).toMatch(/shipped host adapter/);
  });

  it('host railway -> vercel: no contradiction with Vercel evidence; swaps no workflows; asks for VERCEL_TOKEN', async () => {
    const dir = await repo(BASE);
    const ctx = await loadConfigContext(dir);
    const plan = await planConfigChange(ctx, 'host', 'vercel', { gh: vercelDeployments });
    expect(plan.errors).toEqual([]);
    expect(plan.contradiction).toBeNull();
    expect(plan.impact).toContain('.github/workflows/post-deploy-prod.yml');
    expect(plan.followUps.join('\n')).toContain('VERCEL_TOKEN');
  });

  it('host -> custom: adds deploy-custom.yml, removes reconcile-deployment.yml, requires deploy_command', async () => {
    const ctx = await loadConfigContext(await repo(BASE));
    const plan = await planConfigChange(ctx, 'host', 'custom', { detection: null });
    expect(plan.impact).toContain('.github/workflows/deploy-custom.yml (added)');
    expect(plan.impact).toContain('.github/workflows/reconcile-deployment.yml (removed)');
    expect(plan.followUps.join('\n')).toContain('requires `deploy_command`');
  });

  it('flags a value the evidence contradicts, and warns about a key for another host', async () => {
    const dir = await repo({ ...BASE, host: 'vercel' });
    const ctx = await loadConfigContext(dir);
    const plan = await planConfigChange(ctx, 'host', 'railway', { gh: vercelDeployments });
    expect(plan.contradiction).toMatch(/points to vercel/);
    const other = await planConfigChange(ctx, 'deploy_command', './deploy.sh', { detection: null });
    expect(other.warnings[0]).toMatch(/only used with host custom/);
  });
});

describe('runConfigureSet', () => {
  const noAsk = { confirm: async () => null, input: async () => null };

  it('--dry-run writes nothing', async () => {
    const dir = await repo(BASE);
    const code = await runConfigureSet('sast_baseline', '4', { yes: false, dryRun: true }, { cwd: dir, ask: noAsk });
    expect(code).toBe(0);
    expect(JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')).sast_baseline).toBeUndefined();
  });

  it('writes a valid value and keeps key order', async () => {
    const dir = await repo(BASE);
    expect(await runConfigureSet('sast_baseline', '4', { yes: true, dryRun: false }, { cwd: dir, ask: noAsk })).toBe(0);
    const text = await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8');
    expect(Object.keys(JSON.parse(text))).toEqual([...Object.keys(BASE), 'sast_baseline']);
  });

  it('an invalid value exits 2 and writes nothing', async () => {
    const dir = await repo(BASE);
    expect(await runConfigureSet('runner', '', { yes: true, dryRun: false }, { cwd: dir, ask: noAsk })).toBe(CONFIGURE_EXIT_INVALID);
  });

  it('a contradicted value is refused non-interactively without --reason, applied with it', async () => {
    const dir = await repo({ ...BASE, host: 'vercel' });
    expect(await runConfigureSet('host', 'railway', { yes: true, dryRun: false }, { cwd: dir, gh: vercelDeployments, ask: noAsk })).toBe(
      CONFIGURE_EXIT_UNAPPLIED,
    );
    expect(JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')).host).toBe('vercel');
    expect(
      await runConfigureSet('host', 'railway', { yes: true, dryRun: false, reason: 'moving to Railway this sprint' }, { cwd: dir, gh: vercelDeployments, ask: noAsk }),
    ).toBe(0);
    expect(JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')).host).toBe('railway');
  });
});

describe('doctor config checks', () => {
  it('Vercel-deployed repo recorded as railway: deploy-host mismatch with a set-config proposal; probe header recommended for a gated origin', async () => {
    const dir = await repo(BASE);
    const cfg = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;
    const checks = await runConfigChecks(dir, cfg, { gh: vercelDeployments, probe: async () => 401 });
    const host = checks.find((c) => c.name === 'deploy-host')!;
    expect(host.ok).toBe(false);
    expect(host.findings?.[0]?.remediation).toMatchObject({ id: 'set-config', tier: 'A', data: { key: 'host', value: 'vercel' } });
    const url = checks.find((c) => c.name === 'production-url')!;
    expect(url.ok).toBe(false);
    expect(url.detail).toContain('DEVAUDIT_PROBE_HEADER');
    expect(checks.find((c) => c.name === 'custom-deploy')!.detail).toMatch(/skipped/);
    expect(checks.find((c) => c.name === 'ci-runner')!.ok).toBe(true);
  });

  it('a matching host is ok; a missing production URL secret is reported', async () => {
    const dir = await repo({ ...BASE, host: 'vercel', production_url_secret: 'MISSING_URL' });
    const cfg = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;
    const checks = await runConfigChecks(dir, cfg, { gh: vercelDeployments, probe: async () => 200 });
    expect(checks.find((c) => c.name === 'deploy-host')!.ok).toBe(true);
    expect(checks.find((c) => c.name === 'production-url')!.detail).toContain('MISSING_URL');
  });

  it('custom-deploy reports a missing deploy_command and missing deploy secrets', () => {
    const r = customDeployCheck('custom', { deploy_secrets: ['AWS_KEY', 'bad-name'] }, ['DEVAUDIT_API_KEY']);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('deploy_command');
    expect(r.detail).toContain('AWS_KEY');
    expect(r.detail).toContain('"bad-name"');
  });

  it('ci-runner: self-hosted with a label no runner carries is reported; github-ci is fine', async () => {
    const dir = await repo(BASE);
    const withLabel = fakeGh({
      'variable list': [{ name: 'CI_RUNNER_LABEL', value: 'build-box-ci' }],
      'api repos/{owner}/{repo}/actions/runners': { runners: [{ status: 'online', labels: [{ name: 'other' }] }] },
    });
    const bad = await ciRunnerCheck(dir, { runner: 'self-hosted' }, withLabel);
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain('build-box-ci');
    const ok = await ciRunnerCheck(dir, { runner: 'self-hosted' }, fakeGh({ 'variable list': [] }));
    expect(ok.ok).toBe(true);
    expect(ok.detail).toContain('github-ci');
  });
});

describe('doctor --fix set-config', () => {
  const proposal: Proposal = {
    check: 'deploy-host',
    subject: 'host',
    detail: 'mismatch',
    remediation: { id: 'set-config', tier: 'A', summary: 'Set host to vercel', plan: [], needsPortal: false, data: { key: 'host', value: 'vercel' } },
  };
  const ask = { confirm: async () => null, input: async () => null, select: async () => null, nonInteractiveReason: () => 'no TTY' };

  it('needs --yes non-interactively, then sets host and lists the follow-ups', async () => {
    const dir = await repo(BASE);
    const unapplied = await runFix([proposal], { repoRoot: dir, baseUrl: '', ask }, { yes: false, dryRun: false, json: true });
    expect(unapplied.outcomes[0]?.status).toBe('unapplied');
    const applied = await runFix([proposal], { repoRoot: dir, baseUrl: '', ask }, { yes: true, dryRun: false, json: true });
    expect(applied.outcomes[0]?.status).toBe('applied');
    expect(applied.outcomes[0]?.message).toContain('VERCEL_TOKEN');
    expect(JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')).host).toBe('vercel');
    const again = await runFix([proposal], { repoRoot: dir, baseUrl: '', ask }, { yes: true, dryRun: false, json: true });
    expect(again.outcomes[0]?.status).toBe('unchanged');
  });
});
