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
    // Backward compat: with no e2e_projects/e2e_seed_command configured, the
    // authenticated-e2e token is dropped and no extra step is emitted.
    expect(ciYml).not.toContain('{{E2E_AUTHENTICATED_STEP}}');
    expect(ciYml).not.toContain('Authenticated E2E');
    // Backward compat: with no e2e_setup_command/e2e_env, no setup step renders
    // and the blocking dev-server + E2E steps carry no extra env — the gate is
    // byte-identical to before the local-DB-harness change.
    expect(ciYml).not.toContain('{{E2E_SETUP_STEP}}');
    expect(ciYml).not.toContain('{{E2E_DEV_SERVER_STEP}}');
    expect(ciYml).not.toContain('{{E2E_TEST_STEP}}');
    expect(ciYml).not.toContain('- name: E2E setup');
    expect(ciYml).toContain('- name: Start dev server\n        run: npm run dev &');
    // Per-AC evidence screenshots: the artifact carries them and the upload-evidence
    // job uploads them as `screenshot` type, scoped per in-scope requirement.
    expect(ciYml).toContain('compliance/evidence/*/screenshots/*.png');
    expect(ciYml).toContain('Upload per-AC e2e evidence screenshots');
    expect(ciYml).toMatch(/"\$REQ" screenshot "\$NAMED"/);
  }, 60_000);

  it('is idempotent — re-running produces no errors and same file count', async () => {
    const first = await syncProject(fixtureDir);
    const second = await syncProject(fixtureDir);
    expect(second.totalFilesSynced).toBe(first.totalFilesSynced);
  }, 60_000);

  it('renders a report-only authenticated e2e step when configured', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-update-authe2e-'));
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
          database_env: {},
          app_env: {},
          build_env: {},
          e2e_project: 'chromium',
          e2e_start_command: 'npm run dev',
          e2e_seed_command: 'npx tsx scripts/seed-e2e-admins.ts',
          e2e_projects: ['reward-rule-form'],
          e2e_env: { E2E_ADMIN_USERNAME: '${{ secrets.E2E_ADMIN_USERNAME }}' },
          paths_ignore: ['SDLC/**', 'compliance/**'],
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
      await fs.mkdir(join(dir, '.husky'), { recursive: true });
      await fs.mkdir(join(dir, 'scripts'), { recursive: true });
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await syncProject(dir);
      const ciYml = await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf-8');
      // The blocking smoke gate is preserved …
      expect(ciYml).toContain('--project=chromium --reporter=json,html');
      // … and the report-only authenticated steps are injected after it.
      expect(ciYml).toContain('Seed E2E test data (report-only)');
      expect(ciYml).toContain('npx tsx scripts/seed-e2e-admins.ts');
      expect(ciYml).toContain('Authenticated E2E (report-only)');
      expect(ciYml).toContain('continue-on-error: true');
      expect(ciYml).toContain('--project=reward-rule-form --reporter=json,html');
      expect(ciYml).toContain('E2E_ADMIN_USERNAME: ${{ secrets.E2E_ADMIN_USERNAME }}');
      expect(ciYml).toContain('e2e-auth-results.json');
      expect(ciYml).not.toContain('{{E2E_AUTHENTICATED_STEP}}');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('threads a local-DB E2E setup step + e2e_env into the blocking gate when configured', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-update-e2elocal-'));
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
          database_env: {},
          app_env: {},
          build_env: {},
          e2e_project: 'chromium',
          e2e_start_command: 'next dev -p 3000',
          e2e_setup_command: 'supabase start\npsql "$DATABASE_URL" -f supabase/schema-local.sql',
          e2e_env: { E2E_LOCAL: '1', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' },
          paths_ignore: ['SDLC/**', 'compliance/**'],
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
      await fs.mkdir(join(dir, '.husky'), { recursive: true });
      await fs.mkdir(join(dir, 'scripts'), { recursive: true });
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await syncProject(dir);
      const ciYml = await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf-8');
      // A foreground setup step renders before the dev server, as a `run: |` block.
      expect(ciYml).toContain('- name: E2E setup');
      expect(ciYml).toContain('        run: |\n          supabase start');
      expect(ciYml).toContain('psql "$DATABASE_URL" -f supabase/schema-local.sql');
      // e2e_env is threaded onto the dev-server step (overrides remote secrets) …
      expect(ciYml).toContain(
        '- name: Start dev server\n        env:\n          E2E_LOCAL: 1\n' +
          '          NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321\n        run: next dev -p 3000 &',
      );
      // … and onto the blocking E2E test step (after the PLAYWRIGHT_* vars).
      expect(ciYml).toContain(
        '          PLAYWRIGHT_JSON_OUTPUT_NAME: e2e-results.json\n          E2E_LOCAL: 1\n' +
          '          NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321\n' +
          '        run: npx playwright test --project=chromium --reporter=json,html',
      );
      expect(ciYml).not.toContain('{{E2E_SETUP_STEP}}');
      expect(ciYml).not.toContain('{{E2E_DEV_SERVER_STEP}}');
      expect(ciYml).not.toContain('{{E2E_TEST_STEP}}');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
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
