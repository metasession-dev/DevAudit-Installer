import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { playwrightProjectNames as namesFromConfig, seedFilesHash, type Remediation } from '@metasession.co/devaudit-core';
import { defaultGh, type GhRunner } from '../lib/deploy-detect.js';
import type { CheckResult, Finding } from '../lib/doctor-types.js';

/**
 * DevAudit-Installer#1116 WP15 — the `test-data` doctor check: is where each enabled test tier gets its
 * data declared, and does the declaration hold together? It reads configuration and files only (and, for
 * live drift, the last regression run's artifact through `gh`); it never contacts a backend. Findings
 * name the skill to use: data findings `e2e-test-data`, test-phase and scope findings
 * `e2e-test-engineer`. Tier A applies only a configuration key, through the existing `set-config` fix.
 * Every gap offers "leave this as is" (whoever shows it adds that).
 */

/** The ids of every finding this check can report; each has a `--explain` entry (`test-data:<id>`). */
export const TEST_DATA_FINDINGS = [
  'isolation-unset',
  'shared-writes',
  'shared-unattended',
  'seed-path-missing',
  'seed-paths-empty',
  'serialised-no-group',
  'fixture-not-seeded',
  'feature-destructive',
  'seed-changed-since-last-run',
] as const;
export type TestDataFinding = (typeof TEST_DATA_FINDINGS)[number];

export interface TestDataDeps {
  readonly gh?: GhRunner;
  /** Test seam: the hash of the current seed files (default: `git ls-files` + the core definition). */
  readonly currentSeedHash?: (repoRoot: string, paths: readonly string[]) => Promise<string>;
  /** Test seam: the Playwright project names found (default: read from the Playwright config). */
  readonly playwrightProjects?: readonly string[];
  /** Test seam: spec files and seed files as text, for the fixture heuristic. */
  readonly readFixtureRefs?: (repoRoot: string, seedPaths: readonly string[]) => Promise<{ referenced: string[]; seedText: string }>;
}

const skillLine = (skill: 'e2e-test-data' | 'e2e-test-engineer'): string => `use the ${skill} skill`;

const setConfig = (key: string, value: string, summary: string): Remediation => ({
  id: 'set-config',
  tier: 'A',
  summary,
  plan: [`devaudit configure set ${key} ${value === '' ? '""' : value}`, 'devaudit update'],
  needsPortal: false,
  data: { key, value },
});

const guidance = (id: string, summary: string, plan: string[]): Remediation => ({ id, tier: 'C', summary, plan, needsPortal: false });

const asStringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v.trim() !== '' ? v.split(',').map((s) => s.trim()).filter((s) => s !== '') : []);

/** The hash of the git-tracked files under the seed paths, by the one definition in the core. */
export async function currentSeedFilesHash(repoRoot: string, paths: readonly string[]): Promise<string> {
  if (paths.length === 0) return '';
  const r = await execa('git', ['ls-files', '-z', '--', ...paths], { cwd: repoRoot, reject: false });
  if (r.exitCode !== 0) return '';
  const names = r.stdout.split('\0').filter((n) => n !== '');
  const files = await Promise.all(names.map(async (path) => ({ path, content: await fs.readFile(join(repoRoot, path)) })));
  return seedFilesHash(files);
}

