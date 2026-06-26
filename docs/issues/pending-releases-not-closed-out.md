# Stale pending release tickets cause portal to show out-of-scope REQs

## Summary

When a tracked REQ's release ticket remains in `compliance/pending-releases/` after the REQ is completed and approved, CI's `upload-evidence` job continues to treat it as in-scope for every subsequent release. This causes the DevAudit portal to display out-of-scope REQs (e.g. REQ-083, REQ-084) alongside the current REQ (REQ-085) under "Evidence by requirement" for the current release.

## Observed in

`wawagardenbar-app` — REQ-085 release (PR #413)

The portal release for REQ-085 showed three requirements under "Evidence by requirement": REQ-083, REQ-084, and REQ-085. Only REQ-085 should have been visible.

## Root cause

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

REQ-083 (PR #405) and REQ-084 (PR #406) were completed and their RTM status updated to `TESTED - PENDING SIGN-OFF`. However, the release close-out step (moving the pending ticket to `approved-releases/`) was never performed. This is a manual step in the SDLC workflow — there is no automated mechanism that moves pending tickets to terminal directories after portal approval.

### State at time of discovery

```
compliance/pending-releases/
├── RELEASE-TICKET-REQ-083.md    ← stale (completed, PR #405 merged)
├── RELEASE-TICKET-REQ-084.md    ← stale (completed, PR #406 merged)
├── RELEASE-TICKET-REQ-085.md    ← current (in progress, PR #413)
├── RELEASE-TICKET-v2026.06.05.md
├── RELEASE-TICKET-v2026.06.06.md
├── RELEASE-TICKET-v2026.06.07.md
├── RELEASE-TICKET-v2026.06.09.md
└── RELEASE-TICKET-v2026.06.10.md

compliance/approved-releases/
└── (empty — no REQ-083 or REQ-084 tickets)

compliance/superseded-releases/
└── (empty)
```

## Impact

1. **Portal audit trail pollution** — the portal release for REQ-085 shows evidence for REQ-083 and REQ-084, making it appear that all three REQs were part of the same release. Auditors reviewing the release cannot distinguish which evidence belongs to which REQ's release.

2. **Evidence upload waste** — CI uploads screenshots and gate evidence for stale REQs on every run, consuming portal API quota and CI time.

3. **Evidence-completeness gate false positives** — the `ZERO_Screenshot_REQS` check (DevAudit-Installer #169) may flag stale REQs as having zero screenshots, potentially failing the job for the wrong reason.

4. **Release PR confusion** — the release PR for REQ-085 lists all three REQs in its body, making it unclear which REQ is actually being released.

## Proposed solutions

### Option 1: Automated close-out on portal approval (recommended)

Add a CI step or CLI command that runs after portal approval and moves the pending ticket to `approved-releases/`:

- After the `approval-gate` job passes, add a step that moves `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md` to `compliance/approved-releases/`
- Commit the move on the integration branch (`develop`)
- This ensures the ticket is moved automatically — no manual step required

**Pros:** Machine-enforced, no manual step, consistent with the SDLC's "gates not prose" principle
**Cons:** Requires CI to commit to the integration branch (may need a bot token); adds a new CI step

### Option 2: Pre-push hook check for stale tickets

Add a check to the pre-push hook that scans `compliance/pending-releases/` for tickets whose RTM status is `APPROVED - DEPLOYED` or `TESTED - PENDING SIGN-OFF` with a merged PR. If found, refuse the push with: "Stale pending release ticket for REQ-XXX. Move to approved-releases/ before pushing."

**Pros:** Catches the problem before push, no CI changes
**Cons:** The hook can't easily check portal approval status; `TESTED - PENDING SIGN-OFF` is not the same as approved; `--no-verify` bypass exists

### Option 3: CI warning on stale tickets

Add a CI step (not a gate, just a warning) that checks for pending tickets whose RTM status is terminal and logs a warning. This doesn't fix the problem but makes it visible.

**Pros:** Minimal change, no enforcement
**Cons:** Warnings get ignored; doesn't fix the portal pollution

### Option 4: Filter upload-evidence by current PR scope

Modify the `upload-evidence` job to only upload evidence for REQs referenced in the current PR's commits, not all pending tickets.

**Pros:** Most precise — only uploads evidence for REQs actually in the current PR
**Cons:** Changes the upload-evidence scoping logic; may miss REQs that span multiple PRs; doesn't address the root cause (stale tickets)

## Recommended approach

**Option 1 (automated close-out)** is the root-cause fix. The other options treat symptoms. The close-out step should be automated because:

1. The SDLC already has an approval gate in CI — adding the ticket move as a post-approval step is natural
2. Manual close-out is the current process and it's being skipped — this is the same class of problem as the E2E gate (prose-level enforcement vs machine-enforced)
3. The terminal directory check already exists in CI — it just needs the tickets to actually be moved there

## Immediate fix (for wawagardenbar-app)

Move the stale tickets to `approved-releases/`:

```bash
mv compliance/pending-releases/RELEASE-TICKET-REQ-083.md compliance/approved-releases/
mv compliance/pending-releases/RELEASE-TICKET-REQ-084.md compliance/approved-releases/
git add compliance/pending-releases/ compliance/approved-releases/
git commit -m "chore: close out stale pending release tickets for REQ-083 and REQ-084"
```

This stops CI from treating them as in-scope for the REQ-085 release.

## Acceptance criteria

- [ ] CI automatically moves pending release tickets to `approved-releases/` after portal approval
- [ ] Stale pending tickets (RTM status `APPROVED - DEPLOYED` with merged PR) are detected and moved or flagged
- [ ] Portal release for a single REQ only shows that REQ under "Evidence by requirement"
- [ ] Test: a pending ticket moved to `approved-releases/` is skipped by `upload-evidence`
- [ ] Test: a pending ticket left in `pending-releases/` after approval is automatically moved by CI
- [ ] Test: the portal release for REQ-085 does not show REQ-083 or REQ-084

## References

- `sdlc/files/ci/ci.yml.template` — `upload-evidence` job, pending-releases iteration logic
- `compliance/pending-releases/` — directory containing active release tickets
- `compliance/approved-releases/` — terminal directory for approved release tickets
- `compliance/superseded-releases/` — terminal directory for superseded release tickets
- DevAudit-Installer #147 — per-REQ glob scoping (the skip check for terminal directories)
- DevAudit-Installer #192 — skip REQs already in terminal release directories
- DevAudit-Installer #169 — evidence-completeness gate (may false-positive on stale REQs)
- wawagardenbar-app PR #405 — REQ-083 (completed, ticket not closed out)
- wawagardenbar-app PR #406 — REQ-084 (completed, ticket not closed out)
- wawagardenbar-app PR #413 — REQ-085 (current, portal showing stale REQs)
