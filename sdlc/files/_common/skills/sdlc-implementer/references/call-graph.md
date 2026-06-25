# Sub-skill call graph

The `sdlc-implementer` skill is an orchestrator. It calls into other shipped skills rather than re-implementing their procedures. This document is the authoritative map of when and why each sub-skill is invoked.

## Skills `sdlc-implementer` invokes today

### `e2e-test-engineer` — Phase 2 (Implement and test)

**When**: Any time Phase 2's test-writing step needs end-to-end or visual-regression tests. The risk-class depth table (LOW / MEDIUM / HIGH / CRITICAL) determines whether e2e tests are needed; whenever they are, `e2e-test-engineer` writes them.

**Invocation**: `Skill(name: "e2e-test-engineer", input: { issue: "#N", req: "REQ-XXX", plan_path: "compliance/plans/REQ-XXX/implementation-plan.md", diff: <branch diff> })`.

**Hard contract** (per [`SKILL.md`](../SKILL.md) §Sub-skill invocation contract):

- The orchestrator never authors e2e tests directly.
- The orchestrator never transcribes `e2e-test-engineer`'s six-phase workflow into its own body.
- SKILL.md review for `sdlc-implementer` fails if e2e test-authoring logic is inlined.

**Why hard-contract**: `e2e-test-engineer` exists, works, and has been smoke-tested. Re-implementing its scenario-derivation logic inside an orchestrator would (a) drift over time, (b) double the maintenance burden, (c) miss the orchestrator-skill-pattern intended for the framework.

**What `sdlc-implementer` retains responsibility for in Phase 2**:

- Branching off `develop`.
- Risk-class-based depth selection (deciding _whether_ e2e is needed at all).
- Unit + integration test writing (these stay with the orchestrator until a counterpart unit-test skill ships).
- Running all gates (the orchestrator owns the gate execution; `e2e-test-engineer` may have already run the e2e portion).
- Iterating on gate failures up to N=3 attempts.
- Committing.
- Pushing.

## Skills `sdlc-implementer` does NOT invoke

These were previously planned as atomic skills but were deprioritised. The orchestrator handles their slice directly, without calling out:

| Deprecated atomic skill        | What the orchestrator does instead                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `risk-classifier`              | Phase 1 step 2 — orchestrator reads `Test_Policy.md` directly and classifies risk, emitting the signals it used.                          |
| `commit-message-author`        | Phase 2 step 7 — orchestrator generates the Conventional Commits message from the staged diff + branch name + RTM entry.                  |
| `compliance-evidence-author`   | Phase 3 — orchestrator drives the test pack, organises artefacts, uploads via `devaudit push`, updates the RTM.                           |
| `sast-triager`                 | Phase 2 step 5 — `semgrep` runs as one of the gates; the orchestrator surfaces findings to the human at Phase 1 plan or halts in Phase 2. |
| `release-ticket-author`        | Phase 4 step 1 — orchestrator drafts the PR body directly from the SDLC PR template + plan.                                               |

If any of these surface in production as repeated pain (per [`SKILLS.md` §When to make a skill vs. when to keep something in a stage doc](../../../../SKILLS.md#when-to-make-a-skill-vs-when-to-keep-something-in-a-stage-doc)), they may be lifted into atomic skills later. The orchestrator would then delegate to them — same pattern as it does today for `e2e-test-engineer`.

## Skills the orchestrator may invoke once they exist

Future expansion. Not committed; listed so the call graph is forward-readable.

- **`unit-test-engineer`** (planned via real-need driver) — would take over Phase 2's unit/integration test writing. The orchestrator's Phase 2 step 2 would invoke this skill the same way it invokes `e2e-test-engineer` today.
- **`incident-responder`** (planned via real-need driver) — would handle the "production smoke failed in Phase 5" branch. Today the orchestrator falls back to filing an `[INCIDENT]` issue + paging on-call per the project's playbook.

When/if these ship, the call graph in this file gets updated alongside the orchestrator's SKILL.md.

## Skills that invoke `sdlc-implementer`

None. The orchestrator is a top-level entry point — it's invoked directly by the user ("implement issue #N under the SDLC") and runs the framework's stages. It is not designed to be a sub-skill of another orchestrator.

## Invocation discipline

Three rules every orchestrator → sub-skill call should follow:

1. **Pass the minimum context the sub-skill needs.** `e2e-test-engineer` needs the implementation plan + diff; it does not need the orchestrator's full state. Over-passing context bloats the sub-skill's working memory and slows it down.
2. **Trust the sub-skill's return contract.** If `e2e-test-engineer` says it added 3 tests and they all pass, the orchestrator does not re-verify the assertion. The sub-skill is the authority for its slice.
3. **Surface sub-skill failures to the human at the orchestrator level.** If `e2e-test-engineer` halts because the project's test framework can't be detected, that's an orchestrator-level halt — the user sees one clear "I couldn't proceed because…" message, not a stack of nested skill output. For Phase 1 sub-skills (`requirements-aligner`, `adr-author`, `risk-register-keeper`), failure behavior is defined per-skill in [`SKILL.md` §Sub-skill failure behavior](../SKILL.md#sub-skill-failure-behavior-devaudit-installer211-gap-15): blocking sub-skills halt the orchestrator; advisory sub-skills warn and continue with a skipped marker in the plan.
