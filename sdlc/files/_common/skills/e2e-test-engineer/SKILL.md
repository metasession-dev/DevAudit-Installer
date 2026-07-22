---
name: e2e-test-engineer
description: Maintain or bootstrap a project's end-to-end and visual regression test pack. Use when the user wants to add, update, or retire e2e or visual tests for a feature, ticket, issue, or PR — OR when no e2e suite exists yet and one needs setting up using best practices for the detected stack. Covers deriving the scenarios a change needs, matching the project's conventions, removing obsolete tests (only after confirmation), running the suite, and filing defects for failures or missed acceptance criteria. Trigger on phrases like "add e2e tests for [ticket]", "update the test pack", "what tests do we need for this issue", "are any tests obsolete", "run the e2e tests and file issues", "add visual regression coverage", "set up e2e tests for this project", or "bootstrap an e2e suite". Framework-agnostic (Playwright, Cypress, Selenium, etc.) and tracker-agnostic (GitHub, Jira, Linear, etc.). Do NOT use for unit, component, or API-only tests, or performance tests.
---

# E2E Test Engineer

Maintain or bootstrap a project's e2e and visual regression test suite. Given an issue (or ticket, or PR) plus the implementation, derive the scenarios the change actually needs, reconcile them with what's already there (adding what's missing, retiring what's obsolete), run the suite, and surface defects and missed acceptance criteria. When no suite exists yet, set one up using best practices for the detected tech stack before adding the change's tests as the first real tests in the new suite.

## Scope

**In scope**
- End-to-end tests (UI-driven, user-flow level) in any framework.
- Visual regression tests in any tool.
- Maintaining an existing test pack — adding, updating, retiring tests.
- Bootstrapping a new e2e suite when none exists, including framework selection, structure, configuration, a starter smoke test, and (optionally) CI integration.

**Out of scope**
- Unit, component, or API-only tests.
- Performance, load, or accessibility audits, unless the project's e2e pack already includes them — in which case follow its lead.

**Transport-layer specs that live in `e2e/`** (Node `fetch` against webhooks, `MongoClient` queries, `socket.io-client` assertions) ARE in scope — they exercise the deployed system end-to-end, just at the transport boundary rather than the UI. Their evidence form is `test-execution-summary.md`, not `evidenceShot` (see *Specs with no page object* below). The "API-only tests" exclusion above means **unit-level** API contract tests that exercise a route handler in isolation, not transport-boundary integration tests against the running system.

## The workflow

Six phases. Don't skip them and don't reorder — each one feeds the next. Communicate progress as you go; long silent phases feel like the skill has stalled.

### Phase 1 — Orient

Three things must be in hand before designing tests: the **test stack**, the **change**, and the **issue tracker**. Discover them in parallel where possible.

**Detect the test stack** from the repo:

- *E2E framework signals* — `playwright.config.*`, `cypress.config.*`, `wdio.conf.*`, `nightwatch.conf.*`, `codecept.conf.*`, `testcafe.config.*`. Failing that, check `package.json` dependencies for `@playwright/test`, `cypress`, `webdriverio`, `puppeteer`, `selenium-webdriver`, or Python equivalents (`pytest-playwright`, `selenium`, `splinter`).
- *Test location* — common patterns: `e2e/`, `tests/e2e/`, `cypress/e2e/`, `playwright/`, `test/e2e/`, `__tests__/e2e/`.
- *Visual regression tool* — Playwright or Cypress built-in snapshots, `cypress-image-snapshot`, `cypress-visual-regression`, `percy`, `applitools-eyes-*`, `chromatic`, `backstop.json`, `loki`, `reg-suit`. If none of these are present, the project doesn't do visual regression and you should only add it if the issue explicitly asks for it.
- *Run command* — search `package.json` scripts for `e2e`, `test:e2e`, `cy:run`, `pw:test`. Failing that, check `Makefile`, `justfile`, `tox.ini`, `pyproject.toml`, CI config. If still unclear, ask.

**Detect the issue tracker** so you can read the input issue now and file defect issues later:

- GitHub: git remote on `github.com` → use the `gh` CLI if installed, or a connected GitHub MCP.
- GitLab: `glab` CLI or a GitLab MCP.
- Jira: an Atlassian MCP, or `jira-cli` config.
- Linear: a Linear MCP.
- Azure DevOps: the `az boards` CLI or an ADO MCP.
- None of the above: ask the user where the source issue lives and where defects should go. Final fallback is a paste-ready markdown report.

**Take in the change.** The user typically gives you one of:

- An issue/ticket ID or URL → fetch its full text, description, comments, and acceptance criteria.
- A PR/MR URL or a branch name → fetch the description and the diff.
- A pasted description → use what you've been given; ask for the diff or branch if not provided.

Briefly summarise what you found (the stack, the tracker, the change in one or two sentences) and confirm before continuing. The user is far more responsive to corrections now than after you've written twelve test files.

**If no e2e suite was found, go to Phase 1b before continuing.** Otherwise skip to Phase 2.

### Phase 1b — Bootstrap (only when no suite exists)

This phase runs only if Phase 1 found no e2e framework, no test directory, and no relevant dependencies. Don't run it just because the existing suite is small or messy — that's a maintenance problem, not a bootstrap one.

