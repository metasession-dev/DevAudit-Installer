import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { seedFilesHash } from '@metasession.co/devaudit-core';
import { TEST_DATA_FINDINGS, currentSeedFilesHash, testDataCheck, type TestDataDeps } from '../src/commands/doctor-testdata.js';
import { CHECK_EXPLANATIONS, gapsFromCheck } from '../src/lib/doctor-explain.js';
import { renderExplanation } from '../src/commands/doctor-guided.js';
import { turnsOnUnattendedRun } from '../src/commands/configure-guided.js';
import type { GhRunner } from '../src/lib/deploy-detect.js';
import type { CheckResult } from '../src/lib/doctor-types.js';

// DevAudit-Installer#1116 WP15 — the `test-data` doctor check.

const HERE = dirname(fileURLToPath(import.meta.url));
const LIFECYCLE = resolve(HERE, '..', '..', 'sdlc', 'files', '_common', 'scripts', 'e2e-data-lifecycle.sh');

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function repo(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-testdata-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, rel)), { recursive: true });
    await fs.writeFile(join(dir, rel), content);
  }
  return dir;
}

const noGh: GhRunner = async () => ({ exitCode: 1, stdout: '' });
const base: TestDataDeps = { gh: noGh, playwrightProjects: ['smoke', 'critical', 'regression'], readFixtureRefs: async () => ({ referenced: [], seedText: '' }) };
const subjects = (r: CheckResult): string[] => (r.findings ?? []).map((f) => f.subject);

async function check(cfg: Record<string, unknown>, deps: TestDataDeps = base, others: CheckResult[] = [], files: Record<string, string> = {}): Promise<CheckResult> {
  const dir = await repo(files);
  return testDataCheck({ repoRoot: dir, cfg: { project_slug: 'example-app', ...cfg } }, others, deps);
}

describe('test-data: when it is silent', () => {
  it('reports nothing for a project with no tier that writes data enabled', async () => {
    const r = await check({});
    expect(r).toMatchObject({ name: 'test-data', ok: true });
    expect(r.detail).toContain('nothing to check');
    expect((await check({ e2e_regression_enabled: false })).ok).toBe(true);
  });

  it('is consistent for an isolated, declared regression', async () => {
    const r = await check({ e2e_regression_enabled: true, e2e_data_isolation: 'ephemeral', post_deploy_full_regression: true });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('consistent');
  });
});

