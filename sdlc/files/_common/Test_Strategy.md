# Test Strategy

**Document Type:** Strategy | **Version:** 3.0 | **Effective Date:** March 2026 | **Review Cycle:** Annual

**Owner:** QA Team / Test Engineers | **Approved By:** Engineering Leadership

---

## Purpose

This Test Strategy defines the methodological approach to testing across Metasession. It establishes how we plan, execute, and evaluate testing — the testing levels, security methodology, AI testing protocol, defect lifecycle, traceability approach, risk classification, and evidence requirements.

This document answers **"how we approach testing."** For why we test and what we commit to, see the Test Policy (`sdlc/files/Test_Policy.md` in DevAudit). For specific tools, patterns, and code standards, see the Test Architecture.

---

## Scope

This strategy applies to all testing activities across Metasession products, client engagements, and internal systems. It covers all testing levels and all code regardless of authorship.

Project-specific details (environment URLs, test counts, infrastructure) are defined in each project's Test Plan.

---

## Testing Levels

Metasession implements a multi-level testing approach. Each level serves a distinct purpose in the verification and validation chain.

### Unit Testing

Tests individual functions, methods, and components in isolation. Executed by developers during development. External dependencies (APIs, databases, file system) are mocked. Automated in CI/CD. Coverage targets defined in the Test Architecture.

### Integration Testing

Validates interactions between system components — API contracts, service integrations, and data flows. Focuses on boundaries between modules and third-party services. Executed in dedicated integration environments.

### System Testing (E2E)

End-to-end validation of complete user workflows from UI to database. Primary responsibility of the QA team. Automated using BDD frameworks that map acceptance criteria to executable specifications. Covers 100% of critical user paths.

### Acceptance Testing

Validates that requirements and acceptance criteria are met from a business perspective. Conducted in staging environments mirroring production. Requires sign-off from Product Managers. May include formal UAT with stakeholders for regulated features.

### Security Testing

A layered approach combining per-commit automated scanning with periodic manual assessment. See Section: Security Testing Methodology for full details.

### Performance Testing

Load testing, stress testing, and scalability validation. Baselines established for all products. Executed before major releases or infrastructure changes.

### Verification and Validation (V&V)

**Verification** — "Did we build the system correctly?" Unit tests, integration tests, security scans, type checking. Confirms technical correctness. Automated and continuous.

**Validation** — "Did we build the correct system?" Acceptance testing against business requirements. End-to-end user workflow testing. Product Manager sign-off confirms the system meets intent. For regulated projects, may require formal UAT with documented evidence.

Both are required before any release. The project's Test Plan specifies which validation activities apply based on regulatory context.

---

## Security Testing Methodology

### Per-Commit Gates (Mandatory for All Changes)

Every push to `develop` triggers the full CI pipeline. All gates run on both develop pushes and PRs to main. Gate results are auto-uploaded to DevAudit (environment=uat) on develop pushes. Every code change must pass these automated gates:

**Static Application Security Testing (SAST)** — Scans source code for vulnerability patterns including injection, insecure defaults, and improper error handling. Exit criteria: 0 high/critical findings. Medium findings require documented justification or remediation plan.

**Dependency and Supply Chain Scanning (SCA)** — Audits all direct and transitive dependencies for known CVEs. Flags outdated, unmaintained, or fabricated packages. Exit criteria: 0 high/critical vulnerabilities. Runs on every change modifying dependency manifests.

**Type Checking and Linting** — Strict mode compilation and linting catch type errors, unsafe patterns, and code quality issues. Exit criteria: 0 errors.

Specific tools implementing these gates are defined in the Test Architecture.

### Per-Release Security Activities

**Access Control Testing** — Verifies RBAC across all protected endpoints. Tests that unauthenticated requests are rejected and role boundaries enforced. Required for releases touching authentication, authorization, or API endpoints.

**Audit Log Verification** — Confirms auditable actions produce log entries with timestamp, user identity, action, and affected resource. Tests that logs cannot be modified by application users. Required for releases touching auditable functionality.

**Post-Deploy Security Verification** — Access control spot-check in production, security header verification, confirmation that no debug information is exposed to unauthenticated users.

### Periodic Security Activities

Defined in the Periodic Security Review Schedule:

| Activity | Frequency |
|---|---|
| Full codebase SAST review | Quarterly |
| Dependency deep audit | Quarterly |
| Access control review | Quarterly |
| Audit log integrity review | Quarterly |
| Penetration testing (third party) | Annually |
| Disaster recovery test | Annually |
| Third-party security assessment | Annually |

### Remediation SLAs

