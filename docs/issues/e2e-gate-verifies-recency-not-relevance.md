# Pre-push E2E gate verifies a suite ran, not that it covers the change being pushed

## Background

`installer#226` (`e2e-gate-enforcement-gap.md`) hardened the pre-push E2E gate against silent skips: `.husky/pre-push` now blocks a push to `$INTEGRATION_BRANCH` unless either `.e2e-gate-passed` exists or `playwright-report/` has files newer than `.git/HEAD`, and a companion `.e2e-evidence-wired` sentinel checks that any changed `e2e/**/*.spec.ts` file actually calls `tagTest()`/`evidenceShot()`. That issue's "Out of scope" section explicitly deferred one thing:

> Verifying E2E test *quality* (coverage, assertion depth) — this issue is about whether the suite *ran*, not whether it's comprehensive.

`wawagardenbar-app` REQ-095 (issue #603, PR #604) fell exactly into that deferred gap, on the very first HIGH-risk change to land after #226 shipped.

## What happened

REQ-095's implementation plan (`compliance/evidence/REQ-095/implementation-plan.md`) scoped "Playwright plus service boundary tests" for four surfaces (Today/Yesterday/Last-7-Days/custom-range shortcuts). Only Vitest unit/service tests were written. `app/dashboard/reports/daily/daily-report-client.tsx` — a UI-facing `.tsx` file — was modified, which should trip the pre-push hook's E2E check. It did not block the push, because:

1. The pre-existing full regression suite (182 specs, unrelated to REQ-095) had run recently enough to leave `playwright-report/` newer than `.git/HEAD`. The hook's freshness check is satisfied by *any* recent run, not one relevant to the diff being pushed.
2. No `e2e/**/*.spec.ts` file was authored or modified for REQ-095, so `.e2e-evidence-wired`'s check — which only fires when spec files are part of the push — never activated. A REQ can plan Playwright coverage and ship zero of it without either check noticing.

Net effect: the release reached the UAT gate with 0% requirement-level E2E coverage and no screenshots, despite both #226 checks passing green.

## Root cause

Both checks answer "did a Playwright run happen recently" or "if spec files changed, are they wired correctly" — neither answers "does evidence exist that covers **this** REQ's acceptance criteria." The check is content-blind to the relationship between the diff and the evidence.

## Proposed solutions

### Option A — REQ-scoped sentinel
`e2e-test-engineer` writes `.e2e-gate-passed` containing the REQ IDs it actually tagged tests for (via `tagTest()`), not just a boolean presence file. The pre-push hook extracts in-scope REQs for the push (same `Ref: REQ-XXX` git-log lookup `compliance-evidence.yml` already uses) and fails if any UI-facing REQ in that range is absent from the sentinel's REQ list.

### Option B — Plan-vs-spec cross-check
When a push touches UI-facing files for a REQ, read that REQ's `implementation-plan.md` surface inventory / test strategy. If it names "Playwright" as the verification method for any surface and no `e2e/**/*.spec.ts` file tags that REQ (`tagTest('REQ-XXX', …)`), halt: "Plan requires Playwright coverage for REQ-XXX; no tagged spec found." Mirrors the existing plan↔test-scope drift check already used elsewhere in `sdlc-implementer` Phase 2 step 5b.

### Option C — Widen `DEVELOP_REVIEW_COUNT` behavior (rejected)
Rely on Stage 2 human review to catch missing coverage instead of a machine check. Rejected: prose/human-judgment gates are exactly the failure class #226 was created to replace with machine enforcement; also blocked separately by `stage2-independent-review-not-enforced.md`.

## Recommended approach

**A + B combined.** A closes the loophole where stale/unrelated evidence satisfies the hook; B closes the loophole where zero spec files are authored at all. Together they enforce "evidence exists **and** is attributable to this REQ," which is what #226 assumed but didn't implement.

## Required changes

1. **`sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`** — sentinel write step includes the REQ IDs covered (`echo "REQ-095" >> .e2e-gate-passed` or a small JSON/line-list format), not a bare touch.
2. **`sdlc/files/stacks/node/hooks/pre-push`** — E2E evidence check (existing "2." block) additionally greps in-scope REQs for the push against the sentinel's REQ list; fail with the specific missing REQ named.
3. **`sdlc/files/_common/skills/sdlc-implementer/SKILL.md`** Phase 2 step 5b — add the plan↔spec cross-check described in Option B, alongside the existing plan↔test-scope consistency check.
4. **`scripts/validate-compliance-artifacts.sh`** (or a new script) — CI-side mirror of the same check, so a bypass (`--no-verify`) or a non-husky push path is still caught before Stage 3 evidence compilation completes.

## Acceptance criteria

- [ ] `.e2e-gate-passed` records which REQ IDs were actually tagged in the run that produced it
- [ ] Pre-push hook fails when a UI-facing REQ in the push range is absent from the sentinel's REQ list, even if `playwright-report/` is fresh from an unrelated run
- [ ] Pre-push hook (or CI mirror) fails when a REQ's `implementation-plan.md` names Playwright as a verification method and no spec tags that REQ
- [ ] A REQ with no UI-facing surfaces (API-only, config-only) is unaffected
- [ ] Test: pushing a UI change for REQ-X with only a stale unrelated `playwright-report/` is blocked
- [ ] Test: pushing a UI change for REQ-X with a spec correctly tagged `tagTest('REQ-X', …)` passes
- [ ] Test: a plan that names Playwright coverage with zero tagged specs is blocked before Stage 3

## References

- `wawagardenbar-app` REQ-095 / issue #603 / PR #604 — concrete incident
- `docs/issues/e2e-gate-enforcement-gap.md` (installer#226) — prior art, explicitly scoped this out
- `sdlc/files/stacks/node/hooks/pre-push` — existing E2E evidence check ("2.") and evidence-wiring check ("3.")
- `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` — `evidenceShot`/`tagTest` discipline, Phase 5½ wiring validation
- `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` Phase 2 step 5b — existing plan↔test-scope consistency check pattern to extend
