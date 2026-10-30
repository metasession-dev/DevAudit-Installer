import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { execa } from 'execa';
import type { CheckResult, Finding } from '../lib/doctor-types.js';
import type { GhRunner } from '../lib/deploy-detect.js';
import { detectTestRunners, playwrightProjectNames } from '../lib/test-runner-detect.js';
import {
  acCoverageForReq,
  activeRtmReqs,
  parsePlaywrightList,
  planAcs,
  preApprovalProjects,
  type ReqCoverage,
} from '../lib/ac-coverage.js';

/**
 * devaudit-installer#1059 / #1060 — two read-only, non-gating doctor checks that
 * review the project's test tiers and its release gate. Doctor diagnoses and
 * proposes (tier C guidance, printed, never applied by `--fix`); the user
 * applies a change through `devaudit configure`, and a skill writes tests.
 *
 *  - `e2e-release-gate`: is the configured release gate coherent, affordable
 *    and backed by a runnable tier?
 *  - `test-tiers`: does each declared tier resolve to tests (found by
 *    collecting, never by running them), are the tests tagged with a
 *    requirement, and is there a smoke tier at all?
 */

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
}
/** Runs a shell command in a directory (test seam, like `GhRunner`). */
export type CommandRunner = (command: string, cwd: string) => Promise<CommandResult>;

export const defaultRun: CommandRunner = async (command, cwd) => {
  try {
    const r = await execa(command, { cwd, shell: true, reject: false, timeout: 60_000 });
    return { exitCode: r.exitCode ?? 1, stdout: `${r.stdout}\n${r.stderr}` };
  } catch {
    return { exitCode: 1, stdout: '' };
  }
};

/** Like `defaultRun` but stdout only, for output that is parsed as JSON. */
export const defaultListRun: CommandRunner = async (command, cwd) => {
  try {
    const r = await execa(command, { cwd, shell: true, reject: false, timeout: 120_000 });
    return { exitCode: r.exitCode ?? 1, stdout: r.stdout };
  } catch {
    return { exitCode: 1, stdout: '' };
  }
};

type Tier = 'smoke' | 'critical' | 'full';
type Gate = 'none' | Tier;

const GATES: readonly string[] = ['none', 'smoke', 'critical', 'full'];
const DEFAULT_TIMEOUT_MINUTES = 55;

/**
 * The e2e-regression.yml test command runs under a fixed `timeout ... 40m` inside the
 * job (devaudit-installer#928). Only a Playwright project with the
 * e2e/ci-reliability/regression-run.sh hook runs under the job budget instead.
 */
const TEST_COMMAND_TIMEOUT_MINUTES = 40;

interface RegressionTimeLimit {
  readonly minutes: number;
  /** `test`: the fixed 40-minute limit binds, which e2e_regression_timeout_minutes cannot raise. */
  readonly boundBy: 'test' | 'job';
}

async function regressionTimeLimit(repoRoot: string, cfg: Record<string, unknown>): Promise<RegressionTimeLimit> {
  const raw = cfg['e2e_regression_timeout_minutes'];
  const job = typeof raw === 'number' && raw > 0 ? raw : DEFAULT_TIMEOUT_MINUTES;
  const hook =
    str(cfg, 'test_runner') !== 'pytest' &&
    (await fs.access(join(repoRoot, str(cfg, 'working_directory') || '.', 'e2e', 'ci-reliability', 'regression-run.sh')).then(
      () => true,
      () => false,
    ));
  if (hook || job <= TEST_COMMAND_TIMEOUT_MINUTES) return { minutes: job, boundBy: 'job' };
  return { minutes: TEST_COMMAND_TIMEOUT_MINUTES, boundBy: 'test' };
}

