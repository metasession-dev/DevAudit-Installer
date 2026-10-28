# Releasing DevAudit

The one canonical procedure for publishing a DevAudit-Installer release: the five npm packages and the GitHub release. It is tool-neutral. [`/release-devaudit`](../.claude/commands/release-devaudit.md) and the Devin workflow are short wrappers that point here; follow this page whichever tool you use.

It is **not** [`docs/release-playbooks/`](./release-playbooks/README.md), which is for releases of a *consumer* project. It is also not the validation method: [`docs/release-validation-plan.md`](./release-validation-plan.md) says what the gate checks and its pass rule; this page says when to run it.

Fixes are batched into one validated release so consumers update once. Nothing in a release is optional because it is slow: the checks below exist because each one caught, or would have caught, a real failure in 1.9.0 or 1.10.0.

## The five packages

`@metasession.co/devaudit-plugin-sdk` (`plugin-sdk/`), `@metasession.co/devaudit-cli` (`cli/`), `@metasession.co/devaudit-sdlc` (`sdlc/`), `@metasession.co/devaudit-plugin-prisma` (`plugins/devaudit-plugin-prisma/`), `@metasession.co/devaudit-plugin-evidence-export` (`plugins/devaudit-plugin-evidence-export/`). They always share one version.

## Prerequisites (checked once)