| Severity | Per-Commit Gate | Periodic Finding |
|---|---|---|
| Critical | Block merge, fix immediately | 7 days |
| High | Block merge, fix immediately | 30 days |
| Medium | Document and plan remediation | 90 days |
| Low | Track for next review | Next quarterly review |

---

## AI-Assisted Development Testing Methodology

This section implements the AI governance commitments from the Test Policy with specific testing procedures.

### Risk Classification for AI-Generated Code

AI involvement is a factor in risk classification:

| Code Category | Base Risk | AI Adjustment |
|---|---|---|
| Internal tools, no regulated data | Low | Remains Low |
| User-facing features, API changes, PII handling | Medium | Remains Medium |
| Auth, payments, RBAC, crypto, data validation | High | Remains High |
| Any of the above with AI regeneration | Any | Raise by one level |

### Mandatory Human Review Process

**Review scope by risk level:**

| Risk Level | Reviewer | Focus |
|---|---|---|
| Low | Any team member with domain knowledge | Functional correctness, obvious security issues |
| Medium | Developer experienced in affected area | Above + security implications, dependency validation |
| High | Senior developer + security-aware review | Above + independent verification, threat modeling |

**Every reviewer checks AI-generated code for:**

1. **Correctness** — Does it do what it claims? AI produces plausible code with subtle logic errors.
2. **Security** — Injection vulnerabilities, insecure defaults, improper error handling?
3. **Dependencies** — All imports real, current, vulnerability-free? AI fabricates package names.
4. **Hardcoded values** — Test data, placeholder credentials, debug flags?
5. **Consistency** — Follows project conventions, or has AI introduced alien patterns?

The PR approval process serves as the formal review gate. Reviewer identity and timestamp are recorded immutably.

### Regeneration Protocol

When a developer regenerates a component from scratch (not incremental editing):

1. Document the regeneration — which component, when, why
2. Full retest of the regenerated component
3. Retest all dependent components
4. Do not assume equivalence — two AI outputs for the same prompt are not functionally equivalent until tests prove it

Incremental AI-assisted edits follow standard testing gates.

### AI Documentation Requirements

| Risk Level | Commit Tag | Evidence | Prompts |
|---|---|---|---|
| Low | `Co-Authored-By` tag | Not required | Not required |
| Medium | `Co-Authored-By` tag | Summary of generation | Summary of prompts |
| High | `Co-Authored-By` tag | Detailed AI record | Detailed prompts and outputs |

---

## Risk-Based Testing Approach

### Classification

Risk level is determined at planning time for each requirement:

**High Risk** — Sensitive data (PII, payments), authentication/authorization, encryption, regulatory compliance features, audit logging, core revenue capabilities, production infrastructure, AI-generated code in any of these.

**Medium Risk** — New features, architectural changes, third-party integrations, performance optimizations, AI-generated code for non-security features.

**Low Risk** — UI updates without functional changes, configuration, documentation, internal tools with limited impact.

### Testing Depth by Risk Level

| Activity | Low | Medium | High |
|---|---|---|---|
| Unit tests | Required | Required | Required |
| Integration tests | As applicable | Required | Required |
| E2E tests | Critical paths | Full coverage | Full coverage |
| SAST scan | Required | Required | Required |
| Dependency audit | Required | Required | Required |
| Access control testing | If applicable | Required | Required |
| Audit log testing | If applicable | Required | Required |
| Performance testing | Not required | If applicable | Required |
| Penetration testing | Not required | Not required | Consider |
| Independent review | Not required | Not required | Required |

---

## Defect Management

### Severity Classification

- **Critical** — System unusable, data loss, security breach. Fix immediately.
- **Major** — Major feature broken, no workaround. Fix within sprint.
- **Minor** — Minor issue, workaround exists. Prioritize in backlog.

### Lifecycle

1. **Detection** — Test failure or manual report
2. **Triage** — Severity and priority assigned
3. **Fix** — Developer creates branch linked to issue
4. **Verification** — QA validates fix
5. **Closure** — Evidence recorded, audit trail complete
6. **Traceability** — Commit references issue ID

---

## Requirements Traceability

### Approach

Every requirement must be traceable through the complete chain: Requirement → Test Cases → Test Results → Code Commits → PR Review → Deployment.

### Implementation

- Requirements tracked with unique IDs (format defined per project)
- Test specifications tagged with requirement IDs
- Commit messages reference requirement/issue IDs
- Pull requests link commits to requirements
- Test results linked to requirement IDs
- Traceability matrix maintained per project (format in project Test Plan)

### Audit Readiness

- Vertical slice capability: trace any code change to its requirement and risk assessment
- Complete linkage chain preserved permanently in Git history
- Historical evidence accessible for all past releases via tags and archives

