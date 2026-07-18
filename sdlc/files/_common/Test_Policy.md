# Test Policy

**Document Type:** Policy | **Version:** 3.0 | **Effective Date:** March 2026 | **Review Cycle:** Annual

**Owner:** Engineering Leadership | **Approved By:** Executive Team

---

## Purpose

This Test Policy establishes Metasession's organizational commitment to quality assurance and testing excellence. It defines our philosophy, principles, accountability standards, and governance for all testing activities — including AI-assisted development.

This policy answers **"why we test"** and **"what we commit to."** For how we approach testing methodically, see the Test Strategy (`sdlc/files/Test_Strategy.md` in DevAudit). For what tools and patterns we use, see the Test Architecture.

---

## Scope

This policy applies to:

- All Metasession products and client service delivery engagements
- Internal systems and infrastructure
- All team members involved in software development, quality assurance, and product delivery
- All code regardless of authorship — human-written, AI-generated, or AI-assisted

---

## Testing Philosophy

**Core Principle:** We test to ensure zero critical defects reach production and to maintain the trust of our customers, partners, and end users.

Metasession believes that:

- **Quality is non-negotiable** — Testing is not optional; it is an integral part of our definition of done
- **Prevention over detection** — We invest in early testing, automation, and continuous quality practices to prevent defects rather than finding them late
- **Risk-based approach** — Testing resources are allocated based on business risk, compliance requirements, and customer impact
- **Continuous improvement** — We regularly review and enhance our testing practices based on metrics, retrospectives, and industry best practices
- **Compliance-first mindset** — All testing activities support our ISO 27001, GDPR, and other regulatory compliance objectives
- **Accountability regardless of authorship** — The human who commits code is responsible for it, whether they wrote it manually, generated it with AI, or received it from a third party

---

## Strategic Alignment

This policy directly supports Metasession's strategic plan:

**Operational Excellence & Compliance** — Testing provides documented evidence for ISO 27001 certification audits, demonstrates adherence to secure SDLC practices, and produces automated audit trails.

**Service Market Development** — Our testing expertise differentiates Metasession as a premium QA partner and builds credibility with clients in regulated industries.

**Product Portfolio Growth** — Consistent testing standards ensure quality across all products while automation enables rapid iteration without sacrificing reliability.

---

## Organizational Commitments

### What Every Release Must Include

1. **Test planning** — Documented scope, resources, entry/exit criteria, and risks
2. **Test design** — Test cases with traceability to requirements
3. **Test execution** — Recorded evidence with timestamps, results, and responsible parties
4. **Security scanning** — Static analysis and dependency auditing on every change
5. **Defect management** — All defects tracked with severity and closure verification
6. **Test reporting** — Completion reports with pass/fail metrics and release recommendations

### Compliance Framework

Metasession's testing practices conform to:

- **ISO/IEC 29119-3** — Software testing documentation
- **ISO 27001** — Information security management
- **GDPR** — Data protection and privacy
- Industry best practices for agile testing and DevOps

### Periodic Security Commitments

Beyond per-change scanning, Metasession commits to:

- **Quarterly:** Full codebase security review, dependency deep audit, access control review, audit log integrity check
- **Annually:** Penetration testing by qualified third party, disaster recovery testing, third-party security assessment, AI use policy review

Specific schedules and procedures are defined in the Periodic Security Review Schedule.

---

## AI-Assisted Development Governance

### Policy Statement

Metasession embraces AI as a development tool while recognizing that AI-generated code introduces specific compliance risks requiring explicit controls. AI assistance does not reduce testing requirements — it increases them.

### The Risk Profile

AI-generated code presents risks distinct from human-authored code:

- **Confident incorrectness** — Plausible-looking code with subtle logic errors or security flaws
- **Hallucinated dependencies** — Fabricated, outdated, or vulnerable packages
- **Non-determinism** — The same prompt may produce different code on different runs
- **Training data contamination** — Reproduction of insecure patterns
- **No inherent audit trail** — No default record of what was asked or generated

### Mandatory Controls

1. **Human review as a formal compliance gate** — Every AI-generated piece of code must be reviewed by a qualified human before entering the test pipeline. The review must be logged with reviewer identity, date, and scope.

2. **Automated security scanning on every commit** — AI-generated code must pass the same SAST and dependency scanning gates as human-authored code. These are mandatory, not optional.

3. **Dependency and supply chain verification** — All dependencies in AI-assisted changes must be verified as real, current, and vulnerability-free.

4. **Regeneration triggers full retest** — If a developer regenerates a component from scratch (not incremental editing), that triggers full retest of the component and dependents. Functional equivalence cannot be assumed.

5. **Documentation proportional to risk** — Each project's Test Plan defines AI tool permissions, review requirements, and prompt/output retention based on risk level.

### Permitted AI Tools

| Tool | Permitted Use | Restrictions |
| --- | --- | --- |
| Claude (Anthropic) | Code generation, test generation, documentation, review assistance | No deployment without human review |
| GitHub Copilot | Inline code suggestions | Same review requirements as any AI-generated code |

Adding a new tool requires Engineering Leadership approval and updates to this policy, the Test Strategy, and relevant project Test Plans.

### What AI May and May Not Generate

**Permitted (with mandatory human review):** Application logic, UI components, test code, database queries, migration scripts, documentation, configuration, utility functions.

**Requires elevated review (senior developer + security):** Authentication/authorization logic, cryptographic operations, payment processing, data validation for user input, API security middleware, database schema changes affecting PII.

**Prohibited (must be human-authored):** Security credentials or secrets, production environment configuration values, compliance policy documents.

