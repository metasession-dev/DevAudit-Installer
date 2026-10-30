# The three drift checks

Test data drifts for three different reasons. Run all three, report each as **in sync**, **drifted** or **not measured**, and propose the smallest fix. A guess is never an answer.

## 1. Seed against the schema

Does the seed still produce valid rows after the latest schema change?

- Run the project's migrations on a scratch database (never a shared one), run the seed against it, and read the first error. A new required column, a renamed table or a changed constraint is the usual cause.
- DevAudit does not read migrations (that is a stated non-goal of the `test-data` check); this check is done by running the project's own commands.

## 2. Seed against the specs

Does every fixture a spec names exist in the seed?

- Search the specs for the names they read (`seed.adminUser`, `seeded('demo-org')`, test account emails) and look each up in the files under `e2e_seed_paths`.
- `devaudit doctor` reports a text heuristic as `fixture-not-seeded`. It can be wrong in both directions; treat it as a pointer and confirm by reading the spec.
- A requirement that adds or changes a test also adds or changes the data it needs, in the same pull request.

## 3. Live data against the baseline

Does the shared or long-lived environment still match what the seed would create?

- Compare the environment with the baseline the seed defines: count and sample the rows the tests read; run the preflight command, which exists to fail when a fixture is absent.
- `devaudit doctor` reports `seed-changed-since-last-run` when the files under `e2e_seed_paths` hashed differently on the last successful regression than they do now (the hash is in the run record of the `e2e-regression-report` artifact). It needs `gh` and a previous run, and says "not measured yet" otherwise.
- After a seed change, run the regression once against the new seed (workflow dispatch) and read the preflight, the skip count and the leak count in the run record.
