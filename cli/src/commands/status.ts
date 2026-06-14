import { resolve } from 'node:path';
import { readSdlcConfig, checkFrameworkFiles } from '../lib/sdlc-config.js';
import { emitJsonResult, isJsonMode, logger } from '../lib/logger.js';

const FRAMEWORK_FILES = [
  'INSTRUCTIONS.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
  '.windsurfrules',
  'GEMINI.md',
  'SDLC/0-project-setup.md',
  'SDLC/5-deploy-main.md',
  'scripts/upload-evidence.sh',
  'compliance/RTM.md',
  '.github/workflows/ci.yml',
];

interface StatusOptions {
  readonly path?: string;
}

export async function runStatus(options: StatusOptions): Promise<void> {
  const log = logger();
  const projectPath = resolve(options.path ?? process.cwd());
  const config = await readSdlcConfig(projectPath);
  if (!config) {
    if (isJsonMode()) {
      emitJsonResult({ ok: false, reason: 'not_onboarded', projectPath });
    } else {
      log.info(`Inspecting ${projectPath}`);
      log.warn('No sdlc-config.json found here. This project is not onboarded to DevAudit.');
      log.info('Run `devaudit install` to onboard.');
    }
    process.exit(7);
    return;
  }
  const files = await checkFrameworkFiles(projectPath, FRAMEWORK_FILES);
  const presentFiles = files.filter((f) => f.present).map((f) => f.path);
  const missingFiles = files.filter((f) => !f.present).map((f) => f.path);
  if (isJsonMode()) {
    emitJsonResult({
      ok: true,
      projectPath,
      project_slug: config.project_slug,
      stack: config.stack ?? null,
      host: config.host ?? null,
      node_version: config.node_version ?? null,
      python_version: config.python_version ?? null,
      working_directory: config.working_directory ?? null,
      source_dirs: config.source_dirs ?? null,
      devaudit_base_url: config.devaudit?.base_url ?? null,
      uat_enabled: config.uat?.enabled ?? false,
      approval_mode: config.approval?.mode ?? null,
      files_present: presentFiles,
      files_missing: missingFiles,
    });
    return;
  }
  log.info(`Inspecting ${projectPath}`);
  log.success('sdlc-config.json found.');
  log.log('');
  log.log(`  Project slug:   ${config.project_slug}`);
  log.log(`  Stack:          ${config.stack ?? '(unset)'}`);
  log.log(`  Host:           ${config.host ?? '(unset)'}`);
  if (config.node_version) log.log(`  Node version:   ${config.node_version}`);
  if (config.python_version) log.log(`  Python version: ${config.python_version}`);
  if (config.working_directory) log.log(`  Working dir:    ${config.working_directory}`);
  if (config.source_dirs) log.log(`  Source dirs:    ${config.source_dirs}`);
  log.log(`  DevAudit URL:   ${config.devaudit?.base_url ?? '(unset)'}`);
  log.log(`  UAT enabled:    ${config.uat?.enabled ?? false}`);
  log.log(`  Approval mode:  ${config.approval?.mode ?? '(unset)'}`);
  log.log('');
  log.info('Framework files present?');
  for (const f of files) {
    const marker = f.present ? '✓' : '✗';
    log.log(`  ${marker} ${f.path}`);
  }
  log.log('');
  if (missingFiles.length === 0) {
    log.success('All checked framework files are present.');
  } else {
    log.warn(`${missingFiles.length} framework file(s) missing. Re-sync with \`devaudit update <version> <path>\` to refresh.`);
  }
}
