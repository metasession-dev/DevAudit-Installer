import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import type { GitProvider } from '../lib/git-provider/index.js';
import type { InstallContext, StepResult } from './types.js';

const REQUIRED_CHECKS: readonly string[] = [
  'Compliance Validation',
  'DevAudit Release Approval',
  'Quality Gates',
];

const MAIN_REVIEW_COUNT = 1;
const DEVELOP_REVIEW_COUNT = 0;

async function resolveIntegrationBranch(projectPath: string): Promise<string> {
  try {
    const raw = await fs.readFile(join(projectPath, 'sdlc-config.json'), 'utf-8');
    const config = JSON.parse(raw) as { readonly integration_branch?: string };
    return config.integration_branch ?? 'develop';
  } catch {
    return 'develop';
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
  const integrationBranch = await resolveIntegrationBranch(ctx.projectPath);
  if (ctx.dryRun) {
    return {
      step: '9/11 Configure branch protection',
      status: 'planned',
      message: `would apply branch protection on ${repo}:${meta.defaultBranch} (1 review) + ${integrationBranch} (0 reviews) with checks=${JSON.stringify(REQUIRED_CHECKS)}`,
    };
  }
  const results: string[] = [];
  const mainResult = await provider.applyBranchProtection(ctx.projectPath, meta.defaultBranch, REQUIRED_CHECKS, { requiredReviewCount: MAIN_REVIEW_COUNT });
  if (mainResult.applied) {
    results.push(`${meta.defaultBranch}: ok (${MAIN_REVIEW_COUNT} review)`);
  } else {
    results.push(`${meta.defaultBranch}: FAILED — ${mainResult.message ?? 'unknown'}`);
  }
  if (integrationBranch !== meta.defaultBranch) {
    const devResult = await provider.applyBranchProtection(ctx.projectPath, integrationBranch, REQUIRED_CHECKS, { requiredReviewCount: DEVELOP_REVIEW_COUNT });
    if (devResult.applied) {
      results.push(`${integrationBranch}: ok (${DEVELOP_REVIEW_COUNT} reviews)`);
    } else {
      results.push(`${integrationBranch}: FAILED — ${devResult.message ?? 'unknown'}`);
    }
  }
  const allOk = results.every((r) => r.includes(': ok'));
  return {
    step: '9/11 Configure branch protection',
    status: allOk ? 'ok' : 'warn',
    message: allOk ? results.join(' | ') : `${results.join(' | ')} — configure manually`,
  };
}
