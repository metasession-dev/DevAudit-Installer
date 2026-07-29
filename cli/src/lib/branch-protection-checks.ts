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
