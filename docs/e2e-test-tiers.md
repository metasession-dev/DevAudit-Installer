# E2E test tiers — the three-tier gating model

> **Audience.** Operators and test engineers. Read this once to understand the smoke / critical / regression split that ships with DevAudit v0.1.53+, why the framework runs different E2E projects on different triggers, and how to opt your project in.

A single "run all the E2E tests on every push" model is expensive — a 35-minute regression suite blocks every commit, every PR, every release. A single "run nothing until release time" model is cheap but lets defects slip past the per-feature pre-merge review. The 3-tier gating model splits the suite by trigger so each tier carries the right cost / coverage trade-off.

DevAudit ships the tier convention + the per-tier Playwright project shape; consumers own the workflow file that runs them (the framework provides a reference at [`sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml`](../sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml) — copy it into your repo's `.github/workflows/e2e-regression.yml`).

## The three tiers

| Tier        | Triggers                                                                                | Playwright project              | Spec location                                              | Wall-clock target | What it covers                                                                                                                                                                              | What turns it red                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Smoke**   | `push: branches: [develop]` via `ci.yml`                                                | `smoke`                         | `e2e/smoke/`                                                | ~3–5 min          | The Must-have AC subset for every shipped REQ — auth flow, payment happy-path, the single most user-visible feature surface. Tier 1 confidence that "the app still works."                | Real regression (block merge to develop)                                                                                   |
| **Critical** | `pull_request: branches: [main]` via `e2e-regression.yml`                              | `critical` (selects smoke + critical) | `e2e/smoke/` + `e2e/critical/`                              | ~10–15 min        | Smoke + the second-priority specs that test feature regressions the smoke tier doesn't catch. Tier 2 confidence that "the about-to-be-promoted code still meets every Must-have AC."  | Real regression (block release-PR merge)                                                                                   |
| **Regression** | `push: branches: [main]` (post-merge) + nightly + `workflow_dispatch`                | `regression` (full suite — all projects) | `e2e/**/*.spec.ts`                                          | ~35 min           | Full suite — every Must / Should / Could AC across every project. Tier 3 confidence; the auditor's perspective.                                                                          | Auto-files a `bug, priority:high` GitHub issue tagging the merge commit + the failing specs. **No auto-revert.** Operator triages within working hours: hotfix forward / revert / accept-with-rationale. |

The three projects are independent Playwright projects defined in your `playwright.config.ts` — you pick which spec runs in which by **where you put the file**, not by tag. `e2e/critical/foo.spec.ts` runs in the critical project (which includes smoke + critical); `e2e/api-area/bar.spec.ts` runs only in the regression project.

## Why three tiers, not two

The smoke / regression split alone has a real cost: regressions that slipped past smoke land on develop, then on main, then on production. The merge happened on the strength of an inadequate gate. The regression suite that catches it nightly fires _after_ the bug shipped — auditors notice this gap.

The critical tier closes it. It runs at PR-to-main time with a target ~10–15 min wall-clock — short enough to gate the merge without blocking velocity, long enough to cover the second-priority specs the smoke tier intentionally skips. Practically, "second-priority" means: any spec that tests a regression you've actually seen in the wild, or any spec that tests a Must-have AC for a non-happy-path scenario (admin overrides, edge cases, the payment-failure flow).

## Per-AC routing — where does this spec belong?

The `e2e-test-engineer` skill picks the tier per spec based on MoSCoW priority:

- **Must-have AC, happy-path.** → `e2e/smoke/` — smoke tier. The regression that breaks this is a P0; we want every push to catch it.
- **Must-have AC, edge-case / regression.** → `e2e/critical/` — critical tier. Will the smoke tier catch it? Probably not. Should the release PR catch it? Yes.
- **Should-have AC.** → `e2e/<area>/` — regression tier only. Catching it nightly is acceptable.
- **Could-have AC.** → `e2e/<area>/` — regression tier only. Same reasoning.

The skill records its tier decision in the per-REQ `test-execution-summary.md` § _Test design_ so the auditor can verify the routing was deliberate.

## Workflow file shape

The reference workflow lives at [`sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml`](../sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml). The skeleton:

```yaml
name: E2E Regression

on:
  workflow_dispatch:
    inputs:
      specs:
        description: 'Space-separated spec paths or --grep pattern.'
        required: false
        default: ''
  pull_request:
    branches: [main]
  push:
    branches: [main]
  schedule:
    - cron: '0 2 * * *'   # nightly 02:00 UTC

jobs:
  e2e-regression:
    runs-on: ubuntu-latest
    steps:
      # ... checkout / setup / seed steps ...
      - name: Pick tier
        id: select
        run: |
          case "${{ github.event_name }}" in
            pull_request)        echo "project=critical"   >> "$GITHUB_OUTPUT" ;;
            push|schedule)       echo "project=regression" >> "$GITHUB_OUTPUT" ;;
            workflow_dispatch)   echo "project=${{ inputs.project || 'regression' }}" >> "$GITHUB_OUTPUT" ;;
          esac

      - name: Run E2E
        env:
          PLAYWRIGHT_JSON_OUTPUT_NAME: e2e-regression-results.json
        run: npx playwright test --project="${{ steps.select.outputs.project }}" --reporter=json,html

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-regression-report
          path: |
            e2e-regression-results.json
            playwright-report/
            test-results/

      # Post-merge auto-issue on failure (push:branches:[main]) — see reference workflow for the body.
```

**Portal evidence upload — automatic via `workflow_run`.** The DevAudit-generated `compliance-evidence.yml` carries a `workflow_run` trigger that listens for the project-owned `E2E Regression` workflow to complete (DevAudit-Installer#149). It downloads the prior run's `e2e-regression-report` artifact via `actions/download-artifact@v4` `run-id`, derives the release version against the triggering SHA, and uploads:

- `e2e-regression-results.json` → `evidence_type=e2e_result`
- `playwright-report/index.html` → `evidence_type=test_report`

Both upload against each in-scope REQ with `--meta-key tier=critical` (PR-to-main path) or `--meta-key tier=regression` (push-to-main + nightly + dispatch path). The portal groups by tier on the release detail so the UAT four-eyes reviewer sees the smoke results from the feature PR's develop merge **and** the critical-tier results from the release PR side-by-side.

## Per-AC screenshot capture — the `evidenceShot` helper

Every spec captures one PNG per acceptance criterion via the framework's `evidenceShot(page, reqId, ac, slug)` helper. The helper:

1. Calls `page.screenshot()` and writes the PNG to `compliance/evidence/REQ-XXX/screenshots/REQ-XXX-AC<n>-<slug>.png`.
2. Writes a sidecar JSON at `<file>.png.meta.json` carrying `{ origin: 'feature' | 'regression', ac, slug, ts }`.
3. The portal renders the screenshot in the per-REQ release detail under the AC it proves.

The framework's `ci.yml` Upload Evidence step (DevAudit-Installer#147) globs these per-REQ scoped (so legacy folders for closed REQs don't pollute the current release's upload) and uploads them as `evidence_type=screenshot` + `evidence_category=test_report`. The portal's filename validator enforces the `REQ-XXX-AC<n>-<slug>.png` shape — anything else returns HTTP 400, which now turns the Upload Evidence step RED instead of silently warning.

> **Important — the post-merge full regression auto-files an issue on failure.** The framework intentionally does NOT auto-revert. False positives, flakes, and UAT-data drift are real failure classes that need human judgement — the operator triages within working hours, deciding whether to hotfix forward, revert the merge commit, or accept the failure with a documented rationale on the release ticket. If the failing spec turns out to be a Must-tier candidate the critical tier should have caught, move the file from `e2e/<area>/` to `e2e/critical/` so the next PR-to-main runs it.

## Opting your project in

1. **Run `npx @metasession.co/devaudit-cli@latest update`** — gets you the v0.1.53+ framework (the reference workflow, the `evidenceShot` helper, the upload-evidence script with `workflow_run` integration, the per-REQ screenshot scoping).
2. **Copy `e2e-regression-3-tier.yml` into your repo** — the reference workflow doesn't sync automatically because consumers customise it per project (Mongo / Postgres / Supabase service config, seed-data step, env-var shape). Drop it at `.github/workflows/e2e-regression.yml` and adapt the service blocks for your stack.
3. **Update your `playwright.config.ts`** to define the three projects:

   ```ts
   projects: [
     { name: 'smoke',      testDir: 'e2e/smoke' },
     { name: 'critical',   testDir: 'e2e', testMatch: ['smoke/**/*.spec.ts', 'critical/**/*.spec.ts'] },
     { name: 'regression', testDir: 'e2e', testMatch: '**/*.spec.ts' },
   ]
   ```

4. **Sort your existing specs into the three directories** — `e2e-test-engineer` handles this automatically on the next REQ cycle.
5. **Wire the secrets** — the workflow needs the same `DEVAUDIT_API_KEY` + `DEVAUDIT_BASE_URL` the rest of CI uses (set during onboarding).

The first PR-to-main after the change runs the critical tier; the next merge to main runs the full regression and starts the auto-issue path on failure.

## See also

- [`compliance-gates.md`](./compliance-gates.md) — how `compliance-evidence.yml`'s `workflow_run` trigger picks up the E2E artefacts
- [`skills.md`](./skills.md) — the `e2e-test-engineer` skill that authors the specs and routes them to the right tier
- [`evidence-tiers.md`](./evidence-tiers.md) — Tier 3 per-REQ evidence; the screenshot + JSON results are part of it
- [`Test_Strategy.md`](../sdlc/files/_common/Test_Strategy.md) — the per-tier cost philosophy + MoSCoW priorities
- Reference workflow: [`sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml`](../sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml)
