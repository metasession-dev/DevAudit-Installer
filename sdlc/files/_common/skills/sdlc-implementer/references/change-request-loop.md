# Phase 5 — change-request loop in detail

When UAT review at Phase 4 ends in "changes requested" instead of "approved", `sdlc-implementer` enters the change-request loop. This document is the long-form spec for that loop, the portal-state semantics it relies on, and the discipline that keeps re-iterations compliant.

The happy path (UAT approved → Phase 5 merge + finalise) is covered in [`SKILL.md` §Phase 5 — Finalise or change-request loop](../SKILL.md#phase-5--finalise-or-change-request-loop). This file goes deeper on the change-request branch.

## Portal-state semantics

The portal's release-approval state machine for a release tied to REQ-XXX:

```
draft
  └─→ uat_review (CI registers the release on develop push)
        ├─→ uat_approved (reviewer clicks Approve on the portal)
        ├─→ uat_changes_requested (reviewer clicks Request Changes, leaves comments)
        └─→ uat_rejected (rare — reviewer marks the release fundamentally broken)
              ↑
              └─ on new commits to the linked PR branch, state resets to uat_review
```

Critical: **state resets to `uat_review` on new commits**. This is server-side, not skill-side — the portal watches the branch SHA and clears the approval state when the SHA advances after a `changes_requested` event. The skill must not work around this.

## The change-request loop

When the user runs `> Resume REQ-XXX` and the portal state is `uat_changes_requested`, the skill executes:

### Step 1 — Fetch the change-request comments

Two sources to read:

1. **PR comments** — `gh pr view <M> --comments --json comments,reviews --jq '.comments[].body, .reviews[].body'`. Includes line-level review comments and top-level discussion.
2. **Portal release-page comments** — `curl https://devaudit.metasession.co/api/projects/<slug>/releases/<version>/comments`. Includes any comments the UAT reviewer left on the release card itself.

Both sources matter: PR comments are usually code-level; portal comments are usually about-the-release-as-a-whole.

### Step 2 — Categorise the requested changes

For each requested change, mark it as one of:

- **Must address** — the reviewer is asking for a specific code/test/doc change.
- **Question** — the reviewer is asking for clarification, not asking for a code change.
- **Out of scope** — the reviewer is asking for something this REQ doesn't intend to deliver.
- **Requirements gap** (devaudit-installer#212) — the reviewer identified behaviour that should have been an AC but wasn't. The plan was incomplete, not the implementation. This is distinct from "Out of scope" (the reviewer is asking for something this REQ genuinely shouldn't deliver) and from "Must address" (the reviewer is asking for a code change within existing ACs).

For Questions: post a reply on the PR or portal explaining; do NOT change code.
For Out-of-scope items: post a reply proposing a follow-up issue; do NOT silently expand REQ-XXX.
For Requirements gap items: trigger the [requirements gap flow](../SKILL.md#requirements-gap-flow-devaudit-installer212) in `sdlc-implementer` SKILL.md with the reviewer's feedback as the gap report. The operator decides: accept the gap (ship without the edge case), amend the ACs (add the edge case as a new AC, update plan + SRS, re-walk Phase 2-3), or file a follow-up REQ. If "amend" is chosen, the change-request iteration includes the new AC in the delta-plan section, `requirements-aligner` is re-invoked for the new AC, and the SRS is updated.
For Must-address items: collect into a delta-plan section.

### Step 3 — Add a delta-plan section to the implementation plan and update the release ticket

Append a new section to `compliance/plans/REQ-XXX/implementation-plan.md`:

```markdown
## Change-request iteration N

**Reviewer**: @<username>
**Requested**: <YYYY-MM-DD>
**Iteration**: N

### Requested changes

- [ ] <bullet per Must-address item, with link to the comment that prompted it>

### Approach

<one-paragraph technical approach for addressing the items>

### Test scope delta

<which existing tests need updates, which new tests are needed, whether the change touches any new acceptance criteria>

### Plan deviations

<if the change reveals the original plan was wrong about something, note it here>
```

This section is append-only — never rewrite a prior iteration's delta-plan section.

**Update the release ticket status** (`compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md`): set `**Status:**` to `CHANGES REQUESTED — ITERATION N`. Commit the ticket update alongside the delta-plan section in the same iteration commit. The status transitions mirror the portal's state machine but are recorded in the ticket file for audit trail completeness.

### Step 4 — Re-run Phase 2 (Implement and test)

For the Must-address items only:

- Make the code changes
- Update existing tests or add new ones — **delegating any e2e/visual-regression test work to `e2e-test-engineer`** (the sub-skill invocation contract still applies in iteration N).
- Re-run all gates locally; gate-failure iteration cap (N=3 attempts) applies per gate.
- Commit with `Ref: REQ-XXX` + `Co-Authored-By: Claude` + a body that calls out the change-request iteration:

```
fix(REQ-XXX): address UAT iteration N — <one-line summary>

Iteration N change-request items:
- <bullet, link to comment>
- <bullet, link to comment>

Ref: REQ-XXX
Co-Authored-By: Claude <noreply@anthropic.com>
```

### Step 5 — Re-run Phase 3 (Compile evidence) — partial

Re-run the test suite that the change affected. Capture new artefacts:

- New e2e results
- New unit coverage (if unit tests changed)
- New screenshots (if UI behaviour changed)

Upload via `devaudit push` **with `--iteration N`** so the portal records this evidence as iteration-tagged:

```bash
devaudit push <slug> REQ-XXX <type> <file> \
  --release "<version>" \
  --environment uat --category testing \
  --iteration N \
  --git-sha "$(git rev-parse HEAD)"
```

(If the `--iteration` flag doesn't exist on the consumer's `devaudit` CLI version, fall back to encoding the iteration into the filename: `compliance/evidence/REQ-XXX/YYYY-MM-DD_iter-N_<artefact>`. The portal renders it the same way.)

**Existing evidence stays.** Iteration N adds; it does not replace. The audit trail wants to see what each iteration's evidence looked like.

**After evidence re-compile completes**, update the release ticket status to `TESTED - PENDING SIGN-OFF (ITERATION N)`.

### Step 6 — Push to the same branch

`git push` — no `--force`. The PR auto-updates.

The portal's release-approval state automatically resets to `uat_review` on the new SHA. Do not call the portal API to re-trigger this; the state machine handles it.

### Step 7 — Re-request UAT review explicitly

Even though state has reset, the reviewer needs notification. Two actions:

1. **Portal API**: `POST https://devaudit.metasession.co/api/projects/<slug>/releases/<version>/approval-requests` with `{"iteration": N, "summary": "Change-request iteration N addressed"}`. This notifies the reviewer on their portal dashboard.
2. **PR comment**: post a summary comment on the PR linking to the new commits and the iteration-N evidence on the portal:

```
Change-request iteration N addressed in <SHA>..<SHA>.

Items addressed:
- <bullet, link to original comment>
- <bullet, link to original comment>

Updated evidence: https://devaudit.metasession.co/projects/<slug>/requirements/REQ-XXX (filter by iteration N)

@<reviewer-username> — UAT re-review requested.
```

### Step 8 — Hard stop

The skill halts. The human's next move is reviewing the iteration N changes on the portal. The skill does NOT advance to merge.

## Iteration discipline

A few rules that keep iteration N+1 distinguishable from iteration N:

- **One iteration per UAT cycle**, not one per commit. If the reviewer asks for three changes, address all three in iteration N, push once, request re-review once. Don't fire iteration boundaries per commit.
- **Cap at 5 iterations** as a heuristic. If a REQ goes through 5+ iterations without converging, the original plan was probably wrong — halt and ask the user to choose one of three branches:
  - **Abandon:** Close the PR (`gh pr close <M>`), close the issue with "REQ-XXX abandoned after N=5 change-request iterations without convergence", update RTM status to `ABANDONED`, update release ticket status to `ABANDONED — ITERATION CAP REACHED (N=5)`, update sticky to terminal. Skill halts.
  - **Split:** Halt with "Recommend filing separate issues for: <inferred sub-scopes>. Close this PR after splitting. Each new issue gets its own `sdlc-implementer` invocation." The skill does not perform the split — it surfaces the recommendation and stops.
  - **Restart from fresh plan:** Keep the same REQ-XXX number (the portal release already exists). Archive the current implementation plan (`mv compliance/plans/REQ-XXX/implementation-plan.md compliance/plans/REQ-XXX/implementation-plan-v1-archived.md`), re-run Phase 1 from step 5 (write new plan). The PR stays open — the new plan's implementation replaces the code on the feature branch. Reset the iteration counter to 0.
- **Never rewrite the original plan's body** in response to iteration feedback. Use the delta-plan sections; the original plan stays as a historical record of what was first proposed.
- **Iteration commits are still SDLC-conformant.** Conventional Commits format, `Ref: REQ-XXX`, `Co-Authored-By: Claude`, all gates green locally. No exceptions because "it's just a fix to the previous iteration."

## If the change-request is fundamentally a different REQ

Sometimes a reviewer's change-request is so large it constitutes a new requirement, not an iteration on this one. Examples:

- Reviewer asks for an entire new acceptance criterion that wasn't in the original issue.
- Reviewer asks for a refactor of a subsystem the REQ doesn't touch.
- Reviewer asks for backwards-compatibility for a deprecated path the REQ removes.

In these cases:

1. Halt with a clear message: "This change-request expands scope beyond REQ-XXX as originally planned. Recommend filing a separate issue for <subject> and addressing only the in-scope items in iteration N of this REQ."
2. Wait for the user to confirm the split.
3. Address only the in-scope items in iteration N; the user opens the separate issue, which becomes a new `sdlc-implementer` invocation.

The principle: REQ-XXX has a defined scope at Phase 1. Iterations refine within scope. Iterations are not scope-creep windows.

## If the change-request is a rejection

If the portal state is `uat_rejected` (not `uat_changes_requested`), the reviewer has marked the release fundamentally broken. The skill should:

1. Halt the change-request loop. Do not attempt to address.
2. Post on the issue: "UAT rejected this release. Awaiting user direction — options are to (a) close the PR and re-plan from scratch, (b) escalate the rejection to a different reviewer, or (c) appeal the rejection with new context."
3. Wait for the user to decide. The skill does not unilaterally reopen, force-merge, or escalate.

## Release ticket status transitions

The release ticket (`compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md`) `**Status:**` field is updated at each transition in the change-request loop, mirroring the portal's state machine for audit trail completeness:

| Transition | Release ticket status |
|---|---|
| Entering iteration N | `CHANGES REQUESTED — ITERATION N` |
| After evidence re-compile (Step 5) | `TESTED - PENDING SIGN-OFF (ITERATION N)` |
| After UAT re-approval (Phase 5 happy path) | `APPROVED — READY FOR MERGE` |
| After merge + deploy + prod verification | `RELEASED` |
| If rejected | `REJECTED — AWAITING OPERATOR DIRECTION` |
| If iteration cap hit and abandoned | `ABANDONED — ITERATION CAP REACHED (N=5)` |

Commit each ticket update alongside the corresponding delta-plan or evidence commit in the same iteration commit.

## Summary

The change-request loop preserves the controls a one-shot approval cycle would skip. Every iteration:

- Documents what the reviewer asked for.
- Documents what was changed and why.
- Captures fresh evidence tagged by iteration.
- Triggers an explicit UAT re-review on the portal.
- Updates the release ticket status to reflect the current state.
- Maintains the full audit trail.

By doing so, even REQs that take five iterations to land have the same compliance posture as REQs that pass UAT on the first try.
