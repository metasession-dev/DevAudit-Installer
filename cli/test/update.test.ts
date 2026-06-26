import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { syncProject } from '../src/update/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

// DevAudit-Installer#228 — validate that every generated workflow file in
// .github/workflows/ is parseable YAML. Catches structural bugs like literal
// block scalar termination from 0-indent continuation lines.
async function expectAllWorkflowsValidYaml(dir: string): Promise<void> {
  const workflowDir = join(dir, '.github', 'workflows');
  const files = await fs.readdir(workflowDir);
  for (const wf of files) {
    if (!wf.endsWith('.yml') && !wf.endsWith('.yaml')) continue;
    const content = await fs.readFile(join(workflowDir, wf), 'utf-8');
    expect(() => yamlLoad(content), `YAML parse: ${wf}`).not.toThrow();
  }
}

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
    expect(await fs.readFile(join(fixtureDir, 'AGENTS.md'), 'utf-8')).toContain('INSTRUCTIONS.md');
    expect(await fs.readFile(join(fixtureDir, 'AGENTS.md'), 'utf-8')).toContain('SDLC/');
    expect(await fs.readFile(join(fixtureDir, 'CLAUDE.md'), 'utf-8')).toContain('INSTRUCTIONS.md');
    expect(await fs.readFile(join(fixtureDir, 'INSTRUCTIONS.md'), 'utf-8')).toContain('SDLC Compliance Process');
    // Section 2c — husky hooks
    expect(await fs.stat(join(fixtureDir, '.husky', 'commit-msg'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, '.husky', 'pre-commit'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, '.husky', 'pre-push'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, '.husky', 'prepare-commit-msg'))).toBeTruthy();
    // Hook config files at repo root
    expect(await fs.stat(join(fixtureDir, 'commitlint.config.mjs'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'lint-staged.config.mjs'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, '.prettierrc.json'))).toBeTruthy();
    // Section 2d — scripts
    expect(await fs.stat(join(fixtureDir, 'scripts', 'upload-evidence.sh'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'scripts', 'validate-compliance-artifacts.sh'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'scripts', 'generate-bundled-changes.sh'))).toBeTruthy();
    // Section 2e-iii — evidence helper (node only). All three files: the
    // Playwright wrapper, the pure helpers it imports, and the test-tags
    // annotation helper (#196).
    expect(await fs.stat(join(fixtureDir, 'e2e', 'helpers', 'evidence.ts'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'e2e', 'helpers', 'evidence-shot-core.ts'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'e2e', 'helpers', 'test-tags.ts'))).toBeTruthy();
    // Section 2f — CI workflows
    const ciYml = normalizeNewlines(
      await fs.readFile(join(fixtureDir, '.github', 'workflows', 'ci.yml'), 'utf-8'),
    );
    expect(ciYml).toContain('fixture-app');
    expect(ciYml).not.toContain('{{PROJECT_SLUG}}');
    expect(ciYml).not.toContain('{{NODE_VERSION}}');
    // wawagardenbar-app#383: PRs to develop must surface Quality Gates, while
    // release registration/evidence upload stay push/dispatch-only side effects.
    expect(ciYml).toContain('pull_request:\n    branches: [develop]');
    expect(ciYml).toMatch(/register-release:[\s\S]*if: \$\{\{ github\.event_name != 'pull_request' \}\}/);
    // DevAudit-Installer#98 WS3 + WS4: governance auto-generation workflows
    // sync into .github/workflows/ alongside the gate workflows.
    expect(await fs.stat(join(fixtureDir, '.github', 'workflows', 'periodic-review.yml'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, '.github', 'workflows', 'incident-export.yml'))).toBeTruthy();
    // DevAudit-Installer#210: label-retention.yml enforces the incident
    // label survives to issue close so incident-export.yml fires.
    expect(await fs.stat(join(fixtureDir, '.github', 'workflows', 'label-retention.yml'))).toBeTruthy();
    const labelRetentionYml = await fs.readFile(join(fixtureDir, '.github', 'workflows', 'label-retention.yml'), 'utf-8');
    expect(labelRetentionYml).toContain('types: [labeled, unlabeled]');
    expect(labelRetentionYml).toContain('incident');
    const periodicYml = await fs.readFile(join(fixtureDir, '.github', 'workflows', 'periodic-review.yml'), 'utf-8');
    expect(periodicYml).toContain("cron: '0 9 1 */3 *'");
    expect(periodicYml).toContain('compliance/governance/periodic-review.md');
    const incidentYml = await fs.readFile(join(fixtureDir, '.github', 'workflows', 'incident-export.yml'), 'utf-8');
    expect(incidentYml).toContain("contains(github.event.issue.labels.*.name, 'incident')");
    expect(incidentYml).toContain('compliance/governance/incident-report-');
    // DevAudit-Installer#98 WS2: compliance-evidence.yml now snapshots
    // the portal's audit log per release and uploads as `audit_log`.
    const complianceEvidenceYml = await fs.readFile(
      join(fixtureDir, '.github', 'workflows', 'compliance-evidence.yml'),
      'utf-8',
    );
    expect(complianceEvidenceYml).toContain('/api/ci/projects/fixture-app/audit-log/export');
    expect(complianceEvidenceYml).toContain('audit_log "$AUDIT_LOG_FILE"');
    // DevAudit-Installer#228 — every generated workflow must be valid YAML.
    await expectAllWorkflowsValidYaml(fixtureDir);
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
    // Section 2g — gitignore sentinel entries (devaudit-installer#226)
    const gitignoreContent = await fs.readFile(join(fixtureDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('.e2e-gate-passed');
    expect(gitignoreContent).toContain('.sdlc-implementer-invoked');
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
      // DevAudit-Installer#228 — validate all generated workflows are valid YAML.
      await expectAllWorkflowsValidYaml(dir);
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
      // DevAudit-Installer#228 — validate all generated workflows are valid YAML.
      await expectAllWorkflowsValidYaml(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('renders Python CI with PR-time Quality Gates and push-only release side effects', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-update-python-ci-'));
    try {
      await fs.writeFile(
        join(dir, 'sdlc-config.json'),
        JSON.stringify({
          project_slug: 'fixture-python',
          stack: 'python',
          host: 'railway',
          python_version: '3.11',
          runner: 'ubuntu-latest',
          working_directory: '.',
          source_dirs: 'src/',
          sast_baseline: 0,
          accepted_dep_risks: '',
          production_url_secret: 'FIXTURE_PROD_URL',
          database_service: '',
          database_image: '',
          database_port: '',
          database_env: {},
          app_env: {},
          build_env: {},
          paths_ignore: ['SDLC/**', 'compliance/**'],
        }),
      );
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await syncProject(dir);
      const ciYml = normalizeNewlines(
        await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf-8'),
      );
      expect(ciYml).toContain('actions/setup-python@v6');
      expect(ciYml).toContain('pull_request:\n    branches: [develop]');
      expect(ciYml).toContain("github.event_name != 'pull_request' }}");
      // DevAudit-Installer#228 — validate all generated workflows are valid YAML.
      await expectAllWorkflowsValidYaml(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('renders feature-e2e.yml with full E2E infrastructure and no residual tokens (#186)', async () => {
    // Use the same fixture from the first test (no DB configured) to assert
    // that feature-e2e.yml is rendered, has no residual block tokens, and
    // has its services block stripped (no database_service).
    const featureE2eYml = normalizeNewlines(
      await fs.readFile(
        join(fixtureDir, '.github', 'workflows', 'feature-e2e.yml'),
        'utf-8',
      ),
    );
    expect(featureE2eYml).toContain('Feature In-Scope E2E');
    expect(featureE2eYml).toContain('pull_request:\n    branches: [develop]');
    expect(featureE2eYml).toContain('detect-req');
    expect(featureE2eYml).toContain('run-feature-e2e');
    // No residual block tokens
    expect(featureE2eYml).not.toContain('{{E2E_FEATURE_TEST_STEP}}');
    expect(featureE2eYml).not.toContain('{{E2E_SETUP_STEP}}');
    expect(featureE2eYml).not.toContain('{{E2E_DEV_SERVER_STEP}}');
    expect(featureE2eYml).not.toContain('{{DATABASE_ENV}}');
    expect(featureE2eYml).not.toContain('{{APP_ENV}}');
    expect(featureE2eYml).not.toContain('{{DATABASE_URI_STEP}}');
    // No database_service configured → services block stripped
    expect(featureE2eYml).not.toContain('services:');
    // The feature test step is rendered (uses --grep not --project)
    expect(featureE2eYml).toContain('npx playwright test --grep "$REQ_ID"');
    // Evidence upload with origin=feature and stage 2
    expect(featureE2eYml).toContain('--sdlc-stage 2');
    expect(featureE2eYml).toContain('--meta-key "origin=feature"');
  }, 30_000);

  it('renders feature-e2e.yml with services block when database_service is configured (#186)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-update-fe2e-db-'));
    try {
      await fs.writeFile(
        join(dir, 'sdlc-config.json'),
        JSON.stringify({
          project_slug: 'fixture-db',
          stack: 'node',
          host: 'railway',
          node_version: '20',
          runner: 'ubuntu-latest',
          working_directory: '.',
          source_dirs: 'app/ lib/',
          sast_baseline: 0,
          accepted_dep_risks: '',
          production_url_secret: 'FIXTURE_PROD_URL',
          database_service: 'mongodb',
          database_image: 'mongo:7',
          database_port: '27017:27017',
          database_env: { MONGODB_URI: 'mongodb://localhost:27017' },
          app_env: {},
          build_env: {},
          e2e_project: 'chromium',
          e2e_start_command: 'npm run dev',
          paths_ignore: ['SDLC/**', 'compliance/**'],
        }),
      );
      await fs.writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'fixture-db',
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
      process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
      await syncProject(dir);
      const featureE2eYml = normalizeNewlines(
        await fs.readFile(join(dir, '.github', 'workflows', 'feature-e2e.yml'), 'utf-8'),
      );
      // Services block present with mongodb
      expect(featureE2eYml).toContain('services:');
      expect(featureE2eYml).toContain('mongodb:');
      expect(featureE2eYml).toContain('mongo:7');
      // Database env rendered
      expect(featureE2eYml).toContain('MONGODB_URI:');
      // Database URI step rendered (mongodb-specific)
      expect(featureE2eYml).toContain('Set database URI from dynamic port');
      // No residual template tokens (GitHub Actions ${{ }} is fine)
      expect(featureE2eYml).not.toMatch(/\{\{[A-Z][A-Z0-9_]*\}\}/);
      // DevAudit-Installer#228 — validate all generated workflows are valid YAML.
      await expectAllWorkflowsValidYaml(dir);
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
