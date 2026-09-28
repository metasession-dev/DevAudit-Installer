# The Test Was Never the Problem: Diagnosing Long-Run E2E Flakiness and Turning It Into Reusable AI-Agent Knowledge

> **Primary persona:** CTO + Lead Developer
> **Funnel stage:** MOFU — Consideration
> **Format:** Technical deep-dive (~2400 words)
> **Cross-links:** [/sdlc](https://devaudit.ai/sdlc) · [docs/skills.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/skills.md) · [docs/adding-a-skill.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/adding-a-skill.md)

---

A release PR is blocked on a failing end-to-end regression check. You retry the job. It fails again — but on a completely different test this time. You retry once more. A third, unrelated test fails.

At this point most teams do the obvious thing: open a bug against whichever spec is currently red, dig into its code, and try to reproduce the failure. This article is about why that instinct is usually wrong, what it actually costs when you follow it anyway, and what we did once we stopped following it — which ended up being less "fix the test" and more "turn the diagnosis into something an AI coding agent can reuse across every project, permanently."

## Where this happened, and why it matters beyond one project

This surfaced on a project running under [DevAudit](https://devaudit.ai), a compliance-aware SDLC framework that pairs AI coding agents (Claude Code, Cursor, and others) with requirements traceability, evidence capture, and a generated CI pipeline. Part of that pipeline is a three-tier E2E gating model, shared as a template across every project the framework onboards:

- **Smoke** — a handful of tests on every push to the integration branch. Fast, cheap, always green or something's badly wrong.
- **Critical** — a slightly larger tier (smoke plus the specs tagged as release-blocking) that gates pull requests into the release branch. Target: 10-15 minutes.
- **Regression** — the full suite, everything under `e2e/`, run after a successful production deployment as a safety net for whatever the critical tier let through.

The regression tier is deliberately the least time-pressured of the three — it's not blocking a merge, it's catching things after the fact — which is exactly why it's allowed to grow. On the project in question it had grown to nearly 600 tests, run sequentially, single worker, against one continuously-running dev server and one database connection, in a single CI job that took the better part of 40 minutes.

That architecture is not exotic. It's the default shape of "we have a self-hosted CI runner with limited resources, so we can't afford multiple parallel workers, and we're testing against a live application server because that's what E2E means." Plenty of teams are running exactly this pattern right now, whether or not they're on this particular framework.

## The chase

The first failures looked like ordinary bugs. A price-editing form didn't save a triple-price adjustment correctly. A webhook idempotency check let a duplicate side effect through. An admin settings page didn't persist a start date. Each got filed as its own defect, because each *looked* like its own defect — a specific feature, a specific assertion, a specific stack trace.

Engineers did exactly what you'd want them to do with a reported bug: they read the implementation, traced the logic, and tried to reproduce it. And every single time, the reproduction failed to reproduce. Re-running the exact failing spec, in isolation, against a fresh environment — it passed. Not "mostly passed" — passed cleanly, repeatedly.

One investigation pushed further than "run it again and see." A settings-persistence test had failed in the full suite; the engineer bypassed the UI layer entirely and wrote a standalone script to call the underlying service function directly, then instrumented the write path and the read path with explicit logging to capture the exact payload at every step of a Mongo round-trip. That run passed — but the captured logs showed a completely correct round-trip from end to end. Not "correct and got lucky." Provably, traceably correct, at every stage, on a run that happened not to fail.

This is the moment worth pausing on, because it's counter to how most engineers are trained to think about test failures. The natural conclusion from "I verified the code is correct and it still sometimes fails" is *"I must have missed something — let me look harder."* The actual correct conclusion, once you've done this exercise two or three times across unrelated features, is *"the code isn't the variable. Stop looking at the code."*

## The signature

Once that reframe happens, the pattern that was invisible spec-by-spec becomes obvious in aggregate:

- Different tests fail on different runs. Never the same one twice, in any predictable order.
- Every failing test passes cleanly when re-run scoped or isolated, outside the full suite.
- The application code involved, when directly audited, is correct.

None of these are properties of a code defect. A real bug in `computeAdjustedPrice` fails the pricing test every time you run it, isolated or not — the bug doesn't know or care what else is running. A real bug in a webhook handler fails deterministically given the same input. What produces "different, unrelated test fails, but only in the long full run, never in isolation" is something about the *environment* the tests share, not something about any individual test's assertions.

That's a state-drift or resource-accumulation signature, and it points at exactly one architectural feature of the setup: a single, long-lived process serving hundreds of sequential requests over the better part of an hour, backed by a single long-lived database connection.

## Two failure classes that look identical and aren't

Before settling on a diagnosis, it's worth being explicit about a trap: there are at least two distinct root causes that produce this exact "different test fails each run" symptom, and they need different fixes.

**Cold compilation.** Development-mode application servers (the kind almost everyone runs E2E tests against, because building a production bundle for every CI run is slow and often changes runtime behavior) compile routes lazily, on first request. A route the suite rarely visits — an audit log page, a rarely-exercised admin API — pays a multi-second JIT compilation tax the first time anything hits it. If that first hit happens to be a test with a fixed 5- or 30-second timeout, the test times out waiting on the compiler, not on the application logic. The fix is a warm-up step: enumerate every route the suite will visit, curl each one once before the timed run starts, and let the compilation cost land off the clock. This is a real, previously-diagnosed instance of "different test fails each run" on the exact project this article is about — and it was already fixed, separately, before the pattern in this article was fully understood. It's a useful contrast specifically because it looks identical from the outside and needed a completely different fix.

**Long-run accumulation.** This is the pattern this article is actually about: memory growth in a process that's never restarted, a database connection pool under sustained pressure from hundreds of sequential operations, in-memory application caches whose invalidation logic is correct for any individual write but hasn't been proven correct under a thousand writes in sequence. None of this is visible in a 30-second isolated test run. It becomes visible sometime after the twentieth or two-hundredth minute of continuous execution, on whichever test happens to touch the strained resource at that moment.

Telling these two apart matters in practice, not just in theory: a project that treats every instance of this symptom as cold-compile and just adds more warm-up steps will get no benefit against the accumulation pattern, and a project that reaches for sharding every time will pay real overhead against failures that a five-line warm-up step would have fixed for free.

A useful field test for which one you're looking at: **does the failure position in the test list correlate with time, or with something else?** Cold-compile failures cluster around whichever *specific routes* are rarely hit, regardless of how long the run has been going. Accumulation failures don't correlate with any particular route or test — they correlate loosely with how much has already run, and any test unlucky enough to touch the strained resource at that point is fair game.

## The fix, and why it isn't a matrix job

For the accumulation pattern, the fix is to stop treating the suite as one continuous session. Split execution into shards — say, four chunks of roughly 150 tests each — using the test runner's native sharding support, and restart the application server between shards: kill the process, relaunch it, wait for it to come back up, then run the next chunk. Each shard gets a fresh process, a fresh connection, and a bounded amount of accumulated load. No single continuous run gets long enough to accumulate the pressure that was destabilizing things.

The obvious alternative — turning each shard into its own CI job in a matrix, so they run in genuine parallel — is worth naming and setting aside deliberately. On infrastructure where the self-hosted runner enforces exclusive single-job execution across every project sharing the host, a matrix of jobs doesn't actually parallelize; it just queues behind the same lock, with the added complexity of now needing to merge JSON test reports across genuinely separate jobs, fragment the artifact upload story across job boundaries, and rework whatever auto-files-a-bug-on-failure logic assumed one job producing one result. Keeping the shards as sequential loops inside a single job gets the actual benefit — bounded, resettable execution — without inheriting any of that complexity. On infrastructure that *can* run jobs in true parallel, the matrix approach is worth reconsidering; the sharding-with-restart pattern degrades gracefully to that case, it just doesn't require it.

```yaml
# Illustrative shape, not literal config:
for shard in 1..N:
  playwright test --shard=$shard/$N --reporter=json
  if shard < N:
    kill $DEV_SERVER_PID
    npm run dev &
    wait-on http://localhost:3000
```

Merging the resulting per-shard JSON reports for any downstream tooling that parses test results (an auto-filed-bug step, a compliance evidence uploader) is usually a non-issue if that tooling does a recursive search for failure records rather than assuming a specific single-report shape — wrapping N reports in an array and letting a recursive descent find every failure regardless of nesting depth works without needing a "real" merge.

## The pivot: from a patch to a piece of knowledge

At this point the natural next step is: implement the shard-and-restart fix in this one project's CI workflow, close the tickets, move on. That's a legitimate stopping point, and for a while it looked like the right one.

Except the architecture that produced this problem wasn't invented by this project. It's the shared, documented template every project on this SDLC framework is encouraged to adopt for exactly this kind of gating. Any project that copied that template — and by design, most projects that adopt this framework do — and has grown its regression suite past a few hundred tests is running the identical setup: single worker, long-lived dev server, long-lived database connection, sequential execution over tens of minutes. Every architectural precondition for this failure class is present, independent of what the application under test actually does.

Patching one project's `e2e-regression.yml` fixes that project. It does nothing for the next team that adopts the same template, grows their suite the same way, and hits the same wall eighteen months from now — at which point they'll very likely re-run the exact same expensive investigation from scratch: file individual bugs against individual specs, verify each one's application code is correct, eventually notice the pattern, eventually arrive at the same diagnosis. The cost of that rediscovery isn't hypothetical — it's exactly the cost this project already paid, measured in engineering hours spent proving innocent code innocent.

So the fix that actually shipped wasn't a workflow patch. It was a new, dedicated skill for the AI coding agents this framework is built around: a piece of reusable, invocable knowledge that carries the diagnostic playbook (check isolation first, distinguish cold-compile from accumulation, weigh sharding's cost against its benefit), the implementation pattern (shard-and-restart, JSON report merging, artifact path handling), and a set of complementary recommendations that go beyond sharding — warm-up as a standard practice rather than a one-off fix, connection pool sizing, cache invalidation review, and rebalancing which tests sit in which gating tier as a suite grows.

## Why a new skill, and not an addition to an existing one

This framework already ships a skill scoped to end-to-end test *content* — deriving what scenarios a change needs, adding and retiring tests, matching a project's conventions, filing defects for failures. It would have been easy to bolt this knowledge onto that skill's existing instructions. We didn't, for a reason worth stating plainly: deciding *whether tests exist* for a feature and deciding *whether the CI architecture running those tests can sustain them at scale* are different jobs, triggered by different situations, useful to different callers.

The orchestrator skill that drives a change through the full delivery lifecycle has no reason to route through a test-content-authoring workflow just to ask "is our CI reliable" during a general health review — that question has nothing to do with adding tests. Keeping the reliability knowledge in its own skill means both the test-content skill (when suite growth or an unreproducible-in-isolation failure shows up during routine maintenance) and the orchestrator (during any general review, independent of whether anyone's touching tests that week) can invoke it directly, on their own triggers, without artificial coupling.

It also keeps each skill's own trigger description sharp. An AI agent decides whether to invoke a skill based substantially on how precisely that skill's description matches the situation in front of it — a skill whose description tries to cover both "help me add tests for this ticket" and "diagnose why our regression suite is flaky" ends up vaguer at both jobs than two skills that each do one job well.

## What the skill actually needs to know

Distilled to five things, so it's reusable rather than a transcript of one investigation:

1. **The risk profile** — what architectural features predict this failure class (dev-mode server kept alive across the suite, long-lived DB connection, forced single-worker execution, growing suite size) so the skill can flag exposure before a team has burned a week proving it the hard way.
2. **The diagnostic playbook** — isolation-test first, always, before touching application code; the positional-vs-temporal heuristic for telling accumulation apart from cold-compile; a note that host-level resource ceilings (CPU quotas, memory limits) should be ruled out before assuming application-level degradation, since they're cheap to check and easy to mistake for a code problem.
3. **Sharding decision criteria** — when it's warranted and, just as importantly, when it isn't. A tier that's failing because of cold-compile gets nothing out of sharding; the skill needs to tell these apart rather than reaching for one fix reflexively whenever the symptom matches.
4. **The implementation pattern** — shard-and-restart over a matrix job, given the concurrency constraints most self-hosted setups actually operate under; report merging; artifact path handling.
5. **What else to look for** — warm-up as standard practice, not just a reactive fix; connection pool review; cache invalidation audits; and reconsidering whether a suite that's outgrown its gating tier should be rebalanced rather than just made to run faster in place.

## The broader lesson

Flaky tests get treated as a test-quality problem by default, because a test is the thing that turned red — it's the visible artifact, so it absorbs the blame. Often the test is a sensor reporting on a system it's embedded in, not the cause of what it's reporting. Distrust it, in the specific sense of not assuming its assertion is wrong just because it's the thing you can see. Verify whether it fails in isolation before you touch a line of the code it's testing. That single check — cheap, fast, and skipped far too often — is the highest-leverage move in this entire story, and it's the one thing worth remembering even if nothing else here applies to your stack.

And when the cause turns out to be systemic rather than local, the fix with the most leverage usually isn't the patch at the place you found it. It's making sure the next team — or the next AI agent, working on a different project, months from now — inherits the diagnosis instead of re-earning it from scratch.

---

*Read the skill proposal → [DevAudit-Installer#874](https://github.com/metasession-dev/DevAudit-Installer/issues/874)*

*See the SDLC → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)*

*See the skills overview → [docs/skills.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/skills.md)*
