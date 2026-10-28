import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  acCoverageForReq,
  acsFromPlan,
  activeRtmReqs,
  hasToken,
  parsePlaywrightList,
  planAcs,
  preApprovalProjects,
  type ListedTest,
} from '../src/lib/ac-coverage.js';
import { testTiersCheck, type CommandRunner } from '../src/commands/doctor-tiers.js';
import type { GhRunner } from '../src/lib/deploy-detect.js';

// devaudit-installer#1096 — the static AC coverage check. No portal, no network: a fake command
// runner stands in for `playwright test --list --reporter=json`.

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function repo(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-ac-coverage-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, rel)), { recursive: true });
    await fs.writeFile(join(dir, rel), content);
  }
  return dir;
}

const PLAN = (req: string, rows: string[]): string =>
  `# Plan ${req}\n\n## 1. Goal + acceptance criteria\n\n| AC | Description | SRS |\n| --- | --- | --- |\n${rows.join('\n')}\n\n## 2. Next section\n| AC9 | not an AC of section 1 | x |\n`;

const PW_ALL = "export default { projects: [{ name: 'smoke' }, { name: 'critical' }, { name: 'regression' }] };\n";
const noGh: GhRunner = async () => ({ exitCode: 1, stdout: '' });

/** `playwright test --list --reporter=json` shape: a file suite holding specs and describe suites. */
function listJson(tests: Array<{ title: string; project: string; describe?: string }>): string {
  const bare = tests.filter((t) => !t.describe).map((t) => ({ title: t.title, tests: [{ projectName: t.project }] }));
  const described = [...new Set(tests.filter((t) => t.describe).map((t) => t.describe!))].map((d) => ({
    title: d,
    specs: tests.filter((t) => t.describe === d).map((t) => ({ title: t.title, tests: [{ projectName: t.project }] })),
  }));
  return JSON.stringify({ config: {}, suites: [{ title: 'REQ-7-fixture.spec.ts', file: 'REQ-7-fixture.spec.ts', specs: bare, suites: described }] });
}

describe('hasToken', () => {
  it('matches whole ids only', () => {
    expect(hasToken('[REQ-11][AC1] x', 'REQ-11')).toBe(true);
    expect(hasToken('[REQ-111][AC1] x', 'REQ-11')).toBe(false);
    expect(hasToken('[REQ-11][AC1] x', 'REQ-111')).toBe(false);
    expect(hasToken('[REQ-7][AC10] x', 'AC1')).toBe(false);
    expect(hasToken('[REQ-7][AC1] x', 'AC1')).toBe(true);
    expect(hasToken('XREQ-7 AC1', 'REQ-7')).toBe(false);
  });
});

describe('plan and RTM parsing', () => {
  it('reads AC rows from section 1 only and skips @e2e-deferred', () => {
    const plan = PLAN('REQ-7', ['| AC1 | one | s |', '| AC2 | two @e2e-deferred: manual | s |', '| AC3 | three | s |']);
    expect(acsFromPlan(plan)).toEqual([1, 3]);
    expect(acsFromPlan('# no section')).toEqual([]);
  });

  it('prefers compliance/plans over compliance/evidence for the plan', async () => {
    const dir = await repo({
      'compliance/plans/REQ-7/implementation-plan.md': PLAN('REQ-7', ['| AC1 | a | s |']),
      'compliance/evidence/REQ-7/implementation-plan.md': PLAN('REQ-7', ['| AC1 | a | s |', '| AC2 | b | s |']),
      'compliance/evidence/REQ-8/implementation-plan.md': PLAN('REQ-8', ['| AC1 | a | s |', '| AC2 | b | s |']),
    });
    expect(await planAcs(dir, 'REQ-7')).toEqual([1]);
    expect(await planAcs(dir, 'REQ-8')).toEqual([1, 2]);
    expect(await planAcs(dir, 'REQ-99')).toEqual([]);
  });

  it('lists only requirements that are not released', () => {
    const rtm = '| REQ-ID | Title | Status |\n| --- | --- | --- |\n| REQ-1 | a | IN PROGRESS |\n| REQ-2 | b | APPROVED - DEPLOYED |\n| REQ-3 | c | RELEASED |\n| REQ-4 | d | DEFERRED |\n';
    expect(activeRtmReqs(rtm)).toEqual(['REQ-1', 'REQ-4']);
  });
});

