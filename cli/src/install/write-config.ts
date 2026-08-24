import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { readSdlcConfig, resolveTargets, type Target } from '../lib/sdlc-config.js';
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
      step: '4/12 Write sdlc-config.json',
      status: 'skipped',
      message:
        'developer mode — leaving sdlc-config.json untouched (the team config is already on disk from the project operator). Use --force-team-config if you need to refresh wizard-owned fields.',
    };
  }
  const runtimeKey = plan.stack === 'node' ? 'node_version' : 'python_version';
  const pathsIgnore = plan.stack === 'node' ? NODE_PATHS_IGNORE : PYTHON_PATHS_IGNORE;
  // sdlc-config.json always lives at the repo root (#689 follow-up) — never
  // a target's own directory. A single-target repo installed from its own
  // root has repoRoot === projectPath, so this is a no-op there; for a
  // polyglot-monorepo target in a subdirectory, this is what lets
  // --add-target find (and append to) the first target's config instead of
  // looking in its own directory, where nothing was ever written.
  const existing = await readSdlcConfig(ctx.repoRoot);

  // Multi-target (polyglot monorepo) safety — see #689/#691. A config
  // already exists but describes a *different* target (different working
  // directory / project slug) than the one this install run is planning:
  // writing it wholesale would silently clobber the other target's fields.
  // Re-running install against the *same* target (rotation) is unaffected —
  // that's the existing single-target behaviour below.
  let existingTargets: readonly Target[] = [];
  let isNewTarget = false;
  if (existing) {
    existingTargets = resolveTargets(existing);
    // Identity is the working_directory alone: in the non-`--add-target` path
    // (see prompts.ts `planFromConfig`) the plan's project_slug is always
    // inherited from the existing config regardless of which physical
    // directory was detected, so OR-ing it in here would make every rerun
    // look like "the same target" even when the detected stack/directory has
    // actually moved to a different, unconfigured target. See #689/#691.
    isNewTarget = !existingTargets.some((t) => t.working_directory === plan.workingDirectory);
    if (isNewTarget && !ctx.addTarget) {
      return {
        step: '4/12 Write sdlc-config.json',
        status: 'fail',
        message: `sdlc-config.json already configures target(s) [${existingTargets.map((t) => t.name).join(', ')}] for a different working directory/project slug. Re-run with --add-target to add "${plan.projectSlug}" as a new target instead of overwriting.`,
      };
    }
    if (isNewTarget && ctx.addTarget && existingTargets.some((t) => t.name === plan.projectSlug)) {
      return {
        step: '4/12 Write sdlc-config.json',
        status: 'fail',
        message: `A target named "${plan.projectSlug}" already exists in sdlc-config.json. Choose a different project slug for this target.`,
      };
    }
  }

  const defaultedIfNew: Record<string, unknown> = {
    runner: 'self-hosted',
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
      api_key_secret: plan.apiKeySecretName,
    },
  };
  // Existing values override the "defaultedIfNew" defaults (preserves customizations
  // like sast_baseline, accepted_dep_risks, database_*, app_env, build_env, etc.);
  // wizardOwned always wins (stack/host/slug/runtime/source_dirs/working_directory/
  // production_url_secret/devaudit block come from the current install plan).
  const config: Record<string, unknown> = {
    ...defaultedIfNew,
    ...((existing as unknown as Record<string, unknown> | null) ?? {}),
    ...wizardOwned,
  };
  if (isNewTarget && ctx.addTarget) {
    // Keep the other target(s) intact under `targets`; the flat top-level
    // fields above continue to describe *this* (the newest) target, which is
    // what today's still-single-target-aware downstream steps (5-10) act on.
    const newTarget: Target = {
      name: plan.projectSlug,
      stack: plan.stack,
      working_directory: plan.workingDirectory,
      source_dirs: plan.sourceDirs,
      production_url_secret: plan.prodUrlSecretName,
      devaudit: wizardOwned['devaudit'] as Target['devaudit'],
    };
    config['targets'] = [...existingTargets, newTarget];
  }
  const outPath = join(ctx.repoRoot, 'sdlc-config.json');
  if (ctx.dryRun) {
    const preserved = existing
      ? `preserves existing customizations (${Object.keys(existing as unknown as object).filter((k) => !(k in wizardOwned)).length} non-wizard fields)`
      : 'fresh config';
    return {
      step: '4/12 Write sdlc-config.json',
      status: 'planned',
      message: `would write ${outPath} (stack=${plan.stack}, slug=${plan.projectSlug}) — ${preserved}`,
    };
  }
  await fs.writeFile(outPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return { step: '4/12 Write sdlc-config.json', status: 'ok', message: `wrote ${outPath}` };
}
