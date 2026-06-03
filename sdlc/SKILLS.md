# SDLC Skills — contract and conventions

The Metasession SDLC framework ships **Claude Code Skills** alongside its stage docs, adapters, and CI templates. Skills are self-contained behaviour packs the AI agent invokes when it recognises a relevant trigger — "add e2e tests for [ticket]", "classify the risk tier of this REQ", "triage these SAST findings". They specialise within stages (the stage doc owns _when and why_; the skill owns _how_).

This document is the contract every framework-shipped skill must follow. For the walkthrough on adding a new skill, see [docs/adding-a-skill.md](../docs/adding-a-skill.md). For the architectural rationale on the framework's layered design, see [ADR-001](../docs/ADR/ADR-001-polyglot-sdlc-architecture.md).

## Where skills live

Same layering as adapters:

```
sdlc/files/
├── _common/
│   └── skills/                          ← universal skills (stack-agnostic)
│       ├── _schema/skill.schema.json    ← frontmatter schema
│       └── <skill-name>/
│           ├── SKILL.md                 ← required: frontmatter + instructions
│           └── references/              ← optional: longer docs the skill links to
└── stacks/
    ├── node/
    │   └── skills/                      ← node-only skills (when needed)
    └── python/
        └── skills/                      ← python-only skills (when needed)
```

