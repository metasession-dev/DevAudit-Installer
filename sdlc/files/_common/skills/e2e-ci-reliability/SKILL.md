---
name: e2e-ci-reliability
description: Diagnose and fix long-run E2E suite reliability problems — accumulated process/connection degradation, dev-server cold-compile latency, and host resource ceilings — as distinct from application defects, then apply sharding, warm-up, or capacity fixes. Use when a full-regression run fails a different, seemingly-unrelated spec each time; when isolated reruns of "failing" specs pass clean; when a regression tier has grown large enough that sharding is worth considering; or for a general CI-health/reliability review independent of test-content authoring. Trigger phrases: "why is our regression tier flaky", "should we shard this suite", "different test fails every run", "e2e suite is flaky", "warm up the dev server", "CI reliability review". Do NOT use for authoring or updating test scenarios/content (that's e2e-test-engineer) or for a single test that fails the same way every time (that's an application defect, triaged normally).
---

# E2E CI Reliability

Diagnose why a long-running E2E suite fails intermittently, tell that apart from an application defect, and apply the right fix — sharding, warm-up, or capacity — rather than the first plausible-looking one. This is execution-architecture work: it never touches what a test asserts, only how reliably the suite that runs it behaves under sustained load.

## Scope

**In scope**
- Triaging a "different, unrelated test fails each run" signature into its actual root cause (accumulated process/connection degradation, dev-server cold-compile latency, or a host resource ceiling).
- Deciding whether sharding is warranted for a given regression tier, and implementing it (Playwright `--shard`, dev-server restart between shards, shard-report merging, artifact-path updates).
- Recommending and implementing dev-server / endpoint warm-up as a standing practice for any dev-mode-server E2E setup.
- Auditing DB connection pool sizing and in-memory application-cache invalidation as contributing factors to suite-duration degradation.
- Advising `sdlc-implementer` on general CI reliability health, independent of any specific test-content change.

**Out of scope**
- Writing, updating, or retiring test scenarios or assertions — that's `e2e-test-engineer`.
- A test that fails the same way on every run — that's a deterministic defect or a test bug; triage it with `e2e-test-engineer`'s Phase 6 buckets, not this skill.
- Application-level bugs the suite happens to catch. This skill only owns *whether the suite itself is a reliable instrument*.
- Restructuring GitHub Actions into a job matrix. Sharding here means Playwright's own `--shard` flag inside a single job, restarting the dev server between shards — a matrix fragments evidence upload and auto-issue-filing in ways this skill doesn't attempt to redesign.

## The workflow

### Phase 1 — Confirm the signature

Before touching anything, confirm this is actually the failure class this skill exists for. The signature: **across repeated full-regression runs, a different, seemingly-unrelated spec fails each time** — not the same spec failing consistently.

If the same spec fails every run, this is not accumulated-state flake — hand it back to `e2e-test-engineer`'s Phase 6 triage (flake / test bug / application defect / seed-data gap).

### Phase 2 — Isolation test, first, before anything else

Re-run the failing spec(s) scoped/isolated (`--grep` or a spec-path argument), on their own. **If they pass clean in isolation, this is not an application defect.** Stop investigating the spec's own code — the failure is environmental, produced by running alongside hundreds of other tests, not by the spec's own logic. This single check is the fastest way to avoid burning hours proving individual specs' application code correct for what is an environmental pattern spanning the whole run.

### Phase 3 — Classify the root cause

Read `references/diagnostic-playbook.md` for the full decision tree and a worked example. In brief:

1. **Positional vs. temporal vs. accumulation.** Do failures cluster at a consistent *position* in the run regardless of elapsed time (suspect a specific test/fixture)? Do they correlate with elapsed time/resource metrics regardless of position (suspect a host ceiling)? Do neither correlate, but failures still scale with total tests executed (suspect process/connection degradation — the pattern this skill is built around)?
2. **Host-side check before app-level assumptions.** Rule out CPU/memory ceiling exhaustion on the runner via `cpu.stat` (`nr_throttled`, `throttled_usec`) and `memory.events` (the `high` counter) before assuming an application-level cause.
3. **Distinguish from cold-compile.** A dev-mode server (`next dev` or equivalent) JIT-compiling a rarely-hit route on first hit produces a similar surface symptom (a different test seems to fail each run) but a different mechanism and a different fix — see Phase 4. Don't reach for sharding reflexively whenever "different test fails each run" shows up; confirm which mechanism you're looking at first.

