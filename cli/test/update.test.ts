import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncProject } from '../src/update/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');

async function buildFixture(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-update-fixture-'));
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
      database_env: {},
      app_env: {},
      build_env: {},
      e2e_project: 'chromium',
      e2e_start_command: 'npm run dev',
      paths_ignore: ['SDLC/**', 'compliance/**'],
    }),
  );
  // package.json with all node-stack required_dev_dependencies already
  // present so syncStackDeps reports "all present" instead of running npm.
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
  await fs.mkdir(join(dir, '.husky'), { recursive: true });
  await fs.mkdir(join(dir, 'scripts'), { recursive: true });
  await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  return dir;
}

describe('syncProject — native TS sync against a fixture', () => {
  let fixtureDir = '';
  beforeAll(async () => {
    fixtureDir = await buildFixture();
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
  });
  afterAll(async () => {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it('runs end-to-end and emits expected files', async () => {
    const report = await syncProject(fixtureDir);
    expect(report.project).toBe(basename(fixtureDir));
    expect(report.stack).toBe('node');
    expect(report.host).toBe('railway');
    expect(report.totalFilesSynced).toBeGreaterThan(20);
    // Section 2a — stage docs
    expect(await fs.stat(join(fixtureDir, 'SDLC', '0-project-setup.md'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'SDLC', 'Test_Policy.md'))).toBeTruthy();
    // Section 2b — AI rule pointers
    expect(await fs.readFile(join(fixtureDir, '.cursorrules'), 'utf-8')).toContain('INSTRUCTIONS.md');
    expect(await fs.readFile(join(fixtureDir, '.windsurfrules'), 'utf-8')).toContain('INSTRUCTIONS.md');
    expect(await fs.readFile(join(fixtureDir, 'GEMINI.md'), 'utf-8')).toContain('INSTRUCTIONS.md');
    expect(await fs.readFile(join(fixtureDir, 'CLAUDE.md'), 'utf-8')).toContain('INSTRUCTIONS.md');
    expect(await fs.readFile(join(fixtureDir, 'INSTRUCTIONS.md'), 'utf-8')).toContain('SDLC Compliance Process');
    // Section 2c — husky hooks
    expect(await fs.stat(join(fixtureDir, '.husky', 'commit-msg'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, '.husky', 'pre-commit'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, '.husky', 'pre-push'))).toBeTruthy();
    // Hook config files at repo root
    expect(await fs.stat(join(fixtureDir, 'commitlint.config.mjs'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'lint-staged.config.mjs'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, '.prettierrc.json'))).toBeTruthy();
    // Section 2d — scripts
    expect(await fs.stat(join(fixtureDir, 'scripts', 'upload-evidence.sh'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'scripts', 'validate-compliance-artifacts.sh'))).toBeTruthy();
    // Section 2e-iii — evidence helper (node only)
    expect(await fs.stat(join(fixtureDir, 'e2e', 'helpers', 'evidence.ts'))).toBeTruthy();
    // Section 2f — CI workflows
    const ciYml = await fs.readFile(join(fixtureDir, '.github', 'workflows', 'ci.yml'), 'utf-8');
    expect(ciYml).toContain('fixture-app');
    expect(ciYml).not.toContain('{{PROJECT_SLUG}}');
    expect(ciYml).not.toContain('{{NODE_VERSION}}');
  }, 60_000);

  it('is idempotent — re-running produces no errors and same file count', async () => {
    const first = await syncProject(fixtureDir);
    const second = await syncProject(fixtureDir);
    expect(second.totalFilesSynced).toBe(first.totalFilesSynced);
  }, 60_000);

  it('rejects an unknown stack', async () => {
    const badDir = await fs.mkdtemp(join(tmpdir(), 'cli-update-bad-'));
    try {
      await fs.writeFile(
        join(badDir, 'sdlc-config.json'),
        JSON.stringify({ project_slug: 'bad', stack: 'cobol', host: 'railway' }),
      );
      await expect(syncProject(badDir)).rejects.toThrow(/stack adapter not found/);
    } finally {
      await fs.rm(badDir, { recursive: true, force: true });
    }
  }, 30_000);
});