The goal of bootstrap is a working, well-configured e2e suite with one passing smoke test, set up so that any tests added afterward (including the change's tests in Phase 5) feel native to the project. **Read `references/bootstrap.md`** before you start — it has the per-stack framework recommendations, official-installer commands, config best practices, and structure templates.

The bootstrap workflow:

1. **Gather extra context** beyond what Phase 1 found:
   - Frontend framework (React, Vue, Angular, Svelte, Next.js, Nuxt, mobile, Electron, etc.) — from `package.json` deps or equivalent.
   - Language — `tsconfig.json` for TypeScript, otherwise JS or whatever the project uses.
   - Package manager — `pnpm-lock.yaml` → pnpm; `yarn.lock` → yarn; otherwise npm. Or pip/poetry/uv for Python; bundler for Ruby; etc.
   - Dev server command and port — from `scripts` in `package.json` or the equivalent.
   - CI system — `.github/workflows/`, `.gitlab-ci.yml`, `.circleci/`, `Jenkinsfile`, `azure-pipelines.yml`.
   - Any existing unit/integration test framework — for matching style (assertions, file naming, runner conventions).

2. **Propose a framework choice with a one-line rationale, and get explicit confirmation.** This is a long-lived decision; do not install anything without a clear "yes". Use `references/bootstrap.md` for the recommendation matrix. Briefly mention the runner-up so the user can override if their team has a preference you couldn't infer.

3. **Decide whether to include visual regression now.** If the user asked for it, or the originating issue is visually significant, yes. If unsure, ask. Visual regression has its own tooling decision (built-in snapshots vs cloud service like Percy/Chromatic/Applitools) — `references/bootstrap.md` covers this.

4. **Install with the official installer** wherever one exists (e.g. `npm init playwright@latest`, `npx cypress install`). Official installers set up sensible defaults the skill shouldn't try to second-guess.

5. **Lay out the directory structure** for the project's expected scale: a top-level test directory (`e2e/` or whatever the framework's installer chose), with subfolders for specs, fixtures, page objects (or fixture-based equivalent), helpers, and visual specs if applicable. Write the structure as a short tree in your reply so the user can see what was created.

6. **Configure for best practice** — base URL pointing at the project's dev server, retries on CI only, parallel workers, an HTML reporter, trace on first retry, `screenshot: 'only-on-failure'` (failure forensics — see *Evidence vs failure forensics* below for per-AC evidence capture), video retention on failure, and (if the framework supports it) auto-starting the dev server before the suite runs. Specifics per framework are in `references/bootstrap.md`.

7. **Establish the abstraction pattern** — write one Page Object Model (or one fixture, depending on framework idioms) as a worked example so the change's tests in Phase 5 have a template to follow.

8. **Write a smoke test** that proves the setup works end-to-end: load the home page, assert the title or a known stable element. Run it. It must pass before you continue.

9. **Wire up runner scripts** — at minimum `test:e2e` (headless), `test:e2e:ui` or `:headed` (interactive), `test:e2e:debug`, and `test:e2e:update-snapshots` if visual regression is in.

10. **Offer a CI job** — write the YAML (or equivalent) for the project's CI system, but **do not commit it without confirmation**. Show it inline first. On a **DevAudit** project, `.github/workflows/ci.yml` is generated and marked do-not-edit-manually — don't hand-edit it; instead drive the E2E gate from `sdlc-config.json`. If the suite must run against a **disposable local database** (the rule on any project with no separate test instance — never test against prod), set `e2e_setup_command` (e.g. `supabase start` + load schema + seed) and `e2e_env` (e.g. `E2E_LOCAL=1`, local coords, a dummy email key) so the gate severs production. See [Local-database E2E in CI](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/e2e-local-db-ci.md), then `devaudit update` to regenerate.

    **Upload both artefact shapes.** Playwright writes per-test artefacts to *two* places: `test-results/<spec>-<title>[-retryN]/{trace.zip, video.webm, *.png, error-context.md}` — **spec-named**, human-mappable — and `playwright-report/data/<content-hash>.zip` — **hash-named**, indexed by the HTML report. Ensure the project's CI uploads **both** `playwright-report/` (for the HTML viewer) and `test-results/` (for spec-named traces / videos / error-context). If only one is uploaded, propose a small follow-up PR to add the other — it costs ~80 MB of artefact storage and saves the operator from walking the HTML report's hash index to find a specific trace.

11. **Write a short README** in the test directory explaining structure, how to run, how to add new tests, and how to update visual baselines. Future contributors (and the skill itself, on next invocation) will thank you.

After bootstrap, if there's a change to test, continue to Phase 2 as normal. If the user only wanted the suite set up with no specific change in mind, stop here with a final summary.

### Phase 2 — Understand the change

You cannot write the right tests without understanding what changed and why. Spend real time here.

1. **Read the issue end-to-end.** Capture: the user-facing goal, the explicit acceptance criteria (number them), any negative criteria ("should not allow X"), edge cases the description mentions, and any references to existing behaviour that must stay intact.

2. **Read the implementation.** From the diff or branch:
   - Which files changed — routes, components, state, API contracts, styles?
   - What's the user-facing entry point — what URL, what control, what flow leads here?
   - What pre-conditions does the new behaviour assume — auth state, feature flag, seed data?
   - What adjacent surfaces share code with the change and could regress as a side effect?

3. **Read the surrounding app** enough to know how a real user reaches the changed area. Look at routing, navigation, and the one or two most adjacent features.

4. **Write a short mental model** in your reply: *trigger → new behaviour → expected outcomes → likely side-effects*. If anything is ambiguous, ask the user before designing scenarios. Guesses here cascade into bad tests.

### Phase 3 — Design scenarios

The goal is the *minimum* set of scenarios that, if they all pass, would give a reasonable person high confidence the change works as intended and hasn't broken adjacent functionality. "Minimum" is load-bearing: e2e tests are slow to run and expensive to maintain, and a bloated suite gets ignored.

Derive scenarios from these sources, in this order:

1. **One scenario per acceptance criterion.** If an AC is compound ("user can filter by status AND see a count"), split it.

2. **One negative scenario per error path the change introduces.** Invalid input, unauthorised access, network failure — only if the change has explicit handling for it.

3. **Boundary scenarios** where the change has obvious boundaries: empty state, max length, zero results, single result, many results.

4. **Adjacent regression scenarios** — pick the one or two nearby flows most likely to break because they share code with the change. Don't try to re-test the whole app from this seat.

5. **Visual regression scenarios** (only if the project does visual regression): each visually-changed component or page state gets a snapshot at the breakpoints the project already covers. Add one or two adjacent surfaces that share styling.

