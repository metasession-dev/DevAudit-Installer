import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { syncProject } from '../src/update/index.js';
import { runnerMeansGithub } from '../src/install/guided.js';
import { configuredProjectSlug } from '../src/install/scan-hints.js';

// DevAudit-Installer#1164 — the `runner` value the guided install writes and reads, and how it renders.
// Any `runner` other than `self-hosted` becomes a literal `runs-on:` label, so it must be one GitHub provides.

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

/** The first `runs-on:` of the generated ci.yml for a configuration with this `runner`. */
async function runsOn(runner: string | undefined): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-runner-'));
  try {
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({
        project_slug: 'fixture-app',
        stack: 'node',
        host: 'railway',
        node_version: '20',
        ...(runner !== undefined ? { runner } : {}),
        working_directory: '.',
        source_dirs: 'app/',
        sast_baseline: 0,
        accepted_dep_risks: '',
        production_url_secret: 'FIXTURE_PROD_URL',
        database_service: '',
        database_image: '',
        database_port: '',
        e2e_project: 'chromium',
        e2e_start_command: 'npm run dev',
        paths_ignore: ['SDLC/**'],
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
    const yaml = (await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf8')).replace(/\r\n/g, '\n');
    return yaml.split('\n').find((l) => l.includes('runs-on:'))!.trim();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('the generated runs-on', () => {
  it('uses a GitHub-hosted label as written', async () => {
    expect(await runsOn('ubuntu-latest')).toBe('runs-on: ubuntu-latest');
  }, 120_000);

  it('turns the logical name github-ci into ubuntu-latest instead of a label no runner has', async () => {
    expect(await runsOn('github-ci')).toBe('runs-on: ubuntu-latest');
  }, 120_000);

  it('resolves self-hosted (and no runner) at run time through CI_RUNNER_LABEL', async () => {
    for (const runner of ['self-hosted', undefined]) expect(await runsOn(runner), String(runner)).toContain('vars.CI_RUNNER_LABEL');
  }, 120_000);
});

describe('reading an existing runner', () => {
  it('means GitHub for a GitHub-hosted label and the logical name; our own machines otherwise', () => {
    for (const r of ['ubuntu-latest', 'ubuntu-22.04', 'windows-latest', 'macos-14', 'github-ci']) expect(runnerMeansGithub(r), r).toBe(true);
    for (const r of ['self-hosted', 'ostendo-workhorse-ci', '', undefined, 3]) expect(runnerMeansGithub(r), String(r)).toBe(false);
  });
});

describe('the project a bare scan report id belongs to', () => {
  it('is devaudit.project_slug, else the top-level project_slug the web onboarding writes', () => {
    expect(configuredProjectSlug({ project_slug: 'top', devaudit: { project_slug: 'nested' } })).toBe('nested');
    expect(configuredProjectSlug({ project_slug: 'top' })).toBe('top');
    expect(configuredProjectSlug({ devaudit: {} })).toBeUndefined();
    expect(configuredProjectSlug({ project_slug: '' })).toBeUndefined();
    expect(configuredProjectSlug(null)).toBeUndefined();
  });
});
