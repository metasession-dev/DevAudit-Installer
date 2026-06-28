# DevAudit Test Process — Short Reference

> **One-liner:** Risk-based testing across 5 SDLC stages, 3 E2E tiers, and 5 per-commit CI gates — with every test result traceable to a requirement and uploaded as compliance evidence.

---

## The 5 Stages

| Stage | What happens | Test focus |
|---|---|---|
| **1. Plan** | Issue → REQ-XXX, risk class, test scope, test plan | Depth decided by risk (LOW → unit only; HIGH → unit + integration + E2E + security + independent review) |
| **2. Implement & Test** | TDD: failing tests first, then implement, then gates | Local gates: lint → tsc → vitest → semgrep → npm audit → playwright |
| **3. Compile Evidence** | Re-run full pack, organise artefacts, upload to portal | Playwright report, coverage, screenshots, SAST, incident reports |
| **4. Submit for Review** | PR to release branch with evidence body | CI re-runs all gates independently; UAT approval required on portal |
| **5. Deploy** | Merge to main, post-deploy production smoke | Auto-uploaded with `environment=production`; mark Released on portal |

## Risk-Based Testing Depth

| Activity | LOW | MEDIUM | HIGH |
|---|---|---|---|
| Unit tests | Required | Required | Required |
| Integration tests | As applicable | Required | Required |
| E2E tests | Critical paths | Full coverage | Full coverage + negative/abuse |
| SAST + dependency audit | Required | Required | Required |
| Access control testing | If applicable | Required | Required |
| Independent review | — | — | Required |

AI involvement raises risk by one level. AI regeneration triggers full retest.

## 3-Tier E2E Gating

| Tier | Location | When | Blocking? |
|---|---|---|---|
| **smoke** | `e2e/smoke/` | Every push to integration branch | Yes |
| **critical** | `e2e/smoke/` + `e2e/critical/` | PR to release branch | Yes |
| **regression** | all `e2e/**/*.spec.ts` | Nightly + post-merge to release | No — auto-files hotfix issue on failure |

## Per-Commit CI Gates

Every push runs: **TypeScript** (0 errors) → **SAST** (0 high/critical) → **Dependency audit** (0 high/critical) → **E2E smoke** (all pass) → **Build** (succeeds). Results auto-upload to DevAudit portal.

## Evidence Per REQ

Each REQ produces:

- `test-scope.md` + `test-plan.md` (Stage 1)
- Unit test results + coverage (Stage 2–3)
- E2E Playwright report + per-AC screenshots via `evidenceShot()` (Stage 2–3)
- `tagTest('REQ-XXX', ac)` annotations in every test body (portal join key)
- `test-execution-summary.md` (Stage 3)
- SAST report, dependency audit, AI use record (Stage 3)
- SRS alignment, architecture decision, risk assessment (Stage 3)

## Evidence-Completeness Gate

CI checks each in-scope REQ: zero tagged tests + zero screenshots + zero on-disk spec references → **hard error, release blocked**. Specs found on disk but not in smoke run → non-blocking warning.

## Traceability Chain

```
Requirement (REQ-XXX in RTM)
  → Test Cases (test-scope.md, test-plan.md)
    → Test Results (CI logs, Playwright reports, coverage)
      → Code Commits (Ref: REQ-XXX trailers)
        → PR Review (four-eyes, recorded identity)
          → Deployment (merge commit, post-deploy smoke)
```

All artefacts retained 3 years. Audit-ready retrieval within 24 hours.

## Key Enforcement Points

- **No bypasses** — `--no-verify`, `eslint-disable`, `@ts-expect-error`, `xfail` all prohibited
- **E2E delegation** — `sdlc-implementer` cannot author `e2e/**/*.spec.ts`; must delegate to `e2e-test-engineer` skill
- **E2E gate sentinel** — `.e2e-gate-passed` file required before commit if UI-facing files touched
- **Four-eyes** — MEDIUM/HIGH risk requires second human reviewer; self-merge blocked
- **Post-merge safety net** — failing regression auto-files hotfix issue; no silent shipping of red tests
