import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { GhRunner } from '../src/lib/deploy-detect.js';
import {
  collectVariant,
  e2eReleaseGateCheck,
  median,
  parseCollected,
  recentRegressionRuns,
  testTiersCheck,
  type CommandRunner,
} from '../src/commands/doctor-tiers.js';
import { runConfigChecks } from '../src/commands/doctor-config.js';
import { detectTestRunners } from '../src/lib/test-runner-detect.js';

// devaudit-installer#1059 Phase B / #1060 Phase C — the `e2e-release-gate` and
// `test-tiers` doctor checks. Everything external is faked: no gh, no test runner.

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function repo(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-doctor-tiers-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, rel)), { recursive: true });
    await fs.writeFile(join(dir, rel), content);
  }
  return dir;
}

const NOW = Date.parse('2026-10-21T12:00:00Z');
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();
const DAY = 24 * 3600 * 1000;

interface RunRow {
  readonly minutes: number;
  readonly event?: string;
  readonly ageDays?: number;
  readonly conclusion?: string;
  readonly status?: string;
}
function gh(runs: readonly RunRow[] | null): GhRunner {
  return async (args) => {
    if (args[0] === 'run' && args[1] === 'list' && runs !== null) {
      const rows = runs.map((r) => {
        const start = NOW - (r.ageDays ?? 1) * DAY;
        return {
          status: r.status ?? 'completed',
          conclusion: r.conclusion ?? 'success',
          event: r.event ?? 'pull_request',
          startedAt: iso(start - NOW),
          updatedAt: iso(start - NOW + r.minutes * 60_000),
        };
      });
      return { exitCode: 0, stdout: JSON.stringify(rows) };
    }
    return { exitCode: 1, stdout: '' };
  };
}
const times = (n: number, minutes: number, extra: Partial<RunRow> = {}): RunRow[] => Array.from({ length: n }, () => ({ minutes, ...extra }));

const PW_ALL = "export default { projects: [{ name: 'smoke' }, { name: 'critical' }, { name: 'regression' }] };\n";
const PW_SMOKE_ONLY = "export default { projects: [{ name: 'smoke' }] };\n";

