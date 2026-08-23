import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { getGitProvider } from '../lib/git-provider/index.js';
import { readSdlcConfig, resolveTargets } from '../lib/sdlc-config.js';
import type { SyncContext, SectionResult } from './types.js';
import {
  MAIN_REQUIRED_CHECKS,
  DEVELOP_REQUIRED_CHECKS,
  MAIN_REVIEW_COUNT,
  DEVELOP_REVIEW_COUNT,
  namespacedRequiredChecks,
} from '../lib/branch-protection-checks.js';

/**
 * Section 2j: Verify and re-apply branch protection.
 *
 * On every `devaudit update`, check that branch protection is still
 * configured on both the release branch (main) and the integration
 * branch (develop). If missing or the provider is unavailable, report
 * a warning — don't fail the sync.
 */
export async function verifyBranchProtection(ctx: SyncContext): Promise<SectionResult> {
  // sdlc-config.json lives at the repo root (#689 follow-up), not this
  // target's own directory — see write-config.ts for why.
  const config = await readSdlcConfig(ctx.repoRoot);
  const integrationBranch = config?.integration_branch ?? 'develop';
  const releaseBranch = config?.release_branch ?? 'main';
  let provider;
  try {
    provider = await getGitProvider(ctx.projectPath);
  } catch (err) {
    return {
      name: 'Branch protection',
      filesSynced: 0,
      warning: `git provider unavailable (${(err as Error).message}) — verify manually`,
    };
  }
  let meta;
  try {
    meta = await provider.getRepoMeta(ctx.projectPath);
  } catch (err) {
    return {
      name: 'Branch protection',
      filesSynced: 0,
      warning: `could not resolve repo (${(err as Error).message}) — verify manually`,
    };
  }
  const results: string[] = [];
  // Multi-target (#689/#696): apply once per target with that target's
  // namespaced check name (mirroring the CI workflow job-name suffix from
  // #692), so branch protection actually requires what each target's
  // workflow reports. GitHubProvider.applyBranchProtection unions rather
  // than replaces (#695), so looping here is additive across targets/calls.
  const targets = resolveTargets(config ?? { project_slug: '' });
  const multiTarget = targets.length > 1;
  for (const target of targets) {
    // eslint-disable-next-line no-await-in-loop
    const mainResult = await provider.applyBranchProtection(
      ctx.projectPath,
      meta.defaultBranch,
      namespacedRequiredChecks(MAIN_REQUIRED_CHECKS, target.name, multiTarget),
      { requiredReviewCount: MAIN_REVIEW_COUNT },
    );
    if (mainResult.applied) {
      results.push(`${meta.defaultBranch}${multiTarget ? ` (${target.name})` : ''}: ok`);
    } else {
      results.push(`${meta.defaultBranch}${multiTarget ? ` (${target.name})` : ''}: failed — ${mainResult.message ?? 'unknown'}`);
    }
    if (integrationBranch !== meta.defaultBranch) {
      // eslint-disable-next-line no-await-in-loop
      const devResult = await provider.applyBranchProtection(
        ctx.projectPath,
        integrationBranch,
        namespacedRequiredChecks(DEVELOP_REQUIRED_CHECKS, target.name, multiTarget),
        { requiredReviewCount: DEVELOP_REVIEW_COUNT },
      );
      if (devResult.applied) {
        results.push(`${integrationBranch}${multiTarget ? ` (${target.name})` : ''}: ok`);
      } else {
        results.push(`${integrationBranch}${multiTarget ? ` (${target.name})` : ''}: failed — ${devResult.message ?? 'unknown'}`);
      }
    }
  }
  const allOk = results.every((r) => r.endsWith(': ok'));
  return {
    name: 'Branch protection',
    filesSynced: 0,
    message: results.join(' | '),
    warning: allOk ? undefined : 'some branches failed — verify manually',
  };
}
