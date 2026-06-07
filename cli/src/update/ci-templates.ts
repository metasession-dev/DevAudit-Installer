import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { exists, isDir, ensureDir } from '../lib/fs-utils.js';
import { substituteTokens, substituteBlocks, stripServicesBlock } from '../lib/templates.js';
import type { SyncContext, SectionResult } from './types.js';

const CI_TEMPLATES = [
  'ci.yml.template',
  'ci-status-fallback.yml.template',
  'compliance-validation.yml.template',
  'check-release-approval.yml.template',
  'post-deploy-prod.yml.template',
  'compliance-evidence.yml.template',
  'close-out-release.yml.template',
  // DevAudit-Installer#98 WS3: quarterly cron → auto-PR with the
  // periodic-review.md regenerated from local stats.
  'periodic-review.yml.template',
  // DevAudit-Installer#98 WS4: fires on `label:incident` issue close →
  // auto-PR with the issue exported to compliance/governance/.
  'incident-export.yml.template',
  // Phase 2 of the consumer-bump-via-issue process (v0.1.46+): daily
  // cron that flags overdue devaudit-bump issues with the `overdue`
  // label + a sticky comment carrying installed-vs-latest version
  // state. No gating; pure visibility. Pairs with the auto-issue-
  // filing step in DevAudit-Installer's release.yml.
  'devaudit-version-drift.yml.template',
];

const OLD_WORKFLOWS_TO_REMOVE = ['test-on-pr.yml', 'check-uat-approval.yml'];

interface SdlcConfig {
  readonly project_slug: string;
  readonly production_url_secret: string;
  readonly node_version?: string | number;
  readonly python_version?: string | number;
  readonly working_directory?: string;
  readonly runner: string;
  readonly source_dirs: string;
  readonly sast_baseline: number | string;
  readonly accepted_dep_risks: string;
  readonly database_service: string;
  readonly database_image: string;
  readonly database_port: string;
  readonly database_env?: Readonly<Record<string, string>>;
  readonly app_env?: Readonly<Record<string, string>>;
  readonly build_env?: Readonly<Record<string, string>>;
  readonly e2e_project: string;
  readonly e2e_start_command: string;
  // Optional pre-E2E setup command (foreground, blocking) run before the dev
  // server starts — e.g. `supabase start` + load schema + seed for a disposable
  // local database. Multi-line allowed. Absent → no setup step rendered.
  readonly e2e_setup_command?: string;
  // Authenticated e2e (report-only). Optional; absent → no extra step rendered.
  readonly e2e_seed_command?: string;
  readonly e2e_projects?: readonly string[];
  // Env applied to the E2E setup step, the (blocking) dev-server step, and the
  // blocking + report-only E2E test steps. Use it to point E2E at a local stack
  // (e.g. E2E_LOCAL=1 + local Supabase coords + a dummy email key), overriding
  // the job-level remote secrets so tests never touch production.
  readonly e2e_env?: Readonly<Record<string, string>>;
  readonly paths_ignore?: readonly string[];
}

function indentEnvBlock(env: Record<string, string>, indent: number): string {
  const pad = ' '.repeat(indent);
  return Object.entries(env)
    .map(([k, v]) => `${pad}${k}: ${v}`)
    .join('\n');
}

/**
 * Build the optional pre-E2E setup step (foreground, blocking) injected before
 * the dev server starts. Renders only when e2e_setup_command is set, so existing
 * projects regenerate an identical ci.yml. Carries e2e_env so the setup command
 * (e.g. `supabase start` + schema load + seed) sees the local-stack coords.
 * A multi-line command is emitted as a `run: |` block scalar.
 */
