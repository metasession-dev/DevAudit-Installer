# DevAudit Installer

> **DevAudit is more than a self-hosted compliance evidence portal — it enforces an SDLC that satisfies ISO 29119, ISO 27001, SOC 2, GDPR, and the EU AI Act.** Whether you're a vibe coder, traditional engineer, or non-technical builder, DevAudit ensures your software development lifecycle meets the requirements auditors actually check.

This repo — `DevAudit-Installer` — is the **framework + client** side of DevAudit: the SDLC you run and the tooling that gets installed into your project. It holds two of DevAudit's three pillars:

1. **The SDLC framework** (`sdlc/`) — stage docs, templates, per-stack/host adapters, and six AI skills (`sdlc-implementer` orchestrator + `e2e-test-engineer`, `governance-doc-author`, and the SoT-alignment family of `requirements-aligner` / `adr-author` / `risk-register-keeper`).
2. **The CLI + compliance gates** (`cli/`, `plugin-sdk/`, `plugins/*`, and the CI workflow templates under `sdlc/files/ci/`) — what onboards your project and what runs on every push/PR to feed the portal.

The third pillar — the **evidence portal** (the product/server side: what you see, the source of truth for releases, evidence, and approvals) — lives at [`metasession-dev/devaudit`](https://github.com/metasession-dev/devaudit) (running at <https://devaudit.metasession.co>). **Topics are split, not duplicated:** the product story, standards coverage, the portal UI, release lifecycle/approvals, and the API are documented there; the CLI, onboarding, the SDLC process, the skills, and the workflows that upload evidence are documented here. Each side cross-references the other.

Start at the portal for the big picture:

- [What is DevAudit](https://github.com/metasession-dev/devaudit/blob/main/docs/what-is-devaudit.md) — the three pillars in depth
- [Standards coverage](https://github.com/metasession-dev/devaudit/blob/main/docs/standards-coverage.md) — clause-by-clause mapping for ISO 29119 / ISO 27001 / SOC 2 / GDPR / EU AI Act

## The CLI: `install`, `update`, `join`

`npx` is the canonical invocation — zero install, always-latest. Requires Node ≥ 22. Prefer a permanent install? `npm install -g @metasession.co/devaudit-cli` once, then the short forms `devaudit install` / `devaudit update` / `devaudit join` work everywhere.

| Package                                                                                                                            | Purpose                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [`@metasession.co/devaudit-cli`](https://www.npmjs.com/package/@metasession.co/devaudit-cli)                                       | The `devaudit` binary                            |
| [`@metasession.co/devaudit-plugin-sdk`](https://www.npmjs.com/package/@metasession.co/devaudit-plugin-sdk)                         | Plugin contract types                            |
| [`@metasession.co/devaudit-plugin-prisma`](https://www.npmjs.com/package/@metasession.co/devaudit-plugin-prisma)                   | First-party plugin — Prisma migration hooks      |
| [`@metasession.co/devaudit-plugin-evidence-export`](https://www.npmjs.com/package/@metasession.co/devaudit-plugin-evidence-export) | First-party plugin — bulk evidence bundle export |

Native binaries (no Node runtime) via brew / scoop / `curl | sh` are on the roadmap — see [`docs/devaudit-cli/`](./docs/devaudit-cli/README.md).

### When to use which command

|                 | `install`                                                                                                                                                                                                | `update`                                                                                                                                              | `join`                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use when        | First time on a project — no `sdlc-config.json` yet                                                                                                                                                      | Framework has a new version (or you bumped on purpose)                                                                                                | A teammate is joining a project that's already been onboarded                                                                                                                         |
| Touches         | Creates portal project · issues API key · uploads GitHub secrets · sets branch protection · installs hooks · syncs templates                                                                             | Refreshes framework-owned files only: `.github/workflows/`, `SDLC/`, `.claude/skills/`, `scripts/`, AI rule files, issue templates, evidence helper   | Installs hooks + AI skills locally; **does not** rotate API keys, create new portal projects, or overwrite config                                                                     |
| Frequency       | Once per project lifetime                                                                                                                                                                                | Each release (or on demand to pick up a fix)                                                                                                          | Once per teammate per project                                                                                                                                                         |
| Interactive?    | Yes — 11 steps, ~5-10 min                                                                                                                                                                                | No — non-interactive, ~1-2 min                                                                                                                        | Minimal — local-only prompts                                                                                                                                                          |
| `sdlc-config.json` | Created                                                                                                                                                                                                  | Read                                                                                                                                                  | Read                                                                                                                                                                                  |

> `install` against an already-onboarded repo auto-detects the situation and flips to **developer mode** internally (same as running `join` explicitly). The four detection bits: `sdlc-config.json` exists · portal returns a project for the slug · an `Onboarding-issued` API key already exists · the repo has a `DEVAUDIT_USER_TOKEN` secret. Any one missing → operator mode (safe default).

## Quick start — onboard a new project (`install`)

```bash
# 1. Issue a DevAudit Personal Access Token at https://devaudit.ai/settings/tokens
export DEVAUDIT_USER_TOKEN="mctok_..."

# 2. Run the CLI against your consumer project's repo
npx @metasession.co/devaudit-cli@latest install ../path/to/your-consumer-project
```

The 11-step interactive flow validates the PAT, detects your stack (Node / Python) + host (Railway), creates the project + a CI API key on the portal, sets GitHub secrets and branch protection, bootstraps husky + commitlint hooks, and syncs the framework templates. The CLI leaves the tree dirty for you to review + open an onboarding PR.

**What you commit afterwards:** `sdlc-config.json`, `.github/workflows/*`, `SDLC/`, `.claude/skills/*`, `scripts/`, root rule files (`.cursorrules` / `.windsurfrules` / `GEMINI.md` / `INSTRUCTIONS.md`). First push to develop runs the gates; the portal starts seeing evidence on the same push.

**Governance docs are opt-in since v0.1.36.** `install` no longer auto-seeds the five starter templates (ROPA, DPIA, AI disclosure, incident report, periodic review) — the placeholders were auto-uploading as portal evidence on the first CI push, masking the project's true coverage state. Run `npx @metasession.co/devaudit-cli@latest bootstrap-governance` explicitly when you want the starters on disk, or invoke the `governance-doc-author` skill (v0.1.37+) to drive authoring from scratch. **The governance starters are stubs you must replace before committing** — see [`docs/governance-templates.md`](./docs/governance-templates.md). Full walkthrough: [`docs/onboarding.md`](./docs/onboarding.md).

## Quick start — keep a consumer in sync (`update`)

When the framework ships a new version, re-sync each consumer. The CLI is idempotent — re-running it against an unchanged framework version is a no-op.

```bash
# Inside the consumer's repo (the common case):
cd ../path/to/your-project
git checkout develop && git pull
git checkout -b chore/devaudit-update-to-vX.Y.Z

npx @metasession.co/devaudit-cli@latest update

# Review the diff, run local gates, commit + open PR, merge once CI green:
git diff
npm run lint && npx tsc --noEmit && npm test
git add -A && git commit -m "chore: devaudit update to vX.Y.Z"
git push -u origin HEAD
```

From anywhere, syncing one or several:

```bash
npx @metasession.co/devaudit-cli@latest update ../consumer-1 ../consumer-2
```

The CLI reads each consumer's `sdlc-config.json`, copies the templates from its bundled `sdlc/files/`, fires plugin `beforeSync`/`afterSync` hooks, and leaves the tree dirty for review. It bundles the framework, so it needs no DevAudit-Installer checkout at runtime. Check the [`cli/CHANGELOG.md`](./cli/CHANGELOG.md) before merging — most releases require no operator action beyond reviewing the diff, but occasionally a release adds a new GitHub secret or schema change that needs an explicit step.

## Quick start — teammate joining an existing project (`join`)

You're the second (or nth) developer on a project that's already been onboarded. Running `install` here would silently rotate the team's CI API key. Use `join` instead — same template sync, no portal call-outs:

```bash
cd ../path/to/your-project
npx @metasession.co/devaudit-cli@latest join
```

Full guide: [`sdlc/files/_common/joining-an-existing-project.md`](./sdlc/files/_common/joining-an-existing-project.md) (synced into every consumer's `SDLC/`). Or just run `install` — the CLI auto-detects and flips behaviour as described above.

## The SDLC at a glance

Trunk-based (`develop` → `main`), one owner-developer partnered with AI agents. The framework has **two release shapes** — tracked and housekeeping — and CI auto-classifies each develop push into the correct shape.

### Which AI agent? Any of them.

`devaudit install` writes drop-in rule files for the four agents that have a native rule-file mechanism, plus the canonical `INSTRUCTIONS.md` that any LLM-driven agent can consume:

| Agent                                                 | File installed                                                                                                                                  | Integration depth                                                                                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Code**                                       | `CLAUDE.md` + `.claude/skills/{sdlc-implementer,e2e-test-engineer,governance-doc-author,requirements-aligner,adr-author,risk-register-keeper}/` | **Deepest** — skills auto-fire from natural-language prompts ("implement issue #N", "run e2e tests", "draft an ADR for REQ-066", "open a risk-register entry"). |
| **Cursor**                                            | `.cursorrules` (pointer → `INSTRUCTIONS.md`)                                                                                                    | Rules load automatically; the agent reads the SDLC content on demand.                                                                                           |
| **Windsurf**                                          | `.windsurfrules` (pointer → `INSTRUCTIONS.md`)                                                                                                  | Same as Cursor — rules-on-load, content-on-demand.                                                                                                              |
| **Gemini CLI**                                        | `GEMINI.md` (pointer → `INSTRUCTIONS.md`)                                                                                                       | Same pattern as Cursor + Windsurf.                                                                                                                              |
| **GitHub Copilot / Aider / Continue / any other LLM** | `INSTRUCTIONS.md` (canonical)                                                                                                                   | No native rule-file integration; the agent reads `INSTRUCTIONS.md` when you point it at the SDLC content.                                                       |

The SDLC content + compliance gates + portal don't depend on which agent you pick. Claude Code's auto-firing skills are the most ergonomic today; the other agents do the same work with a slightly more manual "read the workflow file then run the stage" cadence.

### Tracked releases (`REQ-XXX`)

The default path for any user-visible change. Triggered by `feat`/`fix`/`refactor`/`perf` commits, which **must** cite a `[REQ-XXX]` (enforced by commitlint + `validate-commits.sh`). Runs all five stages:

```
0 Project setup → 1 Plan (REQ-XXX, risk, plan) → 2 Implement & test (gates green)
→ 3 Compile evidence (+ UAT verification) → 4 Submit for review (PR + UAT four-eyes)
→ 5 Deploy to main (prod smoke + Production approval)
```

The **`sdlc-implementer`** skill takes one GitHub issue through Stages 1–5 unattended on Claude Code (pausing at the portal UAT gate), delegating to five sibling specialists: **`e2e-test-engineer`** for the E2E test pack, **`governance-doc-author`** for Tier-1/2 governance docs, and the SoT-alignment family (**`requirements-aligner`**, **`adr-author`**, **`risk-register-keeper`**) at Stage 1 plan-APPROVAL + Stage 3 evidence-pack. Each SoT-alignment skill maintains one persistent source-of-truth document (`docs/SRS.md`, `docs/ADR/`, `compliance/risk-register.md`) and drops a per-REQ Tier 3 evidence artefact each cycle. On Cursor / Windsurf / Gemini CLI / Copilot the same workflow runs step-by-step against the synced `INSTRUCTIONS.md` — same gates, same evidence, slightly more manual cadence.

### Housekeeping releases (`v2026.06.04`)

Bare-date release shape for develop pushes that don't carry a `REQ-XXX` — typically `docs:`, `chore:`, `ci:`, `build:`, `test:`, `compliance:`, `revert:` commits. The portal **auto-classifies these by version pattern** and skips the per-REQ ceremony (no implementation plan, no test scope, no test execution summary). What's still required:

- All four CI gates green (SAST, dep-audit, E2E, test reports)
- `compliance/pending-releases/RELEASE-TICKET-<version>.md` — **auto-generated** by `generate-housekeeping-release-ticket.sh` and opened as a PR for operator review + sign-off (v0.1.41+).
- `compliance/security-summary-<version>.md` — **auto-generated** by `generate-security-summary.sh` from SAST + dep-audit JSON, same auto-PR (v0.1.41+).
- Same UAT → production four-eyes approval flow as tracked.

Operator workload on a housekeeping release: review the auto-PR, replace `REPLACE — …` markers in the Sign-off blocks, merge. The next CI run uploads both artefacts and the portal's release-completeness matrix flips both items to ✓.

→ Which workflow applies to which change type, and what release each produces: [**`docs/change-workflows.md`**](./docs/change-workflows.md).
→ Full stage-3 walkthrough including the housekeeping path: [**`3-compile-evidence.md`**](./sdlc/files/_common/3-compile-evidence.md).
→ The stage-by-stage operational walkthrough (synced into every consumer): [**`implementing-an-sdlc-issue.md`**](./sdlc/files/_common/implementing-an-sdlc-issue.md).

## Architecture

The framework follows a three-layer polyglot adapter pattern ([ADR-001](./docs/ADR/ADR-001-polyglot-sdlc-architecture.md)):

- **Process layer** (`sdlc/files/_common/`) — stage docs 0–5, test policies, evidence shape, skills. Stack-agnostic.
- **Stack adapters** (`sdlc/files/stacks/<name>/`) — language-specific commands and hooks (Node, Python today).
- **Host adapters** (`sdlc/files/hosts/<name>/`) — deployment-specific deploy-wait and prod-URL logic (Railway today).

Adding a new stack or host means dropping a new `adapter.json` + supporting files; no installer-script changes. The CLI substitutes each consumer's `sdlc-config.json` into the templates at `install`/`update` time.

## Documentation

**This repo (framework, CLI, process):**

| Doc                                                                                                       | What                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/onboarding.md`](./docs/onboarding.md)                                                              | `devaudit install` operator walkthrough                                                                                                                                      |
| [`docs/consuming-projects.md`](./docs/consuming-projects.md)                                              | Operator manual for consumer maintainers                                                                                                                                     |
| [`docs/sdlc-framework.md`](./docs/sdlc-framework.md)                                                      | Framework structure, tiers, adapter layering, schematic                                                                                                                      |
| [`docs/governance-templates.md`](./docs/governance-templates.md)                                          | Five starter templates (ROPA, DPIA, AI disclosure, incident report, periodic review) installed once into `compliance/governance/`. **Replace before going to production.**   |
| [`docs/change-workflows.md`](./docs/change-workflows.md)                                                  | Change types → workflow → release type, and what to expect                                                                                                                   |
| [`sdlc/files/_common/implementing-an-sdlc-issue.md`](./sdlc/files/_common/implementing-an-sdlc-issue.md)  | Operational stage-by-stage walkthrough (synced to consumers)                                                                                                                 |
| [`sdlc/SKILLS.md`](./sdlc/SKILLS.md) · [`docs/adding-a-skill.md`](./docs/adding-a-skill.md)               | The six shipped skills (`sdlc-implementer`, `e2e-test-engineer`, `governance-doc-author`, `requirements-aligner`, `adr-author`, `risk-register-keeper`) + authoring new ones |
| [`docs/adding-a-stack.md`](./docs/adding-a-stack.md) · [`docs/adding-a-host.md`](./docs/adding-a-host.md) | Adapter contracts                                                                                                                                                            |
| [`INSTRUCTIONS.md`](./INSTRUCTIONS.md)                                                                    | Working conventions for this repo                                                                                                                                            |

**Portal repo (product, server, the things you see):**

| Doc                                                                                                                    | What                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [What is DevAudit](https://github.com/metasession-dev/devaudit/blob/main/docs/what-is-devaudit.md)                     | The three pillars, value proposition                       |
| [Standards coverage](https://github.com/metasession-dev/devaudit/blob/main/docs/standards-coverage.md)                 | Clause-by-clause standards mapping                         |
| [Portal ↔ consumer integration](https://github.com/metasession-dev/devaudit/blob/main/docs/ci-integration.md)          | API, evidence categories, when/how artifacts are displayed |
| [Releases & approvals](https://github.com/metasession-dev/devaudit/blob/main/docs/releases-and-approvals.md)           | Release lifecycle states, types, four-eyes approval        |
| [Implementing an SDLC issue](https://github.com/metasession-dev/devaudit/blob/main/docs/implementing-an-sdlc-issue.md) | Audience walkthrough with sample AI prompts                |

## Related repositories

| Repo                                                                                        | Role                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`metasession-dev/devaudit`](https://github.com/metasession-dev/devaudit)                   | DevAudit evidence portal (Next.js, `devaudit.metasession.co`). Product/standards/portal-UI/release docs live there; the authoritative consumers table too. |
| [`metasession-dev/wawagardenbar-app`](https://github.com/metasession-dev/wawagardenbar-app) | Active consumer — Node/Next.js on Railway.                                                                                                                 |
| [`metasession-dev/META-JOBS`](https://github.com/metasession-dev/META-JOBS)                 | Active consumer — Node.                                                                                                                                    |

## Contributing

See [`INSTRUCTIONS.md`](./INSTRUCTIONS.md) for working conventions, and the `adding-a-stack.md` / `adding-a-host.md` / `adding-a-skill.md` guides for adding framework artefacts. DevAudit-Installer does not run its own SDLC against itself — CI green is the merge bar.
