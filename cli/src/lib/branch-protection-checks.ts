/**
 * Required-checks/review-count constants for consumer-project branch
 * protection, shared between the install and update code paths so they
 * can't silently drift from each other.
 *
 * `Quality Gates` is the only GitHub-native, hard-blocking required
 * check on `main` — deliberately, not by oversight. Three prior
 * incidents (devaudit-installer#264, #270, #432) established that any
 * conditionally- or event-triggered check (e.g. one that skips for
 * non-feat/fix PRs, or only fires on `push` rather than `pull_request`)
 * must never be a GitHub required status check: GitHub treats a
 * required-but-skipped/never-reported check as "expected but not
 * satisfied," which permanently blocks merge with no recourse short of
 * an admin bypass. See `docs/release-playbooks/README.md`'s "Required
 * checks" section for the full reviewer-verified checklist — the other
 * four checks there (Release Scope Integrity, Compliance Validation,
 * DevAudit Release Approval, E2E Regression Suite) are Stage 4 manual
 * verification items, not branch-protection contexts.
 */
export const MAIN_REQUIRED_CHECKS: readonly string[] = ['Quality Gates'];

export const DEVELOP_REQUIRED_CHECKS: readonly string[] = ['Quality Gates'];

export const MAIN_REVIEW_COUNT = 1;
export const DEVELOP_REVIEW_COUNT = 0;

/**
 * The review count `sdlc-config.json` asks for on the release branch (DevAudit-Installer#1116 WP2):
 * `release_branch_required_reviews` when it is a whole number from 0 to 2, otherwise undefined.
 * A value outside that range is ignored (the validator in `configure` refuses it; a hand-edit is
 * not trusted to lower protection).
 */
export function configuredReleaseReviewCount(config: { readonly release_branch_required_reviews?: unknown } | null | undefined): number | undefined {
  const value = config?.release_branch_required_reviews;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2 ? value : undefined;
}

/** The release branch's review count: the configured one, or `MAIN_REVIEW_COUNT` (today's value). */
export function releaseReviewCount(config: { readonly release_branch_required_reviews?: unknown } | null | undefined): number {
  return configuredReleaseReviewCount(config) ?? MAIN_REVIEW_COUNT;
}

/**
 * Namespace a set of required-check names for a target, mirroring the CI
 * template job/check-name suffix from #692 (`namespaceForTarget` in
 * `update/ci-templates.ts`) so branch protection's required contexts match
 * what each target's workflow actually reports. No-ops for the single-target
 * case so existing single-target repos keep requiring the bare `Quality
 * Gates` context. See #689/#696.
 */
export function namespacedRequiredChecks(
  checks: readonly string[],
  targetName: string,
  multiTarget: boolean,
): readonly string[] {
  if (!multiTarget) return checks;
  return checks.map((c) => `${c} (${targetName})`);
}
