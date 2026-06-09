# Test Architecture

**Document Type:** Architecture Standards | **Version:** 2.0 | **Effective Date:** March 2026 | **Review Cycle:** Annual

**Owner:** QA Team / Test Engineers | **Approved By:** Engineering Leadership

---

## Purpose

This document defines the technical standards for how Metasession builds and structures test infrastructure. It specifies mandatory tools, frameworks, directory structures, design patterns, code conventions, CI/CD pipeline configuration, environment setup, and artifact storage.

This document answers **"what we build tests with and how we structure the code."** For why we test and our governance commitments, see the Test Policy (`sdlc/files/Test_Policy.md` in DevAudit). For how we approach testing methodically, see the Test Strategy.

Individual products implement these standards as documented in product-specific Test Plans.

---

## Scope

These standards apply to all Metasession products, client engagements, and internal systems.

---

## 1. Architectural Principles

### DRY (Don't Repeat Yourself)
- Reusable test utilities and helper functions across suites
- Shared fixtures and base classes
- Centralized configuration management
- Common assertion libraries and custom matchers

### Isolation
- Each test runs independently without side effects
- Database state reset between test runs
- External dependencies mocked to prevent flakiness
- Parallel execution enabled without interference

### Speed over Exhaustiveness
- Fast feedback prioritized (unit tests < 30 seconds)
- Parallelization and sharding for E2E suites
- Strategic test selection based on code changes — first concrete implementation is the three-tier E2E gating model (smoke / critical / regression), see Test_Strategy.md § *E2E gating model* (v0.1.53+)
- Regression suites optimized for execution time

### Traceability
- Tests linked to requirements via ticket IDs
- BDD feature files tagged with requirement references
- Automated requirement-test-result mapping

---

## 2. Test Pyramid Implementation

### Unit Layer (Foundation)

| Attribute | Standard |
|---|---|
| Coverage | Minimum 70% for critical modules |
| Speed | Suite completes in < 30 seconds |
| Scope | Individual functions, methods, components in isolation |
| Mocking | External dependencies must be mocked |

### Integration Layer (Middle)

| Attribute | Standard |
|---|---|
| Coverage | Minimum 80% of integration points |
| Scope | Component interactions, service integrations, API contracts |
| Data | In-memory databases or MSW for API mocking |

### E2E Layer (Top)

| Attribute | Standard |
|---|---|
| Coverage | 100% of critical user paths |
| Scope | Complete user journeys from UI to database |
| Browser support | Chromium, Firefox, WebKit |
| BDD | playwright-bdd for acceptance criteria |

### Additional Layers

| Layer | Standard |
|---|---|
| Security | SAST, SCA, DAST (see Section 3) |
| Performance | Load and stress testing before major releases |
| Accessibility | WCAG 2.1 AA for public-facing features |
| Visual regression | Optional, recommended for UI-heavy products |

---

## 3. Mandatory Tooling

### Test Frameworks

| Purpose | Tool | Notes |
|---|---|---|
| Unit testing (TS/JS) | Jest or Vitest | Project chooses one |
| Unit testing (Python) | pytest | |
| Component testing | React Testing Library | |
| E2E testing | Playwright | Organizational standard |
| BDD integration | playwright-bdd | |
| API mocking | MSW (Mock Service Worker) | |
| HTTP mocking | Nock | Node.js environments |

### Test Management

| Purpose | Tool |
|---|---|
| Test case management | Qase |
| CI/CD | GitHub Actions |
| Reporting | Playwright HTML Reporter, JUnit XML |

### Security Testing

| Purpose | Tool | When |
|---|---|---|
| SAST (static analysis) | Semgrep and/or SonarQube | Every commit |
| SCA (dependency scanning) | Snyk | Every commit |
| Dependency updates | Dependabot | Continuous |
| DAST (dynamic testing) | OWASP ZAP | Periodic / pre-release |
| Supply chain analysis | Socket.dev | Optional, for enhanced analysis |

### Performance Testing

| Purpose | Tool |
|---|---|
| Load testing | Artillery |
| Web performance | Lighthouse |

### Development Tooling

| Purpose | Tool |
|---|---|
| Git hooks | Husky |
| Commit linting | commitlint (Conventional Commits) |
| Code linting | ESLint |
| Code formatting | Prettier |
| Containerization | Docker |

---

## 4. Project Structure

All products organize tests in a centralized `/tests` directory:

```
/tests
  /__tests__              # Unit tests (mirrors src structure)
  /integration            # Integration tests
  /e2e                    # End-to-end tests
    /playwright           # Playwright test specs
    /pages                # Page Object Models (required)
    /components           # Component objects
  /bdd                    # BDD feature files (Gherkin)
  /performance            # Performance tests
  /visual                 # Visual regression tests (optional)
  /accessibility          # Accessibility tests
  /setup                  # Test utilities & configuration
    /fixtures             # Test data fixtures
    /mocks                # Mock implementations
    /utils                # Helper utilities
    /factories            # Data factories
  /config                 # Test framework configurations
  /reports                # Test reports (gitignored)
```

---

## 5. Design Patterns

### Page Object Model (Required for E2E)

All E2E tests must use the Page Object Model pattern:

- Page classes in `/tests/e2e/pages/`
- Component objects for reusable UI elements
- Locators defined as class properties
- Methods for user interactions
- No assertions in page objects — assertions belong in test files

### Custom Fixtures (Required)

Products must implement:

- Authentication fixtures (login states, session management)
- Database seeding/cleanup fixtures
- Test data factories using Faker.js and Fishery

### Shared Utilities (Required)

- Authentication helpers
- Date/time manipulation utilities
- Storage helpers (localStorage, cookies)
- Custom matchers and assertions

---

## 6. Test Data Management

### Strategy by Test Level

| Test Level | Data Strategy | Rationale |
|---|---|---|
| Unit | Mocked data | Fast, predictable |
| Integration | In-memory DB or MSW | Isolated, controlled |
| E2E (local) | Test database (Docker) | Real behavior, containerized |
| E2E (CI) | Ephemeral database | Production-like, auto-provisioned |
| Staging | Dedicated staging DB | Production-equivalent, anonymized |

### Data Factories (Required)

- Faker.js for realistic data generation
- Fishery for factory definitions
- Factories reusable across test types

### GDPR Compliance (Mandatory)

- No production PII in non-production environments
- Synthetic data for all test scenarios
- Data masking when copying production data
- Automatic cleanup after execution
- Access controls on test databases

---

## 7. CI/CD Pipeline Standards

### Required Pipeline Stages

All products implement these stages in order:

| Stage | Purpose | Exit Criteria |
|---|---|---|
| 1. Lint | ESLint + Prettier validation | 0 errors |
| 2. Type Check | Strict compilation | 0 errors |
| 3. Unit Tests | Component-level testing with coverage | Meets coverage target |
| 4. Security Scans | SAST + SCA | 0 high/critical findings |
| 5. Integration Tests | API and service validation | All pass |
| 6. E2E Tests | Full Playwright suite with parallelization | All critical paths pass |
| 7. Build | Production build verification | Succeeds |
| 8. Report | Artifact upload and status reporting | Artifacts stored |

PR cannot merge unless all stages pass.

### Parallelization (Required)

- E2E tests sharded across minimum 4 workers
- Matrix strategy for multiple browsers (Chromium, Firefox, WebKit)

### Release Pipeline

- Semantic versioning via Conventional Commits (release-please or equivalent)
- Changelog generated from commit messages
- GitHub releases with version tags
- Deployment pipeline triggered on merge to production branch

### Git Hooks Configuration (Required)

Hook templates are provided in `sdlc/files/hooks/` in the DevAudit repository. Copy them into your project during setup (see `0-project-setup.md` Step 5c).

**Pre-commit** (`.husky/pre-commit` — template: `hooks/pre-commit`):
- Runs lint-staged on staged files (ESLint + Prettier)
- Blocks commit on failure

**Commit-msg** (`.husky/commit-msg` — template: `hooks/commit-msg`):
- Runs commitlint to validate Conventional Commits format
- Required format: `type(scope): description`
- Warns on missing `Ref: REQ-XXX` and `Co-Authored-By` trailers
- Configuration: `commitlint.config.mjs` (template: `hooks/commitlint.config.mjs`)

**Pre-push** (`.husky/pre-push` — template: `hooks/pre-push`):
- TypeScript compilation check (`tsc --noEmit`) as a fast gate
- Full test suite, SAST, and dependency audit run in CI — not in the pre-push hook (too slow for a local gate)
- Blocks push on TypeScript errors

**Setup:**
```bash
npm install --save-dev husky @commitlint/cli @commitlint/config-conventional lint-staged
npx husky init
cp path/to/devaudit/sdlc/files/hooks/commit-msg .husky/commit-msg
cp path/to/devaudit/sdlc/files/hooks/pre-commit .husky/pre-commit
cp path/to/devaudit/sdlc/files/hooks/pre-push .husky/pre-push
chmod +x .husky/commit-msg .husky/pre-commit .husky/pre-push
cp path/to/devaudit/sdlc/files/hooks/commitlint.config.mjs commitlint.config.mjs
npm pkg set scripts.prepare="husky"
```