describe('e2e-release-gate', () => {
  it('is quiet for a project that has not opted in', async () => {
    const r = await e2eReleaseGateCheck(await repo(), {}, gh(null), () => NOW);
    expect(r).toMatchObject({ name: 'e2e-release-gate', ok: true });
    expect(r.detail).toMatch(/not opted in/);
  });

  it('flags a gate key while the regression workflow is not generated', async () => {
    const r = await e2eReleaseGateCheck(await repo(), { release_gate_tier: 'full' }, gh(null), () => NOW);
    expect(r.ok).toBe(false);
    expect(r.findings![0]!.remediation).toMatchObject({ id: 'enable-e2e-regression', tier: 'C' });
  });

  it('flags an invalid gate value', async () => {
    const r = await e2eReleaseGateCheck(await repo({ 'playwright.config.ts': PW_ALL }), { e2e_regression_enabled: true, release_gate_tier: 'everything' }, gh(null), () => NOW);
    expect(r.ok).toBe(false);
    expect(r.findings!.some((f) => f.subject === 'release_gate_tier')).toBe(true);
  });

  it('full needs a runnable tier: a regression project or a command', async () => {
    const cfg = { e2e_regression_enabled: true, release_gate_tier: 'full' };
    const missing = await e2eReleaseGateCheck(await repo({ 'playwright.config.ts': PW_SMOKE_ONLY }), cfg, gh(null), () => NOW);
    expect(missing.ok).toBe(false);
    expect(missing.findings![0]!.remediation!.id).toBe('define-full-tier');
    expect((await e2eReleaseGateCheck(await repo({ 'playwright.config.ts': PW_ALL }), cfg, gh(null), () => NOW)).ok).toBe(true);
    expect((await e2eReleaseGateCheck(await repo({ 'playwright.config.ts': PW_SMOKE_ONLY }), { ...cfg, test_tier_full: 'make full' }, gh(null), () => NOW)).ok).toBe(true);
    expect((await e2eReleaseGateCheck(await repo(), { ...cfg, test_runner: 'pytest' }, gh(null), () => NOW)).ok).toBe(true);
  });

  it('a critical gate without a critical project is a note, not a finding', async () => {
    const r = await e2eReleaseGateCheck(await repo({ 'playwright.config.ts': PW_SMOKE_ONLY }), { e2e_regression_enabled: true }, gh(null), () => NOW);
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/no `critical` Playwright project/);
  });

  it('notes the redundant post-deploy run when the full tier already gates the release PR', async () => {
    const cfg = { e2e_regression_enabled: true, release_gate_tier: 'full' };
    const dir = await repo({ 'playwright.config.ts': PW_ALL });
    expect((await e2eReleaseGateCheck(dir, cfg, gh(null), () => NOW)).detail).toMatch(/same commit twice/);
    expect((await e2eReleaseGateCheck(dir, { ...cfg, post_deploy_full_regression: false }, gh(null), () => NOW)).detail).not.toMatch(/same commit twice/);
  });

  it('flags a full gate whose recent runs are longer than the job timeout (regression-run.sh hook)', async () => {
    const dir = await repo({ 'playwright.config.ts': PW_ALL, 'e2e/ci-reliability/regression-run.sh': '#!/usr/bin/env bash\n' });
    const cfg = { e2e_regression_enabled: true, release_gate_tier: 'full' };
    const slow = await e2eReleaseGateCheck(dir, cfg, gh(times(5, 70)), () => NOW);
    expect(slow.ok).toBe(false);
    expect(slow.findings![0]!.detail).toMatch(/median of the last 5 .* 70 min, above the 55-minute job timeout/);
    expect(slow.findings![0]!.remediation!.plan[0]).toBe('devaudit configure set e2e_regression_timeout_minutes 88');
    expect((await e2eReleaseGateCheck(dir, { ...cfg, e2e_regression_timeout_minutes: 90 }, gh(times(5, 70)), () => NOW)).ok).toBe(true);
    // runs that did not finish, or were cancelled, are ignored
    expect((await e2eReleaseGateCheck(dir, cfg, gh([...times(5, 70, { conclusion: 'cancelled' }), ...times(5, 70, { status: 'in_progress' })]), () => NOW)).ok).toBe(true);
  });

  it('without the hook the fixed 40-minute test limit binds, and raising the job timeout is not offered (#1082 review)', async () => {
    const dir = await repo({ 'playwright.config.ts': PW_ALL });
    const cfg = { e2e_regression_enabled: true, release_gate_tier: 'full', e2e_regression_timeout_minutes: 90 };
    const slow = await e2eReleaseGateCheck(dir, cfg, gh(times(5, 45)), () => NOW);
    expect(slow.ok).toBe(false);
    expect(slow.findings![0]!.detail).toMatch(/45 min, above the 40-minute limit on the test command/);
    expect(slow.findings![0]!.remediation!.id).toBe('fit-regression-test-limit');
    expect(slow.findings![0]!.remediation!.plan.join(' ')).not.toMatch(/configure set e2e_regression_timeout_minutes/);
    // pytest has no hook: the hook file does not lift the limit there
    const py = await repo({ 'pytest.ini': '[pytest]\n', 'e2e/ci-reliability/regression-run.sh': '#!/usr/bin/env bash\n' });
    const pyRes = await e2eReleaseGateCheck(py, { ...cfg, test_runner: 'pytest', test_tier_full: 'pytest' }, gh(times(5, 45)), () => NOW);
    expect(pyRes.findings?.some((f) => f.remediation?.id === 'fit-regression-test-limit')).toBe(true);
    expect((await e2eReleaseGateCheck(dir, cfg, gh(times(5, 30)), () => NOW)).findings ?? []).toEqual([]);
  });

  it('reports a schedule that has not produced a run in a week', async () => {
    const dir = await repo({ 'playwright.config.ts': PW_ALL });
    const cfg = { e2e_regression_enabled: true, scheduled_full_regression: '0 3 * * *' };
    expect((await e2eReleaseGateCheck(dir, cfg, gh(times(3, 30)), () => NOW)).detail).toMatch(/no scheduled run completed in the last 7 days/);
    expect((await e2eReleaseGateCheck(dir, cfg, gh([...times(3, 30), { minutes: 30, event: 'schedule', ageDays: 2 }]), () => NOW)).detail).not.toMatch(/no scheduled run/);
    expect((await e2eReleaseGateCheck(dir, cfg, gh([...times(3, 30), { minutes: 30, event: 'schedule', ageDays: 9 }]), () => NOW)).detail).toMatch(/no scheduled run/);
  });

  it('recommends a tier from the median run time, and says when history is too short', async () => {
    const dir = await repo({ 'playwright.config.ts': PW_ALL });
    const cfg = { e2e_regression_enabled: true };
    expect((await e2eReleaseGateCheck(dir, cfg, gh(times(4, 12)), () => NOW)).detail).toMatch(/full tier is affordable before merge/);
    expect((await e2eReleaseGateCheck(dir, cfg, gh(times(4, 40)), () => NOW)).detail).toMatch(/consider scheduled_full_regression/);
    expect((await e2eReleaseGateCheck(dir, { ...cfg, release_gate_tier: 'full' }, gh(times(4, 40)), () => NOW)).detail).toMatch(/critical on the release PR plus scheduled_full_regression/);
    expect((await e2eReleaseGateCheck(dir, cfg, gh(times(2, 12)), () => NOW)).detail).toMatch(/only 2 completed/);
  });

  it('says what it could not check when gh has no run history', async () => {
    const r = await e2eReleaseGateCheck(await repo({ 'playwright.config.ts': PW_ALL }), { e2e_regression_enabled: true }, gh(null), () => NOW);
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/not visible/);
  });

  it('never proposes anything the user did not choose: every remediation is tier C guidance', async () => {
    const dir = await repo({ 'playwright.config.ts': PW_SMOKE_ONLY });
    const results = [
      await e2eReleaseGateCheck(dir, { release_gate_tier: 'full' }, gh(null), () => NOW),
      await e2eReleaseGateCheck(dir, { e2e_regression_enabled: true, release_gate_tier: 'full' }, gh(times(5, 70)), () => NOW),
    ];
    for (const finding of results.flatMap((r) => r.findings ?? [])) {
      expect(finding.remediation!.tier).toBe('C');
      expect(finding.remediation!.needsPortal).toBe(false);
    }
  });
});

