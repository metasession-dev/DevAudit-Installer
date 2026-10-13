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
 * Section 2k: Verify branch protection and add only what is missing (#990).
 *
 * On every `devaudit update`, check the protection on both the release
 * branch (main) and the integration branch (develop). Missing required
 * checks are added and a review count below DevAudit's minimum is raised;
 * every other setting a maintainer chose (admin enforcement, a higher
 * review count, code-owner reviews, ...) is kept. A branch protected by
 * rulesets gets no classic protection on top. Problems are reported as a
 * warning, never as a sync failure.
 */
export async function verifyBranchProtection(ctx: SyncContext): Promise<SectionResult> {
  if (ctx.dryRun) {
    return { name: 'Branch protection', filesSynced: 0, skipped: true, message: 'skipped in --dry-run (would call the git provider)' };
  }
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
  try {
    // Validates the repo is resolvable via the provider before proceeding —
    // the release branch itself is config-owned (releaseBranch above), not
    // read from this call. See devaudit#731.
    await provider.getRepoMeta(ctx.projectPath);
  } catch (err) {
    return {
      name: 'Branch protection',
      filesSynced: 0,
      warning: `could not resolve repo (${(err as Error).message}) — verify manually`,
    };
  }
  const results: string[] = [];
  let problem = false;
  // Multi-target (#689/#696): check once per target with that target's
  // namespaced check name (mirroring the CI workflow job-name suffix from
  // #692), so branch protection requires what each target's workflow
  // reports. ensureBranchProtection only adds (#990), so looping is safe.
  const targets = resolveTargets(config ?? { project_slug: '' });
  const multiTarget = targets.length > 1;
  const branches: { branch: string; checks: readonly string[]; minReviewCount: number }[] = [];
  for (const target of targets) {
    branches.push({
      branch: releaseBranch,
      checks: namespacedRequiredChecks(MAIN_REQUIRED_CHECKS, target.name, multiTarget),
      minReviewCount: MAIN_REVIEW_COUNT,
    });
    if (integrationBranch !== releaseBranch) {
      branches.push({
        branch: integrationBranch,
        checks: namespacedRequiredChecks(DEVELOP_REQUIRED_CHECKS, target.name, multiTarget),
        minReviewCount: DEVELOP_REVIEW_COUNT,
      });
    }
  }
  for (const { branch, checks, minReviewCount } of branches) {
    // eslint-disable-next-line no-await-in-loop
    const r = await provider.ensureBranchProtection(ctx.projectPath, branch, checks, { minReviewCount });
    const label = `${branch}${multiTarget ? ` (${checks.join(', ')})` : ''}`;
    switch (r.status) {
      case 'ok':
        results.push(`${label}: ok`);
        break;
      case 'updated':
        results.push(`${label}: ${(r.changes ?? []).join('; ')}`);
        break;
      case 'created':
        results.push(`${label}: no protection found; applied the DevAudit defaults`);
        break;
      case 'ruleset': {
        const missing = r.missingChecks ?? [];
        const notes = [
          ...(missing.length > 0 ? [`rulesets do not require ${missing.map((c) => `"${c}"`).join(', ')}; add them to the ruleset`] : []),
          ...(r.message ? [r.message] : []),
        ];
        if (notes.length > 0) problem = true;
        results.push(`${label}: protected by rulesets${notes.length > 0 ? ` — ${notes.join('; ')}` : ' (ok)'}`);
        break;
      }
      case 'unavailable':
        problem = true;
        results.push(`${label}: branch protection is not available for this repository on its GitHub plan — required checks are not enforced`);
        break;
      default:
        problem = true;
        results.push(`${label}: failed — ${r.message ?? 'unknown'}`);
    }
  }
  return {
    name: 'Branch protection',
    filesSynced: 0,
    message: results.join(' | '),
    warning: problem ? 'branch protection needs attention — see the message above' : undefined,
  };
}
