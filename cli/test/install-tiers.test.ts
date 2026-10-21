import { describe, it, expect, vi, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { collectPlan } from '../src/install/prompts.js';
import { writeSdlcConfig } from '../src/install/write-config.js';
import {
  parseTestOptions,
  proposeTestTiers,
  resolveTestConfig,
  type Asker,
} from '../src/install/test-config.js';
import type { TestRunnerDetection } from '../src/lib/test-runner-detect.js';
import type { DetectedStack, InstallContext, InstallPlan } from '../src/install/types.js';

// devaudit-installer#1059 Phase C / #1060 Phase C — `devaudit install` flags and prompts
// for the release gate and the test tiers. Absent keys keep today's behaviour, so nothing
// here ever writes a default.

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const BIN = resolve(HERE, '..', 'bin', 'devaudit.js');
const detected: DetectedStack = { stack: 'node', workingDirectory: '.' };

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function ctxFor(config: Record<string, unknown> | null, extra: Partial<InstallContext> = {}, files: Record<string, string> = {}): Promise<InstallContext> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-install-tiers-'));
  dirs.push(dir);
  if (config) await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(config));
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, rel)), { recursive: true });
    await fs.writeFile(join(dir, rel), content);
  }
  return {
    projectPath: dir,
    repoRoot: dir,
    projectName: 'fixture-app',
    installerRoot: INSTALLER_ROOT,
    token: 't',
    baseUrl: 'https://devaudit.example.test',
    dryRun: false,
    nonInteractive: true,
    installMode: 'operator',
    addTarget: false,
    withViewerKey: false,
    ...extra,
  };
}

const none: TestRunnerDetection = { playwright: false, pytest: false, jest: false, vitest: false };
const BASE_CONFIG = { project_slug: 'fixture-app', stack: 'node' };

/** An asker that answers from a script and fails loudly when asked something unexpected. */
function asker(script: { confirm?: boolean[]; text?: string[]; select?: string[] } = {}) {
  const asked: string[] = [];
  const queues = { confirm: [...(script.confirm ?? [])], text: [...(script.text ?? [])], select: [...(script.select ?? [])] };
  const take = <T>(kind: keyof typeof queues, message: string): T => {
    asked.push(`${kind}: ${message}`);
    const next = queues[kind].shift();
    if (next === undefined) throw new Error(`unexpected ${kind} prompt: ${message}`);
    return next as T;
  };
  const ask: Asker = {
    confirm: async (message) => take<boolean>('confirm', message),
    text: async (message, initial) => {
      const answer = take<string>('text', message);
      return answer === '<default>' ? initial : answer;
    },
    select: async (message) => take<string>('select', message),
  };
  return { ask, asked };
}

describe('parseTestOptions', () => {
  it('validates each flag like `devaudit configure set` and names the flag in the error', () => {
    expect(parseTestOptions({}).config).toEqual({});
    const ok = parseTestOptions({
      release_gate_tier: 'full',
      post_deploy_full_regression: 'false',
      scheduled_full_regression: '0 3 * * *',
      test_runner: 'pytest',
      test_tier_smoke: 'pytest -m smoke',
      test_feature_command: 'pytest -k {REQ}',
    });
    expect(ok.errors).toEqual([]);
    expect(ok.config).toEqual({
      release_gate_tier: 'full',
      post_deploy_full_regression: false,
      scheduled_full_regression: '0 3 * * *',
      test_runner: 'pytest',
      test_tier_smoke: 'pytest -m smoke',
      test_feature_command: 'pytest -k {REQ}',
    });
    const bad = parseTestOptions({
      release_gate_tier: 'everything',
      post_deploy_full_regression: 'maybe',
      scheduled_full_regression: '0 3 * *',
      test_runner: 'mocha',
      test_tier_full: 'a\nb',
      test_feature_command: 'pytest',
    });
    expect(bad.errors).toEqual([
      '--release-gate-tier: must be one of none, smoke, critical, full',
      '--post-deploy-full-regression: must be true or false',
      expect.stringMatching(/^--scheduled-full-regression: must be a cron expression with five/),
      '--test-runner: must be one of playwright, pytest',
      '--test-tier-full: must be a single line',
      '--test-feature-command: must contain the {REQ} placeholder',
    ]);
  });
});

