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

For **visual regression** specifically:
- New tests need baseline images. Generate them, but **do not auto-approve** — surface them for the user to verify before they're committed.
- Use the project's existing breakpoints, viewports, and element-masking conventions.

Do additions, updates, and (approved) deletions in the same change so the suite stays internally consistent.

### Phase 6 — Execute and report

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

**Then check for missed requirements.** For each numbered acceptance criterion from Phase 2, confirm at least one *passing* test covers it. An AC with no passing test — because no test was written, or because the test fails — is a missed requirement. File it.

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

Show the user the full set of issues you're about to file. Get confirmation. Then file them.

### Final report

Wrap up with a summary the user can drop into the PR or ticket:

- Tests added — count, with a list.
- Tests updated — count.
- Tests deleted — count, with rationale.
- Suite result — passing, failing, flaky.
- Defects filed — count, with links.
- Missed requirements — count, with links.

---

## Evidence vs failure forensics

Playwright's auto-screenshot (`screenshot: 'only-on-failure'`) is for **failure forensics** — "what state was the page in when this test broke?" For a passing test it captures the post-test screen, which is useless as compliance evidence.

To prove an AC was actually verified, call `evidenceShot()` **at the assertion that proves it**, before any further interaction:

```ts
import { evidenceShot } from './helpers/evidence';

test('AC1: edit dialog opens with fields pre-filled', async ({ page }) => {
  await openEditDialog(page, item.id);
  await expect(dialog.locator('#name')).toHaveValue(item.name);
  await evidenceShot(page, 'REQ-037', 'AC1-edit-dialog-prefilled');
  // ...rest of test
});
```

**Discipline:**

- Call `evidenceShot` **immediately after** the AC-proving assertion, before navigating, closing dialogs, or any further interaction.
- Slug as `AC<n>-<what-this-proves>` — the filename documents the claim.
- One screenshot per AC, not per test.
- Failure forensics stays untouched (`screenshot: 'only-on-failure'` + `trace: 'on-first-retry'`).

The helper is shipped automatically into `e2e/helpers/evidence.ts` by the SDLC sync (node-stack consumers). Output lands at `compliance/evidence/<REQ-ID>/screenshots/<slug>.png` — commit these PNGs as part of the evidence pack so reviewers can corroborate the test-plan AC mapping.

The canonical helper source lives at `references/evidence.ts` in this skill.

---

## Principles

**Match the project's existing depth.** If it tests one happy path per feature, don't add six scenarios per AC. If it tests exhaustively, match that. Right coverage is coverage consistent with what's already there.

**E2E is expensive.** Every test you add costs CI time and maintenance forever. Add what's needed for confidence in the change; resist adding more. The goal is a suite that stays trusted, not a suite that's maximal.

**Don't invent infrastructure.** If the project uses POMs, use POMs. If it uses fixtures, use fixtures. If something is genuinely missing that you need, ask the user before adding it.

**Confirm before destructive or public actions.** Deleting tests, approving new visual baselines, filing defects in a tracker — all need explicit user sign-off. The cost of confirming is a sentence; the cost of getting it wrong is real.

**Ambiguity is a question, not a guess.** If an AC is unclear or the implementation does something the issue doesn't describe, ask. Tests built on guesses about intent are worse than no tests — they encode and propagate the misunderstanding.
