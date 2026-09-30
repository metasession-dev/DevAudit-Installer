# Reliability fixes: sharding, warm-up, and capacity

Read this when Phase 4 of `SKILL.md` is in play — after `diagnostic-playbook.md` has identified which mechanism is actually at fault.

## Sharding

### Applies when

- Single-worker execution is required (resource-constrained runner), **and**
- Suite size/duration is past the project's own empirical threshold (see `diagnostic-playbook.md`'s heuristic), **and**
- Diagnostics point at accumulation: isolated reruns of the failing specs pass clean, and there's no positional or host-ceiling correlation.

### Does not apply blindly to every tier

A tier showing the "different test fails each run" symptom is not automatically an accumulation case — always run the diagnostic playbook per tier. A smaller, faster tier is more likely to be a cold-compile case (warm-up fixes it, sharding doesn't).

### Cost/benefit to weigh explicitly before implementing

- Shard-restart overhead (killing and relaunching the dev server per shard) vs. the benefit of resetting accumulated process/connection state.
- Whether a DB reset per shard is also warranted — deeper isolation, meaningfully more overhead — vs. just restarting the app server (lighter, and likely sufficient if the process-degradation hypothesis is correct rather than a DB-side one).
- Skip sharding for scoped/small `workflow_dispatch` runs — those are already small enough not to hit this failure class.

### Implementation mechanics (Playwright)

**All of this lives in `e2e/ci-reliability/regression-run.sh`, never in the CI workflow itself.** `e2e-regression.yml` is a generated file — the "E2E Regression Tests" step runs this script if present (devaudit-installer#928); the CI template's artifact-upload globs are already widened to `e2e-regression-results*.json`/`playwright-report*/`/`test-results*/`/`e2e-server*.log` upstream, so a shard-numbered shape needs no CI-workflow edit at all.

1. **Use Playwright's native `--shard=i/N`**, restarting the dev server between shards (kill the PID, relaunch, `wait-on` the port) rather than a GitHub Actions job matrix. A matrix fragments evidence upload and auto-issue-filing steps in ways that need more careful redesign than sharding-within-a-job warrants by default.

2. **Merge shard JSON reports** into the unsuffixed name before exiting, so `compliance-evidence.yml`'s incident-triage step (which reads exactly `e2e-regression-results.json`, not a glob) still finds it:

   ```bash
   jq -s '.' e2e-regression-results-shard-*.json > e2e-regression-results.json
   ```

   Array-wrapping is fine for a recursive-descent (`..`) consumer — there's no need to preserve the exact single-report shape.

3. **Shard-numbered output directories** — `playwright-report-shard-N/` and `test-results-shard-N/` — to avoid overwrite-in-place between shards. No CI-workflow change needed: the upload step's globs (`playwright-report*/`, `test-results*/`) already cover this shape.

4. **A starting point to tune, not a hard rule:** `SHARD_COUNT=4`, roughly a 12-minute per-shard timeout, tuned against the job's existing overall timeout ceiling (`e2e_regression_timeout_minutes` in `sdlc-config.json`, default 55 — raise it if several shards' restart overhead pushes the total past the default). Adjust per project based on actual shard wall-clock once measured.

5. **Skip sharding for scoped/small `workflow_dispatch` runs** — a `specs` input that scopes to a handful of tests doesn't need shard machinery. The hook contract passes `SPECS` in the script's env for exactly this check.

### Worked example: `e2e/ci-reliability/regression-run.sh`

Generalized from a real consumer's sharding setup. Follows the hook contract (inputs `PROJECT`/`SPECS`/`E2E_PORT` plus the job-level merged env; required outputs `e2e-regression-results.json` + `playwright-report*/` + `test-results*/`; exit 0/124/other maps to pass/timeout/fail):

```bash
#!/usr/bin/env bash
set -uo pipefail

SHARD_COUNT=4
SHARD_MINUTES=12

# Only shard the full, unscoped regression run — a scoped workflow_dispatch
# (SPECS set) or a smaller tier (e.g. PROJECT=critical) doesn't need it.
if [ "$PROJECT" != "regression" ] || [ -n "${SPECS:-}" ]; then
  # shellcheck disable=SC2086
  timeout --signal=TERM --kill-after=60s "$((SHARD_MINUTES * SHARD_COUNT))m" \
    npx playwright test --project="$PROJECT" --reporter=json,html $SPECS
  exit $?
fi

OVERALL_STATUS=0
for i in $(seq 1 "$SHARD_COUNT"); do
  # Restart the dev server between shards to reset accumulated
  # process/connection state — the mechanism this fix targets.
  if [ -f .e2e-server.pid ] && kill -0 "$(cat .e2e-server.pid)" 2>/dev/null; then
    kill "$(cat .e2e-server.pid)"
    wait "$(cat .e2e-server.pid)" 2>/dev/null || true
  fi
  npm run dev > "e2e-server-shard-${i}.log" 2>&1 &
  echo "$!" > .e2e-server.pid
  npx wait-on "http://localhost:${E2E_PORT}" --timeout 60000

  PLAYWRIGHT_JSON_OUTPUT_NAME="e2e-regression-results-shard-${i}.json" \
    timeout --signal=TERM --kill-after=60s "${SHARD_MINUTES}m" \
    npx playwright test --project=regression --shard="${i}/${SHARD_COUNT}" \
      --reporter=json,html \
      --output="test-results-shard-${i}" || OVERALL_STATUS=$?
  mv playwright-report "playwright-report-shard-${i}" 2>/dev/null || true
done

jq -s '.' e2e-regression-results-shard-*.json > e2e-regression-results.json
exit "$OVERALL_STATUS"
```

`OVERALL_STATUS` deliberately keeps the *last* non-zero shard's exit code rather than the first, so a later shard's timeout (124) isn't masked by an earlier shard's plain test failure (1) — either way the run is not clean, and the template maps any non-zero, non-124 code to `failed` the same way.

## Warm-up

**Standard practice, not a one-off fix.** Proactively suggest route/endpoint warm-up during suite bootstrap or suite-growth review for any dev-mode-server E2E setup — don't wait for someone to hit the cold-compile symptom first. A short warm-up step (hit the rarely-exercised routes once, before the suite runs) has already proven effective against the cold-compile failure class described in `diagnostic-playbook.md`.

**The production-build tradeoff — document it so it's never recommended naively.** Serving a production build instead of dev-mode eliminates cold-compile latency, but it silently turns on framework-level production-only behavior — for example, Next.js's production-only `Link` prefetching — which can break `waitForLoadState('networkidle')`-based waits suite-wide. This is a known bad trade discovered and reverted in a real consumer's history, not a theoretical concern. Never suggest switching to a production build as the fix for cold-compile latency; suggest warm-up instead.

## Other contributing factors to check during a reliability review

These aren't tied to any specific symptom — check them whenever doing a general reliability review, not only after a failure is reported:

- **DB connection pool sizing.** A single long-lived pool shared across hundreds of sequential tests is a common accumulation vector; check sizing and monitor for exhaustion, not just app-server memory.
- **In-memory application cache invalidation** under sustained write load — a cache that's correct under normal traffic can accumulate staleness across a long single-process regression run in ways unit tests never exercise.
- **Test-tier rebalancing.** If a regression tier has grown large enough to need sharding, that's also a signal to reconsider whether every test in it needs to run on every full-regression trigger, or whether genuinely release-blocking tests belong in the already-fast, already-warmed critical tier instead (see `e2e-test-engineer/SKILL.md`'s tier classification in Phase 3).

## Skip sharding, but not the diagnosis

If Phase 3 concludes the mechanism is a host resource ceiling (Step 4 of `diagnostic-playbook.md`), neither sharding nor warm-up is the fix — report it as a runner-capacity problem for the operator to size correctly. Applying a suite-level fix to a capacity problem hides the real cause without resolving it.
