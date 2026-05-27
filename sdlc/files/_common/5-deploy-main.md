---
description: Merge approved PR, verify deployment including security checks, sync branches, finalize compliance
---

# Deploy to Production

**Pipeline Stage:** 5 of 5
**Previous:** `4-submit-for-review.md` (after PR approved and CI passed)
**References:** Test Plan (post-deploy verification, DR targets), Test Strategy (`sdlc/files/Test_Strategy.md` in DevAudit)

---

## Prerequisites

- All CI checks passed (enforced by branch protection)
- **LOW risk:** Self-merged after CI passed
- **MEDIUM/HIGH risk:** PR approved by a second human reviewer, no unresolved review comments
- UAT-environment verification passed (only if Stage 3 Step 10 applied — opt-in by risk class)
- **Release approved in DevAudit** (Stage 3 Step 11, verified by Release Approval Gate on the PR)

## Steps

### Step 1: Merge the PR

**Option A: GitHub CLI (Preferred)**
```bash
gh pr list --head develop --json number --jq '.[0].number'
gh pr merge [PR-NUMBER] --merge --delete-branch=false
```

**Option B: GitHub Web UI**
1. Open PR → **Merge pull request** → "Create a merge commit" → **Confirm merge**

**Do NOT delete `develop`** — it's the permanent working branch.

### Step 2: Sync Branches

```bash
git checkout main && git pull origin main
git checkout develop && git pull origin develop
git merge main --no-edit && git push origin develop
```

### Step 3: Verify Production Deployment

Wait for auto-deploy to complete, then:

```bash
# Health check
curl -s [PRODUCTION_URL]/[HEALTH_ENDPOINT]
# Expected: success response
```

If it fails, check hosting platform logs. See deployment reference doc for troubleshooting.

### Step 3a: Run Post-Deploy Actions (if any)

Check the release ticket's **Post-Deploy Actions** section. If actions are listed:

1. Run each action in order against the **production** environment
2. Verify each completes successfully before proceeding
3. Record results in the release ticket's Audit Trail

```bash
# Example: data migration
npx tsx scripts/backfill-x.ts "[PROD_CONNECTION_STRING]"
# Verify: check output for success, record row counts
```

If the release ticket says "No post-deploy actions required", skip to Step 4.

> **Important:** Run post-deploy actions BEFORE smoke tests. Smoke tests should verify the application works with the migration applied.

### Production Verification Policy

Production verification is **read-only and non-destructive**. It confirms the deployment succeeded and the application is accessible. It does NOT exercise application logic.

| Allowed (read-only) | NOT allowed (destructive) |
|---------------------|--------------------------|
| Health checks (HTTP GET) | E2E tests (Playwright) |
| Public endpoint status codes | Database operations |
| Security header inspection | API mutations (POST/PUT/DELETE) |
| Auth redirect verification | Test data creation |
| Smoke test (homepage loads) | Authenticated flows |

E2E tests run on `develop` (CI) and UAT — never production. The `post-deploy-prod.yml` workflow automates the read-only checks below.

### Step 4: Production Smoke Test

```bash
curl -s [PRODUCTION_URL]/[PUBLIC_ENDPOINT] | head -c 200
curl -s -o /dev/null -w "%{http_code}" [PRODUCTION_URL]/
# Expected: 200
```

### Step 5: Production Security Verification

```bash
# Access control
curl -s -o /dev/null -w "%{http_code}" [PRODUCTION_URL]/[ADMIN_ENDPOINT]
# Expected: 401 or 403

# Security headers
curl -s -I [PRODUCTION_URL]/ | grep -iE 'x-frame-options|x-content-type|strict-transport|content-security'

# No stack traces
curl -s [PRODUCTION_URL]/[NONEXISTENT_ENDPOINT]
# Expected: generic error
```

Record results:
```bash
cat >> compliance/evidence/REQ-XXX/security-summary.md << EOF

## Production Post-Deploy Verification — $(date -I)
- PROD Health check: PASS
- PROD Admin auth check: PASS
- PROD Security headers: PASS
- PROD No stack traces: PASS
- PROD URL: [PRODUCTION_URL]
EOF
```

### Step 5a: Post-Deploy Release Approval in DevAudit (CONDITIONAL)

**When this step applies:** Project's `sdlc-config.json` has `production_review.terminal_status: "prod_review"` (the default in sdlc-v1.22.0+). The `post-deploy-prod.yml` workflow has just PATCHed the release to status `prod_review` and is now waiting for human acknowledgement.

**When to skip:** Project has `production_review.terminal_status: "released"` (Option B — preserves v1.21.x auto-release behaviour). The workflow has already advanced the release to `released` and no human clicks are needed.

#### What this step is for

The post-deploy approval gate captures an explicit audit trail: a named human (or auto-approver, depending on `approval.mode`) attests that they verified production behaved correctly after deploy, separate from the pre-merge Release Approval. Two distinct events are recorded:
1. `release.production_approved` — human reviewed prod smoke results + did any extra checks they consider appropriate.
2. `release.released` — human formally closed out the release lifecycle.

The backend stores both with reviewer identity, SHA, and timestamp. This satisfies SOC2 CC7.4 (post-deployment monitoring) and ISO 29119 §5.6 (release closure).

#### Steps

