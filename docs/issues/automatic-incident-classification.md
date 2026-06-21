# Framework: Automatic incident/bug classification without manual operator intervention

**Status:** Proposed / Ready for implementation  
**Labels:** `enhancement`, `framework`, `skills`  
**Priority:** High  
**Milestone:** v0.1.60+ (post-launch framework hardening)

---

## Problem Statement

The current DevAudit framework requires **manual operator intervention** to apply the `incident` label and Framework attribution to defects across **all SDLC phases**. This creates compliance gaps where incidents escape documentation regardless of when they occur:

- **Stages 0-3 (Plan/Implement/Test):** No skills monitor planning gaps, code review findings, local test failures, or evidence compilation errors
- **Stage 4 (Review):** PR stall and approval disputes have no skill trigger
- **Stage 5 (Deploy):** Post-deploy failures are not auto-classified
- **Phase 6 (E2E):** Only application-defects caught — infrastructure failures escape
- **Post-release:** Production incidents require manual filing

### Current Gaps Observed (wawagardenbar-app Case Study)

| Issue | Type | SDLC Phase | Current Handling | Gap |
|-------|------|------------|------------------|-----|
| #382 | CI upload timeout | Stage 3 (Compile) | Closed without incident label | No Framework attribution |
| #352 | E2E shared-state pollution | Phase 6 | Open, no incident label | Admin override not risk-registered |
| #345-347 | Post-merge regressions | Phase 6 | Auto-filed as `bug,priority:high` | Manual incident label add required |
| — | Planning defects (incomplete RTM) | Stage 1 | No skill trigger | Not captured |
| — | Code review security findings | Stage 2 | Fixed in PR, no incident | No audit trail |
| — | Post-deploy health check fail | Stage 5 | Workflow fails, no skill | No incident auto-filed |
| — | Production data loss | Post-release | Manual issue filing | Manual process only |

**Root cause:** Skills only trigger on Phase 6 application-defects. No skills exist for Stages 0-5 or production monitoring.

---

## Required Changes

### 1. Extend `e2e-test-engineer` Skill (REQ-SKILL-E2E-008)

**Current precondition:**
> "a Phase 6 application-defect or missed-AC failure"

**Required precondition:**
```
Phase 6 application-defect 
  OR missed-AC failure 
  OR post-merge regression pack failure (workflow_run event)
  OR CI infrastructure failure detected in logs
```

**Classification rules:**
- **Product code bug** → incident label + ISO29119.3.5.4 + SOC2.CC7.2
- **Test infrastructure bug** → incident label + ISO29119.3.5.4 (baseline)
- **Environment/data pollution** → incident label + ISO29119.3.5.4 + risk_assessment.md

---

### 2. Create `ci-infrastructure-monitor` Skill (New)

**Trigger:** `on: workflow_run` for `ci.yml` with `conclusion: failure`

**Actions:**
1. Parse logs to identify failure category (upload/SAST/build/auth)
2. Map to Framework clauses:
   - Upload/SAST → ISO29119.3.5.4, SOC2.CC7.2
   - Auth → ISO27001.A.9.4.2
   - Build → ISO27001.A.12.1
3. Auto-file issue with `incident` label + Framework attribution
4. Link to relevant REQ if identifiable from commit subject

**SRS Addition:** REQ-SKILL-CI-MONITOR-001 through 004

---

### 3. Extend `risk-register-keeper` Skill (REQ-SKILL-RISK-006)

**New requirement:** Quality gate override mediation

**Triggers:**
- Explicit request: "override [gate] for [REQ] with [rationale]"
- Detection of admin-override via GitHub API event

**Phases:**
1. **Validate override request:** Confirm alternative verification exists, assess residual risk
2. **Document acceptance:** Create RISK-NNN with status ACCEPTED, link to incident report
3. **Authorize override:** Post authorized comment on PR, update risk-register.md

**Process change:** Override becomes skill-gated — UI override warned/disabled unless risk register entry exists.

---

### 4. Extend `sdlc-implementer` for Planning Defects (REQ-SKILL-SDLC-PLAN-001)

**Trigger:** RTM validation failures, missing risk assessments, incomplete implementation plans

**Actions:**
1. Monitor Stage 1 outputs (RTM.md, implementation-plan.md, test-plan.md)
2. Detect planning gaps (HIGH risk without assessment, missing RTM entries)
3. Auto-file incident with Framework attribution:
   - Planning gap → ISO27001.A.5.1 (risk management)
   - Missing RTM → ISO29119.3.3.1 (requirements management)
4. Link to REQ if identifiable

---

