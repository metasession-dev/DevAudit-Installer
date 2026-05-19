# SDLC AI Rules

Drop-in instruction files that enforce the Metasession SDLC compliance process through AI coding assistants. When added to a project, the AI assistant will guide developers through the SDLC workflow on every code change.

## What These Rules Do

- **Ask which GitHub Issue a change is for** before writing any code
- **Create issues when needed** via `gh issue create`
- **Guide requirement planning** (RTM entry with issue reference, risk classification, test scope)
- **Enforce commit conventions** (Ref: REQ-XXX, Co-Authored-By tags)
- **Run compliance gates** before pushing (TypeScript, SAST, dependencies, E2E)
- **Compile evidence** after implementation (security summary, release ticket)
- **Block anti-patterns** (pushing to main, skipping hooks, committing secrets)

## Setup

AI agent config files use a **single source of truth** pattern. The sync script generates pointer files that reference `INSTRUCTIONS.md`, where the SDLC rules live as the canonical source.

```bash
# Automatic setup via sync script (recommended)
./scripts/sync-sdlc.sh v1.5.0 ../your-project
```

This generates:
- `.cursorrules` → pointer to `INSTRUCTIONS.md`
- `.windsurfrules` → pointer to `INSTRUCTIONS.md`
- `CLAUDE.md` → preserves project header, adds pointer to `INSTRUCTIONS.md`
- `GEMINI.md` → pointer to `INSTRUCTIONS.md`
- `INSTRUCTIONS.md` → SDLC rules appended/replaced from `INSTRUCTIONS-SDLC.md`

### Manual setup (if not using sync script)

Copy `INSTRUCTIONS-SDLC.md` content into your project's `INSTRUCTIONS.md`, then create pointer files for each agent tool.

## Source Files

| File | Purpose |
|------|---------|
| `INSTRUCTIONS-SDLC.md` | Canonical SDLC rules — synced into consuming project `INSTRUCTIONS.md` |
| `SDLC_RULES.md` | Full SDLC rules with detailed explanations (reference) |
| `claude/CLAUDE.md` | Legacy Claude-specific format (superseded by pointer pattern) |
| `cursor/.cursorrules` | Legacy Cursor format (superseded by pointer pattern) |
| `windsurf/.windsurfrules` | Legacy Windsurf format (superseded by pointer pattern) |

## Prerequisites

Projects using these rules must have:

1. **GitHub CLI (`gh`) installed and authenticated** — used to fetch and create issues:
   ```bash
   gh auth status   # verify you're logged in
   ```
2. **SDLC workflow files copied into the project** as `SDLC/` — the AI rules reference these files for detailed steps, templates, and checklists:
   ```bash
   cp -r path/to/devaudit/sdlc/files/ SDLC/
   ```
3. **Git hooks configured** (Husky + Commitlint + lint-staged) — enforces commit conventions and pre-push gates locally:
   ```bash
   # Install dependencies
   npm install --save-dev husky @commitlint/cli @commitlint/config-conventional lint-staged
   npx husky init

   # Copy hook templates
   cp path/to/devaudit/sdlc/files/hooks/commit-msg .husky/commit-msg
   cp path/to/devaudit/sdlc/files/hooks/pre-commit .husky/pre-commit
   cp path/to/devaudit/sdlc/files/hooks/pre-push .husky/pre-push
   chmod +x .husky/commit-msg .husky/pre-commit .husky/pre-push
   cp path/to/devaudit/sdlc/files/hooks/commitlint.config.mjs commitlint.config.mjs
   ```
4. **Validation scripts** (optional, for CI enforcement):
   ```bash
   cp path/to/devaudit/sdlc/files/scripts/*.sh scripts/
   chmod +x scripts/*.sh
   ```
5. A `compliance/` directory with `RTM.md` (Part B must include the `Issue` column)
6. A `compliance/evidence/` directory
7. A `compliance/pending-releases/` directory
8. A permanent `develop` branch with protected `main`

Use `SDLC/0-project-setup.md` to initialise items 2-8 in a new project.

The AI rules act as guardrails and summaries. The `SDLC/` workflow files contain the full detailed procedures. The AI assistant will read the relevant workflow file at each stage.

## Syncing SDLC Updates to Consuming Projects

When SDLC templates are updated in DevAudit, propagate changes to consuming projects using the sync script:

```bash
# From DevAudit root. Pass one path per active consumer.
./scripts/sync-sdlc.sh v1.1.0 ../wawagardenbar-app
```

Only `wawagardenbar-app` is an active consumer as of 2026-05-19; META-AGENT / META-ATS / META-JOBS onboarding attempts were reverted (see [docs/consuming-projects.md](../../docs/consuming-projects.md)). The sync command accepts multiple consumer paths when more projects come back online.

This:
1. Tags DevAudit as `sdlc-v1.1.0` and pushes the tag
2. Copies SDLC files, hooks, scripts, and CI templates to each project
3. Generates AI agent pointer files (.cursorrules, .windsurfrules, CLAUDE.md, GEMINI.md) referencing `INSTRUCTIONS.md`
4. Appends/replaces the SDLC section in `INSTRUCTIONS.md` from `INSTRUCTIONS-SDLC.md`
5. Updates tag references in consuming project CI workflows
6. Reports what was synced — review the diff before committing

See `scripts/sync-sdlc.sh` for full details.