/** `data.seedFilesHash` of the latest successful regression run's `e2e-regression-report` artifact; null when it cannot be read. */
async function lastRunSeedHash(repoRoot: string, gh: GhRunner): Promise<string | null> {
  const list = await gh(['run', 'list', '--workflow', 'e2e-regression.yml', '--status', 'success', '--limit', '1', '--json', 'databaseId'], repoRoot);
  if (list.exitCode !== 0) return null;
  let id: number | undefined;
  try {
    id = (JSON.parse(list.stdout) as Array<{ databaseId: number }>)[0]?.databaseId;
  } catch {
    return null;
  }
  if (id === undefined) return null;
  const dir = await fs.mkdtemp(join(tmpdir(), 'devaudit-seed-drift-'));
  try {
    const dl = await gh(['run', 'download', String(id), '-n', 'e2e-regression-report', '-D', dir], repoRoot);
    if (dl.exitCode !== 0) return null;
    const meta = JSON.parse(await fs.readFile(join(dir, 'e2e-regression-metadata.json'), 'utf-8')) as { data?: { seedFilesHash?: unknown } };
    const h = meta.data?.seedFilesHash;
    return typeof h === 'string' && h !== '' ? h : null;
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const SPEC_DIRS = ['e2e', 'tests', 'test'];
const FIXTURE_REF = /\b(?:seed|seeded|fixtures?)\.([A-Za-z_][A-Za-z0-9_]*)|\bseeded\(\s*['"]([^'"]+)['"]\s*\)/g;

async function walk(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > 6 || out.length > 400) return;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, depth + 1);
    else out.push(p);
  }
}

async function defaultFixtureRefs(repoRoot: string, seedPaths: readonly string[]): Promise<{ referenced: string[]; seedText: string }> {
  const specFiles: string[] = [];
  for (const d of SPEC_DIRS) await walk(join(repoRoot, d), specFiles);
  const referenced = new Set<string>();
  for (const f of specFiles.filter((p) => /\.(spec|test)\.[cm]?[jt]sx?$|_test\.py$|test_.*\.py$/.test(p))) {
    const text = await fs.readFile(f, 'utf-8').catch(() => '');
    for (const m of text.matchAll(FIXTURE_REF)) referenced.add((m[1] ?? m[2])!);
  }
  const seedFiles: string[] = [];
  for (const p of seedPaths) {
    const abs = join(repoRoot, p);
    const st = await fs.stat(abs).catch(() => null);
    if (st?.isDirectory()) await walk(abs, seedFiles);
    else if (st) seedFiles.push(abs);
  }
  const seedText = (await Promise.all(seedFiles.map((f) => fs.readFile(f, 'utf-8').catch(() => '')))).join('\n');
  return { referenced: [...referenced], seedText };
}

async function playwrightProjectNames(repoRoot: string): Promise<string[]> {
  for (const f of ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs']) {
    const text = await fs.readFile(join(repoRoot, f), 'utf-8').catch(() => null);
    if (text !== null) return namesFromConfig(text);
  }
  return [];
}