describe('parsePlaywrightList', () => {
  it('builds full titles from describes and spec titles, with projects, ignoring the file name', () => {
    const out = parsePlaywrightList(`warning: noise\n${listJson([{ title: '[REQ-7][AC1] a', project: 'critical', describe: 'staff flow' }, { title: 'plain', project: 'smoke' }])}\n`);
    expect(out).toEqual([
      { title: 'plain', projects: ['smoke'] },
      { title: 'staff flow [REQ-7][AC1] a', projects: ['critical'] },
    ]);
    // The file name REQ-7-fixture.spec.ts is not part of any title.
    expect(out!.some((t) => t.title.includes('fixture'))).toBe(false);
  });

  it('returns null for unreadable output', () => {
    expect(parsePlaywrightList('Error: no config')).toBeNull();
    expect(parsePlaywrightList('{ not json }')).toBeNull();
  });
});

describe('preApprovalProjects (mirrors the release-gate mapping in ci-templates)', () => {
  const declared = ['smoke', 'critical', 'regression'];
  it('maps each gate', () => {
    expect(preApprovalProjects({ e2e_project: 'smoke' }, declared)).toEqual(['smoke', 'critical']);
    expect(preApprovalProjects({ e2e_project: 'smoke', release_gate_tier: 'smoke' }, declared)).toEqual(['smoke']);
    expect(preApprovalProjects({ e2e_project: 'smoke', release_gate_tier: 'full' }, declared)).toEqual(['smoke', 'regression']);
    expect(preApprovalProjects({ e2e_project: 'smoke', release_gate_tier: 'none' }, declared)).toEqual(['smoke']);
    expect(preApprovalProjects({ e2e_project: 'smoke' }, ['smoke', 'regression'])).toEqual(['smoke']);
    expect(preApprovalProjects({}, declared)).toEqual(['chromium', 'critical']);
    expect(preApprovalProjects({}, [])).toEqual([]);
  });
});

describe('acCoverageForReq', () => {
  it('reports covered, screenshot-but-no-test and no-test (the issue fixture)', async () => {
    const dir = await repo({
      'compliance/plans/REQ-7/implementation-plan.md': PLAN('REQ-7', ['| AC1 | a | s |', '| AC2 | b | s |', '| AC3 | c | s |']),
      'compliance/evidence/REQ-7/screenshots/REQ-7-AC2-after.png': 'png',
    });
    const tests: ListedTest[] = [{ title: '[REQ-7][AC1] works', projects: ['critical'] }];
    const cov = await acCoverageForReq(dir, 'REQ-7', [1, 2, 3], tests, ['smoke', 'critical']);
    expect(cov.results.map((r) => [r.ac, r.status])).toEqual([[1, 'covered'], [2, 'screenshot-but-no-test'], [3, 'no-test']]);
    expect(cov.results[1]!.detail).toMatch(/screenshot but no test titled \[REQ-7\]\[AC2\]/);
  });

  it('flags a test that runs only in a project outside the release PR as information', async () => {
    const dir = await repo({});
    const tests: ListedTest[] = [{ title: '[REQ-7][AC1] regression only', projects: ['regression'] }];
    const cov = await acCoverageForReq(dir, 'REQ-7', [1], tests, ['smoke', 'critical']);
    expect(cov.results[0]).toMatchObject({ status: 'covered-not-rerun' });
    // With nothing known about projects, everything counts as re-run.
    expect((await acCoverageForReq(dir, 'REQ-7', [1], tests, [])).results[0]!.status).toBe('covered');
  });

  it('REQ-11 titles do not cover REQ-111 ACs', async () => {
    const dir = await repo({});
    const cov = await acCoverageForReq(dir, 'REQ-111', [1], [{ title: '[REQ-11][AC1] other requirement', projects: ['smoke'] }], ['smoke']);
    expect(cov.results[0]!.status).toBe('no-test');
  });
});

