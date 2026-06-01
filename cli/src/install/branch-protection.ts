import type { GitProvider } from '../lib/git-provider/index.js';
import type { InstallContext, StepResult } from './types.js';

const REQUIRED_CHECKS: readonly string[] = [
  'Compliance Validation',
  'DevAudit Release Approval',
  'Quality Gates',
];

export async function configureBranchProtection(
  ctx: InstallContext,
  provider: GitProvider,
): Promise<StepResult> {
  if (ctx.installMode === 'developer') {
    return {
      step: '9/12 Configure branch protection',
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
      step: '9/12 Configure branch protection',
      status: 'warn',
      message: `could not resolve git repo (${(err as Error).message}) — configure manually`,
    };
  }
  const repo = `${meta.owner}/${meta.name}`;
  if (ctx.dryRun) {
    return {
      step: '9/12 Configure branch protection',
      status: 'planned',
      message: `would apply branch protection on ${repo}:${meta.defaultBranch} with checks=${JSON.stringify(REQUIRED_CHECKS)}`,
    };
  }
  const result = await provider.applyBranchProtection(ctx.projectPath, meta.defaultBranch, REQUIRED_CHECKS);
  if (result.applied) {
    return {
      step: '9/12 Configure branch protection',
      status: 'ok',
      message: `required checks on ${meta.defaultBranch}: ${REQUIRED_CHECKS.join(', ')}`,
    };
  }
  return {
    step: '9/12 Configure branch protection',
    status: 'warn',
    message: `${result.message ?? 'branch-protection apply failed'} — configure manually`,
  };
}