export async function testDataCheck(
  consumer: { readonly repoRoot: string; readonly cfg: Record<string, unknown> },
  others: readonly CheckResult[],
  deps: TestDataDeps = {},
): Promise<CheckResult> {
  const name = 'test-data';
  const cfg = consumer.cfg;
  const regression = cfg['e2e_regression_enabled'] === true;
  const isolation = typeof cfg['e2e_data_isolation'] === 'string' && cfg['e2e_data_isolation'] !== '' ? (cfg['e2e_data_isolation'] as string) : undefined;
  if (!regression && isolation === undefined) {
    return { name, ok: true, detail: 'no test tier that writes data is enabled (nothing to check)', suspectedOrigin: 'consumer-drift' };
  }
  const findings: Finding[] = [];
  const add = (f: Finding & { subject: TestDataFinding }): void => void findings.push(f);
  const seedPaths = asStringList(cfg['e2e_seed_paths']);
  const seedCommand = typeof cfg['e2e_seed_command'] === 'string' ? (cfg['e2e_seed_command'] as string).trim() : '';
  const group = typeof cfg['e2e_concurrency_group'] === 'string' ? (cfg['e2e_concurrency_group'] as string).trim() : '';
  const slug = typeof cfg['project_slug'] === 'string' ? (cfg['project_slug'] as string) : 'project';
  const scopeCause = others.filter((c) => (c.name === 'test-tiers' || c.name === 'preset-drift') && !c.ok);

  // A tier that writes data is enabled and nobody said where the data lives.
  if (regression && isolation === undefined) {
    add({
      subject: 'isolation-unset',
      detail: `The regression is enabled but \`e2e_data_isolation\` is not set, so nothing says where its tests get their data.${scopeCause.length > 0 ? ` The test scope also has findings (${scopeCause.map((c) => c.name).join(', ')}): ${skillLine('e2e-test-engineer')} for those.` : ''}`,
      remediation: guidance('declare-data-isolation', 'Say where the tests get their data', [`run \`devaudit configure\` (it asks, Q18), or \`devaudit configure set e2e_data_isolation <none|ephemeral|shared_serialised|shared|unknown>\``, `to create the seed and reset scripts, ${skillLine('e2e-test-data')}`]),
    });
  }

  // Shared data written by a data-writing tier.
  if (isolation === 'shared' && regression) {
    add({
      subject: 'shared-writes',
      detail: 'The regression writes data in an environment other people also use (`e2e_data_isolation: shared`): a run can collide with people, and a killed run can leave data behind.',
      remediation: setConfig('e2e_data_isolation', 'shared_serialised', 'Record the environment as shared but used only by the tests, one run at a time'),
      alternatives: [guidance('use-ephemeral-data', 'Give the regression a fresh database for each run', [`${skillLine('e2e-test-data')} to design the seed and reset, then \`devaudit configure set e2e_data_isolation ephemeral\``])],
    });
  }

  // Shared data and a regression nobody is watching.
  const cron = typeof cfg['scheduled_full_regression'] === 'string' ? (cfg['scheduled_full_regression'] as string).trim() : '';
  const postDeploy = cfg['post_deploy_full_regression'] !== false;
  const unattended = regression && (cron !== '' || postDeploy);
  if (unattended && (isolation === 'shared' || (isolation === 'shared_serialised' && group === ''))) {
    const triggers = [cron !== '' ? `a schedule (${cron})` : '', postDeploy ? 'every production deploy' : ''].filter((t) => t !== '').join(' and ');
    add({
      subject: 'shared-unattended',
      detail: `The full regression runs without anyone watching, on ${triggers}, against data that is ${isolation === 'shared' ? 'shared with other people' : 'shared and has no concurrency group'}. A person using that environment at that time collides with the run, and a killed run leaves data dirty until someone resets it.`,
      remediation: setConfig('e2e_data_isolation', 'ephemeral', 'Change the isolation to a fresh database for each run'),
      alternatives: [
        ...(cron !== '' ? [setConfig('scheduled_full_regression', '', 'Turn the scheduled run off')] : []),
        ...(postDeploy ? [setConfig('post_deploy_full_regression', 'false', 'Turn the run after each deploy off')] : []),
      ],
    });
  }

  // The declared seed does not hold together.
  const missing: string[] = [];
  for (const p of seedPaths) {
    const ok = await fs.stat(join(consumer.repoRoot, p)).then(() => true, () => false);
    if (!ok) missing.push(p);
  }
  for (const key of ['e2e_seed_command', 'e2e_reset_command', 'e2e_preflight_command', 'e2e_leak_check_command']) {
    const c = typeof cfg[key] === 'string' ? (cfg[key] as string).trim() : '';
    const first = c.split(/\s+/)[0] ?? '';
    if (/^\.{0,2}\/?[\w.-]+\/[\w./-]+\.\w+$/.test(first) && !(await fs.stat(join(consumer.repoRoot, first)).then(() => true, () => false))) missing.push(`${first} (${key})`);
  }
  if (missing.length > 0) {
    add({
      subject: 'seed-path-missing',
      detail: `These declared seed paths or scripts do not exist: ${missing.join(', ')}.`,
      remediation: guidance('fix-seed-paths', 'Create the missing seed files or correct the paths', [`${skillLine('e2e-test-data')} to author the seed and reset scripts`, 'then `devaudit configure set e2e_seed_paths <paths>`']),
    });
  }
  if (seedCommand !== '' && seedPaths.length === 0) {
    add({
      subject: 'seed-paths-empty',
      detail: '`e2e_seed_command` is set but `e2e_seed_paths` is empty, so DevAudit cannot tell when the seed changes.',
      remediation: guidance('declare-seed-paths', 'List the files or folders that hold the seed', ['`devaudit configure set e2e_seed_paths <paths>`', `${skillLine('e2e-test-data')} if the seed does not exist yet`]),
    });
  }
  if (isolation === 'shared_serialised' && group === '') {
    add({
      subject: 'serialised-no-group',
      detail: '`e2e_data_isolation` is `shared_serialised` but `e2e_concurrency_group` is empty, so two regression runs can overlap.',
      remediation: setConfig('e2e_concurrency_group', `${slug}-e2e-data`, 'Set a fixed concurrency group so runs queue behind each other'),
    });
  }

  // Specs that refer to seed data that is not in the seed (a heuristic).
  if (seedPaths.length > 0) {
    const refs = await (deps.readFixtureRefs ?? defaultFixtureRefs)(consumer.repoRoot, seedPaths);
    const absent = refs.referenced.filter((r) => !refs.seedText.includes(r));
    if (absent.length > 0) {
      add({
        subject: 'fixture-not-seeded',
        detail: `Advisory (a text heuristic, it can be wrong): specs refer to ${absent.slice(0, 8).join(', ')}${absent.length > 8 ? ' and more' : ''}, which do not appear in the seed files.`,
        remediation: guidance('check-fixture-names', 'Check the seed against the specs', [`${skillLine('e2e-test-data')} (its drift check compares the seed with the specs)`]),
      });
    }
  }

  // The feature run includes a destructive project against shared data.
  if (isolation === 'shared' || isolation === 'shared_serialised') {
    const projects = deps.playwrightProjects ?? (await playwrightProjectNames(consumer.repoRoot));
    const limited = asStringList(cfg['feature_e2e_projects']);
    const includesRegression = limited.length === 0 ? projects.includes('regression') : limited.includes('regression');
    if (includesRegression) {
      const safe = (limited.length === 0 ? projects : limited).filter((p) => p !== 'regression');
      add({
        subject: 'feature-destructive',
        detail: 'Every feature pull request runs the `regression` Playwright project against a shared backend, which can change or delete data other people use.',
        remediation: safe.length > 0 ? setConfig('feature_e2e_projects', safe.join(','), `Limit the feature run to ${safe.join(', ')}`) : guidance('limit-feature-projects', 'Limit the feature run to projects that do not delete data', ['`devaudit configure set feature_e2e_projects smoke,critical`']),
      });
    }
  }

  // Live drift: the seed changed since the last regression ran.
  let drift = 'seed drift: not measured yet';
  if (regression && seedPaths.length > 0) {
    const last = await lastRunSeedHash(consumer.repoRoot, deps.gh ?? defaultGh);
    if (last !== null) {
      const now = await (deps.currentSeedHash ?? currentSeedFilesHash)(consumer.repoRoot, seedPaths);
      if (now !== '' && now !== last) {
        drift = 'the seed changed since the last regression ran';
        add({
          subject: 'seed-changed-since-last-run',
          detail: 'Advisory: the seed changed since the last regression ran, so the last run does not tell you how the new seed behaves.',
          remediation: guidance('rerun-regression', 'Run the regression against the new seed', [`${skillLine('e2e-test-data')} to review the change, then run the e2e-regression workflow (workflow_dispatch)`]),
        });
      } else if (now !== '') drift = 'seed unchanged since the last regression';
    }
  }

  if (findings.length === 0) {
    return { name, ok: true, detail: `data declaration is consistent (${isolation ?? 'isolation not needed'}); ${drift}`, suspectedOrigin: 'consumer-drift' };
  }
  return { name, ok: false, detail: `${findings.length} test-data finding(s): ${findings.map((f) => f.subject).join(', ')}; ${drift}`, suspectedOrigin: 'consumer-drift', findings };
}
