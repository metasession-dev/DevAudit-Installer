import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { getGitProvider } from '../lib/git-provider/index.js';
import { readSdlcConfig, resolveTargets } from '../lib/sdlc-config.js';
import * as prompts from '../lib/prompt.js';
import { isJsonMode } from '../lib/logger.js';
import type { ConfirmLowerReviews } from '../lib/git-provider/types.js';
import type { SyncContext, SectionResult } from './types.js';
import {
  MAIN_REQUIRED_CHECKS,
  DEVELOP_REQUIRED_CHECKS,
  MAIN_REVIEW_COUNT,
  DEVELOP_REVIEW_COUNT,
  configuredReleaseReviewCount,
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
 *
 * One setting is the project's to choose in both directions (DevAudit-Installer#1116 WP2): when
 * `sdlc-config.json` has `release_branch_required_reviews`, the release branch's required approving
 * reviews are made to equal it. Raising is automatic; lowering (for example to 0 for a solo
 * developer) weakens protection, so it happens only after an interactive confirmation that states
 * the recorded control gap. Without a terminal, or on "no", the difference is reported and nothing
 * is changed. Without the key the branch keeps DevAudit's minimum of 1, as before.
 */

/** Asks a person before the release branch's required reviews are lowered; false when nobody can answer. */
const confirmLowerReviews: ConfirmLowerReviews = async ({ branch, from, to }) => {
  const json = isJsonMode();
  if (prompts.nonInteractiveReason(json)) return false;
  const gap =
    to === 0
      ? 'The author will be able to merge their own release PR; DevAudit records this as a control gap for SOC 2 CC8.1 and ISO 27001 A.8.32.'
      : 'This weakens the review requirement and is recorded as a change to the control.';
  return (await prompts.confirm(`Lower the required approving reviews on ${branch} from ${from} to ${to}? ${gap}`, { json })) === true;
};
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
  const configuredReleaseReviews = configuredReleaseReviewCount(config);
  const branches: { branch: string; checks: readonly string[]; minReviewCount: number; exact?: number }[] = [];
  for (const target of targets) {
    branches.push({
      branch: releaseBranch,
      checks: namespacedRequiredChecks(MAIN_REQUIRED_CHECKS, target.name, multiTarget),
      // An explicit `release_branch_required_reviews` replaces DevAudit's minimum of 1 (it may be 0).
      minReviewCount: configuredReleaseReviews ?? MAIN_REVIEW_COUNT,
      ...(configuredReleaseReviews !== undefined ? { exact: configuredReleaseReviews } : {}),
    });
    if (integrationBranch !== releaseBranch) {
      branches.push({
        branch: integrationBranch,
        checks: namespacedRequiredChecks(DEVELOP_REQUIRED_CHECKS, target.name, multiTarget),
        minReviewCount: DEVELOP_REVIEW_COUNT,
      });
    }
  }
  for (const { branch, checks, minReviewCount, exact } of branches) {
    // eslint-disable-next-line no-await-in-loop
    const r = await provider.ensureBranchProtection(ctx.projectPath, branch, checks, {
      minReviewCount,
      ...(exact !== undefined ? { exactReviewCount: exact, confirmLower: confirmLowerReviews } : {}),
    });
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
    if (r.reviewsNotLowered) {
      // sdlc-config.json asks for fewer reviews than the branch requires; lowering needs a person to confirm.
      problem = true;
      results[results.length - 1] +=
        ` — requires ${r.reviewsNotLowered.current} approving review(s) but release_branch_required_reviews is ${r.reviewsNotLowered.configured}; not lowered (run \`devaudit update\` in a terminal to confirm, or change it on GitHub)`;
    }
  }
  return {
    name: 'Branch protection',
    filesSynced: 0,
    message: results.join(' | '),
    warning: problem ? 'branch protection needs attention — see the message above' : undefined,
  };
}
