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

---

## Hotfix scenario

Housekeeping hotfixes are the most common type of hotfix — a CI config fix, a dependency bump that broke production, a revert of a bad merge. No REQ, no plan, no per-REQ evidence. **Gates still required.**

### Track A — AI-driven hotfix

```text
Hotfix: the CI workflow is broken after the last merge. Fix and ship under the SDLC.
```

The agent routes to the Lightweight path, makes the fix, runs gates, and pushes to `develop`. CI generates the housekeeping release stubs automatically.

### Track B — manual hotfix

```bash
# 1. Branch from main (if prod is broken) or develop (if CI is broken)
git checkout main && git pull origin main
git checkout -b fix/hotfix-<desc>

# 2. Fix — no REQ needed for housekeeping types (docs/chore/ci/build/test/compliance/revert)
# 3. Run ALL gates
npx tsc --noEmit
semgrep scan --config auto [SOURCE_DIR]/ --severity ERROR --severity WARNING
npm audit --audit-level=high
npx playwright test

# 4. Commit (housekeeping type — no REQ tag)
git add <files>
git commit -m "ci: fix broken workflow — <description>"
git push origin fix/hotfix-<desc>

# 5. PR to main (hotfix) or develop
gh pr create --base main --head fix/hotfix-<desc> --title "ci: hotfix — <description>" --body "HOTFIX"

# 6. CI generates housekeeping release stubs — review and merge the stub PR
# 7. Submit for UAT, approve, merge, prod checks
# 8. Sync develop
git checkout develop && git merge main --no-edit && git push origin develop
```

> **Revert hotfix:** If the hotfix is a revert of a bad merge, the commit type is `revert` — also housekeeping. The same flow applies.

---

## Superseding a previous housekeeping release

Housekeeping releases use date versions (`vYYYY.MM.DD`). Superseding is simpler than tracked releases — there's no REQ to manage.

### When the superseded release is still on `develop`

1. **Fix-forward on `develop`:** push a new commit fixing the defect
2. The existing release PR picks up the fix
3. The housekeeping version stays the same (same-day) or increments (next-day)

```bash
git add <fix files>
git commit -m "fix: <defect description> — supersedes broken housekeeping commit <sha>"
git push origin develop
gh run watch
```

### When the superseded release is merged to `main` but not yet `released`

1. **Fix-forward on `develop`** — a new housekeeping version is generated by CI
2. The old housekeeping release stays on the portal as a CI record (harmless)
3. The new release carries fresh gate evidence

```bash
git checkout develop
# ... fix ...
git commit -m "fix: <defect description>"
git push origin develop
# CI generates a new housekeeping release (vYYYY.MM.DD or .2 if same-day)
gh pr create --base main --head develop --title "fix: <desc>" --body "Supersedes v<old-version>."
```

### When already `released` on the portal

This is a rollback — see below.

---

## Triage: defect found during feature → develop

For housekeeping changes, "feature → develop" is typically "chore → develop" — a dependency bump, CI tweak, or docs update.

### Case 1: Defect is in the new change (e.g. dependency bump breaks the build)

1. **Fix in-place** on `develop` — push a new commit fixing the break
2. No REQ needed — use the appropriate housekeeping commit type
3. Re-run all gates

```bash
git add <fix files>
git commit -m "fix: resolve build break from dependency bump"
git push origin develop
gh run watch
```

### Case 2: Defect is in existing code (found by coincidence during a housekeeping change)

1. **File a new issue** for the defect
2. **Do not fix it in the housekeeping change** — housekeeping commits should be scoped to the change type (docs/chore/ci/etc.), not feature fixes
3. Continue with the housekeeping change; handle the defect via a separate REQ

```bash
gh issue create --title "Defect: <description>" --body "Found during housekeeping change."
```

### Case 3: E2E regression found during a housekeeping change

1. File a regression issue
2. If the regression was caused by the housekeeping change (e.g. a dependency bump broke a test), fix it in-place
3. If pre-existing, file the issue and continue — don't block the housekeeping PR

---

## Triage: defect found during develop → main (release PR)

### Case 1: CI gate failure

Fix-forward on `develop`. The release PR picks up the fix.

```bash
git add <fix files>
git commit -m "fix: <gate failure description>"
git push origin develop
gh run watch
```

### Case 2: Compliance validation failure

Housekeeping commits are exempt from the `[REQ-XXX]` tag, so compliance validation failures are rare. Common issues:

