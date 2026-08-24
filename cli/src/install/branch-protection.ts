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

async function resolveConfig(repoRoot: string): Promise<SdlcConfig | null> {
  try {
    // sdlc-config.json lives at the repo root (#689 follow-up), not this
    // target's own directory — see write-config.ts for why.
    return await readSdlcConfig(repoRoot);
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
      step: '10/12 Configure branch protection',
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
      step: '10/12 Configure branch protection',
      status: 'warn',
      message: `could not resolve git repo (${(err as Error).message}) — configure manually`,
    };
  }
  const repo = `${meta.owner}/${meta.name}`;
  const config = await resolveConfig(ctx.repoRoot);
  const integrationBranch = config?.integration_branch ?? 'develop';
  // The release branch is config-owned, not GitHub's reported default —
  // devaudit#731: default branch was never repointed to develop by install,
  // so this used to accidentally work only because GitHub's default always
  // happened to equal 'main'. Now that install can set the default branch to
  // integration_branch, using meta.defaultBranch here would apply the strict
  // main-only protection rules to develop instead, and skip protecting main
  // entirely (the integrationBranch !== releaseBranch guard below would go
  // false).
  const releaseBranch = config?.release_branch ?? 'main';
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
      step: '10/12 Configure branch protection',
      status: 'planned',
      message: `would apply branch protection on ${repo}:${releaseBranch} (1 review) + ${integrationBranch} (0 reviews) — ${checksSummary}`,
    };
  }
  const results: string[] = [];
  for (const target of targets) {
    // eslint-disable-next-line no-await-in-loop
    const mainResult = await provider.applyBranchProtection(
      ctx.projectPath,
      releaseBranch,
      namespacedRequiredChecks(MAIN_REQUIRED_CHECKS, target.name, multiTarget),
      { requiredReviewCount: MAIN_REVIEW_COUNT },
    );
    const mainLabel = `${releaseBranch}${multiTarget ? ` (${target.name})` : ''}`;
    if (mainResult.applied) {
      results.push(`${mainLabel}: ok (${MAIN_REVIEW_COUNT} review)`);
    } else {
      results.push(`${mainLabel}: FAILED — ${mainResult.message ?? 'unknown'}`);
    }
    if (integrationBranch !== releaseBranch) {
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
    step: '10/12 Configure branch protection',
    status: allOk ? 'ok' : 'warn',
    message: allOk ? results.join(' | ') : `${results.join(' | ')} — configure manually`,
  };
}
