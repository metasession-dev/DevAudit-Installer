---
description: Release DevAudit — prepare, validate, promote, publish all 5 packages to npm and create the GitHub release, then close out. Follows docs/devaudit-release-procedure.md.
---

# Release DevAudit

The procedure lives in one place: [`docs/devaudit-release-procedure.md`](../../docs/devaudit-release-procedure.md). Read it and follow it phase by phase; this workflow adds nothing to it.

For this tool:

- Start at any phase after checking the earlier phases' "done when". If one does not hold, stop and report which.
- The read-only commands in the procedure are safe to run without asking (`npm view`, `gh run list`, `gh release view`, `git log`, `git fetch`). **Ask before** anything that changes state outside the working tree: pushing a branch or tag, merging, `gh pr ready`, re-running a workflow.
- The tag step requires an explicit confirmation naming the version and the commit SHA. Never bump the version to get past a verify timeout.
