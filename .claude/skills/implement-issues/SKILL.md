---
name: implement-issues
description: Implement several GitHub issues in this repo strictly one at a time. Each issue gets its own feature branch cut from the current develop, is implemented, tested, merged into develop by PR with auto-merge, and only then is the next issue started from the new develop, so each builds on the last and nothing is merged together at the end. Use when the user lists two or more issue numbers to implement ("implement #12, #13 and #14", "work through these issues"). Do NOT use for one issue (just do it), for a release, or for work outside DevAudit-Installer.
tags: [operator, workflow, devaudit-installer]
---

# Implement issues, one at a time

Arguments: the issue numbers, in the order the user gave them (for example `/implement-issues 1198 1199 1200`). With no numbers, ask which issues.

## The rule

**One issue is fully merged into `develop` before the next one is started.** Never cut the next branch while a previous PR is open. Waiting for CI is part of the job: it is not idle time to start the next issue. The point is that every branch starts from a `develop` that already contains the previous work, so nothing is rebased or merged together afterwards.

While a PR's CI runs you may only do read-only prep for the next issue (read its body, read the files it names, note what it will touch). Make no edits and cut no branch until the previous PR has merged.

## Before starting

1. `gh issue view <n>` for each issue. If a body is not a concrete spec (no files, no acceptance criteria), say so and ask before building.
2. Propose an order: independent first, and issues that edit the same files adjacent, so later ones build on earlier ones. Show the order and go with the user's order if they gave one.
3. Read `CLAUDE.md` and `memory` rules that apply: branch naming, no consumer names, edit only root `sdlc/files/...`, never a skip-CI tag in a commit message that goes through a PR, `docs/SRS.md` and `cli/CHANGELOG.md` updated in the same PR, every document that describes the behaviour (grep `sdlc/`, `docs/`, `README.md`, `.devin/`).
4. Work in a worktree (`EnterWorktree`) if not already in one.

## For each issue, in order

1. **Cut the branch from the current develop.** `git fetch origin`, then `git checkout -b feature/<issue#>-<slug> origin/develop` (`fix/` for a bug). Confirm `git log --oneline -1` shows the previous PR's merge commit.
2. **Implement** exactly what the issue body specifies. Add or update tests, the SRS entry, the CHANGELOG entry (under `[Unreleased]`), and register any new shell test in `.github/workflows/template-lint.yml`.
3. **Verify locally before pushing.**
   - Shell tests the change touches: `bash sdlc/files/_common/scripts/<name>.test.sh`.
   - From `cli/`: `npx tsc --noEmit`, `npx tsc --noEmit -p tsconfig.test.json`, then the whole suite with `DEVAUDIT_INSTALLER_ROOT=<worktree root> npx vitest run`. The whole suite, not only the new tests: other tests pin literal template text. The run takes about 10 minutes, so run it in the background and wait for the notification. Check the `RUN` line shows the `cli` directory. Expect only the host-credential failures noted in memory.
   - A generated workflow `run:` block must stay under 20,000 bytes (`cli/test/update.test.ts` enforces it). If a template change breaks it, move shell logic into a script under `sdlc/files/_common/scripts/`.
4. **Commit** with explicit paths (`git add <paths>`, never `git add .`), a Conventional Commit message with `Ref: #<n>`, and the co-author trailer from the harness. Write the message to a file and use `git commit -F`.
5. **Push and open the PR into `develop`** with `gh pr create --base develop --body-file <file>`. The body says what changed, any breaking effect for consumers, what is not covered, and how it was tested.
6. **Arm auto-merge:** `gh pr merge <n> --auto --merge`. The repo's `Auto Merge` workflow also merges a green PR into `develop`. Merge commits only, never squash.
7. **Wait for the merge.** Use a background script that polls `gh pr view <n> --json state` and exits when it is no longer `OPEN` (never poll in the foreground, never sleep in a foreground command), then confirm the state is `MERGED`. `gh pr checks --watch` can return on the previous push's results, so judge by the PR state.
   - If a required check fails, fix it on the same branch, push, and wait again. Do not move on, and do not merge around a failure.
   - If auto-merge never happens although checks are green, report it and ask. Do not force it.
8. **Close the issue by hand** with a comment naming the PR: `Closes #N` does not close on a merge into `develop`.
9. Only now go back to step 1 for the next issue.

## Sandbox notes (background and worktree sessions)

- A command that mixes git or gh with a loop variable, `$(...)` or a heredoc can be refused. Write the logic to a file under `$CLAUDE_JOB_DIR/tmp` and run `bash <file>`; keep each git command plain and separate.
- Commit and PR bodies go in files (`git commit -F`, `gh pr create --body-file`). Edit issue bodies with `gh issue edit <n> --body-file`.
- `grep` is `ugrep`: use `grep -F` for literals containing `$` or `?`.
- Never run `npm install` or `npm ci` through a symlinked `node_modules`.
- Do not touch the real `~/.config/devaudit/`.

## What this skill never does

- Never pushes to `main` or `develop` directly, never force-pushes, never merges `develop` into `main`, never tags or releases (that is `/release-devaudit`).
- Never starts the next issue before the previous PR is merged.
- Never names a consuming project in a tracked file (use `example-app` or "a consumer").
- Never edits `cli/sdlc/` (a generated mirror).

## Final report

When all issues are merged, report per issue: the PR number and branch, what changed, anything that deviates from the issue body and why, any breaking effect for consumers, and what is open. Then write the `result:` line.
