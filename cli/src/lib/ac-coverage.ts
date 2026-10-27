import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/**
 * devaudit-installer#1096 — a static, local acceptance-criterion coverage check.
 *
 * The portal marks an AC "tested" only from Playwright JSON results whose test is tagged to
 * that AC; a screenshot alone leaves it "untested". Nothing told the operator, before approval,
 * which ACs had no such result. This reports it per AC, from local files only: no portal call,
 * no PAT, no viewer key. It reports; it never blocks a release.
 *
 * Titled tests come from `playwright test --list --reporter=json` (all projects). A test covers
 * AC n of REQ x when its full title (including describe titles) contains `REQ-x` and `ACn` as
 * exact tokens. `tagTest()` annotations are pushed at run time and are not in `--list` output,
 * so they are deliberately not relied on (devaudit-installer#1095 makes the title carry the id).
 */

export type AcStatus = 'covered' | 'screenshot-but-no-test' | 'no-test' | 'covered-not-rerun';

export interface ListedTest {
  readonly title: string;
  readonly projects: readonly string[];
}

export interface AcResult {
  readonly ac: number;
  readonly status: AcStatus;
  readonly detail: string;
}

export interface ReqCoverage {
  readonly req: string;
  readonly results: readonly AcResult[];
}

/** True when `id` occurs in `text` as a whole token (REQ-11 is not inside REQ-111, AC1 not inside AC10). */
export function hasToken(text: string, id: string): boolean {
  let from = 0;
  for (;;) {
    const p = text.indexOf(id, from);
    if (p < 0) return false;
    const before = p > 0 ? (text[p - 1] as string) : '';
    const after = text[p + id.length] ?? '';
    if (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9]/.test(after)) return true;
    from = p + 1;
  }
}

interface PwSpec {
  title?: string;
  tests?: Array<{ projectName?: string }>;
}
interface PwSuite {
  title?: string;
  suites?: PwSuite[];
  specs?: PwSpec[];
}

/** Titles and projects from `playwright test --list --reporter=json` output, or null when it cannot be read. */
export function parsePlaywrightList(stdout: string): ListedTest[] | null {
  const first = stdout.indexOf('{');
  const last = stdout.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  let json: { suites?: PwSuite[] };
  try {
    json = JSON.parse(stdout.slice(first, last + 1)) as { suites?: PwSuite[] };
  } catch {
    return null;
  }
  if (!Array.isArray(json.suites)) return null;
  const out: ListedTest[] = [];
  const visit = (suite: PwSuite, titles: readonly string[]): void => {
    for (const spec of suite.specs ?? []) {
      out.push({
        title: [...titles, spec.title ?? ''].join(' '),
        projects: [...new Set((spec.tests ?? []).map((t) => t.projectName ?? ''))],
      });
    }
    for (const child of suite.suites ?? []) visit(child, [...titles, child.title ?? '']);
  };
  // A top-level suite is the spec file: its title is the file name, which is not part of a test's title.
  for (const file of json.suites) visit(file, []);
  return out;
}

/** AC numbers of the `## 1. Goal + acceptance criteria` table; rows marked `@e2e-deferred` are skipped. */
export function acsFromPlan(plan: string): number[] {
  const start = plan.search(/^## 1\.[^\n]*$/m);
  if (start < 0) return [];
  const rest = plan.slice(start);
  const next = rest.slice(1).search(/^## /m);
  const section = next < 0 ? rest : rest.slice(0, next + 1);
  const acs: number[] = [];
  for (const m of section.matchAll(/^\|\s*AC(\d+)\s*\|(.*)$/gm)) {
    if ((m[2] as string).includes('@e2e-deferred')) continue;
    const n = Number(m[1]);
    if (!acs.includes(n)) acs.push(n);
  }
  return acs;
}

/**
 * The Playwright projects whose results exist before approval: the smoke project (the integration-
 * branch push) and the release-gate project, mapped from `release_gate_tier` exactly as
 * `buildE2eRegressionSelectCases` in `cli/src/update/ci-templates.ts` does.
 * Empty when the config declares no projects (then every test runs everywhere).
 */
export function preApprovalProjects(cfg: Record<string, unknown>, declared: readonly string[]): string[] {
  if (declared.length === 0) return [];
  const smoke = typeof cfg['e2e_project'] === 'string' && cfg['e2e_project'] !== '' ? (cfg['e2e_project'] as string) : 'chromium';
  const raw = cfg['release_gate_tier'];
  const gate = typeof raw === 'string' && ['none', 'smoke', 'critical', 'full'].includes(raw) ? raw : 'critical';
  const projects = [smoke];
  if (gate === 'full') projects.push('regression');
  else if (gate === 'critical') projects.push(declared.includes('critical') ? 'critical' : smoke);
  return [...new Set(projects)];
}

async function readFirst(paths: readonly string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      return await fs.readFile(p, 'utf-8');
    } catch {
      // try the next location
    }
  }
  return null;
}

