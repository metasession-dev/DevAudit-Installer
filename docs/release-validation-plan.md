# Release validation plan

How a DevAudit-Installer release candidate is validated **before** the
`develop -> main` release PR merges and the version is tagged. Fixes are
batched into one validated release so consumers update once; a release that
breaks a consumer's sync or CI costs every project a second update. This gate
exists to catch that here.

The method was first run by hand for #932 (pre-release validation gate) and is
described in #917 §5. #941 tracks the mocked-portal lifecycle smoke test. This
document makes the method repeatable, and
[`scripts/release-validation.sh`](../scripts/release-validation.sh) automates
it.

## When to run it

- On the release candidate: `develop` at the commit you intend to promote,
  with every PR for the release merged.
- Again after any fix merged in response to a finding.
- Not needed for a docs-only release, but run layer 1 anyway.

## Who runs it and where

A maintainer runs it locally (or in a cloud session) from a checkout of the
candidate. It needs `node` >= 22, `git`, `jq`, `python3` with PyYAML, and
read access to every consumer repository on GitHub. Cloud sessions can only
clone repositories the Claude GitHub app can reach; run the remaining
consumers locally.

## Safety rules (consumer repositories are read-only)

The gate never writes to a consumer repository or to the portal:

1. **Isolated clones only.** Each consumer is cloned fresh into a scratch
   directory. The real working copies (for example `/srv/ostendo/projects/<name>`)
   are never touched.
