# The Fire-and-Forget Skill Problem: Why AI Coding Agents Lose Control of the SDLC

> **Primary persona:** CTO + Lead Developer
> **Funnel stage:** MOFU — Consideration
> **Format:** Technical deep-dive (~2500 words)
> **Cross-links:** [/sdlc](https://devaudit.ai/sdlc) · [docs/skills.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/skills.md) · [docs/issues/e2e-gate-enforcement-gap.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/issues/e2e-gate-enforcement-gap.md)

---

You invoke the `sdlc-implementer` skill to drive a feature through your compliance-aware SDLC. The skill returns a detailed markdown document: Phase 0 triage, Phase 1 planning, Phase 2 implementation, Phase 3 evidence compilation, Phase 4 submission, Phase 5 close-out. Five phases, twelve steps per phase, every compliance artifact accounted for.

The native AI agent reads the instructions and starts executing. Phase 1 goes smoothly — risk classification, implementation plan, SRS alignment, RTM entry. Phase 2 begins: implement the feature, run fast gates, delegate E2E to the `e2e-test-engineer` skill.

Then MongoDB won't start.

## The five handoff points where the skill loses control

What happens next is not a bug in the skill. It's a structural limitation of how AI skills work in every current IDE platform — Claude Code, Cursor, Windsurf, Gemini CLI. The skill loses control at five predictable handoff points, and the native agent never returns to it.

### Point 1 — Environment blocker

The skill said "run E2E tests." The native agent tried. MongoDB failed with a stale lock. The skill's instructions don't cover "what to do when MongoDB won't start" — they cover the SDLC workflow, not environment troubleshooting. The native agent had to solve the problem directly: kill the stale process, clear the lock, restart MongoDB.

Once solved, the agent continued executing. It didn't re-invoke the skill because **there was no signal telling it to go back.** The skill is a document, not a process. It can't say "wake me up when you're done."

### Point 2 — Debugging loop

E2E tests failed five times. Each iteration required: read the Playwright error context → inspect the page snapshot → edit the test selector → restart the dev server → re-run. This is a tight feedback loop that only the native agent can perform. The skill can't participate at all — it can't see browser screenshots, can't read error contexts, can't run `npx playwright test`.

The debugging loop is where the native agent's environment access is essential. But it's also where the skill's influence drops to zero. The agent is in a flow state, iterating on test failures, and the skill's compliance checklist is nowhere in its context.

### Point 3 — Post-debugging continuation

After E2E tests passed, the agent should have re-invoked `sdlc-implementer` for Phase 3. But it had momentum — it knew the next steps (commit, merge, push, create evidence). So it continued from memory.

The skill's instructions don't include a "re-invoke me after you finish debugging" checkpoint. And the agent didn't create one. The skill was invoked once at the start, its instructions were followed until the environment blocker, and then the agent went autonomous.

### Point 4 — Phase 3 evidence compilation

This is where the missing artifacts came from. The `sdlc-implementer` skill knows the full checklist: `test-scope.md`, `test-plan.md`, `implementation-plan.md` in `compliance/evidence/REQ-XXX/`. The native agent didn't — it was working from memory and missed three files. The skill has this knowledge baked into its Phase 3 instructions; the native agent doesn't.

CI failed. "Compliance Validation: 3 missing files." The agent scrambled to create them, pushed again, and CI passed. But the artifacts were created after the fact, not as part of the skill-driven workflow.

### Point 5 — Phase 5 close-out

Same pattern, different consequence. The release PR was merged to `main`. The GitHub issue was closed. The native agent treated "PR merged" as "done."

The skill knows there are post-merge compliance steps: update the RTM status from `TESTED - PENDING SIGN-OFF` to `APPROVED - DEPLOYED`, move the release ticket from `pending-releases/` to `approved-releases/`, verify portal approval. The native agent didn't know, or didn't remember, or didn't consider it important.

The result: the release ticket stayed in `pending-releases/`. CI's `upload-evidence` job continued treating it as in-scope for every subsequent release. The next feature's portal release showed evidence for the prior REQ alongside the current one. The audit trail was polluted.

## Why it happens structurally

The skill tool is a **stateless instruction injection**. When invoked, it returns a markdown document. The native agent reads it and executes. But the skill has:

- **No persistent state** — it doesn't track what's been done
- **No execution monitoring** — it can't observe whether the agent is following its instructions
- **No re-invoke triggers** — nothing tells the agent to re-invoke after a disruption
- **No environment access** — it can't run commands, start services, or debug failures

```
Skill invocation → returns instructions → native agent executes
                                              ↓
                                    hits environment blocker
                                              ↓
                                    native agent solves it directly
                                              ↓
                                    native agent continues executing
                                              ↓
                                    never re-invokes skill
                                              ↓
                                    misses compliance steps
```

In a true orchestration model, the skill would be a persistent controller that delegates environment work to the native agent, receives the result back, and continues to the next step. Today, most of the skill is still a fire-and-forget document. The one concrete exception now is the bounded PR watch loop used during blocked Phase 4 release work.

## The ideal solution: command manifest architecture

The architectural answer is what we call **Decision 1B: the command manifest**. Instead of the skill returning a static document, the skill declares commands it needs executed. The native agent executes them and returns output. The skill stays in control of the workflow but delegates execution.

```
Skill: "Run `npx playwright test` and give me the output"
  → Native agent executes command, returns output
Skill: "Output shows 3 failures. Run `npx playwright test --grep AC2` ..."
  → Native agent executes, returns output
Skill: "All green. Now commit with: fix: [REQ-085] ..."
  → Native agent executes commit
Skill: "Now re-read state. Phase 2 complete. Proceeding to Phase 3..."
```

The skill stays in control because it decides what to do next after each command result. The native agent is the hands; the skill is the brain.

### What this requires at the platform level

The command manifest needs three things that no current AI IDE provides:

1. **Sequential command requests** — the skill makes multiple requests to the native agent in sequence, not one injection
2. **Result return** — the native agent returns command output *to the skill*, not to the user
3. **Context persistence** — the skill maintains its context across these exchanges

This is a platform feature request, not something DevAudit can implement. The skill mechanism is defined by the IDE (Claude Code's Skill tool, Cursor's rules system, Windsurf's skill invocation). DevAudit authors the skill content; the platform defines the execution model.

Until platforms support persistent skill controllers, we need a practical approach that works within the fire-and-forget constraint.

## The practical solution: belt and suspenders

The implementation has two layers: **prose-level instructions** that work when the skill is invoked and followed, and **machine-enforced backstops** that catch the case where it isn't.

### Layer 1: Prose-level skill instructions plus a bounded execution loop

#### Executable PR watch loop

`devaudit-sdlc` now exposes a real orchestration command for blocked/reviewing PRs:

```bash
node SDLC/bin/devaudit-sdlc.js --watch-pr=<number> --repo <owner/name> --release REQ-XXX --project-slug <slug>
```

The loop is intentionally narrow:

- polls `gh pr view` and `gh pr checks`
- persists retry context in `.sdlc-pr-watch.json`
- classifies blockers as waiting, auto-rerunnable, or human-blocked
- re-runs likely flaky workflows automatically
- re-runs the Release Approval Gate when the portal is already `uat_approved` or later but GitHub is stale

It is not a daemon, not cross-turn memory inside the skill runtime, and not a platform-native persistent controller. It is a resumable local engine that closes the concrete Phase 4 gap without pretending the platform problem is solved.

#### Resume protocol

The skill's instructions explicitly state: after any environment detour — service startup failure, test debugging iteration, CI failure fix — the native agent must re-invoke the skill with:

```
Skill(name: "sdlc-implementer", args: "resume REQ-XXX — <detour description>, re-enter at Phase N")
```

The skill re-reads state from the filesystem and continues from where it left off. It's idempotent on re-entry:

- Re-read `compliance/RTM.md` to confirm the REQ-XXX row exists and has a provenance stamp
- Re-read `compliance/evidence/REQ-XXX/` to see which artifacts already exist
- Check `git log` for commits already made on this branch
- Resume at the appropriate phase based on what's already done

This is **state reconstruction from the filesystem**, not true state persistence. The filesystem *is* the state. If Phase 2 is complete but Phase 3 artifacts are missing, the skill resumes at Phase 3 step 1. No state file, no checkpoint — just inference from existing artifacts.

#### Explicit skill/native-agent boundary

The skill documents what the native agent is responsible for (command execution, environment debugging, browser inspection, external services, git operations) and what the skill is responsible for (workflow decisions, compliance checklists, phase transitions). The boundary section states:

> "PR merged to main ≠ done. The native agent must re-invoke the skill for Phase 5 close-out after the release PR is merged."

The native agent must NOT continue to the next phase without re-invoking the skill. The only exception is the skill's own auto-continue steps (Phase 2 step 11) where the skill explicitly says it will continue in the same turn.

#### Phase 5 as an explicit skill step

Post-merge close-out is a mandatory skill-driven step:

1. **Update RTM status** — change the REQ-XXX row from `TESTED - PENDING SIGN-OFF` to `APPROVED - DEPLOYED`
2. **Move release ticket** — move `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md` to `compliance/approved-releases/`
3. **Verify portal approval** — check that the DevAudit portal release record exists and is in `approved` status
4. **Commit the close-out** — `compliance: [REQ-XXX] close out release — RTM updated, ticket moved to approved-releases/`

The resume protocol explicitly covers Phase 5: `resume REQ-XXX — release PR merged to main, re-enter at Phase 5`.

### Layer 2: Machine-enforced backstops

#### Pre-push hook: skill sentinel

The pre-push hook checks for a `.sdlc-implementer-invoked` sentinel file. If the commit is a `feat`/`fix`/`refactor`/`perf` type (implementation commit) and the sentinel is missing, the push is blocked:

> "No sdlc-implementer invocation detected. Run the skill before pushing implementation commits."

This proves the skill was invoked at least once. It doesn't prove the skill drove every phase — but it catches the case where the native agent skipped the skill entirely.

#### Pre-push hook: compliance artifact validation

The pre-push hook runs `./scripts/validate-compliance-artifacts.sh` as a fourth check. If `test-scope.md`, `test-plan.md`, or `implementation-plan.md` is missing from `compliance/evidence/REQ-XXX/`, the push is blocked:

> "Compliance artifact validation failed. Missing or incomplete artifacts. Run './scripts/validate-compliance-artifacts.sh' locally to see details."

This catches the PR #413 failure class — missing artifacts from Phase 3 — before the push lands. The hook can't invoke the skill, but it can prevent the consequences of the skill not being invoked.

#### CI: unskippable commit validation

`validate-commits.sh` runs in CI and checks that every `feat`/`fix`/`refactor`/`perf` commit has a `[REQ-XXX]` tag and that the RTM row for that REQ has a `sdlc-implementer@<version>` provenance stamp. This can't be bypassed with `--no-verify` — it runs on the PR in CI, not on the local machine.

### What each layer catches

| Failure mode | Prose-level (skill) | Machine-enforced (hook/CI) |
|---|---|---|
| Skill never invoked | — | Pre-push sentinel check blocks push |
| Skill invoked, agent deviated after environment blocker | Resume protocol instructs re-invocation; PR watch loop gives Phase 4 a resumable execution path | Pre-push artifact validation blocks push |
| Phase 3 artifacts missing | Skill's Phase 3 checklist | Pre-push `validate-compliance-artifacts.sh` |
| Phase 5 close-out skipped | Skill's Phase 5 explicit step | CI `upload-evidence` terminal directory check (catches stale tickets on next release) |
| RTM provenance missing | Skill's Phase 1 step 9 | CI `validate-commits.sh` fails the PR |

The prose-level changes work when the skill is invoked and followed. The machine-enforced changes catch the case where it isn't. The new PR watch loop removes one concrete blind spot in Phase 4, but the broader gap remains: the platform still does not provide a general persistent skill controller. The command manifest architecture would eliminate this gap entirely.

## Why not just build the command manifest now?

The command manifest requires the AI IDE platform to change how skills work. DevAudit authors skill content (markdown files); the platform defines the execution model (how skills are invoked, whether they persist, whether they can make sequential requests). This is not a DevAudit decision — it's a Claude Code, Cursor, or Windsurf feature request.

The belt-and-suspenders approach is deliberately designed to work within the current platform constraint. Every change is either:

- **A skill content change** (markdown additions to `SKILL.md`) — works today
- **A git hook change** (shell script additions to `pre-push`) — works today
- **A CI template change** (YAML additions to `ci.yml.template`) — works today

No platform changes required. No new tooling. No dependencies on AI IDE vendors. The implementation is entirely within DevAudit's control.

When platforms do support persistent skill controllers, the command manifest becomes the natural evolution. The resume protocol's state reconstruction logic transfers directly — the skill already knows how to infer state from the filesystem. The boundary section's responsibility split maps cleanly to the command manifest's delegation model. The prose-level instructions become the command manifest's decision logic.

## The broader lesson

This problem is not unique to DevAudit. Any AI-driven workflow that uses skills (or rules, or prompts, or any instruction-injection mechanism) has the same structural gap. The skill tells the agent what to do, but it can't supervise the agent doing it. When the agent hits an environment blocker, it goes autonomous, and the workflow's compliance guarantees evaporate.

The belt-and-suspenders approach is the pragmatic answer: make the skill's instructions as explicit as possible about when to re-invoke, and make the hooks and CI as comprehensive as possible about catching what the skill would have caught. The gap between them is the cost of the current platform architecture. It's not zero, but it's manageable — and it's a hell of a lot better than no enforcement at all.

Compliance as a byproduct, not a project — but sometimes the byproduct needs a backstop.

---

*Read the implementation issue → [docs/issues/e2e-gate-enforcement-gap.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/issues/e2e-gate-enforcement-gap.md)*

*See the SDLC → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)*

*See the skills overview → [docs/skills.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/skills.md)*
