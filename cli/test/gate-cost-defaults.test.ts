import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { load as yamlLoad } from 'js-yaml';
import { syncProject } from '../src/update/index.js';
import { writeSdlcConfig } from '../src/install/write-config.js';
import { pathsIgnoreCovers } from '../src/update/ci-templates.js';
import { DOC_PATH_SAMPLES, pullRequestGatesCheck } from '../src/commands/doctor-gates.js';
import { CHECK_EXPLANATIONS, gapsFromCheck } from '../src/lib/doctor-explain.js';
import { findConfigKey, validateConfigKeyValue } from '../src/lib/repo-config-keys.js';
import { NOT_ASKED } from '@metasession.co/devaudit-core';
import type { InstallContext, InstallPlan } from '../src/install/types.js';

// DevAudit-Installer#1297 — docs-only skipping on for new installs, the documentation defaults of paths_ignore, the
// report-only authenticated E2E controls, the large pull request warning and the doctor finding.

vi.setConfig({ testTimeout: 120_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

let prevRoot: string | undefined;
beforeAll(() => {
  prevRoot = process.env['DEVAUDIT_INSTALLER_ROOT'];
  process.env['DEVAUDIT_INSTALLER_ROOT'] = ROOT;
});
afterAll(() => {
  if (prevRoot === undefined) delete process.env['DEVAUDIT_INSTALLER_ROOT'];
  else process.env['DEVAUDIT_INSTALLER_ROOT'] = prevRoot;
});

type Doc = Record<string, any>;
const parse = (t: string): Doc => yamlLoad(t) as Doc;

const BASE = {
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
  paths_ignore: ['SDLC/**', 'compliance/**'],
};

async function renderCi(config: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-gatecost-'));
  try {
    await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ ...BASE, ...config }));
    await fs.writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture-app', private: true, version: '0.0.0', devDependencies: { husky: '*', '@commitlint/cli': '*', '@commitlint/config-conventional': '*', 'lint-staged': '*', prettier: '*', eslint: '*', typescript: '*', '@playwright/test': '*' } }),
    );
    for (const d of ['.husky', 'scripts', '.github/workflows']) await fs.mkdir(join(dir, d), { recursive: true });
    await syncProject(dir);
    return (await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf8')).replace(/\r\n/g, '\n');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const stepNames = (ci: string): string[] => ((parse(ci)['jobs']['quality-gates']['steps'] as Array<Record<string, any>>).map((s) => String(s['name'] ?? '')));

describe('a new install: the documentation paths ignored', () => {
  const plan = (): InstallPlan => ({
    stack: 'node',
    host: 'railway',
    projectSlug: 'fixture-app',
    runtimeVersion: '20',
    sourceDirs: 'app/',
    workingDirectory: '.',
    prodUrlSecretName: 'FIXTURE_PROD_URL',
    prodUrlValue: '',
    apiKeySecretName: 'DEVAUDIT_API_KEY',
  });
  const ctx = (dir: string, stack: 'node' | 'python' = 'node'): InstallContext => ({
    projectPath: dir, repoRoot: dir, projectName: 'fixture-app', installerRoot: ROOT, token: 't', baseUrl: 'https://devaudit.example.test',
    dryRun: false, nonInteractive: true, installMode: 'operator', addTarget: false, issueViewerKey: false, printViewerKey: false, delivery: false,
    ...(stack === 'python' ? {} : {}),
  });
  const written = async (dir: string) => JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8')) as Record<string, any>;

  it('writes the documentation defaults for both stacks, and no retired key (#1335)', async () => {
    for (const stack of ['node', 'python'] as const) {
      const dir = await fs.mkdtemp(join(tmpdir(), 'cli-newinstall-'));
      try {
        await writeSdlcConfig(ctx(dir), { ...plan(), stack });
        const cfg = await written(dir);
        expect(cfg['paths_ignore_pull_request'], stack).toBeUndefined();
        expect(cfg['reuse_pull_request_gates'], stack).toBeUndefined();
        for (const p of ['docs/**', '.devaudit/**', '.github/ISSUE_TEMPLATE/**', '**/*.md', '*.md', 'SDLC/**', 'compliance/**', 'sdlc-config.json']) expect(cfg['paths_ignore'], `${stack} ${p}`).toContain(p);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('never ignores a workflow file in the default list', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-newinstall-'));
    try {
      await writeSdlcConfig(ctx(dir), plan());
      const list = (await written(dir))['paths_ignore'] as string[];
      expect(pathsIgnoreCovers(list, '.github/workflows/ci.yml')).toBe(false);
      expect(pathsIgnoreCovers(list, 'src/app.ts')).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not rewrite an onboarded project\'s configuration when install runs again', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-reinstall-'));
    try {
      await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20', paths_ignore: ['SDLC/**'] }));
      await writeSdlcConfig(ctx(dir), plan());
      const cfg = await written(dir);
      expect(cfg['paths_ignore_pull_request']).toBeUndefined();
      expect(cfg['paths_ignore']).toEqual(['SDLC/**']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('ci.yml has no trigger path filter, with or without the retired key (#1335: the plan job decides)', async () => {
    for (const extra of [{}, { paths_ignore_pull_request: true }, { paths_ignore_pull_request: false }]) {
      const on = parse(await renderCi(extra))['on'];
      expect(on['pull_request'], JSON.stringify(extra)).toEqual({ branches: ['develop', 'main'] });
      expect(on['push'], JSON.stringify(extra)).toEqual({ branches: ['develop'] });
    }
  });
});

describe('the default list and the attribution classifier agree', () => {
  it('every location the classifier treats as documentation is covered by the default list', async () => {
    const script = await fs.readFile(join(ROOT, 'sdlc', 'files', '_common', 'scripts', 'classify-pr-attribution.sh'), 'utf8');
    const regex = /DOC_REGEX="\$\{DEVAUDIT_DOC_PATH_REGEX:-([^}]+)\}"/.exec(script)?.[1];
    expect(regex, 'the classifier default regex').toBeDefined();
    // The directories named by `^(a|b)/` and `^x/y/`, and `\.md$` for markdown at any depth.
    const dirs = [...(/\^\(([^)]+)\)\//.exec(regex!)?.[1] ?? '').split('|').map((d) => d.replace('\\.', '.')), ...[...regex!.matchAll(/\^((?:\\\.|[A-Za-z_])[\w\\./-]*?)\//g)].map((m) => m[1]!.replace(/\\\./g, '.'))];
    const named = [...new Set(dirs.filter((d) => d !== ''))];
    expect(named.length).toBeGreaterThanOrEqual(5);
    const samples = DOC_PATH_SAMPLES.map((s) => s.sample);
    for (const d of named) {
      const covered = samples.some((s) => s === d || s.startsWith(`${d}/`)) || (d === '.github' && samples.some((s) => s.startsWith('.github/ISSUE_TEMPLATE/')));
      expect(covered, `${d}/ is documentation for the classifier but has no sample in DOC_PATH_SAMPLES`).toBe(true);
    }
    expect(regex).toContain('\\.md$');
  });

  it('the default list covers every sample, with the same matcher the workflows use', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-defaultlist-'));
    try {
      const { writeSdlcConfig: write } = await import('../src/install/write-config.js');
      await write(
        { projectPath: dir, repoRoot: dir, projectName: 'x', installerRoot: ROOT, token: 't', baseUrl: 'https://p.test', dryRun: false, nonInteractive: true, installMode: 'operator', addTarget: false, issueViewerKey: false, printViewerKey: false, delivery: false },
        { stack: 'node', host: 'railway', projectSlug: 'x', runtimeVersion: '20', sourceDirs: 'app/', workingDirectory: '.', prodUrlSecretName: 'X', prodUrlValue: '', apiKeySecretName: 'K' },
      );
      const list = (JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8')) as { paths_ignore: string[] }).paths_ignore;
      for (const s of DOC_PATH_SAMPLES) expect(pathsIgnoreCovers(list, s.sample), s.sample).toBe(true);
      // and the shell classifier agrees that a pull request of only these files is docs-only
      const out = await execa('bash', [join(ROOT, 'sdlc', 'files', '_common', 'scripts', 'provenance-gated-commit.sh'), 'pr-docs-only'], {
        input: DOC_PATH_SAMPLES.map((s) => s.sample).join('\n'),
        env: { PATHS_IGNORE: list.map((p) => `- '${p}'`).join('\n') },
      });
      expect(out.stdout.trim()).toBe('docs-only');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the report-only authenticated E2E step (#1297)', () => {
  const withProjects = { e2e_projects: ['smoke', 'critical'], e2e_seed_command: 'npm run seed' };

  it('is unchanged by default: both steps, with e2e_projects', async () => {
    const ci = await renderCi(withProjects);
    expect(stepNames(ci)).toEqual(expect.arrayContaining(['Seed E2E test data (report-only)', 'Authenticated E2E (report-only)']));
    expect(ci).toContain('npx playwright test --project=smoke --project=critical --reporter=json,html');
  });

  it('report_only_e2e_enabled false removes both steps and keeps e2e_projects in the configuration', async () => {
    const ci = await renderCi({ ...withProjects, report_only_e2e_enabled: false });
    const names = stepNames(ci);
    expect(names).not.toContain('Authenticated E2E (report-only)');
    expect(names).not.toContain('Seed E2E test data (report-only)');
    expect(ci).not.toContain('e2e-auth-results.json" ');
    // the gating E2E step is untouched
    expect(names).toContain('E2E Tests');
  });

  it('report_only_e2e_projects runs a different list from e2e_projects', async () => {
    const ci = await renderCi({ ...withProjects, report_only_e2e_projects: ['smoke'] });
    expect(ci).toContain('npx playwright test --project=smoke --reporter=json,html');
    expect(ci).not.toContain('--project=smoke --project=critical --reporter=json,html');
  });

  it('an empty report_only_e2e_projects runs no project but keeps the seed step', async () => {
    const names = stepNames(await renderCi({ ...withProjects, report_only_e2e_projects: [] }));
    expect(names).not.toContain('Authenticated E2E (report-only)');
    expect(names).toContain('Seed E2E test data (report-only)');
  });

  it('with neither e2e_projects nor a seed command the step is absent, as before', async () => {
    expect(stepNames(await renderCi({}))).not.toContain('Authenticated E2E (report-only)');
  });

  it('the step is on the pull request run and the merge run alike: no event condition', async () => {
    const ci = await renderCi(withProjects);
    const step = (parse(ci)['jobs']['quality-gates']['steps'] as Array<Record<string, any>>).find((s) => s['name'] === 'Authenticated E2E (report-only)')!;
    expect(step['if']).toBe('always()');
  });

  it('the keys are validated, regenerate ci.yml, and are not asked in onboarding', () => {
    expect(findConfigKey('report_only_e2e_enabled')?.type).toBe('boolean');
    expect(findConfigKey('report_only_e2e_projects')?.type).toBe('string[]');
    expect(findConfigKey('report_only_e2e_enabled')?.affects).toContain('.github/workflows/ci.yml');
    expect(validateConfigKeyValue('report_only_e2e_enabled', 'false')).toEqual({ value: false });
    expect(validateConfigKeyValue('report_only_e2e_enabled', 'nope').error).toBeDefined();
    expect(validateConfigKeyValue('report_only_e2e_projects', 'smoke,critical')).toEqual({ value: ['smoke', 'critical'] });
    expect(NOT_ASKED['report_only_e2e_enabled']).toBeDefined();
    expect(NOT_ASKED['report_only_e2e_projects']).toBeDefined();
  });
});

describe('the plan and the release provenance classify with the same list (#1335)', () => {
  it('both get paths_ignore plus sdlc-config.json, once', async () => {
    const ci = parse(await renderCi({ paths_ignore: ['docs/**', 'compliance/**', 'sdlc-config.json'] }));
    const plan = (ci['jobs']['plan']['steps'] as Array<Record<string, any>>).find((st) => st['id'] === 'plan')!['env']['PATHS_IGNORE'] as string;
    const prov = (ci['jobs']['release-provenance']['steps'] as Array<Record<string, any>>).find((st) => st['name'] === 'Verify prior Quality Gates success on head SHA')!['env']['PATHS_IGNORE'] as string;
    expect(plan).toBe(prov);
    const items = plan.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(items).toEqual(["- 'docs/**'", "- 'compliance/**'", "- 'sdlc-config.json'"]);
  });

  it('a configuration without sdlc-config.json in paths_ignore still gets it', async () => {
    const ci = parse(await renderCi({ paths_ignore: ['docs/**'] }));
    const plan = (ci['jobs']['plan']['steps'] as Array<Record<string, any>>).find((st) => st['id'] === 'plan')!['env']['PATHS_IGNORE'] as string;
    expect(plan.split('\n').map((l) => l.trim()).filter(Boolean)).toEqual(["- 'docs/**'", "- 'sdlc-config.json'"]);
  });
});

describe('the pull-request-gates doctor check (#1297)', () => {
  it('is quiet when the documentation paths are ignored', () => {
    const r = pullRequestGatesCheck({ cfg: { paths_ignore: DOC_PATH_SAMPLES.map((s) => s.pattern) } });
    expect(r).toMatchObject({ name: 'pull-request-gates', ok: true });
    expect(r.findings).toBeUndefined();
    expect(gapsFromCheck(r)).toEqual([]);
  });

  it('has no finding about the retired paths_ignore_pull_request, set or not (#1335)', () => {
    for (const cfg of [{}, { paths_ignore_pull_request: false }, { paths_ignore_pull_request: true }]) {
      const r = pullRequestGatesCheck({ cfg: { ...cfg, paths_ignore: DOC_PATH_SAMPLES.map((x) => x.pattern) } });
      expect(r.findings, JSON.stringify(cfg)).toBeUndefined();
    }
    expect(CHECK_EXPLANATIONS['pull-request-gates:docs-only-skip-off']).toBeUndefined();
  });

  it('names the documentation paths an older paths_ignore leaves out, and the whole list to set', () => {
    const old = ['SDLC/**', 'compliance/**', '*.md', '.cursorrules'];
    const r = pullRequestGatesCheck({ cfg: { paths_ignore: old } });
    expect(r.findings?.map((f) => f.subject)).toEqual(['docs-not-ignored']);
    const f = r.findings![0]!;
    expect(f.detail).toContain('docs/guide.txt');
    expect(f.detail).toContain('src/notes/README.md');
    expect(f.detail).not.toContain('SDLC/1-plan-requirement.md');
    expect(f.remediation!.plan[0]).toContain('devaudit configure set paths_ignore SDLC/**,compliance/**,*.md,.cursorrules,docs/**,.devaudit/**,.github/ISSUE_TEMPLATE/**,**/*.md');
  });

  it('has nothing to say about paths_ignore when the project has none configured', () => {
    const r = pullRequestGatesCheck({ cfg: {} });
    expect(r.findings).toBeUndefined();
  });

  it('every finding has an explanation and a gap', () => {
    expect(CHECK_EXPLANATIONS['pull-request-gates']).toBeDefined();
    expect(CHECK_EXPLANATIONS['pull-request-gates:docs-not-ignored']).toBeDefined();
    const r = pullRequestGatesCheck({ cfg: { paths_ignore: ['*.md'] } });
    expect(gapsFromCheck(r)).toHaveLength(1);
  });
});
