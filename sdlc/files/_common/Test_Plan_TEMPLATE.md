# Test Plan — [PROJECT NAME]

**Document Type:** Test Plan (Project-Specific) | **Version:** 1.0 | **Effective Date:** [DATE]

**Project:** [PROJECT NAME] | **Repository:** `[org/repo-name]`

**Parent Documents:** Test Policy, Test Strategy, Test Architecture (all Tier 1, in devaudit/sdlc/files/)

---

## Purpose

This Test Plan defines project-specific testing details for [PROJECT NAME]. It implements the universal standards from Tier 1 with concrete environment details, test suites, entry/exit criteria, and compliance artifacts.

For testing philosophy and governance: Test Policy (`sdlc/files/Test_Policy.md` in DevAudit).
For testing methodology and approach: Test Strategy.
For tools, patterns, and code standards: Test Architecture.

---

## Project Overview

| Attribute | Value |
|---|---|
| Application | [PROJECT NAME — brief description] |
| Stack | [e.g., TypeScript, Next.js, MongoDB, Socket.IO] |
| Hosting | [e.g., Railway, Vercel, AWS] (auto-deploy from `main`) |
| Production URL | [URL] |
| Health Endpoint | [e.g., /api/health] |
| Database | [e.g., MongoDB — connection details] |
| Runtime | [e.g., node_modules/.bin/tsx server.ts] |
| Build | [e.g., Multi-stage Dockerfile, 3-5 min] |

---

## Branching Strategy

Trunk-based with develop branch (per Test Strategy branching patterns):

- **`main`** — Production. Auto-deploys to hosting platform. PR approval + all checks required.
- **`develop`** — Working branch. All implementation here. Permanent, never deleted.
- Merge commits (not squash) for `develop` → `main` to preserve audit history.

---

## Test Suites

### E2E Tests (Playwright)

| Attribute | Value |
|---|---|
| Framework | Playwright (per Test Architecture standard) |
| Test count | [TOTAL] tests across [N] projects |
| Unauthenticated (CI) | [COUNT] (run in CI on PR to main) |
| Authenticated (local only) | [COUNT] (require credentials) |
| Browser | Chromium |
| Prerequisite | [e.g., npx tsx scripts/seed-e2e-admins.ts] |

### Unit Tests

| Attribute | Value |
|---|---|
| Framework | [Jest / Vitest] |
| Coverage target | 70% for critical modules |
| Run command | [e.g., npx vitest run] |

### TypeScript Compilation

```bash
npx tsc --noEmit   # 0 errors required
```

### SAST Scanning

| Attribute | Value |
|---|---|
| Tool | Semgrep (per Test Architecture) |
| Config | auto |
| Scan scope | [e.g., src/] |

```bash
npx semgrep scan --config auto [SOURCE_DIR]/ --severity ERROR --severity WARNING
```

### Dependency Auditing

```bash
npm audit --audit-level=high
```

---

## Entry and Exit Criteria

### Entry

- On `develop`, up to date with remote
- Dev server starts
- Database running locally
- Playwright browsers installed
- Test data seeded

### Exit (Before PR)

| Gate | Local | CI (PR) | Threshold |
|---|---|---|---|
| TypeScript | Yes | Yes | 0 errors |
| SAST (high/critical) | Yes | Yes | 0 findings |
| Dependencies (high/critical) | Yes | Yes | 0 vulnerabilities |
| E2E tests | [TOTAL]/[TOTAL] | [UNAUTH]/[UNAUTH] | All pass |
| Severity-1 defects | — | — | 0 open |
| Human review | — | PR approved | Approved |

Additional for Medium/High risk (per Test Strategy risk matrix):

| Gate | Threshold |
|---|---|
| Access control tests | RBAC endpoints return correct 401/403 |
| Audit log tests | Auditable actions produce log entries |

---

## CI/CD

### Pipeline Configuration

| Trigger | What Runs | Independent Evidence |
|---|---|---|
| Push to `develop` | TypeScript check + build | Compilation clean |
| PR to `main` | TypeScript + SAST + dependency audit + E2E (unauthenticated) | All gates independently verified by GitHub |
| Merge to `main` | Auto-deploy to hosting platform | Deployment triggered |

CI workflow file: `.github/workflows/ci.yml` (created during project setup — see `0-project-setup.md`)

CI prerequisites: [e.g., E2E tests require seeding even for unauthenticated subset]

### PR Pipeline Execution Order

1. TypeScript check — fast, no database
2. SAST scan — fast, no database
3. Dependency audit — fast, no database
4. Seed test data — required before E2E
5. E2E tests — slow, requires database

Steps 1-3 can run in parallel. Step 4 must complete before step 5.

### Evidence Model

**Local evidence** (in `compliance/evidence/REQ-XXX/`) — comprehensive, developer-produced, covers all tests. Committed to repository.

**CI evidence** (in GitHub Actions logs + artifacts) — independent, GitHub-produced, covers unauthenticated subset. Tamper-resistant.

Both required. Local proves comprehensive testing. CI proves it independently.

---

## AI Use — Project Configuration

Per Test Policy AI governance:

