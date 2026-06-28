# Playbook: housekeeping release

> A **housekeeping** release (`vYYYY.MM.DD`) for ticketless work — docs, dependency bumps, CI tweaks, formatting, reverts. **No requirement, no Stage 1, no per-REQ evidence authoring.** CI generates the release artefacts for you. But the gates still run and the same UAT → production four-eyes still applies — the CI-generated stubs replace your *authoring* effort, not your *review*.

| | |
| --- | --- |
| **Use when** | The commit type is `docs` / `chore` / `ci` / `build` / `test` / `compliance` / `revert` — anything with **no new requirement**. These types are exempt from the `[REQ-XXX]` tag. |
| **Version shape** | `vYYYY.MM.DD` (housekeeping). CI auto-increments same-day collisions (`.2`, `.3`). |
| **Stage 1 (Plan)** | **Skipped entirely.** No risk classification, no implementation plan, no SoT-alignment skills. |
| **Per-REQ evidence** | **None.** The portal auto-skips test-scope, test-plan, implementation-plan, and test-execution-summary. |
| **CI generates** | `RELEASE-TICKET-<version>.md` + `security-summary-<version>.md`, surfaced as a sign-off PR. |
| **Approvals** | Same `draft → uat_review → uat_approved → prod_review → prod_approved → released` four-eyes as tracked. **No auto-approval.** |
| **Gates** | TypeScript 0 · SAST 0 above baseline · dep-audit 0 unaccepted high/critical · E2E all pass · build — all green. |

Two ways to run it. **Track A** lets Claude Code drive the "Lightweight path". **Track B** is by hand. New here? Skim [`README.md`](./README.md) for the four-eyes lifecycle.

---

## Track A — with Claude Code (the AI path)

The kick-off prompt is the **same** as a tracked release — `sdlc-implementer`'s triage recognises a no-requirement change and routes it down its **Lightweight path** automatically (no ceremony, no plan pause).

### 1. Kick it off

```
Implement issue #N under the SDLC.
```

(No issue? A housekeeping change often has none — just describe it: `Bump the eslint dependency and ship it under the SDLC.` The triage will classify it as housekeeping.)

The agent announces its routing (`Path: Lightweight`) and **auto-proceeds** — for a trivial/housekeeping change it does not pause for triage confirmation. If you disagree with the classification, reclassify: `treat this as a tracked REQ` / `this is HIGH risk`. It then makes the change, runs all local gates, and pushes to `develop`. On the Lightweight path the only human pauses are **PR review and merge**.

### 2. Sign off the CI-generated release stubs

The push to `develop` triggers CI, which:

1. Runs the four gates.
2. Auto-opens a PR (`chore/housekeeping-release-<version>`) containing the two generated stubs — `RELEASE-TICKET-<version>.md` and `security-summary-<version>.md`.

Review that PR: confirm the commit-summary list and the SAST/dep-audit summary read correctly, fill in the operator sign-off block on each stub, and merge it. The next CI run flips both completeness items to ✓. **This review is yours — CI wrote the stubs, but a human still signs them off.**

### 3. Submit, approve, ship

From here it's identical to a tracked release: submit the release for UAT review on the portal, a reviewer approves (`uat_approved`, four-eyes under `dual_actor`), then resume for production:

```
resume REQ-XXX
```

> Use the release version (e.g. `resume v2026.06.04`) in place of `REQ-XXX` for a housekeeping release. Phase 5 merges to `main`, runs the read-only prod smoke, and drives the release to `prod_review`; a human Approves Production and Marks Released.

> **Other agents:** point Cursor / Windsurf / Gemini / Copilot at the synced `INSTRUCTIONS.md`; the Lightweight path is the same as Track B below.

---

## Track B — by hand (no AI agent)

There is no Stage 1 and no per-REQ evidence to author. The operator loop:

### 1. Make the change and push

```bash
git branch --show-current            # must be: develop

# Make the docs / chore / ci / dependency change. Then run ALL local gates —
# housekeeping is exempt from a REQ tag, NOT from the gates:
npx tsc --noEmit
semgrep scan --config auto [SOURCE_DIR]/ --severity ERROR --severity WARNING
npm audit --audit-level=high
npx playwright test

git add <files>
git commit -m "chore: bump eslint to 9.x"      # docs/chore/ci/build/test/compliance/revert — no REQ tag
git push origin develop
gh run watch                                    # confirm CI green
```

### 2. Review + merge the CI-generated sign-off PR

CI's `compliance-evidence.yml` auto-opens `chore/housekeeping-release-<version>` with the two generated stubs (release ticket + security summary):

```bash
gh pr list --head "chore/housekeeping-release" --json number,title
gh pr view <stub-PR> --files          # confirm RELEASE-TICKET-<version>.md + security-summary-<version>.md
# Fill in the operator sign-off block in each stub, then:
gh pr merge <stub-PR> --merge
gh run watch                          # next run flips both completeness items to ✓
```

> The two generated files are `compliance/pending-releases/RELEASE-TICKET-<version>.md` (e.g. `RELEASE-TICKET-v2026.06.04.md`) and `compliance/security-summary-<version>.md`. You do **not** write them — `generate-housekeeping-release-ticket.sh` + `generate-security-summary.sh` do. You review and sign off.

### 3. Submit for UAT review

```bash
./scripts/submit-for-uat-review.sh [PROJECT_SLUG] v2026.06.04     # draft → uat_review
```