2. **No push.** The clone's push URL is set to an invalid value.
3. **No GitHub writes.** `devaudit update` talks to GitHub through `gh`. It reads repo
   metadata (`verifyDefaultBranch` reads the default branch), and it can write:
   `gh label create` for the issue-template labels (#970) and
   `gh repo edit --default-branch` when the default branch is not
   `integration_branch`. The script puts a stub `gh` first on `PATH` for every
   command it runs in a clone. The stub passes **read-only** calls (`repo view`,
   `label list`, `api` without a method or fields, ...) to the real `gh` and
   **refuses** everything else. Each refused write is listed under
   `gh-writes-blocked`: that is what `update` *would* have changed on the real
   repository, so read it.
4. **No portal access.** `DEVAUDIT_USER_TOKEN`, `DEVAUDIT_API_KEY`,
   `DEVAUDIT_VIEWER_API_KEY`, `GH_TOKEN` and `GITHUB_TOKEN` are unset for those
   commands. Doctor's portal checks report `skipped`.
5. **Local commits stay local.** The idempotency and deferral checks commit
   inside the throwaway clone and reset afterwards.
6. **Never** run `devaudit install`, `join` or `push` against a consumer, and never
   use production credentials.

## Layer 1: installer automated checks

`scripts/release-validation.sh layer1` runs these checks on the candidate checkout:

| Check | What | Blocks the release |
| --- | --- | --- |
| `typecheck` | `cli` `tsc --noEmit` | yes |
| `versions-aligned` | all 5 packages share one version | no (WARN before the bump) |
| `vitest` | full `cli` vitest suite | yes |
| `shell-tests` | every `sdlc/files/_common/scripts/*.test.sh` and `scripts/*.test.sh` | yes |
| `no-skip-ci-guidance` | no operator-facing guidance (`cli/src`, `sdlc/`, `docs/` outside `issues/` and `articles/`, `README.md`) recommends a skip-CI tag on a commit that goes through a PR: GitHub then runs no workflows, the required `Quality Gates` check is never created and the PR stays BLOCKED (#1020) | yes |
| `mock-portal-lifecycle` | `tests/release-pipeline-e2e/run.sh` against `mock-portal.mjs` | yes |
| `pack-install` | `npm pack` the CLI, install the tarball into an empty prefix, `devaudit --version` matches | yes |

Layer 1 has no tolerated failures: every check must pass. (`cli` tests that spawn `dist/` rebuild it first when `src/` is newer, so a stale local build cannot fail them.)

## Layer 2: consumer clone gate

`scripts/release-validation.sh consumer <name>...` validates each consumer
against the candidate CLI (`node cli/dist/index.js`, with
`DEVAUDIT_INSTALLER_ROOT` pointing at the candidate):

| Check | Pass criterion | Blocks |
| --- | --- | --- |
| `clone` | clone of `develop` (else the default branch) with an `sdlc-config.json`; push disabled | yes |
| `update` | `devaudit update .` exits 0 | yes |
| | local-modification conflicts (`*.devaudit-new`) listed | WARN: give each consumer a disposition per [sync-conflict-review.md § For installer maintainers](sync-conflict-review.md#for-installer-maintainers). A conflict on a file the release changed means the consumer must resolve it at update time, so note it in the release notes |
| `gh-writes-blocked` | every `gh` write was refused; the list shows what `update` would have written to GitHub, including writes from the manifest bootstrap's baseline run (there should be none since #990) | informational: a `repo edit` entry means the consumer's default branch is not its `integration_branch`; an `api -X PUT …/protection` entry means the branch had no protection and `update` would apply the defaults |
| `update-idempotent` | after committing the first sync locally, a second `update` changes nothing | yes |
| `synced-scripts` | the deferral and provenance scripts are present and executable | yes |
| `workflows-parse` | every `.github/workflows/*.yml` parses as YAML, has no unrendered `{{TOKEN}}`, and every bash `run:` passes `bash -n` | yes |
| `doctor-json` | `doctor --json` exits 0 or 6 and carries `ok`, `tools`, `releaseCloseoutDrift`, `onboarding`, `deferral`, `proposals` | yes |
| `doctor-fix-dry-run` | `doctor --fix --dry-run` changes nothing | yes |
| `derive-release-version` | runs on the real history and prints a version | yes |
| `deferral-gate-real` | `check-deferred-reqs-in-range.sh` passes on the real `origin/<release_branch>..HEAD` | yes |
| `close-out-reconcile` | runs on the real `pending-releases/` | yes; the stale list is informational |

**Deferral scenario** (local commits on the clone only, reset afterwards): a
deferred ticket `REQ-9901` with a tagged commit, an untagged follow-up commit,
and a successor ticket `REQ-9902`:

| Check | Pass criterion |
| --- | --- |
| `scenario-is-deferred` | `is-deferred-ticket.sh` recognises the deferred ticket and not the other |
| `scenario-derive-skips` | `derive-release-version.sh` (pending-ticket fallback on) never derives `REQ-9901` |
| `scenario-gate-blocks` | the promotion gate fails while `REQ-9901` ships unlisted |
| `scenario-gate-allows` | the gate passes once `REQ-9902` lists `REQ-9901` under `Absorbed predecessor releases` |
| `scenario-reconcile` | `close-out-reconcile.sh` does not report the deferred ticket as a missed close-out |

## Layer 2b: change-driven checks

Layer 2 proves `update` is safe and idempotent on every consumer, but it runs
the same generic checks whatever the release changed. Layer 2b asks the
question a release actually needs answered: **were the things that changed
exercised, and do they work after the update is applied?** It does not run on
every consumer; two representative clones (`RV_2B_CONSUMERS`, default
wawagardenbar-app for node and ThorStack-Backend for python) are enough to
exercise a change.

`scripts/release-validation.sh layer2b` (also the last step of `all`):

1. **What changed.** `git diff` from the last release tag (`RV_BASE_REF`
   overrides it) to the candidate, mapped to *surfaces* by
   [`scripts/release-validation/surfaces.tsv`](../scripts/release-validation/surfaces.tsv)
   (path regex per surface). Docs, tests, plugins and other non-shipping paths
   are ignored. A changed shipped path that matches no surface is a `WARN`
   (`2b-coverage:unclassified`): add it to `surfaces.tsv`.
2. **Coverage.** Each changed surface needs a scenario function in
   `scripts/release-validation/layer2b.sh` (`scenario_<surface>`). A changed
   surface with no scenario is a `WARN` (`2b-coverage:<surface>`): a change
   nobody exercised. `release-validation.test.sh` fails if `surfaces.tsv`
   lists a surface with no scenario, so a new surface cannot be added
   unexercised.
3. **Apply and exercise.** Each clone gets the update (the same two-run
   idempotency check as layer 2), then the scenario for every changed surface:

| Surface | Scenario on the updated clone |
| --- | --- |
| `approval-gate` | the **clone's own** `check-release-approval*.yml` and `derive-release-version.sh` run against a mock portal (`release-approval-gate-behavior.test.ts` with `GATE_WORKFLOW_FILE`/`GATE_DERIVE_SCRIPT`): blocks every pre-approval state and `deferred`, passes the approved ones |
| `ci-workflows` | how many workflows the update changed; all of them are parsed, token-checked and `bash -n` checked. Also `housekeeping-skip` (#1020): the workflows that derive a release version opt into the integration-housekeeping rule, and the clone's synced `derive-release-version.sh` prints no release for an untagged commit but keeps the bare-date version once a standalone declaration exists |
| `sync-safety` | edit a synced script locally, commit, run `update` twice: the edit must survive and the upstream copy must be in `.devaudit-new` (#988) |
| `branch-protection` | section 2k reports no unexpected failure, and the manifest baseline run made no `gh` call (#990) |
| `deferral` | the deferral scenario (ticket, gate, derive, reconcile) on the real history |
| `doctor` | `doctor --json` contract and `doctor --fix --dry-run` changes nothing |
| `scripts` | every changed synced script parses |
| `skills-docs` | skills are present with frontmatter |
| `cli-core` | the files the update changed in the clone, grouped by area (workflows, scripts, skills, SDLC docs, hooks) |

Adding a scenario for a new kind of change is the job of the PR that makes the
change: add the surface to `surfaces.tsv` and a `scenario_<surface>` function.

### Consumers

The consumer list is the active set in [consuming-projects.md](consuming-projects.md):

| Consumer | Stack | Notes |
| --- | --- | --- |
| wawagardenbar-app | node | |
| META-ATS | node | the Claude GitHub app has no access; run locally |
| META-JOBS | node | |
| ThorStack-Frontend | node | |
| ThorStack-Backend | python | |
| thorstack-site | node | |
| fleet-control | python | uses the deprecated polyglot `targets` mechanic |

META-TALENT has a local checkout but `metasession-dev/META-TALENT` no longer resolves on GitHub (2026-10-12), so it is not in the list.

### Fresh-onboard fixtures

`scripts/release-validation.sh fixture node python` builds two blank repositories with a
minimal `sdlc-config.json` and the directories `install` creates, then runs
the same checks. They catch first-sync problems that an already-onboarded
consumer hides, for example manifest churn or a config key that `install`
always writes but `update` assumes. `install` itself needs the portal. Its
portal steps are covered by the CLI unit tests, not by this gate.

## Layer 3: mocked-portal lifecycle smoke

`tests/release-pipeline-e2e/run.sh` (run in layer 1 and by `template-lint.yml`
in CI) drives the release scripts against `mock-portal.mjs`: release
derivation, test-execution reporting and close-out.

**Release Approval Gate (#941, covered).** `cli/test/release-approval-gate-behavior.test.ts` renders the real `check-release-approval.yml` and runs its `Resolve DevAudit base URL`, `Resolve current release` and `Enforce release approval` steps with bash and curl against an in-process mock portal. It checks that the gate blocks `draft`, `uat_review`, `uat_rejected`, `uat_changes_requested`, `prod_rejected` and `deferred` (with the deferral message), passes `uat_approved`, `prod_review`, `prod_approved` and `released`, resolves the release the derive script names, passes in bootstrap mode (no key, or project not created yet), fails closed when the project endpoint 404s but `releases/resolve` says it exists, and fails on an invalid key. It runs with the rest of vitest in layer 1, on all three OSes. The mock only answers what the portal would; it never creates an approval. Verified by breaking the gate twice (accepting `draft`, removing the `deferred` branch): the test failed each time.

**Still not covered (#941):** the generated `close-out-release.yml` workflow's GitHub steps (opening the merge-back PR, `repository_dispatch` handling), which need a GitHub API mock rather than a portal mock; and the portal side of the deferral lifecycle (defer, resume, supersede at the successor's close-out), which is covered by the portal's own test suite (`release-service-ci.test.ts`, `approval-service-defer.test.ts`). `scripts/close-out-release.sh` itself (ticket and RTM reconciliation, predecessor handling) is covered by `tests/release-pipeline-e2e/run.sh` and its shell tests. After the portal deploys, do one manual pass on a test project.

## Running it

```bash
# everything (layer 1, every consumer, both fixtures, layer 2b)
scripts/release-validation.sh all wawagardenbar-app META-ATS META-JOBS \
  ThorStack-Frontend ThorStack-Backend thorstack-site fleet-control

# one part
scripts/release-validation.sh layer1
scripts/release-validation.sh layer2b          # change-driven, two clones
scripts/release-validation.sh consumer wawagardenbar-app
WORK_DIR=/tmp/rv scripts/release-validation.sh fixture node python
```

The script builds the candidate with the same installs as CI (`npm ci` for `plugin-sdk`, `npm install --legacy-peer-deps` for `cli`; `npm ci` rejects `cli`'s lockfile, #996) and `SKIP_BUILD=1` reuses `cli/dist`, keeps
`WORK_DIR` for inspection (clones, update logs, `gh-stub.log`), and writes
`$WORK_DIR/results.md`. It exits 1 if any check failed.

## Recording the result

Paste `results.md` on the release PR (or the release umbrella issue) with:

- the candidate commit and version;
- every `FAIL` with its linked fix or issue, and every `WARN` with a one-line
  disposition;
- any consumer you could not run, and why.

A release is ready when no check fails. A `WARN` needs a written
disposition, not a fix.

## Blocking vs advisory

- **Blocks the release:** any `FAIL` in layers 1–2, a consumer that cannot
  run `update`, or a second `update` that changes files.
- **Advisory:** `WARN` (conflicts, version not yet bumped), a stale list from
  `close-out-reconcile`, `doctor` exit 6 (a tool such as `gh` missing on the
  validation host).
