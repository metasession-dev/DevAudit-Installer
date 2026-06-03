import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { readSdlcConfig } from '../lib/sdlc-config.js';
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
  if (ctx.installMode === 'developer') {
    return {
      step: '4/11 Write sdlc-config.json',
      status: 'skipped',
      message:
        'developer mode — leaving sdlc-config.json untouched (the team config is already on disk from the project operator). Use --force-team-config if you need to refresh wizard-owned fields.',
    };
  }
  const runtimeKey = plan.stack === 'node' ? 'node_version' : 'python_version';
  const pathsIgnore = plan.stack === 'node' ? NODE_PATHS_IGNORE : PYTHON_PATHS_IGNORE;
  const existing = ((await readSdlcConfig(ctx.projectPath)) as Record<string, unknown> | null) ?? null;
  const defaultedIfNew: Record<string, unknown> = {
    runner: 'ubuntu-latest',
    integration_branch: 'develop',
    release_branch: 'main',
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
    e2e_setup_command: '',
    e2e_seed_command: '',
    e2e_projects: [],
    e2e_env: {},
    paths_ignore: pathsIgnore,
    uat: { enabled: false, url: '', required_risk_classes: ['payment', 'destructive_migration', 'realtime'] },
    approval: { mode: 'dual_actor', auto_low_risk_threshold: 'LOW' },
    production_review: { enabled: true, terminal_status: 'prod_review' },
  };
  const wizardOwned: Record<string, unknown> = {
    stack: plan.stack,
    host: plan.host,
    project_slug: plan.projectSlug,
    production_url_secret: plan.prodUrlSecretName,
    [runtimeKey]: plan.runtimeVersion,
    working_directory: plan.workingDirectory,
    source_dirs: plan.sourceDirs,
    devaudit: {
      base_url: ctx.baseUrl,
      project_slug: plan.projectSlug,
      api_key_secret: 'DEVAUDIT_API_KEY',
    },
  };
  // Existing values override the "defaultedIfNew" defaults (preserves customizations
  // like sast_baseline, accepted_dep_risks, database_*, app_env, build_env, etc.);
  // wizardOwned always wins (stack/host/slug/runtime/source_dirs/working_directory/
  // production_url_secret/devaudit block come from the current install plan).
  const config: Record<string, unknown> = {
    ...defaultedIfNew,
    ...(existing ?? {}),
    ...wizardOwned,
  };
  const outPath = join(ctx.projectPath, 'sdlc-config.json');
  if (ctx.dryRun) {
    const preserved = existing
      ? `preserves existing customizations (${Object.keys(existing).filter((k) => !(k in wizardOwned)).length} non-wizard fields)`
      : 'fresh config';
    return {
      step: '4/11 Write sdlc-config.json',
      status: 'planned',
      message: `would write ${outPath} (stack=${plan.stack}, slug=${plan.projectSlug}) — ${preserved}`,
    };
  }
  await fs.writeFile(outPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return { step: '4/11 Write sdlc-config.json', status: 'ok', message: `wrote ${outPath}` };
}
