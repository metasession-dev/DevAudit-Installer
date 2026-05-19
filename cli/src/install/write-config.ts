import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { InstallContext, InstallPlan, StepResult } from './types.js';

const NODE_PATHS_IGNORE: readonly string[] = [
  'SDLC/**',
  'compliance/**',
  '*.md',
  '.cursorrules',
  '.windsurfrules',
  'sdlc-config.json',
  'scripts/upload-evidence.sh',
  'scripts/validate-compliance-artifacts.sh',
  'scripts/validate-commits.sh',
  'scripts/check-requirement-jsdoc.sh',
];

const PYTHON_PATHS_IGNORE: readonly string[] = [
  'SDLC/**',
  'compliance/**',
  '*.md',
  '.cursorrules',
  '.windsurfrules',
  'sdlc-config.json',
];

export async function writeSdlcConfig(ctx: InstallContext, plan: InstallPlan): Promise<StepResult> {
  const runtimeKey = plan.stack === 'node' ? 'node_version' : 'python_version';
  const pathsIgnore = plan.stack === 'node' ? NODE_PATHS_IGNORE : PYTHON_PATHS_IGNORE;
  const config = {
    stack: plan.stack,
    host: plan.host,
    project_slug: plan.projectSlug,
    production_url_secret: plan.prodUrlSecretName,
    [runtimeKey]: plan.runtimeVersion,
    runner: 'ubuntu-latest',
    working_directory: plan.workingDirectory,
    source_dirs: plan.sourceDirs,
    sast_baseline: 0,
    accepted_dep_risks: '',
    database_service: '',
    database_image: '',
    database_port: '',
    database_env: {},
    app_env: {},
    build_env: {},
    e2e_project: '',
    e2e_start_command: '',
    paths_ignore: pathsIgnore,
    devaudit: {
      base_url: ctx.baseUrl,
      project_slug: plan.projectSlug,
      api_key_secret: 'DEVAUDIT_API_KEY',
    },
    uat: { enabled: false, url: '', required_risk_classes: ['payment', 'destructive_migration', 'realtime'] },
    approval: { mode: 'dual_actor', auto_low_risk_threshold: 'LOW' },
    production_review: { enabled: true, terminal_status: 'prod_review' },
  };
  const outPath = join(ctx.projectPath, 'sdlc-config.json');
  if (ctx.dryRun) {
    return {
      step: '4/11 Write sdlc-config.json',
      status: 'planned',
      message: `would write ${outPath} (stack=${plan.stack}, slug=${plan.projectSlug})`,
    };
  }
  await fs.writeFile(outPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return { step: '4/11 Write sdlc-config.json', status: 'ok', message: `wrote ${outPath}` };
}