---

## 8. Artifact Storage

| Artifact | Storage | Retention |
|---|---|---|
| Test results (HTML) | GitHub Actions artifacts | 90 days |
| Screenshots | GitHub Actions artifacts | 90 days |
| Videos | GitHub Actions artifacts | 90 days |
| Coverage reports | Codecov | Indefinite |
| JUnit XML | GitHub Actions + Qase | 90 days + Indefinite |
| Release artifacts | AWS S3 / Azure Blob | 3-7 years (compliance) |
| Security scans | Snyk + SonarQube dashboards | Indefinite |
| SAST evidence (JSON) | Project compliance directory | 3 years minimum |
| Dependency audits | Project compliance directory | 3 years minimum |

### Flakiness Handling (Required)

- Retry strategy: 2 retries in CI, 0 locally
- Automatic quarantine detection for flaky tests
- Flaky tests create issues automatically
- Flaky tests addressed immediately or disabled with documented justification

---

## 9. File Naming & Code Style

### Naming Conventions

| File Type | Pattern | Example |
|---|---|---|
| Unit tests | `*.test.ts`, `*.test.tsx` | `auth.test.ts` |
| Integration tests | `*.integration.test.ts` | `api.integration.test.ts` |
| E2E tests | `*.spec.ts` | `login.spec.ts` |
| BDD features | `*.feature` | `authentication.feature` |
| Page objects | `*Page.ts` (PascalCase) | `LoginPage.ts` |
| Accessibility | `*.a11y.test.ts` | `navigation.a11y.test.ts` |

### ESLint Configuration

```javascript
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:playwright/recommended',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'playwright'],
  rules: {
    'playwright/no-skipped-test': 'warn',
    'playwright/no-focused-test': 'error',
    'playwright/valid-expect': 'error',
    'playwright/prefer-web-first-assertions': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  overrides: [
    {
      files: ['*.test.ts', '*.test.tsx', '*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
```

### Prettier Configuration

```json
{
  "semi": true,
  "trailingComma": "all",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
```

### Test Code Style

- Descriptive test names (sentences, not code identifiers)
- Arrange-Act-Assert pattern
- Maximum 1 assertion concept per test
- No test interdependencies
- BDD scenarios use Given/When/Then structure
- Test code maintained to same quality standards as product code
- Code review required for all test automation changes

---

## 10. Environment Configuration

### Environment Files

```
.env.local              # Local development (not committed)
.env.test               # Test environment (committed, no secrets)
.env.staging            # Staging (secrets in CI/CD only)
.env.production         # Production (secrets in CI/CD only)
.env.example            # Template for developers (committed)
```

### Secret Management

- All secrets in CI/CD platform secret storage (GitHub Actions Secrets)
- No secrets committed to version control
- Separate secrets per environment
- Rotation policy for sensitive credentials

### Containerization

- Docker Compose for local test environment
- Health checks for all services
- Automatic cleanup of containers
- Consistent environment across local and CI

---

## 11. Coverage & Quality Thresholds

| Metric | Target |
|---|---|
| Unit test coverage (critical modules) | 70% minimum |
| Integration point coverage | 80% minimum |
| Critical user path E2E coverage | 100% |
| Security scan (high/critical) | 0 findings |
| Accessibility (public-facing) | WCAG 2.1 AA |

### Quality Metrics (Required Tracking)

- Test coverage percentage by module
- Test execution time and trends
- Flaky test rate
- Bug escape rate (production defects not caught)
- Mean time to detect (MTTD)

### Review Cadence

- **Monthly** — Test suite health check
- **Quarterly** — Architecture standards review
- **Ongoing** — Remove obsolete tests, update documentation

---

## Product-Specific Implementation

Each product creates a product-specific Test Plan that:

1. Implements these organizational architecture standards
2. Documents product-specific configurations (framework versions, database schemas, URLs)
3. Provides practical examples for the product's stack
4. Defines migration timelines for implementing standards (if not yet fully compliant)
5. Lists product-specific test scenarios and critical paths

---

## Document Control

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | January 2026 | QA Team | Initial creation |
| 2.0 | March 2026 | QA Team | Clean boundary split — removed compliance/governance content (now in Policy), removed methodology content (now in Strategy). Architecture now owns tools, patterns, code standards, CI config only. Added security tooling table. |

**Next Review Date:** March 2027

**Related Documents:** Test Policy, Test Strategy, Periodic Security Review Schedule, Project Test Plans (in devaudit/sdlc/files/)

---

**Architecture Status:** Approved | **Effective Date:** March 2026
