# Changelog

All notable changes to `@metasession.co/devaudit-cli` are documented here. The CLI follows semver.

## [Unreleased]

### Upgrade notes

- **Release gate** (#1059): nothing changes unless you set `release_gate_tier`, `post_deploy_full_regression` or `scheduled_full_regression`. Setting `release_gate_tier` also sends it to the portal and reports an `e2e-release-gate` check, so **deploy the portal first**. `compliance-evidence.yml` gains the tier handling and the scheduled-run skip in every project; `check-release-approval.yml` now triggers on your configured release branch instead of a hardcoded `main` (same for `main`).
- **`test_runner: pytest`** (#1060) replaces the generated `feature-e2e.yml` and `e2e-regression.yml` with pytest versions (JUnit XML as the `e2e_result`); nothing changes unless you set it. Register the `smoke` and `critical` markers in `pyproject.toml` before opting in.
- **Postgres consumers:** if `database_env`, `build_env`, `app_env` or `e2e_env` holds a `*_URL` / `*_URI` pointing at `localhost` or `127.0.0.1`, the generated workflows now publish the postgres container on a random host port and export the mapped URL (#1054). The port inside your configured URL is no longer used. Configs without such a key regenerate unchanged.
- **`e2e-regression.yml`** (when enabled) gains the database-URI, kill-stale-server and self-hosted cleanup steps; expect a diff in the first sync PR.

### Added

- **`devaudit doctor` reviews the E2E release gate and the test tiers** (#1059, #1060) — two read-only, non-gating checks, `e2e-release-gate` (gate coherent with `e2e_regression_enabled`, a runnable full tier, recent run times against the job timeout, schedule activity, a recommendation) and `test-tiers` (each declared tier resolves to tests, found by collecting rather than running; requirement tags; a smoke tier exists). Findings are tier C guidance naming the `devaudit configure` command and are never applied by `--fix`. They appear at the end of `onboarding` in `doctor --json`. The `e2e-regression` check no longer asks for `playwright.config.ts` when `test_runner` is `pytest`.
- **Configurable E2E release gate** (#1059 Phase A) — new keys `release_gate_tier` (`none`, `smoke`, `critical`, `full`), `post_deploy_full_regression` and `scheduled_full_regression` choose which tier runs on the PR into the release branch, whether the full regression also runs after the production deploy, and an optional nightly full run on the integration branch. The executed tier is recorded and labelled (`E2E Smoke|Critical|Full (pre-merge)`), a configured gate is sent to the portal as `releaseGateTier` and reported as an `e2e-release-gate` check, and scheduled runs are never uploaded to the portal (a failure opens one `bug` issue). Without the keys the generated workflows are unchanged. See `docs/e2e-test-tiers.md`.
- **pytest tier workflows** (#1060 Phase B) — with `test_runner: pytest`, `devaudit update` generates a pytest `feature-e2e.yml` and `e2e-regression.yml` that run the tiers through `scripts/run-test-tier.sh`, keeping the `E2E Regression` workflow, job and artifact names and the portal check labels. `compliance-evidence.yml` uploads the JUnit XML as the `e2e_result` for these projects.
- **Test tier commands for any runner** (#1060) — new `sdlc-config.json` keys `test_tier_smoke`, `test_tier_critical`, `test_tier_full`, `test_feature_command` (with a `{REQ}` placeholder) and `test_runner` (`playwright` default, `pytest`), settable with `devaudit configure set`, and a synced `scripts/run-test-tier.sh` that runs the configured command or the runner default. Nothing changes until a key is set: the generated workflows keep their inline Playwright commands. See `docs/e2e-test-tiers.md`.

### Fixed

- **`feature-e2e.yml` no longer demands a screenshot for a REQ covered only by transport-layer specs** (#1067) — when no `evidenceShot` screenshots exist and every spec tagged with the REQ avoids Playwright's `page` fixture (webhook, API, socket and database specs), the upload step logs a notice instead of failing; the evidence is the JSON report and `test-execution-summary.md`. A REQ with any `page`-using spec keeps the requirement. New synced script `scripts/is-transport-layer-req.sh`.
- **`feature-e2e.yml` now triggers on the configured `integration_branch`** (#1060) instead of a hardcoded `develop`. Projects on `develop` are unchanged.
- **Self-hosted E2E jobs no longer inherit state from earlier jobs** (#1054) — `e2e-regression.yml` now has the "Kill stale dev server" step and, for MongoDB, the dynamic-port database URI step that `ci.yml` and `feature-e2e.yml` already had (its `localhost:27017` URI could reach another job's database). The self-hosted "Clean stale .next build output" step is now "Clean stale build and test output", also removes the previous run's result files and server log, and is present in all three E2E workflows. A postgres service gets a random host port when a local URL key is configured, so concurrent jobs cannot collide. Checkout stays `clean: false`.

## [1.9.0] — 2026-10-18

### Upgrade notes

Read these before running `devaudit update` on a project.

- **Deploy the portal first.** This release uploads two new evidence types, `accepted_e2e_failure` and `accepted_dependency_risk` (#1016, #1017), and relies on the portal's triage and release-page changes (metasession-dev/devaudit#902–#906). A consumer that updates before the portal is deployed fails those uploads.
- **Check the recorded deploy host.** Every consumer onboarded before this release has `host: railway` in `sdlc-config.json`, because `install` hardcoded it. After `devaudit update`, run `devaudit doctor`: the new `deploy-host` check compares it with where production really deploys, and `devaudit doctor --fix` corrects it. Set anything else the host needs with `devaudit configure` (or the `devaudit-configure` skill in Claude Code): `deploy_command` and the other keys for `custom` (AWS, self-hosted, any deploy script), and secrets such as `VERCEL_TOKEN` or `DEVAUDIT_PROBE_HEADER` (for a production origin behind Vercel Deployment Protection) with `devaudit configure secret <NAME>`. Then re-run `devaudit update`. See `docs/doctor.md#how-to-use-doctor` and `docs/configure.md`.
- **`reconcile-deployment.yml` dispatch inputs were renamed** to `provider_deployment_id`, `provider_project` and `provider_service` (were `railway_*`). Update any runbook or script that dispatches it. `scripts/reconcile-railway-deployment.sh` is replaced by `reconcile-deployment.sh` and is now removed on sync (unless edited locally, then it is reported as a conflict).
- **`devaudit doctor`'s `railway-cli` check is now `reconcile-cli`.** Anything reading `doctor --json` by check id must use the new id.
- **Accepting a failed required check now needs a record.** `report-test-execution.sh resolve --resolution-type accepted_exception` refuses to run without `--remediation-reference` and `--record <accepted-exception record>` (#1016). Scripts or agents that called it without them must be updated.
- **Dependency-audit exceptions:** `compliance/security/accepted-vulnerabilities.json` `schemaVersion` 1 still works but warns; move each exception to `schemaVersion` 2 with an `acceptanceRecord` before relying on it (#1017).
- **Expect file-mode changes in the first sync PR.** Synced scripts committed as 0644 become 0755 (the mode was previously never applied to identical content). Review them as mode-only changes.

### Added

- **`devaudit doctor` checks the repo's real deploy and CI setup** (#1040) — four new non-gating checks: `deploy-host` (the recorded `host` against who created the repo's production GitHub deployments and committed host files; a confident mismatch is a tier A `set-config` proposal that `doctor --fix` applies), `production-url` (the production URL secret exists; an access-gated production origin without `DEVAUDIT_PROBE_HEADER` is reported), `custom-deploy` (the `custom` host's deploy settings) and `ci-runner` (the runner label CI resolves to exists). `doctor --json` gains them at the end of `onboarding` (additive). `docs/doctor.md` now opens with a how-to guide and a worked example.
- **`devaudit configure`** (#1040) — `list`, `get`, `set <key> <value>` and `secret <NAME>` for a consumer's `sdlc-config.json`: values are validated (type, allowed values, secret-name and https patterns, shipped hosts), a host the repo's evidence contradicts needs a confirmation or `--reason`, `--dry-run` shows the generated files the next `update` regenerates and what is still to do, and `secret` hands over to `gh secret set`'s masked prompt so devaudit never sees the value. See `docs/configure.md`. (`devaudit config` remains the reserved CLI-settings stub.)
- **`devaudit-configure` skill** (#1040) — synced to every consumer: walks the operator through doctor's deploy/CI findings and applies each confirmed change through `devaudit configure`, regenerates with `devaudit update`, and opens a fix PR. It never edits `sdlc-config.json` or workflows directly and never handles secret values.
- **A failed required gate on the release PR is fixed or accepted with a documented exception** (#1016) — `sdlc-implementer` Phase 4 step 5a halts `[Blocked]` with exactly two paths; the accepted-exception record (`sdlc-implementer/references/e2e-accepted-failure.md.template`) is checked by the new `validate-risk-acceptance-record.sh`; `report-test-execution.sh resolve --resolution-type accepted_exception` now **requires** `--remediation-reference` and `--record` (a Phase 5 caller must supply both); `validate-test-summary.sh` fails a failure with no `## E2E failures & triage` row and holds summaries carrying a `CI as of:` stamp to the generated-table and head-SHA rules (unstamped summaries only warn); new `reconcile-e2e-summary.sh`; the PR watcher comments on the issue and updates the sticky within one poll of a red required check (`--issue <n>`, `phase4.gate_timeout_hours`); `devaudit doctor` gains `accepted-exceptions` (so `--json` `onboarding` has one more entry) and `update` seeds the `accepted-e2e-failure` and `accepted-dependency-risk` labels. New evidence type `accepted_e2e_failure` (must also exist in the portal's evidence-type contract). ADR-003.

- **Dependency-audit exceptions get a documented, matching record** (#1017) — `evaluate-npm-audit.sh` accepts `schemaVersion` 2 in `compliance/security/accepted-vulnerabilities.json`, where every entry needs an `acceptanceRecord` (a `compliance/security/risk-acceptances/<advisory>.md` that passes `validate-risk-acceptance-record.sh --kind dependency`, lists the advisory, and shares the entry's tracking issue; its path and SHA-256 go into `dependency-risk-evaluation.json`); `schemaVersion` 1 keeps working with a warning. New template `sdlc-implementer/references/dependency-risk-acceptance.md.template`, evidence type `accepted_dependency_risk` (must also exist in the portal's contract), the `sdlc-implementer` bump-or-accept halt on a failing dependency audit, and `devaudit doctor` `accepted-exceptions` now also flags dependency exceptions that are expired or expire within 14 days. The Python `pip-audit` step has no allowlist yet (tracked with #995).

- **A PR that changes no code can no longer bind its SHA, branch or test executions to a release** (#1019) — new `classify-pr-attribution.sh` (attach / skip:doc-only / skip:compliance-record / skip:no-changes); `feature-e2e.yml` emits `req_id=none` for such a PR; on `pull_request` events `upload-evidence.sh` drops `--git-sha`, `--branch` and `--create-release-if-missing` (the document still uploads) and `report-test-execution.sh start|complete` records nothing, both default on (`--no-attribution-guard` / `DEVAUDIT_ATTRIBUTION_GUARD=0` to disable); a commit trailer `Compliance-Record: REQ-XXX` is understood by `derive-release-version.sh` like `Ref:`, for doc-only compliance PRs. Confirmed against the portal source: existing releases never have their branch overwritten, but cycles keep the uploader's SHA/branch; server-side enforcement is still open.
- **Behavioural test of the generated Release Close-out workflow** (#941) — `cli/test/close-out-workflow-behavior.test.ts` runs the rendered close-out steps against a tracer-consumer fixture, a fake `gh` and a mock portal (ticket/RTM reconciliation, idempotency, `pr_opened` then `completed` reports; no report for an unmatched release, an unmerged PR or a missing key), and release-validation layer 2b gains a `close-out` surface that runs each clone's own workflow the same way. Test-harness only: no approval or release transition is ever created.

- **Declared bundles work on the Python CI template** (#995) — when a live declared bundle exists, the Python `register-release` job registers the run on the bundle's single core-REQ release (`derive-release-version.sh` gains `DEVAUDIT_DERIVE_BUNDLE_ONLY=1`), regenerates and submits the bundle manifest, and files each member's artifacts against that release through `resolve-bundle-release.sh`; `sdlc-implementer` no longer rejects `stack: python`. Python work without a bundle keeps its date-based release model. Re-run `devaudit update` on a Python project to pick this up. Release validation's Python fixture checks the generated steps.
- **Choose the deploy host at install** (#1022 part A) — `devaudit install --host <name>` and an interactive "Where does production deploy?" prompt record `host` in `sdlc-config.json`; a re-run of `install` no longer resets a recorded host (it used to force `railway` back); an unknown host fails with the list of valid ones. `sdlc-config.example.json` gains `host`. New optional repo secret `DEVAUDIT_PROBE_HEADER` (one header line, e.g. `x-vercel-protection-bypass: <token>`) is sent with `post-deploy-prod.yml`'s health probe and smoke checks, for a production origin behind Vercel Deployment Protection or another access gate. Railway-specific prose in the stage docs and upload-script examples is now host-neutral.

- **Webhook-loss recovery is driven by the host adapter, and Vercel gets it** (#1022 part B) — host adapters can declare `reconcile` (`lookup_script`, `required_cli`, `secrets`); `devaudit update` generates `reconcile-deployment.yml` for any host that does (railway and vercel today) instead of only for the literal host `railway`, and removes it for a host that does not. New host-neutral `reconcile-deployment.sh` plus `lookup-deployment-railway.sh` and `lookup-deployment-vercel.sh` (REST API, curl + jq, `VERCEL_TOKEN`, optional `VERCEL_TEAM_ID`); it replaces `reconcile-railway-deployment.sh`. `devaudit doctor`'s `railway-cli` check is now `reconcile-cli` and reads the CLI from the adapter (silent for Vercel); the vercel adapter lists `VERCEL_TOKEN` as an advisory required secret. **Breaking for anyone who dispatches `reconcile-deployment.yml` by hand:** the inputs are now `provider_deployment_id`, `provider_project` and `provider_service` (were `railway_deployment_id`, `railway_project`, `railway_service`); re-run `devaudit update` to regenerate the workflow.

- **`custom` host for AWS, self-hosted or any deploy script** (#1022 part C) — `devaudit install --host custom` generates `deploy-custom.yml`, which creates the GitHub deployment, runs your `deploy_command` (with `deploy_secrets` as env), verifies the new build is serving (`deployed_sha_url`/`deployed_sha_jq`, else a health check), posts the terminal status and dispatches `post-deploy-prod.yml`, so every downstream gate is unchanged. New `record-custom-deployment.sh`; adapters can name a `deploy_workflow`; `post-deploy-prod.yml` gains an optional `deployed_sha` dispatch input. `deploy_trigger`: `push_to_main` (default), `git_tag`, `manual`.

### Fixed

- **Housekeeping workflows honour the configured runner** (#1044) — `incident-export`, `ci-status-fallback`, `label-retention`, `periodic-review` and `quality-gates-provenance` hardcoded `runs-on: ubuntu-latest`, so on a self-hosted setup with no GitHub-hosted minutes they never started and the `Quality Gates` status they emit never reported. They now use the same runner as `ci.yml`.
- **The MongoDB dynamic-port CI step no longer hardcodes one project's variable name** (#1042) — it exports `mongodb://localhost:<port>` to every `*_URI` key the consumer's `sdlc-config.json` points at a local MongoDB (`database_env`, `build_env`, `app_env`, `e2e_env`), else `MONGODB_URI`. A consumer whose config already declared its variable gets the same step as before, plus `MONGODB_URI` when `e2e_env` declares it.
- **Docs and code no longer name consuming projects** (#1042) — examples, fixtures and historical notes use `example-app` / "a consumer"; release validation reads its consumer list from the gitignored `scripts/release-validation/consumers.local`.
- **A script upstream stopped shipping is removed on sync** (#1024) — `update` now removes a top-level `scripts/` file that an earlier sync wrote (manifest section `2d`) and upstream no longer ships, through the same unmodified-only rule as stale workflows; release validation found `reconcile-railway-deployment.sh` left behind in every consumer after #1022. Consumer-owned scripts and entries known only from the first-sync bootstrap baseline are never removed.
- **Host adapter docs matched to behaviour** (#1024) — `docs/adding-a-host.md` listed Railway as the only host and `sdlc/HOST_ADAPTER.md` claimed `wait_for_deploy` is embedded into the post-deploy template; both corrected (`wait_for_deploy` and `post_deploy_hook` are reserved, not yet consumed).
- **A synced script committed as 0644 now becomes executable** — `update` rewrote nothing when the content already matched, so the requested mode was never applied (found by release validation on example-app). Content is untouched. Release validation's `housekeeping-skip` check no longer flags the Python `ci.yml`, which calls the derive helper only in bundle-only mode.
- **`devaudit update` no longer suggests a skip-CI commit message, and integration housekeeping registers no portal release** (#1020) — the suggested sync commit is `chore: sync SDLC templates from DevAudit`. A skip-CI tag made GitHub run no workflows, so the sync PR's required `Quality Gates` check never reported and the PR stayed BLOCKED. `ci.yml` and `compliance-evidence.yml` now skip release registration and evidence upload for an untagged integration commit unless a reviewed standalone declaration exists for the bare-date version; the node `upload-evidence` job is gated on `version != skip`; the two disabled legacy housekeeping steps are gone. Existing open bare-date rows are untouched (the portal supersedes them when the next tracked release closes out).
- **Consumer patch conflicts are now persisted and visible in `devaudit doctor`** (#1023) — a `.devaudit-patches/*.patch` that stops applying cleanly is still skipped (not fatal), but is recorded in `.devaudit/sync-manifest.json` (`patches`) and reported by a new non-gating `patch-conflicts` check, so the unpatched template no longer takes over unnoticed (a consumer). `doctor --json` `onboarding` gains one entry.
- **Playwright report upload no longer silently disappears** (#1018) — `upload-evidence.sh` falls back to the presigned flow when the multipart POST is rejected with 400/413 below the 25 MB threshold, and prints size/path/evidence-type/response-header diagnostics on any failure. `compliance-evidence.yml` stops swallowing `zip` errors, logs the archive size, and adds a job-summary note when a non-passing run's report cannot be uploaded.

## [1.8.0] — 2026-10-13

Release deferral, `doctor --fix`, and a hardening pass found by the new pre-release validation gate (`docs/release-validation-plan.md`).

### Upgrade notes

Read these before running `devaudit update` on a project.

- **Update once, to 1.8.0, not to 1.7.4–1.7.6.** Those versions overwrite a locally modified file on the *second* `update` after a conflict (#988, data loss). 1.8.0 never overwrites a path left in conflict until it is resolved. A project whose committed `.devaudit/sync-manifest.json` was written by 1.7.4–1.7.6 is protected from the first 1.8.0 update on (check that no earlier local change was lost).
- **Resolve every `.devaudit-new` file in the same PR that adopts the update.** The review process is `docs/sync-conflict-review.md`: list, diff, classify (take upstream, move the change to a config key or `.devaudit-patches/`, or keep), verify with a second `update` and `devaudit doctor`, and record the outcome per file in the PR.
- **Two generated workflows had non-terminating heredocs** (`quality-gates-provenance.yml` on the hotfix path, `incident-export.yml` containment, #987). A project that kept its own copy of either must take the upstream version.
- **`update` no longer resets branch protection** (#990): it adds a missing required check or raises a review count below the minimum and keeps every other setting; a branch protected by rulesets is left alone. A private repository on GitHub Free, where neither exists, now gets a warning that required checks are not enforced.
- **New, optional:** release deferral (`Release intent: deferred-to-next` on a release ticket, RTM status `DEFERRED`, a promotion gate, `devaudit doctor` checks and `doctor --fix`). Deferring or resuming the portal release is an admin action with a personal access token; CI keys cannot do it. Declared bundles remain a Node-template feature (Python parity is #995).
- **Run the portal release that ships devaudit#897 as well** (a deferred predecessor is superseded when its successor's close-out completes). Until the portal is deployed, a deferred release absorbed by a successor stays `deferred` on the portal.

### Documentation

- **Release validation layer 2b** (#941, umbrella #957) — `scripts/release-validation.sh layer2b` (also the last step of `all`): maps what changed since the last release tag to surfaces (`scripts/release-validation/surfaces.tsv`), applies the update to two representative clones and runs a scenario per changed surface on them (the clone's own approval-gate workflow against a mock portal, local-edit survival across two updates, branch-protection and baseline-run behaviour, deferral, doctor, changed-script parsing, a per-area report of what the update changed). A changed surface with no scenario is reported as a WARN, and a unit test fails when a surface has no scenario. Documented in `docs/release-validation-plan.md`.

- **#941** (umbrella #957) — behavioural test of the generated Release Approval Gate (`cli/test/release-approval-gate-behavior.test.ts`): the rendered workflow steps run against a mock portal for every release status, bootstrap mode, fail-closed and invalid-key cases. `docs/release-validation-plan.md` states what the lifecycle gate now covers and what is still open (the close-out workflow's GitHub steps).

- **SRS gap closure** (umbrella #957) — `docs/SRS.md` had 16 index rows with no requirement body (`REQ-FRAMEWORK-CIYML-014`, `-E2EREGRESSION-002`, `-HOOK-001/-002/-004`, `-SKILL-001..004`, `-VALIDATE-001`, `REQ-SKILL-IMPLEMENTER-025..030`) and 2 bodies with no index row (`REQ-CLI-PUSH-019`, `REQ-FRAMEWORK-EVIDENCE-015`). All 18 are now consistent, the bodies written from the code they name. `REQ-FRAMEWORK-CIYML-014` was also wrong: it said `register-release` creates no portal release, but the template creates it (`--create-release-if-missing`); corrected. Totals recounted: 323 requirements.

- **Sync-conflict review process** (umbrella #957) — new `docs/sync-conflict-review.md`: how to review `.devaudit-new` files after every `update` (list, diff, classify into six outcomes, act, verify, record a per-path table in the adoption PR), plus the maintainer disposition for the release-validation gate's conflict warnings. Linked from `consuming-projects.md`, `doctor.md`, the housekeeping runbook, the `sdlc-implementer` skill, both `devaudit-update-install.md` copies and the end-of-sync conflict summary.

- **#986** (refs #941, #932, #917) — `docs/release-validation-plan.md` and `scripts/release-validation.sh`: the repeatable pre-release gate (installer checks, read-only consumer clone runs with a write-blocking `gh` stub, fresh-onboard fixtures). The gate now attributes blocked `gh` writes by log position, so writes from the manifest bootstrap's baseline worktree are counted, and normalises `WORK_DIR` (a relative path with `..` hid every blocked write).

- **#956 phase 3a-3** (umbrella #957) — release deferral is now documented end to end: the `sdlc-implementer` skill and its change-request loop (a `deferred` node; "Closing a release PR without releasing" extended with the manual, admin-only portal defer step via a personal access token and the `develop -> main` promotion gate), blueprints 3/4/5, `sdlc/ai-rules`, the release playbooks, `docs/change-workflows.md`, `docs/consuming-projects.md` (status list gains `deferred` and `uat_changes_requested`; the Token contract no longer limits the PAT to UAT submission; stale `DEVAUDIT_USER_TOKEN` repo-secret rotation rows corrected per #912), `docs/onboarding.md`, `docs/articles/permissions-and-tokens-reference.md` (unsourced PNG diagram replaced), and a new `docs/ADR/ADR-002-release-deferral.md`. SRS: `REQ-SKILL-IMPLEMENTER-034` added, `-029`, `REQ-FRAMEWORK-APPROVAL-002`, `POSTDEPLOY-002` and others reconciled; §3 recounted to 316. No behaviour change. `devaudit doctor --fix`, checks D1/D2/D5 and CLI/skill defer/resume commands remain planned (phase 3b of #956).

- **#910** (umbrella #957) — `docs/consuming-projects.md` gains one consolidated section on `sdlc-config.json`: why it is the per-consumer source of truth, exactly what `update`/`install` do and do not write to it, and the two ways project-specific parameters get in (cross-linked from `docs/onboarding.md`, whose idempotence note is also corrected to say only wizard-owned keys are rewritten). `docs/e2e-test-tiers.md` gains a pre-enable checklist: `e2e_env` scope per workflow (job-wide in `e2e-regression.yml`, E2E steps only in `ci.yml` and `feature-e2e.yml`), a warning that legacy Playwright `globalSetup`/`globalTeardown` run against whatever backend `e2e_env` points at, `feature-e2e.yml` running every Playwright project (no `--project`) and how to guard one with `GITHUB_WORKFLOW`, and the unanchored `e2e/**/*.spec.ts` `testMatch` pitfall.

### Fixed

- **#1001** (umbrella #957) — the test suite no longer has recurring 'known' failures. The #693 `update.test.ts` case asserted a quote style the consumer's prettier rewrites, so it failed on machines with prettier and passed on CI; it now matches either quote. A vitest global setup rebuilds `dist/` when it is missing or older than `src/`, so suites that spawn the built CLI cannot fail on a stale local build. The gate test's `beforeAll` got a 120s timeout (it timed out at 10s under a parallel run and silently skipped all its tests). The bash-based workflow tests now also run on Windows.

- **#990** (umbrella #957) — `devaudit update` no longer resets branch protection. Every sync used to send a full protection `PUT` with fixed settings, which set the review count back to 1 (`main`) / 0 (`develop`), forced admin enforcement on, and cleared anything the PUT did not send (code-owner reviews, linear history, push restrictions, ...). `update` now reads the protection and adds only a missing required check or raises a review count below the minimum, through the sub-resource endpoints; every other setting is kept and each change is named in the summary. A branch protected by repository rulesets gets no classic protection on top (missing checks are reported). A private repository on GitHub Free, where neither feature exists, is reported as unprotected instead of failing a PUT on every sync. Also fixed: the manifest bootstrap's first-sync baseline ran the previous CLI version with the operator's GitHub credentials, so that version's protection PUT, label creation and default-branch edit hit the live repository; the baseline run now has no GitHub or portal credentials and a `gh` that always fails. Found by the release-validation gate. **Behaviour change:** none of the seven active consumers has protection today (six are private on GitHub Free), so expect the new `branch protection is not available` warning on the six private ones; the public one (no protection yet) gets the install defaults on its next update when the operator has admin rights.

- **#987** (umbrella #957) — two generated workflows had heredocs whose terminators stayed indented after YAML stripped the block indentation, so they never terminated: `quality-gates-provenance.yml`'s hotfix path (the dispatched `ci.yml` run was never found, so a hotfix PR's `Quality Gates` proxy could not succeed) and `incident-export.yml`'s containment section (the heredoc swallowed the rest of the step). Rewritten with `jq` / `printf`; `cli/test/workflow-run-syntax.test.ts` now runs `bash -n` (warnings included) on every bash `run:` step of the generated node and python workflows. Found by the release-validation gate; present since 2026-07. The incident-issue bodies in `compliance-evidence.yml` and `post-deploy-prod.yml` no longer contain apostrophes inside `$(cat <<EOF …)`, which bash 3.2 (macOS) misreads as an open quote.

- **#988** (umbrella #957) — **data loss:** `devaudit update` overwrote locally modified files on the second sync after a conflict. A pre-existing file that differed from upstream at the first manifest sync was correctly kept (upstream written to `.devaudit-new`), but its manifest entry recorded the local file's hash, so the next `update` saw it as unmodified and replaced the consumer's edit with upstream. A conflict entry is now never treated as unmodified (also protecting manifests already committed by 1.7.4–1.7.6, e.g. 66 such entries in one consumer) and new ones record no baseline hash. Found by the release-validation gate.

- **#984** (umbrella #957, pre-v1.8.0 review) — `doctor --fix` no longer resumes stale deferrals (D5) non-interactively, even with `--yes --reason` (one reason given for another proposal resumed every stale deferral); interactively it asks resume / extend / abandon. The `close-out-release` proposal is tier C (printed), so `--fix --yes` no longer always exits 8 when close-out drift exists. `doctor --fix` refuses to write a `Release intent` line without a reason (the validator rejects it). `close-out-reconcile.yml` opens a deferred-only issue with its own title instead of claiming a stale close-out was triggered. The defer client sends the portal's real body fields `deferredUntil`/`deferredToVersion` (was `untilDate`/`toVersion`, silently ignored). Portal companion: metasession-dev/devaudit#897 supersedes a deferred predecessor when its successor's close-out completes. `.devaudit/sync-manifest.json` is written with sorted file keys: it was written in section completion order, so a second `update` with nothing to change still rewrote it (found by the release-validation gate; affects consumers since 1.7.4). A `sdlc-config.json` without a `runner` key rendered `runs-on: ,` (invalid YAML in every workflow); it now falls back to `install`'s default `self-hosted` expression (ubuntu-latest unless `CI_RUNNER_LABEL` is set).

- **#956 phase 3b** (umbrella #957) — deferred tickets (which stay in `compliance/pending-releases/`) were treated as part of the release in flight by several CI loops: `post-deploy-prod` would promote, upload production evidence to and PATCH a deferred REQ's release, and `ci.yml` (node and python), `compliance-evidence.yml` and `upload-compliance-documents.sh` uploaded evidence for it. They now skip it via the new shared `is-deferred-ticket.sh` (`Skipping <REQ>: deferred (Release intent: deferred-to-next)`); when every pending ticket is deferred `post-deploy-prod` falls through to its no-tracked-ticket path. `periodic-review` reports deferred tickets separately, and `close-out-reconcile` no longer treats a parked deferred ticket as a missed close-out while still flagging a deferred ticket whose code is already on `main` as a silent absorption (no automatic close-out). Consumers receive this on the next release and `devaudit update`.

- **#956 phase 3a-2** (umbrella #957) — `doctor`'s `releases` check resolved `compliance/pending-releases/` relative to cwd, so it reported `no pending-releases/` from any subdirectory; it is now repo-root relative.

- **#973** (umbrella #957) — `check-release-approval.yml` now links the release PR *before* the approval gate. `Resolve current release` always outputs `release_id`/`version`/`status`/`approved_sha` (still failing if no release exists); `Link PR to release` and `Post release link on PR` run next; the unchanged `case "$STATUS"` gate with the same error text is now its own `Enforce release approval` step, followed by `SHA comparison` and the refreshed check run. A draft release therefore gets `pr_url`/`pr_number` from the first `Check Release Approval` run on its PR; the PR check is still red until approval, and bootstrap / standalone-housekeeping runs are unchanged. **Operator action:** none beyond `devaudit update`.

- **#971** (umbrella #957) — a release PR no longer shows `Quality Gates` green for code that was never gated. `quality-gates-provenance.yml` previously accepted *any* successful `Quality Gates` check-run on the head SHA, so the docs-only `CI Status Fallback` success on a trailing compliance commit satisfied provenance for the code merge beneath it (example-api release PRs #153/#157). The check now finds the latest commit in `origin/<release_branch>..<head>` that touches a path outside `paths_ignore` (new `scripts/provenance-gated-commit.sh`, fed by a new `{{PATHS_IGNORE_LIST}}` template token rendering the same patterns as `ci.yml`) and requires a completed+successful `Quality Gates` run **whose workflow is `ci.yml`** on that commit; successes from `ci-status-fallback.yml`, the provenance workflow itself, or a skipped `ci.yml` job do not count. A range that is entirely docs-only keeps the old behaviour; the hotfix dispatch path is unchanged. **Operator action:** none to adopt (`devaudit update` ships the script and regenerates the workflow). **Behaviour change:** a release PR now stays red when the runner is offline and the code commit never got a real `ci.yml` run — rerun CI on the commit the error names (or push it through the develop flow). That is the intended effect.

- **#963** (umbrella #957) — generated workflows emitted a Postgres service container that could not start. For `database_service: postgres`: `database_env` is now emitted inside the service (`services.postgres.env`; the job-level copy is kept for steps) so `POSTGRES_PASSWORD` actually reaches the container; a bare `database_port` (e.g. `"5434"`) is published as `host:container` (`5434:5432`, container port from the image default) and an explicit `"5434:5432"` passes through; and a `pg_isready` healthcheck (`options:`) is added so steps wait for readiness. Applies to `ci.yml` (node and python), `feature-e2e.yml` and `e2e-regression.yml`. `mongodb` and no-database output is unchanged. **Operator action:** a consumer that emptied the `database_*` keys as a workaround can repopulate them after updating.

- **#970** (umbrella #957) — `devaudit install` / `devaudit update` now idempotently create the GitHub labels the synced issue templates reference (`needs-triage`, `bug`, `requirement`, plus every `labels:` entry in `ISSUE_TEMPLATE/*.yml`), so `gh issue create --label needs-triage` no longer fails in onboarded repos. Only missing labels are created (existing labels are untouched). Best-effort: a missing/unauthenticated `gh` or non-GitHub repo logs a warning with the manual commands and never fails the command; `--dry-run` makes no `gh` calls.

- **#966** (umbrella #957) — `validate-commits.sh` now counts a declared bundle as **one** active release when deciding whether an untraced `feat`/`fix` commit may be downgraded to a warning. Each live bundle's members (co_tracked, predecessor, housekeeping, read from `BUNDLED-CHANGES-<core>.json`, or the `.md` when `jq` is absent) collapse into the core REQ; a manifest whose core ticket is no longer pending is ignored. Previously a bundle of five tickets counted as five releases, so the single-release escape hatch never applied and the release PR's Compliance Validation failed. Extended `validate-commits.test.sh` (bundle, bundle plus independent release, stale manifest). Also adds a **declared legacy exemption** for history that predates Conventional Commits and cannot be rewritten: `sdlc-config.json` `commit_validation.legacy_non_conventional: [{sha, reason}]` (sha ≥ 7 chars, reason required). Each exempted commit is printed as `EXEMPT` with its reason on every run and counted as a warning; it waives only the format check, never requirement traceability.

### Added

- **#956 phase 3b** (umbrella #957) — `devaudit doctor --fix [--yes] [--reason <text>] [--dry-run]` and the remaining deferral checks. `--fix` proposes and applies repairs in tiers: A (local, confirmed or `--yes`: ticket `Release intent`, RTM `DEFERRED`, predecessor lines), B (portal defer/resume, admin-only: your PAT, a typed reason and explicit confirmation, never applied by `--yes` alone and never with API/viewer keys), C (printed, never run). It never prompts under `--json`, without a TTY or with `CI` set, and exits 8 when proposals remain unapplied; `--dry-run` previews; `--fleet` rejects `--fix`/`--reason` (exit 2). New doctor checks `deferred-portal-sync` (D1), `deferred-ticket-sync` (D2) and `deferral-age` (D5, `deferral_max_age_days` in `sdlc-config.json`, default 30); `--json` gains a `fix` key with `--fix`. New `cli/src/lib/prompt.ts` and PAT-only `cli/src/lib/release-deferral-api.ts`; `status` lists deferred tickets separately. The defer/resume request shape (`X-DevAudit-Token` header, `reason`/`untilDate`/`toVersion` body) is assumed and to be verified against the portal before release. Docs, SRS (`REQ-CLI-DOCTOR-010..013`, `REQ-FRAMEWORK-DEFERRAL-005`), ADR-002 open items and the skill updated.

- **#956 phase 3a-2** (umbrella #957) — `devaudit doctor` gains read-only, non-gating release-deferral checks: `release-pr-closed` (D3), `deferred-will-ship` (D4), `predecessors-none` (D6, a TypeScript port of the `generate-bundled-changes.sh` `Absorbed predecessor releases: None` guard, pinned to it by a shared-fixture test) and `bundle-members` (D7); D8 remains the `releases` check. Portal reads use the viewer key (`DEVAUDIT_VIEWER_API_KEY` from env/`.env`, fallback `DEVAUDIT_API_KEY`) via the new `cli/src/lib/releases-api.ts`. `--json` gains additive `deferral` and `proposals` keys (findings may carry an inert `remediation: {id, tier, summary, plan[], needsPortal}`); existing keys are unchanged and exit codes are unchanged. D1/D2/D5 and `doctor --fix` are phase 3b.
- **#956 phase 3a-1** (umbrella #957) — release deferral: scripts, validators and the promotion gate. RTM status `DEFERRED` is accepted by `validate-compliance-artifacts.sh` (valid, non-terminal; warns when the ticket lacks the `Release intent` line), and `validate-commits.sh` and `derive-release-version.sh` (steps 4 and 4-bis) ignore deferred tickets/rows, so a parked REQ is never derived as the in-flight release. New `list-reqs-in-range.sh [SINCE] [HEAD]` prints the distinct REQ ids referenced by `[REQ-x]` tags and `Ref:` trailers in a range. New `check-deferred-reqs-in-range.sh`, run by `check-release-pr-scope.sh` inside the existing Release Scope Integrity job, fails a `develop -> main` PR when a deferred REQ (ticket `Release intent: deferred-to-next`, or RTM `DEFERRED`) has commits in the range and is not listed under `Absorbed predecessor releases` (`Quality Gates` stays the only required context). `check-release-approval.yml.template` gives a deferred-specific error for portal status `deferred` (still fails the gate). SRS `REQ-FRAMEWORK-DEFERRAL-001..004`. `doctor` checks, skill/blueprint/docs text and `--fix` follow in #956 phases 3a-2, 3a-3 and 3b.

- **#955 remainder** (umbrella #957) — deferred REQs are no longer absorbed silently. New optional release-ticket field `- **Release intent:** deferred-to-next — <reason, PR #N closed unmerged>` (documented in the release-ticket blueprint; `validate-compliance-artifacts.sh` rejects a malformed value, absent means no declared intent). `generate-bundled-changes.sh` now fails, naming the ticket and telling you to list it under "Absorbed predecessor releases", when a pending ticket carries that intent and the core ticket says `None` or omits the field, and when the field says `None` but that pending REQ's `[REQ-x]` / `Ref: REQ-x` commits are already in `<since>..HEAD`. `sdlc-implementer` gains a "Closing a release PR without releasing" procedure and rejects declared bundles for `stack: python` (a Node-template feature). **Operator action:** a release whose ticket says `Absorbed predecessor releases: None` while a pending REQ's commits are already in range will now fail `Register Release` — list that REQ as a predecessor. Doctor/RTM `DEFERRED`/promotion-gate work stays in #956.

- **#969** (umbrella #957) — new optional `sdlc-config.json` keys `e2e_concurrency_group` and `e2e_concurrency_cancel_in_progress` for `e2e-regression.yml`. When `e2e_concurrency_group` is set it becomes the fixed `concurrency.group` for every trigger (PR, `workflow_dispatch`, post-deploy) with `cancel-in-progress: false` unless overridden, so projects whose critical/regression specs mutate a shared backend no longer run overlapping, data-clobbering jobs. Unset/empty keeps the generated output byte-for-byte unchanged. GitHub keeps one running and one pending run per group, so a newer queued run replaces an older queued one (see `docs/e2e-test-tiers.md`). The proposed `devaudit doctor` warning is not included. Retires the consumer local `e2e-regression.yml` patch once adopted.

## [1.7.6] — 2026-10-04

### Fixed

- **#955** (with **#952**/**#953**, umbrella #957) — a declared bundle (`Bundles: #A, #B`) is **one portal release with one UAT approval** again. #884's submission of `co_tracked` members had left a bundle as several portal releases: CI filed each member's evidence under `--release <member> --create-release-if-missing`, creating one orphan draft release per member, and the portal then refused to approve the core until every submitted `co_tracked` sibling release was itself approved (`co_tracked_sibling_not_ready`) — which nothing ever submitted. Now: a new `scripts/resolve-bundle-release.sh <REQ>` maps a `co_tracked` member to its live bundle's core, and the CI templates (SAST/dependency fan-out, E2E fan-out, per-AC screenshots) and `upload-compliance-documents.sh` file every member upload under the core's release while keeping the member's own REQ as the requirement tag; `submit-bundle-manifest.sh` no longer submits `co_tracked` members to the portal (they stay in the committed manifest) and recomputes `manifestHash` for the payload it sends; `close-out-release.sh` releases members with the core (tickets to `approved-releases/`, Status `RELEASED`, RTM `RELEASED`) while predecessors are still superseded. Also in this release line: `generate-bundled-changes.sh` no longer reports declared members as "ambiguous predecessor ownership" (#952/#953). **Operator action after updating:** (1) a consumer that hand-patched `scripts/generate-bundled-changes.sh` for #952 will see a sync conflict on that file — take the upstream version (`mv scripts/generate-bundled-changes.sh.devaudit-new scripts/generate-bundled-changes.sh`); (2) portal releases already created for bundled members by earlier versions stay as inert empty drafts — do not submit them (there is no portal action to discard one yet). Declared bundles remain a Node-template feature (the Python template does not generate bundled changes, and `feature-e2e.yml` skips a multi-REQ bundle PR). See `docs/change-workflows.md#bundling-several-issues-into-one-release`.

## [1.7.5] — 2026-10-03

### Fixed

- **PR #946** — the raw `DEVAUDIT_VIEWER_API_KEY` value is surfaced once, at mint time.

### Added

- **PR #947** — `devaudit doctor` warns when a legacy commitlint config shadows `commitlint.config.mjs`.

## [1.7.4] — 2026-10-01

### Fixed

- **#929** — `SDLC/bin/devaudit-sdlc.js` was genuine CommonJS but was synced with a `.js` extension and no isolating `package.json`, so any consumer whose own `package.json` declares `"type": "module"` (a common modern default) had it misinterpreted as ESM and crashed on every phase-transition/freshness-check sentinel invocation with `require is not defined`. Renamed to `devaudit-sdlc.cjs` (forces CommonJS regardless of the consumer's `package.json`) and updated `syncSdlcEngine` to sync the new name and remove a stale pre-#929 `.js` copy if one is present. **Operator action after updating:** invoke the binary as `node SDLC/bin/devaudit-sdlc.cjs`, not `.js`; any consumer-local scripts or docs that hard-code the old `.js` path need updating too.
- **#928** — combining `database_env`/`app_env`/`e2e_env` (in `e2e-regression.yml`'s job env, the Python `ci.yml`'s Quality Gates job env, and the merged `{{DATABASE_AND_APP_ENV}}` token in node `ci.yml`/`feature-e2e.yml`) did plain string concatenation with no dedup — a key set in more than one source (e.g. `MONGODB_DB_NAME`, needed by both the app to boot and the E2E seed to reach the same database) produced a job-level `env:` block with a duplicate YAML key, which fails to parse at all. New `mergeEnvSources` dedupes with a fixed precedence (`database_env` < `app_env` < `e2e_env`, later wins). **Operator action:** none — this is a pure bugfix; the next `devaudit update` regenerates valid YAML for any consumer whose configs overlap this way.
- **#930** — the sync manifest's bootstrap reconstruction (below) had three bugs found by #932's pre-release validation gate (run against cloned real consumers, not fixtures alone): (1) `DEVAUDIT_INSTALLER_ROOT` leaked into the "old version" `npx` child process, so the reconstructed baseline matched the *current* templates instead of history, defeating reconstruction; (2) the scratch git worktree used for reconstruction has no `node_modules` (git doesn't track it), so the consumer's own prettier silently failed to resolve there, leaving anything it normalizes (markdown tables, YAML/JSON quote style) unformatted in the baseline while the real sync formatted correctly — a spurious mismatch; (3) the file list feeding the baseline's format pass was collected non-recursively, silently dropping every nested `.claude/skills/<name>/...` and `SDLC/blueprints/*.raw.md`/`SDLC/bin/*` file. A fourth, production-affecting bug surfaced by the same gate: `syncSkills`/`syncSdlcEngine` never reported which files they wrote, so the real sync's own formatter never touched skill or blueprint markdown either — only the (now-recursive) baseline did, permanently disagreeing with production. All four fixed together; each has a regression test. **Operator action:** none — these were internal reconstruction-accuracy bugs; a consumer whose first post-upgrade sync previously showed spurious skill/blueprint conflicts should see them resolve cleanly now.

### Added

- **#928** — `e2e-regression.yml`'s "E2E Regression Tests" step now runs `e2e/ci-reliability/regression-run.sh` if present in the consumer repo, falling back to the previous default command otherwise. This gives the `e2e-ci-reliability` skill a stable, sync-safe place to put project-specific reliability tuning (sharding, dev-server warm-up) that survives `devaudit update` without a `.devaudit-patches` entry re-rolled against every template restructure. The path is fixed and undeclared in `sdlc-config.json` on purpose — `devaudit` never creates, overwrites, or deletes this file. Also new: `e2e_regression_timeout_minutes` config key (default 55) for the job's `timeout-minutes`, since a hook script can't raise a GitHub Actions job-level timeout at runtime; and widened `e2e-regression-report` artifact-upload globs (`e2e-regression-results*.json`, `playwright-report*/`, `test-results*/`, `e2e-server*.log`) so a hook's sharded outputs are captured without any further CI-workflow change. **Operator action:** a consumer with an `.devaudit-patches/e2e-regression.yml.patch` hand-patching sharding logic (e.g. example-app) should move that logic into `e2e/ci-reliability/regression-run.sh` and delete the patch.
- **#930** — a committed `.devaudit/sync-manifest.json` now records the sha256 of every file `install`/`update`/`join` writes. Every regenerating sync section (stage docs, AI rule pointer files, stack hooks, scripts, issue templates, skills, the E2E evidence helper, CI workflow templates, the SDLC engine binary + blueprints, `.devin/workflows`) routes through a new shared `writeManaged`/`removeManaged` helper instead of a direct file write or `rm -rf` + recopy. A file that's still unmodified since the last sync updates exactly as before; a hand-edited one — or a pre-existing file at a devaudit-managed path devaudit has no record of writing, typically at onboarding — is left byte-for-byte untouched, with the fresh content written to a sibling `<path>.devaudit-new` and the conflict reported (a loud sync-time warning, an end-of-sync summary, `conflict: true` in the manifest, and a new `devaudit doctor` `sync-conflicts` check) instead of silently overwritten. The very first sync after upgrading — before any manifest exists — reconstructs a baseline by running your project's previously-recorded CLI version into a scratch git worktree; if that isn't possible (no recorded version, no git, or the reconstruction itself fails), it falls back to treating every existing managed file as a conflict and deleting nothing, the safe direction to fail in. `--dry-run` now runs this full classification and reports the same conflict summary a real `update` would, writing nothing. **Operator action on your first sync under this version:** review the printed conflicts summary (if any) and resolve each per `docs/consuming-projects.md#sync-conflicts` — most existing consumers should see few or none, since the bootstrap reconstruction protects anything genuinely unmodified.

### Changed

- **#930** — `.claude/skills/<name>/` and `SDLC/blueprints/` are no longer wiped (`rm -rf`) and recopied on every sync. Each upstream file syncs individually (manifest-driven, see above); a consumer-added file inside a skill directory with no upstream counterpart now survives every sync instead of being deleted.

## [1.7.3] — 2026-09-29

### Fixed

- **#921** — a conflicting `.devaudit-patches/*.patch` (one that no longer applies cleanly) now skips just that file with a warning instead of throwing out of the section loop and silently aborting every later sync step, including the version stamp.
- **#921** — `e2e-regression.yml`'s job-wide env now also threads `app_env`, matching `ci.yml.template`/`feature-e2e.yml.template`'s existing behavior — the dev server this workflow starts needs its own runtime config, distinct from `e2e_env`'s test-only credentials.

## [1.7.2] — 2026-09-29

### Fixed

- **#912** — `DEVAUDIT_USER_TOKEN` is no longer written as a repo secret (it's an operator-local credential, not something CI needs); corrected attribution docs and SRS drift found during the same audit.

## [1.7.1] — 2026-09-29

### Fixed

- **#899** — stopped auto-attributing `SOC2.CC7.2` to a defect that CI itself caught pre-merge — that clause is specifically about production incidents; a CI-caught regression never reached production.

### Changed

- Documentation pass: filled deep-coverage gaps in undocumented flags, hooks, config keys, and skill sub-flows; explained in-flight vs. post-deploy defect handling in `incident-export.md`; fixed README/docs organization gaps and added a table of contents; added a housekeeping-release runbook and a prompts FAQ.

## [1.7.0] — 2026-09-28

### Added

- **#890** — new `e2e-ci-reliability` skill: diagnoses long-run E2E suite flakiness (sharding, warm-up, timeout tuning) as a per-project, skill-owned concern rather than a framework default.
- **#886** — CLI opt-in for the E2E regression tier (`--enable-e2e-regression`/`--disable-e2e-regression`), plus viewer-key docs and wiring.
- **#889** — `doctor`/onboarding now surface host-adapter secrets and CLI prerequisites the operator still needs to configure.

### Fixed

- **#893** — enforced `sdlc-implementer`'s Phase 0 freshness check (a stale-framework consumer is now caught before Phase 0 proceeds).
- **#892** — Phase 5's post-deploy triage gate is now wired to the portal's resolve endpoint.
- **#887** — capture the `gh api` error body on a deployment-status POST failure instead of a generic message.
- **#885** — self-hosted-runner robustness fixes for `ci.yml.template`.
- **#884** — a declared REQ bundle now shares one portal release instead of creating a separate one per bundled REQ.
- **#883** — declared Railway adapter prerequisites explicitly; gated the reconcile-deployment workflow to Railway hosts only (devaudit-installer#841).
- **#882** — gated `playwright install --with-deps` on runner type (self-hosted runners already have system deps).
- **#881** — added a halt/resume path for a Phase 2 merge refused by the environment.
- **#880** — derive bidirectional cross-feature regression scenarios.
- **#879** — scan both the SRS table and heading blocks for REQ-ID allocation (previously missed IDs that existed only as a heading).
- **#878** — archive the bundle manifest on close-out; guard against a stale step-0 derivation.

## [1.6.1] — 2026-09-26

### Fixed

- Gated `compliance-evidence.yml`'s E2E Regression listener by `e2e_regression_enabled` — a consumer who never opted in no longer gets a listener waiting on a check that will never run.

## [1.6.0] — 2026-09-26

### Added

- Generalized `fleet-doctor` into a multi-tenant `devaudit doctor --fleet`.
- Enforced an org-boundary check before any `fleet-doctor` write action.

### Changed

- Deprecated polyglot-monorepo `targets` support; fixed stale naming in the docs. Documented `doctor`/`fleet-doctor` as the SDLC health-check layer and added a canonical `devaudit doctor` reference.

## [1.5.1] — 2026-09-25

### Added

- `devaudit install --with-viewer-key` issues a read-only API key.
- New `fleet-doctor` skill: an operator-only fleet-wide drift audit.
- `devaudit doctor --json` mode plus fleet-doctor-consumable checks.
- `resolve` mode for `report-test-execution.sh`, for self-service cycle-excuse handling.

### Fixed

- Reverted the execa 9→10 bump — it broke Windows local-bin shebang execution.
- Decoupled `plugin-sdk`'s DTS emission from `tsup` so the TypeScript 7 build no longer crashes.
- Added `vite` as an explicit devDependency for `vitest` 5.
- **#831** — onboarded the `ostendo-workhorse-ci` self-hosted runner for the Linux CLI CI leg.

## [1.5.0] — 2026-09-21

### Added

- `devaudit doctor` now verifies onboarding-checklist invariants.
- New opt-in `e2e-regression.yml.template` — three-tier E2E gating.
- SAST/dependency-audit evidence now fans out to declared-bundle sibling REQs.

### Fixed

- Preserved declared-bundle co-tracked members across CI's automatic bundled-changes regeneration.
- Failed loudly instead of silently swallowing a stale E2E dev server kill.
- Propagated the checkout `clean:false` fix (from an earlier release) to the remaining 8 self-hosted-capable workflow templates.
- `commitlint` no longer rejects the `Sdlc-Implementer-Sentinel` commit trailer on a long phase history.
- `validate-commits.sh`'s `CC_REGEX` no longer rejects the standard `style:` commit type.
- Corrected `INSTALLER_DISPATCH_TOKEN` guidance (fine-grained, scoped, resource-owner).

## [1.4.2] — 2026-09-10

### Fixed

- **#799** — a cyclic advisory back-edge is now treated as non-fatal, not a gate failure.
- **#807** — resolve a deployment-origin E2E REQ via its nearest-ancestor commit before hard-failing.
- **#783** — close out a reused REQ ID whose ticket lives under `superseded-releases/`.
- **#798** — report the post-deploy E2E Regression tier as "not required" when the consumer hasn't opted in, instead of a misleading failure.

## [1.4.1] — 2026-09-09

### Added

- Opt-in `mypy_scoped_diff` for the Python stack.

### Fixed

- Stopped rendering an empty `env:` block on the Python Quality Gates job.
- Routed the `e2e-regression-3-tier.yml` reference through `CI_RUNNER_LABEL`.
- Made `release.yml` resumable after a partial publish.

### Changed

- Documented `example-web`, `example-web-api`, and `example-site` as active consumers.

## [1.4.0] — 2026-09-08

### Added

- **#786** — new scheduled `close-out-reconcile.yml` workflow (daily + manual `workflow_dispatch`): catches a release whose one-shot portal `release-closed` dispatch was ever missed by cross-checking `compliance/pending-releases/` against `origin/main`, triggering `close-out-release.yml`'s existing reconciliation for anything demonstrably stale and opening a tracking issue for auditability. Complementary defense-in-depth to metasession-dev/devaudit#833's dispatch-reliability fix, not a substitute for it.

### Fixed

- **#787** — the pre-merge "critical" and post-deploy "regression" E2E tiers now carry distinct portal check labels (`E2E Critical (pre-merge)` vs `E2E Regression (post-deploy production)`) instead of the identical `E2E Regression` label regardless of tier — a real incident contributor, since a regression-tier check is structurally guaranteed absent on a develop→main PR (production doesn't exist yet) with no way to distinguish "fine, hasn't run" from "something's wrong." Also removed a dead `push`-triggered tier-derivation branch that could never execute under the shipped `e2e-regression.yml` reference template.
- **#788** — `check-release-approval.yml`'s `release-approved` re-dispatch now explicitly concludes the stale pre-approval check-run as `conclusion: neutral` ("superseded") instead of leaving it dangling forever alongside the fresh success check-run — a likely direct contributor to metasession-dev/devaudit#825's duplicate/stale check-run confusion. The PR-resolution fallback (used when the portal's `client_payload` is incomplete) now emits a visible `::error::` annotation instead of silently guessing which PR to target.

## [1.3.0] — 2026-09-08

### Added

- **#778** — new `devaudit uninstall [path] [--target <name>]` command, the counterpart to `devaudit install`: revokes the project's active API key(s) on the portal (`DevAuditClient.revokeApiKey`, no-ops cleanly if the portal project was already deleted), deletes the GitHub secrets/variables `install` wrote (new `GitProvider.deleteSecret`/`deleteVariable`, gh CLI + REST fallback), and removes the target from `sdlc-config.json` (`removeSdlcConfigTarget`, new) — deleting the file entirely if it was the only target, or collapsing back to the flat single-target shape when one remains. Deliberately leaves branch protection and synced CI/SDLC files in place. Companion to the portal-side project hard-delete feature, metasession-dev/devaudit#827.
- **#731** — `devaudit install`/`devaudit update` now set the consumer repo's GitHub default branch to `integration_branch` (new step 9/12 on install; idempotent, no-op if already correct). GitHub creates every repo with `main` as default; without this, a contributor using GitHub's own UI (new-branch dropdown, "Compare & pull request") lands on `main` instead of `develop`, silently skipping the real Quality Gates workflow (which only triggers on PRs to the integration branch). Found onboarding a consumer.
- **#370** — release-branch Quality Gates now emit a dedicated `Release Scope Integrity` check that fails closed when the PR title/body scope drifts from the release currently derived from the integration-branch head, including bundled-release context markers.

### Changed

- **devaudit-installer#613** — generated `close-out-release.yml` now authenticates its checkout/PR-create as `secrets.INSTALLER_DISPATCH_TOKEN` when the consumer has one configured, falling back to the default `github.token` unchanged when it doesn't. **Optional, no action required on update**: without this secret, a close-out PR opened by the workflow's default `GITHUB_TOKEN` (actor `github-actions[bot]`) has its own `pull_request`-triggered required checks (e.g. `Quality Gates`) held at GitHub's `action_required` state until a maintainer clicks "Approve and run" once per PR — the close-out still completes, it just needs that one manual click. Set a repo secret named `INSTALLER_DISPATCH_TOKEN` (a PAT — classic `repo` scope, or fine-grained with Contents + Pull requests read/write — on your repo) to skip the click entirely; this is the same secret name/pattern already used internally for `DevAudit-Installer`'s own `hotfix-backmerge.yml`.
- **#379** — PRs to the release branch now split intentionally by class: tracked `develop -> main` release PRs keep provenance-only `Quality Gates`, while `hotfix/* -> main` PRs dispatch the real `ci.yml` gate run on the hotfix branch and proxy that result back to the PR. Generated `ci.yml` side-effect jobs (`register-release`, `upload-evidence`) now stay pinned to the integration branch so hotfix dispatches do not create release/evidence mutations.
- **#381** — the release watcher and stage-5 guidance now define release-green truthfully: a release PR is not ready until the full required release check set is terminal-success, and post-deploy completion is not treated as final production health until the merged SHA's GitHub deployment status reaches terminal success.
- **#383** — the generated docs now define the installer's status-check contract explicitly: repo-owned checks are the authoritative merge surface, while third-party hosting suites are informational unless a consumer intentionally makes them required.
- **#384** — generated PR workflows now recognise `chore/close-out-*` as an administrative branch class and skip heavy PR gates there by default instead of treating close-out reconciliation as a feature/release validation path.

### Fixed

- **#731** — `configureBranchProtection`/`verifyBranchProtection` now key the release-branch protection rule off `sdlc-config.json`'s `release_branch` instead of the GitHub-reported default branch. This only worked before because GitHub's default always happened to equal `main`; now that install can set the default branch to `integration_branch`, using the reported default here would have applied the strict main-only rule to `develop` instead and skipped protecting `main` entirely.
- **#378** — post-merge regression triage now walks nested Playwright JSON reliably and includes spec file, full test title, final failing status, and first available error message in the filed issue body instead of falling back prematurely.

### Fixed

- **#382** — the release-branch provenance guard now waits and retries for develop-side `Quality Gates` success on the same SHA instead of failing immediately in the race window where the release PR starts before the develop push pipeline has finished recording its pass.
## [0.3.10] — 2026-07-11

### Added

- **#304** — `devaudit-sdlc` now includes an executable PR-watch path for blocked release PRs, with structured classification for waiting on checks, reviews, mergeability, or portal release state instead of stopping at PR creation.
- **#312** — release preparation now supersedes stale `develop -> main` release PRs when a tracked release takes over the branch, so the release path converges on one truthful PR.

### Changed

- **#305** — workflow templates now use a normalized GitHub token contract for mutation paths, reducing issue/PR automation failures caused by mixed token usage.
- **#310** — the generated pre-push hook now preserves stdin correctly, enforces tracked-work skill invocation consistently, and validates phase-sensitive compliance progression before push.
- **#315** — commit-traceability enforcement now has a recovery path that does not deadlock a valid release after a protected-branch fix merge when stronger release-level context already exists.

### Fixed

- **#311** — `workflow_run` E2E evidence scoping now retains tracked-release context when the regression run happened before the release ticket landed on the triggering SHA.
- **#314** — evidence-completeness fallback logic now treats zero grep matches as a real `0` count under `set -e` / `pipefail` instead of aborting the release job early.
- **#304 / #320** — Windows PR-watch tests now execute the mocked `gh` binary through Node, making the cross-platform release watcher path deterministic in CI.

## [0.2.0] — 2026-06-27

### Added

- **#235** — v0.2.0 CLI Engine Architecture. New `devaudit-sdlc` CLI engine (`npx devaudit-sdlc --phase=<1-5|issue>`) that replaces plain-text sentinel writes with a JSON array of phase records. Each invocation appends a record with `activatedAt`, `currentPhase`, `initializedBy`, and `status` keys to `.sdlc-implementer-invoked`.
- **#235** — `--view` flag for `devaudit-sdlc` that outputs blueprint content to stdout without writing the sentinel. Allows human developers to read the full phase guides without triggering the SDLC gate.
- **#235** — Six phase guide blueprints moved to `sdlc/src/blueprints/*.raw.md` (full-text preserved). Original files in `sdlc/files/_common/` replaced with stubs pointing to CLI invocation.
- **#235** — `sdlc/package.json` with `devaudit-sdlc` bin entry (separate package from `@metasession.co/devaudit-cli`).
- **#235** — 35 tests covering phase parsing, `--view` flag, sentinel JSON array format, append behaviour, corrupt/legacy sentinel recovery, and legacy single-object migration.
- **#235** — `SKILL.md` sentinel write updated from `echo "INVOKED ..."` to `npx devaudit-sdlc --phase=issue`. All 6 blueprints updated from `touch .sdlc-implementer-invoked` to `npx devaudit-sdlc --phase=<N>`.

### Fixed

- CI `ci.yml.template` bundled-changes job: `fetch-depth: 0` on checkout + `SINCE_REF` fallback when ref cannot be resolved (prevents crashes on shallow clones and repos with short histories).

## [0.1.75] — 2026-06-26

### Added

- **#231** — Agent-agnostic SYSTEM OVERRIDE banners on all 6 SDLC stage docs (`1-plan-requirement.md` through `5-deploy-main.md` + `implementing-an-sdlc-issue.md`). Replaces Claude-specific STOP banners with branching logic: Claude Code invokes `sdlc-implementer` skill, other agents (Cursor, Windsurf, Gemini) ask operator for authorization and create `.sdlc-implementer-invoked` sentinel before proceeding.
- **#231** — `commit-msg` hook now checks for `.sdlc-implementer-invoked` sentinel on `feat`/`fix`/`refactor`/`perf` commits. Blocks the commit itself (not just the push) if the skill was not invoked. Housekeeping types exempt.
- **#231** — Agent-agnostic routing in all 4 AI rule files (`INSTRUCTIONS-SDLC.md`, `SDLC_RULES.md`, `.windsurfrules`, `CLAUDE.md`). The #199 prompt YES path and anti-pattern recovery now branch by platform instead of hardcoding Claude Code `Skill()` syntax.
- **#231** — Structural enforcement documentation added to `INSTRUCTIONS-SDLC.md` listing all enforcement layers (SYSTEM OVERRIDE banners, commit-msg sentinel, pre-push sentinel, CI provenance).

### Fixed

- **#231** — Vendor-lock bug: SSoT (`INSTRUCTIONS.md`) was hardcoding Claude Code API syntax (`Skill(name: …)`), forcing non-Claude agents to either fail or ignore the rules entirely. Now all agents have an actionable path.

## [0.1.74] — 2026-06-26

### Added

- **#229** — Anti-pattern self-check section added to all AI rule surfaces (`INSTRUCTIONS-SDLC.md`, `SDLC_RULES.md`, `.windsurfrules`, `CLAUDE.md`). Names the exact failure mode where the agent manually reads SDLC workflow files instead of invoking the `sdlc-implementer` skill, with a self-check list and STOP-and-invoke recovery instruction.
- **#229** — Driver clarity rule added to all AI rule surfaces. Every substantive SDLC response must open with a driver tag (`[Agent driving]` / `[Operator driving]` / `[Blocked]`) so the operator can tell at a glance whether they need to act.
- **#229** — `sdlc-implementer` SKILL.md in-chat LAST/NEXT section now includes the driver tag as the first line, before the LAST/NEXT content.

## [0.1.73] — 2026-06-26

### Fixed

- **Consumer report** — `pre-push` hook template used bash-only constructs (`set -euo pipefail`, `[[ ]]` pattern matching) that fail under husky v9's `/bin/sh` (dash) execution model. Replaced with POSIX-compatible equivalents: `set -eu`, `case` statements for pattern matching. The hook now runs under both bash and dash.

## [0.1.72] — 2026-06-26

### Added

- **#220** — New `generate-bundled-changes.sh` script in `sdlc/files/_common/scripts/`. Scans commits since a given ref, filters for housekeeping commit types (chore/docs/ci/build/test/revert/style/perf/refactor), outputs a markdown summary. Auto-synced to consumers via the scripts sync module. Used by the new "Generate and upload bundled changes" CI step in `ci.yml.template` to attach `bundled_changes` evidence to REQ-tagged releases.
- **#226** — Pre-push hook (`sdlc/files/stacks/node/hooks/pre-push`) now checks for E2E evidence (`.e2e-gate-passed` sentinel or `playwright-report/`) before allowing pushes with UI-facing file changes. Also checks for `.sdlc-implementer-invoked` sentinel when `feat`/`fix`/`refactor`/`perf` commits are present. Both checks are bypassable with `--no-verify` (CI provides the unskippable safety net).
- **#226** — `e2e-test-engineer` skill now writes `.e2e-gate-passed` sentinel after a successful E2E run (or `NOT_NEEDED` reason when e2e is not required). The sentinel is gitignored and checked by the pre-push hook and `sdlc-implementer` Phase 2 step 5b.
- **#226** — `sdlc-implementer` skill now writes `.sdlc-implementer-invoked` sentinel at Phase 0 when routing to the tracked path. The sentinel is gitignored and checked by the pre-push hook before allowing `feat`/`fix`/`refactor`/`perf` commits.
- **#226** — `sdlc-implementer` Phase 1 step 9 now stamps RTM rows with `sdlc-implementer@<version>` provenance marker. `validate-commits.sh` in CI checks for the stamp and fails if missing — unskippable safety net for `--no-verify` bypass.
- **#226** — New `gitignore.ts` sync module ensures `.e2e-gate-passed` and `.sdlc-implementer-invoked` are added to the consumer's `.gitignore` during `devaudit update`.
- **#226** — `sdlc-implementer` Phase 1 step 5b now extracts `test-scope.md` and `test-plan.md` from the implementation plan into `compliance/evidence/REQ-XXX/`. These are the CI validator's expected artefacts — without them, `validate-compliance-artifacts.sh` fails and the pre-push hook blocks the push. Includes drift management: re-extract when AC table changes.
- **#226** — `sdlc-implementer` Phase 3 step 6b now copies `implementation-plan.md` from `compliance/plans/` to `compliance/evidence/` so the CI validator finds it in the expected location.
- **#226** — `sdlc-implementer` SKILL.md now includes "Native agent responsibilities and re-invocation protocol" section. Documents the skill/native-agent boundary, the resume protocol (`resume REQ-XXX — <detour>, re-enter at Phase N`), idempotent state re-read on re-entry, and the "PR merged to main ≠ done" rule.
- **#226** — `sdlc-implementer` SKILL.md now includes commit-scoping rule for SRS updates: commit subject must cite the active REQ only; other REQs appear in the body for traceability. Prevents the portal's commit scanner from associating out-of-scope REQs with the current release.
- **#226** — `sdlc-implementer` Phase 5 now includes explicit close-out steps: update RTM to `APPROVED - DEPLOYED`, move release ticket from `pending-releases/` to `approved-releases/`, verify portal approval, commit and push the close-out. Phase 5 step 0 re-reads state on resume.
- **#226** — Pre-push hook now runs `validate-compliance-artifacts.sh` as a fourth check for tracked commits. Blocks push if `test-scope.md`, `test-plan.md`, or `implementation-plan.md` is missing from `compliance/evidence/`.

### Changed

- **#220** — `devaudit update` suggested commit message now includes `[skip ci]` so automated template syncs don't trigger CI or create portal release records. Housekeeping changes from skipped syncs are bundled into the next REQ-tagged release via `generate-bundled-changes.sh`.
- **#226** — `ci.yml.template` `register-release` job no longer creates portal release records with `--create-release-if-missing`. Release creation moved to the `upload-evidence` job (which runs after gates), so the portal never shows a release from a push where gates weren't verified.
- **#226** — `sdlc-implementer` Phase 2 now includes step 5b — E2E gate verification that halts before commit if UI-facing files changed and no E2E evidence exists.

### Fixed

- **#228** — `compliance-evidence.yml.template` and `incident-export.yml.template` had multi-line shell string assignments (`ISSUE_BODY`, `SUMMARY`, `CONTAINMENT`) whose continuation lines were at 0 indentation. This terminated the YAML literal block scalar, causing `**` markdown bold to be parsed as YAML alias references — producing invalid workflows that GitHub Actions could not load. Fixed by replacing inline string assignments with `cat <<EOF` heredocs, with content indented to match the `run: |` block. A `sed` step strips the extra indentation before the variable is used. YAML validation test added to `cli/test/update.test.ts` across all fixture variants.

## [0.1.62] — 2026-06-20

### Added

- **#186** — `feature-e2e.yml.template` now includes full E2E infrastructure: services block, `DATABASE_ENV`/`APP_ENV` env blocks, `DATABASE_URI_STEP` for dynamic port resolution, `E2E_SETUP_STEP` for pre-test seeding, dev server startup + `wait-on`, `E2E_NEW_SPECS` computation for origin tagging, and `E2E_FEATURE_TEST_STEP` block token (built by `buildFeatureE2eTestStep` in `ci-templates.ts`). Mirrors `ci.yml.template`'s E2E setup — without this, consumers with databases, seeding, or auth env vars would see the workflow fail before tests execute.

- **#170** — `e2e-test-engineer` SKILL.md now includes Phase 5½ (evidence wiring validation) between Phase 5 and Phase 6. For each in-scope REQ, checks `@requirement` annotations, `evidenceShot()` calls per AC, and `[REQ-XXX]` test title tags. Halts before Phase 6 if any check fails — prevents specs from passing Phase 6's "AC covered" check without producing portal evidence.

- **#169** — `ci.yml.template` now includes an evidence-completeness gate in the `upload-evidence` job. REQs with zero screenshots are tracked in `ZERO_Screenshot_REQS` and checked against the Playwright JSON report for tagged tests. If a REQ has zero screenshots AND zero tagged tests, the step exits 1 — the release cannot proceed to UAT with no traceable evidence.

- **#171** — `sdlc-implementer` SKILL.md now includes a cross-phase scope-expansion halt gate. Fires on any user work request while a REQ is active, in any phase (2–5). If the request doesn't map to an existing acceptance criterion, the agent halts with options: (a) file a separate issue, (b) amend REQ scope, (c) abandon. Generalises the change-request loop's scope-expansion halt to all phases.

### Changed

- **#186** — `RENDER-002` block map now includes `E2E_FEATURE_TEST_STEP` alongside `E2E_TEST_STEP`. `feature-e2e.yml.template` uses the same `stripServicesBlock` and block substitution pipeline as `ci.yml.template`.

## [0.1.61] — 2026-06-18

### Added

- **#175** — SDLC stage evidence dimension. `scripts/upload-evidence.sh` accepts `--sdlc-stage <1-5>` (validated, forwarded as `sdlcStage` form field). All CI templates now stamp the producing stage: `ci.yml` → stage 2 (implement & test), `compliance-evidence.yml` committed docs → stage 3 (compile evidence), `compliance-evidence.yml` E2E regression → event-derived stage 2 (PR) / 5 (push), `post-deploy-prod.yml` → stage 5 (deploy). Backward-compatible: absent flag = no field sent; older portals ignore it.

- **#174** — New `feature-e2e.yml.template` workflow for feature-branch in-scope E2E. Runs specs tagged with the branch's REQ on PRs to `develop`, uploads the Playwright report as stage-2 with `origin=feature` metadata so the portal can exclude it from release/UAT completeness. Registered in `CI_TEMPLATES` array for `devaudit install` / `devaudit update`.

### Changed

- **#175** — `compliance-evidence.yml` E2E regression upload now zips the full `playwright-report/` directory and uploads the `.zip` bundle instead of bare `index.html`, matching the pattern already used in `ci.yml`. Ensures screenshots and traces are included in the portal-rendered report.

## [0.1.60] — 2026-06-14

### Fixed

- **Consumer report** — Generated `ci.yml` workflows now run `Quality Gates` on pull requests targeting `develop`, so `gh pr checks <PR>` reports the merge-time gate before integration. Release registration and evidence upload remain push/manual-dispatch only, preventing PR checks from mutating DevAudit release records.

## [0.1.59] — 2026-06-13

### Added

- **Consumer report** — `devaudit update` now generates a root `AGENTS.md` pointer for Codex / AGENTS-compatible agents. `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, and `GEMINI.md` all defer to `INSTRUCTIONS.md` as the single source of truth; `AGENTS.md` also reminds agents to read the relevant `SDLC/` workflow file for the current stage. `devaudit status` now checks for `AGENTS.md`.

### Changed

- **Consumer report** — SDLC instructions now distinguish targeted local verification from CI/UAT-owned full E2E gates. Agents must confirm local services, secrets, seeded data, auth fixtures, and browser dependencies before starting a full local Playwright run; LOW-risk docs/tooling/script-only changes use the approved targeted local checks unless the operator explicitly requests a full local suite.

### Fixed

- **Consumer report** — Evidence uploads now use bounded per-attempt network timeouts in both `scripts/upload-evidence.sh` and `devaudit push`. A stalled portal connection fails clearly, retries within the configured attempt budget, and no longer leaves consumer CI hanging indefinitely on "Generate and upload gate evidence".

## [0.1.58] — 2026-06-11

### Fixed

- **#162 (regression in 0.1.56)** — `devaudit update` crashed on every invocation with `TypeError: cmd.optsWithGlobals is not a function`, introduced by the #154 dry-run wiring. commander calls an action with `(…declared-args, options, command)`; `update` has two declared args, so the `Command` is the **fourth** parameter, but the handler bound `cmd` to the third (the options object). The parameter list is corrected. A regression test now drives the **built binary** through commander — the existing `runUpdate` unit tests call the function directly and never exercised the action's argument binding, which is why 0.1.56/0.1.57 shipped broken.

## [0.1.57] — 2026-06-11

### Changed

- **Node 24 GitHub Actions.** Bumped all first-party actions off the Node 20 runtime GitHub is deprecating (Node-20 actions forced to Node 24 from 2026-06-16, Node 20 removed from runners 2026-09-16). This repo's own workflows and the rendered consumer CI templates move `actions/checkout@v4 → v6` and `actions/setup-node@v4 → v6`; the templates additionally move `actions/setup-python@v5 → v6`, `actions/upload-artifact@v4 → v7`, and `actions/download-artifact@v4 → v8`. All target majors were verified to run on `node24`. Consumers pick up the updated workflow actions on their next `devaudit update`.

## [0.1.56] — 2026-06-11

### Fixed

Batch fix of the bugs surfaced by the SRS reverse-engineering (Appendix A of `docs/SRS.md`, #153).

- **#154** — `devaudit update --dry-run` no longer mutates the consumer tree. The flag was parsed but never forwarded from the `update` action into `runUpdate`, so a "preview" still wrote files. It now short-circuits before the sync (mirroring `install`'s dry-run), printing the consumers it would sync and writing nothing.
- **#155** — `devaudit push` reaches parity with `scripts/upload-evidence.sh`: recursive directory upload (`find -type f` semantics), retry budget raised to 5 with a `UPLOAD_MAX_ATTEMPTS` override, unedited starter-stub skip (the "STARTER TEMPLATE" banner, #133), a base-URL drift warning that probes `/api/health`, the `releaseBranch` / `releaseTitle` (`--release-title`) / `changeType` (`--change-type`) / `gateStatus` (`--gate-status`) form fields, repeatable `--meta-key key=value`, and the client-side `--environment requires --release` / `--release requires --category` validations.
- **#156** — node `ci.yml`'s evidence jobs (`register-release`, `upload-evidence`) now resolve the DevAudit base URL from `sdlc-config.json` `devaudit.base_url` (falling back to the deprecated repo Variable `DEVAUDIT_BASE_URL`), matching `compliance-evidence.yml` / `check-release-approval.yml`. Previously the jobs were gated on the repo Variable, so a consumer that had moved base_url into `sdlc-config.json` silently skipped release registration + evidence upload.
- **#157** — python `ci.yml` uploads SAST results as `evidence_type=sast_report` and the dependency audit as `dependency_audit` (matching the node template) instead of the catch-all `audit_log`, which made the portal's SAST and Dependency panels show identical content (devaudit#387, previously unfixed for python).
- **#158** — stack/host adapter manifests are validated against their JSON Schema (`adapter.schema.json`, via Ajv) at load time; a parseable-but-schema-invalid `adapter.json` now fails loudly instead of silently rendering broken CI/hooks into a consumer.
- **#159** — `devaudit doctor`'s description now matches what it actually checks (tools on PATH + a release close-out drift check, not "auth state / config validity"); the `bootstrap-governance` docstrings quote the real starter banner ("REPLACE BEFORE COMMITTING").

## [0.1.55] — 2026-06-11

### Changed

- **Documentation overhaul (docs-only release).** Three docs PRs bundled — no CLI behaviour changes; the published tarball's bundled `sdlc/files/` snapshot picks up one minor SKILL.md edit (broken cross-reference removed in `adr-author/SKILL.md`).
  - **#150** — `npm install -g …` no longer the documented canonical CLI invocation. `npx @metasession.co/devaudit-cli@latest <command>` is now the canonical zero-install form across `README.md`, `cli/README.md`, `docs/onboarding.md`, `docs/consuming-projects.md`. Adds four new client-facing reference docs: `docs/skills.md` (the six AI skills), `docs/compliance-gates.md` (the five CI workflows), `docs/evidence-tiers.md` (Tier 1/2/3 split), `docs/e2e-test-tiers.md` (smoke/critical/regression). `sdlc-framework.md` refreshed with cross-references to the new docs. README documentation table restructured into "concept overviews / operator walkthroughs / extending the framework" groups.
  - **#152** — Stale planning docs removed (-875 lines): `docs/devaudit-cli/README.md` (pre-v0.1.0 design brief), `docs/devaudit-cli/build-plan.md` (executed engineering plan), `docs/devaudit-cli/ADR-001-language-and-distribution.md` (engineering ADR), `sdlc/article.md` (long-form essay superseded by the new client-facing docs). 8 active references scrubbed across `README.md` / `cli/README.md` / `cli/src/commands/stub.ts` / `INSTRUCTIONS.md` / `.github/ISSUE_TEMPLATE/requirement.yml` / `sdlc/CLAUDE.md` / `sdlc/files/_common/skills/adr-author/SKILL.md` / `docs/sdlc-framework.md`.
  - **#153** — New `docs/SRS.md` (190 requirements, Given/When/Then) reverse-engineered from the CLI + framework templates. 87 Must / 72 Should / 27 Could / 4 Won't. Identified vitest 4 + msw + execa as the existing test stack; recommends an execa-against-`bin/devaudit.js` CLI-integration layer between the existing unit tests and the consumer-side smoke runs. Appendix A flags real CLI bugs / brief-vs-code divergences for follow-up.

## [0.1.54] — 2026-06-11

### Fixed

- **devaudit-installer#149** — `compliance-evidence.yml.template` now adds a `workflow_run` trigger that listens for completed `E2E Regression` workflow runs. A new sibling job (`upload-e2e-regression-evidence`) downloads the prior run's `e2e-regression-report` artifact via `actions/download-artifact@v4` `run-id`, derives the release version against the triggering SHA, and uploads `e2e-regression-results.json` as `evidence_type=e2e_result` + `playwright-report/index.html` as `evidence_type=test_report` against each in-scope REQ. Tier metadata (`critical` for PR-to-main, `regression` for push-to-main) ships in the `meta-key tier=…`. Closes the gap where the UAT four-eyes reviewer only saw smoke-tier evidence from the feature PR's develop merge — the broader sweep against the about-to-be-promoted integration code now reaches the portal too.

- **devaudit-installer#147** — `ci.yml.template` Upload Evidence step now scopes the screenshot glob per-REQ INSIDE the in-scope-REQs loop instead of taking one project-wide glob and uploading the cross-product against every in-scope REQ. Out-of-scope REQs' legacy PNGs whose filenames don't match `REQ-XXX-AC<n>-<slug>.png` no longer 400 against the portal's filename validator. Screenshot upload failures now feed the same `UPLOAD_FAILURES` counter that gate uploads use, so a rejected screenshot turns the step RED instead of silently warning. Caught on example-app where REQ-007's pre-`evidenceShot` legacy folder of 21 numbered PNGs was being globbed into every release's upload attempt and silently warning while the step reported SUCCESS.

- **devaudit-installer#143** — `scripts/upload-evidence.sh` now follows HTTP 3xx redirects (`curl -L --max-redirs 3`) so a portal host migration (e.g. `devaudit.metasession.co → devaudit.ai`) no longer breaks every consumer's CI evidence upload with `HTTP 301`. The script also probes `DEVAUDIT_BASE_URL` at startup and logs a loud `WARNING:` line when the configured base URL redirects to a different host, nudging the operator to rotate the secret. Uploads succeed in the same run because curl follows the redirect; the warning is the nudge, not a hard stop.
- **devaudit-installer#144** — Sub-skill return semantics clarified across `sdlc-implementer`, `requirements-aligner`, `adr-author`, `risk-register-keeper`. The previous literal phrasing _"Hand-off back to `sdlc-implementer`"_ read as "stop and wait for the operator" and caused the orchestrator to pause mid-Phase between sub-skill returns; the operator had to manually nudge the agent four times in one example-app REQ-077 cycle. Sub-skill tails now say _"Return to the running `sdlc-implementer` context"_ and `sdlc-implementer/SKILL.md` carries a new § _Sub-skill return semantics_ rule: skills run in the same invocation context, control returns synchronously, the only pauses are the explicitly-named checkpoints (Phase 1 HIGH/CRITICAL plan-approval, Phase 4 release-PR hard stop, Phase 5 separate invocation). Opt-in-to-pause, not opt-out.
- **devaudit-installer#146** — `compliance-evidence.yml.template` now routes the SoT-alignment skill artefacts (`srs-alignment.md`, `architecture-decision.md`, `risk-assessment.md`) to their dedicated evidence types instead of the catch-all `compliance_document`. Previously every per-REQ `.md` except `test-execution-summary.md` was uploaded as `compliance_document`, so the portal's framework-coverage matrix reported `SOC2.CC3.2` MISSING and `ISO27001.A.8.25` PARTIAL despite the files being present on the release — the clause predicates expect `evidence_type=risk_assessment` and `architecture_decision` respectively, not the historical catch-all. The per-REQ basename → `(evidence_type, evidence_category)` routing is now a `case` block, ready to grow for future skill-produced artefacts.

- **devaudit-installer#145** — `sdlc-implementer` Lightweight path step 7 now adapts to the project's CI trigger shape. The DevAudit-Installer-generated `ci.yml.template` defaults to **post-merge-only** triggers (`push: branches: [<integration>]` with no `pull_request:` trigger) so the previous _"wait for CI"_ instruction was unactionable on a PR (no checks would ever fire). Step 7 now reads the project's `ci.yml`, distinguishes PR-time CI from post-merge-only CI, and tells the LAST/NEXT sticky to surface the right wording (_"no PR-time checks will fire; review + merge is the gate; CI runs post-merge on `$INTEGRATION_BRANCH`"_). The Lightweight-path intro also names the default trigger shape so the agent doesn't poll a PR for checks the template doesn't trigger.

## [0.1.53] — 2026-06-09

### Changed

- **Three-tier E2E gating model** — formalises smoke (every push, ~3–5 min) / critical (PR-to-release-branch, ~10–15 min) / regression (nightly + post-merge + dispatch, full audit trail). The third tier (critical) is new; it bridges between fast smoke and full regression so release-PRs no longer wait 30+ minutes on the full pack. MoSCoW priority drives tier choice via file location: `e2e/smoke/`, `e2e/critical/`, `e2e/<area>/`. Post-merge `push: branches: [release]` runs the full regression + auto-files a `bug, priority:high` issue if a spec slipped past the critical-tier PR gate — operator triages within working hours (hotfix forward, revert, or accept-with-rationale). No automated revert; false positives + flakes + UAT-data drift are real classes that need human judgement.

  Ships as a framework convention, not a synced workflow: the framework provides a copy-pasteable reference at `skills/e2e-test-engineer/references/e2e-regression-3-tier.yml` that operators apply to their consumer-owned `e2e-regression.yml`. The framework does NOT sync `e2e-regression.yml` (consumers customise it per project) — overwriting that file is held off until the sync-survival escape hatch (#84) ships.

  Touch points:
  - `Test_Strategy.md` § *System Testing (E2E)* — new sub-section names the 3 tiers + cost philosophy + post-merge safety net
  - `Test_Policy.md` § *Risk-Based Testing* — new sub-section pins gate enforcement language ("Must in smoke + critical: pre-merge blocking; Should/Could in regression: post-merge auto-issue or accepted-with-rationale")
  - `Test_Architecture.md` § *Speed over Exhaustiveness* — cross-refs the new model as the first concrete implementation of "Strategic test selection"
  - `skills/e2e-test-engineer/SKILL.md` Phase 3 — adds a tier classification decision tree authors apply per spec; recorded in the eventual `test-execution-summary.md` § *Test design* (devaudit#50)
  - `skills/e2e-test-engineer/references/e2e-regression-3-tier.yml` — NEW reference workflow consumers copy into their own `e2e-regression.yml`. Includes critical-with-smoke-fallback selector + post-merge auto-issue logic.

## [0.1.52] — 2026-06-09

> 0.1.50 and 0.1.51 were bumped on-disk but never tagged — their contents are folded into this release to minimise consumer-side bumps. Consumers update from 0.1.49 directly to 0.1.52 in a single `devaudit update` and pick up all three of #152, #127, #50 together (Bundle C).

### Changed

- **devaudit#152** — SDLC Stage 1 hardening: the implementation plan now structurally catches the failure mode where green gates ship a feature with no UI surface that a user can reach (the REQ-030 / a consumer pattern). Three additive doc edits — `Implementation_Plan_TEMPLATE.md` Section 1 (Goal + ACs) now opens with a Given/When/Then writing guide that names the format directly; Section 2 (Scope) gains a **Surface inventory** sub-section listing every user-touchable surface as `In scope` / `Already works` / `Out of scope (waived)`; `1-plan-requirement.md` Step 6 WAIT CHECKPOINT gains two new gate bullets (surface-inventory completeness + AC form) and Step 7's three test-scope heredocs (LOW / MEDIUM / HIGH) carry tier-appropriate AC-writing guidance above each `## Acceptance Criteria` heading. The original REQ-030 failure mode — `AC1: schema accepts inventoryId field` passing review as a valid behavioural AC — is now structurally caught at the plan-review gate.
- **#127** — `e2e-test-engineer` skill now explicitly handles transport-layer specs (Node `fetch` against webhooks, `MongoClient` queries, `socket.io-client` assertions) that live in `e2e/` but cannot call `evidenceShot` because they have no Playwright `page` object. Skill scope clarified — transport-boundary integration tests are IN scope (the existing "API-only" exclusion means unit-level route-handler tests, not transport-boundary integration). New "Specs with no page object" sub-section names the evidence form for these specs: per-spec entry in `test-execution-summary.md` describing the asserted behaviour in operator terms, with `[REQ-XXX][ACn]` bracket convention in the test title. Release-detail "screenshots" panel showing zero entries for purely-transport REQs is correct; reviewers cross-reference the test-execution summary instead. `2-implement-and-test.md` Step 4 carries the same callout so the operator sees it at the right point in the workflow.
- **#50** — `test-execution-summary.md` now carries a `## Test design` section at the top that records the design-time decisions (layers planned vs covered, deferral rationale, skill-invocation attribution). Closes the loop with #47/#132/#133/#152: the SDLC now has a recorded trace that scope was *decided*, not implicit — schema-only changes can state `e2e N/A — schema-only, no UI yet` explicitly rather than silently shipping unit+manual. Three additive edits: `3-compile-evidence.md` Step 1a heredoc grows the new section; `e2e-test-engineer/SKILL.md` Final report directs the operator to populate it with the skill's decisions + a verifiable turn pointer. The existing Test Reports gate continues to feed on `test_report` evidence; this enriches what's *in* the file without changing the gate mechanics.

## [0.1.49] — 2026-06-09

> 0.1.48 was bumped on-disk but never tagged — its contents are folded into this release to minimise consumer-side bumps. Consumers update from 0.1.47 directly to 0.1.49 in a single `devaudit update`.

### Added

- **devaudit#131** — SDLC navigability: every long-running REQ issue now carries an always-current `LAST` / `NEXT` status sticky comment, updated by `sdlc-implementer` at every phase transition + every operator-action handoff. New `scripts/update-sdlc-status.sh` is the idempotent helper (find-or-create via marker-tagged comment; `--dry-run` for safe inspection). The skill body now invokes it at the start of Phase 1, the end of Phases 1/2/3/4, and at every Phase 5 terminal (released / change-request loop / incident). Skill body also documents the matching `LAST: / NEXT:` chat-output convention. Operators returning to a long thread can now find "what just happened + what's next" without re-scrolling. 12 new hermetic tests over the helper.

### Changed

- **devaudit#132** — `sdlc-implementer`'s e2e delegation contract is now backed by two structural gates inside Phase 2, not just MUST-prose. Step 3 requires a literal pre-test-work declaration (`Delegating e2e test work to e2e-test-engineer.`) before any `e2e/**/*.spec.ts` edit, immediately followed by a `Skill(name: "e2e-test-engineer", …)` invocation. New step 9 (before Phase 3) is a mandatory self-audit: every `*.spec.ts` in the diff must be placed in one of two categories ("authored via skill on turn N" / "mechanical edit only"), or the orchestrator STOPs and reverts. Both gates exist because the rule alone was bypassed by inertia in past runs (REQ-075 + REQ-076 receipts); the gates are scripts the agent follows, not prose it can rationalise around.

## [0.1.47] — 2026-06-08

### Fixed

- **devaudit#133** — Unedited governance starter stubs (incident-report.md, etc.) no longer flip framework-coverage clauses to COVERED off placeholder content. `scripts/upload-evidence.sh` now skips any file still carrying the `STARTER TEMPLATE — REPLACE BEFORE …` banner (matches both v0.1.36+ "BEFORE COMMITTING" and pre-v0.1.36 "BEFORE GOING TO PRODUCTION" phrasings). Central guard protects every upload path — governance helper, per-REQ loop, future callers. New `SKIPPED` counter in the summary; exit code unchanged (only `FAILED > 0` exits 1).
- **devaudit#133** — `compliance-evidence.yml.template` now globs `incident-report*.md` (under both top-level and `compliance/governance/`) so real per-incident files written by `incident-export.yml` upload as evidence. Previously the exact-name match missed `incident-report-<id>.md` entirely.
- Doc accuracy: `incident-report.md.template` reflects the new behaviour — unedited stub is held back; COVERED flips only when a non-stub matches the glob.

## [0.1.8] — 2026-05-24

### Fixed

- `derive-release-version.sh` now also resolves a bracketed `[REQ-XXX]` tag in the **commit body**, not just the subject + `Ref:` line. A "Merge pull request …" commit carries the PR title (with its `[REQ-XXX]` tag) in the body, so PR-merged requirements were falling through to the date fallback and fragmenting onto a phantom `v<date>` release at `ci.yml`'s register-release step. Bracketed-only, so unbracketed prose ("target close: REQ-002") still can't beat a real `Ref:`. Regression-tested (case 8).

## [0.1.7] — 2026-05-24

### Fixed

- Bundled `post-deploy-prod.yml` now uploads the release ticket to the **production** environment (`release_artifact`) alongside the smoke results. Submit-for-production-review requires a release ticket in the production env (`STATUS_ENVIRONMENT[prod_review] = 'production'`), but the dev/UAT pipeline only uploaded it to `uat` — so the prod-review submission was unsatisfiable. The promoted release's ticket is now carried forward to production.

## [0.1.6] — 2026-05-24

### Fixed

- Bundled `post-deploy-prod.yml` now resolves the **promoted REQ release** instead of a date-prefixed one. It derives the version from the commits merged into the push (`[REQ-XXX]` subject tags / `Ref:` lines, `fetch-depth: 0`), falling back to a bare date only for date-versioned consumers. Previously a REQ-versioned release never converged at the production stage — prod evidence and the `prod_review` advance landed on a phantom `v<date>` release while the real REQ release stayed `uat_approved`.

## [0.1.5] — 2026-05-24

### Fixed

- Bundled `derive-release-version.sh` now reads the release id from the `[REQ-XXX]` subject tag or the `Ref:` line only — not the first `REQ-\d+` anywhere in the commit body. A prose forward-reference (e.g. "target close: REQ-002" before "Ref: REQ-001") no longer misroutes a release's gate evidence onto a phantom release named after the wrong requirement. Regression-tested (case 7). Same greedy-prose class as the 0.1.4 validator fix.

## [0.1.4] — 2026-05-24

### Fixed

- Bundled compliance validator (`sdlc/files/_common/scripts/validate-compliance-artifacts.sh`) now scopes requirement extraction to the commit `[REQ-XXX]` subject tag and `Ref:` trailer, instead of scraping the entire commit body. Prose forward-references like "target close: REQ-002" no longer cause CI to demand evidence dirs for requirements that haven't started. New regression case in the validator test suite (17 pass). Consumers pick this up on the next `devaudit update`.

## [0.1.3] — 2026-05-24

> Supersedes a broken manual `0.1.2` publish whose tarball carried an unresolved
> `@metasession.co/devaudit-plugin-sdk: file:../plugin-sdk` dependency (the manual
> `npm publish` bypassed `release.yml`'s `file:`→`^version` rewrite, so `npm i -g`
> failed). `0.1.2` is deprecated; this is the same change set published correctly
> via the tagged CI release. Lockstep release across all four packages.

### Added

- **Templates are now bundled into the package.** `prepack` runs `tools/bundle-templates.mjs`, which copies `sdlc/` and `scripts/upload-evidence.sh` from the repo root into the package, and `package.json` `files` ships them. The published tarball is self-contained — `devaudit install` / `devaudit update` work from a global `npm i -g` install with no DevAudit-Installer checkout. Implements the bundling design in `docs/devaudit-cli/build-plan.md` / ADR-001.

### Changed

- `resolveInstallerRoot()` now locates templates by the presence of `sdlc/files` (priority: `DEVAUDIT_INSTALLER_ROOT` → bundled package snapshot → repo root), instead of probing for `scripts/sdlc-onboard.sh`. The CLI no longer depends on the bash installer existing.

### Removed

- The bash installer (`scripts/sdlc-onboard.sh`, `scripts/sync-sdlc.sh`) has been removed from the repo. `devaudit install` / `devaudit update` are the only supported onboarding/sync path. (`scripts/upload-evidence.sh` stays — it's synced into consumers and bundled here.)

## [0.1.1] — 2026-05-19

### Fixed

- `devaudit --version` now reports the actual package version instead of a stale hardcoded `0.0.1`. Version is read from `package.json` at build time via a typed JSON import; tsup inlines it into the bundle. The constant can no longer drift from the published version.

### Docs

- `cli/README.md` now leads with the `npm install -g @metasession.co/devaudit-cli` snippet so the npm-registry page guides users straight to install. Status section bumped to 0.1.1.

## [0.1.0] — 2026-05-19

First public release. Package renamed from `@metasession-dev/devaudit-cli` (GitHub org scope) to `@metasession.co/devaudit-cli` (npm org scope). Repo flipped public; Apache-2.0 licensed. Published to npmjs.org with SLSA provenance.

### Added

- `devaudit push --dry-run` now short-circuits before any portal mutation. The CLI enumerates which evidence files would be uploaded (via the same `collectFiles` logic the live upload uses) and prints them; no POST to `/api/evidence/upload` happens. Operators can safely preview a push before running it for real. Combined with `--json`, dry-run emits a single structured planned payload: `{ dryRun: true, projectSlug, requirementId, evidenceType, baseUrl, files, metadata, ... }`.
- `devaudit auth status --json` emits one parseable JSON object instead of a stream of pretty log lines. Shape: `{ ok: true, source: 'env' | 'file', baseUrl, projects: [...slugs] }` on success; `{ ok: false, reason: 'not_logged_in' | 'portal_rejected' | 'unexpected', ... }` on failure. Prose path unchanged.
- `devaudit status --json` emits one structured object: `{ ok, projectPath, project_slug, stack, host, node_version | python_version, devaudit_base_url, uat_enabled, approval_mode, files_present, files_missing }`. The `not_onboarded` failure path also emits structured JSON when `--json` is set. Useful for piping into other tools.
- `lib/logger.ts` exports `isJsonMode()` and `emitJsonResult(payload)` — small helpers so commands can branch on JSON mode and emit a single result line rather than rely on consola's per-log JSON records.

### Fixed

- `devaudit install --yes` on an existing consumer no longer wipes rich `sdlc-config.json` customizations. Previously the `--yes` path read only 4 fields (`project_slug`, runtime version, `source_dirs`, `working_directory`) and the write step then rebuilt the config from defaults — so re-running install on a customized consumer (e.g. a consumer, which has `runner: self-hosted`, `sast_baseline: 6`, `database_service: mongodb`, custom `build_env`, custom `paths_ignore`, etc.) would erase all of those fields. Now `write-config.ts` reads the existing config and merges: wizard-owned fields (stack/host/slug/runtime/source_dirs/working_directory/production_url_secret/devaudit block) always come from the current plan; everything else is preserved if present, defaulted otherwise. `prompts.ts:planFromConfig` also now reads `production_url_secret` from the existing config so the wizard doesn't overwrite a custom-named secret. Caught during the consumer smoke against PR #8; new vitest case in `install.test.ts` seeds a richly customized config and asserts every non-wizard field survives a `--yes` re-install.

### Added

- `devaudit plugin install / list / remove / update` are now functional (slice 3 of workstream D), replacing the previous stubs. `install <git-url>` does `git clone --depth 1` into `~/.config/devaudit/plugins/<derived-name>/`, runs `npm install --legacy-peer-deps`, then validates the manifest via the SDK — on validation failure the directory is rm-rf'd and the operator gets a clear error. `list` discovers plugins under `~/.config/devaudit/plugins/`, prints each loaded plugin's name+version+hooks+commands, and surfaces failed-to-load plugins with their reason. `remove <name>` matches by package name or directory name and removes the dir. `update` runs `git pull --ff-only` + `npm install` in each git-backed plugin dir; non-git plugin dirs are skipped with a warning. Each command accepts an optional `root` override for testability. Portal-registry-backed name resolution (e.g. `devaudit plugin install devaudit-plugin-prisma`) remains pending — see #6.
- Plugin loader (slice 2 of workstream D). New `cli/src/lib/plugin/` module discovers plugins under `~/.config/devaudit/plugins/<name>/`, validates each manifest via `@metasession.co/devaudit-plugin-sdk`'s `validateManifest()`, dynamic-imports each main module, and registers plugin-contributed commands under `devaudit <plugin-name> <sub-cmd>`. `runHook(plugins, hookName, ctx)` is wired into `install` (`beforeInstall` / `afterInstall`), `update` (`beforeSync` / `afterSync`), `push` (`beforePush` / `afterPush`), and `doctor` (`onDoctor`) — per-plugin errors are isolated so a misbehaving plugin can't crash the CLI. CLI now depends on `@metasession.co/devaudit-plugin-sdk` via `file:../plugin-sdk` (CI builds the SDK first). 7 new vitest cases cover discovery, runtime apiVersion mismatch, error isolation, skip on missing hook, and commander command registration. Plugin install/list/remove/update CLI commands stay stubbed pending the portal plugin registry (slice 3+ of workstream D).
- `GitProvider` abstraction (workstream C). New `cli/src/lib/git-provider/` module exports a `GitProvider` interface plus a shipping `GitHubProvider` implementation. The provider prefers the `gh` CLI when on PATH and falls back to direct REST against `api.github.com` (with `GH_TOKEN`/`GITHUB_TOKEN`) for everything except secret-set (sodium encryption required — `gh` CLI must be present for that one op). `detectProvider()` parses `git remote get-url origin` and returns `github` / `gitlab` / `bitbucket` / `self-hosted`; only GitHub is wired up — other hosts throw a clear "not yet supported" error. Install steps 7 (secrets/variables) and 9 (branch protection) refactored to consume `GitProvider`, dropping their direct `execa('gh', …)` calls. 7 new vitest cases plus updated `install.test.ts` (uses a fake provider for injection-style mocking).
- Native TS port of `sdlc-onboard.sh` (workstream A milestone 3). `devaudit install` no longer shells out to bash; each of the 11 onboarding steps lives in its own module under `cli/src/install/`: auth-probe, detect-stack, prompts, write-config, project, api-key, github, hooks-bootstrap, branch-protection, sync-templates, done-report. Orchestrator threads `--dry-run` (planned actions, no mutations) and `--yes` (non-interactive — reads `sdlc-config.json` for defaults). Step 10 reuses the native `syncProject()` so the sync no longer shells out to `sync-sdlc.sh` either. `DevAuditClient.listApiKeys(projectId)` was added so step 6 stays idempotent against a portal-tracked `Onboarding-issued` key. 5 new vitest cases cover dry-run, full-run with mocked HTTP+gh, missing stack, PAT rejection, and the existing-key warn path.

### Planned for v0.1.0

- Native TS port of `sync-sdlc.sh` (workstream A milestone 4) — landed in #7
- `--json` output mode tightened on every command, with a versioned event schema
- `--yes` / `--dry-run` honoured by every mutating command — `install` honors both; other commands TBD
- npm publish (private scope first)

## [0.0.1] — 2026-05-18

First public commit on `metasession-dev/DevAudit-Installer`. Skeleton + working commands per workstream A milestones 1, 2, 5, 6 of [`docs/devaudit-cli/build-plan.md`](../docs/devaudit-cli/build-plan.md).

### Added

- Bootstrap (commit `48916b8`): Node/TS ESM sub-package under `cli/`, commander-based CLI, full command surface registered, common flags (`--json` / `--yes` / `--dry-run` / `--verbose` / `--no-color` / `--org`), consola logger
- `devaudit --help` and `--version` (commander default behaviour)
- `devaudit doctor` — verifies `node>=22`, `git`, `gh`, `jq`, `curl` are on PATH
- `devaudit status [path]` (commit `a133b8b`) — reads `sdlc-config.json` from a consumer project, prints stack/host/slug/source-dirs/devaudit-url/uat-state/approval-mode, and probes 10 framework files for presence
- `devaudit auth login` — interactive PAT paste flow via `@clack/prompts`, validates against `GET /api/projects`, stores at `~/.config/devaudit/auth.json` (mode 0600)
- `devaudit auth logout` — wipes the cached token
- `devaudit auth status` — verifies the cached token (or `DEVAUDIT_USER_TOKEN` env var) via portal
- `devaudit push <slug> <req> <type> <file>` — port of `scripts/upload-evidence.sh`. POST to `/api/evidence/upload` with `Authorization: Bearer DEVAUDIT_API_KEY`, multipart/form-data body. Single file or directory. Retries on 429/5xx with exponential backoff, honours `Retry-After`. All upload-evidence.sh flags preserved.
- `devaudit install [path]` — **v0 wrapper** that shells out to `scripts/sdlc-onboard.sh` with stdio inheritance. Native port pending.
- `devaudit update <version> <paths...>` — **v0 wrapper** that shells out to `scripts/sync-sdlc.sh`. Native port pending.
- 7 vitest tests
- GitHub Actions workflow at `.github/workflows/cli.yml` — lint + typecheck + build + test on Linux/macOS/Windows (node 22)

### Stubbed (not implemented; exit code 1 + pointer to build plan)

- `devaudit org list / switch / policy list|apply / report` — needs portal RBAC + policy engine + reporting endpoints (workstream B)
- `devaudit plugin list / install / remove / update` — needs portal plugin registry + plugin SDK (workstream D)
- `devaudit config get / set / list`
- `devaudit upgrade`
