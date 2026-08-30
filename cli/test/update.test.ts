import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { execa } from 'execa';
import { syncProject } from '../src/update/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

// GitHub rejects a workflow when a literal `run: |` scalar reaches its 21,000
// character expression-template limit. Keep generated CI shell blocks below a
// conservative ceiling so a template change fails locally rather than making a
// consumer's workflow invalid. DevAudit-Installer#423.
function runBlockByteLengths(workflow: string): number[] {
  const lines = normalizeNewlines(workflow).split('\n');
  const blocks: string[] = [];
  let current: string[] | undefined;

  for (const line of lines) {
    if (/^\s{8}run: \|\s*$/.test(line)) {
      current = [];
      continue;
    }
    if (current && /^\s{8}\S/.test(line)) {
      blocks.push(current.join('\n'));
      current = undefined;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current.join('\n'));
  return blocks.map((block) => Buffer.byteLength(block, 'utf8'));
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
    for (const bytes of runBlockByteLengths(content)) {
      expect(bytes, `GitHub expression-template limit in ${wf}`).toBeLessThan(20_000);
    }
  }
}

async function expectWorkflowTokenContract(dir: string): Promise<void> {
  const workflowDir = join(dir, '.github', 'workflows');
  const files = await fs.readdir(workflowDir);
  for (const wf of files) {
    if (!wf.endsWith('.yml') && !wf.endsWith('.yaml')) continue;
    const content = await fs.readFile(join(workflowDir, wf), 'utf-8');
    expect(content, `legacy DevAudit PAT fallback in ${wf}`).not.toMatch(/(?:token:|GH_TOKEN:)\s*\$\{\{\s*secrets\.DEVAUDIT_USER_TOKEN \|\| github\.token\s*\}\}/);
    expect(content, `legacy secrets.GITHUB_TOKEN contract in ${wf}`).not.toMatch(/(?:GH_TOKEN:|github-token:)\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  }

  const incidentExport = await fs.readFile(join(workflowDir, 'incident-export.yml'), 'utf-8');
  expect(incidentExport).toContain('token: ${{ github.token }}');
  expect(incidentExport).toContain('GH_TOKEN: ${{ github.token }}');

  const periodicReview = await fs.readFile(join(workflowDir, 'periodic-review.yml'), 'utf-8');
  expect(periodicReview).toContain('token: ${{ github.token }}');
  expect(periodicReview).toContain('GH_TOKEN: ${{ github.token }}');

  const labelRetention = await fs.readFile(join(workflowDir, 'label-retention.yml'), 'utf-8');
  expect(labelRetention).toContain('GH_TOKEN: ${{ github.token }}');
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) return listFilesRecursive(fullPath);
      return [fullPath];
    }),
  );
  return nested.flat();
}

