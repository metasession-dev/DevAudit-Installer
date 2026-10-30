# Seed and reset conventions

Read this before writing or changing a project's seed or reset script. These are conventions that keep a regression repeatable; the project's own stack decides the code.

## Seed

- **Idempotent upserts.** Running the seed twice leaves the same data. Use upserts keyed on a stable natural key, never blind inserts.
- **A stable baseline plus unique per-test data.** The baseline (accounts, reference data, the records every test reads) is the same for every test and is created only by the seed. Anything a test creates is unique to that test (a random or run-scoped suffix), so tests do not collide when they run in parallel.
- **No hard-coded seeded names in specs.** Specs read seeded values from one place (a fixtures module generated from, or checked against, the seed), not from string literals scattered through the suite. The `fixture-not-seeded` doctor heuristic looks for names that appear in specs but not in the seed files.
- **Test accounts.** One account per role the specs exercise, created by the seed, with credentials read from the environment (`e2e_env` or CI secrets), never written in a script or in the repository.
- **Nothing from production.** No export, copy or anonymised snapshot of production is the seed unless the project has approved that route and says so in its plan; DevAudit never asks for one.
- **Declared files.** Every file the seed reads or writes is under a path listed in `e2e_seed_paths` (git-tracked), so the seed hash changes when the seed does.

## Reset

- **A reset that works after a killed run.** The reset puts the environment back to the baseline from any state, not only from the state a clean run leaves. It must be safe to run twice and safe to run when nothing was seeded.
- **Cleanup in `afterAll` for what a test creates**, plus the reset for what a killed run leaves behind. Do not rely on test order.
- **Scope.** The reset touches only the data the tests own (by prefix, tenant or schema), never the whole database of a shared environment.

## Preflight and leak check

- **Preflight** (`e2e_preflight_command`) exits non-zero when a fixture the tests need is absent (for example the test account or the reference rows). A failed preflight fails the run before any test starts, so a missing fixture never becomes a quiet skip.
- **Leak check** (`e2e_leak_check_command`) prints the number of rows left behind on its last line (an integer). Its exit code is ignored and it never changes the run's outcome; the number is recorded in the run record.

## Skips

A test that skips for lack of data hides a gap. Give every skip a reason (`test.skip(cond, 'needs seeded admin')`), and set `e2e_max_skipped` once the number is stable so a growing number of skips fails the run.
