import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { getGitProvider } from '../lib/git-provider/index.js';
import { readSdlcConfig } from '../lib/sdlc-config.js';
import type { SyncContext, SectionResult } from './types.js';

const REQUIRED_CHECKS: readonly string[] = [
  'Compliance Validation',
  'DevAudit Release Approval',
  'Quality Gates',
];

const MAIN_REVIEW_COUNT = 1;
const DEVELOP_REVIEW_COUNT = 0;

/**
 * Section 2j: Verify and re-apply branch protection.
 *
 * On every `devaudit update`, check that branch protection is still
 * configured on both the release branch (main) and the integration
 * branch (develop). If missing or the provider is unavailable, report
 * a warning — don't fail the sync.
 */
export async function verifyBranchProtection(ctx: SyncContext): Promise<SectionResult> {
  const config = await readSdlcConfig(ctx.projectPath);
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
  const mainResult = await provider.applyBranchProtection(ctx.projectPath, meta.defaultBranch, REQUIRED_CHECKS, { requiredReviewCount: MAIN_REVIEW_COUNT });
  if (mainResult.applied) {
    results.push(`${meta.defaultBranch}: ok`);
  } else {
    results.push(`${meta.defaultBranch}: failed — ${mainResult.message ?? 'unknown'}`);
  }
  if (integrationBranch !== meta.defaultBranch) {
    const devResult = await provider.applyBranchProtection(ctx.projectPath, integrationBranch, REQUIRED_CHECKS, { requiredReviewCount: DEVELOP_REVIEW_COUNT });
    if (devResult.applied) {
      results.push(`${integrationBranch}: ok`);
    } else {
      results.push(`${integrationBranch}: failed — ${devResult.message ?? 'unknown'}`);
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
