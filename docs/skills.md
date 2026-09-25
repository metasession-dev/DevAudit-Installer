# Skills Overview

DevAudit ships six AI skills with the SDLC framework, synced into every consumer, plus one operator-only skill that lives in this repo and never syncs anywhere. One synced skill orchestrates the lifecycle; the other five specialize within particular stages.

This page is the short reader-facing overview. The full contract for skill structure, sync behavior, triggers, and evolution lives in [`sdlc/SKILLS.md`](../sdlc/SKILLS.md).

## The shipped skills (synced into every consumer)

| Skill | Role | Primary stage(s) | What it produces |
| --- | --- | --- | --- |
| `sdlc-implementer` | Orchestrator | 1-5 | Drives the tracked SDLC path end to end, including phase routing, evidence checkpoints, PR readiness, and resume/watch behavior |
| `e2e-test-engineer` | E2E and visual specialist | 2 | Maintains the end-to-end test pack, proves acceptance criteria, captures per-AC evidence shots, and helps classify failures |
| `governance-doc-author` | Governance-document specialist | 1-3 | Authors or refreshes governance artifacts such as ROPA, DPIA, AI disclosure, incident response, and periodic review docs |
| `requirements-aligner` | SRS alignment specialist | 1, 3 | Maintains `docs/SRS.md` and drops per-REQ `srs-alignment.md` traceability evidence |
| `adr-author` | Architecture-decision specialist | 1, 3 | Maintains `docs/ADR/` and drops per-REQ `architecture-decision.md` evidence |
| `risk-register-keeper` | Risk-assessment specialist | 1, 3 | Maintains `compliance/risk-register.md` and drops per-REQ `risk-assessment.md` evidence |

## Fleet operator (this repo only, never synced)

| Skill | Role | Runs from | What it produces |
| --- | --- | --- | --- |
| `fleet-doctor` | Fleet drift auditor | `DevAudit-Installer` (operator's own checkout, with sibling consumer repos on disk) | Sweeps every active consumer via `devaudit doctor --json`, classifies each finding as framework-origin (raised as an issue in `devaudit`/`DevAudit-Installer`) or consumer-drift (fixed in place — hotfix, Lightweight-path housekeeping, or deferred into the consumer's next tracked REQ bundle) |

`fleet-doctor` lives at `.claude/skills/fleet-doctor/` in this repo, not under `sdlc/files/_common/skills/` (the synced-template pool) — that's what keeps `devaudit update` from ever copying it into a consumer, where it would have no siblings to audit. See [`docs/fleet-doctor.md`](./fleet-doctor.md) for the full walkthrough.

## How the model works

- The stage docs own when a skill is needed.
- The skill owns how that work is executed.
- `devaudit update` syncs the skills into a consumer repo's `.claude/skills/`.
- Claude Code gets the deepest integration because it can auto-discover and auto-fire skills.
- Other agents still use the same SDLC, but consume the rules through `INSTRUCTIONS.md` and the synced workflow docs instead of a native skill runtime.

## Skill family structure

There are three practical groups:

| Group | Skills | Purpose |
| --- | --- | --- |
| Orchestration | `sdlc-implementer` | Owns workflow routing, checkpoints, and end-to-end lifecycle control |
| Execution specialists | `e2e-test-engineer`, `governance-doc-author` | Own bounded procedural work that the orchestrator delegates |
| SoT-alignment family | `requirements-aligner`, `adr-author`, `risk-register-keeper` | Keep the persistent source-of-truth documents aligned with the change and emit per-REQ traceability artifacts |

## When to use which skill

- Use `sdlc-implementer` when the work is a tracked `REQ-XXX` change and needs the full SDLC path.
- Use `e2e-test-engineer` when the work involves end-to-end, authenticated-flow, screenshot, or visual-regression testing.
- Use `governance-doc-author` when a project needs or refreshes governance evidence rather than code.
- Use the SoT-alignment family when the requirement changes product requirements, architecture decisions, or risk posture and the persistent documents must stay truthful.

## See also

- [`sdlc/SKILLS.md`](../sdlc/SKILLS.md) for the canonical skill contract and current trigger catalog
- [`docs/adding-a-skill.md`](./adding-a-skill.md) for skill authoring
- [`docs/change-workflows.md`](./change-workflows.md) for when the orchestrator is used and when the lightweight path applies
- [`docs/fleet-doctor.md`](./fleet-doctor.md) for the operator-only fleet-wide drift audit