### Accountability

The human who commits AI-generated code is accountable for its correctness, security, and compliance. The PR reviewer who approves it shares accountability for having verified its quality. "The AI wrote it" is not an acceptable explanation.

### EU AI Act Preparedness

Metasession monitors evolving AI regulation. For projects under high-risk classification (healthcare, employment, critical infrastructure), using AI to build the system may require disclosure and conformity assessment. Project Test Plans must address this where applicable.

---

## Risk-Based Testing

Testing effort is prioritized by risk level, determined at planning time:

**High Priority** — Sensitive data handling, security-critical functionality, regulatory compliance features, core revenue capabilities, production infrastructure changes, AI-generated code in any of these categories.

**Medium Priority** — New feature development, significant refactoring, third-party integrations, performance optimizations, AI-generated code for non-security features.

**Low Priority** — Minor UI updates, configuration changes, documentation, internal tools with limited impact.

AI involvement in Medium or High categories raises risk by one level. The Test Strategy defines specific testing depth requirements per level.

### E2E gate enforcement (v0.1.53+)

The MoSCoW prioritisation of acceptance criteria maps onto three E2E gates, each enforced at a different point in the workflow:

- **Must-tier ACs in the smoke subset** must pass on every push to the integration branch. Blocking — a red smoke gate stops the integration hop.
- **Must-tier ACs in the critical subset** must pass on every consumer-enabled PR to the release branch. Blocking — a red critical gate stops that release.
- **Should/Could-tier ACs (full regression)** are not pre-merge blocking. The consumer chooses a post-merge, scheduled, or manual-dispatch safety net and must triage any recorded failure within working hours.

Operator override on a hotfix issue (accept-with-rationale) is logged on the issue itself + carried in the next release's `test-execution-summary.md` design record (devaudit#50). The framework does not permit silently shipping a failing test — every red regression spec ends as either fixed, reverted, or accepted-with-recorded-rationale.

See Test_Strategy.md § *System Testing (E2E)* — *E2E gating model* for the tier definitions + cost philosophy.

---

## Roles & Responsibilities

### Engineering Leadership
- Approve and maintain this policy
- Allocate testing resources
- Review metrics and drive improvement
- Approve AI tool additions

### QA Team / Test Engineers
- Design and execute strategies and plans
- Develop and maintain automated suites
- Report defects and verify fixes
- Generate reports and maintain evidence repositories
- Verify security scan results

### Developers
- Write unit tests for all changes
- Execute local testing before committing (including security scans)
- Fix identified defects
- Review and take accountability for all AI-generated code committed
- Document AI use per project requirements

### Product Managers / Business Analysts
- Define clear acceptance criteria
- Participate in test planning and risk assessment
- Review and approve completion reports
- Sign off on release readiness

---

## Metrics & Continuous Improvement

Metasession tracks:

- **Test coverage** — Percentage of requirements with associated tests
- **Automation rate** — Automated vs. manual tests
- **Defect detection rate** — Defects found per testing phase
- **Defect escape rate** — Production defects not caught during testing
- **Test execution rate** — Planned tests executed
- **Pass/fail trends** — Historical results over time
- **Security findings** — SAST and dependency findings per release
- **AI code review rate** — AI-generated code formally reviewed before merge

Quarterly reviews assess trends and identify improvements. Findings feed into retrospectives and annual planning.

---

## Compliance & Audit Support

All test artifacts must be:

- **Traceable** — Linked to requirements, user stories, or risk assessments
- **Timestamped** — With date, time, and responsible party
- **Retained** — Minimum 3 years for ISO audits and compliance reviews
- **Accessible** — Retrievable within 24 hours for audit requests

AI use documentation is retained alongside other evidence for the same period.

---

## Policy Exceptions

Exceptions require:

1. Written justification with risk assessment
2. Documented risk acceptance by Engineering Leadership
3. Compensating controls to mitigate risk
4. Time-bound with defined remediation date

All exceptions logged and reviewed quarterly. Exceptions to AI governance controls are not permitted for High risk changes.

---

## Training & Awareness

All team members receive:

- **Onboarding** — Testing standards and tools
- **Annual refresher** — Policy changes, new tools, compliance updates
- **Role-specific** — Specialized training for QA, developers, PMs
- **Compliance** — ISO 27001, GDPR, secure testing practices
- **AI-assisted development** — Responsible use, review requirements, recognizing AI failure modes

Training completion is tracked as ISO 27001 evidence.

---

## Document Hierarchy

```
Test Policy (this document)
  → WHY we test, WHAT we commit to, WHO is responsible
  
Test Strategy
  → HOW we approach testing methodically
  
Test Architecture
  → WHAT we build tests with, HOW we structure the code
  
Periodic Security Review Schedule
  → WHEN periodic security activities happen
  
Project Test Plans (per product)
  → WHERE and WHEN for specific products
```

---

## Document Control

| Version | Date | Author | Changes |
| --- | --- | --- | --- |
| 1.0 | January 2026 | Engineering Leadership | Initial creation |
| 2.0 | March 2026 | Engineering Leadership | Added AI governance, security commitments |
| 3.0 | March 2026 | Engineering Leadership | Clean boundary split — removed content now owned by Test Strategy (methodology) and Test Architecture (tooling) |

**Next Review Date:** March 2027

**Related Documents:** Test Strategy, Test Architecture, Periodic Security Review Schedule, Project Test Plans (in devaudit/sdlc/files/)

---

**Policy Status:** Approved | **Effective Date:** March 2026
