import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { syncProject } from '../src/update/index.js';
import { isManagedName, preflightValues, referencedValues, workflowReferences } from '../src/lib/config-values.js';

// DevAudit-Installer#1160 — the generated workflows name configuration values that reached the job empty,
// before the dev server starts. Only an entry that is exactly one `${{ secrets.X }}` / `${{ vars.X }}` counts.

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');

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
  ci: string;
  feature: string;
  regression: string;
  scripts: string[];
}

async function render(extra: Record<string, unknown>): Promise<Rendered> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-cfgvalues-'));
  try {
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({
        project_slug: 'fixture-app',
        stack: 'node',
        host: 'railway',
        node_version: '20',
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
        devDependencies: { husky: '*', '@commitlint/cli': '*', '@commitlint/config-conventional': '*', 'lint-staged': '*', prettier: '*', eslint: '*', typescript: '*', '@playwright/test': '*' },
      }),
    );
    for (const sub of ['.husky', 'scripts', '.github/workflows']) await fs.mkdir(join(dir, sub), { recursive: true });
    await syncProject(dir);
    const read = async (f: string): Promise<string> => (await fs.readFile(join(dir, '.github', 'workflows', f), 'utf8')).replace(/\r\n/g, '\n');
    return { ci: await read('ci.yml'), feature: await read('feature-e2e.yml'), regression: await read('e2e-regression.yml'), scripts: await fs.readdir(join(dir, 'scripts')) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

type Step = Record<string, unknown>;
/** Every job's steps, in order, with the job id. */
function stepsByJob(yaml: string): Array<{ job: string; steps: Step[] }> {
  const jobs = (yamlLoad(yaml) as { jobs: Record<string, { steps?: Step[] }> }).jobs;
  return Object.entries(jobs).map(([job, def]) => ({ job, steps: def.steps ?? [] }));
}
/** The step named `Check configuration values` and the step after it, per job that has one. */
function preflights(yaml: string): Array<{ step: Step; next: Step | undefined }> {
  return stepsByJob(yaml).flatMap(({ steps }) => steps.flatMap((s, i) => (s['name'] === 'Check configuration values' ? [{ step: s, next: steps[i + 1] }] : [])));
}

const refs = {
  e2e_env: { SUPABASE_SECRET_KEY: '${{ secrets.SUPABASE_SECRET_KEY }}', E2E_BACKEND: 'uat' },
  app_env: { SESSION_PASSWORD: '${{ secrets.SESSION_PASSWORD }}', FEATURE_FLAG: '${{ vars.FEATURE_FLAG }}' },
};

describe('the pre-flight helper', () => {
  it('counts only an entry that is exactly one reference', () => {
    const cfg = {
      e2e_env: {
        A: '${{ secrets.A }}',
        B: '${{vars.B}}',
        C: "${{ secrets.C || '' }}",
        D: 'literal',
        E: 'prefix-${{ secrets.E }}',
        'BAD-NAME': '${{ secrets.F }}',
      },
    };
    expect(referencedValues(cfg).map((r) => `${r.map}.${r.env}=${r.kind}.${r.source}`)).toEqual(['e2e_env.A=secrets.A', 'e2e_env.B=vars.B']);
  });

  it('lets a later map win on a shared key', () => {
    const cfg = { app_env: { K: '${{ secrets.FROM_APP }}', ONLY_APP: '${{ secrets.ONLY_APP }}' }, e2e_env: { K: 'literal' } };
    expect(preflightValues(cfg, ['app_env', 'e2e_env']).map((r) => r.env)).toEqual(['ONLY_APP']);
  });
});

describe('the workflow scan helper', () => {
  it('finds bare secret and variable reads and skips optional ones', () => {
    const yaml = [
      'env:',
      '  A: ${{ secrets.STRIPE_KEY }}',
      '  B: ${{ vars.REGION }}',
      '  C: ${{ secrets.OPTIONAL || github.token }}',
      "  D: ${{ secrets.COMPARED != '' }}",
      '  E: ${{ secrets.GITHUB_TOKEN }}',
      '  F: ${{ secrets.STRIPE_KEY }}',
      '  G: ${{ github.event.inputs.secrets.nope }}',
      'with: ${{ secrets.inherit }}',
    ].join('\n');
    expect(workflowReferences(yaml).map((r) => `${r.kind}.${r.source}`)).toEqual(['secrets.STRIPE_KEY', 'vars.REGION']);
  });

  it('stops at an unclosed expression', () => {
    expect(workflowReferences('a ${{ secrets.X }} b ${{ secrets.Y')).toEqual([{ kind: 'secrets', source: 'X' }]);
  });

  it('treats the names DevAudit manages as handled elsewhere', () => {
    const cfg = { api_key_secret: 'MY_PORTAL_KEY', production_url_secret: 'MY_PROD_URL' };
    for (const name of ['DEVAUDIT_API_KEY', 'DEVAUDIT_PROBE_HEADER', 'INSTALLER_DISPATCH_TOKEN', 'MY_PORTAL_KEY', 'MY_PROD_URL']) expect(isManagedName(cfg, name), name).toBe(true);
    expect(isManagedName(cfg, 'STRIPE_KEY')).toBe(false);
  });
});

describe('the generated workflows', () => {
  it('check the referenced values right before the dev server starts, in ci.yml, feature-e2e.yml and e2e-regression.yml', async () => {
    const r = await render(refs);
    for (const [name, yaml] of [['ci.yml', r.ci], ['feature-e2e.yml', r.feature], ['e2e-regression.yml', r.regression]] as const) {
      const found = preflights(yaml);
      expect(found.length, name).toBeGreaterThan(0);
      for (const { step, next } of found) {
        expect(next?.['name'], name).toBe('Start dev server');
        const run = step['run'] as string;
        expect(run, name).toContain('scripts/check-config-values.sh');
        expect(run, name).toContain("'e2e_env.SUPABASE_SECRET_KEY=secrets.SUPABASE_SECRET_KEY'");
        expect(run, name).toContain("'app_env.SESSION_PASSWORD=secrets.SESSION_PASSWORD'");
        expect(run, name).toContain("'app_env.FEATURE_FLAG=vars.FEATURE_FLAG'");
        expect(run, name).not.toContain('E2E_BACKEND');
      }
    }
  }, 120_000);

  it('give the step the e2e_env references in ci.yml and feature-e2e.yml, and none in the regression (its env is job-wide)', async () => {
    const r = await render(refs);
    for (const yaml of [r.ci, r.feature]) {
      for (const { step } of preflights(yaml)) expect(step['env']).toEqual({ SUPABASE_SECRET_KEY: '${{ secrets.SUPABASE_SECRET_KEY }}' });
    }
    for (const { step } of preflights(r.regression)) expect(step['env']).toBeUndefined();
  }, 120_000);

  it('ship the script', async () => {
    expect((await render(refs)).scripts).toContain('check-config-values.sh');
  }, 120_000);

  it('add no step when nothing is a bare reference, and stay identical to a config without the maps', async () => {
    const none = await render({});
    const literal = await render({ e2e_env: { E2E_BACKEND: 'uat' }, app_env: { PORT: '3000' } });
    const optional = await render({ e2e_env: { OPTIONAL_KEY: "${{ secrets.OPTIONAL_KEY || '' }}" } });
    for (const r of [none, literal, optional]) {
      expect(preflights(r.ci)).toEqual([]);
      expect(preflights(r.feature)).toEqual([]);
      expect(preflights(r.regression)).toEqual([]);
      expect(r.ci).not.toContain('check-config-values');
    }
  }, 120_000);
});