- Each of the five packages has an npm **Trusted Publisher** (npmjs.org, package settings, Publishing access, GitHub Actions) pointing at this repository and `release.yml`. Publishing uses OIDC; no `NPM_TOKEN` exists or is needed.
- You can push tags.
- The `INSTALLER_DISPATCH_TOKEN` repository secret is set (devaudit-installer#613). Without it the back-merge automation's pull request sits at `action_required` until each pending run is approved by hand.
- `jq`, `gh` (authenticated), `node` >= 22, `python3` with PyYAML.

## Which state is this repository in?

The repository counts as **onboarded** when `.devaudit/sync-manifest.json` exists (written by `devaudit install` / `update`) **and** `.github/workflows/check-release-approval.yml` exists. Otherwise it is **not onboarded**. Every phase below has a "Not onboarded" line and an "Onboarded" line; apply the one that matches. Until onboarding, only the "Not onboarded" lines apply. Never do a step twice: where the generated workflows own a step in the onboarded state, the procedure waits for them instead.

## The phases

| # | Phase | Done when |
| --- | --- | --- |
| 1 | Prepare | the release PR (`chore/<issue#>-release-<version>`) is merged into `develop`; the five packages share the version; `[Unreleased]` in `cli/CHANGELOG.md` is empty |
| 2 | Validate | `scripts/release-validation.sh` passed on the final `develop` commit with consumer and layer-2b rows present; the counts are recorded |
| 3 | Promote | the `develop` to `main` pull request is merged with a merge commit |
| 4 | Publish | the annotated tag is pushed, `release.yml` is green (or resumed to green), and all five packages and the GitHub release are verified independently |
| 5 | Close out | `develop` has the back-merge, tracking issues are closed, consumers are told |

You may start at any phase after checking the earlier phases' "done when". If one does not hold, stop and report which, instead of proceeding. The tag step always asks for explicit confirmation of the version (npm publishes are immutable).

## Phase 1: Prepare

1. **Branch** `chore/<issue#>-release-<version>` from `develop`.
2. **Check the registry.** If the version in `cli/package.json` is already on npm, a bump is required. Suggest the next patch and ask the maintainer to confirm the target version; never choose a minor or major bump unilaterally.
   ```bash
   CURRENT=$(jq -r .version cli/package.json)
   npm view @metasession.co/devaudit-cli version 2>/dev/null || echo NOT_PUBLISHED
   ```
3. **Bump** every package with `npm version`, which also updates each lockfile's own version fields (a 4-line diff per package):
   ```bash
   VERSION=1.11.0   # the confirmed target
   for d in plugin-sdk cli sdlc plugins/devaudit-plugin-prisma plugins/devaudit-plugin-evidence-export; do
     (cd "$d" && npm version "$VERSION" --no-git-tag-version)
   done
   git diff --stat   # expect only package.json and package-lock.json version lines
   ```
   Do not hand-edit with `jq`, and do not run `npm install` in each package: it rewrites the lockfiles (`cli/package-lock.json` drifts).
4. **Date the changelog.** Rename `## [Unreleased]` to `## [<version>] — YYYY-MM-DD` and leave an empty `## [Unreleased]` above it. The dated section must carry an Upgrade note for anything that changes a consumer's sync diff (for example a script they now receive for the first time), and every behaviour change must have its `docs/SRS.md` and `docs/` entry.
5. **Open the pull request** into `develop` (`chore: release <version> (#<issue>)`) and merge it once CI is green.

- **Not onboarded:** as above. The `hotfix/* -> main` route is only for a release-only fix that must ship from `main` after the merge (see *Hotfix from `main`* below).
- **Onboarded:** also create the declared-bundle manifest `compliance/pending-releases/BUNDLED-CHANGES-REQ-XXX.md` with a "Co-Tracked Bundle Members" section (#736), so the whole npm version maps to **one** release (releases are keyed by REQ id; `derive-release-version.sh`, priority 0). The lead REQ is the release's tracking requirement and the promotion pull request title carries `[REQ-XXX]`.

## Phase 2: Validate

Run the gate on the **final** `develop` commit, after the bump, so the version row means something:

```bash
scripts/release-validation.sh all
```

- **Cost:** about 20 minutes. Layer 1 runs first; a layer-1 failure does **not** stop the run (the consumer layers still run and everything is reported), but the result fails.
- **From a linked worktree** the consumer list is invisible: `scripts/release-validation/consumers.local` is gitignored and exists only in the main checkout. Set `RV_CONSUMERS_FILE=<main checkout>/scripts/release-validation/consumers.local`. `all` with no names and no consumers file **fails** unless you pass `--no-consumers`, and a result without consumer and layer-2b clone rows is incomplete: do not treat it as a pass.
- **Read the output.** The full vitest output is `$WORK_DIR/vitest.log`, each failing shell test's output is in `$WORK_DIR/shell-tests/`, and `results.md` lists the failing test names.
- **Classify each FAIL** as installer-owned or consumer-owned: check whether the template involved changed since the last tag. Consumer-owned stale files that `update` keeps as conflicts (`*.devaudit-new`) are not installer defects. Re-clone before concluding on a deferral-gate FAIL: a snapshot goes stale when the consumer closes out in the meantime.
- **`results.md` names consumers.** Never attach it to the public pull request. Report counts only (PASS / WARN / FAIL per layer, number of consumers) and a disposition for each WARN.
- Rerun after any fix merged in response to a finding. What the gate checks, and its pass rule, are in [`release-validation-plan.md`](./release-validation-plan.md); do not copy that content here.

**How much to run:**

| Release type | Validation required |
| --- | --- |
| Minor or major | `all` (every consumer, fixtures, 2b) + the Phase 4 checks |
| Patch from `develop` | `all` + the Phase 4 checks (consumers update either way) |
| Docs-only | `layer1` + the Phase 4 checks |
| Hotfix from `main` | `layer1`, `layer2b` and at least one consumer, with the reason recorded on the pull request, + the Phase 4 checks |

**Required** (only this procedure provides it): release validation including consumers. **Advisory only:** `Test (windows-latest)` (see Phase 3), and a manual pass against a live deployment, needed only when the release changes a contract with a deployed counterpart (`contracts/evidence-types.json`, close-out or deferral behaviour).

**Do not re-run CI locally.** There is no local "build all packages" or `npm test` step in this procedure: CI already runs them. The check that tests the tagged commit itself is in Phase 4 (every run on the `push` to `main` for the exact SHA is green).

- **Not onboarded:** as above.
- **Onboarded:** unchanged. The consumer-clone gate is the validation plan's layer 2.

## Phase 3: Promote

1. **Dependency and security step.** List open Dependabot alerts and classify each as runtime or dev from the five packages' `dependencies`; run `npm audit --omit=dev` in each package. Decide on any open Dependabot pull request that targets `main` **before** tagging: a security-update pull request always targets the default branch, so it needs retargeting to `develop` or a fix pull request into `develop`.
2. **Open `develop` to `main` as a draft** (`Release <version>`). Mark it ready (`gh pr ready <n>`) only when the validation counts (Phase 2) are in the body.
3. **CI policy on the release pull request.** Required: `CLI CI` on Ubuntu and macOS, `Template Lint`, the consumer-names check, `Enforce GitFlow`, and `Package contents`. `Test (windows-latest)` is **not** a required check and can flake (#1089): rerun it once, record that you did, and never let it block alone; any failure that is not a timeout still blocks. Branch protection on `main` cannot be read with a normal token, so the maintainer confirms which checks are required before the first release of the day.
4. **Merge with a merge commit** (never squash or rebase) once the required checks are green on the current head.

- **Not onboarded:** as above.
- **Onboarded:** after the validation counts are in the pull request, submit the release for review in the portal and **wait** for `check-release-approval.yml` to pass on the promotion pull request. Approval is by a second named admin on the audit instance; the submitter cannot approve (non-low risk). This procedure never approves, never retries the gate in a loop, and reports the release's portal link and state while it waits.

## Phase 4: Publish

1. **Confirm the version** with the maintainer.
2. **Check the tagged commit itself.** Every workflow run on the `push` to `main` for the exact SHA you will tag must be green (Windows excepted per Phase 3):
   ```bash
   git fetch origin --tags
   SHA=$(git rev-parse origin/main)
   gh run list --commit "$SHA" --json name,status,conclusion
   ```
3. **Tag an explicit SHA with an annotated tag.** Show the SHA and the commit, confirm it is the merged and validated release commit, and require a confirmation that names **both the version and the SHA** before pushing:
   ```bash
   VERSION=$(jq -r .version cli/package.json)
   git log -1 --format='%H %s' "$SHA"
   git rev-parse "v$VERSION" >/dev/null 2>&1 && { echo "tag exists locally"; exit 1; } || true
   git ls-remote --tags origin "refs/tags/v$VERSION" | grep -q . && { echo "tag exists on origin"; exit 1; } || true
   git tag -a "v$VERSION" -m "Release $VERSION" "$SHA"
   git push origin "v$VERSION"
   ```
4. **Watch `release.yml`:** `gh run watch "$(gh run list --workflow Release --event push --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status`.
5. **Verify independently of a green run.** A red first run can still have published four of five packages (it did for 1.10.0), and a green run is not proof:
   ```bash
   for pkg in plugin-sdk cli sdlc plugin-prisma plugin-evidence-export; do
     npm view "@metasession.co/devaudit-$pkg@$VERSION" version
   done
   gh release view "v$VERSION"
   ```
   Then a clean install of the published CLI into a temporary directory, deleted afterwards: `npx @metasession.co/devaudit-cli@$VERSION --version` and `--help`.
6. **On a verify timeout** (`Verify ... is publicly installable` failed): npm can show a version's metadata minutes before its tarball URL answers, and `release.yml` waits up to 10 minutes per package. Check the tarball URL (`npm view <pkg>@<version> dist.tarball`), then **re-run the failed job** (`gh run rerun <run-id> --failed`). The workflow is resumable: each publish step checks `npm view` and skips a package that is already published, so the re-run finishes the release without republishing. **Never bump the version** to get past a verify timeout.

Common failures: a 403 or 404 on `npm publish` means the package's Trusted Publisher is missing or does not match this repository and workflow file exactly, or the runner's npm is older than 11.5.1; a 409 means the version already exists (npm versions are immutable: fix forward with a new patch version); a `tsup` or `bundle-templates` failure is a build problem the pull request's CI should have caught.

- **Not onboarded:** as above.
- **Onboarded:** tagging and `release.yml` are unchanged. The post-publish checks (step 5) become the npm-package host adapter's production smoke (planned in [`devaudit-on-devaudit-onboarding.md`](./devaudit-on-devaudit-onboarding.md) Phase 2): **one** implementation, shared by both states, not a second copy. Until that adapter exists, run step 5 as written.

## Phase 5: Close out

1. **Close the tracking issues by hand.** `Closes #N` does not fire on a merge into `develop`.
2. **Workflow fixes that live on `main` only** take effect after the release (for example the auto-merge verifier, #1065): confirm auto-merge works on the next pull request.
3. **Tell consumers:** they update with `npx @metasession.co/devaudit-cli update`. Note which consumers will see `.devaudit-new` conflicts (from the validation run's WARNs) in the release notes.

- **Not onboarded:** open the back-merge **by hand**; no pull request is opened automatically after a normal `develop` to `main` release (the Hotfix Back-Merge workflow runs and opens nothing). From `main` into `develop`:
  ```bash
  git fetch origin
  git checkout -b "backmerge/$VERSION" origin/main
  git push -u origin "backmerge/$VERSION"
  gh pr create --base develop --head "backmerge/$VERSION" --title "chore: back-merge v$VERSION into develop"
  ```
  Merge it with a merge commit.
- **Onboarded:** a person clicks **Mark as Released** in the portal; `close-out-release.yml` then opens the pull request that merges `main` back into `develop` and reconciles the release ticket and RTM. **Do not open a manual `backmerge/<version>` pull request** in this state: it would duplicate that one. Wait for the close-out pull request and report it. Closing issues by hand and telling consumers stay.

## Hotfix from `main`

Only when a release-only fix must ship from `main` after the merge: branch `hotfix/<issue#>-<slug>` from `main`, open a reviewed `hotfix/* -> main` pull request, merge it, then merge the `backmerge/* -> develop` pull request the automation opens before the next `develop` to `main` release. Validation is the "Hotfix from `main`" row above.

## First onboarded release: prerequisites

Before Phase 3 of the first release in the onboarded state, check and stop with a clear message if any is missing:

- two named human admins exist on the audit instance (the onboarding document still lists the first approver's identity as unconfirmed);
- `auto-merge.yml` is restricted to housekeeping and dependency pull requests ([`devaudit-on-devaudit-onboarding.md`](./devaudit-on-devaudit-onboarding.md) Phase 0), so it cannot merge the promotion pull request past the approval gate;
- this repository's generated workflows were synced from the **previous** published CLI (the N-1 bootstrap, onboarding document section 3, loop 1), so the release pull request is gated by the last release's gates. This procedure never runs `update` from the working tree on this repository.

## Tooling notes

- `gh pr edit` fails on this repository with a deprecated "Projects (classic)" GraphQL error. Update a pull request body with `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@file`. `gh pr create` and `gh pr ready` work.
- Plugin packages have no `node_modules` in a fresh worktree: link them from the main checkout for local builds, and remove the links afterwards.
- Restore `cli/package-lock.json` (and the other lockfiles) after any build or test run; `release-validation.sh layer1` does it for you and says so.
- Windows: `Test (windows-latest)` shows `UNSTABLE` on a pull request into `develop` and showed `BLOCKED` on the promotion pull request while it was red. See Phase 3 for when a red Windows job may be accepted.

## Common failure modes

- **`@metasession.co/devaudit-sdlc` stale on npm:** check that its publish step in `release.yml` ran.
- **CLI tarball missing `sdlc/`:** `bundle-templates.mjs` did not run (`prepack` is `npm run build && npm run bundle:templates`). `scripts/check-package-contents.sh` catches this before the tag.
- **Consumer gets an `npx` prompt:** `SDLC/bin/devaudit-sdlc.cjs` does not exist locally. The consumer needs `devaudit update` to sync section 2h.
- **Version mismatch:** one `package.json` was not bumped. `release.yml` publishes whatever version each file declares.
- **`file:../plugin-sdk` in a published tarball:** `release.yml` rewrites it to the published version at publish time; if that rewrite fails, the published CLI cannot resolve the SDK.
