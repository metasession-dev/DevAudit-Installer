---
description: Full release pipeline — verify, bump if needed, build, publish all 5 packages to npm, create GitHub release, confirm consumers can install.
---

Run the full DevAudit-Installer release pipeline documented in `.devin/workflows/devaudit-build-release.md`. Read that file first, then execute it step by step in this repo:

1. **Verify prerequisites** — the release-ready commit is already merged to `main`, `Enforce GitFlow` is green on `main`, and there's no outstanding `backmerge/* -> develop` PR waiting. If any of these aren't true, stop and report what's blocking instead of proceeding.
2. **Verify version alignment** across all 5 `package.json` files (`plugin-sdk`, `cli`, `sdlc`, `plugins/devaudit-plugin-prisma`, `plugins/devaudit-plugin-evidence-export`).
3. **Check npm registry state** — if the current version is already published, compute the suggested next patch version and ask the user to confirm the target version before bumping (never pick a minor/major bump unilaterally).
4. **If a bump is needed**, follow this repo's established convention: branch `hotfix/<version>-release-bump` from `main`, bump all 5 `package.json` files (+ run `npm install` in each package to sync `package-lock.json`), commit as `chore: bump all packages to <version> for release`, push, open a `hotfix/* -> main` PR, wait for CI green, then merge. After merging, check whether GitHub Actions auto-opens a `backmerge/* -> develop` PR and merge that too before continuing (this repo's Hotfix Back-Merge automation handles this).
5. **Build all 4 buildable packages locally** (`plugin-sdk`, `cli`, `plugins/devaudit-plugin-prisma`, `plugins/devaudit-plugin-evidence-export`) to catch breakages before tagging.
6. **Verify CLI bundle integrity** (`npm run bundle:templates` in `cli/`, then confirm `sdlc/bin`, blueprints, `upload-evidence.sh`, `sdlc/files`, and skills are all present).
7. **Run the CLI test suite** (`npm test` in `cli/`) — fix any failures before proceeding.
8. **Verify `.github/workflows/release.yml`** has a publish step for all 5 packages including `devaudit-sdlc`.
9. **Cut and push the release tag** (`v<version>`) from `main` — this is the step that actually triggers `release.yml` and publishes to npm. Confirm the target version with the user one more time immediately before this step if it wasn't already confirmed in step 3, since npm publishes are immutable.
10. **Monitor the release workflow run** to completion (`gh run watch`), and if anything fails, check `gh run view --log-failed` and diagnose before retrying.
11. **Post-release verification** — confirm the GitHub release exists and all 5 packages show the expected version on the npm registry.
12. **Verify consumer install works** — `npm install @metasession.co/devaudit-cli@<version>` into a scratch temp dir, then `npx devaudit --version` / `--help`, then clean up.
13. **Report the result**: what shipped, the GitHub release URL, and remind that consumers update via `npx @metasession.co/devaudit-cli update`.

Throughout: never push a version bump directly to `main` — always through the PR flow described in the workflow doc's "Branch policy for release bumps" section. Never skip the local build/test/bundle-integrity checks to save time — they exist because the release workflow fails at the same steps, just later and more expensively (after tagging).
