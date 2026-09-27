# Diagnostic playbook: a different test fails each run

Read this when Phase 3 of `SKILL.md` is in play — deciding *why* a full-regression run is intermittently failing before picking a fix.

## The architecture pattern that produces this failure class

Not a bug in any one project — a property of an architecture pattern the framework's own 3-tier regression template (`e2e-test-engineer/references/e2e-regression-3-tier.yml`) actively encourages once a regression tier grows large:

- A framework dev-mode server (`next dev` or equivalent) kept alive across the whole suite, not a production build — JIT/on-demand compilation, HMR overhead, unbounded dev-only caches.
- A single long-lived DB connection/pool shared across hundreds of sequential tests.
- Forced single-worker execution — common on resource-constrained self-hosted runners. `bootstrap.md`'s `workers: process.env.CI ? 2 : undefined` default doesn't by itself flag "your CI is a resource-constrained self-hosted runner, so you're effectively single-worker anyway" as a risk factor — treat that combination as a signal to watch for this failure class before it appears.
- In-memory application-level caches with imperfect invalidation under sustained write load.
- Suite size/duration past some threshold — an empirical heuristic worth applying loosely: past roughly 150–200 tests, or roughly 15–20 minutes of continuous single-process execution, start watching for this. Not a hard rule; calibrate to the project's own baseline.

Any consumer that adopted the shared 3-tier template and has grown its regression tier is a plausible candidate, whether or not it has hit the symptom yet.

## Step 1 — Signature

Different, unrelated tests fail on different runs — not the same test every time. If it's the same test every time, this playbook doesn't apply; that's a deterministic defect or test bug, triaged normally.

## Step 2 — Isolation test, first

Re-run the failing spec(s) scoped/isolated. If they pass clean, this is not an application defect — stop investigating the spec's code and start investigating the environment. Skipping this step is the single most expensive mistake in this failure class: it looks exactly like N unrelated application bugs until this one check rules that out.

## Step 3 — Positional vs. temporal vs. accumulation

| Pattern | What it looks like | Suspect |
| --- | --- | --- |
| **Positional** | Failures cluster at a consistent *position* in the test list, regardless of elapsed time. | A specific test or fixture — not this failure class. |
| **Temporal / host-ceiling** | Failures correlate with elapsed time or resource metrics, regardless of position. | A host ceiling (CPU/memory exhaustion) — see Step 4. |
| **Accumulation** | Neither position nor elapsed time correlates cleanly, but failures scale with total tests executed. | Process/connection degradation — the core pattern this skill targets. |

## Step 4 — Host-side check before app-level assumptions

Cheap and worth doing before assuming an application-level cause:

```bash
# CPU throttling
cat /sys/fs/cgroup/cpu.stat | grep nr_throttled
cat /sys/fs/cgroup/cpu.stat | grep throttled_usec

# Memory pressure
cat /sys/fs/cgroup/memory.events | grep high
```

A nonzero and climbing `nr_throttled`/`throttled_usec`, or a growing `high` count, points at a host-capacity problem — report it as one; sharding or warm-up will not fix a runner that's genuinely out of CPU or memory.

## Step 5 — Distinguish from cold-compile

A dev-mode server JIT-compiling a rarely-hit API route or page on first hit produces the same surface symptom — "a different test seems to fail each run" — but a different mechanism:

| | Accumulation | Cold-compile |
| --- | --- | --- |
| **Run length** | Longer runs (whole regression tier), degradation grows with total tests executed | Shorter runs too — can appear on the *smaller* critical tier |
| **Mechanism** | Accumulated process/connection state (memory growth, connection-pool exhaustion, cache staleness) | JIT compilation latency on routes the suite rarely exercises |
| **Fix** | Sharding (restart the process, reset accumulated state) | Route/endpoint warm-up before the suite runs |

Both can be present in the same project at different tiers — one confirmed case had the larger regression tier hit accumulation while the smaller, faster critical tier hit cold-compile instead. Sharding would not have fixed the critical tier's problem; warm-up would not have fixed the regression tier's. Diagnose each tier that shows the symptom independently rather than assuming one root cause explains every occurrence.

## Worked example (generalized from a real consumer investigation)

A ~576-test single-worker regression run (one long-lived dev server + DB connection, ~38 minutes) accumulated 3 flaky specs, then grew to 5+ specs at an estimated 33–50% intermittent failure rate over about a week. Each was initially investigated and filed as an independent application bug — direct DB round-trip checks, instrumented logging — before the pattern was recognized as one environmental cause spanning several, independently-filed "defects." Isolated reruns of every one of those specs passed clean. Applying Step 2 at the first report would have shortcut the majority of that investigation time.

The same project's *smaller* critical tier (~14 minutes) showed a superficially similar symptom — a different rarely-hit test failing each run — but the cause was cold-compile latency on an infrequently-hit API route, fixed by warm-up, not sharding. Distinguishing the two (Step 5) mattered: applying sharding to the critical tier would have added restart overhead without fixing anything.
