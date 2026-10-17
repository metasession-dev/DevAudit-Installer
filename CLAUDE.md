# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository. `sdlc/CLAUDE.md` adds rules that apply only to work under `sdlc/`; `sdlc/ai-rules/claude/CLAUDE.md` is a template shipped to consumers, not guidance for this repo.

## Sources of truth for current behaviour

- `docs/issues/` and `docs/articles/` are **historical design records**. They describe what was proposed at the time and are often superseded. Never cite them as current behaviour. A superseded one carries a banner at the top; absence of a banner does not make it current.
- Current behaviour lives in the code and templates:
  - `sdlc/files/ci/*.yml.template` (generated workflows) and `sdlc/files/_common/scripts/` (synced scripts)
  - `cli/src/` (the `devaudit` CLI)
  - for portal behaviour, the `metasession-dev/devaudit` repo
- Before explaining or changing CI, release or housekeeping behaviour, read those sources and cite `file:line`. Do not answer from the docs, the SRS or memory alone.
- A change to behaviour must list every document that describes it (grep `sdlc/`, `docs/`, `README.md`, `.devin/`) and update them in the same PR, including `docs/SRS.md` and `cli/CHANGELOG.md`.

## Editing rules

- Edit only root `sdlc/files/...`. `cli/sdlc/` is a gitignored generated mirror.
- Never put a skip-CI tag (`[skip ci]` and its variants) in a commit message that goes through a PR, even quoted in an explanation: GitHub matches the substring anywhere and then runs no workflows, so a required check is never created and the PR stays BLOCKED (#1020).
- Generated workflow `run:` blocks must stay under GitHub's 21,000-character limit (`cli/test/update.test.ts` enforces 20,000 bytes). Put long shell logic in a script under `sdlc/files/_common/scripts/` instead of the workflow.

## Branching

GitFlow: `feature/<issue#>-<slug>`, `fix/<issue#>-<slug>` and `hotfix/...` branches go to `develop` by PR; `develop` goes to `main` by PR. Never commit directly to `main` or `develop`. Merge commits, not squash. "Closes #N" does not auto-close on a merge into `develop`; close issues manually.