1. Wait for `post-deploy-prod.yml` to complete (the workflow's "Advance release status" step prints `Release vYYYY.MM.DD → prod_review` when done).
2. Open the release in DevAudit: `https://[DEVAUDIT_BASE_URL]/projects/[PROJECT_SLUG]/releases/[releaseId]`.
3. Review the `prod-smoke-results.json` evidence (uploaded by the workflow) plus any post-deploy actions logged in the release ticket.
4. Click **Approve Production** — status transitions to `prod_approved`.
5. Click **Mark as Released** — status transitions to `released`. Pipeline lifecycle complete in DevAudit.

If the smoke results look wrong or a manual verification fails, click **Reject** on the production approval and follow the Rollback procedure below before retrying.

#### Approver mode (same as Stage 3 Step 11)

`approval.mode` is checked again here. `dual_actor` means the post-deploy approver must differ from the release creator. `solo_with_gap` accepts self-approval but records the control gap. `auto_low_risk` allows LOW-risk requirements to auto-advance through both transitions on workflow completion; MEDIUM/HIGH always require a human click.

### Step 6: Finalize Compliance (Tracked Requirements Only)

> **Automated path (preferred).** Run the synced helper instead of doing this by hand — it flips the ticket Status → `RELEASED` (+ backlinks the release PR and records the sign-off), flips the matching `RTM.md` row, and `git mv`s the ticket to `approved-releases/`, then stages the changes for you to commit:
>
> ```bash
> ./scripts/close-out-release.sh REQ-XXX --release-pr <release-PR-#>
> git add -A && git commit -m "docs(compliance): close out REQ-XXX release ticket (RELEASED)" && git push origin develop
> ```
>
> It is **idempotent** (a no-op if already closed out) and, when `DEVAUDIT_API_KEY` + `DEVAUDIT_BASE_URL` are set, **refuses** unless the portal reports the release as `released` (so you can't flip the local tree ahead of the Production approval). The `close-out-release.yml` workflow runs the same script automatically when the portal marks a release released (and is `workflow_dispatch`-able for catch-up). The manual steps below are the fallback / reference for what the script does.

```bash
mv compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md compliance/approved-releases/
```

Update `compliance/RTM.md`:
```markdown
| REQ-XXX | Description | [RISK] | files | evidence | APPROVED - DEPLOYED | [Reviewer] | [Date] |
```

Add audit trail to release ticket:
```markdown
| [date] | UAT verification passed | [who] | Health + smoke + feature verified on UAT |
| [date] | PR approved | [reviewer] | PR #[number] |
| [date] | CI verification | GitHub Actions | All gates passed independently |
| [date] | Deployed to production | System | Auto-deploy from main |
| [date] | PROD post-deploy verification | [who] | Health + security checks passed on PROD |
```

```bash
git add compliance/RTM.md compliance/approved-releases/ compliance/evidence/REQ-XXX/
git rm compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md 2>/dev/null
git commit -m "compliance: [REQ-XXX] approved and deployed - PR #[number]"
git push origin develop
```

### Step 7: Close the GitHub Issue

If the requirement was linked to a GitHub Issue, close it with a reference to the PR:

```bash
gh issue close [ISSUE-NUMBER] --comment "Implemented in PR #[PR-NUMBER] (REQ-XXX). [Brief summary of what was delivered]."
```

This is the final traceability link: Issue → Requirement → PR → Deployment → Issue closed.

### Step 8: Final Sync

```bash
git checkout main && git merge develop --no-edit && git push origin main
git checkout develop
```

## Rollback

1. **Hosting dashboard:** Redeploy previous version
2. **Git:** `git checkout main && git revert HEAD --no-edit && git push origin main`
3. **Document:** Add rollback entry to release ticket audit trail

### Environment Summary

If the project uses separate UAT and Production environments:

| Environment | Branch | Auto-deploy | Purpose |
|-------------|--------|-------------|---------|
| UAT | `develop` | Yes | Pre-PR verification — CI evidence uploaded to DevAudit, reviewed and approved before PR |
| Production | `main` | Yes | Live deployment after PR approval — post-deploy evidence captured and uploaded to DevAudit |

UAT-environment verification (if applicable per risk class) and Release Approval are completed in workflow 3 before the PR is created. After merge to main, the post-deploy workflow runs smoke tests against production, uploads evidence to DevAudit (environment=production), and advances the release to `production_review.terminal_status` from `sdlc-config.json` (default `prod_review` — human acknowledges via portal; or `released` — auto-release).

### Automated Post-Deploy Workflow

If your project has `post-deploy-prod.yml` (template in `sdlc/files/ci/`), Steps 3-4 are handled automatically by CI after merge. The workflow:

1. Waits for deployment to propagate
2. Runs production smoke tests (health check, key endpoints)
3. Uploads production evidence to DevAudit with `--environment production`
4. Advances the release to `production_review.terminal_status` from `sdlc-config.json`:
   - **`prod_review` (default, Option A)** — stops at `prod_review`, expects a human to walk Step 5a (Approve Production → Mark as Released) in the DevAudit portal. Captures two named audit events post-deploy.
   - **`released` (Option B)** — PATCHes straight to `released`, no human click expected. Preserves v1.21.x behaviour for projects that don't want post-deploy ceremony.

Manual verification (Step 5: security checks) is still recommended for MEDIUM/HIGH risk releases regardless of which terminal_status is configured.

---

## Output

- PR merged, production deployment verified
- Production security verification passed
- Branches synced
- Release ticket finalized
- RTM: `APPROVED - DEPLOYED`

## Pipeline Complete

```
Requirement (RTM + Risk)
  → Test Scope (planned before implementation)
    → AI Use Documented
      → Implementation (develop)
        → Local Gates (SAST + deps + E2E — comprehensive)
          → Evidence Compiled
            → UAT Verification (auto-deployed from develop)
              → PR Created → CI Gates (independent verification)
                → Review (LOW: self-merge | MEDIUM/HIGH: second reviewer)
                  → PROD Deployment (auto-deploy from main)
                    → PROD Verification (health + security)
                      → Finalization (RTM closed)
```