describe('test-data: each finding', () => {
  it('isolation-unset: the regression is enabled and nothing says where its data lives; coupled with a scope cause', async () => {
    const r = await check({ e2e_regression_enabled: true });
    expect(subjects(r)).toEqual(['isolation-unset']);
    expect(r.findings![0]!.remediation).toMatchObject({ tier: 'C' });
    expect(r.findings![0]!.remediation!.plan.join(' ')).toContain('e2e-test-data');
    const scope = await check({ e2e_regression_enabled: true }, base, [{ name: 'test-tiers', ok: false, detail: 'x' }]);
    expect(scope.findings![0]!.detail).toContain('e2e-test-engineer');
  });

  it('shared-writes: shared data with a data-writing tier, with a tier A change and a way out', async () => {
    const r = await check({ e2e_regression_enabled: true, e2e_data_isolation: 'shared', post_deploy_full_regression: false, feature_e2e_projects: ['smoke'] });
    expect(subjects(r)).toEqual(['shared-writes']);
    expect(r.findings![0]!.remediation).toMatchObject({ id: 'set-config', tier: 'A', data: { key: 'e2e_data_isolation', value: 'shared_serialised' } });
    const gap = gapsFromCheck(r)[0]!;
    expect(gap.id).toBe('doctor:test-data:shared-writes');
    expect(gap.options.length).toBe(2);
  });

  it('shared-unattended: shared with a cron schedule, with post-deploy true, with it unset, and shared_serialised without a group', async () => {
    for (const cfg of [
      { e2e_data_isolation: 'shared', scheduled_full_regression: '0 2 * * *', post_deploy_full_regression: false },
      { e2e_data_isolation: 'shared', post_deploy_full_regression: true },
      { e2e_data_isolation: 'shared' },
      { e2e_data_isolation: 'shared_serialised', post_deploy_full_regression: true },
    ]) {
      const r = await check({ e2e_regression_enabled: true, ...cfg });
      expect(subjects(r), JSON.stringify(cfg)).toContain('shared-unattended');
    }
  });

  it('shared-unattended: states the schedule found and offers change, turn off, or leave', async () => {
    const r = await check({ e2e_regression_enabled: true, e2e_data_isolation: 'shared', scheduled_full_regression: '0 2 * * *' });
    const f = r.findings!.find((x) => x.subject === 'shared-unattended')!;
    expect(f.detail).toContain('a schedule (0 2 * * *)');
    expect(f.detail).toContain('collides');
    const gap = gapsFromCheck(r).find((g) => g.id === 'doctor:test-data:shared-unattended')!;
    const keys = gap.options.map((o) => `${o.remediation?.data?.['key']}=${o.remediation?.data?.['value']}`);
    expect(keys).toContain('e2e_data_isolation=ephemeral');
    expect(keys).toContain('scheduled_full_regression=');
    expect(keys).toContain('post_deploy_full_regression=false');
    expect(gap.options.every((o) => o.tier === 'A')).toBe(true);
    // the Q8 turn-off options clear the schedule
    expect(f.alternatives!.some((a) => a.data?.['key'] === 'scheduled_full_regression' && a.data['value'] === '')).toBe(true);
  });

  it('shared-unattended: silent for ephemeral, none, a group-protected serialised run, and runs nobody starts unattended', async () => {
    const quiet = { post_deploy_full_regression: false };
    expect(subjects(await check({ e2e_regression_enabled: true, e2e_data_isolation: 'ephemeral', scheduled_full_regression: '0 2 * * *' }))).not.toContain('shared-unattended');
    expect(subjects(await check({ e2e_regression_enabled: true, e2e_data_isolation: 'none', scheduled_full_regression: '0 2 * * *' }))).not.toContain('shared-unattended');
    expect(subjects(await check({ e2e_regression_enabled: true, e2e_data_isolation: 'shared_serialised', e2e_concurrency_group: 'g', scheduled_full_regression: '0 2 * * *' }))).not.toContain('shared-unattended');
    expect(subjects(await check({ e2e_regression_enabled: true, e2e_data_isolation: 'shared', ...quiet }))).not.toContain('shared-unattended');
  });

  it('seed-path-missing and seed-paths-empty', async () => {
    const missing = await check({ e2e_regression_enabled: true, e2e_data_isolation: 'ephemeral', post_deploy_full_regression: false, e2e_seed_paths: ['seed/', 'nope/'], e2e_seed_command: './scripts/seed.sh' }, base, [], { 'seed/a.sql': 'x' });
    expect(subjects(missing)).toContain('seed-path-missing');
    expect(missing.findings!.find((f) => f.subject === 'seed-path-missing')!.detail).toContain('nope/');
    expect(missing.findings!.find((f) => f.subject === 'seed-path-missing')!.detail).toContain('./scripts/seed.sh');
    const empty = await check({ e2e_regression_enabled: true, e2e_data_isolation: 'ephemeral', post_deploy_full_regression: false, e2e_seed_command: 'npm run seed' });
    expect(subjects(empty)).toEqual(['seed-paths-empty']);
    const fine = await check({ e2e_regression_enabled: true, e2e_data_isolation: 'ephemeral', post_deploy_full_regression: false, e2e_seed_paths: ['seed/'], e2e_seed_command: 'npm run seed' }, base, [], { 'seed/a.sql': 'x' });
    expect(fine.ok).toBe(true);
  });

  it('serialised-no-group has a tier A repair naming a group', async () => {
    const r = await check({ e2e_regression_enabled: true, e2e_data_isolation: 'shared_serialised', post_deploy_full_regression: false, feature_e2e_projects: ['smoke'] });
    expect(subjects(r)).toEqual(['serialised-no-group']);
    expect(r.findings![0]!.remediation!.data).toEqual({ key: 'e2e_concurrency_group', value: 'e2e-example-app' });
  });

  it('fixture-not-seeded is advisory and labelled as a heuristic', async () => {
    const deps = { ...base, readFixtureRefs: async () => ({ referenced: ['adminUser', 'demoOrg'], seedText: 'insert demoOrg' }) };
    const r = await check({ e2e_regression_enabled: true, e2e_data_isolation: 'ephemeral', post_deploy_full_regression: false, e2e_seed_paths: ['seed/'] }, deps, [], { 'seed/a.sql': 'x' });
    expect(subjects(r)).toEqual(['fixture-not-seeded']);
    expect(r.findings![0]!.detail).toContain('heuristic');
    expect(r.findings![0]!.detail).toContain('adminUser');
    expect(r.findings![0]!.detail).not.toContain('demoOrg,');
  });

  it('feature-destructive: the feature run includes regression against a shared backend', async () => {
    const r = await check({ e2e_regression_enabled: true, e2e_data_isolation: 'shared_serialised', e2e_concurrency_group: 'g', post_deploy_full_regression: false });
    expect(subjects(r)).toEqual(['feature-destructive']);
    expect(r.findings![0]!.remediation!.data).toEqual({ key: 'feature_e2e_projects', value: 'smoke,critical' });
    const limited = await check({ e2e_regression_enabled: true, e2e_data_isolation: 'shared_serialised', e2e_concurrency_group: 'g', post_deploy_full_regression: false, feature_e2e_projects: ['smoke'] });
    expect(limited.ok).toBe(true);
    const ephemeral = await check({ e2e_regression_enabled: true, e2e_data_isolation: 'ephemeral', post_deploy_full_regression: false });
    expect(ephemeral.ok).toBe(true);
  });
});

