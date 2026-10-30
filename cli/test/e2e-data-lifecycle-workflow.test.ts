import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { load as yamlLoad } from 'js-yaml';
import { syncProject } from '../src/update/index.js';

// DevAudit-Installer#1116 WP15 — the regression workflows call scripts/e2e-data-lifecycle.sh only when
// e2e_data_isolation is set and not `none`; otherwise they are byte-identical, whatever else is set.

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const SCRIPT_DIR = join(INSTALLER_ROOT, 'sdlc', 'files', '_common', 'scripts');

let prevRoot: string | undefined;
beforeAll(() => {
  prevRoot = process.env['DEVAUDIT_INSTALLER_ROOT'];
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
});
afterAll(() => {
  if (prevRoot === undefined) delete process.env['DEVAUDIT_INSTALLER_ROOT'];
  else process.env['DEVAUDIT_INSTALLER_ROOT'] = prevRoot;
});

interface Rendered {
  regression: string;
  feature: string;
  scripts: string[];
}

async function render(extra: Record<string, unknown>, pytest = false): Promise<Rendered> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-e2edata-'));
  try {
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({
        project_slug: 'fixture-app',
        stack: pytest ? 'python' : 'node',
        host: 'railway',
        ...(pytest ? { python_version: '3.12', test_runner: 'pytest' } : { node_version: '20' }),
        runner: 'ubuntu-latest',
        working_directory: '.',
        source_dirs: 'app/ lib/',
        sast_baseline: 0,
        accepted_dep_risks: '',
        production_url_secret: 'FIXTURE_PROD_URL',
        database_service: '',
        database_image: '',
        database_port: '',
        e2e_project: 'chromium',
        e2e_start_command: 'npm run dev',
        e2e_setup_command: 'echo setup',
        e2e_regression_enabled: true,
        paths_ignore: ['SDLC/**', 'compliance/**'],
        ...extra,
      }),
    );
    await fs.writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture-app',
        private: true,
        version: '0.0.0',
        devDependencies: {
          husky: '*',
          '@commitlint/cli': '*',
          '@commitlint/config-conventional': '*',
          'lint-staged': '*',
          prettier: '*',
          eslint: '*',
          typescript: '*',
          '@playwright/test': '*',
        },
      }),
    );
    for (const sub of ['.husky', 'scripts', '.github/workflows']) await fs.mkdir(join(dir, sub), { recursive: true });
    await syncProject(dir);
    const read = async (f: string): Promise<string> => (await fs.readFile(join(dir, '.github', 'workflows', f), 'utf8')).replace(/\r\n/g, '\n');
    return { regression: await read('e2e-regression.yml'), feature: await read('feature-e2e.yml'), scripts: await fs.readdir(join(dir, 'scripts')) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const stepNames = (yaml: string, job: string): string[] =>
  ((yamlLoad(yaml) as { jobs: Record<string, { steps: Array<{ name?: string }> }> }).jobs[job]?.steps ?? []).map((s) => s.name ?? '');
const stepOf = (yaml: string, job: string, name: string): Record<string, unknown> =>
  ((yamlLoad(yaml) as { jobs: Record<string, { steps: Array<Record<string, unknown>> }> }).jobs[job]!.steps).find((s) => s['name'] === name)!;

const LIFECYCLE = 'sdlc-config';
void LIFECYCLE;

describe('the Playwright regression workflow', () => {
  it('is byte-identical with e2e_data_isolation unset or none, even when the lifecycle commands are set', async () => {
    const base = await render({});
    const commands = { e2e_seed_command: 'npm run seed', e2e_reset_command: 'npm run reset', e2e_preflight_command: 'npm run check-seed', e2e_leak_check_command: 'npm run leaks', e2e_max_skipped: 3 };
    expect((await render(commands)).regression).toBe(base.regression);
    expect((await render({ ...commands, e2e_data_isolation: 'none' })).regression).toBe(base.regression);
    expect((await render({ ...commands, e2e_data_isolation: 'unknown' })).regression).toBe(base.regression);
    expect(base.regression).not.toContain('e2e-data-lifecycle');
  }, 120_000);

  it('with isolation set, runs the lifecycle after the setup step and before the dev server, and tears down afterwards', async () => {
    const r = await render({ e2e_data_isolation: 'shared_serialised', e2e_seed_command: 'npm run seed', e2e_env: { E2E_LOCAL: '1' } });
    const names = stepNames(r.regression, 'e2e-regression');
    const setup = names.indexOf('E2E setup');
    const before = names.indexOf('E2E data lifecycle (reset, seed, preflight)');
    const server = names.indexOf('Kill stale dev server');
    const tests = names.indexOf('E2E Regression Tests');
    const after = names.indexOf('E2E data lifecycle (teardown, leak check, skip budget)');
    const stop = names.indexOf('Stop dev server');
    expect(setup).toBeGreaterThan(-1);
    expect(before).toBe(setup + 1);
    expect(before).toBeLessThan(server);
    expect(tests).toBeLessThan(after);
    expect(after).toBeLessThan(stop);
    const beforeStep = stepOf(r.regression, 'e2e-regression', 'E2E data lifecycle (reset, seed, preflight)');
    expect(beforeStep['run']).toBe('bash scripts/e2e-data-lifecycle.sh before');
    expect(beforeStep['env']).toMatchObject({ E2E_LOCAL: 1 });
    const afterStep = stepOf(r.regression, 'e2e-regression', 'E2E data lifecycle (teardown, leak check, skip budget)');
    expect(afterStep['if']).toBe('always()');
    expect(afterStep['run']).toBe('bash scripts/e2e-data-lifecycle.sh after --results e2e-regression-results.json --metadata e2e-regression-metadata.json');
  });

  it('syncs the lifecycle script into the project', async () => {
    const r = await render({ e2e_data_isolation: 'ephemeral' });
    expect(r.scripts).toContain('e2e-data-lifecycle.sh');
  });
});

describe('the pytest regression workflow', () => {
  it('is unchanged without isolation, and calls the script with the JUnit file when set', async () => {
    const base = await render({}, true);
    expect((await render({ e2e_seed_command: 'make seed', e2e_data_isolation: 'none' }, true)).regression).toBe(base.regression);
    const r = await render({ e2e_data_isolation: 'ephemeral' }, true);
    const names = stepNames(r.regression, 'e2e-regression');
    expect(names.indexOf('E2E data lifecycle (reset, seed, preflight)')).toBe(names.indexOf('E2E setup') + 1);
    const after = stepOf(r.regression, 'e2e-regression', 'E2E data lifecycle (teardown, leak check, skip budget)');
    expect(after['run']).toContain('--results e2e-regression-results.xml');
    expect(names.indexOf('E2E Regression Tests')).toBeLessThan(names.indexOf('E2E data lifecycle (teardown, leak check, skip budget)'));
  });
});

describe('feature_e2e_projects', () => {
  it('limits the feature run to the listed projects; empty keeps every project', async () => {
    const base = await render({});
    expect(base.feature).toContain('npx playwright test --grep "$REQ_ID" --reporter=json,html');
    expect((await render({ feature_e2e_projects: [] })).feature).toBe(base.feature);
    const limited = await render({ feature_e2e_projects: ['smoke', 'critical'] });
    expect(limited.feature).toContain('npx playwright test --grep "$REQ_ID" --project=smoke --project=critical --reporter=json,html');
  }, 120_000);

  it('ignores a project name that is not a plain name', async () => {
    const r = await render({ feature_e2e_projects: ['smoke', 'a; rm -rf /'] });
    expect(r.feature).toContain('--project=smoke --reporter');
    expect(r.feature).not.toContain('a; rm');
  });
});

describe.skipIf(process.platform === 'win32')('scripts/e2e-data-lifecycle.test.sh', () => {
  it('passes', async () => {
    const r = await execa('bash', [join(SCRIPT_DIR, 'e2e-data-lifecycle.test.sh')], { reject: false });
    expect(r.exitCode, r.stdout.slice(-2000)).toBe(0);
  }, 120_000);
});