describe('proposeTestTiers', () => {
  it('proposes per runner and never writes anything for Playwright', () => {
    expect(proposeTestTiers(none)).toBeNull();
    expect(proposeTestTiers({ ...none, playwright: true, pytest: true })).toMatchObject({ runner: 'playwright', config: {} });
    expect(proposeTestTiers({ ...none, pytest: true })).toMatchObject({ runner: 'pytest', config: { test_runner: 'pytest' } });
    expect(proposeTestTiers({ ...none, jest: true })!.config).toMatchObject({ test_tier_smoke: 'npx jest --testPathPattern smoke', test_tier_full: 'npx jest', test_feature_command: 'npx jest -t {REQ}' });
    expect(proposeTestTiers({ ...none, jest: true, vitest: true })!.runner).toBe('vitest');
  });
});

describe('resolveTestConfig', () => {
  it('non-interactive: only flags, no defaults, no prompts', async () => {
    const quiet = asker();
    expect(await resolveTestConfig({ options: {}, existing: BASE_CONFIG, detection: { ...none, pytest: true }, interactive: false, ask: quiet.ask })).toEqual({ config: {}, notes: [] });
    const flagged = await resolveTestConfig({ options: { test_tier_smoke: 'make smoke' }, existing: BASE_CONFIG, detection: none, interactive: false, ask: quiet.ask });
    expect(flagged.config).toEqual({ test_tier_smoke: 'make smoke' });
    expect(quiet.asked).toEqual([]);
  });

  it('rejects an invalid flag before anything else', async () => {
    await expect(resolveTestConfig({ options: { release_gate_tier: 'x' }, existing: null, detection: none, interactive: false })).rejects.toThrow(/--release-gate-tier/);
  });

  it('tells the operator a gate flag needs e2e_regression_enabled', async () => {
    const r = await resolveTestConfig({ options: { release_gate_tier: 'full' }, existing: BASE_CONFIG, detection: none, interactive: false });
    expect(r.notes[0]).toMatch(/e2e_regression_enabled.*devaudit update --enable-e2e-regression/);
    const enabled = await resolveTestConfig({ options: { release_gate_tier: 'full' }, existing: { ...BASE_CONFIG, e2e_regression_enabled: true }, detection: none, interactive: false });
    expect(enabled.notes).toEqual([]);
  });

  it('Playwright: nothing to ask, a note says the projects are the tiers', async () => {
    const a = asker();
    const r = await resolveTestConfig({ options: {}, existing: BASE_CONFIG, detection: { ...none, playwright: true }, interactive: true, ask: a.ask });
    expect(r.config).toEqual({});
    expect(r.notes[0]).toMatch(/Playwright detected/);
    expect(a.asked).toEqual([]);
  });

  it('pytest: asks once and writes test_runner only when confirmed', async () => {
    const yes = await resolveTestConfig({ options: {}, existing: BASE_CONFIG, detection: { ...none, pytest: true }, interactive: true, ask: asker({ confirm: [true] }).ask });
    expect(yes.config).toEqual({ test_runner: 'pytest' });
    const no = await resolveTestConfig({ options: {}, existing: BASE_CONFIG, detection: { ...none, pytest: true }, interactive: true, ask: asker({ confirm: [false] }).ask });
    expect(no.config).toEqual({});
    const skipped = asker();
    expect((await resolveTestConfig({ options: {}, existing: { ...BASE_CONFIG, test_runner: 'pytest' }, detection: { ...none, pytest: true }, interactive: true, ask: skipped.ask })).config).toEqual({});
    expect(skipped.asked).toEqual([]);
  });

  it('jest: proposes editable commands, blank skips a tier, and flags or existing keys are never re-asked', async () => {
    const detection = { ...none, jest: true };
    const a = asker({ confirm: [true], text: ['<default>', '', 'npx jest --testPathPattern "smoke|critical|api"', '<default>'] });
    const r = await resolveTestConfig({ options: {}, existing: BASE_CONFIG, detection, interactive: true, ask: a.ask });
    expect(r.config).toEqual({
      test_tier_smoke: 'npx jest --testPathPattern smoke',
      test_tier_full: 'npx jest --testPathPattern "smoke|critical|api"',
      test_feature_command: 'npx jest -t {REQ}',
    });
    // a key from a flag or the config suppresses the whole proposal (the operator already decided)
    const quiet = asker();
    expect((await resolveTestConfig({ options: { test_tier_smoke: 'make smoke' }, existing: BASE_CONFIG, detection, interactive: true, ask: quiet.ask })).config).toEqual({ test_tier_smoke: 'make smoke' });
    expect((await resolveTestConfig({ options: {}, existing: { ...BASE_CONFIG, test_tier_full: 'x' }, detection, interactive: true, ask: quiet.ask })).config).toEqual({});
    expect(quiet.asked).toEqual([]);
  });

  it('the release gate is asked only where it can take effect, and critical writes nothing', async () => {
    const enabled = { ...BASE_CONFIG, e2e_regression_enabled: true };
    const critical = await resolveTestConfig({ options: {}, existing: enabled, detection: none, interactive: true, ask: asker({ select: ['critical'], text: [''] }).ask });
    expect(critical.config).toEqual({});
    const notEnabled = asker();
    expect((await resolveTestConfig({ options: {}, existing: BASE_CONFIG, detection: none, interactive: true, ask: notEnabled.ask })).config).toEqual({});
    expect(notEnabled.asked).toEqual([]);
  });

  it('full gate: offers to drop the redundant post-deploy run and takes an optional schedule', async () => {
    const enabled = { ...BASE_CONFIG, e2e_regression_enabled: true };
    const full = asker({ select: ['full'], confirm: [false], text: ['0 3 * * *'] });
    const r = await resolveTestConfig({ options: {}, existing: enabled, detection: none, interactive: true, ask: full.ask });
    expect(r.config).toEqual({ release_gate_tier: 'full', post_deploy_full_regression: false, scheduled_full_regression: '0 3 * * *' });
    expect(full.asked[1]).toMatch(/same commit twice/);
    const keepPost = await resolveTestConfig({ options: {}, existing: enabled, detection: none, interactive: true, ask: asker({ select: ['smoke'], text: [''] }).ask });
    expect(keepPost.config).toEqual({ release_gate_tier: 'smoke' });
  });

  it('a gate key from a flag or the config means the gate is not asked again', async () => {
    const enabled = { ...BASE_CONFIG, e2e_regression_enabled: true };
    const quiet = asker();
    expect((await resolveTestConfig({ options: { release_gate_tier: 'full' }, existing: enabled, detection: none, interactive: true, ask: quiet.ask })).config).toEqual({ release_gate_tier: 'full' });
    expect((await resolveTestConfig({ options: {}, existing: { ...enabled, scheduled_full_regression: '0 3 * * *' }, detection: none, interactive: true, ask: quiet.ask })).config).toEqual({});
    expect(quiet.asked).toEqual([]);
  });
});