describe('test-tiers check includes the AC coverage (doctor)', () => {
  const rtm = '| REQ-ID | Title | Status |\n| --- | --- | --- |\n| REQ-7 | seven | IN PROGRESS |\n| REQ-9 | nine | RELEASED |\n';

  async function fixture(): Promise<string> {
    return repo({
      'playwright.config.ts': PW_ALL,
      'e2e/critical/a.spec.ts': "// REQ-7\ntest('x', async () => {});\n",
      'compliance/RTM.md': rtm,
      'compliance/plans/REQ-7/implementation-plan.md': PLAN('REQ-7', ['| AC1 | a | s |', '| AC2 | b | s |', '| AC3 | c | s |', '| AC4 | d @e2e-deferred: manual | s |']),
      'compliance/plans/REQ-9/implementation-plan.md': PLAN('REQ-9', ['| AC1 | released, never checked | s |']),
      'compliance/evidence/REQ-7/screenshots/REQ-7-AC2-after.png': 'png',
    });
  }

  const listing = (tests: Array<{ title: string; project: string }>, calls: string[] = []): CommandRunner => async (command) => {
    calls.push(command);
    if (command.includes('--reporter=json')) return { exitCode: 0, stdout: listJson(tests) };
    return { exitCode: 0, stdout: 'Total: 2 tests in 1 file' };
  };

  it('adds tier C findings for AC2 and AC3, skips the deferred AC and released requirements, and stays non-gating data', async () => {
    const calls: string[] = [];
    const dir = await fixture();
    const r = await testTiersCheck(dir, { e2e_project: 'smoke' }, noGh, listing([{ title: '[REQ-7][AC1] works', project: 'critical' }], calls));
    const subjects = (r.findings ?? []).map((f) => f.subject);
    expect(subjects).toContain('REQ-7 AC2');
    expect(subjects).toContain('REQ-7 AC3');
    expect(subjects.some((s) => s.startsWith('REQ-9'))).toBe(false);
    expect(subjects).not.toContain('REQ-7 AC4');
    expect(subjects).not.toContain('REQ-7 AC1');
    const ac2 = r.findings!.find((f) => f.subject === 'REQ-7 AC2')!;
    expect(ac2.remediation).toMatchObject({ tier: 'C', needsPortal: false });
    expect(ac2.remediation!.plan.join(' ')).toMatch(/release_gate_tier full/);
    expect(ac2.remediation!.plan.join(' ')).toMatch(/not applicable on the portal/);
    expect(r.acCoverage).toHaveLength(1);
    expect(r.acCoverage![0]!.results.map((x) => x.status)).toEqual(['covered', 'screenshot-but-no-test', 'no-test']);
    // One listing of all projects, not one per requirement.
    expect(calls.filter((c) => c.includes('--reporter=json'))).toEqual(['npx playwright test --list --reporter=json']);
  });

  it('reports a regression-only test as information, not a finding', async () => {
    const dir = await fixture();
    const r = await testTiersCheck(
      dir,
      { e2e_project: 'smoke' },
      noGh,
      listing([
        { title: '[REQ-7][AC1] a', project: 'regression' },
        { title: '[REQ-7][AC2] b', project: 'critical' },
        { title: '[REQ-7][AC3] c', project: 'critical' },
      ]),
    );
    expect(r.findings ?? []).toEqual([]);
    expect(r.detail).toMatch(/REQ-7 AC1 is covered only in project\(s\) regression/);
    expect(r.ok).toBe(true);
  });

  it('is not checked when the listing is unreadable, and for pytest', async () => {
    const dir = await fixture();
    const broken: CommandRunner = async (command) => (command.includes('--reporter=json') ? { exitCode: 1, stdout: 'Error' } : { exitCode: 0, stdout: 'Total: 2 tests in 1 file' });
    const r = await testTiersCheck(dir, { e2e_project: 'smoke' }, noGh, broken);
    expect(r.detail).toMatch(/AC coverage not checked/);
    expect(r.acCoverage).toBeUndefined();
    const py = await repo({ 'pytest.ini': '[pytest]\n', 'tests/test_a.py': '# REQ-7\ndef test_a(): pass\n', 'compliance/RTM.md': rtm });
    const rp = await testTiersCheck(py, { test_runner: 'pytest' }, noGh, async () => ({ exitCode: 0, stdout: 'tests/test_a.py::test_a' }));
    expect(rp.detail).toMatch(/AC coverage not checked \(runner: pytest\)/);
  });

  it('does not run the listing when no active requirement has a plan with ACs', async () => {
    const calls: string[] = [];
    const dir = await repo({ 'playwright.config.ts': PW_ALL, 'e2e/a.spec.ts': '// REQ-7\n', 'compliance/RTM.md': rtm });
    await testTiersCheck(dir, { e2e_project: 'smoke' }, noGh, listing([], calls));
    expect(calls.some((c) => c.includes('--reporter=json'))).toBe(false);
  });
});
