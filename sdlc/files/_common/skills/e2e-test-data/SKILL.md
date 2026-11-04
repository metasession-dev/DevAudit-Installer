---
name: e2e-test-data
description: Author and maintain the test data that end-to-end tests run on — the data needs a requirement declares, the seed and reset scripts, test accounts, per-test cleanup, the leak audit, and the three drift checks (seed against schema, seed against specs, live data against the baseline). Use when the operator says "set up the test data", "write a seed script", "our seed is out of date", "tests fail because a fixture is missing", "tests leave data behind", "reset the test database", "add a test account", "seed-data gap", "precondition_gap", "teardown", or when `devaudit doctor` reports a `test-data` finding. Do NOT use for writing specs or choosing which tests gate a release (that is `e2e-test-engineer`), for changing the release gate (that is `devaudit-configure`), or for handling secret values.
version: 1.0.0
tags:
  - testing
  - test-data
  - e2e
---

# E2E Test Data

Owns the data side of end-to-end testing for one project: what data the tests need, the scripts that put it in place and take it away, and the checks that it still matches the schema and the specs (DevAudit-Installer#1116). It exists as its own skill so `e2e-test-engineer` (already long) keeps its focus on writing and triaging specs.

## Who owns what

DevAudit owns the **contract** (what the project declares in `sdlc-config.json`), the **checks** (`devaudit doctor`'s `test-data`) and the **run record** (the `data` object in `e2e-regression-metadata.json`). The **project** owns the implementation: schema, seed and reset scripts, fixtures, factories, per-test cleanup, test accounts. This skill helps write that project code; DevAudit never generates or runs it except through the commands the project declares.

The keys (set with `devaudit configure set`, never by editing the file): `e2e_data_isolation` (`none`, `ephemeral`, `shared_serialised`, `shared`, `unknown`), `e2e_seed_command`, `e2e_seed_paths`, `e2e_reset_command`, `e2e_preflight_command` (exits non-zero when the seed fixtures are absent), `e2e_leak_check_command` (last line of output is the number of rows left behind), `e2e_max_skipped`, `feature_e2e_projects`.

## Scope

In scope: data needs, seed and reset authoring, test accounts, teardown, the leak audit, drift checks, `seed-data gap` and `precondition_gap` triage from `e2e-test-engineer`.
Out of scope: writing or selecting specs; release gates and tiers; production data of any kind; secrets (the operator types them into `devaudit configure secret`); committing without confirmation.

## The workflow

### Phase 1 — Orient

Read `sdlc-config.json` (the keys above and `e2e_data_isolation`), the requirement's plan section "Test Data Requirements" (Blueprint 1), the existing seed and reset scripts, and `devaudit doctor --json` (`test-data`, `test-tiers`). State in two lines where the tests get their data today and what is undeclared. If `e2e_data_isolation` is unset, ask the operator the Q18 question in plain words (do they need no data, a fresh database per run, a shared environment only their tests use, or one other people use?) and have them answer with `devaudit configure`.

### Phase 2 — Declare the data needs

For the requirement in scope, list the data each acceptance criterion needs: records, accounts and roles, files, feature flags. Mark each as **baseline** (the same for every test) or **per-test** (unique to the test). Write it in the plan's "Test Data Requirements". Ask: does this change alter what data the tests need? If yes, the seed changes in the same pull request.

### Phase 3 — Write or update the seed and reset

Read `references/seed-conventions.md`, then write the project's seed and reset scripts. Never hard-code names the seed creates into more than one place; never seed from production; never put a credential in a script. Show the diff and the commands to run; do not commit without the operator's confirmation. Then have the operator declare them: `devaudit configure set e2e_seed_command "<cmd>"`, `e2e_seed_paths`, `e2e_reset_command`, and an `e2e_preflight_command` that fails when a fixture the tests need is absent.

### Phase 4 — Check for drift

Read `references/drift-checks.md` and run the three checks: **seed against the schema** (the seed still inserts valid rows), **seed against the specs** (every fixture a spec names exists in the seed), **live data against the baseline** (the environment still matches what the seed would create; `seed-changed-since-last-run` from doctor tells you the seed moved since the last regression). Report each as in sync, drifted, or not measured; propose the smallest fix.

### Phase 5 — Leak audit and teardown

Check per-test cleanup (`afterAll`), the reset for killed runs, and the leak check command. A non-zero leak count is a finding to fix in the test or the reset, not a number to hide. If the project has no leak check, propose one and declare it with `devaudit configure set e2e_leak_check_command`.

### Phase 6 — Hand back

Summarise what changed, what is declared, and what the first run will prove (a failed preflight fails the run, it is never turned into a skip). Tell the operator to run `devaudit doctor` and, for a new tier, `devaudit configure`.

## Principles

- **Ask before inventing.** If the schema or the intended data is unclear, ask; tests built on guesses about data are worse than none.
- **Idempotent and unique.** The seed can run twice; per-test data is unique; the reset can run after a killed run.
- **Never touch production data or a backend the project did not declare.** The project's own commands own that boundary.
- **Report drift honestly.** "Not measured" is an answer; a guess is not.
- **Skills never edit `sdlc-config.json` directly** and never handle secret values.
