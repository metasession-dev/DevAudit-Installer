---
description: Define a new requirement in the RTM, classify risk, create implementation plan, generate test scope, and prepare for implementation
---

# Plan Requirement

**Pipeline Stage:** 1 of 5
**Next:** `2-implement-and-test.md`
**References:** Test Policy (`sdlc/files/Test_Policy.md` in DevAudit) (risk classification, AI governance), Test Strategy (risk matrix, testing depth, AI documentation)

---

## When to Use

- New features, enhancements, or significant changes
- **Bug fixes that affect financial calculations, user-facing data, or access control**
- Work that needs formal traceability (security, payments, RBAC, data handling)
- Any change a stakeholder or auditor might ask "was this tested?"

**Skip this workflow** for trivial changes (typo fixes, formatting, dependency bumps) — go straight to `2-implement-and-test.md`.

**Even for trivial changes:** review existing tests for impact and run all gates locally before pushing.

## Steps

### Step 1: Identify the GitHub Issue

Every tracked change starts from a GitHub Issue. The issue provides the _what_ and _why_; the RTM provides the compliance audit trail.

- If the user references an issue number (e.g., `#123`): fetch its title, description, and labels using `gh issue view 123`.
- If the user describes work without an issue: ask **"Is there a GitHub Issue for this, or should we create one?"**
  - To create one: `gh issue create --title "[title]" --body "[description]" --label "[labels]"`
- Use issue labels to inform risk classification in Step 3 (e.g., `security`, `user-facing`, `internal`).

### Step 2: Determine the Next Requirement ID

```bash
grep -oP 'REQ-\d+' compliance/RTM.md | sort -t- -k2 -n | tail -1
```

The next ID is one higher (e.g., if the last is REQ-007, use REQ-008).

### Step 3: Classify Risk Level

| Risk Level | Criteria                                                         |
| ---------- | ---------------------------------------------------------------- |
| **Low**    | Internal tools, no regulated data, no auth changes               |
| **Medium** | Touches PII, user-facing features, API changes, new dependencies |
| **High**   | Security, payments, RBAC, data handling, authentication          |

AI involvement raises risk by one level when touching Medium or High categories. See Test Policy for the full risk matrix.

### Step 4: Add Entry to RTM

Open `compliance/RTM.md`, Part B. The issue provides full context; the RTM is a traceability index, not a content store.

```markdown
| REQ-XXX | #NNN | [LOW/MEDIUM/HIGH] | compliance/evidence/REQ-XXX/ | DRAFT | -- | -- |
```

The auditor reads one row and follows the links: Issue for context and rationale, evidence directory for test artifacts, PR for code changes.

### Step 5: Create Evidence Directory

```bash
mkdir -p compliance/evidence/REQ-XXX
```

### Step 6: Implementation Plan (MEDIUM/HIGH Risk — Required)

For MEDIUM and HIGH risk requirements, create an implementation plan before defining test scope. The implementation plan defines _what code changes are needed_ — the test scope is then derived from it.

**Skip this step** for LOW risk requirements — proceed directly to Step 7.

**6a. Explore the codebase:**

- Understand existing patterns, models, services, and API routes relevant to the change
- Identify files that will be created, modified, or affected

**6b. Create the implementation plan:**

Create `compliance/evidence/REQ-XXX/implementation-plan.md`:

```markdown
# Implementation Plan — REQ-XXX

**Requirement:** REQ-XXX
**GitHub Issue:** #NNN
**Risk Level:** [MEDIUM / HIGH]
**Date:** [YYYY-MM-DD]

## Approach

[1-3 sentences describing the overall approach]

## Files to Create

- `path/to/new-file.ts` — [purpose]

## Files to Modify

- `path/to/existing-file.ts` — [what changes and why]

## Architecture Decisions

> Populated by the [`adr-author` skill](../skills/adr-author/SKILL.md) at Stage 1 plan APPROVAL. The skill applies a decision tree (new third-party dependency / new database, cache, or queue / new external service / pattern change spanning > 3 files / HIGH-CRITICAL risk) and either drafts `docs/ADR/ADR-NNN-<slug>.md` + injects "Produced ADR-NNN: <title>" here, or injects "No ADR needed — <one-line rationale>" so the question is visibly asked and answered. Don't author this section inline as bullets — the persistent decision lives in `docs/ADR/`, not buried in the plan.

- ADR-NNN — <title> (`docs/ADR/ADR-NNN-<slug>.md`) — Operator edits stub + flips to _Accepted_ before APPROVAL — OR — No ADR needed — <rationale>

## Dependencies

- [New packages needed, or "None"]

## Risks / Considerations

> Populated by the [`risk-register-keeper` skill](../skills/risk-register-keeper/SKILL.md) at Stage 1 for MEDIUM/HIGH risk REQs (LOW skipped by default per `sdlc-config.json:risk_register_keeper.stage_1_min_risk_class`). The skill identifies discrete risks the change introduces, allocates `RISK-NNN` per project, drafts canonical rows in `compliance/risk-register.md`, and injects the RISK-NNN reference list here (replacing the inline bullets). Don't author this section inline as bullets — the persistent risk record lives in `compliance/risk-register.md`, not buried in the plan.

- RISK-NNN — <title> (`compliance/risk-register.md`) — Operator edits canonical row + signs off residual rating before APPROVAL — OR — @risk-deferred — <rationale>

## Post-Deploy Actions

- [Data migrations, backfill scripts, schema changes — or "None"]
- [If any: create script in `scripts/`, document exact command and target environment]
```

