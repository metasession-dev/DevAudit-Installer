import { resolve } from 'node:path';
import { readSdlcConfig, checkFrameworkFiles } from '../lib/sdlc-config.js';
import { logger } from '../lib/logger.js';

const FRAMEWORK_FILES = [
  'INSTRUCTIONS.md',
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
  log.info(`Inspecting ${projectPath}`);
  const config = await readSdlcConfig(projectPath);
  if (!config) {
    log.warn('No sdlc-config.json found here. This project is not onboarded to DevAudit.');
    log.info('Run `devaudit install` (once implemented) or `./scripts/sdlc-onboard.sh` to onboard.');
    process.exit(7);
  }
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
  const files = await checkFrameworkFiles(projectPath, FRAMEWORK_FILES);
  let missingCount = 0;
  for (const f of files) {
    const marker = f.present ? '✓' : '✗';
    if (!f.present) missingCount++;
    log.log(`  ${marker} ${f.path}`);
  }
  log.log('');
  if (missingCount === 0) {
    log.success('All checked framework files are present.');
  } else {
    log.warn(`${missingCount} framework file(s) missing. Re-sync via DevAudit-Installer's sync-sdlc.sh to refresh.`);
  }
}