describe('collectPlan', () => {
  it('carries flag values as plan.testConfig and nothing else; no flags means no testConfig', async () => {
    const withFlags = await collectPlan(await ctxFor(BASE_CONFIG, { testOptions: { test_tier_smoke: 'make smoke', release_gate_tier: 'smoke' } }), detected);
    expect(withFlags.testConfig).toEqual({ test_tier_smoke: 'make smoke', release_gate_tier: 'smoke' });
    expect(withFlags.testNotes?.[0]).toMatch(/e2e_regression_enabled/);
    const plain = await collectPlan(await ctxFor(BASE_CONFIG), detected);
    expect(plain.testConfig).toBeUndefined();
    expect(plain.testNotes).toBeUndefined();
  });

  it('fails on an invalid flag', async () => {
    await expect(collectPlan(await ctxFor(BASE_CONFIG, { testOptions: { release_gate_tier: 'x' } }), detected)).rejects.toThrow(/--release-gate-tier: must be one of/);
  });

  it('leaves a --add-target install alone (the test keys are repo-level)', async () => {
    const plan = await collectPlan(await ctxFor(BASE_CONFIG, { addTarget: true, testOptions: { test_tier_smoke: 'make smoke' } }), detected);
    expect(plan.testConfig).toBeUndefined();
  });

  it('does not propose tiers in non-interactive mode even when a runner is detected', async () => {
    const plan = await collectPlan(await ctxFor(BASE_CONFIG, {}, { 'pytest.ini': '[pytest]\n' }), detected);
    expect(plan.testConfig).toBeUndefined();
  });
});

