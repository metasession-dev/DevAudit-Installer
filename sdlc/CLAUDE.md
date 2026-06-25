# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

This is a compliance-grade SDLC template system — a set of 12 documents across two tiers that implement a workflow-driven development pipeline satisfying ISO 29119, ISO 27001, GDPR, SOC 2, and EU AI Act requirements. It is not a software application; it contains markdown templates and an accompanying article.

## Repository Structure

- `files/` — The template documents:
  - **Tier 1 (universal, never project-specific):** `Test_Policy.md`, `Test_Strategy.md`, `Test_Architecture.md`, `Periodic_Security_Review_Schedule.md`
  - **Tier 2 (project-specific, customized per project):** `0-project-setup.md` through `5-deploy-main.md` (workflows), `Test_Plan_TEMPLATE.md`, `README_TEMPLATE.md`

## Key Design Principles

- **Single responsibility per document.** Policy says _what_ and _why_, Strategy says _how methodically_, Architecture says _with what tools_. No content should appear in two places.
- **Tier 1 never references a specific project.** Tools are referenced by category in Policy/Strategy; only Architecture names specific products and versions.
- **Risk-based proportionality.** Documentation, testing depth, and review requirements scale with risk level (Low/Medium/High). AI involvement raises risk by one level for Medium/High categories.
- **Workflow-driven compliance.** The six workflows (0-5) are executable procedures with specific commands, not guidelines. Compliance artifacts are natural outputs of following the workflows.

## Development Model: Developer + AI Partner

Each project follows a **single owner-developer partnered with AI coding agents** model:

- **Owner-developer** provides direction, judgment, and approval. They are accountable for the project.
- **AI agent** (Claude Code, Windsurf, Cursor) acts as implementation partner, compliance enforcer, and reviewer. The SDLC process is enforced by the AI on every code change via drop-in rules (`sdlc/ai-rules/`).
- **Branching is GitFlow** with permanent `main` and `develop` branches plus `feature/*`, `fix/*`, and `hotfix/*` branches. See the Branching Strategy section below for details.
- **PR reviews** are owner-reviewed with AI-assisted verification. CI provides independent, tamper-resistant evidence. The SDLC workflows and compliance gates replace traditional team ceremonies (standups, sprint planning).
- **The AI is the second pair of eyes.** It asks which requirement a change is for, blocks implementation until planning is complete, enforces commit conventions, runs compliance gates, and guides evidence compilation.

## Workflow Sequence

0. **Project Setup** (run once) — repo, branches, CI, compliance directories
1. **Plan Requirement** — define in RTM, classify risk, generate test scope _before_ implementation
2. **Implement and Test** — code on `develop`, all local gates green on every commit
3. **Compile Evidence** — gather artifacts, create release ticket, update RTM
4. **Submit for Review** — PR triggers independent CI verification + human review
5. **Deploy to Main** — merge, verify deployment, finalize compliance artifacts

## Mandatory Gates

All templates assume these gates: TypeScript (0 errors), SAST/Semgrep (0 high/critical), dependency audit (0 high/critical), E2E tests (all pass), human PR approval.

## Conventions in Templates

- **Commit format:** Conventional Commits with `Co-Authored-By` tags for AI, `Ref: REQ-XXX` for tracked requirements
- **Requirement IDs:** `REQ-XXX` format, tracked in `compliance/RTM.md`
- **Status lifecycle:** DRAFT → IN PROGRESS → TESTED - PENDING SIGN-OFF → APPROVED - DEPLOYED
- **Branching:** GitFlow — permanent `develop` branch, protected `main` (production), `feature/*` and `fix/*` from `develop`, `hotfix/*` from `main`, merge commits to preserve audit trail
- **Evidence model:** local testing (comprehensive) + CI testing (independent verification, tamper-resistant)
- **Placeholders:** Templates use `[BRACKETED_VALUES]` and `# UPDATE` markers for project-specific customization

## Branching Strategy — GitFlow

This repository uses a **GitFlow** branching model. AI agents (Claude Code, Cursor, Windsurf, Gemini CLI) and human contributors must follow these rules.

### Branch roles

| Branch | Purpose | Direct push? |
|---|---|---|
| `main` | Production — stable, tagged framework versions | **No** — PR only |
| `develop` | Integration — active work merges here | **No** — PR only |
| `feature/*` | New work — branched from `develop` | Yes (to the feature branch) |
| `fix/*` | Bug fixes — branched from `develop` | Yes (to the fix branch) |
| `hotfix/*` | Production hotfixes — branched from `main` | Yes (to the hotfix branch) |

### AI agent rules

1. **Never commit directly to `main` or `develop`.** Always use a `feature/`, `fix/`, or `hotfix/` branch.
2. **Branch naming:** `feature/<issue#>-<short-slug>`, `fix/<issue#>-<short-slug>`, `hotfix/<issue#>-<short-slug>`.
3. **Workflow:** branch from `develop` → implement → PR into `develop` → merge. Ship: PR `develop` → `main` → merge.
4. **Conventional Commits** for all commit messages. Reference issue numbers in the body.
5. **CI must pass on `develop`** before merging to `main`.
6. **Merge commits** (not squash or rebase) to preserve the audit trail.

## When Editing These Templates

- Maintain the separation between Tier 1 and Tier 2 — if content applies universally, it belongs in Tier 1; if project-specific, Tier 2.
- Keep workflow documents as executable procedures with concrete commands, not abstract guidance.
- Risk classification rules and AI governance controls are defined in Test_Policy.md and Test_Strategy.md — don't duplicate them in workflow files.

## Syncing Templates to Consuming Projects

After updating SDLC templates, sync to consuming projects:

```bash
# Pass one path per active consumer. Only WGB is live as of 2026-05-19.
devaudit update v1.x.0 ../wawagardenbar-app
```

This tags DevAudit, copies all templates (workflow files, AI rules, hooks, scripts, CI templates), and updates tag references in the consuming project's CI workflows. Review the diff in each project before committing.

META-AGENT / META-ATS / META-JOBS onboarding attempts were reverted (see [docs/consuming-projects.md](../docs/consuming-projects.md)); pass their paths to the same command if and when they return as live consumers.