describe('recentRegressionRuns', () => {
  it('keeps only finished success/failure runs with a sane duration', async () => {
    const runs = await recentRegressionRuns('.', gh([{ minutes: 10 }, { minutes: 20, conclusion: 'failure' }, { minutes: 5, conclusion: 'skipped' }, { minutes: 5, status: 'queued' }]));
    expect(runs!.map((r) => r.minutes)).toEqual([10, 20]);
    expect(await recentRegressionRuns('.', gh(null))).toBeNull();
  });
  it('median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe('collect helpers', () => {
  it('derives a collect-only variant of a custom tier command', () => {
    expect(collectVariant('npx playwright test --project=x --reporter=json,html')).toBe('npx playwright test --project=x --reporter=json,html --list');
    expect(collectVariant('pytest -m smoke --junit-xml=junit.xml')).toBe('pytest -m smoke --collect-only -q');
    expect(collectVariant('python -m pytest tests/api')).toBe('python -m pytest tests/api --collect-only -q');
    expect(collectVariant('npx jest --selectProjects api')).toBe('npx jest --selectProjects api --listTests');
    expect(collectVariant('npx vitest run --project smoke')).toBe('npx vitest list --project smoke');
    expect(collectVariant('make smoke')).toBeNull();
  });

  it('counts collected tests from each runner', () => {
    expect(parseCollected('npx playwright test --list', { exitCode: 0, stdout: 'Listing tests:\n  a\nTotal: 12 tests in 3 files' })).toBe(12);
    expect(parseCollected('npx playwright test --list', { exitCode: 1, stdout: 'Error: No tests found' })).toBe(0);
    expect(parseCollected('npx playwright test --list', { exitCode: 1, stdout: 'boom' })).toBeNull();
    expect(parseCollected('pytest --collect-only -q', { exitCode: 0, stdout: 'a.py::t1\na.py::t2\n\n2 tests collected in 0.01s' })).toBe(2);
    expect(parseCollected('pytest --collect-only -q', { exitCode: 5, stdout: 'no tests collected' })).toBe(0);
    expect(parseCollected('pytest --collect-only -q', { exitCode: 0, stdout: '4 tests collected' })).toBe(4);
    expect(parseCollected('npx jest --listTests', { exitCode: 0, stdout: '/r/a.test.ts\n/r/b.test.ts\n' })).toBe(2);
    expect(parseCollected('npx jest --listTests', { exitCode: 1, stdout: '' })).toBeNull();
    expect(parseCollected('npx vitest list', { exitCode: 0, stdout: 'a > t1\nb > t2\n' })).toBe(2);
    expect(parseCollected('something else', { exitCode: 0, stdout: 'x' })).toBeNull();
  });
});

/** A runner that answers by the first substring that matches and records every command. */
function runner(answers: Record<string, string>, calls: string[] = []): CommandRunner {
  return async (command) => {
    calls.push(command);
    const hit = Object.keys(answers).find((k) => command.includes(k));
    if (!hit) return { exitCode: 1, stdout: '' };
    return { exitCode: answers[hit] === 'NONE' ? 5 : 0, stdout: answers[hit] === 'NONE' ? 'no tests collected' : answers[hit]! };
  };
}

describe('test-tiers', () => {
  it('skips a repo with no runner and no tier commands; points a jest repo at the tier keys', async () => {
    const r = await testTiersCheck(await repo(), {}, gh(null), runner({}));
    expect(r).toMatchObject({ name: 'test-tiers', ok: true });
    expect(r.detail).toMatch(/skipped/);
    const jest = await testTiersCheck(await repo({ 'jest.config.js': 'module.exports = {};\n' }), {}, gh(null), runner({}));
    expect(jest.detail).toMatch(/jest detected but no tier commands set/);
  });

  it('collects the pytest tiers by marker and flags an empty smoke tier with the skill hand-off', async () => {
    const calls: string[] = [];
    const dir = await repo({ 'pytest.ini': '[pytest]\n', 'tests/test_a.py': '# REQ-1\ndef test_a(): pass\n' });
    const r = await testTiersCheck(dir, { e2e_regression_enabled: true }, gh(null), runner({ '-m smoke': 'NONE', '-m "smoke or critical"': 'NONE', 'collect-only -q': 'tests/test_a.py::test_a' }, calls));
    expect(calls).toEqual(['pytest --collect-only -q -m smoke', 'pytest --collect-only -q -m "smoke or critical"', 'pytest --collect-only -q']);
    expect(r.ok).toBe(false);
    const smoke = r.findings!.find((f) => f.subject === 'smoke')!;
    expect(smoke.detail).toMatch(/there are tests but none in the smoke tier yet/);
    expect(smoke.remediation!.plan[0]).toMatch(/e2e-test-engineer skill/);
    expect(r.findings!.some((f) => f.subject === 'critical')).toBe(true);
    expect(r.detail).toMatch(/smoke 0, critical 0, full 1/);
  });

  it('says no tests yet when the repo has a runner but nothing to run', async () => {
    const r = await testTiersCheck(await repo({ 'pytest.ini': '[pytest]\n' }), {}, gh(null), runner({ '-m smoke': 'NONE' }));
    expect(r.findings![0]!.detail).toBe('no tests yet: the smoke tier resolves to zero tests');
  });

  it('collects Playwright projects, notes identical smoke and critical, and reads the project list from the config', async () => {
    const calls: string[] = [];
    const dir = await repo({ 'playwright.config.ts': PW_ALL, 'e2e/a.spec.ts': "// REQ-1\ntest('a', async () => {});\n" });
    const r = await testTiersCheck(
      dir,
      { e2e_regression_enabled: true, e2e_project: 'smoke' },
      gh(null),
      runner({ '--project=smoke': 'Total: 3 tests in 1 file', '--project=critical': 'Total: 3 tests in 1 file', '--project=regression': 'Total: 9 tests in 2 files' }, calls),
    );
    expect(calls).toEqual(['npx playwright test --list --project=smoke', 'npx playwright test --list --project=critical', 'npx playwright test --list --project=regression']);
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/smoke 3, critical 3, full 9/);
    expect(r.detail).toMatch(/critical tier selects exactly the smoke tests/);
  });

  it('does not probe a critical or regression project that is not defined', async () => {
    const calls: string[] = [];
    const dir = await repo({ 'playwright.config.ts': PW_SMOKE_ONLY, 'e2e/a.spec.ts': '// REQ-1\n' });
    const r = await testTiersCheck(dir, { e2e_project: 'smoke' }, gh(null), runner({ 'Total': 'Total: 2 tests in 1 file' }, calls));
    expect(calls).toEqual(['npx playwright test --list --project=smoke']);
    expect(r.detail).toMatch(/no `critical` Playwright project/);
    expect(r.ok).toBe(true);
  });

  it('uses a custom tier command through its collect-only variant, and does not guess for an unknown one', async () => {
    const calls: string[] = [];
    const dir = await repo({ 'pytest.ini': '[pytest]\n', 'tests/test_a.py': '# REQ-1\n' });
    const r = await testTiersCheck(dir, { test_tier_smoke: 'pytest -m api --junit-xml=x.xml', test_tier_full: 'make all' }, gh(null), runner({ 'collect-only': 'tests/test_a.py::t1' }, calls));
    expect(calls).toEqual(['pytest -m api --collect-only -q']);
    expect(r.detail).toMatch(/test_tier_full is a custom command that cannot be collected without running/);
    expect(r.ok).toBe(true);
  });

  it('a collect command that fails is "unknown", never a finding', async () => {
    const r = await testTiersCheck(await repo({ 'pytest.ini': '[pytest]\n', 'tests/test_a.py': '# REQ-1\n' }), {}, gh(null), runner({}));
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/smoke \?/);
  });

  it('reports test files with no requirement tag, and requirements with no test', async () => {
    const dir = await repo({
      'pytest.ini': '[pytest]\n',
      'tests/test_tagged.py': '# REQ-1\n',
      'tests/test_untagged.py': 'def test_x(): pass\n',
      'compliance/RTM.md': '| REQ-1 | a |\n| REQ-2 | b |\n| REQ-10 | c |\n',
    });
    const r = await testTiersCheck(dir, {}, gh(null), runner({ '-m smoke': 'tests/test_tagged.py::t' }));
    const untagged = r.findings!.find((f) => f.subject === 'requirement-tags')!;
    expect(untagged.detail).toMatch(/1 test file\(s\) carry no requirement tag.*test_untagged\.py/);
    expect(untagged.remediation!.tier).toBe('C');
    expect(r.detail).toMatch(/2 RTM requirement\(s\) have no test in any tier.*REQ-2, REQ-10/);
  });

  it('REQ-1 is not satisfied by a test that only mentions REQ-10', async () => {
    const dir = await repo({ 'pytest.ini': '[pytest]\n', 'tests/test_a.py': '# REQ-10\n', 'compliance/RTM.md': '| REQ-1 | a |\n' });
    const r = await testTiersCheck(dir, {}, gh(null), runner({ '-m smoke': 'tests/test_a.py::t' }));
    expect(r.detail).toMatch(/1 RTM requirement\(s\) have no test.*REQ-1/);
  });

  it('flags regression runs longer than their timeout unless the full gate reports it itself', async () => {
    const dir = await repo({ 'pytest.ini': '[pytest]\n', 'tests/test_a.py': '# REQ-1\n' });
    const answers = { '-m smoke': 'tests/test_a.py::t', 'collect-only -q': 'tests/test_a.py::t' };
    const slow = await testTiersCheck(dir, { e2e_regression_enabled: true }, gh(times(5, 70)), runner(answers));
    expect(slow.findings!.some((f) => f.subject === 'e2e_regression_timeout_minutes')).toBe(true);
    const full = await testTiersCheck(dir, { e2e_regression_enabled: true, release_gate_tier: 'full' }, gh(times(5, 70)), runner(answers));
    expect(full.findings?.some((f) => f.subject === 'e2e_regression_timeout_minutes') ?? false).toBe(false);
  });
});

