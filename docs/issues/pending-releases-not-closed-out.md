# Stale pending release tickets + cross-REQ commit scoping cause portal to show out-of-scope REQs

## Summary

Two distinct issues cause the DevAudit portal to display out-of-scope REQs (REQ-083, REQ-084) alongside the current REQ (REQ-085) under "Evidence by requirement" for the REQ-085 release:

1. **Stale pending release tickets** — REQ-083 and REQ-084 were merged to `main` via PR #407, but their release tickets were never moved from `pending-releases/` to `approved-releases/`. CI's `upload-evidence` job treats them as in-scope for every subsequent release.

2. **Cross-REQ commit subject scoping** — Commit `33c8443` (`docs: [REQ-083/084] update SRS with order status revert fix and checkout separation`) is in PR #413's diff (on `develop`, ahead of `main`). The `sdlc-implementer` skill authored this commit during REQ-085's Phase 1 SRS alignment step, but used `[REQ-083/084]` in the subject because the SRS entries describe those prior REQs. The portal's commit scanner sees `REQ-083` and `REQ-084` in the commit subject and `Ref: REQ-083, REQ-084` in the body, and associates them with the current release.

## Observed in

`wawagardenbar-app` — REQ-085 release (PR #413)

The portal release for REQ-085 showed three requirements under "Evidence by requirement": REQ-083, REQ-084, and REQ-085. Only REQ-085 should have been visible.

### GitHub confirmation

PR #407 ("Release REQ-083 + REQ-084 — Order status revert fix + Checkout separation") was **merged to `main`** on 2026-06-24 at 20:59:53Z. Both REQs were promoted to production via this single release PR. However, the release tickets were never moved from `pending-releases/` to `approved-releases/`, and the ticket status remains `TESTED - PENDING SIGN-OFF` with the audit trail still showing `TBD — PR to main pending UAT approval`.

The prior release (REQ-082, PR #403) was properly closed out — its ticket is in `approved-releases/`. The close-out step was performed for REQ-082 but skipped for REQ-083 and REQ-084.

## Root cause 1: Stale pending release tickets

The CI `upload-evidence` job determines which REQs are in-scope by iterating over every file matching `compliance/pending-releases/RELEASE-TICKET-REQ-*.md`:

```bash
for TICKET in compliance/pending-releases/RELEASE-TICKET-REQ-*.md; do
  [ -f "$TICKET" ] || continue
  REQ_ID=$(basename "$TICKET" .md | sed 's/^RELEASE-TICKET-//')
  # Skip if already in a terminal release directory
  if compgen -G "compliance/approved-releases/RELEASE-TICKET-${REQ_ID}.md" > /dev/null 2>&1 \
     || compgen -G "compliance/superseded-releases/RELEASE-TICKET-${REQ_ID}.md" > /dev/null 2>&1; then
    echo "Skipping ${REQ_ID}: already in a terminal release directory (stale pending ticket)"
    continue
  fi
  SHOT_REQS+=("$REQ_ID")
done
```

The skip check only fires if a matching ticket exists in `compliance/approved-releases/` or `compliance/superseded-releases/`. If the pending ticket was never moved to a terminal directory, the REQ remains in-scope forever — every subsequent CI run uploads evidence for it and the portal lists it under the current release.

### Why the tickets weren't moved

REQ-083 and REQ-084 were implemented via PRs #405 and #406 (to `develop`), then promoted to `main` via release PR #407 (merged 2026-06-24 20:59:53Z). The release close-out step — moving the pending ticket to `approved-releases/`, updating ticket status to `APPROVED - DEPLOYED`, and updating the RTM status — was never performed. This is a manual step in the SDLC workflow — there is no automated mechanism that moves pending tickets to terminal directories after the release PR is merged.

The prior release (REQ-082, PR #403) was properly closed out — its ticket is in `approved-releases/`. This confirms the close-out step is known and was being performed, but was skipped for the REQ-083 + REQ-084 release.

### State at time of discovery

```
compliance/pending-releases/
├── RELEASE-TICKET-REQ-083.md    ← stale (PR #407 merged to main, ticket not closed out)
├── RELEASE-TICKET-REQ-084.md    ← stale (PR #407 merged to main, ticket not closed out)
├── RELEASE-TICKET-REQ-085.md    ← current (in progress, PR #413)
├── RELEASE-TICKET-v2026.06.05.md
├── RELEASE-TICKET-v2026.06.06.md
├── RELEASE-TICKET-v2026.06.07.md
├── RELEASE-TICKET-v2026.06.09.md
└── RELEASE-TICKET-v2026.06.10.md

compliance/approved-releases/
├── RELEASE-TICKET-REQ-082.md    ← prior release, properly closed out
├── RELEASE-TICKET-REQ-081.md
├── ... (REQ-001 through REQ-082)
└── (no REQ-083 or REQ-084 tickets)

compliance/superseded-releases/
└── (empty)
```

Ticket status for both stale tickets:
- **Status field:** `TESTED - PENDING SIGN-OFF` (should be `APPROVED - DEPLOYED`)
- **PR field:** `TBD — develop → main PR pending UAT approval` (should reference PR #407)
- **Audit trail last entry:** `TBD — Submitted for review — William — PR to main pending UAT approval` (should show merge date and approval)
- **RTM status:** `TESTED - PENDING SIGN-OFF` (should be `APPROVED - DEPLOYED`)

## Root cause 2: Cross-REQ commit subject scoping (skill gap)

The second root cause is a `sdlc-implementer` skill instruction gap. During REQ-085's Phase 1 step 6 (SRS alignment), the skill authored commit `33c8443`:

```
docs: [REQ-083/084] update SRS with order status revert fix and checkout separation

Add 5 new SRS requirements:
- REQ-RT-003: order-updated payload carries top-level status (REQ-083)
- REQ-CHECKOUT-010: customer checkout Monnify-only gateway (REQ-084)
- REQ-CHECKOUT-011: anonymous browsing no login gate (REQ-084)
- REQ-ORDMGT-009: express create order order type + customer info (REQ-084)
- REQ-TABMGT-005: admin tab checkout manual payment (REQ-084)

Ref: REQ-083, REQ-084
```

This commit is in PR #413's diff (on `develop`, ahead of `main`). The work was part of REQ-085's planning phase — the skill was adding SRS stubs for prior REQs as part of REQ-085's SRS-alignment work. But the commit subject cites `[REQ-083/084]` instead of `[REQ-085]`.

The DevAudit portal's commit scanner parses `REQ-XXX` tags from commit subjects and bodies within a PR's diff. It sees `REQ-083` and `REQ-084` in the subject and `Ref: REQ-083, REQ-084` in the body, and associates them with the current release — even though those REQs were already merged to `main` via PR #407 and are not part of REQ-085's scope.

### Why the skill got it wrong

Phase 1 step 6 instructs the skill to update `docs/SRS.md` with new stubs after `requirements-aligner` returns. But the step doesn't specify how to scope the commit message when the SRS update adds entries for REQs other than the active one. The skill used `[REQ-083/084]` in the subject because those are the REQs the SRS entries describe, not the REQ driving the current SDLC flow (REQ-085).

### The fix: commit-scoping rule for SRS updates

The commit subject must always cite the **active REQ** — the REQ driving the current SDLC flow — not the REQs whose SRS entries are being added or updated. Other REQs may appear in the body for traceability, but never in the subject.

**Rule:** When a commit is authored as part of REQ-XXX's SDLC flow, the commit subject must cite `[REQ-XXX]` regardless of which other REQs the content touches. Other REQs appear in the body only.

**Example — correct:**
```
docs: [REQ-085] add SRS stubs for REQ-083/084/085 — order status revert, checkout separation, tab payment

Add 5 new SRS requirements:
- REQ-RT-003: order-updated payload carries top-level status (REQ-083)
- REQ-CHECKOUT-010: customer checkout Monnify-only gateway (REQ-084)
...

Ref: REQ-083, REQ-084
```

**Example — incorrect (what happened):**
```
docs: [REQ-083/084] update SRS with order status revert fix and checkout separation
```

This is a one-paragraph addition to `sdlc-implementer` Phase 1 step 6 (or a general commit-scoping rule at the top of the skill). No new skill is needed — `sdlc-implementer` already authors these commits, it just needs the scoping rule.

## Impact

1. **Portal audit trail pollution** — the portal release for REQ-085 shows evidence for REQ-083 and REQ-084, making it appear that all three REQs were part of the same release. Auditors reviewing the release cannot distinguish which evidence belongs to which REQ's release.

2. **Evidence upload waste** — CI uploads screenshots and gate evidence for stale REQs on every run, consuming portal API quota and CI time.

3. **Evidence-completeness gate false positives** — the `ZERO_Screenshot_REQS` check (DevAudit-Installer #169) may flag stale REQs as having zero screenshots, potentially failing the job for the wrong reason.

4. **Release PR confusion** — the release PR for REQ-085 lists all three REQs in its body, making it unclear which REQ is actually being released.

## Proposed solutions

### For root cause 1 (stale pending tickets)

#### Option 1A: Automated close-out on portal approval (recommended)

Add a CI step or CLI command that runs after portal approval and moves the pending ticket to `approved-releases/`:

- After the `approval-gate` job passes, add a step that moves `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md` to `compliance/approved-releases/`
- Commit the move on the integration branch (`develop`)
- This ensures the ticket is moved automatically — no manual step required

**Pros:** Machine-enforced, no manual step, consistent with the SDLC's "gates not prose" principle
**Cons:** Requires CI to commit to the integration branch (may need a bot token); adds a new CI step

#### Option 1B: Pre-push hook check for stale tickets

Add a check to the pre-push hook that scans `compliance/pending-releases/` for tickets whose RTM status is `APPROVED - DEPLOYED` or `TESTED - PENDING SIGN-OFF` with a merged PR. If found, refuse the push with: "Stale pending release ticket for REQ-XXX. Move to approved-releases/ before pushing."

**Pros:** Catches the problem before push, no CI changes
**Cons:** The hook can't easily check portal approval status; `TESTED - PENDING SIGN-OFF` is not the same as approved; `--no-verify` bypass exists

#### Option 1C: CI warning on stale tickets

Add a CI step (not a gate, just a warning) that checks for pending tickets whose RTM status is terminal and logs a warning. This doesn't fix the problem but makes it visible.

**Pros:** Minimal change, no enforcement
**Cons:** Warnings get ignored; doesn't fix the portal pollution

### For root cause 2 (cross-REQ commit subject scoping)

#### Option 2A: Commit-scoping rule in sdlc-implementer SKILL.md (recommended)

Add a commit-scoping rule to `sdlc-implementer` Phase 1 step 6 (SRS alignment) — or as a general rule at the top of the skill:

- Commit subject must always cite the active REQ (the REQ driving the current SDLC flow)
- Other REQs whose SRS entries are being added/updated may appear in the body for traceability, but never in the subject
- Format: `docs: [REQ-<active>] <description> — touches SRS entries for REQ-<other>`

**Pros:** Fixes the root cause at the skill level; no CI or portal changes; one-paragraph addition
**Cons:** Still prose-level (skill can deviate); doesn't fix already-pushed commits

#### Option 2B: Commitlint rule for single-REQ subjects

Add a commitlint rule that rejects subjects with multiple `[REQ-XXX]` tags — only one REQ per subject.

**Pros:** Machine-enforced at commit time; catches the exact pattern
**Cons:** Legitimate multi-REQ commits (e.g. a release PR merging REQ-083 + REQ-084) would be blocked; too restrictive

#### Option 2C: Portal-side fix — ignore REQs already in approved-releases

Modify the portal's commit scanner to skip REQs that already have an approved release record.

**Pros:** Fixes the symptom at the portal level; no skill or CI changes
**Cons:** Portal-side change (out of DevAudit-Installer's control); doesn't fix the commit subject for audit trail purposes; the commit still incorrectly cites the wrong REQ

## Recommended approach

**Option 1A (automated close-out) + Option 2A (commit-scoping rule)** — both root causes need to be addressed:

1. **Option 1A** fixes the stale ticket problem — automated close-out ensures pending tickets are moved to `approved-releases/` after portal approval, so CI stops treating them as in-scope.
2. **Option 2A** fixes the commit subject scoping — the skill cites the active REQ in the subject, preventing the portal's commit scanner from associating out-of-scope REQs with the current release.

Both are root-cause fixes. Option 1A is machine-enforced (CI step). Option 2A is a skill instruction (prose-level, but the skill authors these commits so it's the right layer).

## Immediate fix (for wawagardenbar-app)

### Fix 1: Move stale tickets to approved-releases/

```bash
mv compliance/pending-releases/RELEASE-TICKET-REQ-083.md compliance/approved-releases/
mv compliance/pending-releases/RELEASE-TICKET-REQ-084.md compliance/approved-releases/
git add compliance/pending-releases/ compliance/approved-releases/
git commit -m "chore: close out stale pending release tickets for REQ-083 and REQ-084"
```

This stops CI from treating them as in-scope for the REQ-085 release.

### Fix 2: Amend the cross-REQ commit subject (if not yet pushed)

If commit `33c8443` has not been pushed to the remote, amend it:

```bash
git rebase -i 33c8443~1
# Change pick to reword for 33c8443
# New subject: docs: [REQ-085] add SRS stubs for REQ-083/084/085 — order status revert, checkout separation, tab payment
```

If already pushed, the commit cannot be amended without a force-push. The portal will continue to show REQ-083/084 in the commit history. The stale ticket fix (Fix 1) is sufficient to remove them from "Evidence by requirement" — the commit subject fix is preventive for future releases.

## Acceptance criteria

### Stale pending ticket close-out
- [ ] CI automatically moves pending release tickets to `approved-releases/` after portal approval
- [ ] Stale pending tickets (RTM status `APPROVED - DEPLOYED` with merged PR) are detected and moved or flagged
- [ ] Portal release for a single REQ only shows that REQ under "Evidence by requirement"
- [ ] Test: a pending ticket moved to `approved-releases/` is skipped by `upload-evidence`
- [ ] Test: a pending ticket left in `pending-releases/` after approval is automatically moved by CI
- [ ] Test: the portal release for REQ-085 does not show REQ-083 or REQ-084

### Cross-REQ commit subject scoping
- [ ] `sdlc-implementer` SKILL.md includes a commit-scoping rule: subject must cite the active REQ, not other REQs whose content is touched
- [ ] SRS alignment commits (Phase 1 step 6) cite `[REQ-<active>]` in the subject, with other REQs in the body only
- [ ] Test: an SRS update commit authored during REQ-085's flow that adds SRS entries for REQ-083/084 uses `[REQ-085]` in the subject
- [ ] Test: the portal's commit scanner does not associate REQ-083/084 with the REQ-085 release when the subject cites only `[REQ-085]`

## References

- `sdlc/files/ci/ci.yml.template` — `upload-evidence` job, pending-releases iteration logic
- `compliance/pending-releases/` — directory containing active release tickets
- `compliance/approved-releases/` — terminal directory for approved release tickets
- `compliance/superseded-releases/` — terminal directory for superseded release tickets
- DevAudit-Installer #147 — per-REQ glob scoping (the skip check for terminal directories)
- DevAudit-Installer #192 — skip REQs already in terminal release directories
- DevAudit-Installer #169 — evidence-completeness gate (may false-positive on stale REQs)
- wawagardenbar-app commit `33c8443` — `docs: [REQ-083/084] update SRS with order status revert fix and checkout separation` (authored by `sdlc-implementer` during REQ-085 Phase 1 SRS alignment, incorrectly scoped subject)
- `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` Phase 1 step 6 — SRS alignment step where the cross-REQ commit was authored (no commit-scoping rule)
- DevAudit portal commit scanner — parses `REQ-XXX` from commit subjects and bodies within a PR's diff to associate REQs with releases
- wawagardenbar-app PR #405 — REQ-083 implementation (to develop)
- wawagardenbar-app PR #406 — REQ-084 implementation (to develop)
- wawagardenbar-app PR #407 — Release REQ-083 + REQ-084 (to main, merged 2026-06-24 20:59:53Z, close-out skipped)
- wawagardenbar-app PR #403 — Release REQ-082 (to main, merged, properly closed out to approved-releases/)
- wawagardenbar-app PR #413 — REQ-085 (current, portal showing out-of-scope REQs)
