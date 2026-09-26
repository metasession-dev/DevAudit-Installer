# Fleet doctor

**Metasession's own automated fleet-wide drift audit**, built on top of [`devaudit doctor --fleet`](./doctor.md#--fleet-sweeping-every-project-you-can-see) (devaudit-installer#861), which does the underlying discovery+collection sweep for *any* DevAudit account, not just Metasession's. This skill adds two things on top that are specific to Metasession operating its own fleet: an org-boundary gate before any write action, and automated write actions themselves (filing upstream issues, driving hotfixes, invoking `sdlc-implementer`).

If you just want to see the health of every project *your own* account can see, with no automated write actions, use `devaudit doctor --fleet` directly — it works for any org, requires no Claude Code checkout, and is documented in full in [`docs/doctor.md`](./doctor.md#--fleet-sweeping-every-project-you-can-see). This skill exists for Metasession's own operator workflow, which needs the write-action layer on top.

Not part of the six skills `devaudit update` syncs into a consumer (see [`docs/skills.md`](./skills.md)) — `fleet-doctor` runs from this repo (`DevAudit-Installer`) and needs visibility across every consumer plus the two framework repos it might file issues against, which is the opposite shape from a per-consumer skill.

## Trigger phrases

"run fleet doctor", "audit all consumers", "check onboarded projects for drift" — invoked directly by the operator from a `DevAudit-Installer` checkout, never auto-fired.

## Where it lives

`.claude/skills/fleet-doctor/SKILL.md`, in this repo only. It is deliberately **not** under `sdlc/files/_common/skills/` (the pool `devaudit update` syncs wholesale into every consumer) — a consumer has no siblings to audit, so shipping it there would be dead weight at best and confusing at worst.

## What it reads

- `devaudit doctor --fleet --json`, run from this repo with Metasession's own operator `DEVAUDIT_USER_TOKEN` — does discovery (every project the token's account can see on the portal) and collection (`devaudit doctor --json` against each one found checked out locally) in one command. Each check carries a first-pass `suspectedOrigin: 'framework' | 'consumer-drift' | 'unknown'` (devaudit-installer#867).
- [`docs/consuming-projects.md`](./consuming-projects.md)'s **Active consumers** table remains the human-readable reference for which consumers exist and their polyglot-monorepo status, but is no longer what this skill parses to decide what to sweep — that's now `--fleet`'s own portal-backed discovery.

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
- Never takes a write action (filing an issue, opening a hotfix branch, invoking `sdlc-implementer`) against a repo whose owner doesn't match the expected org — see the org-boundary check below.

## Org boundary

`devaudit doctor --fleet` (the discovery+collection step this skill now delegates to) is already tenant-isolated at the source: it only ever sees projects the calling `DEVAUDIT_USER_TOKEN`'s account can access on the portal, enforced by the portal's own authz. But a portal project's `repo_url` is an unverified string, not a proven GitHub-ownership link (see `docs/doctor.md`'s `--fleet` section) — so before any *write* action in Phase 4 or Phase 5, `fleet-doctor` separately verifies the target repo's actual GitHub owner (`gh repo view <owner>/<repo> --json owner`) matches the expected org (`metasession-dev`) and hard-stops — reports the mismatch, takes no action — if it doesn't. This is defense-in-depth on top of the portal-side scoping, specifically because write actions have a higher cost of being wrong than a read-only sweep does.

## Full contract

See [`.claude/skills/fleet-doctor/SKILL.md`](../.claude/skills/fleet-doctor/SKILL.md) for the phase-by-phase instructions this skill follows.

## See also

- [`docs/skills.md`](./skills.md) — the six per-consumer skills this one is deliberately not part of
- [`docs/consuming-projects.md`](./consuming-projects.md) — the Active consumers table this skill reads
- [`docs/doctor.md`](./doctor.md) — the full `devaudit doctor` contract, including `suspectedOrigin` and the `--json` shape this skill consumes
