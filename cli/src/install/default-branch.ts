import type { GitProvider } from '../lib/git-provider/index.js';
import type { InstallContext, StepResult } from './types.js';
import { readSdlcConfig } from '../lib/sdlc-config.js';

/**
 * Set the consumer repo's GitHub-reported default branch to
 * `integration_branch` (default `'develop'`). GitHub creates every repo with
 * `main` as default; without this, a contributor using GitHub's own UI
 * (new-branch dropdown, "Compare & pull request" banner, fresh-clone
 * checkout) lands on `main` instead — silently skipping the real Quality
 * Gates workflow, which only triggers on PRs to the integration branch. See
 * devaudit#731 (found onboarding metasession-dev/META-AGENT).
 */
export async function configureDefaultBranch(
  ctx: InstallContext,
  provider: GitProvider,
): Promise<StepResult> {
  const STEP = '9/12 Set default branch';
  if (ctx.installMode === 'developer') {
    return {
      step: STEP,
      status: 'skipped',
      message:
        'developer mode — leaving default branch unchanged. Use --force-team-config to re-apply as the project operator.',
    };
  }
  let meta;
  try {
    meta = await provider.getRepoMeta(ctx.projectPath);
  } catch (err) {
    return {
      step: STEP,
      status: 'warn',
      message: `could not resolve git repo (${(err as Error).message}) — set default branch manually`,
    };
  }
  const config = await readSdlcConfig(ctx.repoRoot).catch(() => null);
  const integrationBranch = config?.integration_branch ?? 'develop';
  if (ctx.dryRun) {
    return {
      step: STEP,
      status: 'planned',
      message: `would set default branch to ${integrationBranch} (currently ${meta.defaultBranch})`,
    };
  }
  const result = await provider.setDefaultBranch(ctx.projectPath, integrationBranch);
  if (!result.changed) {
    if (result.message) {
      return { step: STEP, status: 'warn', message: `FAILED — ${result.message}` };
    }
    return { step: STEP, status: 'ok', message: `already ${integrationBranch}` };
  }
  return { step: STEP, status: 'ok', message: `${meta.defaultBranch} -> ${integrationBranch}` };
}