### Phase 4 — Pick the fix, don't reach for one reflexively

Read `references/reliability-fixes.md` for the full sharding decision criteria, implementation mechanics, and the complementary recommendations below. Match the fix to the mechanism Phase 3 identified:

- **Accumulated process/connection degradation** (isolated reruns pass, no positional or host-ceiling correlation, failures scale with total tests executed) → sharding is the candidate fix, restarting the dev server (and optionally resetting the DB) between shards.
- **Dev-server cold-compile latency** on rarely-hit routes (shorter run, different mechanism) → route/endpoint warm-up is the fix, not sharding. Sharding would not have caught this the previous time it happened and shouldn't be reached for reflexively here either.
- **Host resource ceiling** → this is a runner-capacity problem, not a suite-architecture one; report it as such rather than sharding or warming up around it.

Also consider, independent of the specific failure that triggered the review:
- **DB connection pool sizing** and **in-memory application-cache invalidation** under sustained write load — both contribute to degradation over a long single-process run and are worth checking during any reliability review, not only after a symptom appears.
- **Test-tier rebalancing** — if a regression tier has grown large enough to need sharding, that's also a signal to ask whether all of it needs to run on every full-regression trigger, or whether release-blocking tests belong in the already-fast, already-warmed critical tier instead.

**Never recommend switching E2E to a production build to dodge cold-compile latency.** Serving a production build turns on framework-level production-only optimizations (e.g. Next.js Link prefetching) that can silently break `waitForLoadState('networkidle')`-based waits suite-wide — a known bad trade, not a clean win. See `references/reliability-fixes.md` for the detail.

### Phase 5 — Implement and verify

- Apply the chosen fix (sharding config, warm-up step, pool-size change) following `references/reliability-fixes.md`'s implementation mechanics.
- Re-run the full regression tier at least twice to confirm the failure signature from Phase 1 is gone — a single clean run after a flake-class fix is not strong evidence; the whole point of this failure class is that it doesn't reproduce reliably on a single run either way.
- If sharding was added, confirm shard JSON reports still merge correctly for any downstream consumer (`jq -s`) and that artifact-upload globs cover the shard-numbered directories.

### Phase 6 — Fold into defect-filing behavior

The isolation-test-first check (Phase 2) is a process fix, not just a one-time diagnostic — so the pattern of spending hours proving several specs' application code correct for what turns out to be one environmental cause doesn't recur. When invoked from `e2e-test-engineer`'s Phase 6 defect triage:

- Report back whether the failure is environmental (this skill's territory) or an application defect (hand back to `e2e-test-engineer`).
- If environmental and a fix was applied, note it in the calling skill's final report as a suite-reliability fix, not as a filed defect — an environmental flake fixed at the suite level is not an `incident_report`-worthy application incident.

## Principles

**Isolation-test-first, always.** Never triage a "different test fails each run" pattern as N separate application bugs before checking whether they pass in isolation. That check is cheap; skipping it is expensive.

**Match the fix to the mechanism.** Sharding, warm-up, and capacity fixes solve three different problems that share a surface symptom. Applying the wrong one wastes the shard-restart overhead (or the warm-up effort) without fixing anything, and can mask the real cause long enough for it to get worse.

**Don't shard by default.** Sharding adds restart overhead and, if a DB reset per shard is used, real cost. Apply it only when Phase 3's diagnostics actually point at accumulation — not as a first response to "the suite is flaky."

**A suite-reliability fix is not a code review of the application.** This skill's job ends at "the suite is now a reliable instrument." It does not extend into auditing the application code the suite happens to exercise.