Resist padding. A new endpoint doesn't need a test that re-verifies login if login is already covered. Match the project's existing depth — if it covers one happy path per feature, don't add six.

For each scenario, write a one-line description. Present the full grouped list to the user before writing any code: *"Here's the coverage I'd propose — anything to add or drop?"*

#### Classify each spec into a tier (devaudit#152 follow-up, v0.1.53)

When designing each scenario, also pick the tier it'll live in. Three tiers map to MoSCoW priority + gating point (see `Test_Strategy.md` § *E2E gating model*):

| Tier | File location | Picks this when… |
| --- | --- | --- |
| **smoke** | `e2e/smoke/*.spec.ts` | Cross-cutting sanity that proves the app is up: login, basic nav, one canonical CRUD per main domain. Runs on every push to the integration branch. Keep small — total smoke wall-clock target is ~3–5 min. |
| **critical** | `e2e/critical/*.spec.ts` | Must-priority SRS item that breaks a headline flow if it regresses. Examples: payment authorisation, order completion, admin permission editing, RBAC enforcement on financial surfaces. Runs on PR-to-release-branch. Total critical wall-clock target ~10–15 min (includes smoke). |
| **regression** | `e2e/<area>/*.spec.ts` | Should/Could-priority SRS item, edge cases, less-load-bearing flows. Runs by dispatch and any consumer-configured post-merge or scheduled cadence. Total full pack can be 30+ min; that is the point of the tier. |

Decision tree, applied per scenario:

1. **Does the spec prove a Must-priority SRS AC (or a baseline "app is up" sanity check)?** → smoke or critical.
2. **Within Must: would a regression here break a headline business flow visible to a paying customer or stop a release from shipping?** → critical. Otherwise → smoke.
3. **Should/Could priority, edge case, advanced flow?** → regression (file under `e2e/<area>/`, not under `e2e/smoke/` or `e2e/critical/`).

When you can't decide between critical and regression, default to **regression** — promoting a spec from regression → critical later is cheap (move the file); demoting in the other direction is rarely needed but equally cheap. The cost of putting a Should spec in critical is everyone waiting longer on every PR-to-main for a low-value signal.