A reviewer opens the release on the portal and **Approves** (`uat_review → uat_approved`) — same four-eyes as tracked (under `dual_actor`, approver ≠ creator). There is **no** auto-approval for housekeeping.

### 4. Submit for review + deploy (`4-submit-for-review.md`, `5-deploy-main.md`)

```bash
gh pr create --base main --head develop --title "chore: housekeeping v2026.06.04" --body "<summary; link the release ticket>"
gh pr checks <PR>                                  # incl. "DevAudit Release Approval"
gh pr merge <PR> --merge --delete-branch=false     # after the Release Approval Gate is green

git checkout main && git pull origin main
git checkout develop && git merge main --no-edit && git push origin develop
curl -s [PRODUCTION_URL]/[HEALTH_ENDPOINT]         # read-only prod check
```

The deploy moves the release to `prod_review`; a human **Approves Production** and **Marks Released**. Then close out:

```bash
./scripts/close-out-release.sh v2026.06.04 --release-pr <release-PR-#>
git add -A && git commit -m "docs(compliance): close out v2026.06.04 release (RELEASED)" && git push origin develop
git checkout main && git merge develop --no-edit && git push origin main
```

> **Even lighter: the trivial escape hatch.** A pure typo / formatting / dependency-bump can take the trivial route — skip Stages 1 **and** 3 — but **all gates must still pass locally before you push**. See [`../change-workflows.md`](../change-workflows.md) for exactly which change types qualify.

---

## What makes this the *housekeeping* path (vs tracked)

- **No requirement.** No `REQ-XXX`, no RTM tracked row, no risk classification — the commit types (`docs`/`chore`/`ci`/`build`/`test`/`compliance`/`revert`) are exempt from the tag.
- **Stage 1 is skipped entirely.** No plan, no SoT-alignment skills (`requirements-aligner` / `adr-author` / `risk-register-keeper`).
- **CI authors the artefacts.** The release ticket and security summary are generated and handed to you as a sign-off PR — you review, you don't write.
- **Date version.** `vYYYY.MM.DD`, not `REQ-XXX`.

What it keeps, unchanged from tracked: **all four CI gates**, the **two release-scoped artefacts** (just CI-generated), and the **full UAT → production four-eyes lifecycle** with no auto-approval.

## Automated tooling syncs (devaudit update)

`devaudit update` syncs are **machine-generated template refreshes**, not operator-authored changes. To prevent portal noise from these syncs:

- The suggested commit message includes `[skip ci]` — the sync push does not trigger `ci.yml` or `compliance-evidence.yml`, so no housekeeping release record is created on the portal.
- Housekeeping changes from skipped syncs are **bundled into the next REQ-tagged release**. The `generate-bundled-changes.sh` script (run by CI during `register-release` for REQ releases) scans commits since the last release tag, filters for housekeeping types, and uploads a `bundled_changes` summary as evidence against the REQ release.
- Gate evidence on the REQ release covers the full `develop` state at CI time, including the skipped housekeeping changes — no testing gap.
- Human-authored `chore`/`docs` commits (without `[skip ci]`) still create housekeeping releases as before. The `[skip ci]` convention is specifically for automated tooling syncs.

## When the release PR HEAD is a housekeeping commit

The `check-release-approval` gate runs `derive-release-version.sh` against the PR HEAD commit (not the synthetic merge commit). If the HEAD is a housekeeping commit with no `[REQ-XXX]` tag, the version derives to a bare-date (`v2026.06.28`). The gate then requires that bare-date release to be `uat_approved` on the portal.

This is **not a bug** — the housekeeping release has gate evidence and a CI-generated ticket stub. But it's a **weaker sign-off** than a REQ-tagged release (no REQ association, no test scope, no security summary until the stub is filled in). Three options, cheapest first:

1. **Tag the release PR commit with a REQ** (preferred). If a REQ is ready to release, reference it in the PR commit message: `compliance: [REQ-085] release to main`. The gate resolves to the REQ release (full evidence), and the housekeeping release stays as a harmless CI record.

2. **Batch housekeeping into the next REQ release.** If no REQ is ready, wait. The housekeeping commits are bundled into the next REQ release by `generate-bundled-changes.sh` — no evidence gap.

3. **Approve the housekeeping release.** Fill in the `generate-housekeeping-release-ticket.sh` stub (REPLACE markers), merge the auto-PR, submit for UAT review, and approve on the portal. This is the documented Track A/B flow above — it works, but the sign-off has no REQ-level traceability.

> **`devaudit update` syncs are not affected** — they include `[skip ci]` and don't trigger CI or create portal releases. This section applies only to human-authored housekeeping commits (dependency bumps, doc tweaks, CI config changes).

## Quick reference

| Step | Track A (Claude) | Track B (manual) |
| --- | --- | --- |
| Start | `Implement issue #N under the SDLC.` (auto-routes to Lightweight) | Make the change; run gates; `git push origin develop` |
| Plan | *(skipped — no requirement)* | *(skipped)* |
| Release artefacts | (CI generates; agent surfaces the sign-off PR) | Review + merge the `chore/housekeeping-release-<version>` PR |
| Submit for UAT | (automatic) | `submit-for-uat-review.sh [slug] v2026.06.04` |
| UAT approval | reviewer approves on portal (no auto-approve) | reviewer approves on portal (no auto-approve) |
| Ship | `resume v2026.06.04` | open develop→main PR, merge after gate, prod checks |
| Prod approval + close | human approves + marks released | `close-out-release.sh v2026.06.04` |