describe('writeSdlcConfig applies the test keys', () => {
  async function write(existing: Record<string, unknown>, testConfig?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ctx = await ctxFor(existing);
    const plan: InstallPlan = {
      stack: 'node',
      host: 'railway',
      projectSlug: 'fixture-app',
      runtimeVersion: '20',
      sourceDirs: 'app/ lib/',
      workingDirectory: '.',
      prodUrlSecretName: 'FIXTURE_APP_PROD_URL',
      prodUrlValue: '',
      apiKeySecretName: 'DEVAUDIT_API_KEY',
      ...(testConfig ? { testConfig } : {}),
    };
    const r = await writeSdlcConfig(ctx, plan);
    expect(r.status).toBe('ok');
    return JSON.parse(await fs.readFile(join(ctx.repoRoot, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;
  }

  it('writes only the named keys over the existing config', async () => {
    const out = await write({ ...BASE_CONFIG, e2e_regression_enabled: true, test_tier_smoke: 'old smoke', test_tier_full: 'keep me' }, { test_tier_smoke: 'new smoke', release_gate_tier: 'full' });
    expect(out['test_tier_smoke']).toBe('new smoke');
    expect(out['release_gate_tier']).toBe('full');
    expect(out['test_tier_full']).toBe('keep me');
    expect(out['e2e_regression_enabled']).toBe(true);
  });

  it('writes no test key at all when none was named (today\'s behaviour)', async () => {
    const out = await write(BASE_CONFIG);
    for (const key of ['release_gate_tier', 'post_deploy_full_regression', 'scheduled_full_regression', 'test_runner', 'test_tier_smoke', 'test_tier_critical', 'test_tier_full', 'test_feature_command']) {
      expect(out, key).not.toHaveProperty(key);
    }
  });
});

describe('devaudit install flags', () => {
  it('are documented in --help', async () => {
    const r = await execa('node', [BIN, 'install', '--help'], { reject: false });
    for (const flag of ['--release-gate-tier <tier>', '--post-deploy-full-regression <true|false>', '--scheduled-full-regression <cron>', '--test-runner <runner>', '--test-tier-smoke <command>', '--test-tier-critical <command>', '--test-tier-full <command>', '--test-feature-command <command>']) {
      expect(r.stdout, flag).toContain(flag);
    }
  }, 30_000);

  it('an invalid value fails before anything is touched, naming the flag', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-install-flag-'));
    dirs.push(dir);
    const r = await execa('node', [BIN, 'install', dir, '--yes', '--release-gate-tier', 'banana'], { reject: false });
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain('--release-gate-tier: must be one of none, smoke, critical, full');
  }, 30_000);
});

describe('runInstallCommand forwards the options', () => {
  it('passes --host and the test flags to runInstall (--host used to be dropped)', async () => {
    vi.resetModules();
    const runInstall = vi.fn(async () => ({ project: 'x', projectPath: '.', dryRun: false, steps: [] }));
    vi.doMock('../src/install/index.js', () => ({ runInstall }));
    const { runInstallCommand } = await import('../src/commands/install.js');
    await runInstallCommand({ path: '.', host: 'vercel', testOptions: { release_gate_tier: 'full' } });
    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({ host: 'vercel', testOptions: { release_gate_tier: 'full' } }));
    await runInstallCommand({ path: '.', testOptions: {} });
    expect(runInstall.mock.calls[1]![0]).not.toHaveProperty('testOptions');
    expect(runInstall.mock.calls[1]![0]).not.toHaveProperty('host');
    vi.doUnmock('../src/install/index.js');
    vi.resetModules();
  });
});