### 5. Create `code-review-monitor` Skill (New)

**Trigger:** GitHub PR review comments with security/critical findings, CodeQL/Semgrep findings in PR

**Actions:**
1. Parse review comments for security keywords (`vulnerability`, `injection`, `exposure`, `unsafe`)
2. Monitor CodeQL/SARIF output in PR checks
3. Auto-file incident with classification:
   - Security finding → SOC2.CC6.1 (security infrastructure), ISO27001.A.12.6.1 (technical vulnerability)
   - Logic error → ISO29119.3.5.4 (test incident — caught pre-test)
   - Performance issue → SOC2.CC6.2 (system monitoring)
4. Link to PR and branch

---

### 6. Extend `e2e-test-engineer` for Evidence Compilation (REQ-SKILL-E2E-011)

**Trigger:** `evidenceShot` failures, upload timeouts, sidecar generation errors

**Actions:**
1. Monitor evidence compilation step (Stage 3)
2. Detect upload failures, path errors, metadata generation failures
3. Auto-file incident:
   - Evidence upload fail → ISO29119.3.5.4 (test evidence), SOC2.CC7.2 (system monitoring)
   - Screenshot path error → ISO29119.3.5.4
4. Continue test execution (don't block) — incident filed async

---

### 7. Create `review-process-monitor` Skill (New)

**Trigger:** PR open > 7 days without approval, reviewer disputes, approval withdrawn

**Actions:**
1. Monitor PR state via GitHub API (daily scan)
2. Detect review process failures:
   - Stalled PR → SOC2.CC8.1 (change control), ISO27001.A.12.1.2 (change management)
   - Approval dispute → SOC2.CC2.2 (communication)
3. Auto-file incident with `incident` label
4. Notify via LAST/NEXT status sticky

---

### 8. Extend `ci-infrastructure-monitor` for Post-Deploy (REQ-SKILL-CI-MONITOR-005)

**Trigger:** `post-deploy-prod.yml` failure, health check timeout, smoke test failure

**Actions:**
1. Monitor `post-deploy-prod.yml` workflow_run events
2. Parse failure type:
   - Health check fail → SOC2.CC7.2 (system monitoring), ISO27001.A.12.4.1 (event logging)
   - Smoke test fail → ISO29119.3.5.4 (production test incident)
3. Auto-file P1/critical incident
4. Link to release and deployment SHA

---

### 9. Create `production-incident-monitor` Skill (New)

**Trigger:** Production error rates, customer reports, automated alerts (Sentry, DataDog, etc.)

**Actions:**
1. Webhook receiver for production alerts
2. Classify incident severity from alert payload:
   - Data loss/corruption → GDPR.Art-33 (breach notification), SOC2.CC7.2
   - Service outage → SOC2.CC7.2, ISO27001.A.17.1.1 (availability)
   - Security incident → SOC2.CC6.1, ISO27001.A.16.1.1 (incident management)
3. Auto-file incident with `incident` label + severity
4. Link to release version, error trace, affected users
5. Trigger `risk-register-keeper` for residual risk assessment

---

### 10. Workflow Changes

#### `e2e-regression.yml` Post-Merge Handler

**Current:**
```yaml
- name: Open hotfix issue on post-merge regression
  if: failure()
  run: gh issue create --label "bug,priority:high"
```

**Required:**
Delegate to `e2e-test-engineer` skill instead of direct issue creation. Skill applies:
- `incident` label automatically
- Framework attribution section
- Risk register entry if override required

#### `compliance-evidence.yml` E2E Regression Upload

**Current REQ-FRAMEWORK-EVIDENCE-006:**
Uploads `e2e_result` with tier metadata.

**Extension:** Before upload, invoke skill classification for any failures detected.

---

## Proposed Automatic Flows

### Flow A: Post-Merge Regression Detected

```
e2e-regression.yml workflow_run completes with failure
    ↓
compliance-evidence.yml receives workflow_run event
    ↓
Delegate to e2e-test-engineer Phase 6 (extended scope)
    ↓
Skill analyzes failure logs
    ↓
Auto-classify and file with incident label + Framework attribution
    ↓
incident-export.yml fires on close → compliance-evidence.yml uploads
    ↓
Framework clauses auto-covered (no manual operator action)
```

### Flow B: CI Infrastructure Failure

```
ci.yml job fails (upload timeout, network error)
    ↓
ci-infrastructure-monitor skill triggered
    ↓
Parse failure type → map to Framework clauses
    ↓
Auto-file issue with incident label + attribution
    ↓
incident-export.yml → compliance-evidence.yml
```

### Flow C: Quality Gate Override

```
Admin requests: "override E2E gate for REQ-XXX"
    ↓
risk-register-keeper mediates (mandatory)
    ↓
Requires rationale + alternative verification
    ↓
Creates RISK-NNN ACCEPTED with links
    ↓
Authorizes override with audit trail
    ↓
Admin clicks override (now compliant)
```

---

## Implementation Priority (100% Coverage)

All changes are **P1** to achieve full automatic incident classification across all SDLC phases:

| Priority | Change | SDLC Phase | Effort | Framework Closes |
|----------|--------|------------|--------|------------------|
| **P1** | Extend `e2e-test-engineer` for post-merge regressions | Phase 6 | Medium | ISO29119.3.5.4, SOC2.CC7.2 |
| **P1** | Add CI infrastructure failure detection | Stage 3 | Medium | ISO29119.3.5.4, SOC2.CC7.2 |
| **P1** | Extend `sdlc-implementer` for planning defects | Stage 1 | Medium | ISO27001.A.5.1, ISO29119.3.3.1 |
| **P1** | Create `code-review-monitor` skill | Stage 2 | Medium | SOC2.CC6.1, ISO27001.A.12.6.1 |
| **P1** | Extend `e2e-test-engineer` for evidence compilation | Stage 3 | Low | ISO29119.3.5.4 |
| **P1** | Create `review-process-monitor` skill | Stage 4 | Medium | SOC2.CC8.1, ISO27001.A.12.1.2 |
| **P1** | Extend `ci-infrastructure-monitor` for post-deploy | Stage 5 | Medium | SOC2.CC7.2, ISO27001.A.12.4.1 |
| **P1** | Gate quality overrides through risk-register-keeper | Phase 6 | Medium | SOC2.CC3.2, ISO27001.A.5.1 |
| **P1** | Create `production-incident-monitor` skill | Post-release | High | GDPR.Art-33, SOC2.CC7.2, ISO27001.A.17.1.1 |
| **P1** | Delegate workflows to skills | All | Low | All — automation layer |

---

## SDLC Phase Coverage Matrix (Target State)

| SDLC Phase | Defect Type | Skill | Auto-File? | Framework Attribution |
|------------|-------------|-------|------------|----------------------|
| **Stage 0** | Project setup failure | `sdlc-implementer` | ✅ Yes | ISO27001.A.12.1.2 |
| **Stage 1** | RTM gap, missing risk assessment | `sdlc-implementer` | ✅ Yes | ISO27001.A.5.1, ISO29119.3.3.1 |
| **Stage 2** | Security finding in code review | `code-review-monitor` | ✅ Yes | SOC2.CC6.1, ISO27001.A.12.6.1 |
| **Stage 2** | Logic error caught pre-test | `code-review-monitor` | ✅ Yes | ISO29119.3.5.4 |
| **Stage 3** | evidenceShot/upload failure | `e2e-test-engineer` | ✅ Yes | ISO29119.3.5.4, SOC2.CC7.2 |
| **Stage 3** | CI infrastructure failure | `ci-infrastructure-monitor` | ✅ Yes | ISO29119.3.5.4, SOC2.CC7.2 |
| **Stage 4** | PR stall >7 days | `review-process-monitor` | ✅ Yes | SOC2.CC8.1, ISO27001.A.12.1.2 |
| **Stage 4** | Approval dispute | `review-process-monitor` | ✅ Yes | SOC2.CC2.2 |
| **Stage 5** | Post-deploy health check fail | `ci-infrastructure-monitor` | ✅ Yes | SOC2.CC7.2, ISO27001.A.12.4.1 |
| **Stage 5** | Smoke test failure | `ci-infrastructure-monitor` | ✅ Yes | ISO29119.3.5.4 |
| **Phase 6** | Application defect (E2E) | `e2e-test-engineer` | ✅ Yes | ISO29119.3.5.4, SOC2.CC7.2 |
| **Phase 6** | Test infrastructure defect | `e2e-test-engineer` | ✅ Yes | ISO29119.3.5.4 |
| **Phase 6** | Post-merge regression | `e2e-test-engineer` | ✅ Yes | ISO29119.3.5.4, SOC2.CC7.2 |
| **Phase 6** | Quality gate override | `risk-register-keeper` | ✅ Yes | SOC2.CC3.2, ISO27001.A.5.1 |
| **Post-release** | Production data loss | `production-incident-monitor` | ✅ Yes | GDPR.Art-33, SOC2.CC7.2 |
| **Post-release** | Service outage | `production-incident-monitor` | ✅ Yes | SOC2.CC7.2, ISO27001.A.17.1.1 |
| **Post-release** | Security incident | `production-incident-monitor` | ✅ Yes | SOC2.CC6.1, ISO27001.A.16.1.1 |

---

## Acceptance Criteria (100% Automatic Coverage)

### All SDLC Phases
- [ ] **Stage 0:** Project setup failures auto-filed with `incident` label
- [ ] **Stage 1:** Planning gaps (RTM, risk assessment) auto-filed with ISO27001.A.5.1 attribution
- [ ] **Stage 2:** Code review security findings auto-filed with SOC2.CC6.1 attribution
- [ ] **Stage 3:** Evidence compilation failures auto-filed with ISO29119.3.5.4 attribution
- [ ] **Stage 4:** Review process failures (PR stall, disputes) auto-filed with SOC2.CC8.1 attribution
- [ ] **Stage 5:** Post-deploy health check failures auto-filed with SOC2.CC7.2 attribution
- [ ] **Phase 6:** All E2E defects (application + infrastructure) auto-filed with correct attribution
- [ ] **Phase 6:** Post-merge regressions auto-classified without manual intervention
- [ ] **Phase 6:** Quality gate overrides auto-create risk register entries
- [ ] **Post-release:** Production incidents (data loss, outage, security) auto-filed with GDPR.Art-33/SOC2.CC7.2/ISO27001.A.17.1.1 attribution

### Framework Coverage Targets
- [ ] ISO29119.3.5.4 (Test incident report) — **100% coverage** for all test-related defects
- [ ] ISO29119.3.3.1 (Requirements management) — **100% coverage** for planning gaps
- [ ] SOC2.CC7.2 (System monitoring) — **100% coverage** for all infrastructure/deploy incidents
- [ ] SOC2.CC6.1 (Security infrastructure) — **100% coverage** for security findings
- [ ] SOC2.CC8.1 (Change management) — **100% coverage** for review process failures
- [ ] SOC2.CC3.2 (Risk assessment) — **100% coverage** for override decisions
- [ ] ISO27001.A.5.1 (Risk management) — **100% coverage** for planning/override risks
- [ ] ISO27001.A.12.1.2 (Change management) — **100% coverage** for process failures
- [ ] ISO27001.A.12.4.1 (Event logging) — **100% coverage** for monitoring events
- [ ] ISO27001.A.12.6.1 (Technical vulnerability) — **100% coverage** for security findings
- [ ] ISO27001.A.16.1.1 (Incident management) — **100% coverage** for production security
- [ ] ISO27001.A.17.1.1 (Availability) — **100% coverage** for outages
- [ ] GDPR.Art-33 (Breach notification) — **100% coverage** for data loss incidents

### Zero Manual Steps
- [ ] Zero manual `incident` label applications required across all defect types
- [ ] Zero manual risk register entries for override decisions
- [ ] Zero manual Framework attribution section additions
- [ ] All incidents uploaded to portal via `incident-export.yml` → `compliance-evidence.yml`

### Test Scenarios (wawagardenbar-app)
- [ ] #382 (CI upload timeout) — auto-filed with ISO29119.3.5.4 + SOC2.CC7.2
- [ ] #352 (E2E shared-state pollution) — auto-filed with ISO29119.3.5.4 + risk register entry for override
- [ ] #345-347 (Post-merge regressions) — auto-filed with incident label on detection
- [ ] Hypothetical: Planning gap in REQ-XXX — auto-filed with ISO27001.A.5.1
- [ ] Hypothetical: Security finding in PR review — auto-filed with SOC2.CC6.1
- [ ] Hypothetical: Post-deploy health fail — auto-filed with SOC2.CC7.2
- [ ] Hypothetical: Production data loss — auto-filed with GDPR.Art-33

### Documentation
- [ ] SRS updated with 11 new REQ-SKILL entries (E2E-008 extended, E2E-011, SDLC-PLAN-001, CI-MONITOR-001-005, RISK-006, CODE-REVIEW-001, REVIEW-MONITOR-001, PROD-MONITOR-001)
- [ ] Skill documentation updated with trigger conditions and Framework mappings
- [ ] Workflow documentation updated with skill delegation patterns

---

## References

- SRS: REQ-SKILL-E2E-008, REQ-SKILL-RISK-004, REQ-FRAMEWORK-EVIDENCE-006, REQ-FRAMEWORK-VALIDATION-003
- Case study: wawagardenbar-app issues #382, #352, #345, #346, #347
- Workflow: `e2e-regression.yml` post-merge failure handler
- Skill: `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`
- Governance: `sdlc/files/_common/governance/incident-report.md.template`
