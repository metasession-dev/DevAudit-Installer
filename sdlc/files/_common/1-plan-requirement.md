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

Every tracked change starts from a GitHub Issue. The issue provides the *what* and *why*; the RTM provides the compliance audit trail.

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

| Risk Level | Criteria |
|---|---|
| **Low** | Internal tools, no regulated data, no auth changes |
| **Medium** | Touches PII, user-facing features, API changes, new dependencies |
| **High** | Security, payments, RBAC, data handling, authentication |

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

For MEDIUM and HIGH risk requirements, create an implementation plan before defining test scope. The implementation plan defines *what code changes are needed* — the test scope is then derived from it.

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
- [Key decision 1 and rationale]
- [Key decision 2 and rationale]

## Dependencies
- [New packages needed, or "None"]

## Risks / Considerations
- [Anything that could go wrong or needs special attention]

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

## Acceptance Criteria

- [x] [Criterion 1 — what "done" looks like]
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

## Acceptance Criteria

- [ ] [Criterion 1]
- [ ] [Criterion 2]
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

## Acceptance Criteria

- [ ] [Criterion 1]
- [ ] [Criterion 2]
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

### Step 9: Update Requirements Document (If Applicable)

If the requirement modifies a documented feature, update the requirements document to reflect the intended change.

### Step 10: Document AI Use Intent (If Applicable)

If AI will generate code (Medium/High risk):

```bash
cat > compliance/evidence/REQ-XXX/ai-use-note.md << 'EOF'
# AI Use Record — REQ-XXX

**AI Tool:** [tool name]
**Planned AI Use:** [implementation / test generation / both / none]
**Risk Classification Impact:** [note if risk was raised due to AI involvement]
EOF
```

For Low risk, the `Co-Authored-By` commit tag is sufficient.

### Step 11: Commit

```bash
git add compliance/RTM.md compliance/evidence/REQ-XXX docs/REQUIREMENTS.md
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