---

## Git Workflow and Change Control

### Branching Strategy

Projects may use trunk-based with integration branch or direct trunk-based flow. The specific pattern is defined in each project's Test Plan.

**Universal requirements:**

- Production branch protected: requires PR approvals, all status checks must pass, no direct pushes
- Integration branch (if used): requires PR approval, all checks pass
- Merge strategy preserves audit trail (merge commits for compliance, squash for feature branches)

### Change Control Process

1. **Implement** — Code on working branch with requirement references
2. **Local gates** — Type checking, linting, security scan, tests
3. **Push to develop** — Triggers full CI pipeline (all gates), evidence auto-uploaded to DevAudit, auto-deploys to UAT
4. **UAT review** — Review evidence in DevAudit, approve UAT release
5. **PR to main** — CI re-runs gates independently, DevAudit UAT approval check verified
6. **Review** — Human reviews code, security, AI involvement, compliance artifacts
7. **Approve** — Immutable record of reviewer identity and timestamp
8. **Merge** — Triggers production deployment
9. **Post-deploy** — Smoke tests against production, evidence uploaded to DevAudit (environment=production)
10. **Prod review** — Approve production release in DevAudit

The four-eyes principle is enforced through mandatory PR reviews. The PR approval constitutes formal sign-off for compliance purposes.

### Commit Standards

Conventional Commits format: `type(scope): description`

Types: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert, compliance, security

AI-assisted commits include: `Co-Authored-By: [Tool] <noreply@provider.com>`
Tracked requirements include: `Ref: REQ-XXX`

---

## Evidence Requirements

### By Phase

**Planning** — Requirements with acceptance criteria, risk classification, AI use intent (if applicable).

**Development** — PR with code review (four-eyes principle), commit messages with traceability, `Co-Authored-By` tags, branch protection enforcement, SAST and dependency scan results.

**Testing** — Test execution logs with timestamps and results, security scan evidence, screenshot/video capture for failures, AI review documentation.

**Release** — Completion report with Go/No-Go recommendation, security evidence summary, sign-off from designated approver.

### Retention

- CI/CD artifacts: per platform defaults (typically 90 days)
- Long-term storage: minimum 3 years for compliance
- All evidence tagged with release version
- Audit-ready retrieval within 24 hours

### Required Artifact Types

| Category | Artifacts |
|---|---|
| Planning | Test Policy, Test Strategy, Project Test Plans |
| Specification | BDD feature files, test case specifications, security scenarios |
| Execution | Test logs, CI/CD logs, SAST/SCA reports, AI use records, defect reports |
| Reporting | Status reports, completion reports, security summaries |

---

## Agile Artifact Mapping

| ISO Artifact | Metasession Implementation |
|---|---|
| Test Policy | This document hierarchy (Policy + Strategy + Architecture) |
| Requirements Specification | Product backlog with acceptance criteria |
| Test Plan | Project-specific Test Plan + sprint planning |
| Test Case Specification | BDD feature files (Gherkin Given/When/Then) |
| Test Execution Log | CI/CD pipeline logs, test management tool records |
| Defect Reports | Issue tracker with severity labels and workflows |
| Traceability Matrix | Requirement-test-defect linkage (RTM or tool-based) |
| Security Evidence | SAST/SCA results, dependency audits, security summaries |
| AI Audit Trail | Co-Authored-By tags, evidence directory records, PR history |

---

## Reporting Cadence

- **Daily** — Test execution status during active phases
- **Weekly** — Progress and defect trends during sprints
- **Sprint end** — Completion report for sprint deliverables
- **Release** — Comprehensive completion report with security summary and Go/No-Go
- **Quarterly** — Strategy effectiveness review, periodic security results, compliance audit

---

## Continuous Improvement

This strategy is reviewed:

- Annually as part of regular cycle
- When significant process or tooling changes occur
- Following major audits or compliance assessments
- When AI tooling or regulatory guidance changes
- When gaps are identified

Sprint retrospectives, quarterly metric reviews, and incident lessons learned feed into strategy updates.

---

## Document Control

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | January 2026 | QA Team | Initial creation |
| 2.0 | March 2026 | QA Team | Added AI methodology, security methodology, V&V |
| 3.0 | March 2026 | QA Team | Clean boundary split — moved specific tools, code patterns, CI config to Test Architecture. Strategy now owns methodology only. |

**Next Review Date:** March 2027

**Related Documents:** Test Policy, Test Architecture, Periodic Security Review Schedule, Project Test Plans (in devaudit/sdlc/files/)

---

**Strategy Status:** Approved | **Effective Date:** March 2026