describe('detectTestRunners', () => {
  it('finds each runner from the files it needs', async () => {
    expect(await detectTestRunners(await repo())).toMatchObject({ playwright: false, pytest: false, jest: false, vitest: false });
    expect(await detectTestRunners(await repo({ 'playwright.config.ts': PW_ALL }))).toMatchObject({ playwright: true, playwrightConfig: 'playwright.config.ts' });
    expect((await detectTestRunners(await repo({ 'pyproject.toml': '[tool.pytest.ini_options]\nmarkers = []\n' }))).pytest).toBe(true);
    expect((await detectTestRunners(await repo({ 'conftest.py': '' }))).pytest).toBe(true);
    expect((await detectTestRunners(await repo({ 'package.json': '{"devDependencies":{"vitest":"^2"}}' }))).vitest).toBe(true);
    expect((await detectTestRunners(await repo({ 'package.json': '{"jest":{}}' }))).jest).toBe(true);
  });
});

describe('runConfigChecks includes the new checks', () => {
  it('appends e2e-release-gate and test-tiers after the existing checks', async () => {
    const dir = await repo();
    const results = await runConfigChecks(dir, { host: 'railway' }, {
      gh: gh(null),
      run: runner({}),
      detection: { recorded: 'railway', detected: null, confidence: 'none', evidence: [], unchecked: [], environmentUrl: null },
    });
    expect(results.map((r) => r.name).slice(-2)).toEqual(['e2e-release-gate', 'test-tiers']);
  });
});
