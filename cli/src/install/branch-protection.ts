import type { GitProvider } from '../lib/git-provider/index.js';
import type { InstallContext, StepResult } from './types.js';
import { readSdlcConfig, resolveTargets, type SdlcConfig, type Target } from '../lib/sdlc-config.js';
import {
  MAIN_REQUIRED_CHECKS,
  DEVELOP_REQUIRED_CHECKS,
  MAIN_REVIEW_COUNT,
  DEVELOP_REVIEW_COUNT,
  namespacedRequiredChecks,
} from '../lib/branch-protection-checks.js';

async function resolveConfig(projectPath: string): Promise<SdlcConfig | null> {
  try {
    return await readSdlcConfig(projectPath);
  } catch {
    return null;
  }
}

export async function configureBranchProtection(
  ctx: InstallContext,
  provider: GitProvider,
): Promise<StepResult> {
  if (ctx.installMode === 'developer') {
    return {
      step: '9/11 Configure branch protection',
      status: 'skipped',
      message:
        'developer mode — leaving branch protection unchanged. Use --force-team-config to re-apply as the project operator.',
    };
  }
  let meta;
  try {
    meta = await provider.getRepoMeta(ctx.projectPath);
  } catch (err) {
    return {
      step: '9/11 Configure branch protection',
      status: 'warn',
      message: `could not resolve git repo (${(err as Error).message}) — configure manually`,
    };
  }
  const repo = `${meta.owner}/${meta.name}`;
  const config = await resolveConfig(ctx.projectPath);
  const integrationBranch = config?.integration_branch ?? 'develop';
  // Multi-target (#689/#696): apply once per target with that target's
  // namespaced check name (mirroring the CI workflow job-name suffix from
  // #692). GitHubProvider.applyBranchProtection unions rather than replaces
  // (#695), so looping here is additive across targets. No-op for the
  // single-target case — same single call, same 'Quality Gates' check, as
  // before.
  const targets: readonly Target[] = resolveTargets(config ?? { project_slug: '' });
  const multiTarget = targets.length > 1;
  if (ctx.dryRun) {
    const checksSummary = targets
      .map(
        (t) =>
          `${t.name}: main=${JSON.stringify(namespacedRequiredChecks(MAIN_REQUIRED_CHECKS, t.name, multiTarget))} ${integrationBranch}=${JSON.stringify(namespacedRequiredChecks(DEVELOP_REQUIRED_CHECKS, t.name, multiTarget))}`,
      )
      .join(' | ');
    return {
      step: '9/11 Configure branch protection',
      status: 'planned',
      message: `would apply branch protection on ${repo}:${meta.defaultBranch} (1 review) + ${integrationBranch} (0 reviews) — ${checksSummary}`,
    };
  }
  const results: string[] = [];
  for (const target of targets) {
    // eslint-disable-next-line no-await-in-loop
    const mainResult = await provider.applyBranchProtection(
      ctx.projectPath,
      meta.defaultBranch,
      namespacedRequiredChecks(MAIN_REQUIRED_CHECKS, target.name, multiTarget),
      { requiredReviewCount: MAIN_REVIEW_COUNT },
    );
    const mainLabel = `${meta.defaultBranch}${multiTarget ? ` (${target.name})` : ''}`;
    if (mainResult.applied) {
      results.push(`${mainLabel}: ok (${MAIN_REVIEW_COUNT} review)`);
    } else {
      results.push(`${mainLabel}: FAILED — ${mainResult.message ?? 'unknown'}`);
    }
    if (integrationBranch !== meta.defaultBranch) {
      // eslint-disable-next-line no-await-in-loop
      const devResult = await provider.applyBranchProtection(
        ctx.projectPath,
        integrationBranch,
        namespacedRequiredChecks(DEVELOP_REQUIRED_CHECKS, target.name, multiTarget),
        { requiredReviewCount: DEVELOP_REVIEW_COUNT },
      );
      const devLabel = `${integrationBranch}${multiTarget ? ` (${target.name})` : ''}`;
      if (devResult.applied) {
        results.push(`${devLabel}: ok (${DEVELOP_REVIEW_COUNT} reviews)`);
      } else {
        results.push(`${devLabel}: FAILED — ${devResult.message ?? 'unknown'}`);
      }
    }
  }
  const allOk = results.every((r) => r.includes(': ok'));
  return {
    step: '9/11 Configure branch protection',
    status: allOk ? 'ok' : 'warn',
    message: allOk ? results.join(' | ') : `${results.join(' | ')} — configure manually`,
  };
}
