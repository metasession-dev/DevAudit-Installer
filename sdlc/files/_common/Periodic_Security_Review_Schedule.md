# Periodic Security Review Schedule

**Document Type:** Schedule | **Version:** 1.1 | **Effective Date:** March 2026 | **Review Cycle:** Quarterly

**Owner:** Engineering Leadership | **Approved By:** Executive Team

---

## Purpose

This document defines the security activities that occur on a schedule rather than per-feature. Per-commit security scanning (SAST and SCA) is defined in the Test Strategy (`sdlc/files/Test_Strategy.md` in DevAudit). Specific tooling for those scans is defined in the Test Architecture. This document covers the periodic activities: penetration testing, full codebase review, disaster recovery testing, dependency deep audits, and third-party assessments.

---

## Scope

This schedule applies to all Metasession products and client engagements. Project-specific procedures (URLs, databases, endpoints) are in each project's Test Plan.

---

## Schedule Overview

| Activity | Frequency | Owner | Evidence Location |
| --- | --- | --- | --- |
| Full codebase SAST review | Quarterly | QA / Security Lead | `compliance/evidence/periodic/sast-quarterly/` |
| Dependency deep audit | Quarterly | QA / Security Lead | `compliance/evidence/periodic/dependency-audit/` |
| Access control review | Quarterly | QA / Security Lead | `compliance/evidence/periodic/access-control/` |
| Audit log integrity review | Quarterly | QA / Security Lead | `compliance/evidence/periodic/audit-log/` |
| Penetration test | Annually | Third party | `compliance/evidence/periodic/pentest/` |
| Disaster recovery test | Annually | Engineering Lead | `compliance/evidence/periodic/dr-test/` |
| Third-party security assessment | Annually | Third party | `compliance/evidence/periodic/third-party/` |
| AI use policy review | Annually | Engineering Leadership | Test Policy revision history |
| Full compliance document review | Annually | Engineering Leadership | `compliance/` directory |

---

## Quarterly Activities

### Full Codebase SAST Review

**Purpose:** Catch vulnerability patterns spanning multiple changes that per-commit scanning may miss in isolation.

**Procedure:**
1. Run comprehensive SAST with expanded rule sets (including OWASP Top 10) across entire codebase
2. Compare against previous quarter to identify trends
3. Triage all findings by severity
4. Create remediation tickets for high/critical
5. Document accepted risks with justification for medium

**Evidence:** Full scan output (JSON), summary with trends, reviewer sign-off.

**Exit criteria:** 0 unresolved high/critical. Medium documented with plan or acceptance.

### Dependency Deep Audit

**Purpose:** Go beyond per-commit auditing to review the full tree for unmaintained packages, license issues, and supply chain risks.

**Procedure:**
1. Standard vulnerability check across all projects
2. Check for outdated direct dependencies
3. Review tree for unexpected or unnecessary packages
4. Flag unmaintained dependencies (no updates 12+ months)
5. Verify license compatibility
6. Re-evaluate dependencies originally introduced by AI suggestion

**Evidence:** Audit output, outdated report, summary with actions.

### Access Control Review

**Purpose:** Verify RBAC is correctly enforced across all protected endpoints.

**Procedure:**
1. Run automated access control test suites
2. Manual spot-check of key endpoints
3. Review new endpoints added since last quarter
4. Verify access control matrix is current

**Evidence:** Test results, endpoint verification matrix, findings.

### Audit Log Integrity Review

**Purpose:** Confirm audit logs are generated correctly, complete, and tamper-resistant.

**Procedure:**
1. Verify all auditable actions produce log entries
2. Confirm entries contain: timestamp, user identity, action, resource
3. Test that logs cannot be modified by application users
4. Review retention compliance
5. Sample-check entries for completeness

**Evidence:** Sample entries, completeness checklist, integrity results.

---

## Annual Activities

### Penetration Testing

**Scope:** External-facing application, API (auth and unauth), authentication/session management, input validation, server configuration.

**Requirements:** Qualified third party. Black-box by default.

**Remediation SLAs:**

| Severity | Deadline |
| --- | --- |
| Critical | 7 days |
| High | 30 days |
| Medium | 90 days |
| Low | Next quarterly review |

### Disaster Recovery Test

**Standard scenarios:**
1. **Application failure** — Simulate, recover, verify, record time
2. **Database recovery** — Restore from backup, verify integrity, record loss
3. **Full environment rebuild** — Deploy from repo to fresh infrastructure, identify gaps

RTO and RPO targets are defined per project in their Test Plans.

### Third-Party Security Assessment

**Scope:** Infrastructure config, secrets management, CI/CD security, dependency supply chain, AI use policy compliance.

**Required if:** Targeting SOC 2, processing regulated data, or contractually required.

### AI Use Policy Review

**Checklist:** Current tools listed? Deprecated tools removed? Regulatory changes? Incidents this year? Retention requirements appropriate? Regeneration protocol followed?

---

## Unscheduled Triggers

| Event | Triggered Activity |
| --- | --- |
| Security incident or breach | Full SAST + pen test + access control review |
| Critical CVE in direct dependency | Immediate audit + patch |
| Significant architecture change | Access control review + SAST |
| New AI tool adopted | AI use policy review |
| Regulatory change | Full compliance document review |
| Production rollback | Root cause analysis + relevant review |

---

## Compliance Framework Mapping

| Framework | Control | Covered By |
| --- | --- | --- |
| SOC 2 (CC7.1) | System monitoring | Quarterly SAST + audit log review |
| SOC 2 (CC6.1) | Logical access | Quarterly access control review |
| SOC 2 (CC8.1) | Change management | Per-feature pipeline + quarterly reviews |
| ISO 27001 (A.12.6) | Vulnerability management | SAST + dependency audit (quarterly + per-commit) |
| ISO 27001 (A.17.1) | Business continuity | Annual DR test |
| PCI-DSS (11.3) | Penetration testing | Annual pen test |
| OWASP | Top 10 coverage | SAST config includes OWASP rules |

---

## Document Control

| Version | Date | Author | Changes |
| --- | --- | --- | --- |
| 1.0 | March 2026 | Engineering Leadership | Initial schedule |
| 1.1 | March 2026 | Engineering Leadership | Updated document references for clean boundary split |

**Next Review Date:** June 2026 (quarterly)

**Related Documents:** Test Policy, Test Strategy, Test Architecture, Project Test Plans (in devaudit/sdlc/files/)
