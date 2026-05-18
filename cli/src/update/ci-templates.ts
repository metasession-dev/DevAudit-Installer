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
  readonly paths_ignore?: readonly string[];
}

function indentEnvBlock(env: Record<string, string>, indent: number): string {
  const pad = ' '.repeat(indent);
  return Object.entries(env)
    .map(([k, v]) => `${pad}${k}: ${v}`)
    .join('\n');
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