/** The finding for a median run time above the limit that actually stops the run. */
function regressionTimeFinding(prefix: string, runCount: number, med: number, limit: RegressionTimeLimit, tierWord: string): Finding {
  const base = `${prefix}the median of the last ${runCount} E2E Regression runs is ${fmt(med)}`;
  if (limit.boundBy === 'job') {
    return {
      subject: 'e2e_regression_timeout_minutes',
      detail: `${base}, above the ${limit.minutes}-minute job timeout`,
      remediation: guidance('raise-regression-budget', `Give the ${tierWord} tier a budget it fits in`, [
        `devaudit configure set e2e_regression_timeout_minutes ${Math.ceil(med * 1.25)}`,
        'or shard the pack: e2e-test-engineer Phase 6, e2e/ci-reliability/regression-run.sh',
      ]),
    };
  }
  return {
    subject: 'e2e_regression_timeout_minutes',
    detail: `${base}, above the ${limit.minutes}-minute limit on the test command (the run time includes setup)`,
    remediation: guidance('fit-regression-test-limit', `Fit the ${tierWord} tier into the ${limit.minutes}-minute test limit`, [
      `raising e2e_regression_timeout_minutes does not help: the test command runs under a fixed ${limit.minutes}-minute timeout`,
      'shard the pack with e2e/ci-reliability/regression-run.sh (e2e-test-engineer Phase 6), which runs under e2e_regression_timeout_minutes instead (Playwright only)',
      'or move slow tests out of this tier',
    ]),
  };
}

const guidance = (id: string, summary: string, plan: string[]): NonNullable<Finding['remediation']> => ({
  id,
  tier: 'C',
  summary,
  plan,
  needsPortal: false,
});

const str = (cfg: Record<string, unknown>, key: string): string => {
  const v = cfg[key];
  return typeof v === 'string' ? v.trim() : '';
};

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/* ------------------------------------------------------------------ */
/* Recent E2E Regression runs (via gh)                                 */
/* ------------------------------------------------------------------ */

export interface RegressionRun {
  readonly event: string;
  readonly startedAt: string;
  readonly minutes: number;
}

/** Completed (success or failure) runs of e2e-regression.yml, newest first; null when gh cannot say. */
export async function recentRegressionRuns(repoRoot: string, gh: GhRunner): Promise<RegressionRun[] | null> {
  const r = await gh(
    ['run', 'list', '--workflow', 'e2e-regression.yml', '--limit', '30', '--json', 'status,conclusion,event,startedAt,updatedAt'],
    repoRoot,
  );
  if (r.exitCode !== 0) return null;
  try {
    const rows = JSON.parse(r.stdout) as Array<{ status?: string; conclusion?: string; event?: string; startedAt?: string; updatedAt?: string }>;
    return rows.flatMap((row) => {
      if (row.status !== 'completed' || (row.conclusion !== 'success' && row.conclusion !== 'failure')) return [];
      const start = Date.parse(row.startedAt ?? '');
      const end = Date.parse(row.updatedAt ?? '');
      if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
      return [{ event: row.event ?? '', startedAt: row.startedAt ?? '', minutes: (end - start) / 60_000 }];
    });
  } catch {
    return null;
  }
}

const fmt = (minutes: number): string => `${Math.round(minutes)} min`;

/* ------------------------------------------------------------------ */
/* e2e-release-gate                                                    */
/* ------------------------------------------------------------------ */