async function expectNoCompactTableSeparators(dir: string): Promise<void> {
  const compactSeparator = /^\|[-:|]+\|$/m;
  const roots = ['SDLC', 'scripts', '.claude/skills'];

  for (const root of roots) {
    const rootPath = join(dir, root);
    const files = await listFilesRecursive(rootPath);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8');
      expect(content, `compact markdown table separator in ${file}`).not.toMatch(
        compactSeparator,
      );
    }
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
    expect(await fs.stat(join(fixtureDir, 'scripts', 'report-test-execution.sh'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'scripts', 'record-uat-execution.sh'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'scripts', 'render-test-executions.sh'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'scripts', 'validate-compliance-artifacts.sh'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'scripts', 'generate-bundled-changes.sh'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'scripts', 'evaluate-npm-audit.sh'))).toBeTruthy();
    const generatedBundleScript = await fs.readFile(
      join(fixtureDir, 'scripts', 'generate-bundled-changes.sh'),
      'utf-8',
    );
    expect(generatedBundleScript).toContain('HOUSEKEEPING_TYPES');
    expect(generatedBundleScript).toContain('schemaVersion: 2');
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
    const projectSetup = normalizeNewlines(
      await fs.readFile(join(fixtureDir, 'SDLC', '0-project-setup.md'), 'utf-8'),
    );
    expect(projectSetup).toContain(
      '| REQ-ID | Issue | Risk | Evidence | Status | PR | Reviewer | AI-tool |',
    );
    expect(projectSetup).toContain(
      '| -------- | ------- | ------ | ---------- | -------- | ----- | ---------- | --------- |',
    );
    expect(projectSetup).toContain('`stop\\|unsubscribe\\|opt-out`');
    expect(projectSetup).toContain('false-positive MD056/MD060 lint errors');
    // wawagardenbar-app#383: PRs to develop must surface Quality Gates, while
    // release registration/evidence upload stay push/dispatch-only side effects.
    expect(ciYml).toContain('pull_request:\n    branches: [develop]');
    expect(ciYml).toContain(
      "if: ${{ always() && (github.event_name != 'pull_request' || !startsWith(github.head_ref, 'chore/close-out-')) && (github.event_name == 'pull_request' || needs.register-release.result == 'success') }}",
    );
    expect(ciYml).toMatch(/register-release:[\s\S]*if: \$\{\{ github\.event_name != 'pull_request' && github\.ref_name == 'develop' \}\}/);
    expect(ciYml).toMatch(
      /upload-evidence:[\s\S]*if: \$\{\{ !cancelled\(\) && github\.event_name != 'pull_request' && github\.ref_name == 'develop' && needs\.register-release\.result == 'success' \}\}/,
    );
    expect(ciYml).toContain('scripts/report-test-execution.sh start');
    expect(ciYml).toContain('--evidence-scope execution --test-execution-record-id');
    expect(ciYml).toContain('Complete primary quality-gate execution');
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
    const complianceUploader = await fs.readFile(
      join(fixtureDir, 'scripts', 'upload-compliance-documents.sh'),
      'utf-8',
    );
    expect(complianceEvidenceYml).toContain('bash scripts/upload-compliance-documents.sh');
    expect(complianceEvidenceYml).toContain('DEVAUDIT_RELEASE_VERSION: ${{ steps.version.outputs.version }}');
    expect(complianceUploader).toContain('/api/ci/projects/${DEVAUDIT_PROJECT_SLUG}/audit-log/export');
    expect(complianceUploader).toContain('audit_log "$AUDIT_LOG_FILE"');
    expect(complianceUploader).not.toContain('FLAGS="${FLAGS} --test-execution ${{ github.run_id }}"');
    // #409: ordinary housekeeping is integration history. The legacy path
    // that made approval artefacts, opened a PR, and dispatched CI is disabled.
    expect(complianceEvidenceYml).toContain('Legacy housekeeping approval path (disabled)');
    expect(complianceEvidenceYml).toContain('Legacy housekeeping gate dispatch (disabled)');
    expect(complianceEvidenceYml).toContain('contents: read');
    expect(complianceEvidenceYml).not.toContain('actions: write       # gh workflow run ci.yml --ref develop');
    expect(complianceEvidenceYml).toContain("printf '%s\\n' 'import json'");
    expect(complianceEvidenceYml).toContain('python3 /tmp/devaudit-extract-e2e-reqs.py');
    expect(complianceEvidenceYml).not.toContain("done < <(python3 - <<'PY'");
    expect(complianceEvidenceYml).toContain('Walk suites/specs/tests/results recursively');
    expect(complianceEvidenceYml).toContain('**Spec file:** ${SPEC_FILE}');
    expect(complianceEvidenceYml).toContain('--title "[REGRESSION] ${SPEC_FILE} :: ${TEST_NAME}"');
    const ciStatusFallbackYml = await fs.readFile(
      join(fixtureDir, '.github', 'workflows', 'ci-status-fallback.yml'),
      'utf-8',
    );
    expect(ciStatusFallbackYml).toContain('permissions:');
    expect(ciStatusFallbackYml).toContain('contents: read');
    expect(ciStatusFallbackYml).toContain('statuses: write');
    const provenanceYml = await fs.readFile(
      join(fixtureDir, '.github', 'workflows', 'quality-gates-provenance.yml'),
      'utf-8',
    );
    expect(provenanceYml).toContain('permissions:');
    expect(provenanceYml).toContain('checks: read');
    expect(provenanceYml).toContain('actions: write');
    expect(provenanceYml).toContain('name: Release Scope Integrity');
    expect(provenanceYml).toContain("!startsWith(github.event.pull_request.head.ref, 'hotfix/')");
    expect(provenanceYml).toContain('bash scripts/check-release-pr-scope.sh');
    expect(provenanceYml).toContain('gh workflow run ci.yml --ref "$HEAD_REF"');
    expect(provenanceYml).toContain('gh run watch "$RUN_ID" --exit-status');
    expect(provenanceYml).toContain('MAX_ATTEMPTS=10');
    expect(provenanceYml).toContain('Develop-side Quality Gates for SHA ${HEAD_SHA} not successful yet');
    const postDeployYml = await fs.readFile(
      join(fixtureDir, '.github', 'workflows', 'post-deploy-prod.yml'),
      'utf-8',
    );
    expect(postDeployYml).toContain('deployments: read');
    expect(postDeployYml).toContain('bash scripts/check-host-deployment.sh');
    expect(postDeployYml).toContain('Probe production health independently');
    expect(postDeployYml).toContain('deployment_status_timeout');
    expect(postDeployYml).toContain('host-deployment-result.env');
    expect(postDeployYml).toContain('deployment_status:');
    expect(postDeployYml).toContain("github.event.deployment_status.state == 'success'");
    const reconciliationYml = await fs.readFile(join(fixtureDir, '.github', 'workflows', 'reconcile-deployment.yml'), 'utf-8');
    expect(reconciliationYml).toContain('Verify provider deployment before reconciliation');
    expect(reconciliationYml).toContain('provenance=manual_reconciliation');
    expect(postDeployYml).toContain('scripts/report-test-execution.sh start');
    expect(postDeployYml).toContain('scripts/report-test-execution.sh complete');
    // DevAudit-Installer#228 — every generated workflow must be valid YAML.
    await expectAllWorkflowsValidYaml(fixtureDir);
    await expectWorkflowTokenContract(fixtureDir);
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
    const featureE2eYml = await fs.readFile(
      join(fixtureDir, '.github', 'workflows', 'feature-e2e.yml'),
      'utf-8',
    );
    expect(featureE2eYml).toContain('Register feature release and start feature E2E execution');
    expect(featureE2eYml).toContain('Complete feature E2E execution');
    expect(featureE2eYml).toContain('--evidence-scope execution --test-execution-record-id');
    expect(featureE2eYml).toContain('Feature E2E produced no e2e-results.json');
    expect(featureE2eYml).toMatch(/fixture-app "\$REQ_ID" e2e_result e2e-results\.json/);
    expect(featureE2eYml).toContain('No evidenceShot screenshots were captured for ${REQ_ID}.');
    expect(featureE2eYml).toMatch(/fixture-app "\$REQ_ID" screenshot "\$shot"/);
    await expectNoCompactTableSeparators(fixtureDir);
    // DevAudit-Installer#349: a summary alone must downgrade the gate for
    // test-maintenance REQs even when no REQ-specific tags exist on disk.
    expect(ciYml).toContain('elif [ "$HAS_SUMMARY" = "true" ]; then');
    expect(ciYml).toContain(
      'Accepted as evidence for test-maintenance or execution-only REQs.',
    );
    // Section 2g — gitignore sentinel entries (devaudit-installer#226)
    const gitignoreContent = await fs.readFile(join(fixtureDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('.e2e-gate-passed');
    expect(gitignoreContent).toContain('.e2e-evidence-wired');
    expect(gitignoreContent).toContain('.sdlc-implementer-invoked');
    expect(gitignoreContent).toContain('.sdlc-pr-watch.json');
    // Section 2h — SDLC CLI engine (binary + blueprints)
    expect(await fs.stat(join(fixtureDir, 'SDLC', 'bin', 'devaudit-sdlc.js'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'SDLC', 'blueprints', '1-plan-requirement.raw.md'))).toBeTruthy();
    expect(await fs.stat(join(fixtureDir, 'SDLC', 'blueprints', 'implementing-an-sdlc-issue.raw.md'))).toBeTruthy();
    const engineContent = await fs.readFile(join(fixtureDir, 'SDLC', 'bin', 'devaudit-sdlc.js'), 'utf-8');
    expect(engineContent).toContain('SDLC Gateway Initialized');
    // Section 2i — Windsurf workflow files
    expect(await fs.stat(join(fixtureDir, '.devin', 'workflows', 'devaudit-update-install.md'))).toBeTruthy();
    const workflowContent = await fs.readFile(join(fixtureDir, '.devin', 'workflows', 'devaudit-update-install.md'), 'utf-8');
    expect(workflowContent).toContain('devaudit install');
    expect(workflowContent).toContain('devaudit update');
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

  it('removes stale unsuffixed workflow files left over from before a second target was added', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-update-multitarget-cleanup-'));
    try {
      const baseTarget = {
        stack: 'node',
        working_directory: '.',
        source_dirs: 'app/ lib/',
        production_url_secret: 'FIXTURE_PROD_URL',
        devaudit: { project_slug: 'fixture-app' },
      };
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
          targets: [
            { name: 'web', ...baseTarget },
            { name: 'api', ...baseTarget, stack: 'python', working_directory: 'api', devaudit: { project_slug: 'fixture-api' } },
          ],
        }),
      );
      const workflowsDir = join(dir, '.github', 'workflows');
      await fs.mkdir(workflowsDir, { recursive: true });
      // Simulate leftover output from a prior single-target sync, before this
      // config gained its `api` target.
      await fs.writeFile(join(workflowsDir, 'ci.yml'), 'name: CI Pipeline\n');
      await fs.writeFile(join(workflowsDir, 'feature-e2e.yml'), 'name: Feature E2E\n');

      await syncProject(dir);

      const files = await fs.readdir(workflowsDir);
      expect(files).not.toContain('ci.yml');
      expect(files).not.toContain('feature-e2e.yml');
      expect(files).toContain('ci-web.yml');
      expect(files).toContain('ci-api.yml');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('namespaces CI workflow filenames and check names when a config has multiple targets (#692)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-update-multitarget-'));
    try {
      const baseTarget = {
        stack: 'node',
        working_directory: '.',
        source_dirs: 'app/ lib/',
        production_url_secret: 'FIXTURE_PROD_URL',
        devaudit: { project_slug: 'fixture-app' },
      };
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
          targets: [
            { name: 'web', ...baseTarget },
            { name: 'api', ...baseTarget, stack: 'python', working_directory: 'api', devaudit: { project_slug: 'fixture-api' } },
          ],
        }),
      );
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await syncProject(dir);

      const workflowsDir = join(dir, '.github', 'workflows');
      const files = await fs.readdir(workflowsDir);
      // No un-namespaced `ci.yml` — single-target output name must not collide.
      expect(files).not.toContain('ci.yml');
      expect(files).toContain('ci-web.yml');
      expect(files).toContain('ci-api.yml');

      const webCi = await fs.readFile(join(workflowsDir, 'ci-web.yml'), 'utf-8');
      const apiCi = await fs.readFile(join(workflowsDir, 'ci-api.yml'), 'utf-8');
      expect(webCi).toContain('Quality Gates (web)');
      expect(apiCi).toContain('Quality Gates (api)');
      expect(webCi).not.toContain('Quality Gates (api)');
      expect(apiCi).toContain('fixture-api');
      expect(webCi).not.toContain('fixture-api');
      expect(webCi).toContain('fixture-app');

      await expectAllWorkflowsValidYaml(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('renders each target\'s own e2e_port override into the dev-server wait step, defaulting to 3000', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-update-multitarget-e2eport-'));
    try {
      const baseTarget = {
        stack: 'node',
        working_directory: '.',
        source_dirs: 'app/ lib/',
        production_url_secret: 'FIXTURE_PROD_URL',
        devaudit: { project_slug: 'fixture-app' },
      };
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
          targets: [
            { name: 'web', ...baseTarget, working_directory: 'web', e2e_port: 3100 },
            { name: 'api-ui', ...baseTarget, working_directory: 'api-ui', devaudit: { project_slug: 'fixture-api-ui' } },
          ],
        }),
      );
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await syncProject(dir);

      const workflowsDir = join(dir, '.github', 'workflows');
      const webCi = await fs.readFile(join(workflowsDir, 'ci-web.yml'), 'utf-8');
      const apiUiCi = await fs.readFile(join(workflowsDir, 'ci-api-ui.yml'), 'utf-8');

      expect(webCi).toContain('http://localhost:3100 --timeout 120000');
      expect(webCi).toContain('lsof -ti:3100');
      // No per-target override -> falls back to the 3000 default.
      expect(apiUiCi).toContain('http://localhost:3000 --timeout 120000');
      expect(apiUiCi).toContain('lsof -ti:3000');

      await expectAllWorkflowsValidYaml(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('reads each target\'s own devaudit.api_key_secret in release-lifecycle workflows, not the literal DEVAUDIT_API_KEY', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-update-multitarget-apikey-'));
    try {
      const baseTarget = {
        stack: 'node',
        working_directory: '.',
        source_dirs: 'app/ lib/',
        production_url_secret: 'FIXTURE_PROD_URL',
      };
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
          targets: [
            // No explicit api_key_secret on the first target -> the legacy default.
            { name: 'web', ...baseTarget, devaudit: { project_slug: 'fixture-app' } },
            {
              name: 'api-ui',
              ...baseTarget,
              working_directory: 'api-ui',
              devaudit: { project_slug: 'fixture-api-ui', api_key_secret: 'FIXTURE_API_UI_API_KEY' },
            },
          ],
        }),
      );
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await syncProject(dir);

      const workflowsDir = join(dir, '.github', 'workflows');
      const webCi = await fs.readFile(join(workflowsDir, 'ci-web.yml'), 'utf-8');
      const apiUiCi = await fs.readFile(join(workflowsDir, 'ci-api-ui.yml'), 'utf-8');

      expect(webCi).toContain('secrets.DEVAUDIT_API_KEY');
      expect(apiUiCi).toContain('secrets.FIXTURE_API_UI_API_KEY');
      expect(apiUiCi).not.toContain('secrets.DEVAUDIT_API_KEY');

      await expectAllWorkflowsValidYaml(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('scopes ci.yml triggers to each target\'s own working_directory when both targets are non-root (#693)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-update-multitarget-paths-'));
    try {
      const baseTarget = {
        stack: 'node',
        source_dirs: 'app/ lib/',
        production_url_secret: 'FIXTURE_PROD_URL',
        devaudit: { project_slug: 'fixture-app' },
      };
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
          targets: [
            { name: 'web', ...baseTarget, working_directory: 'mission-control', devaudit: { project_slug: 'thorstack-web' } },
            { name: 'api', ...baseTarget, stack: 'python', working_directory: 'mission-control-api', devaudit: { project_slug: 'thorstack-api' } },
          ],
        }),
      );
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await syncProject(dir);

      const workflowsDir = join(dir, '.github', 'workflows');
      const webCi = await fs.readFile(join(workflowsDir, 'ci-web.yml'), 'utf-8');
      const apiCi = await fs.readFile(join(workflowsDir, 'ci-api.yml'), 'utf-8');

      // Each target's push trigger ignores the OTHER target's subtree...
      expect(webCi).toContain("- 'mission-control-api/**'");
      expect(apiCi).toContain("- 'mission-control/**'");
      // ...but not its own.
      expect(webCi).not.toContain("- 'mission-control/**'");
      expect(apiCi).not.toContain("- 'mission-control-api/**'");

      // pull_request gains a matching paths-ignore block (previously absent).
      expect(webCi).toMatch(/pull_request:\s*\n\s*branches: \[develop\]\s*\n\s*paths-ignore:\s*\n\s*- 'mission-control-api\/\*\*'/);
      expect(apiCi).toMatch(/pull_request:\s*\n\s*branches: \[develop\]\s*\n\s*paths-ignore:\s*\n\s*- 'mission-control\/\*\*'/);

      await expectAllWorkflowsValidYaml(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  // #689 follow-up: GitHub Actions only reads .github/workflows/ from the
  // repo root — never from a target's own subdirectory. When a target lives
  // in a polyglot-monorepo subdirectory (the whole point of --add-target),
  // syncing CI output relative to the target's own directory instead of the
  // repo root produces files GitHub never runs.
  it('writes .github/workflows/ at the git repo root, not a subdirectory target\'s own path', async () => {
    const repoRoot = await fs.mkdtemp(join(tmpdir(), 'cli-update-reporoot-'));
    try {
      await execa('git', ['init', '-q'], { cwd: repoRoot });
      const targetDir = join(repoRoot, 'mission-control');
      await fs.mkdir(targetDir, { recursive: true });
      // sdlc-config.json lives at the repo root (#689 follow-up), not this
      // target's own directory — see write-config.ts for why.
      await fs.writeFile(
        join(repoRoot, 'sdlc-config.json'),
        JSON.stringify({
          project_slug: 'mission-control',
          stack: 'node',
          host: 'railway',
          node_version: '20',
          runner: 'ubuntu-latest',
          working_directory: '.',
          source_dirs: 'app/ lib/',
          sast_baseline: 0,
          accepted_dep_risks: '',
          production_url_secret: 'MISSION_CONTROL_PROD_URL',
          database_service: '',
          database_image: '',
          database_port: '',
          e2e_project: 'chromium',
          e2e_start_command: 'npm run dev',
        }),
      );
      // .github/workflows/ pre-exists at the repo root (syncCiTemplates
      // requires it, matching the precondition a real onboarded repo has).
      await fs.mkdir(join(repoRoot, '.github', 'workflows'), { recursive: true });

      await syncProject(targetDir);

      const rootWorkflows = await fs.readdir(join(repoRoot, '.github', 'workflows'));
      expect(rootWorkflows).toContain('ci.yml');
      const targetGithubExists = await fs
        .stat(join(targetDir, '.github'))
        .then(() => true)
        .catch(() => false);
      expect(targetGithubExists).toBe(false);

      const rootIssueTemplates = await fs
        .readdir(join(repoRoot, '.github', 'ISSUE_TEMPLATE'))
        .catch(() => []);
      expect(rootIssueTemplates.length).toBeGreaterThan(0);

      const rootDevinWorkflows = await fs
        .readdir(join(repoRoot, '.devin', 'workflows'))
        .catch(() => []);
      expect(rootDevinWorkflows.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  }, 60_000);

  // #689 follow-up: `syncProject` (and `resolveAdapters` underneath it) must
  // find sdlc-config.json at the repo root even when invoked with a
  // subdirectory target path — not just tolerate the config already being
  // there when someone happens to point it at the root. A config that only
  // exists at the target's own directory (the pre-fix, buggy write location)
  // must NOT be picked up: proves the discovery is genuinely repo-root, not
  // "whichever one happens to be readable".
  it('resolves stack/host from the repo-root config, not a stale copy in the target\'s own directory', async () => {
    const repoRoot = await fs.mkdtemp(join(tmpdir(), 'cli-update-reporoot-discovery-'));
    try {
      await execa('git', ['init', '-q'], { cwd: repoRoot });
      const targetDir = join(repoRoot, 'api');
      await fs.mkdir(targetDir, { recursive: true });
      await fs.mkdir(join(repoRoot, '.github', 'workflows'), { recursive: true });

      const rootConfig = {
        project_slug: 'api',
        stack: 'python',
        host: 'railway',
        python_version: '3.12',
        runner: 'ubuntu-latest',
        working_directory: 'api',
        source_dirs: 'src/',
        sast_baseline: 0,
        accepted_dep_risks: '',
        production_url_secret: 'API_PROD_URL',
        database_service: '',
        database_image: '',
        database_port: '',
        e2e_project: '',
        e2e_start_command: '',
      };
      await fs.writeFile(join(repoRoot, 'sdlc-config.json'), JSON.stringify(rootConfig));

      // A stale/never-cleaned-up copy in the target's own directory, with a
      // *different* stack — proves the sync actually reads the repo-root
      // file rather than this one, which the old (buggy) call sites would
      // have preferred.
      await fs.writeFile(
        join(targetDir, 'sdlc-config.json'),
        JSON.stringify({ ...rootConfig, stack: 'node' }),
      );

      const report = await syncProject(targetDir);

      expect(report.stack).toBe('python');
      const rootWorkflows = await fs.readdir(join(repoRoot, '.github', 'workflows'));
      expect(rootWorkflows).toContain('ci.yml');
      const ciContent = await fs.readFile(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf-8');
      expect(ciContent).toContain('working-directory: api');
      expect(ciContent).not.toMatch(/npm ci\b/);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  }, 60_000);

  // e2e_start_command is '' on every fresh install (no prompt collects it —
  // filling it in is a deliberate post-install manual edit). `run: <empty> &`
  // renders as a bare `&`, which YAML parses as an empty anchor name and
  // rejects outright — breaking ci.yml and feature-e2e.yml for every
  // consumer before they've configured a dev-server command.
  it('renders a valid (harmless no-op) dev-server step when e2e_start_command is empty', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-update-empty-e2e-'));
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
          e2e_start_command: '',
        }),
      );
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await syncProject(dir);

      const ci = await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf-8');
      expect(ci).not.toMatch(/run:\s*&\s*$/m);
      expect(ci).toContain('run: true &');

      await expectAllWorkflowsValidYaml(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  // build_env: {} is the default on every fresh install (an empty object is
  // truthy in JS, so a naive `cfg.build_env ? ... : ''` check renders the
  // block as empty anyway) — but the Build Check step's `env:` key had no
  // other content to fall back on, so it ended up as a dangling `env:` with
  // nothing after it. js-yaml parses that fine (as `env: null`), but GitHub
  // Actions' schema validator rejects it outright ("expecting a single
  // ${{...}} expression or mapping value for 'env' section") — a class of
  // break `expectAllWorkflowsValidYaml` can't catch, only found by actually
  // running actionlint against the onboarded mission-control repo.
  it('does not emit a dangling env: key on the Build Check step when build_env is empty', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-update-emptybuildenv-'));
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
          build_env: {},
          e2e_project: 'chromium',
          e2e_start_command: 'npm run dev',
        }),
      );
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await syncProject(dir);

      const ci = await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf-8');
      expect(ci).not.toMatch(/env:[ \t]*\n[ \t]*\n/);

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
      expect(ciYml).toContain("github.event_name != 'pull_request' && github.ref_name == 'develop' }}");
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
    expect(featureE2eYml).toContain("if: ${{ !startsWith(github.head_ref, 'chore/close-out-') }}");
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
    expect(featureE2eYml).toContain('Feature E2E produced no e2e-results.json');
    expect(featureE2eYml).toMatch(/fixture-app "\$REQ_ID" e2e_result e2e-results\.json/);
    expect(featureE2eYml).toContain('No evidenceShot screenshots were captured for ${REQ_ID}.');
    expect(featureE2eYml).toMatch(/fixture-app "\$REQ_ID" screenshot "\$shot"/);
    // #737: the has_tests=false path uploads a committed e2e-scope-decision.md
    // as its own evidence type instead of leaving only the ::warning:: log line.
    expect(featureE2eYml).toContain(
      "if: steps.detect.outputs.has_tests == 'false' && steps.detect.outputs.req_id != 'none'",
    );
    expect(featureE2eYml).toContain('compliance/evidence/${REQ_ID}/e2e-scope-decision.md');
    expect(featureE2eYml).toMatch(/fixture-app "\$REQ_ID" e2e_scope_decision "\$ARTEFACT"/);
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

  it('renders repository and manual self-hosted runner selection with a safe ubuntu-latest fallback (#319, #664)', async () => {
    const dir = await buildFixture();
    try {
      const configPath = join(dir, 'sdlc-config.json');
      const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<
        string,
        unknown
      >;
      config.runner = 'self-hosted';
      await fs.writeFile(configPath, JSON.stringify(config));
      process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;

      await syncProject(dir);

      const runnerExpr =
        "${{ (inputs.runner_label || vars.CI_RUNNER_LABEL || 'github-ci') == 'github-ci' && 'ubuntu-latest' || (inputs.runner_label || vars.CI_RUNNER_LABEL || 'github-ci') }}";
      const ciYml = normalizeNewlines(
        await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf8'),
      );
      expect(ciYml).toContain(`runs-on: ${runnerExpr}`);
      expect(ciYml).toContain('runner_label:');
      expect(ciYml).toContain('repository CI_RUNNER_LABEL');
      // No literal 'self-hosted' target anywhere in runs-on — an unset or
      // blank CI_RUNNER_LABEL must resolve to ubuntu-latest, not hang
      // waiting for a self-hosted runner that may not exist (DevAudit-Installer#664).
      expect(ciYml).not.toMatch(/runs-on:\s*self-hosted\s*$/m);

      // Regeneration is deterministic: re-syncing must not drift the
      // interface or inject a machine-specific target (DevAudit-Installer#664
      // acceptance criterion: "regenerating ci.yml preserves the runner
      // interface").
      await syncProject(dir);
      const ciYmlAgain = normalizeNewlines(
        await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf8'),
      );
      expect(ciYmlAgain).toContain(`runs-on: ${runnerExpr}`);

      await expectAllWorkflowsValidYaml(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('treats any non-self-hosted runner value as a static, config-owned override (#664)', async () => {
    const dir = await buildFixture();
    try {
      const configPath = join(dir, 'sdlc-config.json');
      const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<
        string,
        unknown
      >;
      config.runner = 'ubuntu-latest';
      await fs.writeFile(configPath, JSON.stringify(config));
      process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;

      await syncProject(dir);

      const ciYml = normalizeNewlines(
        await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf8'),
      );
      // Static override: every runs-on line is the literal config value,
      // not a CI_RUNNER_LABEL-driven expression. (The workflow_dispatch
      // runner_label input's description text still mentions
      // CI_RUNNER_LABEL — that's static template copy, unrelated to which
      // runs-on value actually gets used.)
      const runsOnLines = ciYml.split('\n').filter((line) => /^\s*runs-on:/.test(line));
      expect(runsOnLines.length).toBeGreaterThan(0);
      for (const line of runsOnLines) {
        expect(line).toBe('    runs-on: ubuntu-latest');
      }
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