function buildE2eSetupStep(cfg: SdlcConfig): string {
  const cmd = (cfg.e2e_setup_command ?? '').trim();
  if (!cmd) return '';
  const env = cfg.e2e_env ?? {};
  const lines = ['      - name: E2E setup'];
  if (Object.keys(env).length > 0) lines.push('        env:', indentEnvBlock({ ...env }, 10));
  if (cmd.includes('\n')) {
    lines.push('        run: |');
    for (const l of cmd.split('\n')) lines.push(`          ${l}`);
  } else {
    lines.push(`        run: ${cmd}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Build the blocking "Start dev server" step. Rebuilt in code (rather than left
 * inline in the template) so e2e_env can be threaded onto the dev-server process
 * — overriding the job-level remote secrets so the server talks to the local
 * stack. With no e2e_env the output is identical to the previous inline step.
 */
function buildE2eDevServerStep(cfg: SdlcConfig): string {
  const env = cfg.e2e_env ?? {};
  const lines = ['      - name: Start dev server'];
  if (Object.keys(env).length > 0) lines.push('        env:', indentEnvBlock({ ...env }, 10));
  lines.push(`        run: ${cfg.e2e_start_command} &`);
  return lines.join('\n');
}

/**
 * Build the blocking "E2E Tests" step. Rebuilt in code so e2e_env can be threaded
 * onto the Playwright process (specs read it to reach the local stack directly).
 * With no e2e_env the output is identical to the previous inline step, comment
 * and all.
 */
function buildE2eTestStep(cfg: SdlcConfig): string {
  const env = cfg.e2e_env ?? {};
  const lines = [
    '      - name: E2E Tests',
    '        env:',
    '          # PLAYWRIGHT_JSON_OUTPUT_NAME makes the json reporter write straight',
    '          # to the file. Capturing stdout (`> e2e-results.json`) instead mixed',
    '          # the html reporter\'s "To open report" line in after the JSON blob',
    '          # and produced an unparseable file (DevAudit #48). html report still',
    '          # lands in playwright-report/.',
    '          PLAYWRIGHT_HTML_REPORTER_OPEN: never',
    '          PLAYWRIGHT_JSON_OUTPUT_NAME: e2e-results.json',
  ];
  if (Object.keys(env).length > 0) lines.push(indentEnvBlock({ ...env }, 10));
  lines.push(`        run: npx playwright test --project=${cfg.e2e_project} --reporter=json,html`);
  return lines.join('\n');
}

/**
 * Build the optional "authenticated e2e" steps injected after the blocking
 * smoke e2e gate. Report-only by design (continue-on-error): authenticated
 * flows (auth-setup + seeded fixtures) are flakier than smoke, so failures
 * surface as evidence without blocking the merge until proven stable. Renders
 * empty (no step) unless the consumer configures e2e_projects and/or
 * e2e_seed_command — so existing projects regenerate to an identical ci.yml.
 */
function buildAuthenticatedE2eStep(cfg: SdlcConfig): string {
  const projects = cfg.e2e_projects ?? [];
  const seed = (cfg.e2e_seed_command ?? '').trim();
  if (projects.length === 0 && !seed) return '';
  const env = cfg.e2e_env ?? {};
  const envBlock = Object.keys(env).length > 0 ? indentEnvBlock({ ...env }, 10) : '';
  const lines: string[] = [];
  if (seed) {
    lines.push(
      '',
      '      - name: Seed E2E test data (report-only)',
      '        if: always()',
      '        continue-on-error: true',
    );
    if (envBlock) lines.push('        env:', envBlock);
    lines.push(`        run: ${seed}`);
  }
  if (projects.length > 0) {
    const flags = projects.map((p) => `--project=${p}`).join(' ');
    lines.push(
      '',
      '      - name: Authenticated E2E (report-only)',
      '        if: always()',
      '        continue-on-error: true',
      '        env:',
      '          PLAYWRIGHT_HTML_REPORTER_OPEN: never',
      '          PLAYWRIGHT_JSON_OUTPUT_NAME: e2e-auth-results.json',
    );
    if (envBlock) lines.push(envBlock);
    lines.push(`        run: npx playwright test ${flags} --reporter=json,html`);
  }
  return lines.join('\n');
}

function buildDbUriStep(dbService: string, dbPort: string): string {
  if (dbService !== 'mongodb') return '';
  return [
    '      - name: Set database URI from dynamic port',
    '        run: |',
    `          DB_PORT="\${{ job.services.${dbService}.ports['${dbPort}'] }}"`,
    '          echo "MONGODB_WAWAGARDENBAR_APP_URI=mongodb://localhost:${DB_PORT}" >> "$GITHUB_ENV"',
    '          echo "Database on port: ${DB_PORT}"',
  ].join('\n');
}

/**
 * Section 2f: Generate CI workflows from templates + sdlc-config.json.
 *
 * Skipped if the consumer has no sdlc-config.json or no .github/workflows/.
 */
export async function syncCiTemplates(ctx: SyncContext): Promise<SectionResult> {
  const configPath = join(ctx.projectPath, 'sdlc-config.json');
  const workflowsDir = join(ctx.projectPath, '.github', 'workflows');
  if (!(await exists(configPath))) {
    return { name: 'CI workflows', filesSynced: 0, skipped: true, message: 'no sdlc-config.json' };
  }
  if (!(await isDir(workflowsDir))) {
    return { name: 'CI workflows', filesSynced: 0, skipped: true, message: '.github/workflows/ not found' };
  }
  await ensureDir(workflowsDir);
  const cfg = JSON.parse(await fs.readFile(configPath, 'utf-8')) as SdlcConfig;
  for (const oldName of OLD_WORKFLOWS_TO_REMOVE) {
    const oldPath = join(workflowsDir, oldName);
    if (await exists(oldPath)) await fs.rm(oldPath);
  }
  const workingDirectory = cfg.working_directory && cfg.working_directory !== '.' ? cfg.working_directory : '';
  const workingDirPrefix = workingDirectory ? `${workingDirectory.replace(/\/$/, '')}/` : '';
  const tokens: Record<string, string> = {
    PROJECT_SLUG: cfg.project_slug,
    PRODUCTION_URL_SECRET: cfg.production_url_secret,
    NODE_VERSION: String(cfg.node_version ?? ''),
    PYTHON_VERSION: String(cfg.python_version ?? ''),
    WORKING_DIRECTORY: workingDirectory || '.',
    WORKING_DIR_PREFIX: workingDirPrefix,
    RUNNER: cfg.runner,
    SOURCE_DIRS: cfg.source_dirs,
    SAST_BASELINE: String(cfg.sast_baseline),
    ACCEPTED_DEP_RISKS: cfg.accepted_dep_risks,
    DATABASE_SERVICE: cfg.database_service,
    DATABASE_IMAGE: cfg.database_image,
    DATABASE_PORT: cfg.database_port,
    E2E_PROJECT: cfg.e2e_project,
    E2E_START_COMMAND: cfg.e2e_start_command,
  };
  const pathsIgnoreBlock = (cfg.paths_ignore ?? []).map((p) => `      - '${p}'`).join('\n');
  const blocks: Record<string, string> = {
    PATHS_IGNORE: pathsIgnoreBlock,
    DATABASE_ENV: cfg.database_env ? indentEnvBlock({ ...cfg.database_env }, 6) : '',
    APP_ENV: cfg.app_env ? indentEnvBlock({ ...cfg.app_env }, 6) : '',
    BUILD_ENV: cfg.build_env ? indentEnvBlock({ ...cfg.build_env }, 10) : '',
    DATABASE_URI_STEP: buildDbUriStep(cfg.database_service, cfg.database_port),
    E2E_SETUP_STEP: buildE2eSetupStep(cfg),
    E2E_DEV_SERVER_STEP: buildE2eDevServerStep(cfg),
    E2E_TEST_STEP: buildE2eTestStep(cfg),
    E2E_AUTHENTICATED_STEP: buildAuthenticatedE2eStep(cfg),
  };
  let count = 0;
  for (const tmpl of CI_TEMPLATES) {
    const stackTmpl = join(ctx.installerRoot, 'sdlc', 'files', 'ci', ctx.stack, tmpl);
    const defaultTmpl = join(ctx.installerRoot, 'sdlc', 'files', 'ci', tmpl);
    let tmplPath: string;
    if (await exists(stackTmpl)) {
      tmplPath = stackTmpl;
    } else if (await exists(defaultTmpl)) {
      tmplPath = defaultTmpl;
    } else {
      continue;
    }
    const outputName = tmpl.replace(/\.template$/, '');
    const outputPath = join(workflowsDir, outputName);
    let content = await fs.readFile(tmplPath, 'utf-8');
    content = substituteTokens(content, tokens);
    content = substituteBlocks(content, blocks);
    if (!cfg.database_service) {
      content = stripServicesBlock(content);
    }
    await fs.writeFile(outputPath, content);
    count += 1;
  }
  return { name: 'CI workflows', filesSynced: count, message: `${count} generated` };
}
