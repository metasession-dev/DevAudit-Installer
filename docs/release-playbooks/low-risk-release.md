# Playbook: low-risk release

> A **tracked** release (`REQ-XXX`) for a **Low** risk change. The lightest tracked path: no implementation plan, no plan-approval pause, lighter evidence, and **self-merge after CI** — but it is still a real requirement with its own release record and still passes through the gates and a UAT approval.

| | |
| --- | --- |
| **Use when** | Internal tools, UI-only changes, configuration, in-code docs, or anything with no regulated data, no auth changes, and limited blast radius — and **no AI involvement that would bump the tier** (AI on a user-facing feature is Medium/High, not Low). |
| **Version shape** | `REQ-XXX` (tracked) — a `feat` / `fix` / `refactor` / `perf` commit. commitlint **rejects** these without a `[REQ-XXX]` tag. |
| **Stage 1 (Plan)** | Light. Implementation plan **skipped**; no plan-approval pause. |
| **Reviewer** | Not required. The author **may self-merge** once CI is green — CI is the independent verification. |
| **Approvals** | Still goes through the portal lifecycle. Under `auto_low_risk` mode, Low **auto-approves** at UAT on evidence upload; under `dual_actor`, a human still clicks approve. |
| **Gates** | TypeScript 0 · SAST 0 above baseline · dep-audit 0 unaccepted high/critical · E2E all pass · build — all green. |

Two ways to run it. **Track A** uses Claude Code (you type two prompts, no plan pause). **Track B** is by hand. New here? Skim [`README.md`](./README.md) for the risk tiers and the four-eyes lifecycle.

---

## Track A — with Claude Code (the AI path)

A low-risk change is the smoothest AI run: there's **no plan-approval pause**, so you type two prompts and the only human gate is review/merge and the portal approval.

### 1. Kick it off

```
Implement issue #N under the SDLC.
```

`sdlc-implementer` triages, classifies the change as **Low**, and — because Low passes straight through — does **not** stop for plan approval. If it asks you to confirm the classification, reply `Proceed`. (If it over-classifies, you can correct it: `this is LOW risk`.) It then, unattended: writes tests, implements, runs all local gates, delegates the E2E pack to `e2e-test-engineer`, compiles the lighter Low evidence (test-scope, test-plan, test-execution-summary, security summary, release ticket — **no** implementation plan; AI is recorded with just a `Co-Authored-By` tag), pushes to `develop`, and opens the release PR.

### 2. Hard stop at the release PR

Phase 4 ends with the PR open and UAT review requested. For a Low-risk change the author **may self-merge** once CI is green — but the release still needs to be `uat_approved` on the portal for the merge gate to pass:

- If the project runs `auto_low_risk` approval mode, the Low release **auto-approves** at UAT and you can merge as soon as CI is green.
- Otherwise a human clicks **Approve** on the portal (it can be you — `dual_actor` is the four-eyes mode; Low under `dual_actor` still wants a click but doesn't require a *second* reviewer the way Medium/High does).

### 3. Resume for production

```
resume REQ-XXX
```

Phase 5 merges to `main`, watches the deploy, runs the read-only production smoke, and drives the release to `prod_review` (or straight to `released` if the project uses the auto-release terminal status). Approve/mark released on the portal if prompted, and the agent closes out the ticket and the issue.

> **Other agents:** point Cursor / Windsurf / Gemini / Copilot at the synced `INSTRUCTIONS.md` and run the stages with the sample prompts in [`../../sdlc/files/_common/implementing-an-sdlc-issue.md`](../../sdlc/files/_common/implementing-an-sdlc-issue.md). Same sequence as Track B.

---

## Track B — by hand (no AI agent)

The five stages, manually. Low-risk skips the implementation plan and the second reviewer.

### Stage 1 — Plan the requirement (`1-plan-requirement.md`)

```bash
gh issue view 123
grep -oP 'REQ-\d+' compliance/RTM.md | sort -t- -k2 -n | tail -1

# RTM row (Part B), risk LOW:
#   | REQ-XXX | #NNN | LOW | compliance/evidence/REQ-XXX/ | DRAFT | -- | -- |
mkdir -p compliance/evidence/REQ-XXX

# NO implementation plan for LOW — skip straight to test-scope (the LOW variant: gates only).
$EDITOR compliance/evidence/REQ-XXX/test-scope.md
$EDITOR compliance/evidence/REQ-XXX/test-plan.md

git add compliance/RTM.md compliance/evidence/REQ-XXX
git commit -m "compliance: [REQ-XXX] define requirement and test scope - <desc> [RISK: LOW]

Ref: REQ-XXX
Closes: #NNN"
```

> For Low, a `Co-Authored-By` commit tag is sufficient AI documentation — no `ai-use-note.md` / detailed prompt record needed.

### Stage 2 — Implement & test (`2-implement-and-test.md`)

```bash
git branch --show-current            # must be: develop

# Write unit tests, implement, tag the code @requirement REQ-XXX.
# Run ALL local gates — same gates as every tier:
npx tsc --noEmit
semgrep scan --config auto [SOURCE_DIR]/ --severity ERROR --severity WARNING
npm audit --audit-level=high
npx playwright test

git add <only the files for this change>
git commit -m "feat: <desc>

Ref: REQ-XXX"
git push origin develop
gh run watch                          # confirm CI green
```

### Stage 3 — Compile evidence (`3-compile-evidence.md`)

```bash
gh run list --branch develop --limit 1

# Author the per-REQ evidence (lighter than High — no implementation plan to close out):
#   - test-execution-summary.md, security-summary.md
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX e2e_result <path>
semgrep scan --config auto [SOURCE_DIR]/ --json > /tmp/sast.json
npm audit --json > /tmp/dep.json
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX sast_report /tmp/sast.json --git-sha "$(git rev-parse HEAD)"
./scripts/upload-evidence.sh [PROJECT_SLUG] REQ-XXX dependency_audit /tmp/dep.json --git-sha "$(git rev-parse HEAD)"

# RTM → "TESTED - PENDING SIGN-OFF"; write the release ticket:
$EDITOR compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md

git add compliance/RTM.md compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md compliance/evidence/REQ-XXX
git commit -m "compliance: [REQ-XXX] evidence compiled - awaiting review"
git push origin develop
gh run watch --workflow "Compliance Evidence Upload"

# Submit for UAT review (draft → uat_review):
./scripts/submit-for-uat-review.sh [PROJECT_SLUG] REQ-XXX
```

### Stage 4 — Submit for review (`4-submit-for-review.md`)

```bash
gh pr create --base main --head develop --title "feat: <desc>" --body "<SDLC body; link the release ticket>"
gh pr checks <PR>
gh pr view <PR> --json mergeable,mergeStateStatus

# LOW: once CI is green and the release is uat_approved (auto under auto_low_risk,
# or one click under dual_actor), the author MAY self-merge:
gh pr merge <PR> --merge --delete-branch=false
```

CI is the independent verification for a Low-risk self-merge — no second human reviewer is required (that's the Medium/High rule).

### Stage 5 — Deploy to production (`5-deploy-main.md`)

```bash
git checkout main && git pull origin main
git checkout develop && git merge main --no-edit && git push origin develop

curl -s [PRODUCTION_URL]/[HEALTH_ENDPOINT]          # read-only prod checks only

# If the project keeps the default prod_review terminal status, a human Approves
# Production + Marks Released on the portal. (Option-B projects auto-release.)
./scripts/close-out-release.sh REQ-XXX --release-pr <release-PR-#>
git add -A && git commit -m "docs(compliance): close out REQ-XXX release ticket (RELEASED)" && git push origin develop
gh issue close <ISSUE> --comment "Shipped in REQ-XXX."
git checkout main && git merge develop --no-edit && git push origin main
```

---

## What makes this the *low-risk* path (vs high-risk)

- **No implementation plan, no plan-approval pause.** You go straight from the RTM row to test-scope to code.
- **Self-merge on green CI.** No second human reviewer required — CI is the independent check.
- **Lighter evidence.** The LOW test-scope is gates-only; AI is documented with a commit tag, not a detailed prompt record.
- **Optional auto-approval.** Under `auto_low_risk`, the UAT approval happens automatically on evidence upload (Medium/High never auto-approve).

It is still a **tracked** release: a real `REQ-XXX`, its own release record, the full CI gate set, and a portal approval before it can reach production. The only things stripped are the planning ceremony and the mandatory second reviewer.

## Quick reference

| Step | Track A (Claude) | Track B (manual) |
| --- | --- | --- |
| Start | `Implement issue #N under the SDLC.` | Stage 1: RTM row + LOW test-scope (no plan) |
| Plan approval | *(none — Low passes through)* | *(none)* |
| Build + test + evidence | (automatic) | Stages 2–3: tests, gates, upload, release ticket |
| Submit for UAT | (automatic, hard stop) | `submit-for-uat-review.sh`, open PR |
| UAT approval | auto (`auto_low_risk`) or one click | auto or one click |
| Ship | `resume REQ-XXX` | Stage 4: **self-merge**; Stage 5: prod checks |
| Close out | (automatic) | `close-out-release.sh`, close issue |

---

## Hotfix scenario

A low-risk hotfix is rare — most production emergencies are HIGH risk. But if a low-risk issue (e.g. a UI text fix, a config tweak) needs to ship urgently, the process is simpler than the high-risk hotfix: **no plan-approval pause, self-merge allowed, lighter evidence.**

### Track A — AI-driven hotfix

```text
Hotfix issue #N — low-risk UI/config fix needed urgently. Implement under the SDLC.
```

The agent classifies it as Low, skips the plan pause, and proceeds straight through. The only human gate is the portal approval (auto under `auto_low_risk`, one click under `dual_actor`).

### Track B — manual hotfix

```bash
# 1. Branch from main (hotfix) or develop (urgent fix)
git checkout main && git pull origin main
git checkout -b fix/hotfix-<desc>

# 2. No plan needed for LOW — fix directly
# 3. Run ALL gates (no shortcuts even for low-risk hotfixes)
npx tsc --noEmit
semgrep scan --config auto [SOURCE_DIR]/ --severity ERROR --severity WARNING
npm audit --audit-level=high
npx playwright test

# 4. Commit with REQ tag
git add <files>
git commit -m "fix: <hotfix description>

Ref: REQ-XXX"

# 5. PR to main (hotfix) or develop (urgent)
gh pr create --base main --head fix/hotfix-<desc> --title "fix: <desc>" --body "HOTFIX — low risk. Ref: REQ-XXX"

# 6. Evidence: test-execution-summary.md + security-summary.md (brief)
# 7. Submit for UAT, approve (auto or one click), merge, prod checks
# 8. Sync develop
git checkout develop && git merge main --no-edit && git push origin develop
```

---

## Superseding a previous release

### When the superseded release is still on `develop`

1. **Fix-forward on `develop`:** add a fix commit, same REQ
2. The release PR picks up the fix — no new PR needed
3. No portal action

```bash
git add <fix files>
git commit -m "fix: <defect description> — supersedes broken commit <sha>

Ref: REQ-XXX"
git push origin develop
gh run watch
```

### When the superseded release is merged to `main` but not yet `released`

For a low-risk change, **fix-forward** is preferred over revert (the blast radius is small):

```bash
git checkout develop
# ... fix ...
git commit -m "fix: <defect description>

Ref: REQ-XXX"
git push origin develop
gh pr create --base main --head develop --title "fix: <desc> (supersedes REQ-XXX)" --body "..."
```

1. Mark the old release as **SUPERSEDED** on the portal (if supported)
2. Regenerate `BUNDLED-CHANGES-REQ-XXX.md` and `BUNDLED-CHANGES-REQ-XXX.json` so the successor release explicitly lists the absorbed predecessor and any inherited housekeeping work
3. The successor release's close-out must move the absorbed predecessor ticket into `compliance/superseded-releases/` with `**Superseded by:** <successor>` and the supersession reason
4. The new release carries its own evidence

### When already `released` on the portal

This is a rollback — see below.

---

## Triage: defect found during feature → develop

### Case 1: Defect is in the new code (same REQ)

Fix in-place, same branch, same REQ. No ceremony for Low risk.

```bash
git add <fix files>
git commit -m "fix: <defect description>

Ref: REQ-XXX"
```

### Case 2: Defect is in existing code (pre-existing, found by coincidence)

1. File a new issue
2. For Low risk, the decision is simpler — if the fix is small, fix it inline; if large, defer
3. If deferring, continue with the feature and handle the defect separately

```bash
gh issue create --title "Defect: <description>" --body "Found during REQ-XXX implementation."
```

### Case 3: E2E regression found during feature development

1. File a regression issue
2. For Low risk, the regression is unlikely to be in a critical path — file the issue and continue
3. If the regression blocks the feature (shared component), fix inline with the same REQ

---

## Triage: defect found during develop → main (release PR)

### Case 1: CI gate failure

Fix-forward on `develop`. The release PR picks up the fix.

```bash
git add <fix files>
git commit -m "fix: <gate failure description>

Ref: REQ-XXX"
git push origin develop
gh run watch
```

### Case 2: Compliance validation failure

Same approach as high-risk — add a retroactive compliance commit if needed:

```bash
git add compliance/RTM.md compliance/evidence/REQ-XXX/ compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md
git commit -m "compliance: [REQ-XXX] retroactive attribution for fix commit <sha>

Ref: REQ-XXX"
git push origin develop
```

### Case 3: E2E regression on the release PR

1. Triage: caused by this release or pre-existing flaky test?
2. **Caused by this release:** fix-forward, same REQ
3. **Pre-existing:** file a regression issue; for Low risk, don't block the PR unless the regression is in the same area

```bash
gh issue create --title "E2E regression: <spec name> — <error>" --label "bug" --body "..."
```

### Case 4: Reviewer finds a defect

1. **Blocker:** fix-forward on `develop`, re-request review
2. **Non-blocker:** file a follow-up issue, self-merge the PR (Low risk allows self-merge), fix in the next release

---

## Rollback scenario

For a low-risk release, rollback is straightforward — the blast radius is small.

```bash
# 1. Revert the merge commit on main
git checkout main && git pull origin main
git revert -m 1 <merge-commit-sha>
git commit -m "revert: rollback REQ-XXX — <reason>

Ref: REQ-XXX"
git push origin main

# 2. Verify production
curl -s [PRODUCTION_URL]/[HEALTH_ENDPOINT]

# 3. Sync develop
git checkout develop && git merge main --no-edit && git push origin develop

# 4. File follow-up issue
gh issue create --title "Fix: <root cause>" --body "Rolled back REQ-XXX. Root cause: ..."
```

### Post-rollback

- No post-mortem required for Low risk (save for HIGH/CRITICAL)
- The follow-up fix gets a new REQ or reuses the original issue
- Update the release ticket with a "ROLLED BACK" note
