# Your Flaky E2E Test Isn't Broken. Your CI Architecture Is.

**Long-form parent:** The Test Was Never the Problem: Diagnosing Long-Run E2E Flakiness and Turning It Into Reusable AI-Agent Knowledge
**Platform:** LinkedIn, Dev.to
**Read time:** ~4 minutes

---

A release is blocked. The end-to-end regression suite failed. You retry it. It passes this time — except a completely different test failed instead. You retry again. A third, unrelated test fails.

The instinct is to open an issue against whichever test failed and start debugging it. That instinct is usually wrong, and chasing it costs real engineering hours for no fix at all.

## The trap

We hit exactly this pattern on a project using [DevAudit](https://devaudit.ai) — a compliance-aware SDLC framework that pairs AI coding agents with requirements traceability, evidence capture, and a three-tier E2E gating model (smoke on every push, a fast "critical" tier before merge, and a full regression tier after production deploy). The regression tier runs hundreds of tests sequentially against one long-lived dev server and one database connection, in a single CI job — a completely standard setup, not an exotic one.

Individual specs kept failing. Engineers did the responsible thing: they read the code, verified the logic, added instrumented logging, and reproduced the exact scenario locally. Every time, the code was correct. One investigation went as far as bypassing the UI entirely to hit the database directly, confirming a config value round-tripped perfectly — on a run where the UI-driven version of the exact same test had failed minutes earlier in CI.

That's the tell. If a test fails in the full suite but passes clean, every time, when run in isolation, the test isn't lying to you about a code defect. Something about *running for a long time* is the actual variable.

## What's actually going on

Long single-worker E2E runs share a structural weakness: everything under test lives in one continuously-running process for the entire suite. That process accumulates state the same way any long-running server does — a growing memory footprint, a database connection pool under sustained pressure, in-memory caches that mostly invalidate correctly but not under every write pattern. None of this shows up in a 30-second isolated test. It shows up an hour into a 500-test run, on whichever test happens to touch the strained resource at that moment. Different test each time isn't randomness — it's whichever test drew the short straw.

There's a second, easily confused failure mode with a similar symptom but a different cause: cold compilation. Development-mode servers compile routes on first request. A route nobody's hit yet in this run pays a multi-second compile tax right when a fixed test timeout is watching. This also produces "different test fails each run" — but the fix is a warm-up step that pre-hits every route before the clock starts, not anything to do with test count or run duration. Telling these two apart matters, because the fix for one does nothing for the other.

## The actual fix

For the long-run accumulation problem, the fix is to stop running the suite as one continuous session. Split it into shards — a quarter of the tests each — and restart the application server fresh between shards. Nothing exotic: the test runner's native sharding flag, plus a kill-and-relaunch of the dev server in between. Each shard starts clean. No shard runs long enough to accumulate the pressure that was destabilizing things.

That fixes the one project. But it doesn't fix the pattern.

## The actual insight

This project didn't invent a novel architecture. It followed a documented, shared template — the same one every project on this SDLC framework is encouraged to adopt for its E2E gating. Any project that follows that template and grows its regression suite past a few hundred tests is a candidate for the exact same failure, for the exact same structural reason. Patching one repo's workflow file fixes one repo. It does nothing for the next team that copies the same template and hits the same wall in six months, re-derives the same diagnosis from scratch, and burns the same engineering hours proving their own code innocent.

So instead of a one-off patch, the fix became a piece of reusable knowledge: a new AI-agent skill, purpose-built to diagnose this failure class and decide what to do about it. Not folded into the existing test-authoring skill — deciding whether tests exist for a feature is a different job from deciding whether a CI architecture can sustain the tests it already has. A separate, focused skill, invocable both by the skill that maintains test suites and by the orchestrator that drives the whole delivery pipeline — because "is our CI reliable" is a question worth asking independent of whether anyone's adding tests that week.

The skill carries the diagnostic playbook directly: check whether the failure reproduces in isolation before touching a line of application code, distinguish accumulation from cold-compile, weigh sharding's overhead against what it buys, and reach for warm-up steps and connection-pool review as often as it reaches for sharding. The expensive part of this investigation — learning to tell a real bug from an environmental artifact — only has to happen once. Every project that uses this skill afterward inherits the answer instead of re-earning it.

## The broader lesson

Flaky tests get treated as a test-quality problem by default, because a test is the thing that turned red. Often, the test is a sensor, not the cause. The sensor is telling you something true about the system it's watching — you just have to be willing to look past the sensor.

And when you find a genuine systemic cause, the highest-leverage fix usually isn't the patch to the one place you found it. It's making sure the next team doesn't have to find it again.

---

*Read the full article → [devaudit.ai/blog](https://devaudit.ai)*

*See the SDLC → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)*