A skill is `_common/` when its body is genuinely framework-agnostic (auto-detects toolchain, doesn't depend on a single ecosystem). It's stack-scoped when its instructions assume a specific package manager, test framework, or build tool that other stacks don't share.

## How skills reach consumers

`devaudit update` (cli/src/update/skills.ts) copies every skill directory into the consumer's `.claude/skills/<skill-name>/` on every sync:

- All `_common/skills/<name>/` directories sync to every consumer.
- `stacks/<stack>/skills/<name>/` directories sync only when the consumer's `sdlc-config.json` selects that stack.
- The `_schema/` directory (and any other `_`-prefixed directory) is **not** synced — schemas are framework infrastructure.

Claude Code reads `.claude/skills/*/SKILL.md` for discovery; once synced, the skill is immediately available to the consumer's AI agent without further configuration.

Other AI tools (Cursor, Windsurf, Gemini CLI) don't have a native Skill mechanism. The skill content is referenced from `INSTRUCTIONS.md` so non-Claude agents can still consume it manually — they don't auto-invoke based on `description` triggers, but the content is reachable.

### Additional emissions

A skill is allowed to ship code that the consumer's test/build tooling needs to `import` at runtime — a helper, a fixture, a shared utility. The canonical source lives under the skill's `references/` directory (so it's discoverable alongside the SKILL.md that teaches its use), and `devaudit update` emits a copy into the right place in the consumer's source tree.

Currently the only such emission is the e2e-test-engineer skill's `evidence.ts` helper, which syncs to `<consumer>/e2e/helpers/evidence.ts` on node-stack consumers. The pattern: add a guarded section to the CLI skill sync (`cli/src/update/skills.ts`) — the skill's main bundle still syncs to `.claude/skills/` as normal, but the extra file lands where the consumer's tests can import it.

Use this pattern sparingly. If the skill only needs to teach a concept, a Markdown example in SKILL.md is enough. If the skill prescribes a helper consumers must call from their own code, that helper deserves to be canonical and shipped — not copy-pasted from a doc.

## SKILL.md frontmatter contract

Required fields:

| Field         | Type   | Constraint                  | Purpose                                                                                                                                                  |
| ------------- | ------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | string | `^[a-z0-9][a-z0-9-]{1,63}$` | Identifier matching the parent directory. How Claude refers to the skill when reporting which one fired.                                                 |
| `description` | string | minLength 50                | What the skill does **and** when to invoke it. The "when" half drives discovery — without trigger phrases, the skill never fires. Aim for 100–500 chars. |

Optional fields:

| Field     | Type     | Purpose                                                                                    |
| --------- | -------- | ------------------------------------------------------------------------------------------ |
| `version` | string   | Semver. Useful when a skill's behaviour changes incompatibly so consumers can pin.         |
| `tags`    | string[] | Documentation grouping (e.g. `testing`, `security`, `compliance`). Not consumed by Claude. |
| `license` | string   | SPDX identifier or `proprietary`.                                                          |

`additionalProperties: false` — new fields require a deliberate schema update first.

The body of SKILL.md (everything after the closing `---`) is free-form Markdown. Claude reads it as the skill's instructions. Conventions worth following:

- Open with a one-paragraph summary of what the skill does.
- A **Scope** section: in-scope and out-of-scope behaviours.
- A **Workflow** section: numbered phases the skill walks through. Each phase should be self-contained enough that re-entering mid-skill is sensible.
- **Principles** at the end: cross-cutting rules the skill never violates (e.g. "never delete tests without explicit confirmation").

## How to write a good `description`

This is the load-bearing field. Bad descriptions lead to "the skill never fires" or "the skill fires constantly on irrelevant requests". Aim for:

1. **What the skill does**, in one clause. _"Maintain or bootstrap a project's end-to-end and visual regression test pack."_
2. **When to invoke it.** Both natural-language phrasings and concrete triggers. _"Use when the user wants to add, update, or retire e2e or visual tests for a feature, ticket, issue, or PR."_ Then list explicit trigger phrases: _"Trigger on phrases like 'add e2e tests for [ticket]', 'update the test pack', 'what tests do we need for this issue'…"_
3. **When NOT to invoke.** Explicit out-of-scope rules. _"Do NOT use for unit, component, or API-only tests, or performance tests."_

If a contributor reads only the description and gets the right invocation pattern, the description is doing its job.

## Validation

CI runs `node scripts/validate-adapter.cjs --all` on every push to develop. The validator parses the YAML frontmatter at the top of every `SKILL.md` and validates against `sdlc/files/_common/skills/_schema/skill.schema.json`. Errors are reported with the offending field path.

To validate a single skill locally:

```bash
node scripts/validate-adapter.cjs sdlc/files/_common/skills/<name>/SKILL.md
```

## Skills currently shipped

| Skill                   | Location          | Triggers (paraphrased)                                                                                                                                                                                  | Additional emissions                                                              |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `e2e-test-engineer`     | `_common/skills/` | "add e2e tests", "bootstrap an e2e suite", "update the test pack", "are any tests obsolete", "run e2e tests and file issues"                                                                            | `e2e/helpers/evidence.ts` + `evidence-shot-core.ts` (node-stack consumers)        |
| `sdlc-implementer`      | `_common/skills/` | "implement issue #N under the SDLC", "run the SDLC for issue #N", "automate REQ-XXX from issue to release", "resume REQ-XXX"                                                                            | — (orchestrator; invokes `e2e-test-engineer` + `governance-doc-author`)           |
| `governance-doc-author` | `_common/skills/` | "create / refresh the RoPA", "write a DPIA", "update the AI disclosure", "set up the periodic review schedule", "GDPR.Art-30 is MISSING on the matrix" (v0.1.37+)                                       | `references/incident-classification.md` (shared with `e2e-test-engineer`)         |

`sdlc-implementer` is the **default entry point for a tracked change** — an **orchestration skill** that drives Claude Code's native tools (`gh`, shell, `devaudit` CLI, portal API) through the full 5-stage flow against a single GitHub issue, pausing only at the UAT-review gate (and at the plan checkpoint for HIGH/CRITICAL risk). It is synced into every consumer (`.claude/skills/sdlc-implementer/`) by `devaudit update`. It replaces an earlier roadmap of five atomic skills (`risk-classifier`, `commit-message-author`, `compliance-evidence-author`, `sast-triager`, `release-ticket-author`) that were deprioritised — Claude Code's innate capabilities already cover what those atomic skills wrapped; the value-add is end-to-end orchestration with framework-compliant pauses, not five discoverable helpers a human still has to compose.

**Sub-skill invocation requirement.** During its Phase 2 (Implement & test), the orchestrator **MUST** invoke `e2e-test-engineer` for any end-to-end or visual-regression test work — both scenario derivation from the implementation plan and execution of the resulting suite. The orchestrator does NOT author e2e tests directly. (Unit tests stay with the orchestrator until a unit-test counterpart skill ships.) The invocation pattern is documented in [docs/adding-a-skill.md §Orchestrator skills](../docs/adding-a-skill.md#orchestrator-skills-calling-other-skills); this is a hard contract — the orchestrator's SKILL.md fails review if it inlines `e2e-test-engineer`'s procedure.

`sdlc-implementer` is **not** used for trivial / housekeeping changes (docs, formatting, dependency bumps, CI tweaks) — those skip the requirement and the ceremony. See [the change-type matrix](../docs/change-workflows.md) and the [trivial-change walkthrough](./files/_common/implementing-an-sdlc-issue.md#trivial-change-walkthrough).

## Skills on the roadmap

No concrete candidates are queued. A `unit-test-engineer` counterpart to `e2e-test-engineer` is the most likely next skill, but it lands only when day-to-day work repeatedly surfaces the pain and the orchestrator demonstrably needs it as a separable component. Tracking: [`metasession-dev/DevAudit-Installer#29`](https://github.com/metasession-dev/DevAudit-Installer/issues/29).

## When to make a skill vs. when to keep something in a stage doc

Three rules of thumb:

1. **Stage docs own _when_ and _why_.** "After Stage 2 implementation, before Stage 3 evidence compilation, the team should…" — that's stage-doc material, not skill material.
2. **Skills own _how_.** Multi-step procedures that are reusable across requirements, opinionated about technique, and benefit from being invoked by a discovery-trigger phrase belong in skills.
3. **If two stage docs would each instruct the AI to do the same multi-step procedure, lift it into a skill.** Both Stage 2 ("update tests") and Stage 3 ("re-run the suite, file defects") need the same e2e-test-engineering procedure. Lifting that into a skill keeps the stage docs focused on flow and avoids drift.

## Evolution

Backward-compatible additions to the frontmatter (new optional fields): update the schema first, then the docs, then the skills can adopt the new field.

Renaming or removing a required field is a v1.next-major change with a deprecation cycle (mirror `working_directory` rollout: warn for one minor version, refuse in the next).

When a skill's behaviour changes meaningfully, bump its `version`. Consumers pinning to an old version can re-sync at their own pace.

## See also

- [docs/adding-a-skill.md](../docs/adding-a-skill.md) — walkthrough for authoring a new skill.
- [STACK_ADAPTER.md](./STACK_ADAPTER.md) / [HOST_ADAPTER.md](./HOST_ADAPTER.md) — sibling contracts for the adapter layers.
- [ADR-001](../docs/ADR/ADR-001-polyglot-sdlc-architecture.md) — why the framework is layered this way.
- [Anthropic's Claude Code Skills docs](https://docs.claude.com/en/docs/claude-code/skills) — upstream format reference.
