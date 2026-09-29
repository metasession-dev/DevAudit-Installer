# Housekeeping release runbook

A repeatable, pre-flight health check for an onboarded consumer, run **before** starting the next tracked REQ. It has two halves: sync the consumer to the latest framework templates, then run `devaudit doctor` and clear whatever it finds. Use this whenever a consumer has been quiet for a while, right after a DevAudit-Installer release, or any time you want a clean baseline before picking up new tracked work.

This formalizes (and extends) a step `sdlc-implementer` already performs automatically: Phase 0's freshness check (see [`sdlc-implementer/SKILL.md`](../sdlc/files/_common/skills/sdlc-implementer/SKILL.md), Phase 0 step 0) syncs stale templates via the same **Lightweight path** described below whenever it detects the consumer is behind. That automatic check stops at the sync — it does not currently run `devaudit doctor` afterward, so drift `doctor` catches (missing secrets, `e2e_regression_enabled` mismatches, missing `RTM.md`/`SRS.md` rows, missing pre-push hooks) can sit unnoticed through several tracked REQs. Running this runbook explicitly closes that gap until (or unless) Phase 0 is extended to run `doctor` itself — see the "Known gap" section below.

## When to run this

- Before starting the next tracked REQ on a consumer that's been idle for a while.
- Right after a DevAudit-Installer release ships, across every active consumer (see [`consuming-projects.md`](consuming-projects.md) for the current list).
- Any time `devaudit doctor --fleet` (see [`fleet-doctor.md`](fleet-doctor.md)) flags a consumer as drifted and you want to clear it project-by-project.

## The process

### 1. Sync framework templates

```bash
npx @metasession.co/devaudit-cli@latest update .
```

Review the diff before committing — `git status --short` / `git diff --stat`. This is a `chore:` housekeeping push, not a tracked change: no `REQ-XXX`, no RTM row, no evidence pack, no portal release. Drive it through `sdlc-implementer`'s **Lightweight path** (branch `chore/<slug>` off the integration branch, run the gates, open a PR, merge) — the skill already knows how to do this; you can either let Phase 0 pick it up automatically on the next tracked-issue run, or invoke `sdlc-implementer` directly against a housekeeping issue that says so explicitly (see the worked example below).

### 2. Run `devaudit doctor` and review every finding

```bash
devaudit doctor          # human-readable
devaudit doctor --json   # for a script/agent to parse
```

See [`doctor.md`](doctor.md) for the full check list. For each non-`ok` result, decide:

- **Consumer-side gap** (`suspectedOrigin: consumer-drift`) — fix it in this consumer: add the missing GitHub secret, opt into (or explicitly decline) `e2e_regression_enabled` via `devaudit update --enable-e2e-regression`/`--disable-e2e-regression` (see [`e2e-test-tiers.md`](e2e-test-tiers.md)), bootstrap `docs/SRS.md`/`compliance/RTM.md`, add the pre-push hook (`devaudit join`).
- **Framework-side gap** (`suspectedOrigin: framework`, or the same anomaly repeating identically across every consumer) — don't patch it locally. File a DevAudit-Installer issue instead, the same way today's `#877` triage did.
- **Ambiguous** (`suspectedOrigin: unknown`) — usually an operator-local auth/tooling issue (e.g. `gh` not authenticated in this shell) rather than either repo; re-run in an authenticated shell before concluding anything.

### 3. Commit, open a PR, merge

Same `chore:`/Lightweight-path flow as step 1 if step 2 produced any consumer-side fixes. If `devaudit doctor` came back clean, there's nothing further to commit — the sync from step 1 (if any) is the whole housekeeping release.

### 4. Re-verify

Re-run `devaudit doctor` (or wait for the next `devaudit doctor --fleet` sweep) to confirm the findings actually cleared, not just that a PR merged.

## Repeating this across every onboarded consumer

Run steps 1–4 independently, one consumer at a time, against each entry in [`consuming-projects.md`](consuming-projects.md)'s active-consumer table. Each run is scoped to its own repo and its own issue — there's no cross-consumer ordering dependency, so these can run in parallel or in any order.

Before repeating fleet-wide, confirm the active-consumer list itself is accurate: `devaudit doctor --fleet` reads live portal state, and running it may surface consumers this doc doesn't list, or list consumers no longer actually checked-out/onboarded. Reconcile that drift first (see [`consuming-projects.md`](consuming-projects.md) for the current state and any open discrepancies) so this runbook isn't run against a stale project list.

## Known gap

Phase 0's freshness check syncs templates automatically but does not run `devaudit doctor` afterward. Extending it to do so — so every tracked REQ's kickoff gets this runbook's step 2 for free, without a separate manual invocation — is a candidate framework improvement, not yet implemented. Track it as its own issue if picked up; don't fold it silently into an unrelated PR.