| Tool | Permitted Use |
|---|---|
| [e.g., Claude (Anthropic) — Opus 4.6, Sonnet 4.6] | [e.g., Code generation, test generation, documentation, review] |

Documentation requirements (per Test Strategy AI methodology):

| Risk | Commit | Evidence | Prompts |
|---|---|---|---|
| Low | `Co-Authored-By` tag | Not required | Not required |
| Medium | Same | Summary in evidence dir | Summary |
| High | Same | Detailed record | Detailed |

Elevated review required for: [list security-sensitive code categories for this project, e.g., authentication, payment processing, user data/PII, API security, database schema changes]

---

## Requirements Traceability

**Format:** `compliance/RTM.md`, Part B:

```markdown
| REQ-XXX | #NNN | Risk | Evidence | Status | Approver | Date |
```

**Status lifecycle:** DRAFT → IN PROGRESS → TESTED - PENDING SIGN-OFF → APPROVED - DEPLOYED

**JSDoc headers:** `@requirement REQ-XXX - Brief description` in modified source files.

---

## Compliance Artifacts

```
compliance/
├── RTM.md
├── test-plan.md                    # This document
├── test-cases.md
├── test-summary-report.md
├── pending-releases/
│   └── RELEASE-TICKET-REQ-XXX.md
├── approved-releases/
│   └── RELEASE-TICKET-REQ-XXX.md
└── evidence/
    ├── REQ-XXX/
    │   ├── test-scope.md           # Test plan for this requirement (PLAN stage)
    │   ├── e2e-results.json
    │   ├── sast-results.json
    │   ├── dependency-audit.json
    │   ├── security-summary.md
    │   ├── ai-use-note.md
    │   └── ai-prompts.md
    └── periodic/
        ├── sast-quarterly/
        ├── dependency-audit/
        ├── access-control/
        ├── audit-log/
        ├── pentest/
        ├── dr-test/
        └── third-party/
```

### Per-Requirement Test Scope

Every tracked requirement gets a `test-scope.md` created during the PLAN stage **before implementation**. Scope scales with risk:

| Risk | Content |
|---|---|
| Low | Standard gates + acceptance criteria. A few lines. |
| Medium | Above + targeted testing (access control, audit logging, dependency review), validation approach. Half a page. |
| High | Above + security testing detail, independent review plan, pen test consideration, business validation, AI detail. One page. |

Templates in workflow 1 (`1-plan-requirement.md`).

---

## Post-Deploy Verification

```bash
# Health check
curl -s [PRODUCTION_URL]/[HEALTH_ENDPOINT]

# Smoke test
curl -s [PRODUCTION_URL]/[PUBLIC_ENDPOINT] | head -c 200
curl -s -o /dev/null -w "%{http_code}" [PRODUCTION_URL]/

# Security verification (per Test Strategy post-deploy requirements)
curl -s -o /dev/null -w "%{http_code}" [PRODUCTION_URL]/[ADMIN_ENDPOINT]
# Expected: 401 or 403

curl -s -I [PRODUCTION_URL]/ | grep -iE 'x-frame-options|strict-transport'

curl -s [PRODUCTION_URL]/[NONEXISTENT_ENDPOINT]
# Expected: generic error, NOT stack trace
```

---

## Disaster Recovery

| Metric | Target |
|---|---|
| RTO | [e.g., 4 hours] |
| RPO | [e.g., 24 hours] |

Recovery procedures:
1. **Application failure:** [e.g., Redeploy previous version from hosting dashboard]
2. **Database recovery:** [e.g., Restore from backup]
3. **Full rebuild:** [e.g., Deploy from main to fresh environment]

---

## Periodic Review — Project Procedures

Per the Periodic Security Review Schedule (Tier 1):

```bash
# Quarterly SAST
semgrep scan --config auto --config p/security-audit --config p/owasp-top-ten [SOURCE_DIR]/ --json > compliance/evidence/periodic/sast-quarterly/sast-full-$(date -I).json

# Quarterly dependencies
npm audit --json > compliance/evidence/periodic/dependency-audit/npm-audit-$(date -I).json
npm outdated --json > compliance/evidence/periodic/dependency-audit/outdated-$(date -I).json

# Quarterly access control
npx playwright test --grep "access control\|unauthorized\|forbidden\|RBAC"
```

Annual pen test scope: [PRODUCTION_URL], API endpoints, auth mechanism, [database-specific injection testing], [other scope items]

---

## Workflow Files

| # | File | Purpose |
|---|---|---|
| 0 | `0-project-setup.md` | One-time: repository, CI, compliance setup |
| 1 | `1-plan-requirement.md` | Create REQ, classify risk, generate test scope |
| 2 | `2-implement-and-test.md` | Code, commit, run all local gates |
| 3 | `3-compile-evidence.md` | Gather test + security + AI evidence |
| 4 | `4-submit-for-review.md` | Create PR (triggers CI independent verification) |
| 5 | `5-deploy-main.md` | Merge, deploy, verify, finalize |

---

## Document Control

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | [DATE] | [AUTHOR] | Initial plan |

**Parent Documents:** Test Policy, Test Strategy, Test Architecture, Periodic Security Review Schedule (in devaudit/sdlc/files/)