async function screenshotAcs(repoRoot: string, req: string): Promise<Set<number>> {
  const dir = join(repoRoot, 'compliance', 'evidence', req, 'screenshots');
  const found = new Set<number>();
  try {
    for (const name of await fs.readdir(dir)) {
      const m = new RegExp(`^${req}-AC(\\d+)-.*\\.png$`).exec(name);
      if (m) found.add(Number(m[1]));
    }
  } catch {
    // no screenshots directory
  }
  return found;
}

/** The REQ's AC numbers from its implementation plan (plans/ first, then evidence/), or [] when there is none. */
export async function planAcs(repoRoot: string, req: string): Promise<number[]> {
  const plan = await readFirst([
    join(repoRoot, 'compliance', 'plans', req, 'implementation-plan.md'),
    join(repoRoot, 'compliance', 'evidence', req, 'implementation-plan.md'),
  ]);
  return plan === null ? [] : acsFromPlan(plan);
}

export async function acCoverageForReq(
  repoRoot: string,
  req: string,
  acs: readonly number[],
  tests: readonly ListedTest[],
  preApproval: readonly string[],
): Promise<ReqCoverage> {
  const shots = await screenshotAcs(repoRoot, req);
  const results: AcResult[] = acs.map((ac) => {
    const covering = tests.filter((t) => hasToken(t.title, req) && hasToken(t.title, `AC${ac}`));
    if (covering.length === 0) {
      return shots.has(ac)
        ? { ac, status: 'screenshot-but-no-test', detail: `AC${ac} has a screenshot but no test titled [${req}][AC${ac}]: the approver sees a screenshot next to "untested"` }
        : { ac, status: 'no-test', detail: `AC${ac} has no test titled [${req}][AC${ac}]` };
    }
    const reRun = preApproval.length === 0 || covering.some((t) => t.projects.length === 0 || t.projects.some((p) => preApproval.includes(p)));
    return reRun
      ? { ac, status: 'covered', detail: `AC${ac} covered by ${covering.length} test(s)` }
      : { ac, status: 'covered-not-rerun', detail: `AC${ac} is covered only in project(s) ${[...new Set(covering.flatMap((t) => t.projects))].join(', ')}, which do not run on the release PR (information)` };
  });
  return { req, results };
}

/** REQ ids in the RTM whose status is not RELEASED / APPROVED - DEPLOYED. */
export function activeRtmReqs(rtm: string): string[] {
  const out: string[] = [];
  let statusCol = -1;
  for (const line of rtm.split(/\r?\n/)) {
    if (!line.startsWith('|')) {
      statusCol = -1;
      continue;
    }
    const cells = line.split('|').slice(1, -1);
    const header = cells.findIndex((c) => /^\s*status\s*$/i.test(c));
    if (header >= 0) {
      statusCol = header;
      continue;
    }
    const id = /^\s*(REQ-\d+)\s*$/.exec(cells[0] ?? '')?.[1];
    if (!id) continue;
    const status = statusCol >= 0 ? (cells[statusCol] ?? '') : '';
    if (/RELEASED|APPROVED\s*-\s*DEPLOYED/i.test(status)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