export async function e2eReleaseGateCheck(
  repoRoot: string,
  cfg: Record<string, unknown>,
  gh: GhRunner,
  now: () => number = Date.now,
): Promise<CheckResult> {
  const name = 'e2e-release-gate';
  const enabled = cfg['e2e_regression_enabled'] === true;
  const rawGate = str(cfg, 'release_gate_tier');
  const configuredGate = GATES.includes(rawGate) ? (rawGate as Gate) : undefined;
  const postKey = typeof cfg['post_deploy_full_regression'] === 'boolean' ? (cfg['post_deploy_full_regression'] as boolean) : undefined;
  const cron = str(cfg, 'scheduled_full_regression');
  const anyKey = configuredGate !== undefined || postKey !== undefined || cron !== '';
  const findings: Finding[] = [];
  const notes: string[] = [];

  if (rawGate !== '' && configuredGate === undefined) {
    const detail = `release_gate_tier \`${rawGate}\` is not one of none, smoke, critical, full; the default (critical) applies`;
    findings.push({ subject: 'release_gate_tier', detail, remediation: guidance('fix-release-gate', 'Set a valid release gate', ['devaudit configure set release_gate_tier critical']) });
  }

  if (!enabled) {
    if (!anyKey && findings.length === 0) {
      return { name, ok: true, detail: 'not opted in (e2e_regression_enabled is not set)', suspectedOrigin: 'consumer-drift' };
    }
    const detail = 'a release-gate key is set but e2e_regression_enabled is not true, so no e2e-regression.yml is generated and the gate has no effect';
    findings.push({
      subject: 'e2e_regression_enabled',
      detail,
      remediation: guidance('enable-e2e-regression', 'Enable the E2E regression workflow or drop the gate keys', ['devaudit update --enable-e2e-regression <path>', 'or remove release_gate_tier / post_deploy_full_regression / scheduled_full_regression from sdlc-config.json']),
    });
    return { name, ok: false, detail, suspectedOrigin: 'consumer-drift', findings };
  }

  const gate: Gate = configuredGate ?? 'critical';
  const postDeploy = postKey ?? true;
  const runner = str(cfg, 'test_runner') === 'pytest' ? 'pytest' : 'playwright';
  const summary = `gate ${gate}${configuredGate ? '' : ' (default)'}, post-deploy ${postDeploy ? 'on' : 'off'}, schedule ${cron || 'off'}`;

  // A tier the gate needs must be runnable: a custom command, a pytest default, or a Playwright project.
  if (runner === 'playwright' && (gate === 'full' || gate === 'critical') && !str(cfg, `test_tier_${gate}`)) {
    const detection = await detectTestRunners(repoRoot);
    const configText = detection.playwrightConfig ? await fs.readFile(join(repoRoot, detection.playwrightConfig), 'utf-8').catch(() => '') : '';
    const projects = playwrightProjectNames(configText);
    const wanted = gate === 'full' ? 'regression' : 'critical';
    if (!projects.includes(wanted)) {
      if (gate === 'full') {
        const detail = `release_gate_tier is full but there is no \`regression\` Playwright project and no test_tier_full command, so the release PR has nothing to run`;
        findings.push({
          subject: 'release_gate_tier',
          detail,
          remediation: guidance('define-full-tier', 'Define the full tier', ['add a `regression` project to playwright.config.ts', 'or devaudit configure set test_tier_full "<command>"']),
        });
      } else {
        notes.push('no `critical` Playwright project: the critical gate runs the smoke project (a valid two-tier setup; devaudit configure set release_gate_tier smoke says so explicitly)');
      }
    }
  }

  if (gate === 'full' && postDeploy) {
    notes.push('full on the release PR and post_deploy_full_regression on test the same commit twice; consider devaudit configure set post_deploy_full_regression false');
  }
  if ((gate === 'none' || gate === 'smoke') && !cron) {
    notes.push(`gate ${gate} runs nothing larger than smoke before merge; the full regression then only runs after deploy`);
  }

  const runs = await recentRegressionRuns(repoRoot, gh);
  if (runs === null) {
    notes.push('recent E2E Regression runs are not visible (gh unavailable): duration and schedule checks skipped');
  } else {
    const limit = await regressionTimeLimit(repoRoot, cfg);
    const med = runs.length >= 3 ? median(runs.map((r) => r.minutes)) : null;
    if (med !== null && gate === 'full' && med > limit.minutes) {
      findings.push(regressionTimeFinding('release_gate_tier is full but ', runs.length, med, limit, 'full'));
    }
    if (cron) {
      const weekAgo = now() - 7 * 24 * 3600 * 1000;
      if (!runs.some((r) => r.event === 'schedule' && Date.parse(r.startedAt) >= weekAgo)) {
        notes.push(`scheduled_full_regression is set (${cron}) but no scheduled run completed in the last 7 days (the workflow must be on the default branch to be scheduled)`);
      }
    }
    if (med !== null) {
      if (med < 20 && gate !== 'full') {
        notes.push(`median E2E Regression run is ${fmt(med)}: the full tier is affordable before merge (devaudit configure set release_gate_tier full)`);
      } else if (med >= 20 && gate === 'full' && !cron) {
        notes.push(`median E2E Regression run is ${fmt(med)}: critical on the release PR plus scheduled_full_regression may fit better`);
      } else if (med >= 20 && gate !== 'full' && !cron) {
        notes.push(`median E2E Regression run is ${fmt(med)}: consider scheduled_full_regression for an earlier signal`);
      }
    } else if (runs.length > 0) {
      notes.push(`only ${runs.length} completed E2E Regression run(s): not enough history to recommend a tier`);
    }
  }

  const parts = [summary, ...findings.map((f) => f.detail), ...notes];
  return { name, ok: findings.length === 0, detail: parts.join('; '), suspectedOrigin: 'consumer-drift', ...(findings.length > 0 ? { findings } : {}) };
}

