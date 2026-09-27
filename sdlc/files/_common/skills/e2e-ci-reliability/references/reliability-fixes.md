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

1. **Use Playwright's native `--shard=i/N`**, restarting the dev server between shards (kill the PID, relaunch, `wait-on` the port) rather than a GitHub Actions job matrix. A matrix fragments evidence upload and auto-issue-filing steps in ways that need more careful redesign than sharding-within-a-job warrants by default.

2. **Merge shard JSON reports** for any downstream `jq`-based consumer:

   ```bash
   jq -s '.' e2e-regression-results-shard-*.json > e2e-regression-results.json
   ```

   Array-wrapping is fine for a recursive-descent (`..`) consumer — there's no need to preserve the exact single-report shape.

3. **Shard-numbered output directories** — `playwright-report-shard-N/` and `test-results-shard-N/` — to avoid overwrite-in-place between shards. Update artifact-upload globs in the CI workflow accordingly so both shapes are still captured (see `e2e-test-engineer/SKILL.md`'s "Upload both artefact shapes" guidance — that requirement doesn't change just because the run is sharded).

4. **A starting point to tune, not a hard rule:** `SHARD_COUNT=4`, roughly a 12-minute per-shard timeout, tuned against the job's existing overall timeout ceiling. Adjust per project based on actual shard wall-clock once measured.

5. **Skip sharding for scoped/small `workflow_dispatch` runs** — a `specs` input that scopes to a handful of tests doesn't need shard machinery.

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