describe('test-data: live drift (seed-changed-since-last-run)', () => {
  const cfg = { e2e_regression_enabled: true, e2e_data_isolation: 'ephemeral', post_deploy_full_regression: false, e2e_seed_paths: ['seed/'] };
  const files = { 'seed/a.sql': 'x' };
  /** A mocked gh: the last run's artifact holds the given metadata (or nothing). */
  const gh = (opts: { list?: unknown; metadata?: unknown; downloadFails?: boolean; listFails?: boolean }): GhRunner =>
    async (args) => {
      if (args[0] === 'run' && args[1] === 'list') return opts.listFails ? { exitCode: 1, stdout: '' } : { exitCode: 0, stdout: JSON.stringify(opts.list ?? [{ databaseId: 9 }]) };
      if (args[0] === 'run' && args[1] === 'download') {
        if (opts.downloadFails) return { exitCode: 1, stdout: '' };
        const dir = args[args.indexOf('-D') + 1]!;
        if (opts.metadata !== undefined) await fs.writeFile(join(dir, 'e2e-regression-metadata.json'), JSON.stringify(opts.metadata));
        return { exitCode: 0, stdout: '' };
      }
      return { exitCode: 1, stdout: '' };
    };
  const deps = (g: GhRunner, current = 'HASH-NOW'): TestDataDeps => ({ ...base, gh: g, currentSeedHash: async () => current });

  it('the same hash is clean; a different hash is reported', async () => {
    const same = await check(cfg, deps(gh({ metadata: { data: { seedFilesHash: 'HASH-NOW' } } })), [], files);
    expect(same.ok).toBe(true);
    expect(same.detail).toContain('unchanged');
    const diff = await check(cfg, deps(gh({ metadata: { data: { seedFilesHash: 'HASH-OLD' } } })), [], files);
    expect(subjects(diff)).toEqual(['seed-changed-since-last-run']);
    expect(diff.findings![0]!.detail).toContain('Advisory');
  });

  it.each([
    ['no gh', gh({ listFails: true })],
    ['no run', gh({ list: [] })],
    ['no artifact', gh({ downloadFails: true })],
    ['a run without the metadata file', gh({})],
    ['the field absent', gh({ metadata: { outcome: 'passed' } })],
  ])('"not measured yet", never an error: %s', async (_label, g) => {
    const r = await check(cfg, deps(g), [], files);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('not measured yet');
  });
});

