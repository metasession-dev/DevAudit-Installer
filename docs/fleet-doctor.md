# Fleet doctor

An operator-only, fleet-wide drift audit across every onboarded DevAudit consumer. Not part of the six skills `devaudit update` syncs into a consumer (see [`docs/skills.md`](./skills.md)) — `fleet-doctor` runs from this repo (`DevAudit-Installer`) and needs visibility across every consumer plus the two framework repos it might file issues against, which is the opposite shape from a per-consumer skill.

## Trigger phrases

"run fleet doctor", "audit all consumers", "check onboarded projects for drift" — invoked directly by the operator from a `DevAudit-Installer` checkout, never auto-fired.

## Where it lives

`.claude/skills/fleet-doctor/SKILL.md`, in this repo only. It is deliberately **not** under `sdlc/files/_common/skills/` (the pool `devaudit update` syncs wholesale into every consumer) — a consumer has no siblings to audit, so shipping it there would be dead weight at best and confusing at worst.

## What it reads

- [`docs/consuming-projects.md`](./consuming-projects.md)'s **Active consumers** table, to find every currently-onboarded project.
- Each consumer's local sibling checkout (skipped, not failed, if not present on disk).
- `devaudit doctor --json` run inside each consumer — the same command an individual consumer's operator would run, extended (devaudit-installer#867) to tag every check with a first-pass `suspectedOrigin: 'framework' | 'consumer-drift' | 'unknown'`.

## What it decides

For every non-clean finding, whether it's most likely a **framework/portal defect** (the same anomaly shows up across consumers, or points at code in `devaudit`/`DevAudit-Installer` rather than anything a consumer could have done) or **consumer-specific drift** (this one repo diverged from what onboarding/template-sync should have produced).

## What it does about each kind

| Finding kind | Action |
| --- | --- |
| Framework/portal defect | Raise (or dedupe onto) a GitHub issue in the owning repo. **Never patched directly by this skill.** |
| Consumer drift, release-blocking | Drive a `hotfix/<slug>` through that consumer's existing hotfix/back-merge machinery. |
| Consumer drift, not urgent | Invoke that consumer's own `sdlc-implementer`, routed through its existing Lightweight path (housekeeping merge, no `REQ-XXX`, no UAT ceremony). |
| Consumer drift, deferrable | File a normal issue in that consumer's repo and leave it for the next tracked `sdlc-implementer` run to pick up via the **existing** `Bundles: #A, #B` declaration — no new bundling mechanism. |

## What it never does

- Never edits framework code in `devaudit` or `DevAudit-Installer` directly.
- Never merges a fix through anything other than an existing, already-guarded path.
- Never invents a second bundling mechanism alongside the one `sdlc-implementer` Phase 1 step 4 already has.

## Full contract

See [`.claude/skills/fleet-doctor/SKILL.md`](../.claude/skills/fleet-doctor/SKILL.md) for the phase-by-phase instructions this skill follows.

## See also

- [`docs/skills.md`](./skills.md) — the six per-consumer skills this one is deliberately not part of
- [`docs/consuming-projects.md`](./consuming-projects.md) — the Active consumers table this skill reads
- [`cli/src/commands/doctor.ts`](../cli/src/commands/doctor.ts) — the `devaudit doctor --json` output this skill consumes