- **`fix` commit without `Ref: REQ-XXX`:** If a `fix` commit sneaks into a housekeeping release, the validator will flag it. Either:
  - Reclassify the commit as `chore` or `ci` if it's truly housekeeping
  - Or create a retroactive REQ attribution (see the tracked playbooks for the pattern)
- **Missing evidence:** Re-run `compliance-evidence.yml` after pushing the fix

```bash
# If a fix commit needs retroactive REQ attribution:
git add compliance/RTM.md compliance/evidence/REQ-XXX/ compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md
git commit -m "compliance: [REQ-XXX] retroactive attribution for fix commit <sha>

Ref: REQ-XXX"
git push origin develop
```

### Case 3: E2E regression on the release PR

1. Triage: caused by the housekeeping change or pre-existing?
2. **Caused by the housekeeping change** (e.g. dependency bump): fix-forward on `develop`
3. **Pre-existing:** file a regression issue; don't block the housekeeping PR unless the regression is severe

### Case 4: Release Approval Gate failure (missing evidence on portal)

This is the **housekeeping release approval catch-22** — see the dedicated section below.

---

## Housekeeping release approval catch-22

### The problem

`ci.yml` has `paths-ignore: compliance/**` — when a housekeeping PR contains only compliance docs (e.g. filled-in release ticket + security summary), CI skips Quality Gates. No gate artifacts (SAST, dep-audit, E2E, test report) are produced. The portal's evidence completeness gate then shows MISSING for all gate types, blocking release approval.

This is a **catch-22**: the compliance docs PR needs gate evidence to be approved, but CI doesn't run gates on compliance-only commits.

### The fix (operator workaround)

1. **Manually trigger `ci.yml`** via `workflow_dispatch` on the `develop` branch to produce gate artifacts:

```bash
gh workflow run ci.yml --repo <org>/<repo> --ref develop
gh run watch <run-id>
```

2. CI runs all four gates and uploads evidence to the portal against the housekeeping release version.
3. **Re-run `compliance-evidence.yml`** to upload the compliance docs (release ticket + security summary):

```bash
gh workflow run compliance-evidence.yml --repo <org>/<repo> --ref develop
gh run watch <run-id>
```

1. Verify all evidence is present on the portal, then approve the release.

### Root cause and upstream fix

The `paths-ignore` in `ci.yml` is intentional — it prevents wasted CI runs on docs-only changes. But the housekeeping release approval flow assumes gate evidence is always present. The upstream fix (filed as DevAudit-Installer#361) proposes:

- Option A: Remove `paths-ignore` for `compliance/**` (runs CI on every push — simplest, but wastes runner minutes)
- Option B: Add a `workflow_dispatch` trigger to `ci.yml` and document the manual trigger step in this playbook (current workaround)
- Option C: Have `compliance-evidence.yml` trigger `ci.yml` when it detects missing gate evidence for the release version (most elegant, but adds workflow-to-workflow coupling)

### Missing security summary upload

A related issue: `compliance-evidence.yml` had no upload path for `compliance/security-summary-<version>.md` files at the project root. The per-REQ loop only scans `compliance/evidence/REQ-*/`, and the release ticket loop only scans `compliance/pending-releases/`. Housekeeping security summaries at root were never uploaded.

**Fix:** Add a glob for `compliance/security-summary-*.md` to the upload step (filed as DevAudit-Installer#363). The fix has been applied as a local workaround in consuming projects and should be upstreamed.

---

## Rollback scenario

For a housekeeping release, rollback is the simplest case — there's no REQ to manage, no per-REQ evidence to revoke.

```bash
# 1. Revert the merge commit on main
git checkout main && git pull origin main
git revert -m 1 <merge-commit-sha>
git commit -m "revert: rollback vYYYY.MM.DD — <reason>"
git push origin main

# 2. Verify production
curl -s [PRODUCTION_URL]/[HEALTH_ENDPOINT]

# 3. Sync develop
git checkout develop && git merge main --no-edit && git push origin develop

# 4. File follow-up issue if needed
gh issue create --title "Fix: <root cause>" --body "Rolled back vYYYY.MM.DD. Root cause: ..."
```

### Post-rollback

- No post-mortem required for housekeeping releases
- The revert commit is a `revert` type — housekeeping, no REQ tag needed
- Add a "ROLLED BACK" note to the release ticket
- If the rollback is for a dependency bump, pin the old version in `package.json` before pushing the revert
