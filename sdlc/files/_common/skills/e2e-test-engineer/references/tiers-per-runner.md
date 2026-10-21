# Test tiers on every runner

The tier vocabulary is the same whatever runs the tests, so every project gets one set of portal check labels and one set of triage rules (fix, accept with a recorded exception, or defer the release).

| Axis | Name | Meaning |
| --- | --- | --- |
| Tier | `smoke` | Minutes. The app or service starts and the core path works. Runs on every push to the integration branch. |
| Tier | `critical` | Smoke plus the must-not-break journeys or endpoints. Aimed at 10-15 minutes. Optional: a project that defines none gates its release PR on smoke. |
| Tier | `full` | Everything in the integration / E2E suite. |
| Scope | `feature` | Only the tests tagged with the branch's requirement (`REQ-XXX`). |

Tiers are about **speed and risk**; scope is about **what changed**. They are separate axes.

**Unit tests are not tiered.** They are fast by definition: run the whole unit suite on every PR and locally. Tier the slower suites: end-to-end, API, integration and contract tests.

The project says what each tier runs in `sdlc-config.json` (`devaudit configure set <key> "<command>"`); an unset key keeps the runner default. The commands run from the project's working directory through `scripts/run-test-tier.sh`.

| Key | Meaning |
| --- | --- |
| `test_runner` | `playwright` (default) or `pytest`: where the unset defaults come from |
| `test_tier_smoke`, `test_tier_critical`, `test_tier_full` | one-line command per tier |
| `test_feature_command` | feature scope; `{REQ}` is replaced with the requirement id |

## Playwright (browser and `request` API tests)

Default. The tiers are Playwright projects; UI specs and `request`-based API specs share the same directories.

```ts
// playwright.config.ts
projects: [
  { name: 'smoke', testMatch: 'e2e/smoke/**/*.spec.ts' },
  { name: 'critical', testMatch: ['e2e/smoke/**/*.spec.ts', 'e2e/critical/**/*.spec.ts'] },
  { name: 'regression', testMatch: 'e2e/**/*.spec.ts' }, // the full tier
],
```

- Defaults: `npx playwright test --project=<e2e_project>` (smoke), `--project=critical` (smoke when no such project), `--project=regression`, and `--grep REQ-XXX` for the feature scope.
- Tag: `[REQ-XXX][ACn]` in the test title and `@requirement REQ-XXX` in the file header (see `test-tags.ts`).
- Evidence: the JSON report is the `e2e_result`; UI specs add `evidenceShot` screenshots, API specs have none (see "Specs with no page object" in `SKILL.md`).

## pytest (API, integration, contract and service tests)

Set `test_runner` to `pytest`. `devaudit update` then generates pytest `feature-e2e.yml` and `e2e-regression.yml` workflows (JUnit XML is the `e2e_result`).

```toml
# pyproject.toml: register the markers, or pytest warns (and --strict-markers fails)
[tool.pytest.ini_options]
markers = [
  "smoke: the service starts and the core path works",
  "critical: must-not-break endpoints (run together with smoke)",
]
```

```python
import pytest

@pytest.mark.smoke
def test_health_endpoint_answers_ok(client):
    """[REQ-042][AC1] GET /health returns 200 and the version"""
    assert client.get("/health").status_code == 200

@pytest.mark.critical
def test_refund_is_idempotent(client):
    # [REQ-051][AC2] a repeated refund request does not refund twice
    ...
```

- Defaults: `pytest -m smoke`, `pytest -m "smoke or critical"`, `pytest`; each writes JUnit XML to `$TEST_JUNIT_XML`.
- Feature scope: the script runs the test **files under `tests/` that mention the requirement id** anywhere (title, docstring, comment or marker). It does not use `pytest -k`, which only sees test, class and marker names and can never match `REQ-042`. Mention the id once per file, with a word boundary (`REQ-11` does not match `REQ-111`).
- A custom command must write JUnit XML to `$TEST_JUNIT_XML`, or the evidence upload fails.
- Start the service the tests need in `e2e_setup_command` or a fixture; the pytest workflows start no dev server.

## Jest

No default: name the tiers with `test_tier_*`. Pick one selection convention and keep it.

```bash
devaudit configure set test_tier_smoke    "npx jest --testPathPattern smoke"
devaudit configure set test_tier_critical "npx jest --testPathPattern 'smoke|critical'"
devaudit configure set test_tier_full     "npx jest"
devaudit configure set test_feature_command 'npx jest -t "{REQ}]"'
```

- Put smoke and critical tests under `smoke/` and `critical/` directories, or give the files a `.smoke.test.ts` suffix, so the path pattern selects them. Jest `projects` work too: `npx jest --selectProjects smoke`.
- Tag with the bracket convention in the test title: `it('[REQ-042][AC1] rejects an expired token', ...)`. The feature command ends the id with `]`, so `REQ-11` does not select `[REQ-111]`.

## Vitest

No default either.

```bash
devaudit configure set test_tier_smoke    "npx vitest run smoke"
devaudit configure set test_tier_critical "npx vitest run smoke critical"
devaudit configure set test_tier_full     "npx vitest run"
devaudit configure set test_feature_command 'npx vitest run -t "{REQ}]"'
```

- `vitest run <filter>` selects files whose path contains the filter, so the same `smoke/` and `critical/` directory convention applies. A Vitest `workspace` / `projects` setup can use `--project smoke` instead.
- Tag in the test title as for Jest.

## Checking the tiers

`devaudit doctor` reads the setup without running a test and reports a declared tier that resolves to zero tests, an empty smoke tier, test files with no requirement tag, requirements with no test, and a `critical` tier identical to smoke (the valid two-tier setup: `devaudit configure set release_gate_tier smoke`). It proposes, you decide: a change goes through `devaudit configure` or this skill, and lands as a normal PR with a requirement.

Which tier gates the release PR is a separate project choice (`release_gate_tier`, see `docs/e2e-test-tiers.md`); this skill writes tests, it does not change the gate.
