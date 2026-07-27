# high-risk-release.md Stage 2 claims an independent-review requirement that nothing enforces — correct the doc to name Stage 4/main as the actual enforcement point

## Background

`release-playbooks/high-risk-release.md` Stage 2 ("feature branch and integration") says:

> Merge only after the independent reviewer and all required integration checks are terminal green on the current head SHA.

This is a **code-review** gate on the feature→`$INTEGRATION_BRANCH` PR — a human other than the author checks the implementation before it lands on `develop`. It is a different control from `sdlc-config.json`'s `approval.mode: dual_actor`, which is a **portal** gate at Stage 3 Step 11 enforcing `approver ≠ release_creator` for UAT/production sign-off on already-deployed behavior. Both matter; they check different things at different points, and neither currently substitutes for the other.

Only one of the two has any live enforcement mechanism today, and even that one hasn't been exercised for the incident below — the release never reached the portal gate.

## What happened

`wawagardenbar-app` REQ-095 (HIGH risk, issue #603) had two PRs merged into `develop` — #604 (implementation) and #605 (evidence) — both authored **and** merged by the same account, both with zero GitHub PR reviews:

```
gh pr view 604 --json reviews,mergedBy,author
→ {"author":"metasession-dev","mergedBy":"metasession-dev","reviews":[]}
```

`develop` branch protection confirms why nothing blocked it:

```
gh api repos/metasession-dev/wawagardenbar-app/branches/develop/protection
→ required_pull_request_reviews.required_approving_review_count: 0
```

That `0` isn't a misconfiguration — it's the installer's hardcoded default for every project, every risk tier (`cli/src/install/branch-protection.ts`):

```ts
const MAIN_REVIEW_COUNT = 1;
const DEVELOP_REVIEW_COUNT = 0;
```

`main` gets 1 required review (which is where Stage 4's "MEDIUM/HIGH risk → second human reviewer" is actually enforced, per the sdlc-framework.md pipeline diagram). `develop` gets 0, unconditionally — there's no mechanism that reads a REQ's RTM risk classification and requires review on `develop` only when Stage 2 of `high-risk-release.md` says it should.

## Root cause

GitHub native branch protection is static per-branch; it can't vary `required_approving_review_count` by the content or risk tier of an individual PR. The installer made a reasonable global simplification (0 on `develop`, 1 on `main`) but that silently contradicts the HIGH/CRITICAL playbook text, and nothing surfaces the contradiction — an operator reading `high-risk-release.md` has no reason to suspect Stage 2's review requirement isn't actually enforced anywhere.

## Proposed solutions

### Option A — Correct the docs (chosen)
State plainly in `high-risk-release.md` that Stage 2's "independent reviewer" language does not correspond to any enforced control today, and that the only *enforced* human gates in this pipeline are Stage 4 (`main`, 1 required review via branch protection) and Stage 3's `dual_actor` UAT/production approval on the portal. Cheapest fix, and the honest one — it makes the playbook match what `cli/src/install/branch-protection.ts` and every consumer project's actual branch protection do today, instead of describing a control that doesn't exist anywhere in the installer.

Trade-off accepted: Stage 2 implementation-level review (catching concerns before more work is built on top of unreviewed code) stays unenforced for HIGH/CRITICAL work under this option. That gap is real, but closing it is a separate, larger decision (see Option C) that shouldn't block correcting the doc now — a compliance playbook asserting an unenforced control is itself a finding worth fixing immediately, independent of whether anything later fills the underlying gap.

### Option B — Static bump
Set `DEVELOP_REVIEW_COUNT = 1` globally for every project.

- **Rejected** — applies review overhead uniformly, defeating the framework's own risk-tiered self-merge philosophy (LOW risk is explicitly meant to self-merge after CI per `sdlc-framework.md`). Forces LOW-risk/housekeeping work through the same friction as HIGH-risk work.

### Option C — Risk-aware required status check (deferred, not this issue)
Add a required CI check (not native branch-protection review count) that reads the RTM risk classification for the REQ(s) in scope for the PR and fails if risk is MEDIUM/HIGH/CRITICAL and the PR has zero approving reviews. `develop` branch protection stays at review-count 0 natively, but gains this check in its required-status-checks list — consistent with how `Compliance Validation` and `Release Scope Integrity` already gate on PR content rather than a blanket GitHub setting.

Not pursued here — this is real enforcement work (new script, CI wiring, installer changes across `branch-protection.ts` in both `install/` and `update/`) that deserves its own issue if the project decides Stage 2 review should become a machine-enforced gate for MEDIUM+ risk. Noted as a follow-up candidate, not bundled into this doc-correction fix.

## Recommended approach

**Option A.** Fix the doc now so `high-risk-release.md` accurately describes the two enforced human gates that exist — Stage 4 `main` review and Stage 3 `dual_actor` UAT/production approval — instead of asserting a Stage 2 control with no enforcement mechanism anywhere in the installer. Option C remains a legitimate future enhancement if Stage 2 review is later prioritized, but it's out of scope here: this issue is about the playbook currently claiming something false, not about closing the underlying capability gap.

## Required changes

1. **`release-playbooks/high-risk-release.md`** — Stage 2 text ("Merge only after the independent reviewer and all required integration checks are terminal green on the current head SHA.") is corrected to drop the independent-reviewer claim (or reframe it as advisory/AI-self-audit guidance, not an enforced gate), with an explicit note that the only enforced human review in this pipeline is Stage 4's `main` branch protection (1 required review) and Stage 3's `dual_actor` UAT/production approval.
2. **`docs/sdlc-framework.md`** — the Stage 4 pipeline diagram language ("MEDIUM/HIGH risk → Second human reviewer required") already correctly reflects where enforcement lives; add a cross-reference from the corrected Stage 2 text so a reader lands on the accurate statement instead of the two docs implying different things.
3. **Explicit two-gate distinction** — add the Stage 2-vs-Stage-3 clarification (code review vs. live-behavior sign-off via `dual_actor`) to whichever doc is the shared source of truth for both playbooks, so the ambiguity that prompted this issue doesn't resurface.
4. No code, CI, or installer changes in this issue — see Option C above if Stage 2 enforcement is separately prioritized later.

## Acceptance criteria

- [ ] `high-risk-release.md` Stage 2 no longer states or implies that an independent reviewer is enforced before merging to `develop`
- [ ] `high-risk-release.md` explicitly names Stage 4 (`main`, 1 required review) and Stage 3 `dual_actor` UAT/production approval as the two actually-enforced human gates in the pipeline
- [ ] The doc is explicit that Stage 2 review, if performed, is currently a human/process expectation only — not machine-enforced
- [ ] The Stage 2 vs. Stage 3 `dual_actor` distinction is stated in one place both playbooks reference, so it doesn't need re-deriving during the next incident review
- [ ] No behavior change to branch protection, CI, or the installer CLI — this issue is documentation-only

## References

- `wawagardenbar-app` REQ-095 / issue #603 / PR #604, #605 — both merged with zero reviews, `required_approving_review_count: 0` on `develop`
- `DevAudit-Installer/docs/release-playbooks/high-risk-release.md` — Stage 2 review requirement text
- `cli/src/install/branch-protection.ts`, `cli/src/update/branch-protection.ts` — hardcoded review-count defaults
- `sdlc/files/sdlc-config.example.json` — `approval.mode: dual_actor` comment, "Stage 3 Step 11" scope
- `docs/sdlc-framework.md` — Stage 4 pipeline diagram showing where the "MEDIUM/HIGH → second reviewer" language is actually enforced today (on `main`, not `develop`)