### WAIT CHECKPOINT: Implementation Plan Review

**Present the implementation plan to the developer.** Summarize:

- Approach and rationale
- Files to create/modify
- Architecture decisions
- Risks and dependencies
- **Surface inventory completeness** (MEDIUM/HIGH risk) — every user-touchable surface listed in Section 2's surface-inventory table is either `In scope`, `Already works`, or explicitly `Out of scope (waived)` with a follow-up issue. No surface is silently absent. _(devaudit#152)_
- **AC form** — the test-scope ACs (drafted in Step 7) can each be phrased in Given/When/Then against the surfaces in scope. If any AC reduces to _"the schema accepts X"_ or _"the resolver returns Y"_, the plan is incomplete — return to Section 2 and expand the surface inventory until every AC has a UI surface that delivers it. _(devaudit#152)_

**Do NOT proceed** until the developer explicitly approves the plan. If the developer requests changes, update `implementation-plan.md` and re-present. For HIGH risk, this review is especially important — it's cheaper to change the plan than to refactor the code.

**6c. Commit the plan:**

```bash
git add compliance/evidence/REQ-XXX/implementation-plan.md
git commit -m "chore(compliance): [REQ-XXX] implementation plan

Ref: REQ-XXX

Co-Authored-By: [AI tool tag]"
```

---

### Step 7: Generate Test Scope

Create a test scope document proportional to the assessed risk level. For MEDIUM/HIGH risk, this is derived from the implementation plan — you now know what code is changing and can define what tests are needed.

This must exist **before implementation begins** — it is the evidence that testing was planned, not retroactively documented.

The AI generates this based on the risk classification, the implementation plan (if applicable), and the Test Strategy's risk-based testing depth matrix.

**For LOW risk:**

```bash
cat > compliance/evidence/REQ-XXX/test-scope.md << 'EOF'
# Test Scope — REQ-XXX

**Risk Level:** LOW
**Requirement:** [Brief description]
**GitHub Issue:** #NNN
**Date:** [YYYY-MM-DD]

## Test Approach

Standard gates apply. No additional testing beyond universal exit criteria.

- TypeScript compilation: 0 errors
- SAST scan: 0 high/critical findings
- Dependency audit: 0 high/critical vulnerabilities
- E2E suite: all pass
- CI independent verification: all PR checks pass
- Human code review via PR

### How to write acceptance criteria (devaudit#152)

Phrase each AC as a **user-observable journey**, not a technical-layer assertion. Use the Given/When/Then form:

> **Given** [pre-state + which UI surface the user is on], **When** [named user action with a named control], **Then** [observable change in a named UI surface].

If you can't phrase an AC in Given/When/Then because no UI surface delivers the change to a user, the scope is incomplete — return to the implementation plan's surface inventory (Section 2). LOW risk REQs may keep ACs shorter when the change is genuinely surface-free (refactor / dep bump / infra-only), but the journey form is still preferred when a user surface exists.

Examples:

- ✅ "Given the dependency is updated, When CI runs the universal gates, Then 0 high/critical findings."
- ❌ "Schema accepts optional `inventoryId` field" — internal mechanic, belongs in `test-plan.md` (this matters even for LOW when the change is user-facing).

## Acceptance Criteria

- [x] [Criterion 1 — what "done" looks like, phrased Given/When/Then where applicable]
- [x] [Criterion 2]
EOF
```

**For MEDIUM risk:**

```bash
cat > compliance/evidence/REQ-XXX/test-scope.md << 'EOF'
# Test Scope — REQ-XXX

**Risk Level:** MEDIUM
**Requirement:** [Brief description]
**GitHub Issue:** #NNN
**Date:** [YYYY-MM-DD]

## Test Approach

Standard gates plus targeted verification.

**Universal gates (mandatory — verified locally AND in CI):**
- TypeScript compilation: 0 errors
- SAST scan: 0 high/critical findings
- Dependency audit: 0 high/critical vulnerabilities
- E2E suite: all pass (full suite local, unauthenticated subset in CI)
- Human code review via PR

**Additional testing required by risk level:**
- [ ] Access control: [which endpoints/roles need verification]
- [ ] Audit logging: [which actions must produce log entries]
- [ ] Dependency review: [if new packages, verify real/current/no CVEs]
- [ ] [Any other area-specific testing]

## Validation Approach

How we confirm this meets the business requirement:
- [e.g., "Verify public page displays new content correctly"]
- [e.g., "Confirm edits are visible to users within expected time"]

### How to write acceptance criteria (devaudit#152)

Phrase each AC as a **user-observable journey**, not a technical-layer assertion. Use the Given/When/Then form:

> **Given** [pre-state + which UI surface the user is on], **When** [named user action with a named control], **Then** [observable change in a named UI surface] _(plus any audit / downstream UI changes)_.

If you can't phrase an AC in Given/When/Then because no UI surface delivers the change to a user, the scope is incomplete — return to the implementation plan's surface inventory (Section 2).

Examples:

- ✅ "Given Poundo has Ogbono linked, When a staff member opens `/dashboard/orders/express/create-order`, picks Ogbono from the Soup group, and marks the order Complete, Then `/dashboard/inventory/{ogbono}` shows stock decreased by 1 and a new Sale movement row tied to the order ID."
- ❌ "Schema accepts optional `inventoryId` field (persistence round-trip)" — unit-test contract, belongs in `test-plan.md`, not here.
- ❌ "Resolver maps selected pairs to inventory link" — internal mechanic, not user value.

## Acceptance Criteria

- [ ] [Criterion 1 — Given/When/Then]
- [ ] [Criterion 2 — Given/When/Then]
- [ ] All additional testing items above pass
EOF
```

**For HIGH risk:**

```bash
cat > compliance/evidence/REQ-XXX/test-scope.md << 'EOF'
# Test Scope — REQ-XXX

**Risk Level:** HIGH
**Requirement:** [Brief description]
**GitHub Issue:** #NNN
**Date:** [YYYY-MM-DD]

## Test Approach

Full verification and validation per Test Strategy high-risk requirements.

**Universal gates (mandatory — verified locally AND in CI):**
- TypeScript compilation: 0 errors
- SAST scan: 0 high/critical findings
- Dependency audit: 0 high/critical vulnerabilities
- E2E suite: all pass
- Human code review via PR

**Security testing (mandatory for HIGH):**
- [ ] Access control: [specific endpoints, roles, expected behaviors]
- [ ] Audit logging: [specific actions that must produce entries]
- [ ] Input validation: [boundary/injection testing needed]
- [ ] Error handling: [verify no sensitive data in error responses]

**Additional high-risk testing:**
- [ ] Independent review: [who will provide secondary review]
- [ ] Penetration testing consideration: [warranted? justification]
- [ ] Performance impact: [load/performance concerns]
- [ ] Regression scope: [areas needing manual verification beyond E2E]

## Validation Approach

How we confirm this meets the business requirement:
- [Specific user workflow to test end-to-end]
- [Business rule to validate]
- [Stakeholder sign-off needed? From whom?]

## AI Involvement (if applicable)

- AI tool: [tool name / none]
- Code categories AI will generate: [list]
- Elevated review required for: [security-sensitive files]
- Regeneration protocol: [will any components be regenerated?]

### How to write acceptance criteria (devaudit#152)

Phrase each AC as a **user-observable journey**, not a technical-layer assertion. Use the Given/When/Then form:

> **Given** [pre-state + which UI surface the user is on], **When** [named user action with a named control], **Then** [observable change in a named UI surface] _(plus any audit / downstream UI changes)_.

HIGH risk especially: every AC must pin to a named UI surface from the implementation plan's surface inventory (Section 2). If you can't phrase an AC in Given/When/Then because no UI surface delivers the change to a user, the scope is incomplete — expand the surface inventory before approving the plan. This is the gap that produced REQ-030 on a consumer project (feature shipped through every gate green, but no order-creation surface let a user select a customisation at order time).

Examples:

- ✅ "Given an admin has linked Poundo to Ogbono in `/dashboard/inventory/links`, When a staff member opens `/dashboard/orders/express/create-order`, picks Ogbono from the Soup group, and marks the order Complete, Then `/dashboard/inventory/{ogbono}` shows stock decreased by 1, a new Sale movement row appears tied to the order ID, and the activity timeline records the link-driven deduction."
- ❌ "Schema accepts optional `inventoryId` field (persistence round-trip)" — unit-test contract, belongs in `test-plan.md`, not here.
- ❌ "Resolver maps selected pairs to inventory link" — internal mechanic, not user value.

## Acceptance Criteria

- [ ] [Criterion 1 — Given/When/Then against a named UI surface]
- [ ] [Criterion 2 — Given/When/Then against a named UI surface]
- [ ] All security testing items pass
- [ ] All validation items confirmed
- [ ] Independent review completed (if required)
EOF
```

### WAIT CHECKPOINT: Test Scope Review

**Present the test scope to the developer.** Summarize:

- Risk classification and rationale
- Test approach (which additional testing applies)
- Acceptance criteria

**Do NOT proceed** until the developer confirms the test scope is complete and correct. If the developer requests changes, update `test-scope.md` and re-present.

---

### Step 8: Create Test Plan

Create a test plan that maps acceptance criteria to specific tests. This documents what tests to add, update, or remove — evidence that testing was planned, not ad hoc.

The test plan is proportional to risk. For LOW risk, a brief plan is sufficient. For MEDIUM/HIGH, include non-functional testing and test data requirements.

```bash
cat > compliance/evidence/REQ-XXX/test-plan.md << 'EOF'
# Test Plan — REQ-XXX

**Requirement:** REQ-XXX
**Risk Level:** [LOW / MEDIUM / HIGH]
**GitHub Issue:** #NNN
**Date:** [YYYY-MM-DD]

## Tests to Add
- [ ] `e2e/[spec-file].spec.ts` — [what it tests]
- [ ] `__tests__/[test-file].test.ts` — [what it tests]

## Tests to Update
- [ ] `e2e/[existing-spec].spec.ts` — [what changes and why]

## Tests to Remove
- [ ] `e2e/[obsolete-spec].spec.ts` — [justification for removal]
- [or "None"]

## Functional Test Mapping
| Acceptance Criterion | Test File | Test Name |
|---------------------|-----------|-----------|
| [From test-scope.md] | [spec file] | [test name] |

## Non-Functional Tests (MEDIUM/HIGH)
- [ ] Security: [access control, input validation tests needed]
- [ ] Performance: [load/performance concerns]
- [ ] Accessibility: [if applicable]
- [or "Standard gates sufficient for LOW risk"]

## Test Data Requirements
- [Database seeding needed?]
- [Test fixtures to create?]
- [or "Existing test data sufficient"]
EOF
```

### WAIT CHECKPOINT: Test Plan Review

**Present the test plan to the developer.** Summarize:

- Tests to add, update, and remove
- How acceptance criteria map to specific tests
- Any non-functional testing required

**Do NOT proceed** until the developer confirms the test plan is complete and correct. If the developer requests changes, update `test-plan.md` and re-present.

---

### Step 9: Update the Software Requirements Specification (If Applicable)

If the requirement adds, changes, or removes **observable behaviour**, update the project's Software Requirements Specification (`docs/SRS.md`) — or `docs/REQUIREMENTS.md` if the project has not adopted the SRS — to reflect the intended change. The SRS is the MoSCoW-prioritised, Given/When/Then source that developers and the `e2e-test-engineer` skill derive tests from, so keeping it current is what carries the requirement through into test cases.

Only act if the document exists; do not introduce an SRS on a project that has not adopted one.

### Step 10: Document AI Use Intent (If Applicable)

If AI will generate code (Medium/High risk):

```bash
cat > compliance/evidence/REQ-XXX/ai-use-note.md << 'EOF'
---
ai_contributors:
  - tool: "[tool name]"
    version: "[tool version]"
    session_id: "[session id]"
    date_range: "[YYYY-MM-DD to YYYY-MM-DD]"
    commits: []
---

# AI Use Record — REQ-XXX

**Planned AI Use:** [implementation / test generation / both / none]
**Risk Classification Impact:** [note if risk was raised due to AI involvement]
EOF
```

For Low risk, the `Co-Authored-By` commit tag is sufficient.

### Step 11: Commit

```bash
# Stage the RTM + evidence. Add the requirements doc only if you updated it in Step 9
# — whichever the project uses; staging an unchanged tracked file is a harmless no-op.
git add compliance/RTM.md compliance/evidence/REQ-XXX
[ -f docs/SRS.md ] && git add docs/SRS.md
[ -f docs/REQUIREMENTS.md ] && git add docs/REQUIREMENTS.md
git commit -m "compliance: [REQ-XXX] define requirement and test scope - [description] [RISK: LOW/MEDIUM/HIGH]

Ref: REQ-XXX
Closes: #NNN"
```

## Output

- GitHub Issue `#NNN` identified or created as the origin of the change
- REQ-XXX in RTM with `DRAFT`, risk classification, and issue reference
- Implementation plan (MEDIUM/HIGH risk — approved by developer before test scope)
- Evidence directory with test scope and test plan (derived from implementation plan)
- AI use note (if applicable)

## Next Step

Proceed to `2-implement-and-test.md`. Refer back to `test-scope.md` during implementation.