Record the tier choice in the eventual `test-execution-summary.md` § *Test design* (devaudit#50) — Layers covered should name which tier each new spec landed in. Reviewers verify the tier choice is defensible during the WAIT CHECKPOINT.

### Phase 4 — Reconcile with existing tests

For the area touched by the change, look at what's already there.

1. **Overlap** — find existing tests that already cover scenarios from Phase 3. Don't duplicate; either reuse or note the overlap and drop the duplicate from your add list.

2. **Obsolete** — a test is obsolete when:
   - The behaviour it asserts has been intentionally removed or replaced.
   - The selectors or routes it uses no longer exist and the new equivalents are covered elsewhere.
   - It tests an old version of a flow that has been fully superseded.

   A test is **not** obsolete just because it's failing. Failing tests are signals, not garbage. Be conservative — when in doubt, propose updating rather than deleting.

3. **Needs updating** — existing tests where the scenario is still valid but selectors, routes, or assertions have shifted.

Present three lists to the user:
- **To add** — new scenarios not already covered.
- **To update** — existing tests needing adjustment.
- **To delete** — genuinely obsolete tests, each with a one-line rationale.

**Do not delete anything without explicit confirmation.** Not even tests you're 95% sure about. The cost of asking is one sentence; the cost of deleting real coverage is real. Wait for a clear "yes, delete those" before removing anything.

### Phase 5 — Implement

Write the tests in the project's existing style.

- **Match the structure.** Same directory, same file-naming pattern, same test-ID or tag convention.
- **Reuse existing helpers.** Page Object Models, fixtures, custom commands, test-data factories — use them. Don't invent parallel infrastructure.
- **Match the assertion style.** If the codebase uses `expect(locator).toBeVisible()`, don't switch to `assert.isTrue(...)`.
- **Read 2–3 nearby tests before writing.** Fastest way to absorb conventions you wouldn't have noticed otherwise.
- **Check `references/common-patterns.md` before writing role-based locators** for component-library UI (shadcn/ui, Radix, MUI, etc.). A short appendix of known framework × library gotchas — `CardTitle` is a `<div>` not a heading; Radix `<Select>` renders two `role="combobox"` nodes; Next.js `<Link>` clicks don't fire network requests — saves a round-trip through a failing selector each time.

#### Tag every test with its REQ and AC (devaudit-installer#196)

Every test spec covering an in-scope REQ **must** call `tagTest()` at the top of the test body, before any assertions or interactions:

```ts
import { tagTest } from './helpers/test-tags';

test('verification code submit', async ({ page }) => {
  tagTest('REQ-083', 1);  // REQ-083, acceptance criterion 1
  // ... test body
});
```

For tests covering multiple ACs, pass an array: `tagTest('REQ-083', [1, 2])`.

For transport-layer specs (no `page` object), `tagTest` works identically — it only touches `test.info()`, no Playwright `page` required.

**Why this is mandatory:** The DevAudit portal's per-REQ approval card (`ReqApprovalCard`) joins test results with screenshots by acceptance criteria using `test.info().annotations`. Without `tagTest()`, every REQ shows "no tests in report tagged with this REQ" even though the test ran and passed — defeating the AC-by-AC breakdown that reviewers rely on (#196).

The helper is synced to `e2e/helpers/test-tags.ts` by `devaudit update` alongside `evidence.ts`. Do not inline annotation logic — use the helper so the annotation format stays consistent with what the portal parser expects.

For **visual regression** specifically:
- New tests need baseline images. Generate them, but **do not auto-approve** — surface them for the user to verify before they're committed.
- Use the project's existing breakpoints, viewports, and element-masking conventions.

Do additions, updates, and (approved) deletions in the same change so the suite stays internally consistent.

### Phase 5½ — Evidence wiring validation

Before running the suite (Phase 6), verify that the evidence traceability wiring is in place. A spec can pass Phase 6's "AC covered" check by having a correct assertion without ever calling `evidenceShot()` or tagging `@requirement` — producing zero portal evidence and letting the release reach UAT with no traceable screenshots (DevAudit-Installer #170, #169).

**For each in-scope REQ and its ACs from Phase 2's scenario table:**

1. **Check `@requirement` annotation.** Grep the authored/modified spec files for `@requirement REQ-XXX` tags. Every spec file that covers an in-scope REQ must carry at least one `@requirement REQ-XXX` annotation so the CI's `detect-req` step and the portal's evidence-by-requirement view can find it.

2. **Check `evidenceShot()` calls.** For each UI spec covering an in-scope REQ, grep for at least one `evidenceShot(page, 'REQ-XXX', <ac>, ...)` call per AC. The call must be placed **at the assertion that proves the AC**, before any further interaction or navigation. API-only specs that don't have a visual surface are exempt — note the exemption in the test-execution-summary.

3. **Check `tagTest()` calls (devaudit-installer#196).** Grep the authored/modified spec files for `tagTest('REQ-XXX', …)` imports and calls. Every test covering an in-scope REQ must call `tagTest()` at the top of the test body so the Playwright JSON reporter emits the REQ/AC association in `test.info().annotations`. The portal's `ReqApprovalCard` uses this to map test results to requirements — without it, the per-REQ approval card shows "no tests in report tagged with this REQ" even though the test ran and passed.

   ```bash
   # Quick check — should find at least one tagTest call per in-scope REQ
   grep -rn "tagTest('REQ-" e2e/ --include='*.spec.ts'
   ```

   Also verify the import is present: `import { tagTest } from './helpers/test-tags'` (or the correct relative path from the spec's location to `e2e/helpers/test-tags.ts`).

4. **Check release and execution provenance.** Before handing the work back to `sdlc-implementer`, identify the tracked `REQ-XXX`, the source branch SHA, and the expected SDLC stage/test execution for the run. The CI evidence upload must retain those values so the portal can show the result in the correct numbered execution for the release that produced it.
   - A passing local run is not portal evidence by itself. Report it as local verification and let the configured CI workflow upload the resulting report and screenshots.
   - For a bundled release, evidence remains attributed to its originating REQ and execution. The absorbing release may reference that source release through bundle lineage, but must not relabel the source E2E run as newly produced by the absorbing REQ.
   - Confirm the CI invocation has an unambiguous release context (`REQ-XXX` or the documented standalone-housekeeping declaration). A bare-date integration housekeeping run is historical CI only; it must not create an approval-ready E2E evidence set.
   - If the project workflow cannot provide this context, halt and report a workflow-contract gap. Do not claim that screenshots or E2E results will appear correctly on the portal.

**If any check fails:**

Halt and report the gap to the user:
> Evidence wiring incomplete for REQ-XXX:
> - Missing `@requirement REQ-XXX` annotation in `e2e/<area>/foo.spec.ts`
> - Missing `evidenceShot()` call for AC2 in `e2e/<area>/bar.spec.ts`
> - Missing `tagTest('REQ-XXX', …)` call in `e2e/<area>/baz.spec.ts`
>
> These must be fixed before running the suite — without them the portal will show zero screenshots and zero tagged tests for this REQ, and the CI gate (#169) will block the release.

Do **not** proceed to Phase 6 until all gaps are resolved. The user may choose to skip an AC (e.g. API-only, transport-only) — that's valid, but it must be an explicit decision recorded in the test-execution-summary, not an omission.

**Write the evidence-wiring sentinel (devaudit-installer#226).** After all Phase 5½ checks pass (all `@requirement`, `evidenceShot()`, `tagTest()`, and release/execution provenance checks verified), write a `.e2e-evidence-wired` sentinel file in the repo root so the pre-push hook and `sdlc-implementer` Phase 2 step 5b can verify evidence wiring was validated:

```bash
echo "WIRED $(date -u +%Y-%m-%dT%H:%M:%SZ) REQ-XXX" > .e2e-evidence-wired
```

If the user explicitly skipped an AC (e.g. API-only), note it in the sentinel:

```bash
echo "WIRED $(date -u +%Y-%m-%dT%H:%M:%SZ) REQ-XXX (AC3 skipped — API-only)" > .e2e-evidence-wired
```

The file is gitignored and never committed — it's a local-only signal that evidence wiring was validated in this working directory.

### Phase 6 — Execute and report

**Pre-flight: browser availability (devaudit-installer#238).** Before running the suite, verify Playwright browsers are installed:

```bash
npx playwright install --dry-run 2>&1 | grep -q "is already installed" || npx playwright install
```

If the install fails (e.g. missing system dependencies on Linux), run `npx playwright install --with-deps` (requires sudo on some systems — ask the operator). Do not defer E2E execution to CI because browsers are not installed. Installing browsers takes ~30 seconds; deferring breaks the evidence trail.

**Do not defer E2E to CI (devaudit-installer#238).** If browsers are not installed, install them. If the dev server will not start, debug it. If the database is not running, start it. CI is a safety net, not a replacement for local E2E execution. The `.e2e-gate-passed` sentinel must be written by a local run — skipping it by deferring to CI breaks the evidence-completeness chain and causes the evidence-completeness gate (#237) to fire with false negatives.

**Gate state vocabulary (devaudit-installer#240).** In `test-execution-summary.md`, E2E gate results must be one of: `PASS`, `FAIL`, `NOT_NEEDED` (with reason), or `SKIPPED` (with operator-approved rationale). The word "deferred" must never appear in `test-execution-summary.md` — not as a gate state, not in prose, not in final assessment. The CI validator (`validate-test-summary.sh`) rejects any file containing "deferred" anywhere. If E2E was not run locally, record it as `SKIPPED` with the reason and flag it as a gate failure for the reviewer. Do not write "E2E deferred to CI" or "Playwright browsers not installed locally" — these are environment issues, not gate states.

Run the suite. Strategy:

1. **Iterate focused.** During fix-and-verify, run only the failing specs (`--grep`, spec-path args, or a CI input that scopes to a subset). Cycle time is what makes the loop tractable — full regression for every iteration burns CI budget and operator patience. Expect to loop: fix → focused run → fix → focused run, many times.
2. **Run full regression once, at the end.** Once the focused set is green, run the full suite to catch unintended side effects in untouched areas.
3. **For CI-driven verification, ensure the workflow accepts a subset input.** A `workflow_dispatch.inputs.specs` (or equivalent) lets a developer fire a scoped run without local infrastructure. Recommend setting this up if the project doesn't have it — the speed-up (~5–10 min vs ~30–60 min) is the difference between a tractable loop and a hated one.
4. **For visual regression**, run the project's normal comparison mode against existing baselines.

Triage every failure into one of these buckets *before* taking any action:

**0. Read the page snapshot first.** Modern Playwright writes `test-results/<spec>-<title>[-retryN]/error-context.md` — a markdown accessibility-tree snapshot of the page at failure time. It's enough to triage selector / role / wait-condition failures without extracting the trace zip. Reach for the trace only when the snapshot is ambiguous (e.g. the failure depends on a transition or a network race the snapshot can't show).

**Filter for all terminal failure statuses.** `failed` and `timedOut` are distinct in Playwright's JSON reporter; `interrupted` is also possible. When summarising failures from `reporter=json` output, use `select(.status == "failed" or .status == "timedOut" or .status == "interrupted")` — `select(.status == "failed")` alone hides hung tests.

Then bucket each failure:

- **Flake** — non-deterministic; passes on rerun. Rerun once. If it passes, note it. If it keeps flaking, flag it but don't file a noisy bug.
- **Test bug** — your test is wrong (bad selector, wrong assertion, timing). Fix the test; don't file anything.
- **Application defect** — the app does the wrong thing. File it.
- **Seed-data gap** — the page works, the test's assertion is correct, but the seeded fixture doesn't satisfy the assertion (empty table, no transactions for the day, missing user role). Fix the seed script (or the test's own setup), not the test logic or the product.
- **Visual diff — intended** — the snapshot changed because the change intentionally changed the UI. Update the baseline and surface it for user approval.
- **Visual diff — unintended** — a snapshot changed somewhere the change shouldn't have affected. File it as a regression.

**Then check for missed requirements.** For each numbered acceptance criterion from Phase 2, confirm at least one *passing* test covers it. **Classify each missed AC (devaudit-installer#212 Gap 4):**

- **AC not tested** (no test was written) — file a defect as today. The implementation may be correct but untested. This is a testing gap, not a requirements gap.
- **AC test fails** (test exists but fails) — file a defect as today. The implementation doesn't match the AC. This is a defect.
- **AC impossible to test** (the test can't be written because the AC is ambiguous, contradictory, or assumes behaviour the system doesn't have) — **do not file a defect**. Return a requirements gap report to `sdlc-implementer`: "AC<N> cannot be tested because <reason>. The AC itself may be wrong." `sdlc-implementer` triggers its [requirements gap flow](../sdlc-implementer/SKILL.md#requirements-gap-flow-devaudit-installer212).
- **Missing AC** (a scenario is necessary for the feature to work but no AC covers it) — **do not file a defect**. Return a requirements gap report: "Scenario <description> is necessary but not covered by any AC. A new AC may be needed." `sdlc-implementer` triggers its [requirements gap flow](../sdlc-implementer/SKILL.md#requirements-gap-flow-devaudit-installer212).

The classification is: "Is the AC correct but untested/buggy? → defect. Is the AC itself wrong/missing? → requirements gap."

**Then triage skipped tests (devaudit-installer#279).** After failure triage and missed-requirements check, inspect all skipped tests from the machine-readable Playwright reporter output (JSON reporter). For each skipped test:

1. **Extract the best available reason** from: `test.skipReason`, annotations, `test.skip(...)` / `testInfo.skip(...)` descriptions, setup-project failures, or helper/guard messages. Do not hard-code to one field — use the richest available source.
2. **Classify each skip into one of:**
   - `environment_gap` — browser not installed, database down, port conflict, missing system dependency
   - `precondition_gap` — seed data missing, auth fixture expired, test account locked
   - `intentional_non_applicability` — API-only change with no UI surface, feature flag disabled for this environment
   - `obsolete_or_quarantined` — test references removed functionality, spec is stale
3. **Fix `environment_gap` and `precondition_gap` first** — these are never acceptable skip reasons. Resolve the underlying issue, rerun the focused tests, then rerun the full suite.
4. **Only remaining `intentional_non_applicability` or unresolved skips** may be surfaced to the operator for approval. Each accepted skip must have an operator-approved rationale.
5. **A skipped test never proves an acceptance criterion.** If a skipped test is the only coverage for an in-scope AC, that AC is unverified until a passing test proves it.
6. **Do not write a `PASSED` E2E sentinel while unresolved or unapproved skips remain.**

Record all accepted skips in the `## Accepted skips` section of `test-execution-summary.md` (see Stage 3 blueprint).

### Phase 7 — Regression-pack handoff

After Phase 6 succeeds — green run, all ACs proved, defects filed for anything missing — the new spec(s) you authored move into the project's regression pack. There is **no separate graduation step**. The pack is defined as:

> **Every `*.spec.ts` (and `*.spec.tsx`) under `tests/e2e/` or `e2e/`.**

There is no `regression/` sub-directory, no `@regression` tag, no manifest file. Being committed and merged to `develop` *is* the graduation step. Once that happens:

1. The next CI run (on this branch's PR, or on `develop` after merge) executes the new spec alongside every existing one.
2. The evidenceShot helper sees `process.env.E2E_NEW_SPECS` (computed by CI as `git diff --diff-filter=A <merge-base>...HEAD`) and tags this branch's captures as `origin: 'feature'`.
3. Post-merge, develop runs see an empty `E2E_NEW_SPECS` and tag every capture as `origin: 'regression'`. The original feature-branch captures stay tagged `feature` as the historical proof of original landing; subsequent develop runs accumulate `regression` captures alongside.

You don't need to do anything explicit for this step — it's a property of the pipeline, not an action. Surface it in the final report so the reviewer knows the new tests are now load-bearing for every future release.

**Write the E2E gate sentinel (devaudit-installer#226).** After a successful full regression run (Phase 6 step 2), write a `.e2e-gate-passed` sentinel file in the repo root so the pre-push hook and `sdlc-implementer` Phase 2 step 5b can verify the E2E gate ran:

```bash
echo "PASSED $(date -u +%Y-%m-%dT%H:%M:%SZ) ${{ github.run_id }}" > .e2e-gate-passed
```

If you determined e2e is not needed for this REQ (schema-only, API-only, no UI surface), write the sentinel with a `NOT_NEEDED` reason instead:

```bash
echo "NOT_NEEDED $(date -u +%Y-%m-%dT%H:%M:%SZ) <reason>" > .e2e-gate-passed
```

The file is gitignored and never committed — it's a local-only signal that the gate was run in this working directory.

### Filing defects

Use whatever tracker integration you found in Phase 1: `gh issue create`, `glab issue create`, a Jira or Linear MCP tool, `az boards work-item create`. If nothing is available, produce a markdown report with each defect formatted ready to paste.

Each filed issue needs:

- **Title** — short, specific, describes the symptom not the cause. *"Filter by status shows zero results when status=pending"*, not *"Filter broken"*.
- **Steps to reproduce** — numbered, minimal, exact.
- **Expected vs actual** — on separate lines, no ambiguity.
- **Environment** — branch, commit SHA, test command, browser/viewport if relevant.
- **Evidence** — link or path to the failing test, error output, screenshot, trace.
- **Link back** to the originating issue/PR.
- **Severity** — your honest call: blocker, major, minor. Don't inflate.
- **`### Framework attribution`** section — the clauses this defect closes when its incident report lands. Always lists `ISO29119.3.5.4` as baseline; additional clauses depending on classification below.

#### Framework classification + the `incident` label

Every defect filed from Phase 6 becomes `incident_report` evidence when (a) the issue is labelled `incident` and (b) the issue is closed. The flow: closed-with-label → `incident-export.yml` exports the body to `compliance/governance/incident-report-<N>.md` with `incident_kind`, `source_release`, `source_issue`, and `semantic_id` frontmatter → `compliance-evidence.yml` uploads it as source-owned `incident_report` evidence → portal flips the attributed clauses MISSING → COVERED for that source release.

Classify the defect against this table when filing — the canonical version lives at `governance-doc-author/references/incident-classification.md`, mirrored here for the e2e workflow:

| Defect characteristic | Frameworks/clauses attributed |
| --- | --- |
| **Any test failure / defect** (baseline — always) | `ISO29119.3.5.4` Test incident report |
| **Ops impact** (downtime, persistent errors, perf regression, data corruption) | + `SOC2.CC7.2` System monitoring and incident response |
| **Security vulnerability** (auth bypass, injection, data exposure) | + `SOC2.CC7.2` + relevant ISO 27001 controls |
| **Personal data exposed / lost / mishandled** | + `GDPR.Art-33` (always — 72h supervisory notification) + `GDPR.Art-34` (when data subjects need notification) |
| **AI/ML failure** (model hallucination, biased output, oversight bypass) | + relevant EU AI Act articles (`Art-9` risk, `Art-14` human oversight, `Art-15` accuracy/robustness) |

**Baseline rule:** the first row is **mandatory**. Even a defect with no specific framework impact STILL produces a valid incident_report attributed to `ISO29119.3.5.4`. Never silently drop the artefact because "it's just a bug".

**Apply the `incident` label at filing time** for defects that warrant incident_report evidence — don't wait for the operator to add it later. Confirm with the operator first (per the **Confirm before destructive or public actions** principle).

If the `incident` label doesn't exist yet on the repo, create it idempotently:

```bash
gh label list --json name --jq '.[].name' | grep -qx incident || \
  gh label create incident --color 'B60205' --description 'Operational, test, or compliance incident; close to auto-archive as portal evidence'
```

Then file with `--label incident,<existing-labels>`.

#### Issue body template

Embed the `### Framework attribution` section near the end of every defect issue body so the auto-export PR (after close) inherits the attribution:

```markdown
### Framework attribution

This defect, once closed with the `incident` label, will be auto-exported as `incident_report` evidence and attribute to:

- [x] `ISO29119.3.5.4` (baseline — every incident_report)
- [ ] `SOC2.CC7.2` — ops impact: <REPLACE — yes/no, with one-line rationale>
- [ ] `GDPR.Art-33` — personal data scope: <REPLACE — yes/no>
- [ ] `GDPR.Art-34` — data-subject notification required: <REPLACE — yes/no>
- [ ] `EUAIA.Art-9 / Art-14 / Art-15` — AI failure: <REPLACE — yes/no, which article(s)>

Once closed, the `incident-export.yml` workflow exports this issue's body to `compliance/governance/incident-report-<N>.md`. Routing depends on the Framework attribution ticks (DevAudit-Installer#200 Fix 1):
- **Path A (baseline-only — only `ISO29119.3.5.4` ticked):** direct-committed to `develop`, no PR. GDPR triage pre-filled as N/A. Next `compliance-evidence.yml` run uploads as `incident_report`.
- **Path B (any of SOC2/GDPR/EUAIA ticked):** auto-files a PR with the GDPR triage + sign-off sections to fill in. Merge that PR → `compliance-evidence.yml` uploads as `incident_report`.
```

The issue body must identify the owning `REQ-XXX` or standalone housekeeping release so the exported report's `source_release` is correct. Do not let a later bundled release claim the incident as newly produced evidence; bundles inherit by explicit lineage.

Pre-tick boxes you're confident about. Leave the operator-judgement ones (GDPR triage, AI-failure classification) for the operator to confirm in the export PR.

#### Worked examples

**Example 1 — Non-PII, non-security defect.** A unit-conversion bug rounds metric prices incorrectly. Found by failing e2e. No data exposure, no service impact beyond cosmetic.

- Apply `incident` label: **yes** (every defect produces an incident_report on close).
- Pre-ticked attribution: `ISO29119.3.5.4` only.
- Operator confirms in the export PR: no SOC 2 / GDPR / EU AI Act ticks added.
- Result: valid incident_report closing the baseline clause. Don't pad with false ticks.

**Example 2 — PII exposure via misconfigured RLS.** Users see other users' applications. Found via e2e regression. ~3,000 users affected over 6 hours.

- Apply `incident` label: **yes**.
- Pre-ticked attribution: `ISO29119.3.5.4` + `SOC2.CC7.2` + `GDPR.Art-33`.
- Leave `GDPR.Art-34` unticked — high-risk threshold needs operator + DPO judgement.
- Severity: blocker.
- The export PR will surface the GDPR triage section for the operator + DPO to fill in (data-subject count, notification method, 72h-window timestamp).

#### Skipping the issue path — direct incident report

When the incident wasn't found by an e2e run (e.g. an ops event surfaced externally, or a retrospective documentation of an event the team handled outside the tracker), file directly using the `governance-doc-author` skill against `compliance/governance/incident-report.md.template`. Same classification table applies; the doc gets committed, `compliance-evidence.yml` auto-uploads it.

Show the user the full set of issues you're about to file. Get confirmation. Then file them.

### Final report

Wrap up with a summary the user can drop into the PR or ticket:

- Tests added — count, with a list.
- Tests updated — count.
- Tests deleted — count, with rationale.
- Tests skipped — count, classification, resolution status, and operator-approved rationale for any accepted skip (devaudit-installer#279).
- Suite result — passing, failing, flaky.
- Defects filed — count, with links.
- Requirements gap reports — count, with details (devaudit-installer#212 Gap 4). These are ACs classified as "impossible to test" or "missing AC" — returned to `sdlc-implementer` for the requirements gap flow, not filed as defects.
- Missed requirements — count, with links.
- **Release provenance** — originating `REQ-XXX`, local run result, expected CI workflow/run, and expected portal stage/execution. For bundled work, state the source REQ explicitly and that the absorbing release will reference it through lineage rather than overwrite its attribution.

**Then feed the test-design record (devaudit#50).** The Stage 3 `test-execution-summary.md` (generated per `3-compile-evidence.md` Step 1a) carries a `## Test design` section at the top. Before Stage 3 finalises the file, populate that section with the design-time decisions this skill made, so the SDLC has a recorded trace that scope was *decided*, not implicit:

- **Layers planned** — which of `unit | integration | e2e | visual | manual` applied to this REQ
- **Layers covered** — same list with ✓ or `NOT_NEEDED` (with reason)
- **Exemptions** — explicit one-line rationale per exempt layer (`e2e NOT_NEEDED — schema-only, no UI yet` rather than silent absence). Do not use "deferred" as a gate state — it is not a valid SDLC state (devaudit-installer#240). The CI validator (`validate-test-summary.sh`) will reject any summary containing "deferred".
- **Skill invocation** — _"`e2e-test-engineer` invoked on turn N during Phase 2"_, with a turn pointer the reviewer can verify against the chat transcript

If you authored or modified `e2e/**/*.spec.ts` directly without invoking this skill, that's a delegation gap — the `sdlc-implementer` Phase 2 audit (devaudit#132) will catch it before Phase 3. The honest record is: the skill ran (or didn't), the layers were chosen for stated reasons, and the test-execution-summary attribution points back at the chat turn where the decision happened.

---

## Evidence vs failure forensics

Playwright's auto-screenshot (`screenshot: 'only-on-failure'`) is for **failure forensics** — "what state was the page in when this test broke?" For a passing test it captures the post-test screen, which is useless as compliance evidence.

To prove an AC was actually verified, call `evidenceShot()` **at the assertion that proves it**, before any further interaction:

```ts
import { evidenceShot } from './helpers/evidence';

test('AC1: edit dialog opens with fields pre-filled', async ({ page }) => {
  await openEditDialog(page, item.id);
  await expect(dialog.locator('#name')).toHaveValue(item.name);
  await evidenceShot(page, 'REQ-037', 1, 'edit-dialog-prefilled');
  // ...rest of test
});
```

**Discipline:**

- Call `evidenceShot` **immediately after** the AC-proving assertion, before navigating, closing dialogs, or any further interaction.
- AC number is a separate argument (`ac: number`) — the helper composes the filename `REQ-XXX-AC<n>-<slug>.png`. The slug describes what the screenshot proves (`edit-dialog-prefilled`), NOT the AC number.
- Slug is kebab-case lowercase (`[a-z0-9-]+`). Capitalised slugs, underscores, or spaces throw.
- One **canonical** screenshot per AC; additional stage screenshots are tier-gated — see *Screenshot density per spec role* below.
- Failure forensics stays untouched (`screenshot: 'only-on-failure'` + `trace: 'on-first-retry'`).

The helper is shipped automatically into `e2e/helpers/evidence.ts` by the SDLC sync (node-stack consumers). Output lands at `compliance/evidence/<REQ-ID>/screenshots/REQ-XXX-AC<n>-<slug>.png` — commit these PNGs as part of the evidence pack so reviewers can corroborate the test-plan AC mapping.

The helper also writes a sidecar `<filename>.meta.json` containing the AC mapping + the screenshot's **origin** — `feature` if the spec was added on the current branch, `regression` if the spec already existed. The consumer's CI passes `origin` through to the DevAudit portal as evidence metadata so the release-detail page can render feature vs regression captures distinctly. Auto-detected from `process.env.E2E_NEW_SPECS` — no manual tagging required.

The canonical helper source lives at `references/evidence.ts` in this skill.

### Screenshot density per spec role

The number of `evidenceShot` calls per spec should scale to the spec's role:

- **While the spec is a feature artefact** (newly authored on the branch, before merge to develop): capture multiple stages - every meaningful transition or state the AC documents. The dense evidence is what reviewers use to verify the AC was met end-to-end during the feature iteration.
- **Once the spec joins the regression pack** (post-merge, `git diff --diff-filter=A` no longer matches it): capture only the canonical "this still works" anchor per AC. Re-running the dense journey on every regression execution is noise and inflates CI artefact storage with little signal.

The `EvidenceShotOrigin` signal (`'feature' | 'regression'`) auto-detects from `E2E_NEW_SPECS`. Mark stage screenshots with `{ tier: 'feature' }`; the helper auto-suppresses them on regression runs. The canonical anchor uses the default tier (`'always'`).

```ts
test('AC7: stock dial completes the transition', async ({ page }) => {
  // Stage screenshots — fire while the spec is a feature artefact;
  // auto-suppress once it graduates into the regression pack.
  await openStockDial(page, item.id);
  await evidenceShot(page, 'REQ-066', 7, 'dial-open',  { tier: 'feature' });
  await advanceDial(page);
  await evidenceShot(page, 'REQ-066', 7, 'in-progress', { tier: 'feature' });

  // Canonical anchor — always fires (default tier: 'always').
  // This is the artefact every future regression run re-captures as
  // proof the AC still holds.
  await expect(dial.getByRole('status')).toHaveText('Completed');
  await evidenceShot(page, 'REQ-066', 7, 'completed');
});
```

A reasonable default per AC:

- 1× canonical "completed / final state" shot (tier `'always'`).
- 1–3× stage shots covering the meaningful intermediate transitions (tier `'feature'`).

When to deviate:

- **Single-shot ACs** (one assertion that's its own proof — e.g. *"the form submits and returns to the list"*) need only the canonical anchor. Don't manufacture stages just to hit the 1–3 band.
- **Long flows** (>3 meaningful transitions) keep all stages tier `'feature'`. The post-merge regression run still has the canonical anchor to corroborate the AC; the dense journey is on the feature PR for reviewers and in the audit-pack download for that release forever.
- **Reviewer pushback that evidence feels thin** (single-shot per AC across a HIGH-risk REQ) almost always means tier `'feature'` stages are missing — add them on the feature branch where they actually fire, not after.

### Specs with no page object — transport-layer evidence (devaudit#127)

`evidenceShot` requires a Playwright `page` object. Specs that exercise behaviour at the transport layer — Node `fetch` against HTTP / webhook endpoints, `socket.io-client` connections, direct `MongoClient` queries, gRPC clients — have no `page` and **cannot call `evidenceShot`**. Examples from the wawagardenbar-app regression pack:

- `e2e/payments/webhook-signature-rejection.spec.ts` — HMAC-SHA512 verification via Node `fetch`
- `e2e/realtime/order-status-broadcast.spec.ts` — `socket.io-client` event assertion
- `e2e/admin/menu-item-delete.spec.ts` — direct `MongoClient` + service-layer call

These specs are still E2E (they exercise the deployed system end-to-end at the transport boundary), they belong in `e2e/`, and they run alongside UI specs. **Their evidence form is the per-spec entry in `test-execution-summary.md`** — the table of spec → pass/fail → asserted behaviour (signature rejected with HTTP 401, idempotent replay suppressed, broadcast received within Nms, soft-delete cascaded) is the load-bearing proof. The screenshot check is **N/A** for them; the release-completeness "behavioural proof" check is satisfied by the test-execution-summary upload alone.

Discipline for transport specs:

- Name the asserted behaviour in the test title using the same `[REQ-XXX][ACn]` bracket convention UI specs use. Reviewers grep on that.
- The `test-execution-summary.md` table row should describe what the spec verified in operator-facing terms ("signature mismatch returns 401; payment row unchanged"), not in TypeScript-spec terms ("`expect(response.status).toBe(401)`").
- If a transport spec *can* be paired with a thin UI shim that screenshots the user-visible outcome (e.g. an admin dashboard surface that shows the rejected payment as "Failed — signature mismatch"), pair them — that buys back the screenshot evidence at the surface level. Otherwise: transport spec stands alone.
- The portal's release-detail "screenshots" panel will show zero entries for purely-transport REQs; that's correct. Reviewers cross-reference `test-execution-summary.md` instead.

This is **observation**, not gate-relaxation — these specs satisfy the SDLC evidence requirement; the screenshot mechanism doesn't apply.

A `evidenceTrace(reqId, ac, slug, payload)` helper that writes a JSON sidecar (request/response/ledger shape) was considered as a Phase B; deferred until the portal grows a non-PNG evidence type. Today the test-execution-summary already carries the equivalent information at the table level.

---

## Principles

**Match the project's existing depth.** If it tests one happy path per feature, don't add six scenarios per AC. If it tests exhaustively, match that. Right coverage is coverage consistent with what's already there.

**E2E is expensive.** Every test you add costs CI time and maintenance forever. Add what's needed for confidence in the change; resist adding more. The goal is a suite that stays trusted, not a suite that's maximal.

**Don't invent infrastructure.** If the project uses POMs, use POMs. If it uses fixtures, use fixtures. If something is genuinely missing that you need, ask the user before adding it.

**Confirm before destructive or public actions.** Deleting tests, approving new visual baselines, filing defects in a tracker — all need explicit user sign-off. The cost of confirming is a sentence; the cost of getting it wrong is real.

**Ambiguity is a question, not a guess.** If an AC is unclear or the implementation does something the issue doesn't describe, ask. Tests built on guesses about intent are worse than no tests — they encode and propagate the misunderstanding.