/* ------------------------------------------------------------------ */
/* test-tiers                                                          */
/* ------------------------------------------------------------------ */

const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'compliance', 'coverage']);

async function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name), accept, out);
    } else if (accept(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Collect-only variant of a custom tier command, or null when it cannot be derived safely. */
export function collectVariant(command: string): string | null {
  const cmd = command.trim();
  if (/^(npx\s+)?playwright\s+test\b/.test(cmd)) return `${cmd} --list`;
  if (/^(python3?\s+-m\s+)?pytest\b/.test(cmd)) return `${cmd.replace(/\s--junit-xml(=|\s+)\S+/g, '')} --collect-only -q`;
  if (/^(npx\s+)?jest\b/.test(cmd)) return `${cmd} --listTests`;
  if (/^(npx\s+)?vitest\s+run\b/.test(cmd)) return cmd.replace(/vitest\s+run\b/, 'vitest list');
  return null;
}

/** Number of tests a collect command found, or null when its output cannot say. */
export function parseCollected(command: string, result: CommandResult): number | null {
  const out = result.stdout;
  if (/playwright\s+test/.test(command)) {
    const total = /Total:\s*(\d+)\s+tests?/.exec(out);
    if (total) return Number(total[1]);
    return /No tests found/i.test(out) ? 0 : null;
  }
  if (/pytest/.test(command)) {
    if (result.exitCode === 5 || /no tests (were )?collected/i.test(out)) return 0;
    const ids = out.split('\n').filter((l) => l.includes('::')).length;
    if (ids > 0) return ids;
    const summary = /(\d+)\s+tests?\s+collected/.exec(out);
    return summary ? Number(summary[1]) : null;
  }
  if (/jest\b.*--listTests/.test(command)) {
    if (result.exitCode !== 0) return null;
    return out.split('\n').filter((l) => /[\\/]/.test(l.trim())).length;
  }
  if (/vitest\s+list/.test(command)) {
    return result.exitCode === 0 ? out.split('\n').filter((l) => l.trim() !== '').length : null;
  }
  return null;
}

interface TierProbe {
  readonly tier: Tier;
  readonly count: number | null;
  readonly declared: boolean;
  readonly custom: boolean;
}

export async function testTiersCheck(
  repoRoot: string,
  cfg: Record<string, unknown>,
  gh: GhRunner,
  run: CommandRunner = defaultRun,
): Promise<CheckResult & { readonly acCoverage?: readonly ReqCoverage[] }> {
  const name = 'test-tiers';
  const detection = await detectTestRunners(repoRoot);
  const keys = (['smoke', 'critical', 'full'] as const).filter((t) => str(cfg, `test_tier_${t}`) !== '');
  const enabled = cfg['e2e_regression_enabled'] === true;
  const configuredRunner = str(cfg, 'test_runner');
  const runner: 'playwright' | 'pytest' | null =
    configuredRunner === 'pytest' ? 'pytest' : configuredRunner === 'playwright' ? 'playwright' : detection.playwright ? 'playwright' : detection.pytest ? 'pytest' : null;

  if (runner === null && keys.length === 0) {
    const other = detection.jest ? 'jest' : detection.vitest ? 'vitest' : null;
    return {
      name,
      ok: true,
      detail: other ? `${other} detected but no tier commands set: devaudit configure set test_tier_smoke "<command>" to define tiers` : 'skipped (no Playwright or pytest setup found, no tier commands set)',
      suspectedOrigin: 'consumer-drift',
    };
  }

  const findings: Finding[] = [];
  const notes: string[] = [];
  const configText = detection.playwrightConfig ? await fs.readFile(join(repoRoot, detection.playwrightConfig), 'utf-8').catch(() => '') : '';
  const projects = playwrightProjectNames(configText);
  const e2eProject = str(cfg, 'e2e_project') || 'chromium';

  const probes: TierProbe[] = [];
  for (const tier of ['smoke', 'critical', 'full'] as const) {
    const custom = str(cfg, `test_tier_${tier}`);
    let command: string | null = null;
    let declared = custom !== '';
    if (custom) {
      command = collectVariant(custom);
      if (!command) notes.push(`test_tier_${tier} is a custom command that cannot be collected without running: not checked`);
    } else if (runner === 'pytest') {
      declared = tier === 'smoke' || enabled;
      command = tier === 'smoke' ? 'pytest --collect-only -q -m smoke' : tier === 'critical' ? 'pytest --collect-only -q -m "smoke or critical"' : 'pytest --collect-only -q';
    } else if (runner === 'playwright') {
      const project = tier === 'smoke' ? e2eProject : tier === 'critical' ? 'critical' : 'regression';
      declared = tier === 'smoke' || projects.includes(project);
      if (declared) command = `npx playwright test --list --project=${project}`;
      else if (tier === 'critical') notes.push('no `critical` Playwright project: the critical tier falls back to smoke (a valid two-tier setup)');
    }
    if (tier !== 'smoke' && !declared) continue;
    if (!command) {
      probes.push({ tier, count: null, declared, custom: custom !== '' });
      continue;
    }
    const result = await run(command, repoRoot);
    probes.push({ tier, count: parseCollected(command, result), declared, custom: custom !== '' });
  }

  const count = (tier: Tier): number | null => probes.find((p) => p.tier === tier)?.count ?? null;

  // Files that count as the project's tests, for requirement tagging.
  const testFiles =
    runner === 'pytest'
      ? await walk(join(repoRoot, 'tests'), (f) => /^test_.*\.py$|_test\.py$/.test(f))
      : [
          ...(await walk(join(repoRoot, 'e2e'), (f) => /\.spec\.[jt]sx?$/.test(f))),
          ...(await walk(join(repoRoot, 'tests', 'e2e'), (f) => /\.spec\.[jt]sx?$/.test(f))),
        ];

  for (const p of probes) {
    if (p.count !== 0) continue;
    if (p.tier === 'smoke') {
      const detail = testFiles.length > 0 ? 'the smoke tier resolves to zero tests: there are tests but none in the smoke tier yet' : 'no tests yet: the smoke tier resolves to zero tests';
      findings.push({
        subject: 'smoke',
        detail,
        remediation: guidance('add-smoke-tests', 'Add smoke tests', ['use the e2e-test-engineer skill to scaffold a smoke test for the core path (a requirement and an approved plan come first)', 'then run `devaudit configure` to choose when the bigger groups run', p.custom ? 'or check the test_tier_smoke command' : runner === 'pytest' ? 'tag tests with @pytest.mark.smoke' : `tag specs into the \`${e2eProject}\` Playwright project`]),
      });
    } else {
      const detail = `the ${p.tier} tier resolves to zero tests`;
      findings.push({
        subject: p.tier,
        detail,
        remediation: guidance(`empty-${p.tier}-tier`, `Fill or drop the ${p.tier} tier`, [p.tier === 'critical' ? 'tag must-not-break tests as critical, or devaudit configure set release_gate_tier smoke for a two-tier setup' : 'check the full tier command or its Playwright project / pytest selection']),
      });
    }
  }

  if (count('critical') !== null && count('critical')! > 0 && count('critical') === count('smoke')) {
    notes.push('the critical tier selects exactly the smoke tests: a two-tier setup (devaudit configure set release_gate_tier smoke) says so explicitly');
  }

  const untagged: string[] = [];
  const allText: string[] = [];
  for (const file of testFiles) {
    const text = await fs.readFile(file, 'utf-8').catch(() => '');
    allText.push(text);
    if (!/REQ-\d+/.test(text)) untagged.push(relative(repoRoot, file));
  }
  if (untagged.length > 0) {
    const shown = untagged.slice(0, 5).join(', ');
    const detail = `${untagged.length} test file(s) carry no requirement tag (REQ-XXX), so the feature scope cannot select them: ${shown}${untagged.length > 5 ? ', ...' : ''}`;
    findings.push({
      subject: 'requirement-tags',
      detail,
      remediation: guidance('tag-tests-with-reqs', 'Tag tests with their requirement', ['put the requirement id in the test name, marker or docstring (see the e2e-test-engineer skill)']),
    });
  }

  const rtm = await fs.readFile(join(repoRoot, 'compliance', 'RTM.md'), 'utf-8').catch(() => '');
  const rtmReqs = [...new Set([...rtm.matchAll(/REQ-\d+/g)].map((m) => m[0]))];
  if (rtmReqs.length > 0 && testFiles.length > 0) {
    const haystack = allText.join('\n');
    const uncovered = rtmReqs.filter((id) => !new RegExp(`${id}(?!\\d)`).test(haystack));
    if (uncovered.length > 0) notes.push(`${uncovered.length} RTM requirement(s) have no test in any tier (heuristic): ${uncovered.slice(0, 5).join(', ')}${uncovered.length > 5 ? ', ...' : ''}`);
  }

  // devaudit-installer#1096 — per-AC coverage for the requirements still in flight: reported, never blocking.
  let acCoverage: ReqCoverage[] | undefined;
  if (runner === 'playwright') {
    const withAcs: Array<{ req: string; acs: number[] }> = [];
    for (const req of activeRtmReqs(rtm)) {
      const acs = await planAcs(repoRoot, req);
      if (acs.length > 0) withAcs.push({ req, acs });
    }
    if (withAcs.length > 0) {
      const listed = parsePlaywrightList((await (run === defaultRun ? defaultListRun : run)('npx playwright test --list --reporter=json', repoRoot)).stdout);
      if (listed === null) {
        notes.push('AC coverage not checked (`playwright test --list --reporter=json` gave no readable output)');
      } else {
        const preApproval = preApprovalProjects(cfg, projects);
        acCoverage = [];
        for (const { req, acs } of withAcs) {
          const cov = await acCoverageForReq(repoRoot, req, acs, listed, preApproval);
          acCoverage.push(cov);
          for (const r of cov.results) {
            if (r.status === 'covered') continue;
            if (r.status === 'covered-not-rerun') {
              notes.push(`${req} ${r.detail}`);
              continue;
            }
            findings.push({
              subject: `${req} AC${r.ac}`,
              detail: r.detail,
              remediation: guidance(`ac-coverage-${req}-ac${r.ac}`, `Cover ${req} AC${r.ac} with a test`, [
                `add or retitle a test as [${req}][AC${r.ac}] (it then runs at feature-PR time and counts as tested)`,
                'or raise the release gate: devaudit configure set release_gate_tier full',
                'or mark the AC not applicable on the portal with a reason (project admin; the existing flow in the sdlc-implementer skill, Phase 4)',
              ]),
            });
          }
        }
      }
    }
  } else if (runner === 'pytest') {
    notes.push('AC coverage not checked (runner: pytest)');
  }

  // A tier's recent duration against its budget; the full release gate reports this itself.
  if (enabled && str(cfg, 'release_gate_tier') !== 'full') {
    const runs = await recentRegressionRuns(repoRoot, gh);
    const limit = await regressionTimeLimit(repoRoot, cfg);
    if (runs !== null && runs.length >= 3) {
      const med = median(runs.map((r) => r.minutes));
      if (med > limit.minutes) findings.push(regressionTimeFinding('', runs.length, med, limit, 'regression'));
    }
  }

  const resolved = probes.map((p) => `${p.tier} ${p.count === null ? '?' : p.count}`).join(', ');
  const detail = [`runner ${runner ?? 'custom'}: ${resolved || 'no tiers collected'}`, ...findings.map((f) => f.detail), ...notes].join('; ');
  return {
    name,
    ok: findings.length === 0,
    detail,
    suspectedOrigin: 'consumer-drift',
    ...(findings.length > 0 ? { findings } : {}),
    ...(acCoverage ? { acCoverage } : {}),
  };
}
