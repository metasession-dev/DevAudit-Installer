# Adding a new SDLC skill

Walkthrough for authoring a new Claude Code Skill in the Metasession SDLC framework. Read with [SKILLS.md](../sdlc/SKILLS.md) (the contract) open in an adjacent tab.

The `e2e-test-engineer` skill is the worked example throughout — it's the first skill the framework shipped, so the conventions in it are the conventions you'll follow.

## When to add a new skill

Two triggers, both real:

1. **A multi-step procedure appears in two or more stage docs.** When Stage 2 and Stage 3 both instruct the AI to run the same five-phase test workflow, lift it into a skill. Stage docs stay focused on _when_; the skill owns _how_. Avoids drift.
2. **A real task surfaces repeatedly in production work and benefits from auto-discovery.** "Hey AI, can you also figure out what e2e tests this PR needs?" said three times in a week → the work is reusable, opinionated, and discovery-driven. Build the skill.

Don't speculate. The [SKILLS.md roadmap](../sdlc/SKILLS.md#skills-on-the-roadmap) names candidate skills, but candidates only become real `SKILL.md` artefacts when production work surfaces the pain repeatedly. `sdlc-implementer` was promoted off the roadmap because the end-to-end SDLC orchestration it provides wasn't replicable from Claude Code's native tools alone — a clear pain signal. Its SKILL.md + references are now authored on `main` (Phase B), validator-clean, awaiting Phase C smoke against `wawagardenbar-app` before being marked production-shipped. Other candidates (e.g. a `unit-test-engineer` counterpart to `e2e-test-engineer`) stay queued until similar real-need drivers appear.

## Step 1 — Decide universal or stack-specific

| Question                                                                                | If yes → universal (`_common/skills/`) | If no → stack-specific (`stacks/<name>/skills/`) |
| --------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------ |
| Does the skill auto-detect its toolchain?                                               | yes                                    | no                                               |
| Would Python and Node consumers both invoke this on similar prompts?                    | yes                                    | no                                               |
| Are the instructions free of package-manager / build-tool / language-specific commands? | yes                                    | no                                               |

The `e2e-test-engineer` is universal: it detects Playwright/Cypress/pytest-playwright/Selenium from the consumer's repo and adapts. A hypothetical `python-test-coverage-analyzer` that runs `coverage.py` is stack-specific.

## Step 2 — Create the directory

```
sdlc/files/_common/skills/<skill-name>/
├── SKILL.md
└── references/      # optional, for content too long for SKILL.md itself
```

`<skill-name>` must satisfy `^[a-z0-9][a-z0-9-]{1,63}$` — lowercase, kebab-cased, 2–64 characters. The directory name is also the value of `name:` in the frontmatter; the two must match.

## Step 3 — Write the frontmatter

The minimal-required shape:

```markdown
---
name: my-skill-name
description: >
  What the skill does in one clause. When Claude should invoke it (natural-
  language description + explicit trigger phrases). When NOT to invoke it.
---
```

**The `description` is load-bearing.** Bad descriptions cause two failure modes:

- _Too vague_ → skill never fires because Claude doesn't recognise relevant prompts.
- _Too broad_ → skill fires on irrelevant requests and adds noise.

The shape that works (from `e2e-test-engineer`):

> Maintain or bootstrap a project's end-to-end and visual regression test pack. Use when the user wants to add, update, or retire e2e or visual tests for a feature, ticket, issue, or PR — OR when no e2e suite exists yet and one needs setting up using best practices for the detected stack. Covers deriving the scenarios a change needs, matching the project's conventions, removing obsolete tests (only after confirmation), running the suite, and filing defects for failures or missed acceptance criteria. Trigger on phrases like "add e2e tests for [ticket]", "update the test pack", "what tests do we need for this issue", "are any tests obsolete", "run the e2e tests and file issues", "add visual regression coverage", "set up e2e tests for this project", or "bootstrap an e2e suite". Framework-agnostic (Playwright, Cypress, Selenium, etc.) and tracker-agnostic (GitHub, Jira, Linear, etc.). Do NOT use for unit, component, or API-only tests, or performance tests.

Three parts: **what it does** (one clause), **when to use** (paraphrase + explicit triggers), **when NOT to use** (out-of-scope rules). Aim for 100–500 characters of `description` content.

## Step 4 — Write the body

After the closing `---`, the rest of `SKILL.md` is free-form Markdown. Claude reads it as the skill's instructions. The conventions that work:

1. **One-paragraph summary** at the top — what the skill does, the same idea as the description but in flowing prose for a human reader.
2. **`## Scope`** — in-scope and out-of-scope bullet lists. Make the out-of-scope list real (refuse to do things the skill isn't for).
3. **`## The workflow`** — numbered phases, in order. Each phase has a heading like `### Phase 1 — Orient`. Each phase explains what to do, what to capture, what to confirm with the user before continuing, and what NOT to do.
4. **`## Principles`** at the bottom — cross-cutting rules the skill never violates. _"Don't invent infrastructure", "Confirm before destructive actions", "Ambiguity is a question, not a guess"._

If a workflow phase is genuinely long (more than ~50 lines of instructions or a reference table the AI doesn't need on every invocation), move the long content to `references/<name>.md` and point the phase at it: _"Read `references/<name>.md` before continuing."_ The `e2e-test-engineer` skill does this for its bootstrap phase, which has per-framework recommendation tables that bloat the main file.

## Step 5 — Validate

```bash
node scripts/validate-adapter.cjs sdlc/files/_common/skills/<name>/SKILL.md
```

Expected output: `OK   sdlc/files/_common/skills/<name>/SKILL.md [skill]`. The schema enforces the frontmatter contract; the body is free-form so won't be validated.

Run the full validation too:

```bash
node scripts/validate-adapter.cjs --all
```

All adapters and skills should pass.

## Orchestrator skills (calling other skills)

Most skills are atomic — they own one slice of one stage. Some — like the `sdlc-implementer` ([SKILL.md authored on `main`](../sdlc/files/_common/skills/sdlc-implementer/SKILL.md); awaiting Phase C smoke per [SKILLS.md §roadmap](../sdlc/SKILLS.md#skills-on-the-roadmap)) — orchestrate multiple stages and benefit from calling other shipped skills as sub-procedures rather than re-implementing their logic.

When you author an orchestrator skill:

- **Use the Skill invocation pattern.** Claude Code exposes other registered skills to the running session; the orchestrator's SKILL.md body should explicitly name the skills it intends to call (`Skill(name: "e2e-test-engineer", ...)`-style references in the workflow phases) so an agent reading the body knows the call graph in advance.
- **Don't inline a sub-skill's procedure.** If the orchestrator's Phase 2 needs e2e tests written, it MUST invoke `e2e-test-engineer` — not transcribe `e2e-test-engineer`'s six-phase workflow into its own body. Inlining drifts; invocation doesn't. The `sdlc-implementer` skill is the canonical example: its SKILL.md fails review if it authors e2e tests directly instead of delegating to `e2e-test-engineer`.
- **Document the call graph in the `references/` directory.** A short `references/call-graph.md` listing every sub-skill the orchestrator may invoke (with a one-line "when") makes the orchestrator's behaviour predictable and grep-able.
- **Compliance constraints stay with the orchestrator.** The sub-skill knows _how_ to do its own task; the orchestrator owns the cross-stage rules (UAT-gate enforcement, four-eyes-for-HIGH/CRITICAL, AI-disclosure on commits, etc.). Don't push compliance enforcement into sub-skills.
- **Frontmatter still single-purpose.** The orchestrator's `description` field announces _orchestration_ as its trigger surface — not the sub-skills' triggers. `e2e-test-engineer` keeps its own trigger phrases; the orchestrator gets phrases like "implement issue #N under the SDLC".

## Step 6 — Cross-reference from stage docs

If the skill specialises within a particular stage (and most do), add a one-line pointer from the relevant stage doc. Example for `e2e-test-engineer`:

In `sdlc/files/_common/2-implement-and-test.md`, near the test-update step:

> When updating end-to-end or visual regression tests, invoke the `e2e-test-engineer` skill — it derives scenarios from the requirement's ACs, reconciles with existing tests, and runs the suite. See `.claude/skills/e2e-test-engineer/SKILL.md`.

Same idea in `3-compile-evidence.md` if the skill participates in evidence compilation.

The cross-reference makes the skill discoverable to AI agents that have already loaded the stage doc but haven't yet recognised the prompt's trigger phrase.

## Step 7 — Test against a real consumer

Sync the framework to a consumer and verify the skill lands in `.claude/skills/<name>/`:

```bash
./scripts/sync-sdlc.sh v1.23.x ../some-consumer
ls ../some-consumer/.claude/skills/<name>/
```

You should see `SKILL.md` plus any `references/` content. Open Claude Code in the consumer's working directory and confirm the skill is recognised (Claude reports loaded skills on startup with `claude /skills`).

## Step 8 — Add the skill to SKILLS.md's "currently shipped" table

`sdlc/SKILLS.md` has a table of shipped skills. Add a row for the new one with its triggers.

## Step 9 — Open the upstream PR

A single PR in DevAudit:

1. Adds `sdlc/files/_common/skills/<name>/` (or `stacks/<stack>/skills/<name>/`).
2. Adds the cross-reference from the relevant stage doc(s).
3. Updates `sdlc/SKILLS.md`'s currently-shipped table.
4. Validate-adapter tests pass.

The PR body should explain: which stage(s) the skill supports, what triggered the work (real driver, not speculation), and what the skill explicitly does NOT do.

## Step 10 — Consumers pick it up on next sync

No action required by individual consumers — the next `sync-sdlc.sh` run distributes the skill into their `.claude/skills/`. The next AI session sees it automatically.

## Worked example: `e2e-test-engineer`

This is the skill the framework currently ships. It's a good model for new skills because it covers the full set of conventions:

- Universal (auto-detects Playwright, Cypress, Selenium, WebdriverIO, pytest-playwright, etc.).
- Six-phase workflow with explicit pre-conditions per phase.
- An optional bootstrap phase (1b) for projects without an e2e suite.
- Long content (per-framework bootstrap recommendations) in `references/bootstrap.md`.
- A "Filing defects" section that auto-adapts to whatever tracker the project uses (GitHub via `gh`, GitLab via `glab`, Jira / Linear via MCP, Azure DevOps via `az boards`), with a markdown-report fallback when nothing is available.
- A "Principles" section listing non-negotiables: don't delete tests without confirmation, don't approve visual baselines silently, ambiguity is a question not a guess.

Read it at [`sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`](../sdlc/files/_common/skills/e2e-test-engineer/SKILL.md) and use it as the template for your next skill.

## See also

- [SKILLS.md](../sdlc/SKILLS.md) — the contract every skill must satisfy.
- [STACK_ADAPTER.md](../sdlc/STACK_ADAPTER.md) / [HOST_ADAPTER.md](../sdlc/HOST_ADAPTER.md) — sibling adapter contracts.
- [adding-a-stack.md](./adding-a-stack.md) / [adding-a-host.md](./adding-a-host.md) — the adapter walkthroughs.
- [Anthropic's Claude Code Skills docs](https://docs.claude.com/en/docs/claude-code/skills) — upstream format reference.
