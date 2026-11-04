---
description: Release DevAudit — prepare, validate, promote, publish all 6 packages to npm and create the GitHub release, then close out. Follows docs/devaudit-release-procedure.md.
---

Run the DevAudit-Installer release by following [`docs/devaudit-release-procedure.md`](../../docs/devaudit-release-procedure.md). Read it first and execute it phase by phase; it is the only copy of the procedure.

How to use it from here:

- **Start at any phase**, but first check the "done when" of every earlier phase. If one does not hold, stop and report which instead of proceeding.
- **Say which state this repository is in** (onboarded or not, by the test at the top of the procedure) and apply only that state's lines.
- **Ask for explicit confirmation before the tag**: it must name the version **and** the commit SHA. Never pick a minor or major version unilaterally. A version, once on npm, can never be replaced.
- **Never** push a version bump or any change directly to `main`, approve a release yourself, or bump the version to get past a verify timeout (re-run the failed job instead).
- **Stop and report** when the procedure says to stop (a missing prerequisite, a failed gate, an incomplete validation result) rather than working around it.
- Do not attach `results.md` to a public pull request: it names consumers. Report counts.