describe('the seed files hash: one definition, two implementations', () => {
  it.skipIf(process.platform === 'win32')('the shell script and the core agree on the same fixture folder', async () => {
    const dir = await repo({ 'seed/b.sql': 'second', 'seed/a.sql': 'first', 'seed/sub/z.json': '{"z":1}', 'seed/Äpfel.txt': 'unicode', 'sdlc-config.json': JSON.stringify({ e2e_data_isolation: 'ephemeral', e2e_seed_paths: ['seed/'] }) });
    await execa('git', ['init', '-q'], { cwd: dir });
    await execa('git', ['add', '-A'], { cwd: dir });
    const fromShell = (await execa('bash', [LIFECYCLE, 'hash'], { cwd: dir })).stdout.trim();
    const fromCli = await currentSeedFilesHash(dir, ['seed/']);
    expect(fromShell).toMatch(/^[0-9a-f]{64}$/);
    expect(fromCli).toBe(fromShell);
    const enc = new TextEncoder();
    expect(await seedFilesHash([
      { path: 'seed/sub/z.json', content: enc.encode('{"z":1}') },
      { path: 'seed/b.sql', content: enc.encode('second') },
      { path: 'seed/a.sql', content: enc.encode('first') },
      { path: 'seed/Äpfel.txt', content: enc.encode('unicode') },
    ])).toBe(fromShell);
  });

  it('is empty for no files and does not depend on the order given', async () => {
    expect(await seedFilesHash([])).toBe('');
    const a = { path: 'a', content: new Uint8Array([1]) };
    const b = { path: 'b', content: new Uint8Array([2]) };
    expect(await seedFilesHash([a, b])).toBe(await seedFilesHash([b, a]));
  });
});

describe('explanations, gaps and the skill mapping', () => {
  it('every finding has a --explain entry and a complete explanation', () => {
    for (const id of TEST_DATA_FINDINGS) {
      const e = CHECK_EXPLANATIONS[`test-data:${id}`];
      expect(e, id).toBeDefined();
      expect(e!.why.length, id).toBeGreaterThan(30);
      expect(renderExplanation(`test-data:${id}`), id).toContain('Why it matters:');
    }
    expect(CHECK_EXPLANATIONS['test-data']).toBeDefined();
  });

  it('data findings name e2e-test-data; every finding becomes a gap with a path to leave it', async () => {
    const r = await check({ e2e_regression_enabled: true, e2e_data_isolation: 'shared', scheduled_full_regression: '0 2 * * *', e2e_seed_command: 'npm run seed' });
    const text = JSON.stringify(r.findings);
    expect(text).toContain('e2e-test-data');
    for (const gap of gapsFromCheck(r)) {
      expect(gap.id).toMatch(/^doctor:test-data:/);
      expect(gap.options.length).toBeGreaterThan(0);
      expect(gap.why.length).toBeGreaterThan(30);
    }
  });
});

describe('configure shows the data answer when an unattended run is turned on', () => {
  const change = (key: string, before: unknown, after: unknown) => ({ key, before, after });
  it('only for a schedule, a post-deploy run or the regression turned on', () => {
    expect(turnsOnUnattendedRun({}, [change('scheduled_full_regression', undefined, '0 2 * * *')])).toBe(true);
    expect(turnsOnUnattendedRun({ post_deploy_full_regression: false }, [change('post_deploy_full_regression', false, true)])).toBe(true);
    expect(turnsOnUnattendedRun({ e2e_regression_enabled: false }, [change('e2e_regression_enabled', false, true)])).toBe(true);
    expect(turnsOnUnattendedRun({ scheduled_full_regression: '0 2 * * *' }, [change('scheduled_full_regression', '0 2 * * *', '0 3 * * *')])).toBe(false);
    expect(turnsOnUnattendedRun({}, [change('release_gate_tier', 'critical', 'full')])).toBe(false);
  });
});
