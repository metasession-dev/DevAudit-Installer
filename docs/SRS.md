# Software Requirements Specification — DevAudit-Installer (CLI + Framework, E2E-oriented)

> **Status:** Living document. Reverse-engineered from the codebase at `origin/main` (`a0f7b0f`, 2026-06).
> **Audience:** CLI/framework developers and Claude Code's `e2e-test-engineer` skill.
> **Purpose:** A single black-box description of the two deliverables this repo ships — the `devaudit` CLI and the SDLC framework templates — so any developer (or agent) can pick a command, template, or skill and write a passing E2E / integration test **without re-reading the source**.

## 0. About this document

This repo carries **two** observable surfaces, both specified here:

1. **The `devaudit` CLI** (`cli/`, `plugin-sdk/`, `plugins/*`) — a published npm package. Each command is testable from the outside via `bin/devaudit.js` invocation → **stdout/stderr + exit code + filesystem deltas in the consumer repo + HTTP calls to the portal**.
2. **The framework templates** (`sdlc/files/`) — stage docs, six skills, CI workflow templates, and per-stack/per-host adapters. Their observable behaviour is **"the files rendered into a consumer on `install`/`update` contain what that consumer's CI + AI agents expect."**

**Conventions**

- **Requirement IDs:** `REQ-CLI-<COMMAND>-NNN` for CLI behaviour; `REQ-SKILL-<NAME>-NNN` for skills; `REQ-FRAMEWORK-<AREA>-NNN` for templates/adapters/rule-files. IDs are stable — append, never renumber.
- **Acceptance criteria:** Given / When / Then against observable state (stdout text, exit code, files written/changed, HTTP calls, rendered file content).
- **Priority (MoSCoW):** `Must` (smoke suite) · `Should` (critical suite) · `Could` (regression) · `Won't` (excluded this cycle — e.g. unbuilt `org`/`config`/`upgrade` stubs). Priority also signals suggested test order.
- **Source:** each requirement cites the file(s)/function(s) it derives from — where to look when a test fails, not part of the contract.
- **Ambiguities & likely-unintended behaviour** are in **Appendix A** and per-area at the end of each §4 subsection — flagged, never papered over. Where a requirement documents current-but-suspect behaviour, the Given/When/Then describes _what the code does today_.

**How this was produced.** Inventory first (this section), the test stack identified by inspection (§2), then requirements extracted per command/template/skill against the live source. No requirement is invented; unsupported intent is an assumption, not a requirement.

**How this document stays current.** This repo *ships* the `requirements-aligner` skill (`REQ-SKILL-REQALIGN-*`, `sdlc/files/_common/skills/requirements-aligner/SKILL.md`) that keeps a *consumer* project's `docs/SRS.md` in sync with its own requirement cycles — advisory at Stage 1 (plan approval), blocking at Stage 3 (evidence compilation). This repo does not run that SDLC against itself (no `SDLC/`/`compliance/` self-application tree here), so *this* document has no automatic per-REQ alignment mechanism of its own; it is maintained by manual gap-analysis audits, like this one (2026-08-01), against `git log` since the document's last stated update point. Treat any requirement here that predates a later behavioural commit as a candidate for drift — cross-check against recent commits touching `sdlc/files/`, `cli/src/`, or `plugin-sdk/` before relying on it for a new test.

**2026-09-20 partial update (#828):** added/updated `REQ-CLI-DOCTOR-004/005`, `REQ-FRAMEWORK-ADAPTER-015`, `REQ-FRAMEWORK-CIYML-015..018`, `REQ-FRAMEWORK-VALIDATE-004`, `REQ-FRAMEWORK-E2EREGRESSION-001` — covering `#813`, `#814`, `#815`, `#817` (DevAudit-Installer half only), `#819`, `#820`, `#821`, `#826`. This was a **scoped** update (that specific set of recent PRs), **not** the full gap-analysis audit `#828` also offered as an option — the 101-commits-since-2026-08-01 gap that audit describes remains open for everything outside this list. Also flagged, not fixed: `REQ-FRAMEWORK-CIYML-014`'s index entry has no matching body section, and `REQ-FRAMEWORK-CIYML-013`'s body heading doesn't match its index description — pre-existing inconsistencies, found while inserting `CIYML-015..018` nearby, left for the next full audit rather than guessed at here.

**2026-10-30 update (#1136, WP8 of umbrella #1116):** doctor explains, guides and detects drift. New `REQ-CLI-DOCTOR-026` (`--explain`), `-027` (`--guided`: no terminal, leaving and stopping, neutral options, scope and order, the same safeguards as `--fix`, the re-check), `-028` (`preset-drift`), `-029` (`standards-fit`), `-030` (`approval-policy`) and `-031` (`durations`). Plain `doctor` is unchanged apart from the four new non-gating checks. §3 recounted from 392 to 398 requirements (156 Must · 204 Should · 34 Could · 4 Won't).

**2026-10-30 update (#1135, WP7 of umbrella #1116):** `devaudit configure` with no arguments. New `REQ-CLI-CONFIGURE-005` (the guided questions with the current values as defaults, a before/after summary, a write of only what changed, preset switches in both directions that remove the keys the target preset does not write, and Q18 asked straight away when a test tier is enabled) and `REQ-CLI-CONFIGURE-006` (no terminal: nothing asked, nothing written, exit 8; a declined confirmation exits 8; the portal approval policy is a tier B action and a refused solo policy leaves the approval settings alone). The per-user folders become overridable (`DEVAUDIT_CONFIG_DIR`, `DEVAUDIT_CACHE_DIR`, `DEVAUDIT_CLAUDE_HOME`) and every test worker gets its own. The guided install now also asks Q18 after preset B, C or D when the data has no answer, and defaults the preset question to the project's current preset. §3 recounted from 390 to 392 requirements (156 Must · 198 Should · 34 Could · 4 Won't).

**2026-10-30 update (#1134, WP6 of umbrella #1116):** the guided install. New `REQ-CLI-ONBOARD-002` (the express path: detect, suggest a preset, show a summary, accept, change one thing or answer every question), `-003` (`--preset` and `--from-scan`), `-004` (the portal calls: policy read and set, standards, all tier B), `-008` (`devaudit join` asks nothing and writes no policy or preset; a re-run without `onboarding_preset` applies none) and `REQ-CLI-INSTALL-031` (the guided answers are written by dotted key, the keys of another preset are removed, the `CI_RUNNER_LABEL` variable is set, a refused option exits 2). `--yes` without `--preset` is unchanged. §3 recounted from 385 to 390 requirements (156 Must · 196 Should · 34 Could · 4 Won't).

**2026-10-30 update (#1133, WP5 of umbrella #1116):** presets and the question registry as data. New `REQ-CLI-ONBOARD-001` (the four presets A to D, `docs/presets.md` generated from them), `-005` (the suggestion rule), `-006` (the question registry Q0a to Q21) and `-007` (the validators and the rule that every configuration key is asked or declared). Nothing is asked of a user yet: the install and configure flows that render the registry are later work packages. §3 recounted from 381 to 385 requirements (156 Must · 191 Should · 34 Could · 4 Won't).

**2026-10-30 update (#1132, WP4 of umbrella #1116):** the gap model. New `REQ-CLI-SCAN-008` (`doctor --json` gains an additive `gaps` array; a plain-language explanation for every doctor check; the `Gap` types and `findingToGap` live in `@metasession.co/devaudit-core`, where the scan and the portal use them). The text output of `doctor` and the existing JSON keys are unchanged. §3 recounted from 380 to 381 requirements (156 Must · 187 Should · 34 Could · 4 Won't).

**2026-10-30 update (#1131, WP3 of umbrella #1116):** the detection moves to `@metasession.co/devaudit-core`. New `REQ-CLI-ONBOARD-009` (the `RepoReader` contract, the facts, the test-data facts, the file-system reader that cannot leave the repository). `detectStack`, `detectTestRunners` and `detectDeployHost` keep their CLI signatures and delegate; the original code is kept as a frozen reference in a parity test, which shows identical answers. §3 recounted from 379 to 380 requirements (156 Must · 186 Should · 34 Could · 4 Won't).

**2026-10-29 update (#1130, WP2 of umbrella #1116):** configuration keys. New `REQ-CLI-CONFIGURE-007` (dotted keys `approval.mode` and `production_review.terminal_status`, and the keys `release_branch_required_reviews`, `compliance_frameworks`, `onboarding_preset` and the seven test-data keys), `REQ-CLI-INSTALL-032` (the release branch's review count at install; `update` keeps it, lowering needs a confirmation) and `REQ-FRAMEWORK-CIYML-027` (no generated workflow hard-codes `main` or `develop`: 67 lines in 12 templates now use the configured branches, and the default output is byte-identical). `REQ-CLI-UPDATE-023` amended. §3 recounted from 376 to 379 requirements (156 Must · 185 Should · 34 Could · 4 Won't).

**2026-10-29 update (#1129, WP1 of umbrella #1116):** a sixth published package, `@metasession.co/devaudit-core` (`core/`), the pure shared core of the CLI and the portal. New `REQ-CLI-RELEASE-003` (six packages; `core` is published after `plugin-sdk` and before `cli` and pinned in the cli; a manual `core` prerelease on the npm `next` tag from `develop`, decision M8). `scripts/check-package-contents.sh` now also checks every `exports` target. §3 recounted from 375 to 376 requirements (156 Must · 182 Should · 34 Could · 4 Won't).

**2026-10-28 update (#1099 follow-up, umbrella #1097):** the portal side of the credential model is on the portal's `develop` (metasession-dev/devaudit#921, #922, #923; not yet deployed), and the installer now uses it while still handling an older portal. `REQ-CLI-DOCTOR-022` amended (PAT expiry from `GET /api/auth/token`, `DEVAUDIT_PAT_EXPIRY_WARN_DAYS`); `REQ-CLI-INSTALL-027` amended (the portal's reason for a refused viewer key; revoked or expired keys of the same name are not live). Docs no longer call #921 and #923 pending. No new requirements; §3 counts unchanged.

**2026-10-28 update (#1098, umbrella #1097):** recommended agent permission rules (layer 4 of the credential model). New `REQ-CLI-DOCTOR-025` (`agent-permissions`, informational); new `docs/agent-permissions.md`. §3 recounted from 374 to 375 requirements (156 Must · 181 Should · 34 Could · 4 Won't).

**2026-10-28 update (#1089, umbrella #1097):** Windows test timeouts. `REQ-CLI-DOCTOR-001` amended (bounded child processes, parallel tool probes, opt-in timing). The CLI tests are hermetic (stub `gh`, failing `npm`, credentials stripped) and the `custom-host` fixture no longer triggers a real `npm install --save-dev`, the likely cause of its 300 s hang. No new requirement; §3 count unchanged.

**2026-10-27 update (#1096, umbrella #1097):** AC coverage check. New `REQ-CLI-DOCTOR-024` (`test-tiers` reports per-AC coverage, static and non-gating); `REQ-SKILL-IMPLEMENTER-014` amended (Phase 4 step 5b lists non-covered ACs). §3 recounted from 373 to 374 requirements (156 Must · 181 Should · 33 Could · 4 Won't).

**2026-10-27 update (#1095, umbrella #1097):** one E2E tagging rule. New `REQ-SKILL-E2E-012` (`check-req-title-tags.sh`); `REQ-SKILL-E2E-011` amended (Phase 5½ runs it); the `e2e-test-engineer` skill states the rule once. §3 recounted from 372 to 373 requirements (156 Must · 180 Should · 33 Could · 4 Won't).

**2026-10-27 update (#1100, umbrella #1097):** plugins get the person's PAT from the CLI. New `REQ-CLI-PLUGIN-007` (`PluginContext.getPersonalAuth()`); `@metasession.co/devaudit-plugin-evidence-export` uses it instead of asking users to export `DEVAUDIT_USER_TOKEN`. §3 recounted from 371 to 372 requirements (156 Must · 179 Should · 33 Could · 4 Won't).

**2026-10-27 update (#1099 WP6, umbrella #1097):** documentation sweep for the credential model. `REQ-CLI-DOCTOR-005`, `-012` and `-013` amended; the historical permissions article carries a "Superseded by docs/credentials.md" banner; the update/install workflow, `0-project-setup.md` and `docs/change-workflows.md` match the model. No new requirement, §3 count unchanged.

**2026-10-27 update (#1099 WP1, umbrella #1097):** the `sdlc-implementer` skill and its references stop telling an agent to run `devaudit push`, create the release or record triage from the session: evidence, release creation and test-execution reporting are CI's, and human steps are portal actions with the release URL. Phase 0 states that an agent holds neither the uploader key nor the PAT and carries the canonical per-step credential table (also in `docs/credentials.md`). `REQ-SKILL-IMPLEMENTER-033` rewritten (reads with `devaudit release status`), `-014` and `-034` amended. §3 count unchanged.

**2026-10-27 update (#1099 WP3b, umbrella #1097):** the `credentials` viewer-key findings become repairs: tier B `issue-viewer-key` and tier A `move-viewer-key` in `doctor --fix` (REQ-CLI-DOCTOR-010, -022 amended). No new requirement; §3 count unchanged.

**2026-10-27 update (#1099 WP3, umbrella #1097):** per-person viewer keys. New `REQ-CLI-AUTH-008` (`viewer-keys.json`, lookup order, `auth viewer-key set`) and `REQ-CLI-RELEASE-002` (`release status`); `REQ-CLI-INSTALL-027` rewritten (the key is issued by default, per person, saved locally, no repo secret); `REQ-CLI-INSTALL-011`, `REQ-CLI-JOIN-003`, `REQ-CLI-UNINSTALL-002`, `REQ-CLI-AUTH-005` and `REQ-CLI-DOCTOR-008` amended. §3 recounted from 369 to 371 requirements (156 Must · 179 Should · 32 Could · 4 Won't).

**2026-10-27 update (#1099 WP4, umbrella #1097):** new `REQ-CLI-DOCTOR-022` (`credentials` check) and `-023` (Credentials block after `update`/`install`/`join`); the `secrets` check stops requiring a viewer-key repo secret. The viewer-key remediations are guidance (tier C) for now: the tier B/A repairs need the per-person key storage and issuance of WP3. §3 recounted from 367 to 369 requirements (156 Must · 177 Should · 32 Could · 4 Won't).

**2026-10-27 update (#1099 WP2, umbrella #1097):** the uploader key is CI-only, so the two scripts that needed it from a person's machine are retired. `REQ-FRAMEWORK-UAT-001` (`record-uat-execution.sh`, `submit-for-uat-review.sh`) is removed and replaced by `REQ-CLI-RELEASE-001` (`devaudit release check`, read-only readiness before the portal's Submit for UAT review). UAT is recorded and submitted in the portal under the person's own login. §3 count unchanged (one removed, one added, both Must).

**2026-10-18 update (#1042):** this public repo no longer names consuming projects in its docs or code: historical references are reworded ("a consumer", `example-app`, `example-org/example-app`), and the release-validation consumer list moved to a gitignored local file. Behaviour change: the MongoDB dynamic-port step exports the consumer's own `*_URI` variable names (see the `DATABASE_URI_STEP` requirement) instead of a hardcoded one; output is unchanged for a consumer whose config already declared that name. No requirement added; §3 counts are unchanged.

**2026-10-21 update (#1060 Phase D, umbrella #1061):** the `e2e-test-engineer` skill covers API, integration and contract suites with the same smoke / critical / full tiers on Playwright, pytest, Jest and Vitest (`REQ-SKILL-E2E-004` amended; new `references/tiers-per-runner.md`; the reference regression workflow no longer claims the framework does not generate `e2e-regression.yml`). The pytest feature-scope default is corrected: it runs the test files that mention the requirement id instead of `pytest -k`, which could never match (`REQ-FRAMEWORK-TIERS-001`). No new requirement ids; §3 stays at 366.

**2026-10-21 update (#1059 Phase C and #1060 Phase C, umbrella #1061):** new `REQ-CLI-INSTALL-029` (test runner detection, proposed tier commands, `--test-*` flags) and `REQ-CLI-INSTALL-030` (release gate prompt and flags). `devaudit install --host` was accepted by the CLI but never forwarded to the installer; it is now. Install writes a test key only when a flag or a confirmed answer names it, so absent keys keep today's behaviour. §3 recounted to 366.

**2026-10-21 update (#1059 Phase B and #1060 Phase C, umbrella #1061):** new `REQ-CLI-DOCTOR-020` (`test-tiers`) and `REQ-CLI-DOCTOR-021` (`e2e-release-gate`): two read-only, non-gating `devaudit doctor` checks that review the project's test tiers and release gate and propose changes as tier C guidance, never applied by `--fix`. The `e2e-regression` consistency check no longer requires `playwright.config.ts` for `test_runner: pytest`. §3 recounted to 364.

**2026-10-20 update (#1059 Phase A, umbrella #1061):** new `REQ-FRAMEWORK-RELGATE-001..003`: the `release_gate_tier`, `post_deploy_full_regression` and `scheduled_full_regression` keys choose which E2E tier runs on the PR into the release branch, after the production deploy and on a schedule; the tier a run executed is recorded in its metadata and labelled (`E2E Smoke|Critical|Full (pre-merge)`); a configured gate is sent to the portal as `releaseGateTier` and reported as an `e2e-release-gate` check; scheduled runs are never uploaded to the portal. A config with none of the keys renders the same `e2e-regression.yml` and `check-release-approval.yml` as before. `REQ-FRAMEWORK-E2EREGRESSION-001` amended. §3 recounted to 362.

**2026-10-20 update (#1060 Phase B, umbrella #1061):** new `REQ-FRAMEWORK-TIERS-002` (`test_runner: pytest` selects pytest `feature-e2e.yml` and `e2e-regression.yml` from `sdlc/files/ci/runners/pytest/`; `compliance-evidence.yml` uploads the JUnit XML as the `e2e_result`; configs without it render unchanged). §3 recounted to 359.

**2026-10-20 update (#1060 Phase A, umbrella #1061):** new `REQ-FRAMEWORK-TIERS-001` (the `test_tier_smoke|critical|full`, `test_feature_command` and `test_runner` keys and the synced `run-test-tier.sh`; configs that set none render byte-identical workflows) and `REQ-FRAMEWORK-TIERS-003` (`feature-e2e.yml` uses the integration branch). `REQ-FRAMEWORK-TIERS-002` is reserved for the pytest tier workflows of Phase B. §3 recounted to 358.

**2026-10-20 update (#1054, umbrella #1061):** new `REQ-FRAMEWORK-CIYML-026` (postgres random host port when a local URL key exists; `e2e-regression.yml` gets the database-URI, kill-stale-server and self-hosted cleanup steps; `ci.yml` and `feature-e2e.yml` cleanup extended to run output). `REQ-FRAMEWORK-CIYML-018` and `-020` amended. §3 recounted to 356.

**2026-10-18 update (#1044, umbrella #1024):** new `REQ-FRAMEWORK-CIYML-025`: the five housekeeping templates that hardcoded `runs-on: ubuntu-latest` (incident export, CI status fallback, label retention, periodic review, quality-gates provenance) now use `{{RUNNER}}` like `ci.yml`. §3 recounted to 355 (156 Must · 163 Should · 32 Could · 4 Won't).

**2026-10-18 update (#1040, umbrella #1024):** interactive repo configuration. New `REQ-CLI-DOCTOR-016..019` (doctor checks `deploy-host`, `production-url`, `custom-deploy`, `ci-runner`; a confident deploy-host mismatch is a tier A `set-config` proposal that `doctor --fix` applies), `REQ-CLI-CONFIGURE-001..004` (`devaudit configure list|get|set|secret`: validated changes to `sdlc-config.json`, contradicted values need a reason, `--dry-run` with regenerated-file impact, secrets only through `gh secret set`'s masked prompt) and `REQ-SKILL-CONFIGURE-001` (the `devaudit-configure` skill). `REQ-CLI-DOCTOR-010` tier A gains `set-config`; the `doctor` check list (was "nine checks", stale since #1016/#1022/#1023) now lists all fifteen; §1.2 gains `configure`; §1.3 lists eight skills and the three hosts. `doctor --json` `onboarding` gains four entries at the end and `proposals` appends the deploy/CI findings after the release ones (additive). §3 recounted to 354, script-verified (156 Must · 162 Should · 32 Could · 4 Won't).

**2026-10-18 update (release-readiness review, umbrella #1024):** `REQ-CLI-UPDATE-007` gains stale-script removal: a script a previous sync wrote (manifest section `2d`) that upstream no longer ships is removed through `removeManaged`, so `reconcile-railway-deployment.sh`, replaced by `reconcile-deployment.sh` in #1022, no longer lingers in consumers (found in release validation: present in all four validated consumers). Bootstrap-only and untracked entries are never swept. Documentation of portal behaviour shipped with this release (metasession-dev/devaudit#903–#906): `sdlc-implementer` Phase 4 step 5a and `docs/e2e-test-tiers.md` note that the portal mirrors an unambiguous `accepted_exception` onto the run's release check and supersedes cancelled runs automatically; new Phase 4 step 6a tells the operator to mark a REQ with no UI to screenshot Not applicable on the release page. `cli/CHANGELOG.md` gains an Upgrade notes section. No requirement added; §3 counts are unchanged.

**2026-10-18 update (documentation correction, umbrella #1024):** `docs/adding-a-host.md` no longer says Railway is the only host (shipped hosts are `railway`, `vercel` and `custom`), and `sdlc/HOST_ADAPTER.md` no longer says `wait_for_deploy` is embedded into `post-deploy-prod.yml.template` at sync time: `wait_for_deploy` and `post_deploy_hook` are reserved and not yet consumed, as `docs/adding-a-host.md` already stated. No requirement added or changed; §3 counts are unchanged.

**2026-10-17 update (#1022 part C, umbrella #1024):** the `custom` host. New `REQ-FRAMEWORK-ADAPTER-019`: `install --host custom` generates `deploy-custom.yml`, which runs `deploy_command`, records the GitHub deployment, verifies the new build and dispatches `post-deploy-prod.yml`; adapters may name a `deploy_workflow`. This completes #1022 (host choice, adapter-driven reconcile, custom host). §3 recounted to 345, script-verified (153 Must · 157 Should · 31 Could · 4 Won't).

**2026-10-17 update (#1022 part B, umbrella #1024):** adapter-driven reconcile. New `REQ-FRAMEWORK-ADAPTER-017/018`; `REQ-FRAMEWORK-CIYML-022` rewritten and the `doctor` `railway-cli` check renamed `reconcile-cli` and made adapter-driven (`REQ-CLI-DOCTOR-005`). Vercel gets the webhook-loss recovery path Railway already had (`lookup-deployment-vercel.sh`), host-neutral dispatch inputs, and `VERCEL_TOKEN` as an advisory secret. Breaking for operators who dispatched `reconcile-deployment.yml` by hand (renamed inputs). §3 recounted to 344, script-verified (153 Must · 156 Should · 31 Could · 4 Won't).

**2026-10-17 update (#995, umbrella #1024):** Python declared-bundle parity. New `REQ-FRAMEWORK-BUNDLE-009`; `REQ-FRAMEWORK-BUNDLE-008` no longer says bundle mode rejects `stack: python`. The Python template registers a live declared bundle on its single core-REQ release (`derive-release-version.sh` bundle-only mode), generates/submits the manifest and files members through `resolve-bundle-release.sh`; Python work without a bundle keeps its date-based release. §3 recounted to 340, script-verified (153 Must · 152 Should · 31 Could · 4 Won't).

**2026-10-17 update (#1022 part A, umbrella #1024):** host selection. New `REQ-CLI-INSTALL-028` (`install --host`, interactive host prompt, a recorded host is never reset by a re-run) and `REQ-FRAMEWORK-ADAPTER-016` (optional `DEVAUDIT_PROBE_HEADER` for an access-gated origin, e.g. Vercel Deployment Protection). `sdlc-config.example.json` gains `host`; Railway-specific prose in the stage docs and the upload script examples is now host-neutral. Parts B (adapter-driven reconcile) and C (the `custom` host) follow. §3 recounted to 342 (with #995's REQ-FRAMEWORK-BUNDLE-009 merged), script-verified (153 Must · 154 Should · 31 Could · 4 Won't).

**2026-10-17 update (#1019, umbrella #1024):** evidence attribution. New `REQ-FRAMEWORK-ATTRIBUTION-001/002`: `classify-pr-attribution.sh`, the `Compliance-Record: REQ-XXX` trailer (derive step 2-bis), and default-on guards in `feature-e2e.yml`, `upload-evidence.sh` and `report-test-execution.sh` so a PR that changes no code cannot bind its SHA, branch or test executions to a release. A5 confirmed against the portal source: existing releases never have their branch overwritten, cycles keep the uploader's own SHA/branch; server-side enforcement remains an open design question. §3 recounted to 338, script-verified (153 Must · 150 Should · 31 Could · 4 Won't).

**2026-10-17 update (#941, umbrella #1024):** the SDLC-lifecycle smoke test. The approval-gate half (`release-approval-gate-behavior.test.ts`) and the scripted pipeline (`tests/release-pipeline-e2e`) already existed from the v1.8.0 work; this adds the missing close-out half. New `REQ-FRAMEWORK-LIFECYCLE-001` and a `close-out` layer-2b surface that runs each clone's own `close-out-release.yml` against a mock portal. The SRS test-gap section records what is now automated. §3 recounted to 339, script-verified (153 Must · 151 Should · 31 Could · 4 Won't).

**2026-10-17 update (#1017, umbrella #1024):** dependency-audit accepted-risk path. The premise that no expiring-exception mechanism existed was partly stale: `evaluate-npm-audit.sh` and `compliance/security/accepted-vulnerabilities.json` already existed. New `REQ-FRAMEWORK-DEPRISK-001..003`: `schemaVersion` 2 requires an `acceptanceRecord` (validated, matching advisory and tracking issue, SHA-256 recorded), the dependency risk-acceptance record template and `accepted_dependency_risk` evidence, and the `sdlc-implementer` halt with bump-or-accept. `REQ-CLI-DOCTOR-015` extended to read the exceptions file (expired or expiring within 14 days). Python `pip-audit` has no allowlist yet (with #995). §3 recounted to 336, script-verified (151 Must · 150 Should · 31 Could · 4 Won't).

**2026-10-17 update (#1016, umbrella #1024):** required-gate failure triage. New `REQ-FRAMEWORK-E2ETRIAGE-001..006` (fix-or-accept halt in `sdlc-implementer` Phase 4 step 5a; accepted-exception record + `validate-risk-acceptance-record.sh` + evidence type `accepted_e2e_failure`; `report-test-execution.sh resolve` refuses `accepted_exception` without `--remediation-reference` and a valid `--record`; `validate-test-summary.sh` failure-integrity and `CI as of:` rules; `reconcile-e2e-summary.sh`; watcher comment/sticky/escalation within one poll) and `REQ-CLI-DOCTOR-015` (`accepted-exceptions`, covering #1017's label too). ADR-003. `doctor --json` `onboarding` gains one entry. Summaries without the `CI as of:` stamp only warn, so releases in flight are not broken. §3 recounted to 333, script-verified (150 Must · 148 Should · 31 Could · 4 Won't); the stated Must/Should split had drifted.

**2026-10-17 update (#1020, umbrella #1024):** (1) `REQ-CLI-UPDATE-019` rewritten: the suggested sync commit message no longer carries a skip-CI tag, which made the sync PR's required `Quality Gates` check never report (example-app PR #915). (2) New `REQ-FRAMEWORK-CIYML-024`: integration housekeeping registers no portal release (`derive-release-version.sh` opt-in `DEVAUDIT_SKIP_INTEGRATION_HOUSEKEEPING=1`, used by `ci.yml` and `compliance-evidence.yml`) unless a reviewed standalone declaration exists for the bare-date version; the node `ci.yml` `upload-evidence` job is now also gated on `version != skip` (previously a skipped registration still uploaded with `--release skip`); the two disabled legacy housekeeping steps were removed. §3 recounted to 326 (146 Must · 145 Should · 31 Could · 4 Won't).

**2026-10-17 update (#1023, #1018, umbrella #1024):** (1) A `.devaudit-patches/*.patch` that stops applying cleanly is still skipped, not fatal (#921/#923), but is now also recorded in `.devaudit/sync-manifest.json` under a new optional `patches` map (`conflict`, `detected_at` kept from the first sync that saw it, `upstream_issue`/`reason` from the companion `.patch.json`) and surfaced by a new non-gating `devaudit doctor` check `patch-conflicts` (new `REQ-CLI-DOCTOR-014`). Motivated by a consumer, where a skipped sharding patch reverted silently and the unsharded suite exhausted runner memory a day later. `SRS-PATCH-084-002` extended, and the `REQ-CLI-UPDATE-030` note that claimed patch-conflict parity with manifest conflicts now describes behaviour that exists. `doctor --json` `onboarding` gains one entry (additive). (2) New `REQ-FRAMEWORK-EVIDENCE-016`: the Playwright report bundle upload falls back to the presigned flow on multipart 400/413, logs size/path/headers on failure, no longer swallows `zip` errors, and notes a missing report in the job summary for non-passing runs. §3 recounted from 323 to 325 requirements (145 Must · 145 Should · 31 Could · 4 Won't).

**2026-10-13 update (SRS gap closure, umbrella #957):** closed the index/body inconsistencies this document carried since 2026-09-20. Added the 16 bodies that existed only as index rows: `REQ-FRAMEWORK-CIYML-014`, `REQ-FRAMEWORK-E2EREGRESSION-002`, `REQ-FRAMEWORK-HOOK-001/-002/-004`, `REQ-FRAMEWORK-SKILL-001..004`, `REQ-FRAMEWORK-VALIDATE-001`, `REQ-SKILL-IMPLEMENTER-025..030`, each written from the code it names. Added the index rows for the two bodies that had none: `REQ-CLI-PUSH-019` and `REQ-FRAMEWORK-EVIDENCE-015`. `REQ-FRAMEWORK-CIYML-014` was also factually wrong: its index text said `register-release` creates no portal release, but the template now creates it (`upload-evidence.sh --create-release-if-missing`); the row and body are corrected. §3 recounted from 321 to 323 requirements (145 Must · 143 Should · 31 Could · 4 Won't), script-verified, and every index row now has a body and every body an index row.

**2026-10-13 update (#990, umbrella #957):** `REQ-CLI-UPDATE-023` rewritten. `update` no longer re-PUTs branch protection with fixed settings on every sync, which reset the review count, forced admin enforcement and cleared settings the PUT did not send. It now reads the branch's protection and adds only what DevAudit needs, through `GitProvider.ensureBranchProtection`. A branch protected by repository rulesets gets no classic protection on top, and a private repository on GitHub Free (where neither is available) is reported, not written. `REQ-CLI-UPDATE-032` gains a fifth correction: the manifest bootstrap's old-CLI baseline run had full GitHub credentials and so ran that version's blind protection PUT, label creation and default-branch edit against the live repository on the first sync after an upgrade; the child now runs without GitHub or portal credentials and with a `gh` that always fails. Two documentation gaps from the v1.8.0 review closed in the same change: `REQ-CLI-UPDATE-029` now states the manifest's sorted file keys and `REQ-FRAMEWORK-RENDER-001` the missing-`runner` default (both shipped in #984 without an SRS line). The sync-conflict review process is documented in `docs/sync-conflict-review.md`. No requirement added or removed.

**2026-10-13 update (#988, #987, umbrella #957):** `REQ-CLI-UPDATE-030` corrected — a path left in conflict is never overwritten or removed by a later sync (it was: an untracked-but-present conflict recorded the local hash as its baseline, so the second `update` replaced the consumer's edit with upstream). The generated `quality-gates-provenance.yml` (hotfix dispatch run lookup) and `incident-export.yml` (containment section) no longer use heredocs whose indented terminators never terminated; `cli/test/workflow-run-syntax.test.ts` runs `bash -n` on every generated bash `run:` step. Both found by the release-validation gate. No requirement added or removed.

**2026-10-12 update (#984, pre-v1.8.0 review, umbrella #957):** `REQ-CLI-DOCTOR-010` — the `close-out-release` proposal is tier C (printed, never counted as unapplied), and a D5 stale deferral is resumed only after an interactive choice (never non-interactively, even with `--yes --reason`). `REQ-CLI-DOCTOR-011` — D5 wording. `REQ-CLI-DOCTOR-013` — request shape verified against the portal (no longer an assumption). `doctor --fix` refuses to write a `Release intent` line without a reason (the validator rejects it). `close-out-reconcile.yml` opens a deferred-only issue with its own title instead of the stale-close-out wording. Portal side: a deferred predecessor absorbed by a successor is now superseded when the successor's close-out completes (metasession-dev/devaudit#897). No requirement added or removed; §3 totals unchanged.

**2026-10-12 update (#956 phase 3b, final phase, part of the #957 umbrella):** `devaudit doctor --fix` and the deferred-ticket CI skip. Added `REQ-CLI-DOCTOR-010` (`doctor --fix [--yes] [--reason <text>] [--dry-run]`: tiers A/B/C, non-interactive rules, exit code 8 when proposals remain unapplied, `--fleet` rejection, JSON `fix` key), `REQ-CLI-DOCTOR-011` (checks D1 `deferred-portal-sync`, D2 `deferred-ticket-sync`, D5 `deferral-age` and the `deferral_max_age_days` setting, default 30, positive integer), `REQ-CLI-DOCTOR-012` (the TTY/CI/`--json`-aware prompt helper `cli/src/lib/prompt.ts`), `REQ-CLI-DOCTOR-013` (the PAT-only portal defer/resume client `cli/src/lib/release-deferral-api.ts`) and `REQ-FRAMEWORK-DEFERRAL-005` (the shared `is-deferred-ticket.sh` and the deferred-ticket skip in the CI loops). Updated `REQ-CLI-DOCTOR-004/006/007/009`, `REQ-CLI-FLEET-001`, `REQ-FRAMEWORK-POSTDEPLOY-002` (the Part B defect recorded in the 3a-3 entry is fixed: deferred tickets are no longer promoted, uploaded to or PATCHed), `REQ-SKILL-IMPLEMENTER-034` (the skill can hand the operator `doctor --fix`; the manual route stays as the fallback), the Assumptions block, Appendix A.1/A.3/A.5 and Appendix B fixtures. The `releases` check and `status` now handle the portal `deferred` state and deferred tickets cleanly (`status` lists pending and deferred tickets separately). Request-shape details of the defer/resume routes are ASSUMED (see the REQ-CLI-DOCTOR-013 assumption) pending verification against the portal. §3 recounted from 316 to 321 requirements (five new rows) and the MoSCoW split from 144/138/30/4 to 144/142/31/4, script-verified.

**2026-10-11 update (#956 phase 3a-3, part of the #957 umbrella):** documentation, skill, blueprint and decision-record sweep for release deferral — no new behaviour. Added `REQ-SKILL-IMPLEMENTER-034` (the "Closing a release PR without releasing" procedure, now including the manual admin portal defer step and the promotion gate; `REQ-FRAMEWORK-BUNDLE-008` keeps the stack-python rejection and the original four-step procedure) and extended `REQ-SKILL-IMPLEMENTER-029` with the deferral variant (a deferred ticket is not closed out). Reconciled `REQ-FRAMEWORK-APPROVAL-001..004` (`APPROVAL-002` now lists the real portal status vocabulary instead of the non-existent `uat_pending`, and the specific `deferred` message of #980; `-001/-003/-004` reviewed, unchanged), `REQ-FRAMEWORK-POSTDEPLOY-002` (the in-scope set is every pending ticket, deferred ones included; behaviour not changed, see Appendix A.1), the CI terminal-directory skip statement (deferred tickets stay in `pending-releases/`, so that skip never applies to them), `REQ-CLI-DOCTOR-002` (drift statement), `REQ-CLI-FLEET-001` (the fleet sweep inherits the new additive doctor JSON keys; `--fix` is planned and must not be forwarded), the `Update/Status/Doctor/Bootstrap` Assumptions block, Appendix A.1/A.3/A.5 and Appendix B fixtures (fake portal defer/resume, PAT and viewer-key fixtures). The portal `deferred` state is deployed (devaudit#895, live 2026-10-11): statuses `draft`/`uat_review`/`uat_rejected`/`uat_approved` can be deferred, resume returns to `draft`, a deferred release can be superseded; defer/resume are admin-only (`POST /api/releases/[id]/defer` and `/resume`, session or personal access token, never CI/API/viewer keys, not settable via the CI status PATCH) and emit audit events `release.deferred`/`release.resumed`. They are performed manually today. **Not implemented (phase 3b of #956):** `devaudit doctor --fix`, tiered remediation, prompts, checks D1/D2/D5 and any CLI or skill command that calls defer/resume; `deferral_max_age_days` (default 30) is a planned doctor setting. Decision recorded in `docs/ADR/ADR-002-release-deferral.md`. Docs updated with the code: the skill, blueprints 3/4/5, `sdlc/ai-rules`, the playbooks, `docs/consuming-projects.md` (status list gains `deferred` and the previously missing `uat_changes_requested`; Token contract no longer says the PAT is for UAT submission only; stale `gh secret set DEVAUDIT_USER_TOKEN` rotation rows corrected per #912), `docs/onboarding.md`, `docs/articles/permissions-and-tokens-reference.md`. §3 recounted from 315 to 316 requirements (one new row, `-034`).

**2026-10-11 update (#956 phase 3a-2, part of the #957 umbrella):** added `REQ-CLI-DOCTOR-007..009` — read-only release-deferral diagnosis in `devaudit doctor` (situations D3, D4, D6, D7 as new non-gating checks `release-pr-closed`, `deferred-will-ship`, `predecessors-none`, `bundle-members`; D8 stays the existing `releases` check), the viewer-key read path (`cli/src/lib/releases-api.ts`), and the additive `--json` keys `deferral` and `proposals` (inert `remediation` descriptors for the phase-3b `--fix`). Updated `REQ-CLI-DOCTOR-002` (the `releases` check now resolves `compliance/pending-releases/` from the **repo root**, not cwd, and prefers `DEVAUDIT_VIEWER_API_KEY` over `DEVAUDIT_API_KEY`), `REQ-CLI-DOCTOR-004` (scope note) and `REQ-CLI-DOCTOR-006` (JSON schema). §3 recounted 312 → 315 (Should 134 → 137). Out of scope (phase 3b): D1/D2/D5 (need the portal `deferred` state), `doctor --fix`, tiers, prompts, portal defer/resume.

**2026-10-11 update (#956 phase 3a-1, part of the #957 umbrella):** added `REQ-FRAMEWORK-DEFERRAL-001..004` — RTM status `DEFERRED` and how `validate-compliance-artifacts.sh`, `validate-commits.sh` and `derive-release-version.sh` (steps 4 and 4-bis) treat deferred tickets/rows; the new `list-reqs-in-range.sh`; the `develop -> main` promotion gate (`check-deferred-reqs-in-range.sh`, run by `check-release-pr-scope.sh` inside the existing Release Scope Integrity job — not a new required context); and the clearer `deferred` message in `check-release-approval.yml.template`. Recounted §3: 312 requirements (144 Must · 137 Should · 30 Could · 4 Won't); the previously stated 304 (143/128/29/4) had drifted from the table's actual 308 rows (144/130/30/4) before these four were added. Not in this change: `doctor` checks (phase 3a-2), skill/blueprint/docs/ADR sweep (3a-3), `doctor --fix` and portal defer/resume (3b).

**2026-10-11 update (#955 remainder, part of the #957 umbrella):** added `REQ-FRAMEWORK-BUNDLE-006..008` — the optional release-ticket `Release intent: deferred-to-next` field and its validator, the two `generate-bundled-changes.sh` no-silent-absorption guards (deferred intent with `None`/omitted; `None` while the REQ's commits are in range), and `stack: python` rejection plus the "Closing a release PR without releasing" procedure in `sdlc-implementer`. Recounted §3: 304 requirements (143 Must · 128 Should · 29 Could · 4 Won't). #956 (doctor, RTM `DEFERRED`, promotion gate) is not implemented here.

**2026-10-04 update (#955, part of the #957 umbrella):** restored the intended declared-bundle model — `Bundles: #A, #B` is **one portal release with one UAT approval** (#736, #817, #884) — which #884's `co_tracked` submission had broken in practice. a consumer (REQ-035 core; REQ-036..038 members; REQ-034 absorbed predecessor) hit it as three failures in a row: the generator's ambiguity guard (#952, fixed by #953), the portal's HTTP 400 on `co_tracked`/`bundled` (devaudit#885), and, beyond that, four portal releases where one was expected, with the core unapprovable because the portal gates a core on each submitted `co_tracked` sibling release independently (`co_tracked_sibling_not_ready`). The CI templates were filing member evidence under `--release <member> --create-release-if-missing`, creating one orphan draft release per member. New `REQ-FRAMEWORK-BUNDLE-001..005`: (001) every member upload is tagged with the member's own REQ but filed under the core's release; (002) `resolve-bundle-release.sh`, the single decision point; (003) `submit-bundle-manifest.sh` no longer submits `co_tracked` members and recomputes `manifestHash` for the stripped payload (cross-checked against the portal's own algorithm); (004) `close-out-release.sh` releases members with the core while predecessors still supersede; (005) the predecessor-ownership guard (#746/#952/#953), which previously had no SRS coverage. Corrected `REQ-FRAMEWORK-CIYML-016` (it described a template-side hyphenated `co-tracked` filter that #817/#884 had removed), `-017` (fan-out now files under the bundle's release), and the `REQ-FRAMEWORK-CIYML-013` index row, which described `register-release` bundled-changes behaviour (#220) while its body specifies the #391 execution-scoped-upload rule (the #220 behaviour is now covered by BUNDLE-003). Recounted §3: 301 requirements (143 Must · 125 Should · 29 Could · 4 Won't). Docs updated with the code: `docs/change-workflows.md` ("Bundling several issues into one release"), `docs/release-playbooks/README.md` (bundled contract), `docs/release-lineage-producer-contract.md` (`co_tracked` is local-only, never submitted), `cli/CHANGELOG.md`. Not changed: `feature-e2e.yml.template` is single-REQ (skips a multi-REQ bundle PR) and the Python CI template has no bundled-changes generation, so declared bundles remain a Node-template feature; the explicit deferral field and the `None`-safety check are in the follow-up release (#955 remainder, #956).

**2026-10-03 update (#942):** added `checkCommitlintConfigShadowing` (`commitlint-config-shadowing`, doctor's ninth onboarding check) — detects a legacy commitlint config (`.commitlintrc*`, `commitlint.config.{js,cjs,ts,cts}`, or a `package.json#commitlint` field) that shadows the managed `commitlint.config.mjs` under commitlint's own fixed `cosmiconfig` search-place order, which it mirrors rather than re-implementing by guesswork (cited: https://commitlint.js.org/reference/configuration.html). Fixes a real reported symptom: a leftover `.cjs` config (predating DevAudit) sorts ahead of `.mjs` in that order, so it silently wins — defeating the managed config's `Sdlc-Implementer-Sentinel:` trailer exemption (#814) and producing commit-msg rejections that read as a DevAudit bug rather than a local leftover file. Updated `REQ-CLI-DOCTOR-004/005/006` and their index rows; while touching `-004`, also corrected its stale "seven onboarding-invariant checks" claim (had drifted to eight once `sync-conflicts` landed in #930, without this document being updated at the time — now nine with this REQ). Docs: `docs/consuming-projects.md` gained a "Commitlint config shadowing" subsection next to "Sync conflicts". Out of scope (per the originating issue's own "optional" framing): surfacing the same warning from `devaudit update` at sync time — the doctor check alone satisfies the issue's acceptance criteria. New tests in `doctor.test.ts`: skip-when-unsynced, clean-when-only-managed, warn-on-legacy-`.cjs`, warn-on-`package.json#commitlint`, and a `--json` suspectedOrigin assertion.

**2026-10-03 update (#945):** fixed a real gap found while executing the DevAudit-on-DevAudit onboarding plan (devaudit-installer#917): `devaudit install --with-viewer-key` minted the raw `DEVAUDIT_VIEWER_API_KEY` value but never surfaced it anywhere — GitHub repo secrets are write-only, so the one and only place the raw value ever existed (transiently, inside the CLI process) was never shown to the operator, making the documented "safe to export locally" advice unactionable. Fixed in two parts: (1) `done-report.ts`'s operator branch now prints the raw value once, immediately after `<name> is onboarded.`, with an explicit "shown once, will not be shown again" warning and a literal `echo "<secretName>=<rawValue>" >> .env` instruction; the re-run/already-exists path (`plan.viewerApiKey` unset) is unchanged and still prints nothing. (2) `.env`/`.env.local` added to `gitignore.ts`'s `SENTINEL_ENTRIES` so that instruction can't land in a commit on any consumer, including one with no pre-existing `.env` gitignore rule of its own. Updated `REQ-CLI-INSTALL-015`/`REQ-CLI-INSTALL-027` (one-time print behaviour) and `REQ-CLI-UPDATE-020` (sentinel-entry list, which — found while updating it — was already stale: missing `*.devaudit-new` from #930, now corrected alongside the new entries). Docs updated to match: `docs/onboarding.md`'s "Opting into the read-only viewer key" section, `docs/articles/permissions-and-tokens-reference.md`'s credential table, and `docs/devaudit-on-devaudit-onboarding.md`'s Phase 0 bullet (all previously said "safe to export locally" without saying how). New tests: install.test.ts asserts the done report contains the raw value + warning text + exact `.env` command, and a second test confirms the already-exists re-run path reveals nothing; update.test.ts asserts `.env`/`.env.local` land in a synced consumer's `.gitignore`.

**2026-09-30 update (#930):** the fourth and final PR of the sync-safety umbrella (devaudit-installer#932). Added a committed `.devaudit/sync-manifest.json` recording the sha256 of every file devaudit has written per consumer, and a single write path (`writeManaged`/`removeManaged`, `cli/src/update/write-managed.ts`) every regenerating sync section now routes through instead of a direct `copyFile`/`fs.writeFile`/`copyDir(clean=true)`. A file whose on-disk content still matches what devaudit last wrote is overwritten silently, exactly as before; a hand-edited file, or a pre-existing file at a devaudit-managed path with no manifest record (typically an onboarding scenario), is instead left byte-for-byte untouched, with the fresh upstream content written to a sibling `<path>.devaudit-new` and the conflict reported (sync-time warning, manifest `conflict: true`, and a new `devaudit doctor` `sync-conflicts` check) rather than silently overwritten or silently dropped. Stale-file removal (old workflow names, disabled e2e-regression/reconcile-deployment, multi-target unsuffixed leftovers, `.claude/skills/`, `SDLC/blueprints/`, the pre-#929 stale `.js` binary) became manifest-driven the same way: deleted only if unmodified, kept and reported otherwise. The very first sync after upgrading — when no manifest yet exists — reconstructs a baseline via a scratch git worktree running the consumer's previously-recorded CLI version, falling back to an empty (maximally conservative — nothing overwritten without proof, nothing deleted) baseline if that reconstruction isn't possible. New REQ-CLI-UPDATE-029 through -033 cover the manifest, the classification/conflict policy, manifest-driven deletion, the bootstrap+fallback, and `sdlc-config.json` unknown-key preservation; REQ-CLI-UPDATE-002/003/004/005/007/008/009/010/018/024, REQ-FRAMEWORK-CIYML-022, REQ-FRAMEWORK-E2EREGRESSION-001, REQ-FRAMEWORK-RENDER-006, and REQ-FRAMEWORK-RULES-002/003/004/005 were all corrected to describe the manifest-driven behavior in place of unconditional overwrite/delete. The now-redundant post-hoc drift-warning mechanism (#758/#766, `drift-warning.ts`) was removed — the manifest supersedes it with a stronger guarantee (never overwritten at all, not just warned about after the fact). This is the last of the four sync-safety PRs (#929, #931, #928, #930); the umbrella's pre-release validation gate runs next, ahead of one combined `develop → main` promotion and release.

**2026-09-30 update (#928):** fixed an invalid-YAML bug and added a sync-safe CI extension point. **Bug:** `buildE2eRegressionJobEnv`, the Python `QUALITY_GATES_ENV` block, and the separate `{{DATABASE_ENV}}`/`{{APP_ENV}}` tokens combined `database_env`/`app_env`/`e2e_env` by string concatenation with no dedup — a key set in more than one source (e.g. `MONGODB_DB_NAME`, live on a real consumer in both `app_env` and `e2e_env`) produced a job-level `env:` block with a duplicate YAML key, invalid and unparseable. Fixed with new `mergeEnvSources`/`renderEnvHeaderBlock`/`renderEnvBareBlock` (REQ-FRAMEWORK-RENDER-007); `{{DATABASE_ENV}}`+`{{APP_ENV}}` collapsed into one token `{{DATABASE_AND_APP_ENV}}` (REQ-FRAMEWORK-RENDER-002). **Extension point:** `e2e-regression.yml`'s "E2E Regression Tests" step now runs `e2e/ci-reliability/regression-run.sh` if present (a fixed, undeclared path devaudit never creates/overwrites/deletes) else its previous default command, so a project-specific reliability fix (sharding, warm-up) diagnosed by the `e2e-ci-reliability` skill survives `devaudit update` without a `.devaudit-patches` entry that breaks on every template restructure; new `e2e_regression_timeout_minutes` config key (default 55) for the job-level timeout a hook script can't raise at runtime; widened artifact-upload globs to capture sharded outputs (REQ-FRAMEWORK-E2EREGRESSION-001). Third of four PRs under the sync-safety umbrella (devaudit-installer#932, alongside #929, #931, #930) — none release or update any consumer independently.

**2026-09-30 update (#931):** docs-accuracy audit found this document (and `README.md`/`docs/consuming-projects.md`/both `devaudit-update-install.md` copies/`sdlc/SKILLS.md`) had drifted from the actual sync behaviour independent of the sync-safety work. Corrected: `REQ-CLI-UPDATE-001`'s section list (was missing 2g–2m entirely); `REQ-CLI-INSTALL-014`'s "nine sections" (now 15 `SECTION_RUNNERS` entries + 2l/2m outside the loop); `REQ-CLI-UPDATE-004`/`REQ-FRAMEWORK-RULES-001`/`-002`/`-005` (pointer-file count was 3/"five files" total, now 4 pointer files — `AGENTS.md` was added since — + `CLAUDE.md` + `INSTRUCTIONS.md` = 6); `REQ-FRAMEWORK-RENDER-006` (three conditional removal sweeps — e2e-regression, reconcile-deployment, multi-target stale-file — existed with no REQ coverage); `REQ-CLI-UPDATE-011` (the #758/#766 drift-warning mechanism, CI-templates-only, was undocumented); added bodies for index-only `REQ-CLI-UPDATE-019`/`-020` (the latter's sentinel-entry list was also stale — 4 entries now, not 2); added `REQ-CLI-UPDATE-026`/`-027`/`-028` for sections 2i/2l/2m, which had zero REQ coverage. Also corrected `README.md` (a merge-conflicting `.devaudit-patches` no longer "fails hard" since #923; the "idempotent no-op" claim omitted that 2l/2m and the drift warning still run every time), `docs/consuming-projects.md` (the "only INSTRUCTIONS.md/CLAUDE.md are updated" framing was too broad — every other synced surface is fully regenerated every run; the "does not touch sdlc-config.json/branch protection" claim was wrong — 2m stamps `devaudit_synced_version` and 2k actively re-applies branch protection on every sync, confirmed by reading `branch-protection.ts` directly), both `devaudit-update-install.md` copies (same two corrections, plus reconciling drift between the two copies — each had content missing from the other), and `sdlc/SKILLS.md` (the evidence-helper emission cited the wrong file/count: `evidence-helper.ts`, 3 files, not "a guarded section in skills.ts" with 1 file). This is the second of four PRs tracked under the sync-safety umbrella (devaudit-installer#932, alongside #929, #928, #930) — docs + CHANGELOG only, no code changes; none of the four PRs release or update any consumer independently.

**2026-09-30 update (#929):** added `REQ-CLI-UPDATE-025` — section 2h (SDLC CLI engine) had no REQ at all before this. `sdlc/src/bin/devaudit-sdlc.js` was genuine CommonJS synced with a `.js` extension and no isolating `package.json`, so any consumer with `"type": "module"` in its own `package.json` got the file misinterpreted as ESM and crashed with `require is not defined` on every phase-transition/freshness-check sentinel invocation — not a config-specific edge case, since it depends only on `"type": "module"` being set, nothing else. Renamed to `sdlc/src/bin/devaudit-sdlc.cjs` (forces CommonJS regardless of the consumer's `package.json`), updated `sdlc/package.json`'s `bin`/`files`, `cli/src/update/sdlc-engine.ts` to sync the `.cjs` name and remove a stale pre-#929 `.js` copy if present, and all 62 references to the old path across docs, blueprints, skill files and tests (`docs/SRS.md` lines citing the path: REQ-SKILL-IMPLEMENTER-031, REQ-FRAMEWORK-STAGE-004, the `--watch-pr` REQ, the step-gate REQ, and the prompt-injection-lookalike Appendix note). This is the first of four PRs tracked under the sync-safety umbrella (devaudit-installer#932, alongside #931, #928, #930) — none of which release or update any consumer independently; see the umbrella for the single combined release plan.

**2026-09-29 update (#921/#922/#923):** corrected two stale claims found during pre-promotion review, both introduced by real behavior changes this same day that hadn't reached this document yet: `REQ-FRAMEWORK-E2EREGRESSION-001` said the job env combines `database_env` + `e2e_env` — #922 added `app_env` (the dev server this workflow starts needs its own runtime config, same as `ci.yml.template`/`feature-e2e.yml.template` already provide, distinct from `e2e_env`'s test-only credentials). `SRS-PATCH-084-002` said a conflicting patch "fails nonzero with an actionable message" — #923 changed this: a patch that no longer applies cleanly is now skipped (with a warning) rather than aborting the whole sync, since the old throw-based behavior propagated out of the section loop and silently skipped every later step including the version stamp.

**2026-09-29 update (#912):** two parts. **(1) `DEVAUDIT_USER_TOKEN` is no longer a repo secret** — `install` step 7 stopped writing it (no generated CI workflow consumed it; the only template reference was a permanently-disabled step deprecated per #122), developer-mode detection dropped from four bits to three (the repo-secret bit is gone; `detectInstallMode` no longer touches the git provider), and `doctor`'s `secrets` check no longer requires it. Updated `REQ-CLI-INSTALL-010/011/016/017/022`, `REQ-CLI-UNINSTALL-002` (deletion kept as a no-op-safe cleanup of stale copies; also flags that the viewer-key secret is not deleted), the §2 fake-provider note, Appendix A.3's dev-mode bullet (which also had stale skipped/run step numbers), and B.2's fixture description. The operator-local token path (env var / `auth login` / `--token`) is unchanged. **(2) Drift audit** of the 10 `cli/src`/`plugin-sdk/src` commits since `68e1b50` (2026-09-20), none of which touched this document. Added: `REQ-CLI-INSTALL-027` (`--with-viewer-key`), `REQ-CLI-DOCTOR-006` (`doctor --json`), `REQ-CLI-FLEET-001..004` (`doctor --fleet`), `REQ-CLI-UPDATE-024` (`--enable/--disable-e2e-regression`), `REQ-SKILL-IMPLEMENTER-033` (Phase 5 viewer-key preference), `REQ-FRAMEWORK-CIYML-019..022` (`resolvePlaywrightWithDeps`, `resolveStaleNextCleanupCondition`, `resolveNpmAuditMaxAttempts` + npm pin, railway-only `reconcile-deployment.yml`), and an intro paragraph in the CI-templates area naming the runtime `CI_RUNNER_LABEL`-gated resolver pattern as a category. Corrected factually-stale sections: `REQ-CLI-DOCTOR-004/005` (all seven onboarding checks, `suspectedOrigin` tagging as actually implemented, the now-accurate command description), `REQ-CLI-INSTALL-021..025` (polyglot `targets` deprecation — first-time `--add-target` adoption is hard-refused), `REQ-FRAMEWORK-ADAPTER-011` (`required_secrets` now includes `RAILWAY_TOKEN`), `REQ-FRAMEWORK-EVIDENCE-001` (+ preconditions on `-006/010/011`: the E2E Regression listener/job are stripped unless `e2e_regression_enabled`), `REQ-FRAMEWORK-E2EREGRESSION-001` cross-refs, the §1.2 surface table (added `uninstall`, `doctor --fleet`, update flags), and the §3 index counts (the stated 203 had drifted from the table's actual rows). Also found and corrected an older stale requirement outside the audit window: `REQ-CLI-UPDATE-018` still documented `update --dry-run` as mutating the tree, though that was fixed in `3e5d8bc` (#154, 2026-06-11) — plus the two Appendix A bullets and the doctor-description bullets repeating those claims. Still not addressed: the pre-existing `REQ-FRAMEWORK-CIYML-013`/`-014` index/body inconsistencies flagged in the 2026-09-20 entry, and the broader 2026-08-01 backlog outside this commit window.

---

## 1. Codebase Inventory

### 1.1 Stack

| Concern          | Technology                                                         | Notes                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI package      | **`@metasession.co/devaudit-cli`**, ESM, **Node ≥ 22**             | Published package version is defined by `cli/package.json`; `bin: { devaudit: ./bin/devaudit.js }`; the bin `import()`s built `dist/`                                           |
| Command parser   | **commander**                                                      | global flags + nested command groups (`auth`, `plugin`, `org`, `config`)                                                                                                        |
| Prompts / output | **@clack/prompts**, **consola**                                    | interactive onboarding + logging                                                                                                                                                |
| Process / paths  | **execa** (shelling out to `git`, `gh`, `npm`), **env-paths**      | `~/.config/devaudit/` for auth + plugins                                                                                                                                        |
| Plugins          | **`@metasession.co/devaudit-plugin-sdk`**                          | Versions are defined by each package manifest; lifecycle hooks: `beforeSync`/`afterSync`, `beforePush`/`afterPush`, `onDoctor`; first-party plugins: Prisma and evidence export |
| Build            | **tsup** (`prepack` = `build` + `bundle:templates`)                | `bundle:templates` snapshots `sdlc/files/` into the published tarball                                                                                                           |
| Tests            | **vitest 4.1.x** (`cli/test/*.test.ts`), **msw 2.x** (portal HTTP) | unit/integration only — see §2                                                                                                                                                  |
| Templates        | `sdlc/files/` — stage docs, skills, CI templates, adapters         | resolved at runtime via `DEVAUDIT_INSTALLER_ROOT` override or the bundled snapshot                                                                                              |

### 1.2 CLI command surface (`cli/src/commands/*`, registered in `cli/src/index.ts`)

| Command                                      | Status                                                  | Source                                 |
| -------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| `install [path]`                             | **operator onboarding** (11-step)                       | `commands/install.ts` + `install/*`    |
| `join [path]`                                | second-dev entry (skips destructive steps)              | `commands/join.ts`                     |
| `update [version] [paths...]`                | multi-consumer template sync (`--enable-e2e-regression` / `--disable-e2e-regression`) | `commands/update.ts` + `update/*`      |
| `push <slug> <req> <type> <file>`            | evidence upload (port of `scripts/upload-evidence.sh`)  | `commands/push.ts`, `lib/ci-upload.ts` |
| `auth login \| logout \| status`             | PAT cache at `~/.config/devaudit/auth.json` (mode 0600) | `lib/auth.ts`                          |
| `plugin install \| list \| remove \| update` | plugin store at `~/.config/devaudit/plugins/`           | plugin commands                        |
| `bootstrap-governance [path]`                | opt-in governance starter drop (v0.1.36+)               | `install/bootstrap-governance.ts`      |
| `doctor` (`--fleet`, `--fix`)                | tools on PATH + close-out drift + onboarding invariants (incl. deploy host, production URL, custom deploy, CI runner, #1040) + release-deferral checks; `--fleet` sweeps every visible project (read-only); `--fix` repairs deferral findings in tiers | `commands/doctor.ts`, `commands/fleet.ts` |
| `configure list \| get \| set \| secret`    | validated `sdlc-config.json` changes + repo secrets via `gh` (#1040) | `commands/configure.ts`, `lib/repo-config-keys.ts`, `lib/deploy-detect.ts` |
| `uninstall [path]`                           | disconnect a repo: revoke keys, delete secrets, drop config target | `uninstall/index.ts`             |
| `status [path]`                              | sdlc-config + framework-file presence                   | `commands/status.ts`                   |
| `upgrade`                                    | **stub** (prints "not implemented" → exit 1)            | `commands/stub.ts`                     |
| `org …`, `config …`                          | **stubs** (workstream B; tracked-in message)            | `commands/stub.ts`                     |

**Global flags** (`--json`, `-y/--yes`, `--dry-run`, `-v/--verbose`, `--no-color`, `--org <slug>`) are registered on the root program; `--org` is currently parse-only/inert.

### 1.3 Framework template surface (`sdlc/files/`)

- **Eight skills** (`_common/skills/*/SKILL.md`): `sdlc-implementer` (orchestrator, stages 1–5), `e2e-test-engineer`, `e2e-ci-reliability`, `governance-doc-author`, `requirements-aligner`, `adr-author`, `risk-register-keeper`, `devaudit-configure` (repo settings, #1040).
- **CI workflow templates** (`ci/*.yml.template`): the five core — `ci.yml`, `compliance-evidence.yml`, `compliance-validation.yml`, `check-release-approval.yml`, `post-deploy-prod.yml` — plus secondary `ci-status-fallback`, `close-out-release`, `incident-export`, `label-retention` (incident label enforcement, #210), `periodic-review`, `feature-e2e` (feature-branch in-scope E2E, issue #174), and a `ci/python/` override.
- **Adapters:** stacks `node` + `python` (`adapter.json` + `hooks/` + node `scripts/`), hosts `railway`, `vercel` and `custom` (`adapter.json`; #1022). `_schema/adapter.schema.json` enforced at runtime via Ajv (`cli/src/lib/adapter.ts`).
- **Governance starters** (`_common/governance/*.md.template`): `ai-disclosure`, `dpia`, `incident-report`, `nil-incident-report` (per-release "no incidents" attestation, #210), `periodic-review`, `risk-register`, `ropa` — opt-in via `bootstrap-governance`.
- **Single-source-of-truth AI rule files** synced per agent: `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `GEMINI.md`, `INSTRUCTIONS.md` — content sourced from `sdlc/ai-rules/INSTRUCTIONS-SDLC.md` (the canonical `INSTRUCTIONS.md` holds the content; the others point to it).
- **Stage + Tier-1 docs:** `_common/0-project-setup.md … 5-deploy-main.md`, `Test_Policy.md`, `Test_Strategy.md`, `Test_Architecture.md`, `Periodic_Security_Review_Schedule.md` — synced verbatim.

### 1.4 External dependencies an E2E run must stand up, seed, or stub

| Dependency                                                                                                                                                               | Used by                                              | E2E strategy                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| DevAudit **portal HTTP API** (PAT validation `GET /api/projects`, project create, CI-key issuance, evidence `POST /api/evidence/upload`, `GET /api/ci/releases/resolve`) | `install`, `push`, `auth`, `doctor`, CI templates    | **msw** stub (unit) or a local HTTP stub at `DEVAUDIT_BASE_URL` (CLI-E2E)               |
| **`gh`** CLI                                                                                                                                                             | `install`/`join` (GitHub secrets, branch protection) | `vi.mock('execa')` (unit) or an on-disk `gh` shim on `PATH` (CLI-E2E)                   |
| **`git`**                                                                                                                                                                | most commands (repo detection, provider)             | real `git init` fixture repo or execa mock                                              |
| **`npm`**                                                                                                                                                                | `update` (stack dev-deps), `plugin update`           | mock or allow in a sandboxed fixture                                                    |
| **husky** (node) / **pre-commit** (python)                                                                                                                               | `hooks-bootstrap`, stack hooks                       | assert installed hook files exist                                                       |
| Bundled `sdlc/files/`                                                                                                                                                    | `install`/`update`/`bootstrap-governance`            | set `DEVAUDIT_INSTALLER_ROOT` to the repo root, or run `npm run bundle:templates` first |

### 1.5 Existing test setup (summary — full detail in §2)

- **Unit/integration:** **vitest 4.1.x**, `cli/test/*.test.ts` (10 files). 8 import the action function directly (`runInstall`, `syncProject`, …) and assert a returned report + the fixture filesystem; `status.test.ts` + `doctor.test.ts` spawn the real `bin/devaudit.js` via **execa** (requires a prior `npm run build`). Portal HTTP is stubbed with **msw** (`DEVAUDIT_BASE_URL` → mock); `gh`/`git` via `vi.mock('execa')` or an injected fake provider; fixtures are `fs.mkdtemp` temp repos; templates resolve via `DEVAUDIT_INSTALLER_ROOT`.
- **CI:** `.github/workflows/cli.yml` — matrix `{ubuntu, macos, windows} × node 22`: build `plugin-sdk`, build and test `core` → install → `tsc --noEmit` → `npm run build` → `npm test` → `--help`/`--version` smoke. `release.yml` — tag-triggered; publishes the six packages in dependency order (`plugin-sdk`, `core`, `cli`, the two plugins, `sdlc`), and has a manual `core` prerelease mode (REQ-CLI-RELEASE-003); `prepack` makes the CLI tarball self-contained.
- **No true CLI-E2E layer exists** in this repo. The "real `install`/`update` against the example-app / EXAMPLE-JOBS-APP consumers" coverage is **manual/external**, not encoded here. `docs/e2e-local-db-ci.md` concerns the E2E gate the CLI _generates inside consumers_, not the binary's own tests. §2 records the truth and a recommended CLI-E2E approach.

---

## 2. E2E Testing Stack

This section documents the test stack for the `devaudit` CLI as it actually exists
in the repo (`cli/`), so a developer or Claude Code's `e2e-test-engineer` can add a
new CLI test that matches the established conventions. Everything below was confirmed
from source; file paths are absolute under
`/home/william/Documents/SoftwareProjects/Metasession/DevAudit-Installer`.

### Frameworks & versions

The CLI test stack is **Vitest-based** — there is no Jest, Playwright, or Cucumber in
the CLI package (those belong to the _consumer_ projects the CLI onboards, not to the
CLI itself).

| Tool         | Range (`cli/package.json`) | Locked (`cli/package-lock.json`) | Role                                                                            |
| ------------ | -------------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| `vitest`     | `^4.1.6`                   | **4.1.6**                        | unit/integration test runner (`test = vitest run`)                              |
| `msw`        | `^2.7.0`                   | **2.14.6**                       | HTTP mocking of the DevAudit portal API (`msw/node` `setupServer`)              |
| `tsup`       | `^8.3.5`                   | **8.5.1**                        | bundler — `build` emits `dist/index.js` (ESM, `target: node22`, shebang banner) |
| `execa`      | `^9.5.1` (runtime dep)     | **9.6.1**                        | child-process exec; mocked in unit tests, used for real in subprocess tests     |
| `typescript` | `^5.7.2`                   | **5.9.3**                        | `typecheck = tsc --noEmit`                                                      |
| node engine  | `>=22` (`engines.node`)    | —                                | CI runs node `22` only                                                          |

- There is **no `tsx`** dependency in `cli/package.json` (it appears transitively in
  the lockfile only). Tests are TypeScript (`test/**/*.test.ts`) and Vitest transpiles
  them in-process — they are **not** pre-compiled.
- Config files: `cli/vitest.config.ts` (`environment: 'node'`, `include: ['test/**/*.test.ts']`,
  coverage over `src/**/*.ts`), `cli/tsup.config.ts`, `cli/tsconfig.json`.
- `plugin-sdk/`, `plugins/devaudit-plugin-prisma/`, and `plugins/devaudit-plugin-evidence-export/`
  use the **same** stack (`test = vitest run`, `vitest@^4.1.6`, `tsup`) with their own
  `test/*.test.ts` suites (e.g. `plugin-sdk/test/{lifecycle,manifest,types}.test.ts`).

### How tests are structured today

There are **10 test files** in `cli/test/`. The dominant convention is **direct
import of the action/handler function** (not a subprocess), with `execa` and the portal
mocked. Only two files spawn the real binary.

| Test file                    | Invocation style                                                                                                                                       | What it covers                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `install.test.ts`            | direct: `await import('../src/install/index.js')` → `runInstall(opts)`                                                                                 | full install flow, dry-run, dev-mode detection, 401 handling, config preservation          |
| `update.test.ts`             | direct: `import { syncProject } from '../src/update/index.js'`                                                                                         | template sync, idempotency, CI `ci.yml` rendering, e2e step injection, unknown-stack error |
| `join.test.ts`               | direct: `await import('../src/commands/join.js')` → `runJoinCommand(opts)`                                                                             | second-dev gating (`exit 7` when no `sdlc-config.json`)                                    |
| `flag-polish.test.ts`        | direct: `runAuthStatus` / `runStatus` / `runPush` from `../src/commands/...`                                                                           | `--json` output shape, `--dry-run`, `not_onboarded` exit 7                                 |
| `plugin.test.ts`             | direct: `discoverPlugins`, `loadPluginFromDir`, `runHook`, `registerPluginCommands` from `../src/lib/plugin/index.js`                                  | plugin discovery, hook isolation, command registration                                     |
| `plugin-commands.test.ts`    | direct: `runPluginList/Install/Remove/Update` from `../src/commands/plugin/*.js`                                                                       | plugin lifecycle commands (clone/pull/remove)                                              |
| `git-provider.test.ts`       | direct: `GitHubProvider` from `../src/lib/git-provider/github.js` + `classifyRemoteUrl`                                                                | `gh`-CLI-preferred path + REST fallback                                                    |
| `evidence-shot-core.test.ts` | direct: pure functions imported from the **shipped skill reference** `../../sdlc/files/_common/skills/e2e-test-engineer/references/evidence-shot-core` | input validation, filename composition                                                     |
| **`status.test.ts`**         | **subprocess: `execa('node', [BIN, 'status', dir], { reject: false })`**                                                                               | end-to-end binary smoke against `bin/devaudit.js`                                          |
| **`doctor.test.ts`**         | **subprocess: `execa('node', [BIN, ...], { reject: false })`**                                                                                         | `--help`, `--version`, `doctor`, stubbed `org list`                                        |

So the repo already contains a thin **CLI-subprocess layer** in `status.test.ts` and
`doctor.test.ts`. They compute the binary path the same way:

```ts
const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, "..", "bin", "devaudit.js");
// ...
const result = await execa("node", [BIN, "status", fixtureDir], {
  reject: false,
});
expect(result.exitCode).toBe(0);
expect(result.stdout + result.stderr).toContain("fixture-app");
```

Note `bin/devaudit.js` simply `import()`s `../dist/index.js` — so **any subprocess
test requires `npm run build` to have run first** (CI builds before `npm test`; see
below). Assertions on the subprocess path consistently check `result.exitCode` plus
`result.stdout + result.stderr` substring matches (stderr is folded in because Consola
logs to stderr). Specific exit codes are load-bearing and asserted: `7` = not onboarded
(`status`/`join`), `6` = doctor tool-gate failure, `2` = plugin-not-found.

The dominant **direct-import** convention reads, e.g. (`install.test.ts:166`):

```ts
it("full run writes sdlc-config.json, creates project, issues key, sets secrets, syncs", async () => {
  const { runInstall } = await import("../src/install/index.js");
  const dir = await buildNodeFixture();
  await fs.writeFile(
    join(dir, "sdlc-config.json"),
    JSON.stringify({
      project_slug: "fixture-app",
      stack: "node",
      host: "railway",
      node_version: "20",
    }),
  );
  const report = await runInstall({
    path: dir,
    dryRun: false,
    nonInteractive: true,
    provider: makeFakeProvider(),
  });
  const stepByStart = (s: string) =>
    report.steps.find((x) => x.step.startsWith(s));
  expect(stepByStart("4/")?.status).toBe("ok");
  const written = JSON.parse(
    await fs.readFile(join(dir, "sdlc-config.json"), "utf-8"),
  );
  expect(written.integration_branch).toBe("develop");
}, 60_000);
```

Conventions to mirror:

- `describe(<symbol-or-command> — <one-line behaviour>)`, BDD-style `it('<does X>')`.
- Action fns return a structured **report** object (e.g. `report.steps[]` with `.status`
  of `ok | warn | skipped | planned`); tests assert against that, plus the filesystem.
- Every fs-touching test gets a per-test timeout of **`30_000` or `60_000` ms** as the
  third arg to `it(...)` (tmp-dir + sync work is slow).
- `nonInteractive: true` is passed to bypass `@clack/prompts`; the `--yes` path requires
  a pre-seeded `sdlc-config.json`.

### Mocking & fixtures

**Portal HTTP — mocked with MSW (`msw/node`).** Confirmed in `install.test.ts`,
`join.test.ts`, `git-provider.test.ts`, and `flag-polish.test.ts`. Pattern:

```ts
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const BASE_URL = "https://devaudit.test";
const handlers = [
  http.get(`${BASE_URL}/api/projects`, () => HttpResponse.json([])),
  http.post(`${BASE_URL}/api/projects`, async ({ request }) => {
    const body = (await request.json()) as { slug: string; name: string };
    return HttpResponse.json(
      { id: "…", slug: body.slug, name: body.name },
      { status: 201 },
    );
  }),
  http.get(`${BASE_URL}/api/projects/:id/api-keys`, () =>
    HttpResponse.json([]),
  ),
  http.post(`${BASE_URL}/api/projects/:id/api-keys`, () =>
    HttpResponse.json(
      {
        id: "key-1",
        name: "Onboarding-issued",
        plainTextKey: "dak_test_plain",
      },
      { status: 201 },
    ),
  ),
];
const server = setupServer(...handlers);

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" }); // any un-stubbed request FAILS the test
  process.env["DEVAUDIT_USER_TOKEN"] = "mctok_test_fixture";
  process.env["DEVAUDIT_BASE_URL"] = BASE_URL; // point the CLI at the mock origin
});
afterEach(() => server.resetHandlers(...handlers)); // per-test overrides via server.use(...)
afterAll(() => {
  server.close(); /* delete env vars */
});
```

Key idioms: `onUnhandledRequest: 'error'` (a stray real HTTP call is a hard failure);
per-test overrides via `server.use(http.get(... 401 ...))` (e.g. the "PAT rejected /
HTTP 401" case at `install.test.ts:296`); the CLI is pointed at the mock by setting
`DEVAUDIT_BASE_URL`. `git-provider.test.ts` additionally mocks `api.github.com` REST
endpoints to exercise the gh-less fallback path.

**`gh` CLI + child processes — mocked with `vi.mock('execa', …)`.** `msw` cannot
intercept the `gh` binary, so command tests replace `execa` with a fake that records
calls and returns canned `{ exitCode, stdout, stderr }` keyed on `(file, args)`:

```ts
const execaCalls: { file: string; args: readonly string[] }[] = [];
vi.mock("execa", () => ({
  execa: async (
    file: string,
    args: readonly string[] = [],
    _opts: unknown = {},
  ) => {
    execaCalls.push({ file, args });
    if (file === "which" || file === "where")
      return { exitCode: 0, stdout: `/usr/bin/${args[0]}`, stderr: "" };
    if (file === "gh" && args[0] === "repo" && args[1] === "view")
      return { exitCode: 0, stdout: "metasession-dev/fixture-app", stderr: "" };
    if (file === "gh") return { exitCode: 0, stdout: "", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  },
}));
```

Tests then assert on the recorded `execaCalls` (e.g. `git-provider.test.ts` checks
`setSecret` piped the value via `opts.input` over stdin). `git-provider.test.ts` also
flips module-level flags (`ghAvailable`, `ghRepoViewStdout`, `ghSecretListStdout`) and
calls `resetGhAvailabilityCache()` in `afterEach` to toggle the gh-present vs gh-missing
branches.

**Git provider — also faked at the object level.** `install.test.ts`/`join.test.ts`
inject `provider: makeFakeProvider()` (a hand-rolled object implementing
`getRepoMeta/setSecret/setVariable/hasSecret/deleteSecret/deleteVariable/applyBranchProtection/createPullRequest`)
that records `providerCalls[]`. `uninstall.test.ts` uses the same pattern, asserting on
`deleteSecret`/`deleteVariable` calls specifically (devaudit-installer#778). This is the cleanest seam for asserting _which_ secrets
and branch-protection calls were made without touching `gh` at all. Dev-mode tests use a
`makeOnboardedProvider()` variant whose `hasSecret` returns `true` — vestigial since #912, when
developer-mode detection stopped consulting `hasSecret` (the portal project + live key + on-disk
config are what trip dev mode now).

**Fixture consumer repos — real tmp dirs.** Every fs test builds a throwaway consumer
with `fs.mkdtemp(join(tmpdir(), 'cli-install-fixture-'))`, writes a `package.json`
(with the node-stack `devDependencies` pre-seeded so `syncStackDeps` reports "all
present" and never shells out to npm) and/or a seeded `sdlc-config.json`, `mkdir`s
`.husky/`, `scripts/`, `.github/workflows/`, runs the action, asserts on emitted files,
and `fs.rm(dir, { recursive: true, force: true })` in `finally`. A python fixture would
write `pyproject.toml` instead (stack detection keys off these two files; absence throws
`Could not detect stack`).

**Bundled-templates resolution in tests.** The unit suites do **not** run
`bundle:templates`. Instead they set `process.env['DEVAUDIT_INSTALLER_ROOT']` to the
repo root so `resolveInstallerRoot()` (`cli/src/lib/installer-root.ts`) reads the
**canonical** `sdlc/files/` directly from the checkout:

```ts
const INSTALLER_ROOT = resolve(HERE, "..", ".."); // install/update.test.ts → repo root
process.env["DEVAUDIT_INSTALLER_ROOT"] = INSTALLER_ROOT; // priority-1 override
```

`resolveInstallerRoot()` resolves in priority order: (1) `DEVAUDIT_INSTALLER_ROOT`,
(2) the package's own bundled snapshot (`cli/sdlc/`, produced by `bundle:templates` at
`prepack`), (3) the repo root (`cli/dist/index.js` → `../..`). The sentinel is the
presence of `sdlc/files`. The subprocess tests (`status`/`doctor`) don't touch templates,
so they need no override.

### How to run

**Local.**

```bash
cd cli
npm install --legacy-peer-deps   # plugin-sdk is a file: dep — build it first if needed
npm run build                    # tsup → dist/index.js (REQUIRED before subprocess tests run the bin)
npm test                         # = vitest run (all 10 files)
npm run test:watch               # = vitest (watch)
npx vitest run test/install.test.ts   # a single file
npm run typecheck                # = tsc --noEmit
```

**CI — `.github/workflows/cli.yml`** (triggers on push to `main` and on PRs touching
`cli/**`, `plugin-sdk/**`, or the workflow). Matrix: **`{ubuntu-latest, macos-latest,
windows-latest} × node 22`**, `fail-fast: false`, `shell: bash`, `working-directory:
cli`. Steps, in order:

1. `actions/checkout@v4`; `actions/setup-node@v4` (node 22, npm cache keyed on `cli/package-lock.json`).
2. Build **`plugin-sdk`** first (`npm install --legacy-peer-deps && npm run build`) — the
   CLI depends on it via `file:../plugin-sdk` — then type-check, build and test **`core`**
   (`file:../core`).
3. `npm install --legacy-peer-deps` (in `cli/`).
4. **TypeScript:** `npx tsc --noEmit`.
5. **Build:** `npm run build` (so `bin/devaudit.js` can load `dist/`).
6. **Test:** `npm test` (Vitest).
7. **Smoke:** `node ./bin/devaudit.js --help` and `… --version`.

There is **no coverage gate, lint step, or `bundle:templates` step in CI** — typecheck +
build + vitest + the two smoke invocations are the full gate. `plugin-sdk.yml`,
`plugin-prisma.yml`, `plugin-evidence-export.yml` mirror this shape for their packages.

**Release / npm-publish path — `.github/workflows/release.yml`** (triggers on a
`v[0-9]+.[0-9]+.[0-9]+` tag push, or `workflow_dispatch` with a `version` input).
Publishes **6 packages** in dependency order:

1. `plugin-sdk` → install + build + `npm publish --provenance --access public`.
   `core` (`@metasession.co/devaudit-core`) → install + build + test + the same publish,
   verified with `scripts/verify-npm-publication.sh`.
2. Rewrite `file:../plugin-sdk` → `^X.Y.Z` (the just-published version) in all 3
   dependents, and `file:../core` → `^X.Y.Z` in the cli only, via `jq` (in-place, never
   committed back).
3. `cli` → `npm install --legacy-peer-deps && npm run build && npm publish --provenance …`.
   Publishing triggers npm's **`prepack`** lifecycle = `npm run build && npm run
bundle:templates`, which (a) re-bundles `dist/` and (b) copies the repo-root `sdlc/`
   and `scripts/upload-evidence.sh` into the package (`cli/tools/bundle-templates.mjs`),
   so the published tarball is self-contained (`files: [bin, dist, sdlc, scripts, …]`).
4. The two plugins publish the same way.
5. `gh release create $TAG --generate-notes`.

The version is whatever is committed in `package.json` (currently `0.1.54`); the tag
drives the release. There is no automated version-bump commit step in this workflow.

### Existing E2E coverage

**There is no true CLI end-to-end test layer committed to this repo that runs a real
`install`/`update` against a live consumer.** Confirmed by exhaustively reading every
workflow (`cli.yml`, `release.yml`, the three plugin workflows), `scripts/`,
`cli/scripts/`, and searching for any `e2e`/integration workflow or any reference to a
real consumer (`example-app`/`example-app`/`EXAMPLE-JOBS-APP`) used as a test target — none exists.

What _does_ exist:

- The **closest-to-E2E automated tests** are the subprocess smokes in `status.test.ts`
  and `doctor.test.ts` (real `bin/devaudit.js` via `execa`) plus the `--help`/`--version`
  smoke steps in `cli.yml`. These exercise the real binary but only against a tmp-dir
  fixture (or no project), never a real repo, and never the network (portal mocked /
  absent).
- The full `install`/`update` flows are covered as **integration tests with mocked
  edges** (`runInstall`/`syncProject` directly, portal via msw, `gh`/git via `execa` or
  provider fakes, consumer = tmp dir). High coverage, but the seams (msw, execa) mean no
  real `gh`, no real network, no real npm/husky install runs in CI.
- The **real install/update-against-a-consumer story is manual/external.** Per
  `docs/consuming-projects.md`, the only live consumer is **example-app (example-app)**;
  EXAMPLE-PAUSED-APP / EXAMPLE-PYTHON-SERVICE / EXAMPLE-JOBS-APP onboarding attempts were started then reverted and
  none currently runs SDLC gates against DevAudit. Operators run
  `npx @metasession.co/devaudit-cli@latest install|update <consumer-path>` by hand
  against those repos; that real-world exercise is **not** encoded as a test or workflow
  in this repo. `docs/e2e-local-db-ci.md` is unrelated to CLI E2E — it documents the
  E2E _gate the CLI generates inside consumer repos_ (the `e2e_setup_command` / `e2e_env`
  knobs that thread a local DB into the consumer's `ci.yml`), not testing of the `devaudit`
  binary itself.

Bottom line: the test pyramid today is **unit/integration-only** (with two subprocess
smokes); the top "real install against a tracer consumer" tier is a manual operator
procedure, not automation.

> **Update (#941).** The SDLC-lifecycle half of that top tier is now automated against a
> mock portal: `cli/test/release-approval-gate-behavior.test.ts` executes the rendered
> Release Approval Gate steps, `cli/test/close-out-workflow-behavior.test.ts` executes the
> rendered Release Close-out steps (ticket/RTM reconciliation, idempotency, `pr_opened`
> then `completed` reports) against a tracer-consumer fixture, a fake `gh` and the mock
> portal, and `tests/release-pipeline-e2e/run.sh` drives the scripts end to end. Both
> workflow tests run in release-validation layer 1 (the full vitest suite) and layer 2b
> against each clone's own workflow. The real install/update against a live consumer
> (sync mechanics) remains #932's cloned-consumer gate.

### Recommended CLI-E2E approach

> **Recommendation.** Add a dedicated **CLI-integration tier** that drives the real
> `bin/devaudit.js` via `execa` against a throwaway git fixture repo, with the portal
> stubbed and a `gh` shim on `PATH` — then, separately, a small **full-E2E** tier that
> runs a real `install`/`update` against a disposable "tracer" consumer. This fills the
> exact gap above while reusing every convention already in the repo.

**Layering (test pyramid).**

1. **Unit / action-fn integration — already present (✓).** Keep `runInstall`/`syncProject`/
   provider-fake/msw tests as the fast, broad base. No change.
2. **CLI integration via execa + fixtures — the recommended new layer.** New files under
   `cli/test/` (e.g. `cli-install.e2e.test.ts`) that:
   - Compute `BIN = resolve(HERE, '..', 'bin', 'devaudit.js')` and run
     `execa('node', [BIN, 'install', fixtureDir, '--yes'], { env, reject: false })`,
     exactly like `status.test.ts`.
   - **Build a throwaway _git_ fixture repo:** `fs.mkdtemp(...)`, write `package.json` /
     `sdlc-config.json`, and `git init` + an initial commit (so `gh repo view` / branch
     logic has a real remote to classify — set a fake `origin` with
     `git remote add origin git@github.com:metasession-dev/fixture-app.git`).
   - **Stub the portal:** since msw runs _in-process_ and can't reach the subprocess,
     either (a) start MSW inside the test and pass `DEVAUDIT_BASE_URL` pointing at a real
     local HTTP listener you control, or (b) stand up a tiny throwaway HTTP server
     (node `http`) in `beforeAll`, hand its URL to the CLI via
     `env.DEVAUDIT_BASE_URL` + `env.DEVAUDIT_USER_TOKEN='mctok_test_fixture'`. Option (b)
     is the cleaner fit for a subprocess.
   - **Shim `gh` (and optionally `git`) on `PATH`:** write a fake executable `gh` into a
     tmp `bin/` dir (e.g. a `#!/usr/bin/env node` script that echoes canned JSON for
     `repo view` / `secret list` and exits 0 for `secret set` / `variable set` / `api`),
     `chmod +x`, and prepend that dir to `env.PATH`. This replaces the `vi.mock('execa')`
     seam (which is unavailable across a process boundary) with a real on-disk shim.
   - **Assert on the trifecta:** `result.exitCode`, `result.stdout + result.stderr`
     substrings, **and** the fixture filesystem (e.g. `sdlc-config.json` rewritten with
     `integration_branch: 'develop'`; `SDLC/`, `.husky/`, `.github/workflows/ci.yml`
     emitted; `ci.yml` contains the project slug and no `{{…}}` placeholders) — mirroring
     `update.test.ts`'s file assertions but through the real binary.
   - **Prerequisite — `bundle:templates`.** A subprocess that does _not_ set
     `DEVAUDIT_INSTALLER_ROOT` resolves templates from the package's bundled snapshot
     (`cli/sdlc/`), which only exists after `npm run bundle:templates`. So either run
     `npm run build && npm run bundle:templates` in the test's global setup, **or** set
     `env.DEVAUDIT_INSTALLER_ROOT` to the repo root (priority-1 override, what the unit
     tests do) so `install`/`update` can resolve `sdlc/files/`. The former is the more
     faithful E2E (it proves the published-tarball layout works); the latter is faster.
     Either way `npm run build` must precede the test so `bin/devaudit.js` can load `dist/`.
3. **Full E2E against a tracer consumer — opt-in / consumer-configured schedule or dispatch, not the PR gate.** A
   gated job (manual `workflow_dispatch` or scheduled) that checks out a small,
   purpose-built **tracer** consumer repo, runs the _real_ published-or-built CLI
   `install` then `update` against it with a **real** `gh` and a **dedicated test**
   DevAudit portal/project (never prod), and asserts the consumer's gates render and the
   secrets/branch-protection landed. Keep this out of the fast `cli.yml` matrix (it's slow,
   needs live creds, and is platform-sensitive); wire it as a separate workflow so a green
   run is an explicit release-readiness signal rather than a per-PR cost.

**Why this shape:** it preserves the repo's existing seams and idioms (tmp-dir fixtures,
`exitCode + stdout/stderr` assertions, file-tree assertions, `DEVAUDIT_BASE_URL` /
`DEVAUDIT_USER_TOKEN` env, the `bin/` path computation) while moving the mock boundary
_outward_ one layer at a time — from in-process function calls (tier 1) to a real
subprocess with on-disk `gh`/portal stubs (tier 2) to a real consumer with live
dependencies (tier 3) — which is exactly the coverage the current unit-only suite lacks.

---

## 3. Prioritized Requirements Index

398 requirements across the CLI, framework templates, and skills (recounted 2026-10-30 after adding `REQ-CLI-DOCTOR-026` to `-031`; 392 recounted 2026-10-30 after adding `REQ-CLI-CONFIGURE-005` and `-006`; 390 recounted 2026-10-30 after adding `REQ-CLI-ONBOARD-002`, `-003`, `-004`, `-008` and `REQ-CLI-INSTALL-031`; 385 recounted 2026-10-30 after adding `REQ-CLI-ONBOARD-001`, `-005`, `-006` and `-007`; 381 recounted 2026-10-30 after adding `REQ-CLI-SCAN-008`; 380 recounted 2026-10-30 after adding `REQ-CLI-ONBOARD-009`; 379 recounted 2026-10-29 after adding `REQ-CLI-CONFIGURE-007`, `REQ-CLI-INSTALL-032` and `REQ-FRAMEWORK-CIYML-027`; 376 recounted 2026-10-29 after adding `REQ-CLI-RELEASE-003`; 375 recounted 2026-10-28 after adding `REQ-CLI-DOCTOR-025`; 374 recounted 2026-10-27 after adding `REQ-CLI-DOCTOR-024`; 373 recounted 2026-10-27 after adding `REQ-SKILL-E2E-012`; 372 recounted 2026-10-27 after adding `REQ-CLI-PLUGIN-007`; 371 recounted 2026-10-27 after adding `REQ-CLI-AUTH-008` and `REQ-CLI-RELEASE-002`; 369 recounted 2026-10-27 after adding `REQ-CLI-DOCTOR-022` and `-023`; 367 recounted 2026-10-22 after adding `REQ-FRAMEWORK-EVIDENCE-017`; 366 after adding `REQ-CLI-INSTALL-029` and `-030`; 364 after adding `REQ-CLI-DOCTOR-020` and `-021`; 362 after adding `REQ-FRAMEWORK-RELGATE-001..003`; 359 after adding `REQ-FRAMEWORK-TIERS-002`; 358 after adding `REQ-FRAMEWORK-TIERS-001` and `-003`; 356 after adding `REQ-FRAMEWORK-CIYML-026`; 355 after adding `REQ-FRAMEWORK-CIYML-025`; 354 after adding `REQ-CLI-DOCTOR-016..019`, `REQ-CLI-CONFIGURE-001..004` and `REQ-SKILL-CONFIGURE-001`; 345 after adding `REQ-FRAMEWORK-ADAPTER-019`; previously, after adding `REQ-FRAMEWORK-ADAPTER-017/018`; 342 after adding `REQ-CLI-INSTALL-028` and `REQ-FRAMEWORK-ADAPTER-016`; 340 after adding `REQ-FRAMEWORK-BUNDLE-009`; 339 after adding `REQ-FRAMEWORK-LIFECYCLE-001`; 338 after adding `REQ-FRAMEWORK-ATTRIBUTION-001/002`; 336 after adding `REQ-FRAMEWORK-DEPRISK-001..003`; 333 after adding `REQ-FRAMEWORK-E2ETRIAGE-001..006` and `REQ-CLI-DOCTOR-015`; 326 after adding `REQ-FRAMEWORK-CIYML-024`; 325 after adding `REQ-CLI-DOCTOR-014`; 324 after adding `REQ-FRAMEWORK-EVIDENCE-016`; recounted 2026-10-13 after adding the index rows for `REQ-CLI-PUSH-019` and `REQ-FRAMEWORK-EVIDENCE-015`, which had bodies but no row; recounted 2026-10-12 after adding `REQ-CLI-DOCTOR-010..013` and `REQ-FRAMEWORK-DEFERRAL-005`, 316 verified before adding; recounted 2026-10-11 after adding `REQ-SKILL-IMPLEMENTER-034`, which also corrected a stale Should count of 134 to the table's actual 137 before adding it; recounted 2026-10-11 after adding `REQ-CLI-DOCTOR-007..009`; recounted 2026-10-11 after adding `REQ-FRAMEWORK-DEFERRAL-001..004`, which also corrected a stale 304 to the table's actual 308 before adding them; recounted 2026-10-11 after adding `REQ-FRAMEWORK-BUNDLE-006..008`; recounted 2026-10-04 after adding `REQ-FRAMEWORK-BUNDLE-001..005`; the count was previously recounted 2026-09-29, when the stated 203 had drifted from the table's actual row count). **MoSCoW:** 156 Must · 204 Should · 34 Could · 4 Won't (table-verified 2026-10-27, Could up from 32 after `REQ-CLI-PLUGIN-007`; up from 177 Should after the two new rows; the stated Should count had drifted). Run **Must** first (CLI smoke), then **Should** (CLI critical), then **Could** (regression); **Won't** rows document unbuilt stubs (`org`, `config`, `upgrade`, inert `--org`).

| ID                           | Title                                                                                                                                                       | Priority | Primary source                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| REQ-CLI-INSTALL-001          | install command registration, args, and option surface                                                                                                      | Must     | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-INSTALL-002          | Token resolution precedence and missing-token failure                                                                                                       | Must     | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-INSTALL-003          | Project-path validation and banner                                                                                                                          | Must     | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-INSTALL-004          | Step 1/12 auth-probe (PAT validation against portal)                                                                                                        | Must     | `cli/src/install/auth-probe.ts`                                                                                               |
| REQ-CLI-INSTALL-005          | Step 2/12 stack detection (node vs python, working directory)                                                                                               | Must     | `cli/src/install/detect-stack.ts`                                                                                             |
| REQ-CLI-INSTALL-006          | Step 3/12 plan collection — interactive prompts                                                                                                             | Must     | `cli/src/install/prompts.ts`                                                                                                  |
| REQ-CLI-INSTALL-007          | Step 3/12 plan collection — non-interactive (-y/--yes) from sdlc-config.json                                                                                | Should   | `cli/src/install/prompts.ts`                                                                                                  |
| REQ-CLI-INSTALL-008          | Step 4/12 write sdlc-config.json (operator mode, merge semantics)                                                                                           | Must     | `cli/src/install/write-config.ts`                                                                                             |
| REQ-CLI-INSTALL-009          | Step 5/12 find-or-create DevAudit project (portal)                                                                                                          | Must     | `cli/src/install/project.ts`                                                                                                  |
| REQ-CLI-INSTALL-010          | Step 6/12 issue project API key ("Onboarding-issued")                                                                                                       | Must     | `cli/src/install/api-key.ts`                                                                                                  |
| REQ-CLI-INSTALL-011          | Step 7/12 set GitHub secrets and variables                                                                                                                  | Must     | `cli/src/install/github.ts`                                                                                                   |
| REQ-CLI-INSTALL-012          | Step 8/12 bootstrap hook framework (husky / pre-commit)                                                                                                     | Must     | `cli/src/install/hooks-bootstrap.ts`                                                                                          |
| REQ-CLI-INSTALL-026          | Step 9/12 set default branch to integration_branch (#731)                                                                                                   | Must     | `cli/src/install/default-branch.ts`                                                                                           |
| REQ-CLI-INSTALL-013          | Step 10/12 configure branch protection                                                                                                                       | Must     | `cli/src/install/branch-protection.ts`                                                                                        |
| REQ-CLI-INSTALL-014          | Step 11/12 sync SDLC templates into the consumer repo                                                                                                       | Must     | `cli/src/install/sync-templates.ts`                                                                                           |
| REQ-CLI-INSTALL-015          | Step 12/12 done report (operator copy) and no governance auto-seed                                                                                          | Must     | `cli/src/install/done-report.ts`                                                                                              |
| REQ-CLI-INSTALL-016          | Developer-mode auto-routing (three-bit detection skips steps 4/6/7/9/10) (#912)                                                                              | Must     | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-INSTALL-017          | --force-team-config pins operator mode (rotation lane)                                                                                                      | Should   | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-INSTALL-018          | --dry-run preview (no mutation, operator-max step set)                                                                                                      | Should   | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-INSTALL-019          | Plugin lifecycle hooks around install (beforeInstall/afterInstall)                                                                                          | Could    | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-INSTALL-020          | --json machine-readable step stream                                                                                                                         | Could    | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-INSTALL-021          | Backward-compatible targets array for multi-target consumers (#689)                                                                                         | Must     | `cli/src/lib/sdlc-config.ts`                                                                                                  |
| REQ-CLI-INSTALL-022          | --add-target: append a new target instead of refusing or clobbering (#691)                                                                                  | Must     | `cli/src/install/write-config.ts`                                                                                             |
| REQ-CLI-INSTALL-023          | api_key_secret collision avoidance across targets (#694)                                                                                                    | Must     | `cli/src/install/prompts.ts`                                                                                                  |
| REQ-CLI-INSTALL-024          | Branch protection: per-target namespaced checks, read-merge-write union (#695/#696)                                                                         | Must     | `cli/src/install/branch-protection.ts`                                                                                        |
| REQ-CLI-INSTALL-025          | Hook coexistence: husky (Node target) + pre-commit (Python target) in one repo (#697)                                                                       | Should   | `cli/src/install/hooks-bootstrap.ts`                                                                                          |
| REQ-CLI-INSTALL-027          | install issues your own read-only viewer key by default (step 6b), saved locally, never a repo secret; `--no-viewer-key`, `--print-viewer-key` (#867, #1099) | Should   | `cli/src/install/api-key.ts`, `cli/src/install/prompts.ts`                                                                    |
| REQ-CLI-INSTALL-029          | `install` detects the test runner, proposes tier commands and accepts `--test-*` flags; nothing is written unless named (#1060)                              | Should   | `cli/src/install/test-config.ts`, `cli/src/lib/test-runner-detect.ts`                                                         |
| REQ-CLI-INSTALL-030          | `install` asks for or accepts the release gate (`--release-gate-tier`, `--post-deploy-full-regression`, `--scheduled-full-regression`); `--host` is forwarded (#1059) | Should   | `cli/src/install/test-config.ts`, `cli/src/commands/install.ts`, `cli/src/index.ts`                                          |
| REQ-CLI-INSTALL-031          | The guided answers are written by dotted key, the keys of another preset are removed, the self-hosted runner label becomes the `CI_RUNNER_LABEL` variable, and a refused option exits 2 (#1116 WP6) | Should   | `cli/src/install/write-config.ts`, `cli/src/install/github.ts`, `cli/src/install/refusal.ts`, `cli/src/commands/install.ts` |
| REQ-CLI-INSTALL-032          | The release branch's required approving reviews come from `release_branch_required_reviews` (0-2, default 1) at install and are kept by update in both directions; lowering needs a confirmation (#1116 WP2) | Should   | `cli/src/install/branch-protection.ts`, `cli/src/update/branch-protection.ts`, `cli/src/lib/git-provider/github.ts` |
| REQ-CLI-INSTALL-028          | install --host <name> and an interactive host prompt record the deploy host; a recorded host is never reset by a re-run; unknown hosts fail with the valid list (#1022)| Should   | `cli/src/install/hosts.ts`, `cli/src/install/prompts.ts`, `cli/src/index.ts`                                                  |
| REQ-CLI-JOIN-001             | join command registration and developer-mode pin                                                                                                            | Must     | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-JOIN-002             | join pre-flight: refuses when sdlc-config.json is absent (exit 7)                                                                                           | Must     | `cli/src/commands/join.ts`                                                                                                    |
| REQ-CLI-JOIN-003             | join runs developer-mode flow: skips 4/6/7/9, runs 8/10, prints developer done report                                                                       | Must     | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-JOIN-004             | join --dry-run and join -y propagation                                                                                                                      | Should   | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-UNINSTALL-001        | uninstall revokes the project's active API key(s), no-ops cleanly if the portal project is already gone                                                    | Must     | `cli/src/uninstall/index.ts`                                                                                                  |
| REQ-CLI-UNINSTALL-002        | uninstall deletes the GitHub secrets/variables `install` wrote                                                                                              | Must     | `cli/src/lib/git-provider/github.ts`                                                                                          |
| REQ-CLI-UNINSTALL-003        | uninstall removes the target from sdlc-config.json (delete file / collapse to flat / drop from targets[])                                                  | Must     | `cli/src/install/write-config.ts`                                                                                             |
| REQ-CLI-UNINSTALL-004        | uninstall --target selection and multi-target ambiguity error                                                                                               | Should   | `cli/src/uninstall/index.ts`                                                                                                  |
| REQ-CLI-UPDATE-001           | Sync framework templates into one consumer and report a summary, leaving the tree dirty                                                                     | Must     | `cli/src/commands/update.ts`                                                                                                  |
| REQ-CLI-UPDATE-002           | Idempotency: re-running yields the same synced-file count and no errors                                                                                     | Must     | `cli/src/update/index.ts`                                                                                                     |
| REQ-CLI-UPDATE-003           | Stage docs (\_common/\*.md) sync into SDLC/                                                                                                                 | Must     | `cli/src/update/stage-docs.ts`                                                                                                |
| REQ-CLI-UPDATE-004           | AI rule files: pointer files overwritten, CLAUDE.md/INSTRUCTIONS.md merged                                                                                  | Must     | `cli/src/update/ai-rules.ts`                                                                                                  |
| REQ-CLI-UPDATE-005           | Stack hooks + hook config files (host-conditioned via stack adapter)                                                                                        | Should   | `cli/src/update/stack-hooks.ts`                                                                                               |
| REQ-CLI-UPDATE-006           | Stack dev-dependency install + Playwright postinstall injection (node only) (#245)                                                                          | Should   | `cli/src/update/stack-deps.ts`                                                                                                |
| REQ-CLI-UPDATE-007           | Scripts merged into scripts/ (common + stack + upload-evidence.sh), executable                                                                              | Should   | `cli/src/update/scripts.ts`                                                                                                   |
| REQ-CLI-UPDATE-008           | GitHub issue templates synced to .github/ISSUE_TEMPLATE/                                                                                                    | Could    | `cli/src/update/issue-templates.ts`                                                                                           |
| REQ-CLI-UPDATE-009           | Claude Code skills replaced wholesale into .claude/skills/                                                                                                  | Should   | `cli/src/update/skills.ts`                                                                                                    |
| REQ-CLI-UPDATE-010           | E2E evidence helper (node only) into e2e/helpers/                                                                                                           | Could    | `cli/src/update/evidence-helper.ts`                                                                                           |
| REQ-CLI-UPDATE-011           | CI workflows generated from templates with token + block substitution                                                                                       | Must     | `cli/src/update/ci-templates.ts`                                                                                              |
| REQ-CLI-UPDATE-012           | Optional E2E steps render only when configured (deterministic backward-compat)                                                                              | Could    | `cli/src/update/ci-templates.ts`                                                                                              |
| REQ-CLI-UPDATE-013           | Post-sync validation surfaces non-fatal warnings                                                                                                            | Should   | `cli/src/update/validation.ts`                                                                                                |
| REQ-CLI-UPDATE-014           | version argument is cosmetic; no tag created                                                                                                                | Should   | `cli/src/commands/update.ts`                                                                                                  |
| REQ-CLI-UPDATE-015           | Multi-path: several consumers updated sequentially in one invocation                                                                                        | Could    | `cli/src/commands/update.ts`                                                                                                  |
| REQ-CLI-UPDATE-016           | Plugin lifecycle hooks fire around the sync (beforeSync / afterSync)                                                                                        | Could    | `cli/src/commands/update.ts`                                                                                                  |
| REQ-CLI-UPDATE-017           | Unknown stack/host adapter aborts before mutation                                                                                                           | Must     | `cli/src/update/resolve-adapters.ts`                                                                                          |
| REQ-CLI-UPDATE-018           | --dry-run previews update without mutation (#154; corrected 2026-09-29)                                                                                     | Should   | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-UPDATE-019           | Suggested sync commit message must not contain a skip-CI tag: it left the sync PR's required Quality Gates check unreported (#1020; was #220)               | Should   | `cli/src/commands/update.ts`                                                                                                  |
| REQ-CLI-UPDATE-020           | devaudit update adds .e2e-gate-passed and .sdlc-implementer-invoked to consumer .gitignore (#226)                                                           | Must     | `cli/src/update/gitignore.ts`                                                                                                 |
| REQ-CLI-UPDATE-021           | CI workflow output filenames + check/job names namespaced per target (#692)                                                                                 | Must     | `cli/src/update/ci-templates.ts`                                                                                              |
| REQ-CLI-UPDATE-022           | CI trigger paths scoped to each target's own working_directory (#693)                                                                                       | Should   | `cli/src/update/ci-templates.ts`                                                                                              |
| REQ-CLI-UPDATE-023           | update's branch-protection check adds only what is missing, keeps maintainer settings, respects rulesets, all targets (#695/#696/#990); keeps `release_branch_required_reviews` in both directions (#1116)                     | Should   | `cli/src/update/branch-protection.ts`                                                                                         |
| REQ-CLI-UPDATE-024           | --enable-e2e-regression / --disable-e2e-regression flip e2e_regression_enabled before syncing; mutual exclusion + fail-fast (#876)                          | Should   | `cli/src/commands/update.ts`                                                                                                  |
| REQ-CLI-UPDATE-025           | Section 2h: SDLC CLI engine synced as `.cjs` (not `.js`); stale pre-#929 `.js` copy removed (#929)                                                           | Must     | `cli/src/update/sdlc-engine.ts`                                                                                               |
| REQ-CLI-UPDATE-026           | Section 2i: `.devin/workflows/*.md` slash-command workflows synced to the consumer repo root (#931)                                                         | Should   | `cli/src/update/workflows.ts`                                                                                                 |
| REQ-CLI-UPDATE-027           | Section 2l: consumer's own Prettier re-runs over every synced file, outside the section loop and file-count total (#663, #931)                              | Should   | `cli/src/update/format-sync.ts`                                                                                              |
| REQ-CLI-UPDATE-028           | Section 2m: `devaudit_synced_version` stamped into sdlc-config.json last — the only field a plain update always writes (#736, #931)                         | Must     | `cli/src/update/stamp-version.ts`                                                                                             |
| REQ-CLI-UPDATE-029           | Section 2n: the sync manifest (.devaudit/sync-manifest.json) records what devaudit last wrote (#930)                                                        | Must     | `cli/src/update/sync-manifest.ts`                                                                                             |
| REQ-CLI-UPDATE-030           | writeManaged/removeManaged: a locally-modified file is never overwritten, conflicts reported not fatal (#930)                                               | Must     | `cli/src/update/write-managed.ts`                                                                                             |
| REQ-CLI-UPDATE-031           | Manifest-driven deletion replaces every unconditional stale-file/directory removal (#930)                                                                   | Must     | `cli/src/update/write-managed.ts`                                                                                             |
| REQ-CLI-UPDATE-032           | Manifest bootstrap: reconstructs a baseline on the first sync after upgrading, with a conservative fallback (#930)                                          | Must     | `cli/src/update/manifest-bootstrap.ts`                                                                                        |
| REQ-CLI-UPDATE-033           | Unknown/custom sdlc-config.json keys survive every sync path untouched (#930)                                                                               | Must     | `cli/src/update/stamp-version.ts`                                                                                             |
| REQ-CLI-UPDATE-034           | Idempotently seed the labels synced issue templates reference (needs-triage etc.); best-effort (#970)                                                       | Should   | `cli/src/update/issue-labels.ts`                                                                                              |
| REQ-CLI-STATUS-001           | Report installed-vs-expected framework state for a consumer (human output)                                                                                  | Should   | `cli/src/commands/status.ts`                                                                                                  |
| REQ-CLI-STATUS-002           | --json machine-readable status                                                                                                                              | Should   | `cli/src/commands/status.ts`                                                                                                  |
| REQ-CLI-STATUS-003           | Not-a-consumer (missing sdlc-config.json) exits 7                                                                                                           | Should   | `cli/src/commands/status.ts`                                                                                                  |
| REQ-CLI-DOCTOR-001           | Tool-presence preflight gates the exit code                                                                                                                 | Should   | `cli/src/commands/doctor.ts`                                                                                                  |
| REQ-CLI-DOCTOR-002           | Release close-out drift safety-net (non-gating; optional network)                                                                                           | Could    | `cli/src/commands/doctor.ts`                                                                                                  |
| REQ-CLI-DOCTOR-003           | Plugin onDoctor hooks run after the built-in checks                                                                                                         | Could    | `cli/src/commands/doctor.ts`                                                                                                  |
| REQ-CLI-DOCTOR-004           | doctor checks tools + specific onboarding invariants, not auth/config validity (scope note)                                                                 | Won't    | `cli/src/commands/doctor.ts`                                                                                                  |
| REQ-CLI-DOCTOR-005           | Onboarding-checklist invariant checks: srs, rtm, semgrep, e2e-regression, secrets (+host-adapter secrets), pre-push-hook, railway-cli, sync-conflicts, commitlint-config-shadowing (non-gating) | Could    | `cli/src/commands/doctor.ts`                                                                                                  |
| REQ-CLI-DOCTOR-006           | doctor --json emits {ok, tools, releaseCloseoutDrift, onboarding} with suspectedOrigin tags; exit codes unchanged (#867)                                    | Should   | `cli/src/commands/doctor.ts`                                                                                                  |
| REQ-CLI-DOCTOR-007           | Read-only release-deferral checks D3/D4/D6/D7 (release-pr-closed, deferred-will-ship, predecessors-none, bundle-members); non-gating, graceful skips (#956) | Should   | `cli/src/commands/doctor-deferral.ts`
| REQ-CLI-DOCTOR-008           | Portal reads for doctor use the viewer key (fallback API key) from env/.env, read-only, never printed (#956)                                                | Should   | `cli/src/commands/doctor-deferral.ts`
| REQ-CLI-DOCTOR-009           | doctor --json adds deferral + proposals keys with inert remediation descriptors; existing keys unchanged (#956)                                             | Should   | `cli/src/commands/doctor-deferral.ts`
| REQ-CLI-DOCTOR-010           | doctor --fix [--yes] [--reason] [--dry-run]: tiers A/B/C, never-prompt rules, exit 8 when unapplied, --fleet rejected, JSON `fix` key (#956)                | Should   | `cli/src/commands/doctor-fix.ts`, `cli/src/index.ts`                                                                          |
| REQ-CLI-DOCTOR-011           | Checks D1 deferred-portal-sync, D2 deferred-ticket-sync, D5 deferral-age; `deferral_max_age_days` setting (default 30) (#956)                               | Should   | `cli/src/commands/doctor-deferral.ts`, `cli/src/lib/sdlc-config.ts`                                                           |
| REQ-CLI-DOCTOR-012           | Prompt helper: confirm/input/select only on a TTY outside CI and --json; otherwise null, never secrets (#956)                                               | Could    | `cli/src/lib/prompt.ts`                                                                                                       |
| REQ-CLI-DOCTOR-013           | Portal defer/resume client: PAT only (X-DevAudit-Token), typed refusal for API/viewer keys, 401/403/404/409/422, timeout, no secret printed; a 3xx, non-JSON or `status`-less 2xx is an error, never success (#956, #1099) | Should   | `cli/src/lib/release-deferral-api.ts`                                                                                         |
| REQ-CLI-DOCTOR-014           | patch-conflicts check: lists consumer patches the last sync skipped, from the sync manifest `patches` map; non-gating (#1023)                               | Should   | `cli/src/commands/doctor.ts`, `cli/src/update/consumer-patches.ts`, `cli/src/update/sync-manifest.ts`                         |
| REQ-CLI-DOCTOR-015           | accepted-exceptions check: flags open accepted-e2e-failure / accepted-dependency-risk issues past their Review by date or without one; non-gating (#1016, #1017)| Should   | `cli/src/commands/doctor.ts`, `cli/src/update/issue-labels.ts`                                                                |
| REQ-CLI-DOCTOR-016           | deploy-host check: recorded host vs the real deploy host (GitHub deployment creators, host files); a confident mismatch proposes set-config (tier A) (#1040)    | Should   | `cli/src/commands/doctor-config.ts`, `cli/src/lib/deploy-detect.ts`                                                           |
| REQ-CLI-DOCTOR-017           | production-url check: production_url_secret set and present; an access-gated production deployment without DEVAUDIT_PROBE_HEADER is reported (#1040)            | Should   | `cli/src/commands/doctor-config.ts`                                                                                           |
| REQ-CLI-DOCTOR-018           | custom-deploy check (host custom): deploy_command, deploy_secrets names and presence, https deployed_sha_url, deploy_trigger enum (#1040)                       | Should   | `cli/src/commands/doctor-config.ts`                                                                                           |
| REQ-CLI-DOCTOR-019           | ci-runner check: the runner label CI resolves to (CI_RUNNER_LABEL for self-hosted) is GitHub-hosted or carried by a registered runner (#1040)                   | Could    | `cli/src/commands/doctor-config.ts`                                                                                           |
| REQ-CLI-DOCTOR-026           | `doctor --explain <check>` prints why a check matters and the options, including leaving it as it is; unknown check exits 2 (#1116 WP8) | Should   | `cli/src/commands/doctor-guided.ts`, `cli/src/lib/doctor-explain.ts` |
| REQ-CLI-DOCTOR-027           | `doctor --guided [check]` walks the gaps and only offers: no terminal exits 8, leave and stop are not errors, the same safeguards as `--fix`, a re-check after each fix (#1116 WP8) | Should   | `cli/src/commands/doctor-guided.ts`, `cli/src/commands/doctor.ts` |
| REQ-CLI-DOCTOR-028           | `preset-drift`: the configuration no longer matches `onboarding_preset`, or a gated tier has no tests; silent without a preset or for `custom` (#1116 WP8) | Should   | `cli/src/commands/doctor-onboarding.ts` |
| REQ-CLI-DOCTOR-029           | `standards-fit`: SOC 2 / ISO 27001 with a self-approving preset names the clauses with a recorded gap; portal and configuration standards compared (#1116 WP8) | Should   | `cli/src/commands/doctor-onboarding.ts` |
| REQ-CLI-DOCTOR-030           | `approval-policy`: `approval.mode` against the portal's approval policy, read with the viewer key (#1116 WP8) | Should   | `cli/src/commands/doctor-onboarding.ts`, `cli/src/lib/onboarding-portal.ts` |
| REQ-CLI-DOCTOR-031           | `durations`: median job duration of the last 10 successful runs of `ci.yml` and `e2e-regression.yml`, or "not measured yet" (#1116 WP8) | Should   | `cli/src/commands/doctor-onboarding.ts` |
| REQ-CLI-CONFIGURE-001        | configure list / get: managed keys with value, type, allowed values, host requirement (#1040)                                                                   | Should   | `cli/src/commands/configure.ts`, `cli/src/lib/repo-config-keys.ts`                                                            |
| REQ-CLI-CONFIGURE-002        | configure set validates key, type, enum, pattern and host; refuses unknown and command-owned keys; exit 2 when invalid (#1040)                                  | Must     | `cli/src/commands/configure.ts`, `cli/src/lib/repo-config-keys.ts`                                                            |
| REQ-CLI-CONFIGURE-003        | configure set: a host the repo evidence contradicts needs confirmation or --reason (exit 8); --dry-run writes nothing and lists regenerated files and follow-ups (#1040) | Must     | `cli/src/commands/configure.ts`                                                                                               |
| REQ-CLI-CONFIGURE-004        | configure secret: hands over to gh secret set for a masked prompt, never reads the value, refuses without a TTY (#1040)                                         | Must     | `cli/src/commands/configure.ts`                                                                                               |
| REQ-CLI-CONFIGURE-005        | `devaudit configure` with no arguments runs the guided questions with the current values as defaults, shows a before/after summary and writes only what changed; a preset switch removes the keys the target does not write (#1116 WP7) | Should   | `cli/src/commands/configure-guided.ts`, `cli/src/install/guided.ts` |
| REQ-CLI-CONFIGURE-006        | Without a terminal (no TTY, `CI`, `--json`) it asks and writes nothing and exits 8; a declined confirmation exits 8; the portal approval policy is tier B and a refused solo policy leaves the approval settings alone (#1116 WP7) | Should   | `cli/src/commands/configure-guided.ts`, `cli/src/lib/onboarding-portal.ts` |
| REQ-CLI-CONFIGURE-007        | Dotted configuration keys (`approval.mode`, `production_review.terminal_status`) and the onboarding, approval and test-data keys, validated by `configure set` (#1116 WP2) | Should   | `cli/src/lib/config-path.ts`, `cli/src/lib/repo-config-keys.ts`, `cli/src/commands/configure.ts` |
| REQ-CLI-ONBOARD-009          | Detection facts (stack, test runner and groups, host, branches, runner, governance files, seed scripts, dependent Playwright projects) come from `@metasession.co/devaudit-core` through a `RepoReader` that never leaves the repository (#1116 WP3) | Should   | `core/src/detect/`, `core/src/repo-reader.ts`, `core/src/node/fs-repo-reader.ts` |
| REQ-CLI-SCAN-008             | `doctor --json` adds an additive `gaps` array: every non-ok check as gaps with a plain-language reason and at least one option; the gap model is shared with the scan and the portal (#1116 WP4) | Should   | `core/src/gap.ts`, `cli/src/lib/doctor-explain.ts`, `cli/src/commands/doctor.ts` |
| REQ-CLI-ONBOARD-001          | The four onboarding presets (A, B, C, D) are data in the core: the configuration each writes, what runs at the five moments, evidence, gap and the clauses with a recorded gap; `docs/presets.md` is generated from it (#1116 WP5) | Should   | `core/src/presets.ts`, `core/src/presets-doc.ts`, `cli/tools/generate-presets-doc.mjs` |
| REQ-CLI-ONBOARD-002          | `devaudit install` detects, suggests a preset, shows an express summary and lets the person accept, change one thing or answer every question; the compliance line is recomputed after every change (#1116 WP6) | Should   | `cli/src/install/guided.ts`, `cli/src/install/prompts.ts` |
| REQ-CLI-ONBOARD-003          | `install --preset <A\|B\|C\|D\|custom>` and `--from-scan <file>`; with `--yes`, A and B refuse (exit 2) unless the project's approval policy allows self-approval (#1116 WP6) | Should   | `cli/src/install/prompts.ts`, `cli/src/install/scan-hints.ts`, `cli/src/index.ts` |
| REQ-CLI-ONBOARD-004          | The portal calls of the guided install are tier B: the approval policy and the claimed standards are read with the viewer key, set only after a confirmation, and a portal without the feature is reported in one line (#1116 WP6) | Should   | `cli/src/lib/onboarding-portal.ts`, `cli/src/install/onboarding-apply.ts` |
| REQ-CLI-ONBOARD-008          | `devaudit join` asks no registry question and writes no policy or preset, and prints the project's preset; a re-run on a config without `onboarding_preset` applies none unless chosen (#1116 WP6) | Should   | `cli/src/install/prompts.ts`, `cli/src/install/guided.ts` (`describeProjectPreset`), `cli/src/install/index.ts` |
| REQ-CLI-ONBOARD-005          | One suggestion rule for scan, install and doctor: only an offered preset is suggested, D never, with a one-sentence reason (#1116 WP5) | Should   | `core/src/presets.ts` (`suggestPreset`, `offerPresets`) |
| REQ-CLI-ONBOARD-006          | The question registry (Q0a to Q21) is data in the core: prompts, reasons, choices with consequences, defaults, validators, writes, express path and conditions (#1116 WP5) | Should   | `core/src/registry.ts` |
| REQ-CLI-ONBOARD-007          | The registry validators are pure functions; every configuration key is written by a question or listed in `NOT_ASKED` with a reason (#1116 WP5) | Should   | `core/src/validators.ts`, `core/src/registry.ts` (`NOT_ASKED`) |
| REQ-CLI-FLEET-001            | doctor --fleet: invocation, token resolution, exit 3 (not_logged_in/portal_rejected) / 1 (portal_error) / 0 after a sweep (#861)                            | Should   | `cli/src/commands/fleet.ts`                                                                                                   |
| REQ-CLI-FLEET-002            | doctor --fleet: repo_url discovery, sibling-checkout resolution, origin-remote defense-in-depth match (#861)                                                | Should   | `cli/src/commands/fleet.ts`                                                                                                   |
| REQ-CLI-FLEET-003            | doctor --fleet: per-project doctor --json execution, ok/issues/skipped/error status; read-only invariant (#861)                                             | Should   | `cli/src/commands/fleet.ts`                                                                                                   |
| REQ-CLI-FLEET-004            | doctor --fleet: JSON {ok, checked, results[]} and human summary output (#861)                                                                               | Could    | `cli/src/commands/fleet.ts`                                                                                                   |
| REQ-CLI-BOOTSTRAP-001        | Opt-in drop of governance starter templates into compliance/governance/                                                                                     | Must     | `cli/src/commands/bootstrap-governance.ts`                                                                                    |
| REQ-CLI-BOOTSTRAP-002        | Idempotent / non-destructive: existing files preserved, never overwritten                                                                                   | Must     | `cli/src/install/bootstrap-governance.ts`                                                                                     |
| REQ-CLI-BOOTSTRAP-003        | --dry-run plans without writing                                                                                                                             | Should   | `cli/src/commands/bootstrap-governance.ts`                                                                                    |
| REQ-CLI-BOOTSTRAP-004        | --json machine-readable result                                                                                                                              | Could    | `cli/src/commands/bootstrap-governance.ts`                                                                                    |
| REQ-CLI-PUSH-001             | Required positionals and portal upload contract                                                                                                             | Must     | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-PUSH-002             | API key resolution and missing-key fast-fail (exit 3)                                                                                                       | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-003             | Base URL resolution precedence and trailing-slash normalisation                                                                                             | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-004             | Metadata assembly from --git-sha / --ci-run-id / --branch                                                                                                   | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-005             | Release / environment / category form fields                                                                                                                | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-006             | Retry on 429/5xx with exponential backoff, capped at 3 attempts                                                                                             | Must     | `cli/src/lib/ci-upload.ts`                                                                                                    |
| REQ-CLI-PUSH-007             | Retry-After header honoured for retryable responses                                                                                                         | Must     | `cli/src/lib/ci-upload.ts`                                                                                                    |
| REQ-CLI-PUSH-008             | 4xx (other than 429) fast-fail, no retry                                                                                                                    | Must     | `cli/src/lib/ci-upload.ts`                                                                                                    |
| REQ-CLI-PUSH-009             | Per-file success/failure tally, summary, and exit code 4 on any failure                                                                                     | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-010             | --json machine-readable push result                                                                                                                         | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-011             | Directory upload (recursive) vs single file                                                                                                                 | Must     | `cli/src/lib/ci-upload.ts`                                                                                                    |
| REQ-CLI-PUSH-012             | --dry-run previews without any HTTP or filesystem mutation                                                                                                  | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-013             | --dry-run --json structured plan payload                                                                                                                    | Should   | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-014             | Base-URL redirect handling / drift warning (parity note)                                                                                                    | Should   | `scripts/upload-evidence.sh`                                                                                                  |
| REQ-CLI-PUSH-015             | beforePush / afterPush plugin hooks fire around a real upload                                                                                               | Could    | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-016             | --test-execution forwards testExecutionId form field for portal test execution grouping (#209)                                                              | Should   | `cli/src/commands/push.ts`, `cli/src/lib/ci-upload.ts`                                                                        |
| REQ-CLI-PUSH-017             | Upload bodies are sourced from disk-backed blobs, not `fs.readFile()` whole-buffer preloading                                                               | Should   | `cli/src/lib/ci-upload.ts`                                                                                                    |
| REQ-CLI-PUSH-018             | Starter-stub skip uses a small text prefix read, not whole-file buffering                                                                                   | Should   | `cli/src/lib/ci-upload.ts`                                                                                                    |
| REQ-CLI-PUSH-019             | Shared release-lineage contract publishes canonical enums, payload shapes, and execution rendering (#391)                                                   | Should   | `contracts/release-lineage-contract.json`, `cli/src/lib/release-lineage-contract.ts`                                          |
| REQ-CLI-AUTH-001             | auth login --token validates against the portal then caches at mode 0600                                                                                    | Must     | `cli/src/commands/auth/login.ts`                                                                                              |
| REQ-CLI-AUTH-002             | auth login interactive PAT paste with mctok\_ validation                                                                                                    | Should   | `cli/src/commands/auth/login.ts`                                                                                              |
| REQ-CLI-AUTH-003             | auth login rejects an invalid token (exit 3) without caching                                                                                                | Must     | `cli/src/commands/auth/login.ts`                                                                                              |
| REQ-CLI-AUTH-004             | auth logout deletes the cached token                                                                                                                        | Should   | `cli/src/commands/auth/logout.ts`                                                                                             |
| REQ-CLI-AUTH-005             | auth status resolves token source and verifies against portal                                                                                               | Should   | `cli/src/commands/auth/status.ts`                                                                                             |
| REQ-CLI-RELEASE-003          | Six published packages: `@metasession.co/devaudit-core` is published after `plugin-sdk` and before `cli`, pinned in the cli, and has a manual `next` prerelease (#1129) | Should   | `.github/workflows/release.yml`, `core/package.json`      
| REQ-CLI-RELEASE-002          | `devaudit release status`: release status, required checks and executions, read with the viewer key; `--json` shape (#1099)                                | Should   | `cli/src/commands/release-status.ts`                                                                                         |
| REQ-CLI-AUTH-006             | auth status when not logged in (exit 3)                                                                                                                     | Should   | `cli/src/commands/auth/status.ts`                                                                                             |
| REQ-CLI-AUTH-007             | auth status when the portal rejects the cached token (exit 3)                                                                                               | Should   | `cli/src/commands/auth/status.ts`                                                                                             |
| REQ-CLI-AUTH-008             | Per-person viewer keys: `viewer-keys.json` (0600), env > file > legacy `.env` lookup, no uploader-key fallback, `auth viewer-key set` (#1099)             | Should   | `cli/src/lib/viewer-keys.ts`, `cli/src/commands/auth/viewer-key.ts`                                                           |
| REQ-CLI-PLUGIN-001           | plugin list enumerates the store and reports load failures                                                                                                  | Should   | `cli/src/commands/plugin/list.ts`                                                                                             |
| REQ-CLI-PLUGIN-002           | plugin install <git-url> clones, npm-installs, validates manifest                                                                                           | Should   | `cli/src/commands/plugin/install.ts`                                                                                          |
| REQ-CLI-PLUGIN-003           | plugin remove <name> deletes a plugin by package or directory name                                                                                          | Should   | `cli/src/commands/plugin/remove.ts`                                                                                           |
| REQ-CLI-PLUGIN-004           | plugin update git-pulls + npm-installs each git-backed plugin                                                                                               | Should   | `cli/src/commands/plugin/update.ts`                                                                                           |
| REQ-CLI-PLUGIN-005           | Manifest validation contract gates load/install                                                                                                             | Could    | `plugin-sdk/src/manifest.ts`                                                                                                  |
| REQ-CLI-PLUGIN-006           | Plugin-contributed commands register under a derived namespace                                                                                              | Could    | `cli/src/lib/plugin/commands.ts`                                                                                              |
| REQ-CLI-PLUGIN-007           | Plugin context `getPersonalAuth()`: the person's CLI-resolved PAT and portal URL for plugins, so nobody exports `DEVAUDIT_USER_TOKEN`; evidence-export uses it (#1100)  | Could    | `cli/src/lib/plugin/context.ts`, `plugin-sdk/src/types.ts`, `plugins/devaudit-plugin-evidence-export/src/util/token.ts` |
| REQ-CLI-UPGRADE-001          | upgrade is a stub, not a real self-update (exit 1)                                                                                                          | Could    | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-GLOBAL-001           | Global flags accepted on every command via applyCommonFlags                                                                                                 | Could    | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-GLOBAL-002           | --json switches to NDJSON logging + raw result objects                                                                                                      | Could    | `cli/src/lib/logger.ts`                                                                                                       |
| REQ-CLI-GLOBAL-003           | --no-color strips ANSI (sets NO_COLOR)                                                                                                                      | Could    | `cli/src/lib/logger.ts`                                                                                                       |
| REQ-CLI-GLOBAL-004           | --verbose raises log verbosity                                                                                                                              | Could    | `cli/src/lib/logger.ts`                                                                                                       |
| REQ-CLI-GLOBAL-005           | --dry-run and -y/--yes thread into commands                                                                                                                 | Could    | `index.ts`                                                                                                                    |
| REQ-CLI-GLOBAL-006           | --org <slug> is accepted but currently inert                                                                                                                | Won't    | `index.ts`                                                                                                                    |
| REQ-CLI-STUB-001             | org subcommands are not-yet-implemented stubs (exit 1)                                                                                                      | Won't    | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-STUB-002             | config subcommands are not-yet-implemented stubs (exit 1)                                                                                                   | Won't    | `cli/src/index.ts`                                                                                                            |
| REQ-SKILL-IMPLEMENTER-001    | Trigger phrases fire the orchestrator (Phases 0–4)                                                                                                          | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-002    | Resume phrase invokes Phase 5 separately                                                                                                                    | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-003    | Phase 0 emits a "Workflow Decision" block and routes                                                                                                        | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-004    | Phase 0 writes inferred labels back to the issue                                                                                                            | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-005    | Lightweight path drives non-tracked work to merge without ceremony                                                                                          | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-006    | Phase 1 writes the implementation plan from the template at a fixed path                                                                                    | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-007    | Phase 1 delegates to requirements-aligner, adr-author, risk-register-keeper (steps 6→7→8)                                                                   | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-008    | Phase 1 updates RTM and posts a plan-summary comment                                                                                                        | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-009    | Phase 1 PAUSE for HIGH/CRITICAL plan approval                                                                                                               | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-010    | Phase 2 E2E delegation gate: pre-test-work declaration                                                                                                      | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-011    | Phase 2 E2E delegation self-audit before Phase 3                                                                                                            | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-012    | Phase 2 gate-failure retry cap and no-bypass rule                                                                                                           | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-013    | Phase 3 delegates the three per-REQ SoT artefacts then organises + uploads evidence                                                                         | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-014    | Phase 4 opens the release PR and HARD STOPS for UAT review                                                                                                  | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-015    | Phase 4 four-eyes reviewer ≠ trigger user for HIGH/CRITICAL                                                                                                 | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-016    | Phase 5 finalise vs change-request loop branches on portal state                                                                                            | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-017    | LAST/NEXT status sticky maintained on every transition + handoff                                                                                            | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-018    | Over-scoped issue refused at Phase 1                                                                                                                        | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-019    | Scope-expansion halt gate fires on any user request outside ACs, across all phases                                                                          | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-020    | Phase 3 test-execution-summary.md includes Test Executions section (ISO 29119-3 Test Completion Report)                                                     | Should   | `sdlc/files/_common/3-compile-evidence.md`                                                                                    |
| REQ-SKILL-IMPLEMENTER-021    | Phase 3 delegates incident filing to e2e-test-engineer, never files inline (#210 AC10)                                                                      | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-022    | Phase 5 change-request loop classifies defect vs scope change, delegates defect filing (#210 AC11)                                                          | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-023    | Compliance constraint: never file incidents inline — delegate to sub-skills (#210 AC13)                                                                     | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-024    | Phase 3 generates nil-incident report when no incidents occurred (#210 AC15-AC18)                                                                           | Should   | `sdlc/files/_common/3-compile-evidence.md`                                                                                    |
| REQ-SKILL-IMPLEMENTER-025    | Phase 1 step 5b extracts test-scope.md + test-plan.md into compliance/evidence/ (#226)                                                                      | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-026    | Phase 3 step 6b copies implementation-plan.md to compliance/evidence/ (#226)                                                                                | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-027    | Resume protocol: re-invoke after environment detours, idempotent state re-read (#226)                                                                       | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-028    | Native agent responsibilities + re-invocation boundary documented in SKILL.md (#226)                                                                        | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-029    | Phase 5 close-out: RTM → APPROVED - DEPLOYED, ticket → approved-releases/, commit + push (#226); a deferred ticket is not closed out (#956)                | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-030    | Commit-scoping rule: subject cites active REQ only, other REQs in body (#226)                                                                               | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-031    | Phase 4 blocker classification can run as an executable PR watch loop with persisted retry state (#304)                                                     | Must     | `sdlc/src/bin/devaudit-sdlc.cjs`, `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                        |
| REQ-SKILL-IMPLEMENTER-032    | Phase 2 step 5b halts if the plan names Playwright coverage no spec actually tags (#578)                                                                    | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-033    | Phase 5 portal-state read uses `devaudit release status` with the person's viewer key, never the uploader key; halts on unreachable or no key (#876, #1099) | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-034    | "Closing a release PR without releasing": ticket Release intent, RTM DEFERRED, PR comment, manual admin portal defer (PAT), promotion gate (#955, #956)    | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`, `references/change-request-loop.md`                                     |
| REQ-FRAMEWORK-HOOK-004       | Pre-push hook runs validate-compliance-artifacts.sh for tracked commits (#226)                                                                              | Must     | `sdlc/files/stacks/node/hooks/pre-push`                                                                                       |
| REQ-SKILL-E2E-001            | Trigger phrases fire the e2e pack maintainer / bootstrapper                                                                                                 | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-002            | Bootstrap (Phase 1b) only when no suite exists, with confirmation gates                                                                                     | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-003            | evidenceShot helper produces per-AC PNG + sidecar at the canonical path                                                                                     | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-004            | Three-tier classification places specs at tier-specific paths                                                                                               | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-005            | Screenshot density scales by spec role (feature vs regression tier)                                                                                         | Should   | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-006            | Transport-layer specs use test-execution-summary.md, not evidenceShot                                                                                       | Should   | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-007            | Phase 4 never deletes a test without explicit confirmation                                                                                                  | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-008            | Phase 6 defect filing emits Framework attribution + applies the incident label                                                                              | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-009            | Phase 6 checks every AC has a passing test and files missed requirements                                                                                    | Should   | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-010            | Phase 7 regression-pack graduation is implicit on merge                                                                                                     | Could    | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-011            | Phase 5½ evidence wiring validation: evidenceShot + @requirement + tagTest + release/execution provenance + .e2e-evidence-wired sentinel (#226)             | Should   | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-012            | `check-req-title-tags.sh`: every `tagTest('REQ-x', n)` needs the exact id in its test title or an enclosing describe; file:line offenders, exit 1; run in Phase 5½ (#1095) | Should   | `sdlc/files/_common/scripts/check-req-title-tags.sh`, `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` |
| REQ-SKILL-GOVERNANCE-001     | Trigger phrases / MISSING-clause prompts route to the right doc                                                                                             | Should   | `sdlc/files/_common/skills/governance-doc-author/SKILL.md`                                                                    |
| REQ-SKILL-GOVERNANCE-002     | Each doc class emits its artefact at the fixed path and closes its clause                                                                                   | Should   | `sdlc/files/_common/skills/governance-doc-author/SKILL.md`                                                                    |
| REQ-SKILL-GOVERNANCE-003     | Phase 5 commit + upload routes by tier; PAUSE for confirmation before push                                                                                  | Should   | `sdlc/files/_common/skills/governance-doc-author/SKILL.md`                                                                    |
| REQ-SKILL-GOVERNANCE-004     | One doc per invocation; Review Schedule ≠ quarterly execution                                                                                               | Could    | `sdlc/files/_common/skills/governance-doc-author/SKILL.md`                                                                    |
| REQ-SKILL-REQALIGN-001       | Triggers + non-spontaneous firing; Stage 1 / Stage 3 hooks                                                                                                  | Should   | `sdlc/files/_common/skills/requirements-aligner/SKILL.md`                                                                     |
| REQ-SKILL-REQALIGN-002       | Phase 1 injects the SRS-items table into the plan and (conditionally) blocks approval                                                                       | Should   | `sdlc/files/_common/skills/requirements-aligner/SKILL.md`                                                                     |
| REQ-SKILL-REQALIGN-003       | Phase 2 drops srs-alignment.md with frontmatter, trace table, and operator sign-off                                                                         | Should   | `sdlc/files/_common/skills/requirements-aligner/SKILL.md`                                                                     |
| REQ-SKILL-ADR-001            | Triggers + Stage 1 / Stage 3 hooks; non-spontaneous firing                                                                                                  | Should   | `sdlc/files/_common/skills/adr-author/SKILL.md`                                                                               |
| REQ-SKILL-ADR-002            | Phase 1 applies the decision tree and drops docs/ADR/ADR-NNN-<slug>.md or a no-ADR rationale                                                                | Should   | `sdlc/files/_common/skills/adr-author/SKILL.md`                                                                               |
| REQ-SKILL-ADR-003            | Phase 2 drops architecture-decision.md with outcome + operator sign-off                                                                                     | Should   | `sdlc/files/_common/skills/adr-author/SKILL.md`                                                                               |
| REQ-SKILL-RISK-001           | Triggers + Stage 1 (MEDIUM/HIGH) / incident-close / Stage 3 / solo_with_gap hooks                                                                           | Should   | `sdlc/files/_common/skills/risk-register-keeper/SKILL.md`                                                                     |
| REQ-SKILL-RISK-002           | Phase 1 opens RISK-NNN rows and injects the reference list into the plan                                                                                    | Should   | `sdlc/files/_common/skills/risk-register-keeper/SKILL.md`                                                                     |
| REQ-SKILL-RISK-003           | Phase 3 drops risk-assessment.md with summary table + framework cross-refs + sign-off                                                                       | Should   | `sdlc/files/_common/skills/risk-register-keeper/SKILL.md`                                                                     |
| REQ-SKILL-RISK-004           | Phase 2 post-incident entry cross-links incident report ↔ register both directions                                                                          | Could    | `sdlc/files/_common/skills/risk-register-keeper/SKILL.md`                                                                     |
| REQ-SKILL-RISK-005           | Phase 4 solo_with_gap PAUSE: refuse approval until the control-gap entry is signed off                                                                      | Could    | `sdlc/files/_common/skills/risk-register-keeper/SKILL.md`                                                                     |
| REQ-SKILL-CONFIGURE-001      | devaudit-configure: doctor -> explain -> confirm -> configure set (dry run first); never edits config or workflows directly, never handles secret values (#1040) | Should   | `sdlc/files/_common/skills/devaudit-configure/SKILL.md`                                                                       |
| REQ-FRAMEWORK-CIYML-001      | ci.yml triggers on develop PRs and develop code pushes                                                                                                      | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-002      | Single quality-gates job enforces TypeScript, SAST, dep-audit, E2E, build (node)                                                                            | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-003      | SAST and dep-audit gates honour baseline/accepted-risk allowances                                                                                           | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-004      | E2E origin tagging via E2E_NEW_SPECS diff against merge base                                                                                                | Should   | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-005      | Gate outcomes summarised unconditionally to gate-outcomes.json                                                                                              | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-006      | register-release job creates the UAT release record early                                                                                                   | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-007      | register-release syncs known requirements (title + risk class) from RTM.md                                                                                  | Should   | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-008      | upload-evidence job uploads gate evidence to the portal even on gate failure (stage 2)                                                                      | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-009      | Per-AC E2E screenshots uploaded scoped to in-scope REQs only + evidence-completeness gate (stage 2)                                                         | Should   | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-010      | ci.yml does not upload committed compliance docs (single-owner rule)                                                                                        | Should   | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-011      | Evidence-completeness gate: 3-scenario logic (A: hard error, B: spec-on-disk warning, C: unit-test warning) (#237)                                          | Should   | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-012      | CI templates stamp --test-execution on all uploads for portal test execution grouping (#209)                                                                | Should   | `sdlc/files/ci/ci.yml.template`, `sdlc/files/ci/compliance-evidence.yml.template`                                             |
| REQ-FRAMEWORK-CIYML-013      | First-class test execution rollout uses execution-scoped uploads and forbids document-as-execution attribution (#391)                                        | Should   | `contracts/release-lineage-contract.json`, `docs/release-lineage-producer-contract.md`                                        |
| REQ-FRAMEWORK-CIYML-014      | register-release derives the version and ensures the portal release exists for gate-execution lineage (#226; corrected 2026-10-13: it does create the release)   | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-015      | Checkout clean:false self-hosted expression propagated to the 8 remaining self-hosted-capable templates, not just ci.yml (#815)                              | Should   | `sdlc/files/ci/{check-release-approval,close-out-completion,close-out-release,compliance-evidence,compliance-validation,feature-e2e,post-deploy-prod,reconcile-deployment}.yml.template` |
| REQ-FRAMEWORK-CIYML-016      | Declared-bundle co-tracked members survive the automatic bundled-changes regeneration (#817); not submitted to the portal (#955)        | Should   | `sdlc/files/ci/ci.yml.template`, `sdlc/files/_common/scripts/generate-bundled-changes.sh`, `sdlc/files/_common/scripts/submit-bundle-manifest.sh` |
| REQ-FRAMEWORK-CIYML-017      | SAST/dependency-audit evidence fans out to declared-bundle members, filed under the bundle's single release (#819, #955)                                                                     | Should   | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-018      | Kill stale dev server fails loudly instead of silently swallowing a stale-process kill failure (#820)                                                        | Should   | `sdlc/files/ci/ci.yml.template`, `sdlc/files/ci/feature-e2e.yml.template`                                                     |
| REQ-FRAMEWORK-CIYML-019      | playwright install --with-deps gated to the runtime-resolved github-ci label on self-hosted configs (resolvePlaywrightWithDeps) (#868/#882)                 | Should   | `cli/src/update/ci-templates.ts`                                                                                              |
| REQ-FRAMEWORK-CIYML-020      | Stale .next cleanup step gated to an actually-self-hosted runtime runner (resolveStaleNextCleanupCondition) (#816/#885)                                     | Should   | `cli/src/update/ci-templates.ts`, `sdlc/files/ci/ci.yml.template`                                                             |
| REQ-FRAMEWORK-CIYML-021      | Dependency Audit retries unparseable npm audit output (5x self-hosted / 1x otherwise) + unconditional npm@^10.9.8 pin (#816/#885)                           | Should   | `cli/src/update/ci-templates.ts`, `sdlc/files/ci/ci.yml.template`                                                             |
| REQ-FRAMEWORK-CIYML-022      | reconcile-deployment.yml generated for a host adapter that declares a reconcile capability, removed otherwise (#841/#883, #1022)                            | Should   | `cli/src/update/ci-templates.ts`, `sdlc/files/ci/reconcile-deployment.yml.template`                                           |
| REQ-FRAMEWORK-CIYML-023      | Release-PR provenance requires a real ci.yml Quality Gates success on the latest code-bearing commit; the docs-only CI Status Fallback does not count (#971) | Must     | `sdlc/files/ci/quality-gates-provenance.yml.template`, `sdlc/files/_common/scripts/provenance-gated-commit.sh` |
| REQ-FRAMEWORK-CIYML-024      | Integration housekeeping registers no portal release unless a reviewed standalone declaration exists for the bare-date version (#1020)                       | Must     | `sdlc/files/_common/scripts/derive-release-version.sh`, `sdlc/files/ci/ci.yml.template`, `sdlc/files/ci/compliance-evidence.yml.template`|
| REQ-FRAMEWORK-CIYML-025      | Every generated workflow job runs on the configured runner (`{{RUNNER}}`), never a hardcoded GitHub-hosted label (#1044)                                   | Should   | `sdlc/files/ci/*.yml.template`, `cli/src/update/ci-templates.ts`                                                              |
| REQ-FRAMEWORK-CIYML-026      | A postgres service gets a random host port, and the E2E workflows isolate DB, port and run output between jobs (#1054)                                     | Should   | `cli/src/update/ci-templates.ts`, `sdlc/files/ci/e2e-regression.yml.template`                                                 |
| REQ-FRAMEWORK-CIYML-027      | Every generated workflow takes its branches from `integration_branch` and `release_branch`; none names `main` or `develop` when other branches are configured (#1116 WP2) | Should   | `sdlc/files/ci/*.yml.template`, `cli/test/custom-branches.test.ts` |
| REQ-CLI-DOCTOR-020           | `devaudit doctor` `test-tiers` check: declared tiers resolve to tests (collected, not run), requirement tags, smoke tier present; read-only tier C guidance (#1060)  | Should   | `cli/src/commands/doctor-tiers.ts`, `cli/src/lib/test-runner-detect.ts`                                                      |
| REQ-CLI-DOCTOR-021           | `devaudit doctor` `e2e-release-gate` check: gate coherent with the workflow, runnable tier, affordable against recent run times; read-only tier C guidance (#1059) | Should   | `cli/src/commands/doctor-tiers.ts`                                                                                           |
| REQ-CLI-DOCTOR-022           | `devaudit doctor` `credentials` check: uploader key found locally, viewer key authenticates for this project, PAT valid and a member (interactive only); names and statuses, never values; tier C guidance (#1099) | Should   | `cli/src/lib/credentials-check.ts`, `cli/src/commands/doctor.ts`                                                              |
| REQ-CLI-DOCTOR-023           | Read-only Credentials block after `update`, `install` and `join`: no prompts or writes, skipped in CI, once per invocation (#1099)                          | Should   | `cli/src/lib/credentials-check.ts`, `cli/src/commands/update.ts`, `install.ts`, `join.ts`                                      |
| REQ-CLI-DOCTOR-024           | `test-tiers` AC coverage: per AC `covered` / `screenshot-but-no-test` / `no-test` / `covered, not re-run on the release PR`, from the plan, `playwright --list` and screenshots; static, tier C, non-gating (#1096) | Should   | `cli/src/lib/ac-coverage.ts`, `cli/src/commands/doctor-tiers.ts` |
| REQ-CLI-DOCTOR-025           | `agent-permissions` check: are the recommended Claude Code deny rules (PAT commands, credential store) present in the project, local or user settings; informational, read-only, tier C (#1098) | Could    | `cli/src/lib/agent-permissions.ts`, `cli/src/commands/doctor.ts`                                                            |
| REQ-CLI-RELEASE-001          | `devaudit release check`: read-only readiness before submitting for UAT review (clean tree, integration branch, CI green, ticket, portal draft via viewer key) (#1099) | Must     | `cli/src/commands/release-check.ts`                                                                                          |
| REQ-FRAMEWORK-RELGATE-001    | Release gate keys (`release_gate_tier`, `post_deploy_full_regression`, `scheduled_full_regression`) drive the `e2e-regression.yml` triggers; no key set renders the original workflow (#1059) | Should   | `cli/src/update/ci-templates.ts`, `sdlc/files/ci/e2e-regression.yml.template`, `cli/src/lib/repo-config-keys.ts`           |
| REQ-FRAMEWORK-RELGATE-002    | The tier a run executed is recorded in its metadata and labelled per tier; scheduled runs are never uploaded to the portal (#1059)                          | Should   | `sdlc/files/ci/compliance-evidence.yml.template`, `sdlc/files/ci/e2e-regression.yml.template`                               |
| REQ-FRAMEWORK-RELGATE-003    | A configured gate is reported to the portal (`releaseGateTier`) and as an `e2e-release-gate` release check on pre-merge runs (#1059)                       | Should   | `sdlc/files/ci/check-release-approval.yml.template`, `sdlc/files/ci/compliance-evidence.yml.template`                        |
| REQ-FRAMEWORK-TIERS-001      | Test tier commands (`test_tier_*`, `test_feature_command`, `test_runner`) and `run-test-tier.sh`; unset keeps the inline Playwright commands (#1060)        | Should   | `sdlc/files/_common/scripts/run-test-tier.sh`, `cli/src/lib/repo-config-keys.ts`, `cli/src/update/ci-templates.ts`            |
| REQ-FRAMEWORK-TIERS-002      | `test_runner: pytest` selects pytest tier workflows (feature-e2e, e2e-regression) and the JUnit XML is the `e2e_result`; other configs are unchanged (#1060) | Should   | `sdlc/files/ci/runners/pytest/`, `cli/src/update/ci-templates.ts`, `sdlc/files/ci/compliance-evidence.yml.template`           |
| REQ-FRAMEWORK-TIERS-003      | `feature-e2e.yml` triggers on the configured integration branch, not a hardcoded `develop` (#1060)                                                          | Should   | `sdlc/files/ci/feature-e2e.yml.template`                                                                                      |
| REQ-FRAMEWORK-BUNDLE-001     | A declared bundle is ONE portal release: every upload for a co_tracked member is filed against the core's release, tagged with the member's own REQ (#955) | Must     | `sdlc/files/_common/scripts/resolve-bundle-release.sh`, `sdlc/files/ci/ci.yml.template`, `sdlc/files/_common/scripts/upload-compliance-documents.sh` |
| REQ-FRAMEWORK-BUNDLE-002     | resolve-bundle-release.sh maps a co_tracked member to its live bundle's core; non-members, stale manifests and non-REQ ids pass through (#955)               | Should   | `sdlc/files/_common/scripts/resolve-bundle-release.sh`                                                                        |
| REQ-FRAMEWORK-BUNDLE-003     | Bundle manifest is submitted to the portal without co_tracked members; manifestHash recomputed for the submitted payload (#220, #622, #955)                 | Must     | `sdlc/files/_common/scripts/submit-bundle-manifest.sh`, `sdlc/files/ci/ci.yml.template`                                       |
| REQ-FRAMEWORK-BUNDLE-004     | close-out-release.sh releases declared-bundle members with the core (ticket to approved-releases, RELEASED, RTM) and still supersedes predecessors (#955)   | Should   | `sdlc/files/_common/scripts/close-out-release.sh`                                                                             |
| REQ-FRAMEWORK-BUNDLE-005     | generate-bundled-changes.sh predecessor-ownership guard: declared members are accounted for; omitted field vs explicit None; unlisted tickets fail (#746, #952, #953) | Should   | `sdlc/files/_common/scripts/generate-bundled-changes.sh`                                                                      |
| REQ-FRAMEWORK-BUNDLE-006     | Release-ticket `Release intent: deferred-to-next` field is optional; validate-compliance-artifacts.sh rejects a malformed value (#955)                                | Should   | `sdlc/files/_common/scripts/validate-compliance-artifacts.sh`, `sdlc/src/blueprints/3-compile-evidence.raw.md`|
| REQ-FRAMEWORK-BUNDLE-007     | generate-bundled-changes.sh never absorbs a deferred REQ silently: intent with None/omitted, or None with the REQ in range, fails (#955)                              | Should   | `sdlc/files/_common/scripts/generate-bundled-changes.sh`|
| REQ-FRAMEWORK-BUNDLE-008     | Closing a release PR without releasing is a documented procedure; bundle mode no longer rejects stack: python (#955, #995)                                            | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`|
| REQ-FRAMEWORK-BUNDLE-009     | Python CI template: a live declared bundle is registered on its single core-REQ release, the manifest is generated and submitted, members file against it; non-bundle work keeps the date-based release (#995)| Should   | `sdlc/files/ci/python/ci.yml.template`, `sdlc/files/_common/scripts/derive-release-version.sh`|
| REQ-FRAMEWORK-DEFERRAL-001   | RTM status `DEFERRED` is valid and non-terminal; validate-compliance-artifacts, validate-commits and derive-release-version (steps 4, 4-bis) ignore deferred tickets/rows (#956) | Should   | `sdlc/files/_common/scripts/validate-compliance-artifacts.sh`, `validate-commits.sh`, `derive-release-version.sh` |
| REQ-FRAMEWORK-DEFERRAL-002   | list-reqs-in-range.sh prints the distinct REQ ids referenced by `[REQ-x]` tags and `Ref:` trailers in a range (#956)                                       | Should   | `sdlc/files/_common/scripts/list-reqs-in-range.sh` |
| REQ-FRAMEWORK-DEFERRAL-003   | Promotion gate: a develop -> main PR fails when a deferred REQ has commits in range and is not an absorbed predecessor of the release ticket (#956)        | Should   | `sdlc/files/_common/scripts/check-deferred-reqs-in-range.sh`, `check-release-pr-scope.sh` |
| REQ-FRAMEWORK-DEFERRAL-004   | check-release-approval gives a deferred-specific error for portal status `deferred` and still fails the gate (#956)                                        | Should   | `sdlc/files/ci/check-release-approval.yml.template` |
| REQ-FRAMEWORK-DEFERRAL-005   | Deferred tickets are skipped by every CI loop over pending-releases/ via the shared is-deferred-ticket.sh; periodic-review and close-out-reconcile report them separately (#956) | Should   | `sdlc/files/_common/scripts/is-deferred-ticket.sh`, `sdlc/files/ci/*.template`                                                |
| REQ-FRAMEWORK-HOOK-001       | Pre-push hook checks for E2E evidence before allowing pushes with UI-facing file changes (#226)                                                             | Should   | `sdlc/files/stacks/node/hooks/pre-push`                                                                                       |
| REQ-FRAMEWORK-HOOK-002       | Pre-push hook checks for sdlc-implementer-invoked sentinel on feat/fix/refactor/perf commits (#226)                                                         | Should   | `sdlc/files/stacks/node/hooks/pre-push`                                                                                       |
| REQ-FRAMEWORK-HOOK-003       | Pre-push hook checks for .e2e-evidence-wired sentinel when e2e spec files changed (#226)                                                                    | Should   | `sdlc/files/stacks/node/hooks/pre-push`                                                                                       |
| REQ-FRAMEWORK-HOOK-005       | Pre-push E2E gate is REQ-scoped — a stale/unrelated run no longer satisfies it (#578)                                                                       | Should   | `sdlc/files/stacks/node/hooks/pre-push`                                                                                       |
| REQ-FRAMEWORK-SKILL-001      | sdlc-implementer writes .sdlc-implementer-invoked sentinel at Phase 0 on tracked route (#226)                                                               | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-FRAMEWORK-SKILL-002      | sdlc-implementer Phase 2 step 5b halts if E2E gate not run for UI-facing changes (#226)                                                                     | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-FRAMEWORK-SKILL-003      | sdlc-implementer Phase 1 step 9 stamps RTM row with sdlc-implementer@version provenance (#226)                                                              | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-FRAMEWORK-SKILL-004      | e2e-test-engineer writes .e2e-gate-passed sentinel (status line + covered REQ IDs, one per line, since #578) after successful E2E run or NOT_NEEDED (#226)  | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-FRAMEWORK-SKILL-005      | e2e-test-engineer Phase 6 pre-flight browser check + anti-deferral instruction (#238)                                                                       | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-FRAMEWORK-SKILL-006      | e2e-test-engineer Phase 5½ writes .e2e-evidence-wired sentinel after validating wiring (#226)                                                               | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-FRAMEWORK-SKILL-007      | sdlc-implementer Phase 2 step 4b reconciles test-plan.md file paths with actual files (#241)                                                                | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-FRAMEWORK-SKILL-008      | sdlc-implementer Phase 3 step 5b validates test-execution-summary.md gate states via validate-test-summary.sh (#240)                                        | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-FRAMEWORK-VALIDATE-001   | validate-commits.sh checks RTM provenance stamp for REQ-XXX in feat/fix/refactor/perf commits (#226)                                                        | Must     | `sdlc/files/_common/scripts/validate-commits.sh`                                                                              |
| REQ-FRAMEWORK-VALIDATE-002   | validate-test-summary.sh rejects invalid gate states ('deferred', 'browsers not installed') in test-execution-summary.md (#240)                             | Must     | `sdlc/files/_common/scripts/validate-test-summary.sh`                                                                         |
| REQ-FRAMEWORK-VALIDATE-003   | validate-test-summary.sh rejects stale Stage-3 pre-PR draft language surviving into the release PR (#607)                                                   | Must     | `sdlc/files/_common/scripts/validate-test-summary.sh`                                                                         |
| REQ-FRAMEWORK-VALIDATE-004   | validate-commits.sh accepts style: as a Conventional Commit type, REQ-exempt like other housekeeping types (#813)                                            | Must     | `sdlc/files/_common/scripts/validate-commits.sh`                                                                              |
| REQ-FRAMEWORK-GITIGNORE-001  | gitignore.ts syncs .e2e-evidence-wired sentinel entry to consumer .gitignore (#226)                                                                         | Must     | `cli/src/update/gitignore.ts`                                                                                                 |
| REQ-FRAMEWORK-EVIDENCE-001   | compliance-evidence.yml triggers on compliance pushes, and on E2E Regression completion only when e2e_regression_enabled (#869)                             | Must     | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-002   | base URL resolution prefers sdlc-config.json with reachability pre-flight                                                                                   | Must     | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-003   | Per-requirement evidence uploaded with correct evidence_type routing (stage 3)                                                                              | Must     | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-004   | Audit-log export uploaded as audit_log evidence (90-day window)                                                                                             | Should   | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-005   | Normal housekeeping remains integration history; standalone promotion uses distinct `_compliance-docs` evidence scope and bare-date release ownership       | Must     | `sdlc/files/ci/ci.yml.template`, `sdlc/files/ci/post-deploy-prod.yml.template`, `sdlc/files/_common/scripts/standalone-housekeeping-release.sh` |
| REQ-FRAMEWORK-EVIDENCE-006   | E2E Regression evidence preserves source REQ, stage, execution, and feature/regression provenance                                                           | Must     | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-007   | test-execution-summary.md template carries Test Executions section (ISO 29119-3 Test Completion Report)                                                     | Should   | `sdlc/files/_common/3-compile-evidence.md`                                                                                    |
| REQ-FRAMEWORK-EVIDENCE-008   | Incident export enriched with structured sections from PR/issue body (#210 AC6)                                                                             | Should   | `sdlc/files/ci/incident-export.yml.template`                                                                                  |
| REQ-FRAMEWORK-EVIDENCE-009   | Completeness gate blocks incomplete incident reports with unresolved REPLACE markers (#210 AC9)                                                             | Must     | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-010   | E2E regression incident filing with heuristic triage on test failure (#210 AC19-AC27)                                                                       | Should   | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-011   | Nil incident report generated and uploaded as compliance_document when no incidents (#210 AC15-AC18)                                                        | Should   | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-012   | Catch-all compliance_document fallback eliminated; unrecognized files skip-with-warning (#205)                                                              | Must     | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-013   | Typed evidence_type per artifact: sast_report, dependency_audit, e2e_report, e2e_result, smoke_test, release_ticket, coverage_report, gate_outcome (#207)   | Must     | `sdlc/files/ci/compliance-evidence.yml.template`, `sdlc/files/ci/ci.yml.template`                                             |
| REQ-FRAMEWORK-EVIDENCE-014   | workflow_run E2E upload recovers tracked release context from artifact metadata before falling back to `_compliance-docs` (#311)                            | Should   | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-015   | E2E scope decision persisted as evidence, distinguishing deliberate skip from missing coverage (#737)                                                       | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`, `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                 |
| REQ-FRAMEWORK-EVIDENCE-016   | Report-bundle upload falls back to the presigned flow on multipart 400/413, logs failure diagnostics, and surfaces a missing report for non-passing runs (#1018)| Should   | `sdlc/files/_common/scripts/upload-evidence.sh`, `sdlc/files/ci/compliance-evidence.yml.template`                             |
| REQ-FRAMEWORK-EVIDENCE-017   | Sentinel trailer discovery scans 500 commits, prefers the upload's own requirement, and logs where the sentinel came from or that none was found (#1082)    | Should   | `sdlc/files/_common/scripts/upload-evidence.sh`                                                                               |
| REQ-FRAMEWORK-E2ETRIAGE-001  | A failing required check on the release PR halts sdlc-implementer [Blocked] with exactly two paths, fix or accept with a documented exception (#1016)           | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-FRAMEWORK-E2ETRIAGE-002  | Accepted-exception record template and validator: impact assessment, decision-maker, future review date, exact tracking-issue URL; evidence type accepted_e2e_failure (#1016)| Must     | `sdlc/files/_common/skills/sdlc-implementer/references/e2e-accepted-failure.md.template`, `sdlc/files/_common/scripts/validate-risk-acceptance-record.sh`, `contracts/evidence-types.json`|
| REQ-FRAMEWORK-E2ETRIAGE-003  | report-test-execution.sh resolve refuses accepted_exception without --remediation-reference and a valid --record; triage is recorded in the portal without merging into the release head (#1016)| Must     | `sdlc/files/_common/scripts/report-test-execution.sh`                                                                         |
| REQ-FRAMEWORK-E2ETRIAGE-004  | validate-test-summary.sh requires an E2E failures & triage row per failure; CI-as-of stamped summaries need the generated executions table and a head-matching stamp (#1016)| Must     | `sdlc/files/_common/scripts/validate-test-summary.sh`, `sdlc/files/_common/scripts/render-test-executions.sh`                 |
| REQ-FRAMEWORK-E2ETRIAGE-005  | reconcile-e2e-summary.sh compares the summary with the CI results for an execution and fails on an untriaged or misattributed failure (#1016)                   | Should   | `sdlc/files/_common/scripts/reconcile-e2e-summary.sh`                                                                         |
| REQ-FRAMEWORK-E2ETRIAGE-006  | The PR watcher comments on the issue and updates the sticky within one poll of a red required release check, once per failing set, and escalates at phase4.gate_timeout_hours (#1016)| Should   | `sdlc/src/bin/devaudit-sdlc.cjs`                                                                                              |
| REQ-FRAMEWORK-DEPRISK-001    | evaluate-npm-audit.sh schemaVersion 2: every exception needs a valid acceptanceRecord that lists the advisory and shares its tracking issue; an expired entry fails the gate again (#1017)| Must     | `sdlc/files/_common/scripts/evaluate-npm-audit.sh`                                                                            |
| REQ-FRAMEWORK-DEPRISK-002    | Dependency risk-acceptance record template and --kind dependency validation; evidence type accepted_dependency_risk uploaded from compliance/security/risk-acceptances/ (#1017)      | Should   | `sdlc/files/_common/skills/sdlc-implementer/references/dependency-risk-acceptance.md.template`, `sdlc/files/_common/scripts/validate-risk-acceptance-record.sh`, `sdlc/files/_common/scripts/upload-compliance-documents.sh`, `contracts/evidence-types.json`|
| REQ-FRAMEWORK-DEPRISK-003    | sdlc-implementer halts on a failing dependency audit on the release PR and offers bump or accept, with sequencing guidance (#1017)                                                   | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-FRAMEWORK-LIFECYCLE-001  | The generated Release Close-out workflow is executed step by step against a tracer fixture, a fake gh and a mock portal; the clone's own workflow runs in layer 2b (#941)            | Should   | `cli/test/close-out-workflow-behavior.test.ts`, `scripts/release-validation/layer2b.sh`, `scripts/release-validation/surfaces.tsv`|
| REQ-FRAMEWORK-ATTRIBUTION-001 | classify-pr-attribution.sh classifies a PR as attach / skip:doc-only / skip:compliance-record / skip:no-changes; derive-release-version.sh treats a Compliance-Record trailer like Ref (#1019)| Must     | `sdlc/files/_common/scripts/classify-pr-attribution.sh`, `sdlc/files/_common/scripts/derive-release-version.sh`               |
| REQ-FRAMEWORK-ATTRIBUTION-002 | A PR that changes no code does not bind its SHA/branch/executions to a release: feature-e2e req_id=none; upload-evidence.sh and report-test-execution.sh guards on pull_request events, default on (#1019)| Must     | `sdlc/files/ci/feature-e2e.yml.template`, `sdlc/files/_common/scripts/upload-evidence.sh`, `sdlc/files/_common/scripts/report-test-execution.sh`|
| REQ-FRAMEWORK-VALIDATION-001 | compliance-validation.yml gates PRs to main on artifact + commit + test-summary validity (#240)                                                             | Should   | `sdlc/files/ci/compliance-validation.yml.template`                                                                            |
| REQ-FRAMEWORK-VALIDATION-002 | ci-status-fallback emits the Quality Gates status on docs-only commits                                                                                      | Could    | `sdlc/files/ci/ci-status-fallback.yml.template`                                                                               |
| REQ-FRAMEWORK-VALIDATION-004 | ci-status-fallback declares the token permission needed to write commit statuses (`statuses: write`)                                                        | Must     | `sdlc/files/ci/ci-status-fallback.yml.template`                                                                               |
| REQ-FRAMEWORK-VALIDATION-003 | Governance auto-PR workflows (periodic-review, incident-export, close-out)                                                                                  | Could    | `sdlc/files/ci/periodic-review.yml.template`                                                                                  |
| REQ-FRAMEWORK-VALIDATION-005 | close-out-release.yml auto-merges its PR and self-reports pr_opened + completed status to the portal (#620, #601, #602)                                     | Should   | `sdlc/files/ci/close-out-release.yml.template`                                                                                |
| REQ-FRAMEWORK-VALIDATION-006 | close-out-reconcile.yml catches a missed release-closed dispatch on a daily schedule (#786)                                                                 | Should   | `sdlc/files/ci/close-out-reconcile.yml.template`                                                                              |
| REQ-FRAMEWORK-APPROVAL-001   | check-release-approval.yml runs as the PR-to-main merge gate                                                                                                | Must     | `sdlc/files/ci/check-release-approval.yml.template`                                                                           |
| REQ-FRAMEWORK-APPROVAL-002   | Gate blocks merge unless the resolved tracked release is approved (a portal `deferred` release fails with a specific message); a fully declared standalone housekeeping promotion is governed by its explicit exception | Must     | `sdlc/files/ci/check-release-approval.yml.template`                                                                           |
| REQ-FRAMEWORK-APPROVAL-003   | Bootstrap mode passes the gate on the introducing PR                                                                                                        | Must     | `sdlc/files/ci/check-release-approval.yml.template`                                                                           |
| REQ-FRAMEWORK-APPROVAL-004   | Gate links the PR to the release and posts a portal link comment                                                                                            | Should   | `sdlc/files/ci/check-release-approval.yml.template`                                                                           |
| REQ-FRAMEWORK-APPROVAL-005   | PR is linked to the release before the approval gate fails (#973)                                                                                           | Should   | `sdlc/files/ci/check-release-approval.yml.template`                                                                           |
| REQ-FRAMEWORK-POSTDEPLOY-001 | post-deploy-prod.yml runs read-only prod verification on push to main                                                                                       | Should   | `sdlc/files/ci/post-deploy-prod.yml.template`                                                                                 |
| REQ-FRAMEWORK-POSTDEPLOY-002 | Promotes every in-scope release (every pending ticket) and uploads production evidence (stage 5)                                                            | Should   | `sdlc/files/ci/post-deploy-prod.yml.template`                                                                                 |
| REQ-FRAMEWORK-POSTDEPLOY-003 | Post-deploy smoke failure files incident issue with structured sections (#210 AC28-AC29)                                                                    | Should   | `sdlc/files/ci/post-deploy-prod.yml.template`                                                                                 |
| REQ-FRAMEWORK-LABELRET-001   | label-retention.yml enforces incident label survives to issue close (#210 AC1-AC5)                                                                          | Must     | `sdlc/files/ci/label-retention.yml.template`                                                                                  |
| REQ-FRAMEWORK-FEATUREE2E-001 | feature-e2e.yml runs in-scope E2E on PRs to develop, uploads stage-2 origin=feature evidence                                                                | Should   | `sdlc/files/ci/feature-e2e.yml.template`                                                                                      |
| REQ-FRAMEWORK-E2EREGRESSION-001 | e2e-regression.yml is an opt-in three-tier (smoke/critical/regression) E2E gating template, generated only when e2e_regression_enabled (#821)             | Could    | `sdlc/files/ci/e2e-regression.yml.template`, `cli/src/update/ci-templates.ts`                                                 |
| REQ-FRAMEWORK-E2EREGRESSION-002 | e2e-regression.yml concurrency group is configurable via e2e_concurrency_group / e2e_concurrency_cancel_in_progress (#969)                                | Could    | `sdlc/files/ci/e2e-regression.yml.template`, `cli/src/update/ci-templates.ts`                                                 |
| REQ-FRAMEWORK-SDLCSTAGE-001  | upload-evidence.sh --sdlc-stage flag validates 1-5 and forwards as sdlcStage multipart field                                                                | Should   | `scripts/upload-evidence.sh`                                                                                                  |
| REQ-FRAMEWORK-RENDER-001     | Scalar token substitution populates runner, slug, versions, gate params                                                                                     | Must     | `cli/src/lib/templates.ts:substituteTokens`                                                                                   |
| REQ-FRAMEWORK-RENDER-002     | Block substitution renders/omits services, env, E2E, and paths blocks                                                                                       | Must     | `cli/src/lib/templates.ts:substituteBlocks`                                                                                   |
| REQ-FRAMEWORK-RENDER-003     | services block stripped when no database_service configured                                                                                                 | Must     | `cli/src/lib/templates.ts:stripServicesBlock`                                                                                 |
| REQ-FRAMEWORK-RENDER-004     | Python stack renders the stack-specific ci.yml with python gates                                                                                            | Should   | `cli/src/update/ci-templates.ts`                                                                                              |
| REQ-FRAMEWORK-RENDER-005     | Railway host wiring: push-to-main deploy, prod URL from secret, no deploy step                                                                              | Should   | `sdlc/files/hosts/railway/adapter.json`                                                                                       |
| REQ-FRAMEWORK-RENDER-006     | Sync removes superseded workflows and writes all CI_TEMPLATES present                                                                                       | Should   | `cli/src/update/ci-templates.ts`                                                                                              |
| REQ-FRAMEWORK-RENDER-007     | mergeEnvSources dedupes overlapping env keys across combined sources, later source wins (#928)                                                              | Must     | `cli/src/update/ci-templates.ts`                                                                                              |
| REQ-FRAMEWORK-CONTRACT-001   | Shared evidence-types.json contract file maintained in portal repo, synced to installer (#247)                                                              | Must     | `contracts/evidence-types.json`, `cli/test/evidence-contract.test.ts`                                                         |
| REQ-FRAMEWORK-CONTRACT-002   | Installer-side contract test extracts evidence types from CI templates and validates against contract (#247)                                                | Must     | `cli/test/evidence-contract.test.ts`                                                                                          |
| REQ-FRAMEWORK-CONTRACT-003   | Cross-repo sync: portal dispatches on contract change, installer auto-PRs updated copy (#247)                                                               | Should   | `.github/workflows/sync-evidence-contract.yml` (both repos)                                                                   |
| REQ-FRAMEWORK-CONTRACT-004   | CLI CI triggers on sdlc/files/ci/** and contracts/evidence-types.json changes (#247)                                                                        | Must     | `.github/workflows/cli.yml`                                                                                                   |
| REQ-FRAMEWORK-ADAPTER-001    | Stack adapter resolved from sdlc-config.json, defaulting to node                                                                                            | Must     | `cli/src/update/resolve-adapters.ts`                                                                                          |
| REQ-FRAMEWORK-ADAPTER-002    | Host adapter resolved from sdlc-config.json, defaulting to railway                                                                                          | Must     | `cli/src/update/resolve-adapters.ts`                                                                                          |
| REQ-FRAMEWORK-ADAPTER-003    | Install-time stack auto-detection by manifest file (pyproject precedence over package.json)                                                                 | Must     | `cli/src/install/detect-stack.ts`                                                                                             |
| REQ-FRAMEWORK-ADAPTER-004    | Node adapter substitutes the node/npm/TypeScript gate command set                                                                                           | Must     | `sdlc/files/stacks/node/adapter.json`                                                                                         |
| REQ-FRAMEWORK-ADAPTER-005    | Python adapter substitutes the python/pip/pytest gate command set                                                                                           | Must     | `sdlc/files/stacks/python/adapter.json`                                                                                       |
| REQ-FRAMEWORK-ADAPTER-006    | Hook framework per stack: husky (node) vs pre-commit (python)                                                                                               | Must     | `sdlc/files/stacks/node/adapter.json`                                                                                         |
| REQ-FRAMEWORK-ADAPTER-007    | Node hook config files have required content                                                                                                                | Should   | `sdlc/files/stacks/node/hooks/{pre-commit,pre-push,commit-msg,commitlint.config.mjs,lint-staged.config.mjs,.prettierrc.json}` |
| REQ-FRAMEWORK-ADAPTER-008    | Python pre-commit config has required hook content                                                                                                          | Should   | `sdlc/files/stacks/python/hooks/.pre-commit-config.yaml`                                                                      |
| REQ-FRAMEWORK-ADAPTER-009    | Node stack scripts copied; python declares none                                                                                                             | Should   | `adapter.json`                                                                                                                |
| REQ-FRAMEWORK-ADAPTER-010    | Node dev-dependencies auto-installed + Playwright postinstall injected when missing (node only, #245)                                                       | Should   | `cli/src/update/stack-deps.ts`                                                                                                |
| REQ-FRAMEWORK-ADAPTER-011    | Railway host adapter: deploy trigger, production-URL secret, wait-for-deploy, required_secrets incl. RAILWAY_TOKEN (#883)                                   | Must     | `sdlc/files/hosts/railway/adapter.json`                                                                                       |
| REQ-FRAMEWORK-ADAPTER-012    | Host adapter loaded only by name; ci-templates consume the substituted deploy bits                                                                          | Should   | `cli/src/lib/adapter.ts`                                                                                                      |
| REQ-FRAMEWORK-ADAPTER-013    | Malformed adapter manifest aborts the sync at parse time or schema validation (Ajv)                                                                         | Should   | `cli/src/lib/adapter.ts`                                                                                                      |
| REQ-FRAMEWORK-ADAPTER-014    | Railway host adapter carries a schema-validated lean-runtime contract                                                                                       | Should   | `sdlc/files/hosts/railway/adapter.json`, `sdlc/files/hosts/_schema/adapter.schema.json`                                       |
| REQ-FRAMEWORK-ADAPTER-015    | commitlint.config.mjs accepts style: and exempts the Sdlc-Implementer-Sentinel trailer from body/footer-max-line-length (#813, #814)                        | Must     | `sdlc/files/stacks/node/hooks/commitlint.config.mjs`                                                                          |
| REQ-FRAMEWORK-ADAPTER-016    | Optional DEVAUDIT_PROBE_HEADER secret: one header line sent with the post-deploy health probe and smoke checks, for an access-gated production origin (#1022)| Should   | `sdlc/files/ci/post-deploy-prod.yml.template`, `sdlc/files/hosts/vercel/adapter.json`                                         |
| REQ-FRAMEWORK-ADAPTER-017    | Host adapter schema gains an optional reconcile capability (lookup_script, required_cli, secrets); railway and vercel declare it; vercel adds VERCEL_TOKEN as an advisory required secret (#1022)| Should   | `sdlc/files/hosts/_schema/adapter.schema.json`, `sdlc/files/hosts/railway/adapter.json`, `sdlc/files/hosts/vercel/adapter.json`, `cli/src/lib/adapter.ts`|
| REQ-FRAMEWORK-ADAPTER-018    | reconcile-deployment.sh is host-neutral; the provider part is one lookup-deployment-<host>.sh printing {id,status,sha,branch,repo} (railway: CLI, vercel: REST API) (#1022)| Should   | `sdlc/files/_common/scripts/reconcile-deployment.sh`, `sdlc/files/_common/scripts/lookup-deployment-railway.sh`, `sdlc/files/_common/scripts/lookup-deployment-vercel.sh`|
| REQ-FRAMEWORK-ADAPTER-019    | custom host adapter: deploy-custom.yml runs deploy_command, records the GitHub deployment, verifies the new build, posts the terminal status and dispatches post-deploy-prod with the deployed SHA (#1022)| Should   | `sdlc/files/hosts/custom/adapter.json`, `sdlc/files/ci/deploy-custom.yml.template`, `sdlc/files/_common/scripts/record-custom-deployment.sh`, `cli/src/update/ci-templates.ts`|
| REQ-FRAMEWORK-GOVERNANCE-001 | Governance starters are opt-in (NOT auto-seeded on install since v0.1.36)                                                                                   | Should   | `cli/src/install/index.ts`                                                                                                    |
| REQ-FRAMEWORK-GOVERNANCE-002 | bootstrap-governance copies the six starters, dropping .template, skip-if-exists                                                                            | Should   | `cli/src/install/bootstrap-governance.ts`                                                                                     |
| REQ-FRAMEWORK-GOVERNANCE-003 | Each starter carries required frontmatter + the REPLACE banner                                                                                              | Should   | `sdlc/files/_common/governance/{ai-disclosure,dpia,incident-report,periodic-review,risk-register,ropa}.md.template`           |
| REQ-FRAMEWORK-GOVERNANCE-004 | Each starter declares its evidence type and framework-clause coverage                                                                                       | Should   | `sdlc/files/_common/governance/*.md.template`                                                                                 |
| REQ-FRAMEWORK-GOVERNANCE-005 | Governance starters are operator-uploaded, not CI-auto-uploaded                                                                                             | Could    | `sdlc/files/_common/governance/ropa.md.template`                                                                              |
| REQ-FRAMEWORK-RULES-001      | Five AI rule-file targets written so every supported agent discovers the SDLC                                                                               | Must     | `cli/src/update/ai-rules.ts`                                                                                                  |
| REQ-FRAMEWORK-RULES-002      | Cursor/Windsurf/Gemini rule files are pointer files that reference INSTRUCTIONS.md                                                                          | Must     | `cli/src/update/ai-rules.ts`                                                                                                  |
| REQ-FRAMEWORK-RULES-003      | CLAUDE.md preserves project header, appends pointer, strips prior SDLC section                                                                              | Must     | `cli/src/update/ai-rules.ts`                                                                                                  |
| REQ-FRAMEWORK-RULES-004      | INSTRUCTIONS.md is canonical; holds the real SDLC content from INSTRUCTIONS-SDLC.md                                                                         | Must     | `cli/src/update/ai-rules.ts`                                                                                                  |
| REQ-FRAMEWORK-RULES-005      | AI rule-file sync is idempotent on update re-run                                                                                                            | Must     | `cli/src/update/ai-rules.ts`                                                                                                  |
| REQ-FRAMEWORK-STAGE-001      | Stage docs and Tier-1 docs synced verbatim into the consumer's SDLC/                                                                                        | Should   | `cli/src/update/stage-docs.ts`                                                                                                |
| REQ-FRAMEWORK-STAGE-002      | Post-sync validation warns on missing Tier-1 docs in SDLC/                                                                                                  | Should   | `cli/src/update/validation.ts`                                                                                                |
| REQ-FRAMEWORK-STAGE-003      | devaudit status reports presence of the framework files including stage docs and rule files                                                                 | Should   | `cli/src/commands/status.ts`                                                                                                  |
| REQ-FRAMEWORK-STAGE-004      | Synced stage docs are AI-agent redirect stubs; full text lives in blueprints, reachable via `--phase=N --view`                                              | Should   | `sdlc/src/blueprints/*.raw.md`, `SDLC/bin/devaudit-sdlc.cjs`                                                                    |

---

## 4. Requirements by Command, Template & Skill

Each subsection ends with an `Assumptions — <area>` block; cross-cutting ambiguities are consolidated in **Appendix A**.

### Command: install & join

Black-box SRS for `devaudit install [path]` (the full interactive onboarding flow) and `devaudit join [path]` (the explicit second-developer entry point). `install` runs an 11-step pipeline against a consumer repo: authenticate the PAT against the portal → detect node/python stack → collect (or default) a plan → write `sdlc-config.json` → find-or-create the portal project → issue an "Onboarding-issued" CI API key → set GitHub repo secrets/variables → bootstrap git hooks → apply branch protection → sync SDLC templates → print a done report. The same `runInstall` engine drives both commands; `join` pins `mode: 'developer'` (and adds one pre-flight guard) so the four destructive steps (4 write-config, 6 api-key, 7 secrets, 9 branch-protection) skip themselves and the team CI token is never rotated. Every requirement below is observable from outside the process: command + flags + env → stdout/stderr, process exit code, files created/changed under the consumer repo, and HTTP calls to the portal (`x-devaudit-token` header) plus `gh`/`git` subprocess invocations. All step trigger logic is in `cli/src/install/index.ts` (`runInstall`); per-step contracts cite the individual step files. The CLI surface (flags, exit codes) is registered in `cli/src/index.ts`.

#### REQ-CLI-INSTALL-001 — `install` command registration, args, and option surface

- **Priority:** Must — every E2E test invokes the binary through this surface.
- **Source:** `cli/src/index.ts` (`program.command('install [path]')`, `applyCommonFlags`); `cli/src/commands/install.ts` (`runInstallCommand`, `InstallOptions`)
- **Preconditions / inputs:** `devaudit install [path]` with optional positional `path` (defaults to cwd). Command options: `--token <token>`, `--base-url <url>`, `--force-team-config`, `--add-target`. Global options merged via `cmd.optsWithGlobals()`: `--json`, `-y/--yes`, `--dry-run`, `-v/--verbose`, `--no-color`, `--org <slug>`.
- **Given** the binary is on PATH **When** `devaudit install --help` **Then** stdout lists the `install [path]` usage with `--token`, `--base-url`, `--force-team-config`, `--add-target` descriptions and exit code is 0. **When** `devaudit install` is run with a valid setup **Then** `runInstallCommand` calls `runInstall` mapping `--yes`→`nonInteractive`, `--dry-run`→`dryRun`, `--force-team-config`→`forceTeamConfig`, `--add-target`→`addTarget`; only flags actually passed are forwarded (undefined flags are omitted from the options object).
- **Error paths:** Any error thrown inside `runInstall` is caught in `runInstallCommand`, logged via `log.error(message)` to stderr, then `process.exit(1)`.
- **Fixtures/env:** Fixture consumer repo with `package.json`; `DEVAUDIT_USER_TOKEN` env or `--token`; msw portal stub at `--base-url`; execa stub for `gh`/`which`/`git`.

#### REQ-CLI-INSTALL-002 — Token resolution precedence and missing-token failure

- **Priority:** Must — auth is the gate for the whole flow.
- **Source:** `cli/src/install/index.ts` (`resolveTokenForInstall`); `cli/src/lib/auth.ts` (`resolveToken`, `readAuth`)
- **Preconditions / inputs:** Token resolved in order: (1) `--token <token>` flag wins (baseUrl then `--base-url` or default `https://devaudit.ai`); (2) else `resolveToken()` reads `DEVAUDIT_USER_TOKEN` env (with `DEVAUDIT_BASE_URL` env or default); (3) else `~/.config/devaudit/auth.json` (`AUTH_FILE`, version 1 record). `--base-url` overrides the resolved baseUrl when present.
- **Given** none of `--token`, `DEVAUDIT_USER_TOKEN`, or a cached `auth.json` is available **When** `devaudit install` **Then** `runInstall` throws `No DevAudit token found. Set DEVAUDIT_USER_TOKEN, pass --token, or run \`devaudit auth login\` first.`, which surfaces on stderr with exit code 1; no portal calls, no files written.
- **Error paths:** As above (exit 1). With `--token` set but invalid, the failure surfaces later in step 1 (REQ-CLI-INSTALL-004), not here.
- **Fixtures/env:** Run with `DEVAUDIT_USER_TOKEN` unset and `HOME`/config dir pointed at an empty temp dir so no `auth.json` exists.

#### REQ-CLI-INSTALL-003 — Project-path validation and banner

- **Priority:** Must — defines the cwd/`[path]` contract and the always-printed header.
- **Source:** `cli/src/install/index.ts` (`runInstall` path resolve + `isDir` guard, `banner`)
- **Preconditions / inputs:** `path` (or cwd) resolved to absolute. `projectName = basename(projectPath)`.
- **Given** `path` points to a non-existent directory **When** `devaudit install /no/such/dir` **Then** `runInstall` throws `Project path not found: <abs>` → stderr + exit 1, nothing mutated. **Given** a valid dir **Then** before step 1 the banner prints to stdout: `Metasession SDLC Onboarding`, `  Consumer:  <name>`, `  Path:      <abs>`, `  DevAudit:  <baseUrl>`; in dry-run it also prints `  DRY RUN — no mutations will be performed`.
- **Error paths:** Non-directory path → exit 1 with the `Project path not found` message.
- **Fixtures/env:** Temp dir fixture; assert banner lines appear on stdout in order.

#### REQ-CLI-INSTALL-004 — Step 1/12 auth-probe (PAT validation against portal)

- **Priority:** Must — first network call; gates all subsequent steps.
- **Source:** `cli/src/install/auth-probe.ts` (`runAuthProbe`); `cli/src/lib/devaudit-api.ts` (`DevAuditClient.listProjects`, header `x-devaudit-token`)
- **Preconditions / inputs:** Resolved token + baseUrl. Network call: `GET <baseUrl>/api/projects` with header `x-devaudit-token: <token>`.
- **Given** the portal returns 200 **When** step 1 runs **Then** a `1/12 Authenticate` step with status `ok` and message `PAT accepted at <baseUrl>` is recorded; `record()` logs `[1/12 Authenticate] PAT accepted at <baseUrl>` via `log.success`. Exit continues.
- **Error paths:** Portal returns 401 or 403 → `runAuthProbe` throws `PAT rejected (HTTP <status>). Issue a fresh token at <baseUrl>/settings/tokens and retry.` → caught in `runInstallCommand`, stderr + exit 1; no files written, no further steps. Any other HTTP/network error (e.g. 500, ECONNREFUSED) is re-thrown as-is → exit 1.
- **Fixtures/env:** msw handler `http.get(BASE_URL/api/projects)` returning `[]` (happy) or `status:401` (reject); assert the single GET fired with the token header.

#### REQ-CLI-INSTALL-005 — Step 2/12 stack detection (node vs python, working directory)

- **Priority:** Must — drives plan defaults and hook framework choice.
- **Source:** `cli/src/install/detect-stack.ts` (`detectStack`, `findPyproject`)
- **Preconditions / inputs:** Filesystem scan of `projectPath` (max depth 3, skipping `node_modules .git dist build .next .turbo`). Precedence: root `pyproject.toml`→python `.`; nested `pyproject.toml`→python with relative working dir; else root `package.json`→node `.`.
- **Given** the fixture has `package.json` at root **When** step 2 runs **Then** a `2/12 Detect stack` step status `ok` message `stack=node working_directory=.` is logged (the host is no longer claimed here; it is chosen in the plan step, #1022). **Given** root `pyproject.toml` **Then** `stack=python working_directory=.`. **Given** a nested `subdir/pyproject.toml` **Then** `working_directory=subdir`.
- **Error paths:** Neither `pyproject.toml` nor `package.json` within 3 levels → throws `Could not detect stack — no pyproject.toml or package.json found within 3 directory levels.` → stderr + exit 1, nothing mutated. (Verified by install.test.ts "throws when no package.json or pyproject.toml is found".)
- **Fixtures/env:** Node fixture (`package.json`) and python fixture (`pyproject.toml`); an empty temp dir for the error case.

#### REQ-CLI-INSTALL-006 — Step 3/12 plan collection — interactive prompts

- **Priority:** Must — defines the wizard's interactive contract when not `-y`.
- **Source:** `cli/src/install/prompts.ts` (`collectPlan`→`planFromPrompts`, `defaultSlug`, `prodUrlSecretDefault`)
- **Preconditions / inputs:** `nonInteractive=false` (no `-y`). Uses `@clack/prompts.group` with six text prompts: Project slug (default = slugified projectName), Node/Python version (default 20 / 3.11), Source dirs (default `app/ lib/` node, `src/ tests/` python), Working directory (default = detected wd; label "Working directory (blank = root)" when wd is `.`), Production URL secret name (default `<SLUG>_PROD_URL` derived from the entered slug), Production URL (default blank).
- **Given** an interactive TTY **When** the operator accepts defaults **Then** the resulting `InstallPlan` carries `projectSlug`, `runtimeVersion`, `sourceDirs`, `workingDirectory` (blank→`.`), `prodUrlSecretName`, `prodUrlValue`; step 3 logs `3/12 Configure` `slug=<slug> runtime=<ver>`.
- **Error paths:** Operator cancels a prompt (Ctrl-C) → `onCancel` writes `Cancelled.\n` to stderr and `process.exit(0)` (clean exit 0, partial — nothing mutated yet since destructive steps follow).
- **Fixtures/env:** Hard to drive in CI; E2E should prefer `-y` (REQ-CLI-INSTALL-007). For interactive coverage, a pty harness asserting the six prompt labels and the `Cancelled.` exit-0 path.

#### REQ-CLI-INSTALL-007 — Step 3/12 plan collection — non-interactive (`-y/--yes`) from sdlc-config.json

- **Priority:** Should — the CI-friendly path; required for headless E2E.
- **Source:** `cli/src/install/prompts.ts` (`collectPlan`→`planFromConfig`); `cli/src/lib/sdlc-config.ts` (`readSdlcConfig`)
- **Preconditions / inputs:** `nonInteractive=true` (`-y`). Reads existing `sdlc-config.json`. Slug from `cfg.project_slug` (else slugified name); runtime from `cfg.node_version`/`cfg.python_version` (else default); `source_dirs`, `working_directory`, `production_url_secret` from cfg or defaults; `prodUrlValue` always `''`.
- **Given** `-y` and an existing `sdlc-config.json` **When** `devaudit install -y` **Then** the plan is built from config (no prompts, no stdin read) and step 3 logs the slug/runtime.
- **Error paths:** `-y` with NO `sdlc-config.json` and not dry-run → throws `--yes requires an existing sdlc-config.json in the project directory. Run without --yes to create one interactively.` → stderr + exit 1. (In dry-run, missing config is tolerated.)
- **Fixtures/env:** Node fixture seeded with `sdlc-config.json` (`{project_slug, stack, host, node_version}`); a second fixture WITHOUT it to assert the exit-1 error.

#### REQ-CLI-INSTALL-008 — Step 4/12 write sdlc-config.json (operator mode, merge semantics)

- **Priority:** Must — primary on-disk artifact of onboarding.
- **Source:** `cli/src/install/write-config.ts` (`writeSdlcConfig`, `NODE_PATHS_IGNORE`/`PYTHON_PATHS_IGNORE`)
- **Preconditions / inputs:** `installMode='operator'`, not dry-run. Builds config as `{ ...defaultedIfNew, ...existing, ...wizardOwned }`. `wizardOwned` (always wins): `stack`, `host`, `project_slug`, `production_url_secret`, `<node_version|python_version>`, `working_directory`, `source_dirs`, and a `devaudit` block `{ base_url, project_slug, api_key_secret: 'DEVAUDIT_API_KEY' }`. `defaultedIfNew` seeds `runner: self-hosted` (DevAudit-Installer#664/#803 — the portal-configurable, dynamically-resolved value; see REQ-FRAMEWORK-RENDER-001, not the literal `ubuntu-latest` override), `integration_branch: develop`, `release_branch: main`, `sast_baseline: 0`, plus database/e2e/uat/approval/production_review scaffolding and stack-specific `paths_ignore`.
- **Given** operator mode **When** step 4 runs **Then** `<projectPath>/sdlc-config.json` is written as pretty 2-space JSON with trailing newline; step logs `4/12 Write sdlc-config.json` `ok` `wrote <path>`. Re-running over a rich existing config preserves all non-wizard keys (`runner`, `sast_baseline`, `accepted_dep_risks`, `database_*`, `app_env`, `build_env`, `e2e_*`, custom `paths_ignore`, `uat.*`, unknown `custom_field`) while `project_slug/stack/host/production_url_secret` come from the plan. (Verified by install.test.ts "preserves rich sdlc-config fields" and the `runner: self-hosted` assertion in "full run writes sdlc-config.json, creates project, issues key, sets secrets, syncs".)
- **Error paths:** Filesystem write failure propagates → exit 1.
- **Fixtures/env:** Node fixture; assert `sdlc-config.json` exists with `integration_branch=develop`, `release_branch=main`, wizard-owned fields from plan, and a seeded rich config's customizations preserved.

#### REQ-CLI-INSTALL-009 — Step 5/12 find-or-create DevAudit project (portal)

- **Priority:** Must — establishes the portal project the rest of the flow targets.
- **Source:** `cli/src/install/project.ts` (`findOrCreateProject`); `cli/src/lib/devaudit-api.ts` (`getProjectBySlug`→`listProjects`, `createProject`)
- **Preconditions / inputs:** operator mode, not dry-run. Network: `GET <baseUrl>/api/projects`; if no project with `slug===plan.projectSlug`, `POST <baseUrl>/api/projects` with body `{ slug, name }` (name = slug). Sets `plan.projectId`.
- **Given** the slug is absent on the portal **When** step 5 runs **Then** a project is created and step logs `5/12 Find or create DevAudit project` `ok` `project '<slug>' created (id <8chars>…)` (`data.created=true`). **Given** the slug already exists **Then** no POST fires; logs `project '<slug>' already exists (id <8chars>…) — skipping creation` (`data.created=false`).
- **Error paths:** Portal error on GET/POST throws `DevAuditApiError` (`<METHOD> <path> → HTTP <status>`) → exit 1; `sdlc-config.json` from step 4 remains on disk.
- **Fixtures/env:** msw: GET returns `[]` (→ create) or `[{slug}]` (→ skip); POST returns `{id, slug, name}` 201. Assert which calls fired.

#### REQ-CLI-INSTALL-010 — Step 6/12 issue project API key ("Onboarding-issued")

- **Priority:** Must — produces the CI uploader key stored as `DEVAUDIT_API_KEY`.
- **Source:** `cli/src/install/api-key.ts` (`issueApiKey`, `KEY_NAME='Onboarding-issued'`); `cli/src/lib/devaudit-api.ts` (`listApiKeys`, `issueApiKey` POST role `uploader`)
- **Preconditions / inputs:** operator mode, not dry-run, `plan.projectId` set by step 5. Network: `GET <baseUrl>/api/projects/<id>/api-keys`; if no live key named `Onboarding-issued` (revoked_at null), `POST .../api-keys` body `{ name: 'Onboarding-issued', role: 'uploader' }`. Stores `plan.apiKey = plainTextKey` (kept in memory only; never written to disk).
- **Given** no live Onboarding-issued key exists **When** step 6 runs **Then** a key is issued and step logs `6/12 Issue project API key` `ok` `issued (will be stored as repo secret DEVAUDIT_API_KEY)`. **Given** a live key already exists **Then** status `warn` message `'Onboarding-issued' API key already exists — revoke it in the portal and re-run, or set DEVAUDIT_API_KEY manually` and `plan.apiKey` stays unset (→ step 7 skips the `DEVAUDIT_API_KEY` secret). (Verified by install.test.ts "warns and skips API key issuance".)
- **Error paths:** Missing `plan.projectId` (step 5 skipped) throws `projectId missing from plan — step 5 must run before step 6.` Portal error → `DevAuditApiError` → exit 1.
- **Fixtures/env:** msw: api-keys GET returns `[]` (issue) or `[{name:'Onboarding-issued',revoked_at:null}]` (warn); POST returns `{id,name,plainTextKey}`. Because a seeded live key plus an existing `sdlc-config.json` now satisfies all three developer-mode detection bits on its own (REQ-CLI-INSTALL-016, #912), the "warns and skips API key issuance" test pins `mode: 'operator'` so it exercises this step's warn path rather than being auto-routed into developer mode (where step 6 is skipped outright).
- **See also:** REQ-CLI-INSTALL-027 — the person's own viewer-role key issued by step 6b/12 (default; `--no-viewer-key` opts out); `DevAuditClient.issueApiKey()` now takes a `role: 'uploader' | 'viewer'` third parameter defaulting to `'uploader'`, so this step's POST body is unchanged.

#### REQ-CLI-INSTALL-027 — `install` issues your own read-only viewer key by default (step 6b/12) (#867, #876, #945, #1099)

- **Priority:** Should — the viewer key is the one portal credential safe to hand to an agent (it can never mutate), and it is per person: one named key per person per project per machine, kept out of the repository.
- **Source:** `cli/src/index.ts` (`install` and `join` `--no-viewer-key`, `--print-viewer-key`; `--with-viewer-key` kept as a deprecated no-op); `cli/src/install/api-key.ts` (`issueViewerApiKey`); `cli/src/lib/viewer-keys.ts` (`viewerKeyName`, `saveViewerKey`); `cli/src/install/done-report.ts`.
- **Preconditions / inputs:** `devaudit install` or `devaudit join` with a personal access token and an existing portal project (step 5).
- **Given** a run without `--no-viewer-key`, outside `--dry-run` **Then** step 6b issues a `viewer`-role key named `viewer:<user email>:<hostname>` (email from `git config user.email`, else the OS user name), saves it in `~/.config/devaudit/viewer-keys.json` (REQ-CLI-AUTH-008) and prints nothing secret; `--print-viewer-key` prints the value once. **Given** a key for this base URL and project is already saved **Then** step 6b is `ok` and changes nothing. **Given** a live portal key with this person's name that is not saved here **Then** `warn` (its value cannot be recovered): revoke it in the portal and rerun, or `devaudit auth viewer-key set`. **Given** `--no-viewer-key` **Then** `skipped`. **Given** `--dry-run` **Then** `planned`.
- **Downstream effects:** no GitHub repo secret is written and no `viewer_api_key_secret` is added to `sdlc-config.json` (an existing value is carried through unchanged, and `doctor` reports its repo secret as unused); nothing is written to `.env`.
- **Error paths:** a refused request prints the portal's own reason as a `warn`: 403 (since metasession-dev/devaudit#921 the five-active-key cap or no access to the project; on an older portal, a non-admin), 409 (a live key of that name); without a portal message, a 403 says to check access with a project admin. Any other failure is a `warn` with the cause. A key of the same name that is revoked or past its `expires_at` does not count as live (the portal lists both).
- **Update (#1099 follow-up):** live means `revoked_at` null and `expires_at` absent or in the future (`isActiveApiKey`, also used by `doctor --fix`); refusal wording is shared with `doctor --fix` (`viewerKeyRefusal`). The install and join never fail because of the viewer key.
- **Fixtures/env:** `cli/test/install.test.ts` ("per-person viewer key (#1099)"); `cli/test/setup-viewer-keys.ts` points every test at a throwaway keys file.

---

#### REQ-FRAMEWORK-ADAPTER-017 — Host adapters declare their webhook-loss recovery as data (#1022)

- **Priority:** Should — generation and doctor checks branched on the host name `railway`, so a second host with a recovery path needed core edits.
- **Source:** `sdlc/files/hosts/_schema/adapter.schema.json` (`reconcile`: `lookup_script` matching `^lookup-deployment-[a-z0-9-]+\.sh$`, `required_cli` string or null, `secrets` upper-case names, no other keys); `cli/src/lib/adapter.ts` (`HostReconcile`); the railway and vercel adapters.
- **Given** an adapter with `reconcile` **Then** it validates against the schema; an unknown key inside `reconcile` or a lookup script name outside the pattern is rejected. **Given** the vercel adapter **Then** `required_secrets` includes `VERCEL_TOKEN` (advisory, exactly as railway's `RAILWAY_TOKEN`) and `reconcile.secrets` also lists the optional `VERCEL_TEAM_ID`.
- **Fixtures/env:** `cli/test/update.test.ts` (adapter loading through `syncProject`), `cli/test/doctor.test.ts` ("reports a missing VERCEL_TOKEN for a vercel host consumer").

#### REQ-FRAMEWORK-ADAPTER-018 — Host-neutral reconcile with per-host lookups (#1022)

- **Priority:** Should — a Vercel consumer whose `deployment_status` event never reaches GitHub blocked the post-deploy gate forever, with no recovery path.
- **Source:** `sdlc/files/_common/scripts/reconcile-deployment.sh` (shared checks: terminal success, exact SHA from `main` of this repo, health probe with the optional `DEVAUDIT_PROBE_HEADER`, idempotent `success` status POST with the `--verbose` error capture of #842, `deployment-reconciliation.json` with `provider`); `lookup-deployment-railway.sh` (`railway deployment list --json`); `lookup-deployment-vercel.sh` (`GET /v13/deployments/{id}` with `VERCEL_TOKEN`, optional `teamId`; requires `target=production` and, when given, a matching `projectId`; `READY`->success).
- **Given** a provider deployment that is terminal-successful for the expected SHA, branch `main` and this repo, and a healthy URL **Then** the GitHub deployment gets one `success` status (a re-run, including against a status written by the pre-#1022 script, posts nothing) and the evidence JSON names the provider. **Given** a failed or mismatched deployment, a preview deployment, another Vercel project, an unknown provider, a failed health probe or a failed status POST **Then** it exits non-zero with the reason (the POST failure prints the full GitHub error body).
- **Fixtures/env:** `reconcile-deployment.test.sh` (34 cases, ported from `reconcile-railway-deployment.test.sh`).

---

#### REQ-FRAMEWORK-ADAPTER-019 — The `custom` host: a self-run deploy the production gate can see (#1022)

- **Priority:** Should — AWS, self-hosted and script deploys post no GitHub `deployment_status`, so the post-deploy gate could never pass for them.
- **Source:** `sdlc/files/hosts/custom/adapter.json` (`deploy_workflow`, no `reconcile`); `sdlc/files/hosts/_schema/adapter.schema.json` (`deploy_workflow`); `sdlc/files/ci/deploy-custom.yml.template`; `sdlc/files/_common/scripts/record-custom-deployment.sh` (`create`, `status`, `verify`); `cli/src/update/ci-templates.ts` (tokens `DEPLOY_TRIGGER_BLOCK`, `DEPLOY_COMMAND`, `DEPLOY_SECRETS_ENV`, `DEPLOYED_SHA_URL`, `DEPLOYED_SHA_JQ`); `sdlc/files/ci/post-deploy-prod.yml.template` (optional `deployed_sha` dispatch input); `cli/src/install/write-config.ts` (seeds the keys for `host: custom`).
- **Given** `host: custom` **When** `update` runs **Then** `deploy-custom.yml` is generated (not `reconcile-deployment.yml`); it triggers per `deploy_trigger` (`push_to_main` default on the release branch, `git_tag` on `v*`, `manual`), always allows `workflow_dispatch`, and runs: create a GitHub deployment (`required_contexts: []`) and post `in_progress`; run `deploy_command` with `DEPLOY_SHA`, `DEPLOY_ENVIRONMENT`, `PROD_URL` and the secrets in `deploy_secrets` (names matching `^[A-Z][A-Z0-9_]*$` only); verify (`deployed_sha_url` with optional `deployed_sha_jq`: the running SHA must equal the deployed one, either may be abbreviated; otherwise a 2xx/3xx health check, flagged as weaker); post `success` then `gh workflow run post-deploy-prod.yml -f deployed_sha=<sha>`; on any failure post `failure`. A missing `deploy_command` renders a step that fails loudly. **Given** any host whose adapter names no `deploy_workflow` **Then** `deploy-custom*.yml` is removed (manifest-driven, REQ-CLI-UPDATE-030).
- **Fixtures/env:** `cli/test/custom-host.test.ts` (5), `record-custom-deployment.test.sh` (22).

---

#### REQ-CLI-INSTALL-011 — Step 7/12 set GitHub secrets and variables

- **Priority:** Must — wires the consumer repo's CI to the portal.
- **Source:** `cli/src/install/github.ts` (`setGithubSecrets`, `buildOperations`, `buildSkipped`); `cli/src/lib/git-provider/github.ts` (`setSecret`→`gh secret set`, `setVariable`→`gh variable set`)
- **Preconditions / inputs:** operator mode, not dry-run, a resolved GitHub provider. Operations in order: secret `<apiKeySecretName>` (default `DEVAUDIT_API_KEY`; only if `plan.apiKey` set), secret `<viewerApiKeySecretName>` (only if both `plan.viewerApiKey` and `plan.viewerApiKeySecretName` are set — i.e. step 6b issued a viewer key, see REQ-CLI-INSTALL-027), secret `<prodUrlSecretName>` (only if `plan.prodUrlValue` non-empty), variable `DEVAUDIT_BASE_URL` = `ctx.baseUrl` (always). Each secret runs `gh secret set <name>` (value piped via stdin) and the variable runs `gh variable set <name> --body <value>` in `projectPath`. **`DEVAUDIT_USER_TOKEN` is never written as a repo secret (devaudit-installer#912)** — it previously was, unconditionally, but no generated CI workflow ever consumed it (the only template reference sat inside a permanently-disabled `compliance-evidence.yml.template` step, deprecated per #122's PAT-expiry foot-gun), so it was dropped. The operator's PAT remains a purely operator-local credential (env var / `devaudit auth login` cache), used by the CLI itself (the `submit-for-uat-review.sh` script was retired in #1099).
- **Given** provider present + apiKey issued **When** step 7 runs **Then** `gh secret set DEVAUDIT_API_KEY` and `gh variable set DEVAUDIT_BASE_URL` fire, and **no** `gh secret set DEVAUDIT_USER_TOKEN` call fires; step logs `7/12 Set GitHub secrets and variables` `ok` `N item(s) set` (with `(skipped: DEVAUDIT_API_KEY (no new key issued); <viewer secret> (no new viewer key issued); <secret> (no value provided))` appended when applicable — the viewer entry only appears when a viewer secret name is configured but no new viewer key was issued this run). **Given** no new API key, no viewer key, and no prod-URL value (e.g. `--force-team-config` against a project whose `Onboarding-issued` key already exists) **Then** zero `setSecret` calls fire — only `setVariable(DEVAUDIT_BASE_URL)` — and the step is still `ok` (it ran; there was simply nothing new to write). (Verified by install.test.ts "full run writes sdlc-config.json, creates project, issues key, sets secrets, syncs", which asserts `DEVAUDIT_USER_TOKEN` is **not** among the recorded secret names.)
- **Error paths:** No git provider resolved → step 7 is recorded `skipped` with message from `resolveProvider.reason` and `log.warn([7/12 …] SKIPPED <reason>)` (flow continues). `gh` missing entirely (provider falls back without `gh` and no `GH_TOKEN`) → `setSecret` throws `Setting a GitHub repo secret without \`gh\` CLI requires sodium encryption … Install \`gh\` CLI` → exit 1. Developer mode → `skipped` `developer mode — leaving DEVAUDIT_API_KEY, DEVAUDIT_BASE_URL, and the production-URL secret unchanged. Use --force-team-config to rotate them as the project operator.`
- **Fixtures/env:** execa stub recognising `gh secret set`/`gh variable set`; or fake provider recording `setSecret`/`setVariable` names. Assert the `DEVAUDIT_API_KEY` secret and `DEVAUDIT_BASE_URL` variable, and assert `DEVAUDIT_USER_TOKEN` is absent from the secret names.

#### REQ-CLI-INSTALL-012 — Step 8/12 bootstrap hook framework (husky / pre-commit)

- **Priority:** Must — installs git hooks; runs in BOTH operator and developer mode.
- **Source:** `cli/src/install/hooks-bootstrap.ts` (`bootstrapHooks`, `bootstrapNode`, `bootstrapPython`, `commandExists`)
- **Preconditions / inputs:** not dry-run. Node: if `.husky/` already exists → `ok` `.husky/ already exists` (no exec); else if `npx` on PATH → `npx husky init` (cwd projectPath, stdio inherit) → `ok` `.husky/ bootstrapped`. Python: if `pre-commit` on PATH → `pre-commit install` then `pre-commit install --hook-type commit-msg` → `ok` `pre-commit hooks installed`.
- **Given** a node fixture without `.husky/` and `npx` available **When** step 8 runs **Then** `npx husky init` executes and `.husky/` is created on disk. **Given** node fixture WITH `.husky/` **Then** no exec, `ok`.
- **Error paths:** Node without `npx` on PATH → status `warn` `npx not on PATH — run \`npx husky init\` manually`(flow continues, exit unaffected). Python without`pre-commit`→`warn` `pre-commit not on PATH — run \`pip install pre-commit && pre-commit install\` manually`.
- **Fixtures/env:** execa stub for `which`/`npx`/`pre-commit`; for the warn path, stub `which` to fail. Assert `npx husky init` invocation and `.husky/` presence.

#### REQ-CLI-INSTALL-013 — Step 10/12 configure branch protection

- **Priority:** Must — enforces the compliance gates on the release and integration branches.
- **Source:** `cli/src/install/branch-protection.ts` (`configureBranchProtection`, `REQUIRED_CHECKS`); `cli/src/lib/git-provider/github.ts` (`getRepoMeta`, `applyBranchProtection`→`gh api -X PUT /repos/:o/:r/branches/:b/protection`)
- **Preconditions / inputs:** operator mode, not dry-run, GitHub provider resolved. Resolves the release branch from `sdlc-config.json`'s `release_branch` (default `'main'`) — **not** the GitHub-reported default branch (#731: those two can now legitimately differ, since step 9 may have set the default to `develop`) — then PUTs branch-protection with required status checks `['Compliance Validation','DevAudit Release Approval','Quality Gates']` on it (`required_approving_review_count:1`), and `['Quality Gates']` on the integration branch (`required_approving_review_count:0`) when it differs from the release branch.
- **Given** provider + resolvable repo **When** step 10 runs **Then** the `gh api … /protection` PUT fires on `<release_branch>` and step logs `10/12 Configure branch protection` `ok` `required checks on <branch>: Compliance Validation, DevAudit Release Approval, Quality Gates`. These three are the installer-defined authoritative branch-protection checks; external hosting-platform suites are informational unless the consumer deliberately configures otherwise.
- **Error paths:** `getRepoMeta` fails → `warn` `could not resolve git repo (<msg>) — configure manually` (flow continues). `applyBranchProtection` returns `{applied:false}` → `warn` `<gh stderr first line> — configure manually`. No provider at all → step recorded `skipped` (`10/12 Configure branch protection`) with the no-provider reason and `log.warn`.
- **Fixtures/env:** Fake provider with `getRepoMeta`→`{owner,name,defaultBranch:'main'}` and `applyBranchProtection`→`{applied:true}`; assert the call with `checks.length===3`. Regression fixture with `defaultBranch:'develop'` + `release_branch:'main'` config asserts protection still lands on both `main` (strict) and `develop` (lighter), proving the release-branch resolution is config-driven, not default-branch-driven.

#### REQ-CLI-INSTALL-026 — Step 9/12 set default branch to integration_branch (#731)

- **Priority:** Must — without this, a repo's GitHub default branch stays `main` (GitHub's own creation default) forever, so GitHub's UI (new-branch dropdown, "Compare & pull request") keeps steering contributors onto `main`, where the real Quality Gates workflow never triggers.
- **Source:** `cli/src/install/default-branch.ts` (`configureDefaultBranch`); `cli/src/lib/git-provider/github.ts` (`setDefaultBranch`→`gh repo edit --default-branch` / REST `PATCH /repos/:o/:r`)
- **Preconditions / inputs:** operator mode, not dry-run, GitHub provider resolved. Resolves `integration_branch` from `sdlc-config.json` (default `'develop'`). Idempotent — `setDefaultBranch` reads the current default via `getRepoMeta()` first; a no-op (`{changed:false}`) if it already matches.
- **Given** provider + resolvable repo whose default branch differs from `integration_branch` **When** step 9 runs **Then** `gh repo edit --default-branch <integration_branch>` fires and step logs `9/12 Set default branch` `ok` `<old> -> <integration_branch>`. **Given** the default already matches **Then** no mutating call fires, step logs `ok` `already <integration_branch>`.
- **Error paths:** `getRepoMeta` fails → `warn` `could not resolve git repo (<msg>) — set default branch manually` (flow continues). `setDefaultBranch` fails (gh CLI error or REST non-2xx) → `warn` `FAILED — <message>`. No provider at all → step recorded `skipped` (`9/12 Set default branch`) with the no-provider reason. Developer mode → `skipped` `developer mode — leaving default branch unchanged. Use --force-team-config to re-apply as the project operator.`
- **Fixtures/env:** Fake provider's `setDefaultBranch` call recorded and asserted to fire before `applyBranchProtection`; idempotent no-op case with `getRepoMeta` already returning the target branch; developer-mode skip case; no-provider skip case.

#### REQ-CLI-INSTALL-014 — Step 11/12 sync SDLC templates into the consumer repo

- **Priority:** Must — writes the bulk of framework files (AI rules, hooks, scripts, CI, skills). Runs in BOTH modes.
- **Source:** `cli/src/install/sync-templates.ts` (`syncTemplates`); `cli/src/update/index.ts` (`syncProject`, SECTION_RUNNERS) — see the `update`-area SRS for the full file manifest (cross-area dependency).
- **Preconditions / inputs:** not dry-run. Delegates to `syncProject(projectPath)` which resolves adapters from `sdlc-config.json` and runs 15 `SECTION_RUNNERS` entries (2a stage docs, 2b AI rules, 2c stack hooks, 2c-ii stack deps, 2d scripts, 2e issue templates, 2e-ii skills, 2e-iii evidence helper, 2f CI templates, 2g gitignore sentinels, 2h SDLC CLI engine, 2i `.devin/workflows`, 2j consumer patches, 2j-i default branch, 2k branch protection) plus two steps run outside the loop (2l format synced files, 2m version stamp — REQ-CLI-UPDATE-026/027/028) and validation. **Corrected 2026-09-30 (#931 docs audit):** this REQ previously said "nine sections", stale since #929/#930-adjacent sections (2g through 2m) were added without updating this count.
- **Given** a synced consumer **When** step 11 runs **Then** framework files appear on disk — including AI-assistant pointer files (`CLAUDE.md`/`.cursorrules`/`.windsurfrules`/`GEMINI.md`/`INSTRUCTIONS.md` per `cli/src/update/ai-rules.ts`), `.claude/skills/*`, hooks, `scripts/*`, and CI workflows under `.github/workflows/` — and the step logs `11/12 Sync SDLC templates` `ok` `synced N files across M sections`.
- **Error paths:** `syncProject` throws `Project path not found` if the dir vanished (exit 1). Adapter resolution emits a deprecation warning when stack/host keys are missing from `sdlc-config.json` (non-fatal).
- **Fixtures/env:** Requires `DEVAUDIT_INSTALLER_ROOT` (or bundled snapshot) pointing at the template tree, as the install/join tests set. Assert `totalFilesSynced > 0` and pointer files present.

#### REQ-CLI-INSTALL-015 — Step 12/12 done report (operator copy) and no governance auto-seed

- **Priority:** Must — defines the success terminal output and the v0.1.36 governance opt-in contract.
- **Source:** `cli/src/install/done-report.ts` (`doneReport`, operator branch); `cli/src/install/index.ts` (governance auto-seed removed; `bootstrapGovernanceDocs` no longer called)
- **Preconditions / inputs:** operator mode (default). `doneReport` is synchronous (no I/O).
- **Given** a successful operator install **When** all steps complete **Then** step `12/12 Done` status `ok` prints the next-steps block to stdout: `<name> is onboarded.`, the `git checkout -b feat/sdlc-onboarding` / `git add -A` / `git commit -m "feat: onboard <slug> to Metasession SDLC"` / `git push` / `gh pr create --base develop` sequence, and the post-merge compliance guidance. `data.mode='operator'`, `data.nextBranch='feat/sdlc-onboarding'`. The process completes with exit code 0. **And** `compliance/governance/` is NOT created (governance starters are opt-in via `devaudit bootstrap-governance`). (Verified by install.test.ts asserting `compliance/governance` absent after a full run.)
- **Error paths:** None (pure formatter).
- **Fixtures/env:** Full-run node fixture; assert stdout contains `is onboarded.` and `feat/sdlc-onboarding`, and that `compliance/governance/` does not exist.
- **See also:** REQ-CLI-INSTALL-027 — when step 6b issued a viewer key (`plan.viewerApiKey` set), the operator done report inserts a block immediately after `<name> is onboarded.`: a one-time-visibility warning (`⚠ <viewerApiKeySecretName> (read-only, safe to persist locally) — shown once, will not be shown again:`), the raw `plan.viewerApiKey` value on its own line, and a literal `echo "<viewerApiKeySecretName>=<rawValue>" >> .env` instruction (devaudit-installer#945 — GitHub secrets are write-only, so this is the only point the raw value is ever obtainable), followed by the existing note that it's safe to persist locally for an agent (e.g. `sdlc-implementer`) to query release/check/cycle status because it can only reach the read-back endpoints. Absent otherwise — including the re-run case where step 6b only warns (`plan.viewerApiKey` stays unset), so a value is never printed for an already-existing key.

#### REQ-CLI-INSTALL-016 — Developer-mode auto-routing (three-bit detection skips steps 4/6/7/9/10)

- **Priority:** Must — the second-dev safety contract for a bare `devaudit install` on an onboarded repo.
- **Source:** `cli/src/install/index.ts` (`detectInstallMode(ctx, plan, options)` — no longer takes a git provider); skip branches in `write-config.ts`, `api-key.ts`, `github.ts`, `default-branch.ts`, `branch-protection.ts`; `done-report.ts` (developer branch)
- **Preconditions / inputs:** `mode='auto'` (default), not dry-run, no `--force-team-config`. All THREE bits must hold: (1) `sdlc-config.json` exists at the repo root; (2) `getProjectBySlug(plan.projectSlug)` returns a project; (3) a live (`revoked_at === null`) `Onboarding-issued` API key exists for that project. Any failure (or any portal error) → operator (safe default). **Changed by devaudit-installer#912:** a fourth bit — "the repo has a `DEVAUDIT_USER_TOKEN` secret" (`provider.hasSecret`→`gh secret list`) — was removed. `install` no longer writes that secret (REQ-CLI-INSTALL-011), so its presence stopped signalling anything; a project with a live portal project and `Onboarding-issued` key was, by construction, already installed. `detectInstallMode` therefore makes no git-provider call at all.
- **Given** all three bits true **When** `devaudit install` runs **Then** `log.info` prints `developer mode auto-detected (project + Onboarding-issued key present): destructive steps (4, 6, 7, 9, 10) will skip. Use --force-team-config to rotate team secrets.`; steps 4/6/7/9/10 are recorded `skipped` (no `sdlc-config.json` rewrite, no key issuance, no `setSecret`/`setVariable`, no `setDefaultBranch`, no `applyBranchProtection`); step 8 and 11 still run; the done report is `12/12 Done (developer mode)` (`data.mode='developer'`) listing what was deliberately skipped. **Given** a repo that still carries a legacy `DEVAUDIT_USER_TOKEN` secret, or doesn't **Then** the outcome is identical — the secret is not consulted. (Verified by install.test.ts "developer mode: skips steps 4, 6, 7, 9, 10 when all three detection bits are true".)
- **Error paths:** Any of the three bits false, or any portal error during the probe → operator (safe default). The former "missing `DEVAUDIT_USER_TOKEN` secret → falls back to operator" path no longer exists; its test was removed in #912 because the scenario can no longer be constructed.
- **Fixtures/env:** msw seeds project + Onboarding-issued key (`seedOnboardedPortal`) plus an on-disk `sdlc-config.json` — sufficient on its own to trip developer mode. Assert no mutating provider calls fired. Note the corollary for other tests: any operator-path test that seeds a live `Onboarding-issued` key alongside an existing `sdlc-config.json` must now pin `mode: 'operator'` (or pass `forceTeamConfig`), or it will be auto-routed into developer mode.

#### REQ-CLI-INSTALL-017 — `--force-team-config` pins operator mode (rotation lane)

- **Priority:** Should — operator's deliberate secret-rotation override.
- **Source:** `cli/src/install/index.ts` (`detectInstallMode`, `forceTeamConfig` branch); `cli/src/commands/install.ts` / `cli/src/index.ts` (`--force-team-config`)
- **Preconditions / inputs:** `--force-team-config` flag. Overrides ALL detection (and `mode`) → operator.
- **Given** all three dev-mode bits would otherwise be true **When** `devaudit install --force-team-config` **Then** `log.info` prints `--force-team-config: running operator-mode (will rewrite repo secrets + branch protection).`; steps 4/6/7/9/10 run (sdlc-config rewritten, step 7 executes — `setVariable(DEVAUDIT_BASE_URL)` always fires, `setSecret` fires for whichever secrets have a new value this run — and `applyBranchProtection` fires); done report is `12/12 Done` (operator copy). Note `--force-team-config` does **not** force re-issuance of an existing `Onboarding-issued` key: step 6 still warns-and-skips when one is live (REQ-CLI-INSTALL-010), so against such a project step 7 may legitimately fire zero `setSecret` calls. (Verified by install.test.ts "--force-team-config: pins back to operator mode even when all dev-mode bits are true".)
- **Error paths:** Same destructive-step error paths as REQ-CLI-INSTALL-008..013.
- **Fixtures/env:** Onboarded portal (`seedOnboardedPortal`) + on-disk `sdlc-config.json`; assert `setVariable` (not `setSecret` — see above, #912) and `applyBranchProtection` were called, step 7 is `ok`, and the done step is exactly `12/12 Done`.

#### REQ-CLI-INSTALL-018 — `--dry-run` preview (no mutation, operator-max step set)

- **Priority:** Should — preview safety; common E2E assertion.
- **Source:** `cli/src/install/index.ts` (`detectInstallMode` dry-run branch → operator); per-step `ctx.dryRun` branches in every step file
- **Preconditions / inputs:** `--dry-run`. Mode detection short-circuits to operator (no probes) so the report shows the maximum step set; `--force-team-config`/`mode=developer` still take effect. Banner prints `DRY RUN — no mutations will be performed`.
- **Given** `devaudit install --dry-run -y` **When** it runs **Then** steps 4/5/6/7/9/10 report status `planned` with "would …" messages (e.g. step 4 `would write <path> (stack=…, slug=…)`, step 5 `would create or find project slug='…'`, step 7 `would set secret:DEVAUDIT_API_KEY, … via github provider`, step 8 `would run \`npx husky init\``, step 10 `would run native syncProject() …`); NO `sdlc-config.json`is written, NO portal POST fires, NO provider mutating method or`pre-commit`/`npx` exec runs. (Verified by install.test.ts "dry-run produces a plan without mutating disk or calling execa".)
- **Error paths:** Auth probe (step 1) and stack detection (step 2) still execute in dry-run, so an invalid PAT or undetectable stack still exits 1.
- **Fixtures/env:** Node fixture; assert `fs.stat(sdlc-config.json)` rejects after the run and no mutating execa/provider calls recorded.

#### REQ-CLI-INSTALL-019 — Plugin lifecycle hooks around install (beforeInstall/afterInstall)

- **Priority:** Could — observable only when a plugin is installed; not part of the core flow.
- **Source:** `cli/src/install/index.ts` (`discoverPlugins`, `buildPluginContext`, `runHook 'beforeInstall'/'afterInstall'`)
- **Preconditions / inputs:** One or more plugins discovered in `~/.config/devaudit/plugins/`, not dry-run.
- **Given** a plugin exposing `beforeInstall`/`afterInstall` **When** `devaudit install` runs (not dry-run) **Then** `beforeInstall` fires after step 1 and `afterInstall` fires after step 11, each with a plugin context built from `projectPath`. In dry-run, neither hook fires.
- **Error paths:** Plugin load failures are surfaced earlier by the CLI bootstrap (`log.warn(Plugin at <dir> failed to load: <reason>)`) and do not abort install.
- **Fixtures/env:** A fixture plugin dir; assert hook side effects only when not dry-run.

#### REQ-CLI-INSTALL-020 — `--json` machine-readable step stream

- **Priority:** Could — alternate output mode; useful for E2E parsing.
- **Source:** `cli/src/index.ts` (`applyCommonFlags` preAction → `configureLogger({json})`); `cli/src/lib/logger.ts` (JSON reporter)
- **Preconditions / inputs:** `--json` global flag.
- **Given** `devaudit install --json …` **When** it runs **Then** every log line is emitted to stdout as a JSON object `{ level, tag, args, date }` (one per line) instead of human-formatted text; step messages still carry the `[N/12 …]` tags in `args`. Exit codes are unchanged from the non-JSON path.
- **Error paths:** Errors are emitted as JSON `error`-level records; exit 1 on fatal.
- **Fixtures/env:** Run with `--json`; assert each stdout line `JSON.parse`s and includes the step messages.

#### REQ-CLI-INSTALL-021 — Backward-compatible `targets` array for multi-target (polyglot monorepo) consumers (#689)

- **Priority:** Must — the schema foundation every other multi-target requirement below depends on. `resolveTargets()`'s synthesis/round-trip behaviour itself is unaffected by the 2026-09-26 deprecation (legacy multi-target consumers still depend on it); only *new* adoption via `--add-target` is refused — see REQ-CLI-INSTALL-022.
- **Source:** `cli/src/lib/sdlc-config.ts` (`Target` interface, `SdlcConfig.targets`, `resolveTargets()`)
- **Preconditions / inputs:** `sdlc-config.json` either omits `targets` entirely (legacy flat shape: `project_slug`, `stack`, `working_directory`, `source_dirs`, `production_url_secret`, `devaudit.*` at the top level) or carries an explicit `targets: Target[]` array, where each `Target` is `{ name, stack?, working_directory?, source_dirs?, production_url_secret?, devaudit? }`.
- **Given** a legacy flat config with no `targets` key **When** any caller resolves it via `resolveTargets(config)` **Then** exactly one synthesized target is returned, named `'default'`, with its fields copied from the flat top-level ones (`working_directory` defaulted to `'.'` when absent, `devaudit.project_slug` defaulted to the top-level `project_slug` when `devaudit.project_slug` is itself absent). **Given** a config with an explicit non-empty `targets` array **Then** `resolveTargets` returns it unchanged (no synthesis, no field defaulting). **Given** no `sdlc-config.json` file at all **Then** `readSdlcConfig` returns `null` (unchanged from pre-#689 behaviour) rather than throwing. (Verified by sdlc-config.test.ts "synthesizes a single implicit target from a legacy flat config", "round-trips an explicit targets array unchanged", "returns null for a missing config file".)
- **Error paths:** None — `resolveTargets` is a pure function over already-parsed JSON; malformed `sdlc-config.json` fails earlier at `JSON.parse` inside `readSdlcConfig` (pre-existing, unchanged).
- **Fixtures/env:** Temp dirs seeded with either shape via `fs.writeFile`; no network, no execa.

#### REQ-CLI-INSTALL-022 — `--add-target`: append a new target instead of refusing or clobbering (#689/#691)

- **Priority:** Must — the only supported way to onboard a second stack from the same repo without hand-editing `sdlc-config.json`.
- **Source:** `cli/src/install/write-config.ts` (`writeSdlcConfig`, `isNewTarget` check); `cli/src/install/prompts.ts` (`planFromConfig`/`planFromPrompts` `ctx.addTarget` branch, `defaultSlug`)
- **Preconditions / inputs:** `--add-target` flag on `devaudit install`. Target identity for the "is this a different target" check is `working_directory` equality against every entry from `resolveTargets(existingConfig)` — project_slug is deliberately NOT part of that check, because the non-`--add-target` planning path always inherits `project_slug` from the existing config regardless of which directory was actually detected. Without `--add-target`, `planFromConfig` only trusts the existing config's `working_directory` when the freshly-detected stack still matches the config's `stack`; on a stack mismatch it uses the freshly-detected directory instead, so a genuinely new, unconfigured target is correctly identified rather than silently blended into the existing one. With `--add-target`, the plan ignores the existing config's slug/working_directory/runtime entirely and derives a fresh slug from `basename(detected.workingDirectory)` (or the project name at repo root).
- **Given** step 4 detects `isNewTarget=true` and `--add-target` was NOT passed **When** step 4 runs **Then** it returns status `fail` with a message matching `/--add-target/`, and `sdlc-config.json` is left byte-for-byte unchanged (no `targets` key added). **Given** `isNewTarget=true` and `--add-target` WAS passed **Then** the existing target(s) (migrated to `targets` array form via `resolveTargets` if the config was still flat) plus the newly-derived target are written under `config.targets`; the flat top-level fields continue to describe the newest target (steps 5-10 still act on the flat shape). **Given** `--add-target` and the derived target name already exists in `existingTargets` **Then** step 4 returns `fail` with a message naming the collision, and nothing is written. (Verified by install.test.ts "refuses to overwrite when the repo already configures a different target and --add-target is not passed", "--add-target appends a new target instead of overwriting the existing one", "--add-target refuses when a target with the same name already exists".)
- **Deprecated (2026-09-26) — first-time adoption is hard-refused.** The polyglot-monorepo `targets` mechanic is deprecated and scheduled for removal. **Given** `isNewTarget=true`, `--add-target` WAS passed, and the existing `sdlc-config.json` has **no real `targets` array** (`existing.targets` unset or empty — as opposed to `resolveTargets()`'s synthesized single-entry view of a flat config) **When** step 4 runs **Then** it returns status `fail` with the message `The polyglot-monorepo \`targets\` mechanic (--add-target) is deprecated and scheduled for removal — new consumers of this shape cannot be onboarded. Onboard each independently-gated stack as its own separate repo instead. See docs/onboarding.md#polyglot-monorepos-multiple-targets-in-one-repo--deprecated.` and nothing is written (`sdlc-config.json` untouched, no `targets` key added). This guard runs after the "--add-target not passed" refusal and **before** the same-name collision check. The append/migrate behaviour described above therefore now only applies to a repo that **already** has a non-empty `targets` array (currently one legacy consumer); the `--add-target` flag's own `--help` text is prefixed `DEPRECATED, scheduled for removal:`. (Verified by install.test.ts "--add-target refuses first-time adoption of the deprecated targets mechanic".)
- **Error paths:** As above — all three refusal cases are `status: 'fail'`, which propagates to a non-zero process exit like any other step-4 failure (REQ-CLI-INSTALL-008).
- **Fixtures/env:** A "polyglot fixture" — a node fixture whose existing `sdlc-config.json` already carries a one-entry `targets` array (`[{ name: 'default', working_directory: '.', … }]`) plus a nested `api/pyproject.toml` — drives detection into the unconfigured `api/` directory so `install.test.ts`'s polyglot cases exercise the mismatch path without mocking `detectStack`. A separate flat-config fixture (`buildFlatFixtureForAddTarget`, no `targets` key) exercises the deprecation refusal.

#### REQ-CLI-INSTALL-023 — `api_key_secret` collision avoidance across targets (#689/#694)

- **Priority:** Must — GitHub repo secrets are repo-scoped, not per-directory; an uncaught collision silently overwrites another target's CI credential. **Deprecation note (2026-09-26):** first-time adoption of the `targets` mechanic is now hard-refused (REQ-CLI-INSTALL-022); this requirement remains in force only for repos that already carry a non-empty `targets` array. The same collision scheme applies to the viewer-key secret name (`<SLUG>_VIEWER_API_KEY`, see REQ-CLI-INSTALL-027).
- **Source:** `cli/src/install/prompts.ts` (`apiKeySecretNameFor`, `existingApiKeySecretNames`)
- **Preconditions / inputs:** `--add-target` (interactive or non-interactive). `existingApiKeySecretNames` collects every already-claimed `devaudit.api_key_secret` name across `resolveTargets(existingConfig)`.
- **Given** a new target's derived secret name (`<SLUG>_API_KEY`, slug upper-cased with `-`→`_`) is not already claimed **When** the plan is built **Then** that name is used as-is. **Given** it IS already claimed by another target **Then** a numeric suffix is appended (`<SLUG>_API_KEY_2`, incrementing until free) rather than reusing the colliding name. **Given** a full `--add-target` run against a polyglot fixture **Then** the new target's `devaudit.api_key_secret` in the written config is truthy, is NOT the literal `DEVAUDIT_API_KEY` the first (default) target used, and the actual `gh secret set` call recorded by the provider uses that same disambiguated name — never `DEVAUDIT_API_KEY`. (Verified by install.test.ts "--add-target derives a distinct api_key_secret name instead of reusing the existing target's", "--add-target disambiguates when the derived api_key_secret name is already claimed".)
- **Error paths:** None — disambiguation always terminates (bounded by the number of existing targets); there is no "give up" case.
- **Fixtures/env:** Polyglot fixture; second variant pre-seeds a `targets` array whose other target has already claimed the name the new target would naturally derive, to force the disambiguation branch.

#### REQ-CLI-INSTALL-024 — Branch protection: per-target namespaced checks, read-merge-write union (#689/#695/#696)

- **Priority:** Must — extends REQ-CLI-INSTALL-013; a naive re-apply for a second target must not silently drop the first target's required checks. **Deprecation note (2026-09-26):** first-time adoption of the `targets` mechanic is now hard-refused (REQ-CLI-INSTALL-022); this requirement remains in force only for repos that already carry a non-empty `targets` array.
- **Source:** `cli/src/install/branch-protection.ts` (`configureBranchProtection`, per-target loop); `cli/src/lib/branch-protection-checks.ts` (`namespacedRequiredChecks`); `cli/src/lib/git-provider/github.ts` (`GitHubProvider.applyBranchProtection`, `currentRequiredChecks`, `unionRequiredChecks`)
- **Preconditions / inputs:** operator mode, not dry-run, GitHub provider resolved. `configureBranchProtection` iterates `resolveTargets(config)`; for each target it calls `provider.applyBranchProtection` once per branch (default branch + integration branch, when distinct) with that target's required-check names.
- **Given** exactly one target (single-target repo, the common case) **When** step 9 runs **Then** the required check names are unchanged from REQ-CLI-INSTALL-013 (`['Quality Gates']`, no suffix) — `namespacedRequiredChecks` is a no-op when `multiTarget` is false. **Given** two or more targets **Then** each target's required checks are suffixed `Quality Gates (<target.name>)`, and each `applyBranchProtection` call is preceded by a read of the branch's CURRENT required-check contexts (`GET .../protection/required_status_checks/contexts`, tolerating a 404/empty response as "no existing checks") which are unioned (order-preserving, deduped) with the checks this call is requesting before the PUT — so applying target B's checks does not remove target A's. **Given** a `--add-target` run against a polyglot fixture **Then** the recorded `applyBranchProtection` calls for `main` include both `['Quality Gates (default)']` and `['Quality Gates (api)']` as separate calls, each of whose actual PUT body (in the real provider) is the union with whatever the branch already required. (Verified by install.test.ts "--add-target applies namespaced branch-protection checks for every target"; git-provider.test.ts "applyBranchProtection unions with existing required checks instead of replacing them", "applyBranchProtection dedupes when the requested check is already required".)
- **Error paths:** Unchanged from REQ-CLI-INSTALL-013 per target — a failed `applyBranchProtection` call for one target is reported as `FAILED — <message>` in that target's result line but does not abort the loop for remaining targets; overall step status is `warn` if any target failed, `ok` only if all did.
- **Fixtures/env:** Fake provider recording `applyBranchProtection` calls by `(branch, checks)`; a second provider variant simulating an existing required-checks list to assert the union.

#### REQ-CLI-INSTALL-025 — Hook framework coexistence: husky (Node target) + pre-commit (Python target) in one repo (#689/#697)

- **Priority:** Should — extends REQ-CLI-INSTALL-012; only observable in a polyglot repo bootstrapping both frameworks. **Deprecation note (2026-09-26):** first-time adoption of the `targets` mechanic is now hard-refused (REQ-CLI-INSTALL-022); this requirement remains in force only for repos that already carry a non-empty `targets` array.
- **Source:** `cli/src/install/hooks-bootstrap.ts` (`bootstrapNode`, `bootstrapPython`, `ensurePreCommitDelegated`, `preCommitConfigured`, `PRE_COMMIT_DELEGATE_LINE`)
- **Preconditions / inputs:** Git only honours one hook file per hook type, resolved via a single repo-wide `core.hooksPath`; `npx husky init` unconditionally repoints it at `.husky/_`, which would silently stop a previously-installed native `pre-commit` hook from firing (and the reverse — `pre-commit install` after husky — would overwrite husky's shim outright) with no error either way.
- **Given** a Node target bootstraps husky (fresh `npx husky init`, or `.husky/` already present) **When** a `.pre-commit-config.yaml` is present at the repo root (a Python target already configured) **Then** the line `pre-commit run --hook-stage commit "$@"` is appended to `.husky/pre-commit` (once — idempotency-checked by exact substring match) so pre-commit's checks keep firing through husky's now-active hook; step 8 reports `ok` with a message noting the delegation. **Given** a Python target bootstraps pre-commit (`pre-commit install`) **When** `.husky/` already exists (a Node target already bootstrapped husky) **Then** the native `pre-commit install` for the `pre-commit` hook type is SKIPPED (it would clobber husky's shim) and the same delegate line is appended to `.husky/pre-commit` instead; `pre-commit install --hook-type commit-msg` still installs natively either way, since `commit-msg` is a distinct hook file husky doesn't create. **Given** neither framework has bootstrapped the other's config yet **Then** behaviour is unchanged from REQ-CLI-INSTALL-012 (no delegate line, no coexistence logic triggered). (Verified by hooks-bootstrap.test.ts "Node target: no pre-commit config present — bootstraps husky as before, no delegate line", "Node target bootstrapping after Python: delegates pre-commit into the freshly-bootstrapped .husky/pre-commit", "Python target: husky not present — installs pre-commit natively as before", "Python target bootstrapping after Node: delegates into .husky/pre-commit instead of clobbering it, still installs commit-msg natively", "delegate append is idempotent — running twice does not duplicate the line".)
- **Error paths:** Unchanged from REQ-CLI-INSTALL-012 — `npx`/`pre-commit` absent from PATH still produces the same `warn` outcomes; the coexistence check runs only on the success path.
- **Fixtures/env:** Fixtures with `.husky/` and/or `.pre-commit-config.yaml` pre-seeded in different orders; assert `.husky/pre-commit` file content and which `execa` calls fired.

#### REQ-CLI-JOIN-001 — `join` command registration and developer-mode pin

- **Priority:** Must — the explicit second-developer entry point.
- **Source:** `cli/src/index.ts` (`program.command('join [path]')`); `cli/src/commands/join.ts` (`runJoinCommand`, `JoinOptions`)
- **Preconditions / inputs:** `devaudit join [path]` with options `--token`, `--base-url`, and globals `--dry-run`, `-y/--yes`. `runJoinCommand` resolves `projectPath` (path or cwd), then calls `runInstall({ mode: 'developer', … })`.
- **Given** `devaudit join --help` **Then** stdout describes it as the second-developer entry point that "Skips the operator-only steps (sdlc-config write, API key issuance, GitHub secret writes, branch protection)"; exit 0. **When** `devaudit join` runs on an onboarded repo **Then** `runInstall` is invoked with `mode:'developer'` pinned regardless of detection bits.
- **Error paths:** Errors from `runInstall` caught → `log.error` + `process.exit(1)`.
- **Fixtures/env:** Fixture with `sdlc-config.json`; assert `runInstall` receives `mode:'developer'`.

#### REQ-CLI-JOIN-002 — `join` pre-flight: refuses when sdlc-config.json is absent (exit 7)

- **Priority:** Must — guards against joining a non-onboarded project.
- **Source:** `cli/src/commands/join.ts` (`runJoinCommand`, `isFile` guard, `process.exit(7)`)
- **Preconditions / inputs:** `sdlc-config.json` absent at `projectPath`.
- **Given** a project directory WITHOUT `sdlc-config.json` **When** `devaudit join` **Then** stderr prints `No sdlc-config.json at <path>. This project hasn't been onboarded yet — the project operator should run \`devaudit install\`. See SDLC/joining-an-existing-project.md …`and the process exits with code **7** (distinct from the generic 1);`runInstall` is never entered and no portal/provider calls fire. (Verified by join.test.ts "exits 7 when sdlc-config.json is absent".)
- **Error paths:** This IS the error path (exit 7). All other half-onboarded states (missing portal project / key / secret) are NOT caught here — they route inside `runInstall`'s mode detection.
- **Fixtures/env:** Empty temp dir (no `sdlc-config.json`); spy on `process.exit` asserting code 7 and zero provider calls.

#### REQ-CLI-JOIN-003 — `join` runs developer-mode flow: skips 4/6/7/9, runs 8/10, prints developer done report

- **Priority:** Must — defines the on-disk + network footprint of a join.
- **Source:** `cli/src/install/index.ts` (`detectInstallMode` `mode==='developer'` branch); skip branches in steps 4/6/7/9; `done-report.ts` developer branch
- **Preconditions / inputs:** `mode:'developer'` pinned by join; `sdlc-config.json` present. Detection bits are NOT consulted (pinned overrides auto-detect) — works even if the portal returns no project.
- **Given** `devaudit join` on an onboarded repo **When** it runs **Then** `log.info` prints `mode=developer (pinned): destructive steps will skip — use \`devaudit install --force-team-config\` … if you need to rotate team secrets.`; steps 4/6/7/9/10 are `skipped`(existing`sdlc-config.json`untouched, no key issuance, no`setSecret`/`setVariable`, no branch protection); steps 1/2/3 run, step 8 bootstraps hooks, step 11 re-syncs templates; the done report is `12/12 Done (developer mode)` listing the re-synced templates + bootstrapped hooks and the deliberately-skipped team items; exit 0. (Verified by install.test.ts "mode: developer (pinned, the join code path)".)
- **Error paths:** An invalid PAT (step 1) or undetectable stack (step 2) still exits 1 — join does not bypass those gates. A filesystem/sync failure in step 10 exits 1.
- **Fixtures/env:** Fixture with `sdlc-config.json` + `package.json`; msw returning empty project list; assert no `setSecret` and step 7/9 `skipped`.

#### REQ-CLI-JOIN-004 — `join --dry-run` and `join -y` propagation

- **Priority:** Should — flag plumbing for the join lane.
- **Source:** `cli/src/index.ts` (join action `optsWithGlobals`); `cli/src/commands/join.ts` (maps `dryRun`, `nonInteractive`)
- **Preconditions / inputs:** `--dry-run` and/or `-y` globals on `devaudit join`.
- **Given** `devaudit join --dry-run` on an onboarded repo **When** it runs **Then** the pre-flight `sdlc-config.json` check still applies (exit 7 if absent), the banner shows `DRY RUN`, and the developer-mode flow reports `planned`/`skipped` steps with no mutations. **Given** `devaudit join -y` **Then** `nonInteractive=true` is forwarded so step 3 reads config without prompting.
- **Error paths:** Same exit-7 pre-flight as REQ-CLI-JOIN-002.
- **Fixtures/env:** Onboarded fixture; assert no disk/network mutation under `--dry-run` and no prompt under `-y`.

#### REQ-CLI-UNINSTALL-001 — `uninstall` revokes the project's active API key(s), no-ops cleanly if the portal project is already gone

- **Priority:** Must — the counterpart to install's key issuance (REQ-CLI-INSTALL step 6); devaudit-installer#778.
- **Source:** `cli/src/uninstall/index.ts` (`revokeApiKeyStep`), `cli/src/lib/devaudit-api.ts` (`DevAuditClient.revokeApiKey`, `getProjectBySlug`, `listApiKeys`)
- **Preconditions / inputs:** A resolved target with a `devaudit.project_slug`; a valid user token.
- **Given** `devaudit uninstall` on a repo whose project still exists on the portal **When** it runs **Then** every API key with `revoked_at: null` for that project is revoked via `DELETE /api/projects/{id}/api-keys/{keyId}`, and the step reports `ok` with the count revoked. **Given** the project no longer exists on the portal (e.g. deleted via the Portal's Danger Zone, metasession-dev/devaudit#827, which cascades its keys) **Then** `getProjectBySlug` returns `null` and the step reports `ok` with a "already revoked" message — not an error.
- **Error paths:** A portal error other than "not found" (e.g. 401/403/5xx) surfaces as `warn`, not a hard failure — the remaining uninstall steps (secret/variable deletion, config removal) still run.
- **Fixtures/env:** MSW mock of `/api/projects` and `/api/projects/:id/api-keys`; scenarios both with and without the project present.

#### REQ-CLI-UNINSTALL-002 — `uninstall` deletes the GitHub secrets/variables `install` wrote

- **Priority:** Must — leaves no dangling credentials in the disconnected repo.
- **Source:** `cli/src/uninstall/index.ts` (`deleteSecretsStep`), `cli/src/lib/git-provider/github.ts` (`deleteSecret`, `deleteVariable`), `cli/src/lib/git-provider/types.ts`
- **Preconditions / inputs:** A resolved `GitProvider` (or none, in which case the step is `skipped`).
- **Given** a resolvable git provider **When** the step runs **Then** it deletes the target's `devaudit.api_key_secret` (or `DEVAUDIT_API_KEY` if unset), `DEVAUDIT_USER_TOKEN` (a no-op-safe cleanup since devaudit-installer#912: `install` no longer writes this secret, but repos onboarded before #912 may still carry a stale copy, and deleting an absent secret is already treated as success — so the deletion is intentionally kept), the `production_url_secret` if the target has one, and the `DEVAUDIT_BASE_URL` variable — via `gh secret delete`/`gh variable delete` when the `gh` CLI is available, else a REST `DELETE` against `/actions/secrets/{name}`/`/actions/variables/{name}`. Deleting an already-absent secret/variable is a success, not an error (gh's non-zero exit and REST's `404` are both treated as the goal state already holding).
- **Current-behaviour gap (flagged, not fixed; since #1099 `install` writes no viewer-key repo secret, so only a project onboarded earlier is affected):** the target's `devaudit.viewer_api_key_secret` (REQ-CLI-INSTALL-027) is **not** in the deletion list — `deleteSecretsStep` only deletes the uploader-key secret, `DEVAUDIT_USER_TOKEN`, and the prod-URL secret — so an uninstalled repo that opted into a viewer key keeps that secret. The portal-side key itself is still revoked by REQ-CLI-UNINSTALL-001 (it revokes every live key on the project), so the leftover secret holds a dead credential rather than a live one.
- **Error paths:** No `gh` CLI and no `GH_TOKEN`/`GITHUB_TOKEN` → throws (surfaces as the step failing) rather than silently skipping, since that's a real capability gap, not "already deleted." No git provider resolvable at all (e.g. no `origin` remote) → the whole step is `skipped`, matching install's own provider-unavailable handling.
- **Fixtures/env:** `git-provider.test.ts` covers `deleteSecret`/`deleteVariable` for both the gh-CLI and REST-fallback paths, including the already-gone case; `uninstall.test.ts` asserts the fake provider receives the expected secret/variable names.

#### REQ-CLI-UNINSTALL-003 — `uninstall` removes the target from sdlc-config.json

- **Priority:** Must — the write-side counterpart to `writeSdlcConfig` (REQ-CLI-INSTALL step 4).
- **Source:** `cli/src/install/write-config.ts` (`removeSdlcConfigTarget`), `cli/src/uninstall/index.ts` (`removeConfigStep`)
- **Preconditions / inputs:** A resolved target name matching an entry in `resolveTargets(config)`.
- **Given** the target being removed is the only one **When** the step runs **Then** `sdlc-config.json` is deleted entirely. **Given** exactly one target remains after removal **Then** the file is rewritten collapsed back to the legacy flat single-target shape (`targets` dropped, top-level `stack`/`working_directory`/`source_dirs`/`production_url_secret`/`e2e_port`/`devaudit`/`project_slug` set from the remaining target). **Given** more than one target remains **Then** the `targets` array is rewritten with just that entry dropped, all other fields untouched.
- **Error paths:** No `sdlc-config.json` at the repo root → `runUninstall` throws before reaching this step ("nothing to uninstall"). Target name not found in the config (already removed) → step reports `warn`, not a hard failure.
- **Fixtures/env:** `write-config.test.ts` covers all three shapes (delete file / collapse to flat / drop from `targets[]`) plus the no-match and no-file no-ops.

#### REQ-CLI-UNINSTALL-004 — `uninstall --target` selection and multi-target ambiguity error

- **Priority:** Should — polyglot-monorepo (#689) disambiguation, mirroring install's `--add-target`.
- **Source:** `cli/src/uninstall/index.ts` (`selectTarget`), `cli/src/index.ts` (`uninstall` command's `--target` option)
- **Preconditions / inputs:** `sdlc-config.json` with either an implicit single target or an explicit `targets` array.
- **Given** a single-target config **When** `uninstall` runs with no `--target` **Then** that one target is selected automatically. **Given** a multi-target config **When** `uninstall --target <name>` is passed, matching either a target's `name` or its `devaudit.project_slug` **Then** that target is selected and the others are left untouched in `sdlc-config.json`.
- **Error paths:** Multi-target config with no `--target` passed → throws listing the available target names, asking the operator to pick one; never guesses. `--target <name>` matching nothing → throws listing what IS available.
- **Fixtures/env:** `uninstall.test.ts` "--target selects among multiple configured targets" and "errors asking for --target when multiple targets exist and none is specified".

#### Assumptions — Install/Join

- The done-report "What ran" copy lists `.husky/` and template re-sync; whether step 8/10 actually mutate in developer mode depends on the same `ctx.dryRun` guards as operator mode (steps 8 and 10 have no `installMode` skip branch, so they run in developer mode unless dry-run). Treated as intended.
- `git remote` resolution (provider detection) happens lazily via `resolveProvider`/`detectProvider`; a repo with NO `origin` remote yields `provider: null` and a clean `reason` string, so steps 7 and 9 are recorded `skipped` (not a hard failure) while steps 4/5/6/8/10 still run. The task's "not a git repo" error path therefore manifests as skipped GH steps, not a non-zero exit, in the default `runInstall` engine. Confirmed from `index.ts` `resolveProvider` catch + the skipped-step branches.
- The task mentions a "dirty tree" error path; no working-tree cleanliness check exists anywhere in the install/join flow (no `git status --porcelain` gate). Assumed there is no dirty-tree precondition — install will run over uncommitted changes and the done report simply instructs the operator to `git status`/`git add -A`. Flagged as a possible spec gap rather than implemented behaviour.
- `prodUrlValue` is always collected as a prompt (or `''` in `-y`); it is never persisted to `sdlc-config.json`, only used transiently in step 7 to optionally set the `<prodUrlSecretName>` repo secret. So the production URL secret is only written when an operator typed a value at the interactive prompt — unobservable in headless `-y` runs.
- The `--org <slug>` global flag is registered in `applyCommonFlags` but is not read anywhere in the install/join code paths; treated as a no-op for this area.

### Commands: update, status, doctor, bootstrap-governance

Scope: black-box, externally-observable behaviour of the four `devaudit` subcommands `update [version] [paths...]`, `status [path]`, `doctor`, and `bootstrap-governance [path]`. Each requirement is expressed purely in terms of inputs the operator controls (the command line, the consumer repo on disk, and environment variables) and outputs that can be observed from outside the process: stdout/stderr text, the process exit code, filesystem deltas under the consumer project (files created / overwritten / preserved / removed), and any network calls. No internal data structures or private function contracts are asserted beyond what is reachable through these surfaces. Sources are the real CLI under `cli/src/` and the bundled framework templates under `sdlc/files/`; ground-truth behaviour is cross-checked against `cli/test/update.test.ts`, `cli/test/status.test.ts`, and `cli/test/doctor.test.ts`.

Command registration: `cli/src/index.ts` (`main`). Installer-root / template-source resolution: `cli/src/lib/installer-root.ts` (`resolveInstallerRoot`) — priority order is (1) `DEVAUDIT_INSTALLER_ROOT` env override, (2) the npm package's bundled `sdlc/` snapshot, (3) the DevAudit-Installer repo root; the sentinel is the presence of `sdlc/files`. Global flags applied to every command (`cli/src/index.ts`, `applyCommonFlags`): `--json`, `-y/--yes`, `--dry-run`, `-v/--verbose`, `--no-color`, `--org <slug>`.
- **Update (#1099 WP3):** step 7 no longer writes a viewer-key repo secret (REQ-CLI-INSTALL-027): no CI workflow reads one. Only the uploader key, the production-URL secret and the `DEVAUDIT_BASE_URL` variable are written.
- **Update (#1099 WP3):** `join` issues the teammate's own viewer key with their PAT and saves it locally (REQ-CLI-INSTALL-027), also in developer mode; it does not touch the team uploader key. A 403 prints "ask a project admin, or rerun after the portal update" and the join continues.
- **Update (#1099 WP3):** before the project's keys are revoked, `uninstall` revokes the person's own viewer key (found by the name saved with it) and removes its entry from `viewer-keys.json`, even when the portal cannot be reached. Other projects' entries and other people's keys are left alone. `--dry-run` reports it as `planned`.

---

#### REQ-CLI-UPDATE-001 — Sync framework templates into one consumer and report a summary, leaving the tree dirty

- **Priority:** Must — core purpose of `update`; this is the canonical template-sync path (the former `scripts/sync-sdlc.sh` was removed).
- **Source:** `cli/src/commands/update.ts` (`runUpdate`); `cli/src/update/index.ts` (`syncAll`, `syncProject`)
- **Preconditions / inputs:** A consumer directory that exists and (normally) contains `sdlc-config.json`. CLI invoked as `devaudit update <version> <path>` (or with the path defaulting to `.`). `DEVAUDIT_INSTALLER_ROOT` (or a bundled snapshot) must resolve to a tree containing `sdlc/files`.
- **Given** a valid consumer at `<path>` **When** `devaudit update v1.2.3 <path>` **Then** stdout/stderr shows `--- Syncing to: <projectName> (<absPath>) ---`, `Stack: <stack> | Host: <host>`, one line per section (`[2a] _common docs`, `[2b] AI rule pointers + INSTRUCTIONS.md`, `[2c] <stack> hooks`, `[2c-ii] <stack> deps`, `[2d] scripts`, `[2e] Issue templates`, `[2e-ii] Claude Code skills`, `[2e-iii] E2E evidence helper`, `[2f] CI workflows`, `[2g] .gitignore sentinels`, `[2h] SDLC CLI engine`, `[2i] .devin/workflows`, `[2j] consumer patches`, `[2j-i] default branch`, `[2k] branch protection`, `[2l] format synced files`, `[2n] sync manifest`), a `Total: N files synced` line (2l and 2n are excluded from the total — 2l reformats files sections above already wrote, per REQ-CLI-UPDATE-011's note below, and 2n only records hashes, it writes no consumer-facing file), a `--- Validation ---` block, then `=== Sync Complete ===` and the "Next steps" block ending with `Do NOT auto-commit — review the changes first.`; **exit 0**; framework files not currently in conflict are written/overwritten under `<path>` (see per-section reqs and REQ-CLI-UPDATE-030 for the conflict-preserving exception); `sdlc-config.json`'s `devaudit_synced_version` is stamped last before the manifest (2m, then 2n, both outside the section loop — see REQ-CLI-UPDATE-028/029); **no git commit is made** (tree left dirty for operator review); **no network calls** in the base sync path (except the manifest **bootstrap**'s one-time `npx`, REQ-CLI-UPDATE-032, only when no manifest exists yet).
- **Error paths:** Path not a directory → `syncProject` throws `Project path not found: <absPath>`, `syncAll` logs `ERROR syncing <p>: …` and rethrows; the top-level handler in `index.ts` prints the message and exits **1**. Unresolvable installer root → `resolveInstallerRoot` throws `Could not locate the SDLC templates (sdlc/files)…` → exit **1**.
- **Fixtures/env:** Temp consumer with `sdlc-config.json` (`project_slug`, `stack:"node"`, `host:"railway"`, plus CI keys), a `package.json` with all node dev-deps present, and pre-created `.husky/`, `scripts/`, `.github/workflows/` dirs (mirrors `buildFixture` in `cli/test/update.test.ts`). `DEVAUDIT_INSTALLER_ROOT` pointed at the repo root.

#### REQ-CLI-UPDATE-002 — Idempotency: re-running yields the same synced-file count and no errors

- **Priority:** Must — re-running must not drift or error; templates are regenerated deterministically.
- **Source:** `cli/src/update/index.ts` (`syncProject`); ground-truth `cli/test/update.test.ts` ("is idempotent — re-running produces no errors and same file count")
- **Preconditions / inputs:** As REQ-CLI-UPDATE-001; run the same `devaudit update` against the same consumer twice.
- **Given** a consumer already synced once, with nothing hand-edited since **When** `devaudit update` is run a second time with the same inputs **Then** it completes with **exit 0**, and `totalFilesSynced` of the second run equals the first — `writeManaged` (devaudit-installer#930) classifies every unchanged file as unmodified relative to `.devaudit/sync-manifest.json` and overwrites it silently, same as before the manifest existed. Regenerated content is byte-stable for unchanged config (token/block substitution is deterministic; CI step builders emit identical output when `e2e_env`/`e2e_setup_command`/`e2e_projects`/`e2e_seed_command` are absent — see `cli/test/update.test.ts` "Backward compat" assertions).
- **Given** a file was hand-edited between the two runs **Then** idempotency changes shape, not outcome: the second run reports it as an unresolved conflict (`conflict: true` in the manifest) both times, rather than silently re-overwriting it — see REQ-CLI-UPDATE-030.
- **Error paths:** None specific.
- **Fixtures/env:** Same fixture as REQ-CLI-UPDATE-001. `cli/test/sync-manifest.test.ts` covers the conflict-preserving case.

#### REQ-CLI-UPDATE-003 — Stage docs (`_common/*.md`) sync into `SDLC/`

- **Priority:** Must — Tier-1 docs and stage guides are the spine of the framework.
- **Source:** `cli/src/update/stage-docs.ts` (`syncStageDocs`)
- **Preconditions / inputs:** `sdlc/files/_common/*.md` present in installer root.
- **Given** the consumer **When** update runs **Then** `<path>/SDLC/` is created if missing and every `*.md` under `sdlc/files/_common/` is written via `writeManaged` (devaudit-installer#930 — silently overwritten if unmodified since the last sync, preserved as a conflict otherwise), e.g. `SDLC/0-project-setup.md`, `SDLC/Test_Policy.md`; section line reports `[2a] _common docs: <N> file(s) — synced to SDLC/` (a file in conflict doesn't count toward `<N>`).
- **Error paths:** None (missing source dir → `listFiles` returns empty → 0 files).
- **Fixtures/env:** As REQ-CLI-UPDATE-001.

#### REQ-CLI-UPDATE-004 — AI rule files: pointer files overwritten, CLAUDE.md/INSTRUCTIONS.md merged

- **Priority:** Must — single-source-of-truth wiring for AI assistants; selective preservation matters.
- **Source:** `cli/src/update/ai-rules.ts` (`syncAiRules`, `writePointerFile`, `updateClaudeFile`, `updateInstructionsFile`)
- **Preconditions / inputs:** `sdlc/ai-rules/INSTRUCTIONS-SDLC.md` present.
- **Given** the consumer **When** update runs **Then**: `.cursorrules`, `.windsurfrules`, `GEMINI.md`, `AGENTS.md` are each written via `writeManaged` (devaudit-installer#930) to fixed pointer content referencing `INSTRUCTIONS.md` — silently overwritten if unmodified, preserved as a conflict if hand-edited since the last sync. `CLAUDE.md`: if absent, created from `CLAUDE_NEW`; if present, the project header is preserved, any prior `## SDLC Compliance Process (MANDATORY)` section is stripped, and the pointer tail is appended only if `INSTRUCTIONS.md` not already referenced. `INSTRUCTIONS.md`: if absent, created with a SoT header + the SDLC content; if present, the project section before `## SDLC Compliance Process (MANDATORY)` is preserved and the SDLC content is appended/replaced. Section line reports `[2b] … 6 file(s) — synced`. **Corrected 2026-09-30 (#931 docs audit):** this REQ previously listed 3 pointer files and "5 file(s)" total — `AGENTS.md` was added as a fourth pointer file since, bringing the total to 4 pointer files + `CLAUDE.md` + `INSTRUCTIONS.md` = 6, and the REQ text was never updated.
- **Error paths:** `INSTRUCTIONS-SDLC.md` missing → section SKIPPED with message `INSTRUCTIONS-SDLC.md not found`, 0 files (non-fatal).
- **Fixtures/env:** As REQ-CLI-UPDATE-001; verifies all six files contain `INSTRUCTIONS.md` and INSTRUCTIONS.md contains `SDLC Compliance Process`.

#### REQ-CLI-UPDATE-005 — Stack hooks + hook config files (host-conditioned via stack adapter)

- **Priority:** Should — depends on the consumer already having bootstrapped the hook framework dir.
- **Source:** `cli/src/update/stack-hooks.ts` (`syncStackHooks`); adapter via `cli/src/lib/adapter.ts` (`loadStackAdapter`)
- **Preconditions / inputs:** Stack adapter declares `hook_install_dir` (e.g. `.husky`), `hooks` (e.g. `commit-msg`, `pre-commit`, `pre-push`), `hook_config_files` (e.g. `commitlint.config.mjs`, `lint-staged.config.mjs`, `.prettierrc.json`). The consumer's `<hook_install_dir>/` must already exist.
- **Given** a consumer with `.husky/` present **When** update runs **Then** each adapter hook present in `sdlc/files/stacks/<stack>/hooks/` is written via `writeManaged` (devaudit-installer#930) to `<hookDir>/<hook>` mode 0755, and each `hook_config_files` entry is written the same way to the repo root — silently overwritten if unmodified, preserved as a conflict otherwise; section reports `[2c] node hooks: <N> file(s) — synced to .husky/`.
- **Error paths:** No `hook_install_dir` declared → SKIPPED (`no hook_install_dir declared`). Install dir absent → SKIPPED (`<dir>/ not found — bootstrap hook framework first`). Stack has no `hooks/` → SKIPPED (`stack has no hooks/`).
- **Fixtures/env:** Fixture pre-creates `.husky/`; test asserts `commit-msg`, `pre-commit`, `pre-push`, and the three root config files exist.

#### REQ-CLI-UPDATE-006 — Stack dev-dependency install + Playwright postinstall injection (node only)

- **Priority:** Should — convenience; only fires when deps are actually missing or postinstall is absent.
- **Source:** `cli/src/update/stack-deps.ts` (`syncStackDeps`, `ensurePostinstallScript`)
- **Preconditions / inputs:** `stack === 'node'`, a `package.json` present, adapter's `required_dev_dependencies` non-empty.
- **Given** a node consumer whose `package.json` already lists every required dev-dep **When** update runs **Then** **no subprocess runs**; section reports `[2c-ii] node deps … all present` (0 files). **Given** missing deps **Then** runs `npm install --save-dev <missing…>` (stdio inherited) in the consumer dir; on failure retries with `--legacy-peer-deps`; success reports the installed list (with a `(with --legacy-peer-deps)` note on the retry path). **Network:** `npm install` reaches the npm registry only when deps are missing.
- **Postinstall injection (#245):** After the dep check (whether deps were missing or all present), if `@playwright/test` is in the adapter's `required_dev_dependencies`, the section also calls `ensurePostinstallScript` which reads the consumer's `package.json` and checks `scripts.postinstall`: (a) if already `"playwright install chromium"` → no-op; (b) if absent → adds `"postinstall": "playwright install chromium"` and writes the file; (c) if present but doesn't mention `playwright install` → logs a warning and does **not** overwrite. The section message includes `, added postinstall` when the script was added. This ensures `npm ci` in the consumer repo auto-installs Chromium browsers without a separate `npx playwright install` step.
- **Error paths:** Both npm attempts fail → throws `Failed to install node deps. Fix manually: cd <path> && npm install --save-dev <missing>` → `syncAll` rethrows → exit **1**. Non-node stack → SKIPPED. No `package.json` → SKIPPED (`no package.json`). Existing postinstall without playwright → warning, continue (no overwrite).
- **Fixtures/env:** Fixture lists all node dev-deps so the test path is "all present" (no network). Separate fixture with `@playwright/test` in deps but no `postinstall` script → assert script added. Fixture with existing `postinstall` mentioning playwright → no-op. Fixture with existing `postinstall` not mentioning playwright → warning, no overwrite.

#### REQ-CLI-UPDATE-007 — Scripts merged into `scripts/` (common + stack + upload-evidence.sh), executable

- **Priority:** Should — operational helpers; gated on a pre-existing `scripts/` dir.
- **Source:** `cli/src/update/scripts.ts` (`syncScripts`)
- **Preconditions / inputs:** Consumer has a `scripts/` directory.
- **Given** a consumer with `scripts/` **When** update runs **Then** writes (via `writeManaged`, devaudit-installer#930 — silently overwritten if unmodified, preserved as a conflict otherwise) `_common/scripts/*.sh` (excluding `*.test.sh`; `upload-evidence.sh` included — devaudit-installer#1082 removed the stale repo-root copy that used to supersede it, so the synced script is byte-identical to the tested one) mode 0755 and the adapter's `stack_scripts` from `stacks/<stack>/scripts/` mode 0755; section reports `[2d] scripts: <N> file(s) — synced to scripts/`. Observable deltas include `scripts/upload-evidence.sh` and `scripts/validate-compliance-artifacts.sh`.
- **Given** a top-level file in `scripts/` that this sync did not write and that the manifest records under section `2d` (a script an earlier sync wrote and upstream no longer ships, e.g. `reconcile-railway-deployment.sh` after #1022) **Then** it is removed through `removeManaged`: deleted if unmodified, kept and reported as a stale-modified conflict if edited. Files the manifest does not track, and entries known only from the first-sync bootstrap baseline (section `bootstrap`, which covers the whole directory including consumer-owned scripts), are never removed (#1024).
- **Error paths:** No `scripts/` dir → SKIPPED (`scripts/ not found`).
- **Fixtures/env:** Fixture pre-creates `scripts/`; test asserts `upload-evidence.sh` and `validate-compliance-artifacts.sh` exist. `cli/test/sync-manifest.test.ts` ("a script upstream stopped shipping is removed; consumer-owned and bootstrap-only scripts are kept").

#### REQ-CLI-UPDATE-008 — GitHub issue templates synced to `.github/ISSUE_TEMPLATE/`

- **Priority:** Could — supporting metadata.
- **Source:** `cli/src/update/issue-templates.ts` (`syncIssueTemplates`)
- **Preconditions / inputs:** `sdlc/files/_common/github/ISSUE_TEMPLATE/` exists in installer root.
- **Given** the consumer **When** update runs **Then** `.github/ISSUE_TEMPLATE/` is created and each `*.yml` is written via `writeManaged` (devaudit-installer#930 — silently overwritten if unmodified, preserved as a conflict otherwise); reports `[2e] Issue templates: <N> file(s) — synced to .github/ISSUE_TEMPLATE/`.
- **Error paths:** Source dir absent → SKIPPED (0 files).
- **Fixtures/env:** As REQ-CLI-UPDATE-001.

#### REQ-CLI-UPDATE-009 — Claude Code skills synced per-file into `.claude/skills/`, manifest-driven

- **Priority:** Should — stale skill artifacts must not accumulate, but a consumer's own file inside a skill directory must survive.
- **Source:** `cli/src/update/skills.ts` (`syncSkills`); `cli/src/update/write-managed.ts` (`syncDirManaged`, `removeStaleUnderManaged`)
- **Preconditions / inputs:** Skills under `sdlc/files/_common/skills/<name>/` and/or `sdlc/files/stacks/<stack>/skills/<name>/`.
- **Given** the consumer **When** update runs **Then** `.claude/skills/` is ensured; for each skill dir (skipping names starting with `_`) every upstream file is written individually via `writeManaged` (`syncDirManaged`, recursive) — silently overwritten if unmodified since the last sync, preserved as a conflict if hand-edited. **Corrected 2026-09-30 (#930):** this REQ previously documented an unconditional `rm -rf` + recopy (`copyDir(clean=true)`) — that deleted *any* file inside a managed skill directory the consumer had added, on every single sync. A stale file upstream no longer ships is now removed only if it's unmodified since the last sync (`removeStaleUnderManaged`); a consumer-added file with no upstream counterpart is never touched at all, because devaudit has no manifest/baseline record of ever writing it. Reports `[2e-ii] … <N> synced to .claude/skills/`, with a `removed <N> stale file(s)` suffix when applicable. Zero skills found → SKIPPED.
- **Error paths:** None fatal.
- **Fixtures/env:** As REQ-CLI-UPDATE-001. `cli/test/sync-manifest.test.ts`'s "a consumer-added file inside .claude/skills/<name>/ survives every sync" is the regression test for the pre-#930 behaviour this REQ used to describe.

#### REQ-CLI-UPDATE-010 — E2E evidence helper (node only) into `e2e/helpers/`

- **Priority:** Could — node-stack-only; required for tsc on the consumer side.
- **Source:** `cli/src/update/evidence-helper.ts` (`syncEvidenceHelper`)
- **Preconditions / inputs:** `stack === 'node'`; source files `evidence.ts` + `evidence-shot-core.ts` under the `e2e-test-engineer` skill's `references/`.
- **Given** a node consumer **When** update runs **Then** `e2e/helpers/evidence.ts`, `evidence-shot-core.ts`, and `test-tags.ts` are each written via `writeManaged` (devaudit-installer#930 — silently overwritten if unmodified, preserved as a conflict otherwise); reports synced count with any `missing:` note. Non-node stack → SKIPPED. No sources → SKIPPED.
- **Error paths:** None fatal (missing files reported in message).
- **Fixtures/env:** Test asserts both helper files exist.

#### REQ-CLI-UPDATE-011 — CI workflows generated from templates with token + block substitution

- **Priority:** Must — the compliance gates are produced here; correctness of substitution is load-bearing.
- **Source:** `cli/src/update/ci-templates.ts` (`syncCiTemplates`); `cli/src/lib/templates.ts` (`substituteTokens`, `substituteBlocks`, `stripServicesBlock`)
- **Preconditions / inputs:** Consumer has `sdlc-config.json` AND `.github/workflows/`. Config supplies `project_slug`, `production_url_secret`, `runner`, `source_dirs`, `sast_baseline`, `accepted_dep_risks`, `database_*`, `e2e_*`, optional `node_version`/`python_version`/`working_directory`/`paths_ignore`/`*_env`.
- **Given** a configured consumer **When** update runs **Then** for each template in the fixed list (`ci.yml`, `ci-status-fallback.yml`, `compliance-validation.yml`, `check-release-approval.yml`, `post-deploy-prod.yml`, `compliance-evidence.yml`, `close-out-release.yml`, `close-out-reconcile.yml`, `periodic-review.yml`, `incident-export.yml`) a stack-specific template (`ci/<stack>/<tmpl>`) is preferred over the default (`ci/<tmpl>`); the output drops `.template`, all `{{TOKEN}}` scalars and `{{BLOCK}}` lines are substituted, and the `services:` block is stripped when `database_service` is empty; the rendered content is written via `writeManaged` (devaudit-installer#930), silently if unmodified since the last sync, preserved as a conflict otherwise (REQ-CLI-UPDATE-030). The old workflows `test-on-pr.yml` and `check-uat-approval.yml` are **removed** via `removeManaged` if present (see REQ-FRAMEWORK-RENDER-006 for the three further conditional removal sweeps in this same section). Observable: `.github/workflows/ci.yml` contains the slug and no residual `{{…}}`; `periodic-review.yml` and `incident-export.yml` exist; `compliance-evidence.yml` references `/api/ci/projects/<slug>/audit-log/export`. Reports `[2f] CI workflows: <N> generated`.
- **Corrected 2026-09-30 (devaudit-installer#930): the post-hoc drift-warning mechanism this REQ used to document (#758/#766, `cli/src/update/drift-warning.ts`) was removed.** It captured a file's pre-overwrite content, then re-compared post-format, warning (but still overwriting) when a `.devaudit-patches`-uncovered local edit was about to be silently clobbered — and existed only for section 2f, via `driftCandidates`, with no other section covered. The sync manifest supersedes it with a strictly stronger guarantee: a locally-modified file covered by `writeManaged` is never overwritten at all (REQ-CLI-UPDATE-030), across every managed section, not warned-about-then-overwritten for CI templates alone.
- **Error paths:** No `sdlc-config.json` → SKIPPED (`no sdlc-config.json`). No `.github/workflows/` → SKIPPED (`.github/workflows/ not found`). A template missing from both stack and default location → silently skipped (not counted).
- **Fixtures/env:** Fixture asserts no `{{PROJECT_SLUG}}`/`{{NODE_VERSION}}` remain, backward-compat E2E tokens dropped, cron/governance lines present. `cli/test/sync-manifest.test.ts` covers the conflict-preserving behavior that replaced drift-warning's overwrite-and-warn shape.

#### REQ-CLI-UPDATE-012 — Optional E2E steps render only when configured (deterministic backward-compat)

- **Priority:** Could — opt-in CI elaboration; default output must be byte-identical to pre-feature.
- **Source:** `cli/src/update/ci-templates.ts` (`buildE2eSetupStep`, `buildE2eDevServerStep`, `buildE2eTestStep`, `buildAuthenticatedE2eStep`)
- **Preconditions / inputs:** `e2e_setup_command`, `e2e_env`, `e2e_projects`, `e2e_seed_command` in config.
- **Given** none of those keys set **When** update runs **Then** no `E2E setup` / `Authenticated E2E` steps render, dev-server + E2E steps carry no extra env, and `ci.yml` contains `- name: Start dev server\n        run: <cmd> &`. **Given** `e2e_setup_command`/`e2e_env` set **Then** a `run: |` setup block and threaded `env:` appear on the dev-server and blocking E2E steps. **Given** `e2e_projects`/`e2e_seed_command` set **Then** report-only `continue-on-error: true` seed + authenticated-E2E steps are injected after the blocking smoke gate (writing `e2e-auth-results.json`).
- **Error paths:** None.
- **Fixtures/env:** `cli/test/update.test.ts` covers all three permutations.

#### REQ-CLI-UPDATE-013 — Post-sync validation surfaces non-fatal warnings

- **Priority:** Should — advisory; never gates the sync.
- **Source:** `cli/src/update/validation.ts` (`runValidation`); `cli/src/update/index.ts`
- **Preconditions / inputs:** Synced consumer with `.github/workflows/` and/or `SDLC/`.
- **Given** a synced consumer **When** validation runs **Then** stdout shows `All validation checks passed` or one `WARN` per issue: dead `event_name == pull_request` conditions in push-only workflows, package.json-based version usage, runtime downloads from `raw.githubusercontent.com/metasession-dev/devaudit`, and missing Tier-1 docs (`SDLC/Test_Policy.md`, `Test_Strategy.md`, `Test_Architecture.md`). **Warnings never change the exit code.**
- **Error paths:** None.
- **Fixtures/env:** As REQ-CLI-UPDATE-001.

#### REQ-CLI-UPDATE-014 — `version` argument is cosmetic; no tag created

- **Priority:** Should — explicit non-behaviour (operators may expect tagging).
- **Source:** `cli/src/commands/update.ts` (`runUpdate`); `cli/src/index.ts` (update action, `looksLikeVersion`)
- **Preconditions / inputs:** `devaudit update [version] [paths...]`. Both args optional: paths default to `.`, version defaults to the running CLI version.
- **Given** `devaudit update v9.9.9 <path>` **When** it runs **Then** stdout logs `Version (informational, no tag created): v9.9.9`; **no git tag is created** and no network call results from the version arg. Single-arg disambiguation: a token matching `^v?\d+(\.\d+)` is treated as the version; otherwise a lone token is treated as a path and version falls back to the CLI version.
- **Error paths:** None.
- **Fixtures/env:** Any consumer.

#### REQ-CLI-UPDATE-015 — Multi-path: several consumers updated sequentially in one invocation

- **Priority:** Could — batch operation; fail-fast on first error.
- **Source:** `cli/src/commands/update.ts`; `cli/src/update/index.ts` (`syncAll` loop)
- **Preconditions / inputs:** `devaudit update <version> <pathA> <pathB> …` with two or more valid consumers.
- **Given** two valid consumers **When** `devaudit update v1 <A> <B>` **Then** each is synced in order (each emits its own `--- Syncing to: … ---` block), one shared `=== Sync Complete ===` summary follows, **exit 0**. If any consumer throws, `syncAll` logs `ERROR syncing <p>: …` and rethrows immediately → exit **1**, leaving earlier consumers already mutated (no rollback).
- **Error paths:** As above — partial application on failure.
- **Fixtures/env:** Two temp consumer fixtures.

#### REQ-CLI-UPDATE-016 — Plugin lifecycle hooks fire around the sync (beforeSync / afterSync)

- **Priority:** Could — only active when plugins are installed.
- **Source:** `cli/src/commands/update.ts` (`runUpdate`); `cli/src/lib/plugin/index.ts`, `hooks.ts` (`runHook`)
- **Preconditions / inputs:** One or more plugins discovered under `~/.config/devaudit/plugins/` exposing `beforeSync`/`afterSync` hooks.
- **Given** a discovered plugin **When** `devaudit update` runs **Then** for each project path a `beforeSync` hook runs before `syncAll` and an `afterSync` hook runs after; a hook that throws is caught and surfaced as a `WARN` (`Plugin '<pkg>' hook '<hook>' threw: …`) and does **not** abort the sync. With zero plugins, no hook overhead and identical output to the base path.
- **Error paths:** Hook throw → warning only, sync continues.
- **Fixtures/env:** Plugin install dir with a test plugin (otherwise no-op).

#### REQ-CLI-UPDATE-017 — Unknown stack/host adapter aborts before mutation

- **Priority:** Must — must fail loudly rather than half-sync against a missing adapter.
- **Source:** `cli/src/update/resolve-adapters.ts` (`resolveAdapters`); ground-truth `cli/test/update.test.ts` ("rejects an unknown stack")
- **Preconditions / inputs:** `sdlc-config.json` naming a `stack`/`host` with no matching `sdlc/files/stacks/<stack>/adapter.json` or `hosts/<host>/adapter.json`.
- **Given** `stack: "cobol"` **When** update runs **Then** `resolveAdapters` throws `stack adapter not found: stacks/cobol/adapter.json. Available: <list>` (analogous message for an unknown host) before any section runs; `syncAll` rethrows → exit **1**. Missing/partial `stack`/`host` keys (config present but keys absent, or no config) default to `node`+`railway` and emit a `DEPRECATED: stack/host keys missing …` warning.
- **Error paths:** As above.
- **Fixtures/env:** Temp consumer with a bad stack value.

#### REQ-CLI-UPDATE-018 — `--dry-run` previews `update` without mutation (#154)

- **Priority:** Should — preview safety.
- **Source:** `cli/src/index.ts` (update action forwards `globals.dryRun` to `runUpdate`); `cli/src/commands/update.ts` (`runUpdate` dry-run branch)
- **Preconditions / inputs:** `devaudit update --dry-run <path…>`.
- **Given** `--dry-run` on the `update` command **When** it runs **Then** it logs `DRY RUN — no files will be written and no plugin hooks will fire`, then calls `syncAll(paths, { dryRun: true })`, then `=== Dry run complete (no mutations performed) ===`, and returns (exit 0) **without** firing `beforeSync`/`afterSync` and without writing any file. **Corrected 2026-09-30 (devaudit-installer#930):** this REQ previously documented a static stub (`[dry-run] would sync SDLC templates via syncProject()`, never actually calling `syncAll`/`syncProject`) — since #930, dry-run runs the **real** sync pipeline with every writing section's actual write suppressed (`ManagedSyncState.dryRun`), so the full classification (new / unmodified / **conflict**) is still computed and reported; only the filesystem write itself, and every other section's own side effect (`npm install`, `git apply`, GitHub provider calls, `prettier --write`, the `sdlc-config.json` version stamp, the manifest write itself), is skipped. This means `--dry-run` now surfaces the exact conflict summary a real `update` would produce, not just a generic "would sync" message. With `--enable-e2e-regression`/`--disable-e2e-regression`, the dry-run additionally logs the would-be config flip (REQ-CLI-UPDATE-024) and still writes nothing.
- **Error paths:** Usage errors (no paths → exit 2; both e2e-regression flags → exit 2; an un-onboarded path with an e2e-regression flag → exit 1) are still enforced under `--dry-run`.
- **Fixtures/env:** srs-appendix-a-fixes.test.ts "writes no files when dryRun is set", "runs `update --dry-run <path>` exit 0 without the optsWithGlobals crash". `cli/test/sync-manifest.test.ts`'s "--dry-run reports conflicts without writing anything" covers the classification-without-mutation behaviour specifically.

#### REQ-CLI-UPDATE-019 — Suggested sync commit message must not contain a skip-CI tag (#1020, supersedes #220)

- **Priority:** Should — advisory text, but following it as printed used to deadlock the sync PR: GitHub runs no workflows (pull_request ones included) for a commit whose message contains a skip-CI tag, so the integration branch's required `Quality Gates` check was never created and the PR sat `BLOCKED` with no timeout (example-app PR #915). The tag (#220) protected against housekeeping releases needing sign-off, a path #409 already removed.
- **Source:** `cli/src/commands/update.ts` (`SYNC_COMMIT_MESSAGE`, `runUpdate`'s "Next steps" block)
- **Preconditions / inputs:** A non-dry-run `update` completes (any number of paths).
- **Given** `update` finishes **When** the "Next steps" block is printed **Then** step 2 is `git add -A && git commit -m 'chore: sync SDLC templates from DevAudit'` (no skip-CI tag in any spelling) and step 3 is "open a PR into the integration branch", with a warning never to add a skip-CI tag. This is a suggestion printed to stdout only — `update` never runs `git commit` itself (REQ-CLI-UPDATE-001's "no git commit is made" guarantee).
- **Error paths:** None — static text, not conditional on sync outcome.
- **Fixtures/env:** `cli/test/sync-commit-message.test.ts` asserts the exported message has no skip-CI token and that `update.ts` carries no literal tag; `scripts/release-validation.sh` layer 1 `no-skip-ci-guidance` scans operator-facing guidance.

#### REQ-CLI-UPDATE-020 — `devaudit update` adds sentinel entries to consumer `.gitignore` (#226, #930, #945)

- **Priority:** Must — an uncommitted sentinel file leaking into git history would pollute the consumer's repo with process-only state; for `.env`/`.env.local` specifically, it would mean a leaked credential (devaudit-installer#945).
- **Source:** `cli/src/update/gitignore.ts` (`syncGitignore`, `SENTINEL_ENTRIES`, section 2g)
- **Preconditions / inputs:** None — runs unconditionally on every `update`.
- **Given** a consumer's `.gitignore` (present or absent) **When** update runs **Then** any of the seven `SENTINEL_ENTRIES` — `.e2e-gate-passed`, `.e2e-evidence-wired`, `.sdlc-implementer-invoked`, `.sdlc-pr-watch.json`, `*.devaudit-new`, `.env`, `.env.local` — not already present (as an exact trimmed line, anywhere in the file) are appended, preceded by a `# DevAudit sentinel files (devaudit-installer#226)` marker comment if that marker isn't already present; existing lines are never reordered, removed, or rewritten. **Corrected 2026-09-30 (#931 docs audit):** this REQ previously named only two sentinel entries (`.e2e-gate-passed`, `.sdlc-implementer-invoked`) — `.e2e-evidence-wired` and `.sdlc-pr-watch.json` were added to `SENTINEL_ENTRIES` since and the REQ text was never updated. **Updated 2026-10-03 (#945):** `*.devaudit-new` (#930) was also missing from this list; `.env`/`.env.local` were newly added so the `--with-viewer-key` one-time-print instruction (REQ-CLI-INSTALL-015/027 — "persist the raw `DEVAUDIT_VIEWER_API_KEY` into `.env`") can't result in a committed secret on any consumer, including one with no pre-existing `.env` gitignore rule of its own.
- **Error paths:** None — a missing `.gitignore` is treated as empty content, not an error.
- **Fixtures/env:** As REQ-CLI-UPDATE-001; assert all seven sentinel lines and the marker comment are present after a sync against both a pre-existing and an absent `.gitignore`. `.env`/`.env.local` coverage added in update.test.ts (devaudit-installer#945).

#### REQ-CLI-UPDATE-021 — CI workflow output filenames + check/job names namespaced per target (#689/#692)

- **Priority:** Must — extends REQ-CLI-UPDATE-011; without this, two targets in one repo collide on `ci.yml`/`Quality Gates` and only one target's pipeline survives.
- **Source:** `cli/src/update/ci-templates.ts` (`namespaceForTarget`, per-target loop in `syncCiTemplates`)
- **Preconditions / inputs:** `sdlc-config.json` resolves (via `resolveTargets`) to more than one target. `syncCiTemplates` now loops the entire per-template render (token/block substitution, services-block stripping, file write) once per target, computing that target's own `PROJECT_SLUG`/`PRODUCTION_URL_SECRET`/`WORKING_DIRECTORY`/`SOURCE_DIRS` tokens from the target's own fields (falling back to the flat config's for fields a target doesn't override).
- **Given** exactly one target **When** update runs **Then** output filenames and job/check names are byte-for-byte identical to REQ-CLI-UPDATE-011/012 (`namespaceForTarget` is a no-op — `multiTarget=false`). **Given** two or more targets, e.g. `web` (node, root) and `api` (python, `api/`) **When** update runs **Then** NO un-namespaced `ci.yml` is written; instead `ci-web.yml` and `ci-api.yml` are both written, each containing `Quality Gates (web)`/`Quality Gates (api)` respectively (every occurrence of the literal string `Quality Gates` is suffixed — the workflow-level `name:` and job-level `name:` lines are namespaced via the SAME substitution pass as the bare-string replace, ordered so a title that already ends with the target's `(name)` suffix is not re-suffixed a second time) and each target's own `PROJECT_SLUG` token substitution (e.g. `fixture-api`) appears only in that target's file, never the other's. (Verified by update.test.ts "namespaces CI workflow filenames and check names when a config has multiple targets (#692)".)
- **Error paths:** Unchanged from REQ-CLI-UPDATE-011 — a template missing from both stack and default locations is still silently skipped, now per-target.
- **Fixtures/env:** A `targets: [web, api]` fixture; assert file presence/absence and namespaced string occurrences via `fs.readdir`/`fs.readFile` on `.github/workflows/`.

#### REQ-CLI-UPDATE-022 — CI trigger paths scoped to each target's own `working_directory` (#689/#693)

- **Priority:** Should — prevents an unrelated target's commit from firing this target's pipeline in a polyglot repo; no effect on single-target repos.
- **Source:** `cli/src/update/ci-templates.ts` (`resolveTargetWorkingDir`, `otherTargetDirs`, `PATHS_IGNORE`/`PR_PATHS_IGNORE` block tokens); `sdlc/files/ci/ci.yml.template` and `sdlc/files/ci/python/ci.yml.template` (`{{PR_PATHS_IGNORE}}` placeholder in the `pull_request:` trigger)
- **Preconditions / inputs:** Two or more targets, each with a real (non-root, non-`'.'`) `working_directory`. `otherTargetDirs` for a given target is every OTHER target's working directory (that itself has a real, non-root directory), appended `/**`.
- **Given** two non-root targets, e.g. `web` at `example-web-service` and `api` at `example-python-service` **When** update runs **Then** `ci-web.yml`'s `push.paths-ignore` gains `- 'example-python-service/**'` (but NOT `- 'example-web-service/**'`, its own directory) and its `pull_request` trigger gains a matching `paths-ignore:` block that did not exist before #693 (previously `pull_request` had no paths filter at all); `ci-api.yml` gets the mirror image, ignoring `example-web-service/**`. This applies identically to the Python-stack template (`sdlc/files/ci/python/ci.yml.template`), which carries the same `{{PR_PATHS_IGNORE}}` placeholder. **Given** a target's own `working_directory` is root/`.`/absent **Then** that target is NOT path-scoped away from by other targets' triggers (root can't be meaningfully excluded from without excluding everything) — it keeps unscoped triggers, a documented limitation. **Given** a single target **Then** no `paths-ignore:` block is added to `pull_request` at all (byte-identical to REQ-CLI-UPDATE-011). (Verified by update.test.ts "scopes ci.yml triggers to each target's own working_directory when both targets are non-root (#693)".)
- **Error paths:** None.
- **Fixtures/env:** A `targets: [web, api]` fixture with both directories non-root; regex-match the rendered `pull_request`/`push` blocks.

#### REQ-CLI-UPDATE-023 — `update`'s branch-protection check adds only what is missing, keeps maintainer settings and respects rulesets, for every target (#689/#695/#696/#990)

- **Priority:** Should — advisory (never fails the sync). Without it a removed required check goes unnoticed; done carelessly (the pre-#990 blind PUT) it silently weakens or changes a repository's protection on every sync.
- **Source:** `cli/src/update/branch-protection.ts` (`verifyBranchProtection`, section 2k); `cli/src/lib/git-provider/github.ts` (`GitHubProvider.ensureBranchProtection`); `cli/src/lib/branch-protection-checks.ts` (`MAIN_REVIEW_COUNT` 1, `DEVELOP_REVIEW_COUNT` 0)
- **Preconditions / inputs:** Consumer with a resolvable git provider; not `--dry-run` (the section is skipped there). Runs on every `devaudit update` for the release branch and, when distinct, the integration branch, once per target from `resolveTargets(config)` with that target's namespaced required checks (`['Quality Gates']` single-target, `['Quality Gates (<name>)']` per target otherwise).
- **Given** repository rulesets on the branch include a `required_status_checks` or `pull_request` rule **Then** no classic protection is read or written; the line reads `<branch>: protected by rulesets (ok)`, or names the required checks the rulesets lack and a ruleset review count below DevAudit's minimum, and sets the section `warning`. Rulesets with only other rule types (deletion, non-fast-forward, ...) do not count as protection.
- **Given** the rulesets endpoint (or the classic endpoint) answers 403 "Upgrade to GitHub Pro or make this repository public" **Then** nothing is written; the line reads `branch protection is not available for this repository on its GitHub plan — required checks are not enforced` and the `warning` is set.
- **Given** the branch has no classic protection (404) **Then** the install defaults are applied once through `applyBranchProtection` (REQ-CLI-INSTALL-024): `<branch>: no protection found; applied the DevAudit defaults`.
- **Given** classic protection exists **Then** only missing required checks are added (`POST …/protection/required_status_checks/contexts`, or `PATCH …/required_status_checks` when status checks are off) and a review count below the minimum is raised (`PATCH …/required_pull_request_reviews` with only `required_approving_review_count`). Admin enforcement, `strict`, a higher review count, code-owner and last-push reviews, linear history, push restrictions and every other setting stay as the maintainer left them. The line names each change (`added required check(s) "Quality Gates"`, `raised required approving reviews from 0 to 1`) or reads `ok`. No full-protection `PUT` is sent.
- **Given** any read or write fails **Then** the line reads `<branch>: failed — <API message>`, the `warning` is set, and the sync continues.
- **Given** `sdlc-config.json` has `release_branch_required_reviews` (0, 1 or 2; #1116 WP2) **Then** the release branch's required approving reviews are made to equal it, in both directions, and it replaces DevAudit's minimum of 1 (it may be 0). A lower count on GitHub is raised as above. A higher count on GitHub is lowered (`PATCH …/required_pull_request_reviews` with only `required_approving_review_count`) **only after an interactive confirmation** that states the recorded control gap (SOC 2 CC8.1, ISO 27001 A.8.32 when lowering to 0); the line reads `lowered required approving reviews from 1 to 0 (confirmed)`. With no terminal (`CI` set, no TTY, `--json`) or on "no", nothing is written and the line reads `… — requires N approving review(s) but release_branch_required_reviews is M; not lowered (run \`devaudit update\` in a terminal to confirm, or change it on GitHub)` and the section `warning` is set. Without the key, the minimum stays 1 and a higher count is kept, as before. The integration branch is unaffected. A value outside 0-2 in a hand-edited file is ignored.
- Reads are sent as `gh api <path>` without `-X`, so a read-only `gh` wrapper (the release-validation stub) passes them through.
- **Error paths:** No provider resolvable → section reports `filesSynced: 0` with a `warning` (git provider unavailable), never throws — `devaudit update`'s exit code is unaffected. `getRepoMeta` failure → same shape, different warning text.
- **Fixtures/env:** `cli/test/ensure-branch-protection.test.ts` (compliant stricter config untouched; `cli/test/release-branch-reviews.test.ts` for the configured review count: lowering only after the confirmation, no write without a terminal or on "no", raising and keeping 0, the confirmation text;  missing check added through the sub-resource, no PUT; low review count raised alone; no protection → defaults; ruleset-protected → no writes, missing checks reported; ruleset review count below minimum; non-protecting rulesets ignored; plan-unavailable → no writes; GETs carry no `-X`; failed write reported; section 2k summary lines and warning).

#### REQ-CLI-UPDATE-024 — `--enable-e2e-regression` / `--disable-e2e-regression` flip the opt-in before syncing (#876)

- **Priority:** Should — the supported CLI path for opting a consumer into (or out of) the 3-tier E2E regression gate (REQ-FRAMEWORK-E2EREGRESSION-001) without hand-editing `sdlc-config.json`.
- **Source:** `cli/src/index.ts` (`update` options `--enable-e2e-regression`, `--disable-e2e-regression`); `cli/src/commands/update.ts` (`runUpdate`, `applyE2eRegressionFlag`); `cli/src/lib/sdlc-config.ts` (`e2e_regression_enabled?: boolean`)
- **Preconditions / inputs:** `devaudit update [--enable-e2e-regression | --disable-e2e-regression] [version] [paths…]`. Each path is resolved to its repo root (`resolveRepoRoot` — `sdlc-config.json` lives at the repo root, not a polyglot target's subdirectory, #689).
- **Given** both flags **When** `runUpdate` starts **Then** `--enable-e2e-regression and --disable-e2e-regression cannot be combined.` and exit **2**, before anything else runs (validated in `runUpdate` itself, so identical via CLI or direct call); `sdlc-config.json` is untouched.
- **Given** either flag and any path whose repo root has no `sdlc-config.json` **Then** every such path is reported (`No sdlc-config.json at <repoRoot>. This project hasn't been onboarded yet — run \`devaudit install\` before --enable-e2e-regression/--disable-e2e-regression.`) **before any file is written** for any path, then exit **1** — fail-fast, all-or-nothing, never a partial flip.
- **Given** one flag and all paths onboarded (not dry-run) **Then** each repo root's `sdlc-config.json` is rewritten with only `e2e_regression_enabled` set to `true`/`false` (every other key preserved, 2-space JSON + trailing newline), logging `set e2e_regression_enabled: <bool> in <path>`; then the normal sync runs, which generates or removes `e2e-regression.yml` and keeps/strips `compliance-evidence.yml`'s E2E Regression listener accordingly (REQ-FRAMEWORK-E2EREGRESSION-001, REQ-FRAMEWORK-EVIDENCE-001). After a successful `--enable-e2e-regression` sync, extra guidance is printed after the normal "Next steps" block: `E2E regression tier enabled (devaudit-installer#876):`, that `playwright.config.ts` must define `critical`/`regression` named projects (pointing at `docs/e2e-test-tiers.md#opting-into-the-3-tier-regression-gate`), and to run `devaudit doctor` afterward (its `e2e-regression` check, REQ-CLI-DOCTOR-005).
- **Given** `--dry-run` with either flag **Then** `[dry-run] would set e2e_regression_enabled: <bool> in <repoRoot>/sdlc-config.json` is logged and nothing is written (the un-onboarded fail-fast still applies). See REQ-CLI-UPDATE-018.
- **Given** neither flag **Then** `e2e_regression_enabled` is never touched — an existing value survives a plain `devaudit update` unchanged.
- **Error paths:** As above (exit 2 / exit 1).
- **Fixtures/env:** update.test.ts `describe('runUpdate — --enable/--disable-e2e-regression (#876)')`: "flips e2e_regression_enabled: true and generates e2e-regression.yml", "flips e2e_regression_enabled: false and removes a previously-generated e2e-regression.yml", "rejects passing both flags together, without touching sdlc-config.json", "leaves an existing e2e_regression_enabled value untouched when neither flag is passed", "errors clearly per-path when sdlc-config.json is absent (not an onboarded consumer)".

#### REQ-CLI-UPDATE-025 — Section 2h: SDLC CLI engine (binary + blueprints) synced as CommonJS, stale pre-#929 `.js` copy removed

- **Priority:** Must — this is the local-resilience fallback `sdlc-implementer`'s phase-transition and freshness-check sentinels depend on when `npx @metasession.co/devaudit-sdlc` can't reach the registry; a broken copy blocks every tracked REQ.
- **Source:** `cli/src/update/sdlc-engine.ts` (`syncSdlcEngine`); `sdlc/src/bin/devaudit-sdlc.cjs`; `sdlc/src/blueprints/*.raw.md`
- **Preconditions / inputs:** `ctx.installerRoot` resolves to a tree containing `sdlc/src/bin/devaudit-sdlc.cjs` and `sdlc/src/blueprints/`.
- **Given** a normal sync **When** section 2h runs **Then** `SDLC/bin/devaudit-sdlc.cjs` is written (mode `0o755`) and `SDLC/blueprints/` is fully replaced (`copyDir(clean=true)` — every existing file under `SDLC/blueprints/` is removed and the installer's current blueprint set recopied); `filesSynced` counts the binary plus every blueprint file; message is `synced to SDLC/bin/ + SDLC/blueprints/`.
- **Given** a repo previously synced before devaudit-installer#929 (a stale `SDLC/bin/devaudit-sdlc.js` present from an older CLI version) **When** section 2h runs **Then** the stale `.js` file is deleted in the same pass the `.cjs` is written, and the section message becomes `synced to SDLC/bin/ + SDLC/blueprints/; removed stale SDLC/bin/devaudit-sdlc.js` so the removal is visible in sync output, not silent.
- **Why `.cjs`, not `.js` (devaudit-installer#929):** `sdlc/src/bin/devaudit-sdlc.cjs` is genuine CommonJS (`require('fs')`, `require('path')`, `require('child_process')`). Before this REQ, it was synced as plain `.js` with no isolating `package.json` in the consumer's `SDLC/bin/` — Node resolves a `.js` file's module system from the *consumer's own* nearest `package.json`, not `sdlc/package.json` (which is never copied alongside it). Any consumer declaring `"type": "module"` (a common modern default) had this file misinterpreted as ESM and crashed on every invocation with `require is not defined`, breaking the phase-transition sentinel (`--phase=N`) and freshness-check sentinel (`--freshness-checked=<version>`) entirely — not a config-specific edge case, since nothing about `"type": "module"` depends on any particular `sdlc-config.json` value. `.cjs` forces CommonJS interpretation regardless of the consumer's `package.json`.
- **Error paths:** `binSrc` missing in the installer root → `skipped: true`, message `devaudit-sdlc.cjs not found in installer`, `filesSynced: 0` (no partial write).
- **Fixtures/env:** `cli/test/update.test.ts` "syncs a runnable SDLC engine binary for a `"type": "module"` consumer, and removes the stale pre-#929 .js copy (#929)" — a fixture with `package.json`'s `"type": "module"` and a pre-seeded stale `SDLC/bin/devaudit-sdlc.js`; asserts the stale file is gone, the `.cjs` exists, and `node SDLC/bin/devaudit-sdlc.cjs --phase=1 --view` actually exits 0 under Node's ESM-triggering `"type": "module"` (not just a file-existence check). `cli/test/devaudit-sdlc-engine.test.ts` exercises the binary itself directly (not through `syncProject`) against `sdlc/src/bin/devaudit-sdlc.cjs`.

#### REQ-CLI-UPDATE-026 — Section 2i: `.devin/workflows/*.md` slash-command workflows synced to the consumer repo root

- **Priority:** Should — these are IDE-invoked runbooks (e.g. `/devaudit-update-install`), not required for `devaudit`'s own operation, but undocumented before this REQ despite running on every sync.
- **Source:** `cli/src/update/workflows.ts` (`syncWorkflows`)
- **Preconditions / inputs:** `sdlc/files/_common/workflows/*.md` present in the installer root.
- **Given** the consumer **When** update runs **Then** `<repoRoot>/.devin/workflows/` is created if missing (note: always the resolved **repo root**, not a polyglot target's subdirectory — same rule as `sdlc-config.json`, #689) and every `*.md` under `sdlc/files/_common/workflows/` is copied in, overwritten wholesale each run; section reports `[2i] Workflows: <N> file(s) — synced to .devin/workflows/`.
- **Error paths:** Source dir missing → `skipped: true`, 0 files (non-fatal).
- **Fixtures/env:** As REQ-CLI-UPDATE-001; assert `.devin/workflows/devaudit-update-install.md` (among others) exists and matches the installer's source content after a sync.

#### REQ-CLI-UPDATE-027 — Section 2l: consumer's own Prettier re-runs over every file synced this pass (#663)

- **Priority:** Should — a consumer's own commit-time formatter would otherwise silently revert a synced file's exact bytes at commit time, making `devaudit update`'s reported file count lie about what actually lands in git.
- **Source:** `cli/src/update/format-sync.ts` (`formatSyncedFiles`), invoked from `cli/src/update/index.ts` after the section loop and outside `total` (its own `[2l]` log line and `filesSynced` count are never added to the sync's `Total: N files synced`)
- **Preconditions / inputs:** `ctx.stack === 'node'`; at least one file synced by an earlier section (any `SectionResult.filePaths` entry) has a `.json`/`.css`/`.md`/`.yml`/`.yaml` extension — the same bucket the consumer's own `lint-staged.config.mjs` runs through prettier-only (not eslint) for the node stack. `.ts`/`.tsx`/`.js`/`.jsx` are deliberately excluded (would additionally risk `eslint --fix` failing outright on project-specific lint rules, unattended).
- **Given** a node-stack consumer with those file types synced **When** update runs **Then** `prettier --write <files…>` runs against the consumer's own local `node_modules/.bin/prettier` if present, else `npx --no-install prettier --write <files…>`, over the deduplicated union of `filePaths` from every section this pass — **runs on every sync, unconditionally, not just when content changed** (there's no "already formatted" short-circuit); message is `ran prettier --write on <N> synced file(s) so the commit already matches consumer style`.
- **Error paths:** Non-node stack or no formattable files synced → `skipped: true`, 0 files. `prettier --write` exits non-zero → a `warning` is set (sync itself still succeeds, exit 0) noting a consumer formatter hook may silently revert some of the synced files at commit time; nothing is reverted by this step itself, it only best-effort normalizes.
- **Fixtures/env:** `cli/test/format-sync.test.ts`.

#### REQ-CLI-UPDATE-028 — Section 2m: `devaudit_synced_version` stamped into `sdlc-config.json` last, after every other section

- **Priority:** Must — this is the one `sdlc-config.json` field a plain `update` always writes; `sdlc-implementer`'s freshness check (#736) depends on it being accurate, which requires it to only ever reflect a sync that fully completed.
- **Source:** `cli/src/update/stamp-version.ts` (`stampVersion`), invoked from `cli/src/update/index.ts` as the last step of `syncProject` — after section 2l (format) and the drift-warning evaluation, deliberately outside `SECTION_RUNNERS` and outside `total`
- **Preconditions / inputs:** `sdlc-config.json` resolvable at `ctx.repoRoot` (via `readSdlcConfig`).
- **Given** a consumer whose `sdlc-config.json` exists **When** `syncProject` reaches its final step **Then** `devaudit_synced_version` is set to the running CLI's own version (`CLI_VERSION`) and the file is rewritten (2-space JSON + trailing newline), preserving every other key untouched — this is the **only** `sdlc-config.json` write a plain `update` performs (`--enable-/--disable-e2e-regression` additionally write `e2e_regression_enabled`, REQ-CLI-UPDATE-024, but that happens earlier, before the section loop, not here). If `devaudit_synced_version` already equals `CLI_VERSION`, the file is left untouched and the step reports `already stamped <version>` with 0 files.
- **Error paths:** `sdlc-config.json` not found → `skipped: true`, message `sdlc-config.json not found — nothing to stamp`, 0 files (non-fatal — an un-onboarded path can still receive a plain `update`'s template sync).
- **Fixtures/env:** As REQ-CLI-UPDATE-001; assert `sdlc-config.json`'s `devaudit_synced_version` equals the test-harness's `CLI_VERSION` after a sync, and that a second immediate sync reports `already stamped` with 0 files synced for this step.

#### REQ-CLI-UPDATE-029 — Section 2n: the sync manifest (`.devaudit/sync-manifest.json`) records what devaudit last wrote (devaudit-installer#930)

- **Priority:** Must — every other new REQ in this cluster (030–032) depends on this file existing and being accurate; it's the load-bearing state that turns "overwrite unconditionally" into "overwrite only what's provably unmodified."
- **Source:** `cli/src/update/sync-manifest.ts` (`SyncManifest`, `ManifestEntry`, `readManifest`, `writeManifest`, `sha256`, `toManifestKey`); written from `cli/src/update/index.ts` (`syncProject`, `ManagedSyncState.finalize`)
- **Preconditions / inputs:** Not `--dry-run`.
- **Given** a non-dry-run sync **When** `syncProject` reaches its last step (`[2n]`, after consumer patches/2j, formatting/2l, and the version stamp/2m) **Then** `.devaudit/sync-manifest.json` is written with shape `{ version: 1, cli_version: <CLI_VERSION>, files: { "<repo-relative posix path>": { sha256, section, conflict?, pending_upstream_sha256? } } }`. Every path any writing section touched this run gets an entry; a **non-conflict** entry's `sha256` is computed by re-reading the file's actual on-disk bytes at this final step — not the content passed to `writeManaged` at write time — so a file a `.devaudit-patches` patch or the formatter (2l) subsequently changed is recorded by what's really on disk (see SRS-PATCH-084-001). A **conflict** entry's `sha256` is instead frozen at the previously-recorded value (or the pre-existing on-disk hash, for a newly-discovered conflict) — deliberately not updated to the current (still-locally-modified) on-disk hash, so the file continues to read as modified on every subsequent sync until the conflict is actually resolved (REQ-CLI-UPDATE-030). A path tracked in a previous manifest but not touched this run (e.g. a section skipped this sync) is carried forward unchanged; a path explicitly removed this run (REQ-CLI-UPDATE-031) is dropped entirely.
- **Given** any sync **Then** `files` is written with its keys in sorted order (devaudit-installer#984), so a second `update` with nothing to change leaves the manifest byte-identical. (Before 1.8.0 keys followed section completion order and the file was rewritten on every no-op sync.)
- **Given** `--dry-run` **Then** section `[2n]` is skipped and no manifest is written (its own log line reads `sync manifest: SKIPPED (dry-run)`).
- **Error paths:** None — a missing `.devaudit/` directory is created (`fs.mkdir(recursive: true)`); a corrupt/unreadable existing manifest is treated as absent by `readManifest`, triggering bootstrap reconstruction (REQ-CLI-UPDATE-032) rather than throwing.
- **Fixtures/env:** `cli/test/sync-manifest.test.ts` — "records an unmodified file silently…", "a patch-carrying CI file updates cleanly with no conflict (manifest recorded post-patch)".

#### REQ-CLI-UPDATE-030 — `writeManaged`/`removeManaged`: a locally-modified file is never overwritten, conflicts are reported not fatal (devaudit-installer#930)

- **Priority:** Must — this is the actual safety guarantee the umbrella (#932) exists to deliver: no sync path can destroy a customization it doesn't know about.
- **Source:** `cli/src/update/write-managed.ts` (`writeManaged`, `removeManaged`, `syncDirManaged`, `removeStaleUnderManaged`, `ManagedSyncState`, `formatConflictSummary`)
- **Preconditions / inputs:** A `known` map for this sync — either the previous manifest's `files` (REQ-CLI-UPDATE-029) or a bootstrap-reconstructed baseline (REQ-CLI-UPDATE-032).
- **Given** a destination path with nothing on disk **When** any managed section calls `writeManaged` **Then** it writes the new content (skipped under `--dry-run`) and classifies as **new**.
- **Given** a destination path that exists on disk, tracked in `known`, whose current content's sha256 matches the tracked hash **Then** it's **unmodified** — the new content is written (still skipped under `--dry-run`), same as before this REQ existed.
- **Given** the destination's current on-disk content already equals the *new* content being written (regardless of tracked state) **Then** it's **identical** — nothing is written, resolving a previously-flagged conflict once the operator has reconciled it by hand.
- **Given** neither of the above — the on-disk content differs from both the tracked hash and the new content — **Then** it's a **conflict**, whether the path was tracked with a different hash (a genuine hand-edit) or untracked with something already on disk (a pre-existing file, typically at onboarding): the local file is left byte-for-byte untouched; the new content is written to `<path>.devaudit-new` instead (skipped under `--dry-run`); the manifest entry gets `conflict: true` + `pending_upstream_sha256` (REQ-CLI-UPDATE-029); the conflict is collected for the end-of-sync summary (`formatConflictSummary`) and for `devaudit doctor`'s `sync-conflicts` check (REQ-CLI-DOCTOR-005). **Corrected 2026-10-13 (#988):** a path whose known entry carries `conflict: true` is never classified as unmodified, so a later sync never overwrites (or, in `removeManaged`, deletes) it; it stays a conflict until the on-disk content equals the new upstream content (operator took `.devaudit-new`). An untracked-but-present conflict records an empty baseline hash, never the local file's hash. Previously it recorded the local hash, so the **next** sync classified the file as unmodified and silently replaced the consumer's edit with upstream (data loss; found by the release-validation gate, `cli/test/write-managed-conflict.test.ts`).
- **`removeManaged`** (stale-file cleanup — REQ-CLI-UPDATE-009/024/025 §blueprints/REQ-FRAMEWORK-CIYML-022/REQ-FRAMEWORK-E2EREGRESSION-001/REQ-FRAMEWORK-RENDER-006 all route through it): **Given** a path not in `known` **Then** no-op (`not-tracked`) — devaudit never deletes a file it can't prove it wrote. **Given** a tracked path already absent from disk **Then** `removed` (nothing to do, manifest entry dropped). **Given** a tracked path whose on-disk hash matches the tracked hash **Then** deleted, `removed`. **Given** a tracked path whose on-disk hash has diverged **Then** kept in place, `kept-conflict` — reported the same way as a write conflict, but with no `.devaudit-new` written (there's no new upstream content to offer; the file is simply no longer supposed to exist).
- **`syncDirManaged`/`removeStaleUnderManaged`** (directory-shaped targets — `.claude/skills/<name>/`, `SDLC/blueprints/`): recursively apply the same per-file classification instead of `copyDir(clean=true)`'s unconditional `rm -rf` + recopy, so a consumer-added file with no upstream counterpart is never touched (untracked, nothing on disk to conflict with — a no-op by construction) and a stale upstream-removed file is deleted only if unmodified.
- **Exit code / reporting:** A conflict never fails the sync — `syncProject` still returns/exits normally; conflicts surface only as warnings (sync-time summary) and manifest state (persisted, `doctor`-visible). This mirrors the existing consumer-patch-conflict-is-non-fatal precedent (#921/#923, SRS-PATCH-084-002); since #1023 the parity extends to persistence too — a skipped patch is recorded under the manifest's `patches` map and surfaced by the `patch-conflicts` doctor check (REQ-CLI-DOCTOR-014), not only warned about once.
- **Error paths:** None beyond normal filesystem errors (permission denied, etc.), which propagate as today.
- **Fixtures/env:** `cli/test/sync-manifest.test.ts` — the full suite: unmodified-silent-update, hand-edited-CI-workflow-preserved, hand-edited-script-and-hook-preserved, resolve-via-mv-devaudit-new, consumer-added-skill-file-survives, stale-unmodified-removed-vs-stale-modified-kept, pre-existing-untracked-file-conflict-at-onboarding, patch-carrying-file-clean, dry-run-classifies-without-writing.

#### REQ-CLI-UPDATE-031 — Manifest-driven deletion replaces every unconditional stale-file/directory removal (devaudit-installer#930)

- **Priority:** Must — an unconditional `fs.rm`/`copyDir(clean=true)` on a devaudit-managed path can destroy a consumer's own file with no way to recover it; this REQ is the umbrella statement that every such site in the codebase was converted, not just the ones with their own dedicated REQ.
- **Source:** `cli/src/update/ci-templates.ts` (`OLD_WORKFLOWS_TO_REMOVE`, e2e-regression/reconcile-deployment/multi-target-unsuffixed sweeps — REQ-FRAMEWORK-RENDER-006, REQ-FRAMEWORK-E2EREGRESSION-001, REQ-FRAMEWORK-CIYML-022); `cli/src/update/skills.ts` (REQ-CLI-UPDATE-009); `cli/src/update/sdlc-engine.ts` (the pre-#929 stale `.js` removal and `SDLC/blueprints/` — REQ-CLI-UPDATE-025)
- **Preconditions / inputs:** As REQ-CLI-UPDATE-030.
- **Given** any of the above removal sites **When** it identifies a candidate path to delete **Then** it calls `removeManaged`/`removeStaleUnderManaged`, never `fs.rm`/`copyDir(clean=true)` directly, so the same not-tracked/removed/kept-conflict classification (REQ-CLI-UPDATE-030) applies uniformly regardless of which section triggered the removal.
- **Error paths:** N/A — covered per-site.
- **Fixtures/env:** Covered per-site (see the cited REQs) plus `cli/test/sync-manifest.test.ts`'s dedicated stale-removal test.

#### REQ-CLI-UPDATE-032 — Manifest bootstrap: reconstructing a baseline on the first sync after upgrading, with a conservative fallback (devaudit-installer#930)

- **Priority:** Must — without this, the very first sync under a devaudit-installer#930-or-later CLI would have no `known` map at all and would report *every* existing managed file as a conflict, even ones nobody ever touched — a correct but maximally noisy result the umbrella's acceptance criteria explicitly rule out ("no sync path can overwrite or delete a file... including on the first update after this ships").
- **Source:** `cli/src/update/manifest-bootstrap.ts` (`buildBaseline`, `defaultBaselineRunner`, `MANAGED_PATH_PREFIXES`, `BaselineRunner`)
- **Preconditions / inputs:** Called from `syncProject` only when `readManifest` returns nothing.
- **Given** `sdlc-config.json` has no `devaudit_synced_version`, or the repo root isn't a git repository (`git rev-parse --is-inside-work-tree` fails) **Then** `buildBaseline` returns an empty `known` map, `fellBack: true`, and a warning logged at sync start — every existing file at a managed path this sync touches is therefore a conflict (REQ-CLI-UPDATE-030's untracked-and-present case), and nothing is deleted (REQ-CLI-UPDATE-031's not-tracked case). This is the deliberately safe failure direction: worse case is extra `.devaudit-new` files to review, never a silent loss.
- **Given** both preconditions hold **Then** a scratch git worktree is created (`git worktree add --detach <tmp> HEAD`), the injectable `runner` (defaulting to `defaultBaselineRunner`: `npx --yes @metasession.co/devaudit-cli@<recorded version> update <tmp>`, exit code ignored — an old version may itself abort on an unrelated patch conflict) runs against it, the real repo's `node_modules` is symlinked into the worktree if present, the *current* version's `applyConsumerPatches` and `formatSyncedFiles` re-apply on top (so a patch-carrying or formatter-normalized file compares like-for-like against this sync's own output, not a raw pre-patch snapshot), then every file under `MANAGED_PATH_PREFIXES` (the same fixed allowlist of directories/files every writing section targets — `SDLC/`, `.husky/`, `scripts/`, `.github/workflows/`, `.github/ISSUE_TEMPLATE/`, `.claude/skills/`, `.devin/workflows/`, `e2e/helpers/`, and the AI pointer files/hook config files) is hashed **recursively** into the baseline `known` map, tagged `section: 'bootstrap'`. The worktree is removed in a `finally` block regardless of outcome.
- **Given** the worktree creation or the reconstruction step throws **Then** the same empty-`known`/`fellBack: true`/warning result as the missing-precondition case — reconstruction failure fails safe, identically to reconstruction being skipped outright.
- **Corrected 2026-09-30 (devaudit-installer#932's pre-release validation gate — cloned real consumers, not fixtures — found three real bugs a fixture-only suite never caught):**
  1. **Env leak.** `execa`'s `env` option *extends* `process.env` by default; passing a destructured copy without `DEVAUDIT_INSTALLER_ROOT` still let the key merge back in from the untouched parent env, so the "old version" `npx` child resolved the *current* (unreleased) templates instead of its own bundled ones — silently reconstructing a baseline that matched today's output rather than history, defeating reconstruction entirely. Fixed with `extendEnv: false` in `defaultBaselineRunner`, which makes the destructured object authoritative instead of a merge source.
  2. **No `node_modules` in the worktree.** Git worktrees never carry `node_modules` (git doesn't track it), so `formatSyncedFiles`'s `node_modules/.bin/prettier` lookup silently failed to resolve inside the baseline — anything prettier normalizes (markdown tables, YAML/JSON quote style) stayed unformatted in the baseline while the real sync (which does have `node_modules`) formatted correctly, producing a spurious mismatch for a file nobody touched. Fixed by symlinking the real repo's `node_modules` into the worktree before the baseline's own format pass runs.
  3. **Non-recursive file collection.** The helper building the format pass's file list used a single-level `listFiles`, silently dropping everything nested more than one level under a managed prefix — every `.claude/skills/<name>/...` file and every `SDLC/blueprints/*.raw.md`/`SDLC/bin/*` file. Fixed by sharing one recursive collector (`collectManagedFilesRecursive`) between the hashing pass and the format pass, so both see the identical file set.

  5. **Live GitHub writes from the baseline run (devaudit-installer#990, found 2026-10-13 by the release-validation gate's `gh` stub log).** The old-CLI `update` runs in a worktree whose `origin` is the real repository and inherited the operator's GitHub credentials, so it also ran that version's GitHub side effects against the live repository: a full branch-protection PUT, issue-label creation and a default-branch edit. `defaultBaselineRunner` now strips `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `DEVAUDIT_USER_TOKEN`, `DEVAUDIT_API_KEY` and `DEVAUDIT_VIEWER_API_KEY` from the child's environment (`baselineRunnerEnv`) and puts a `gh` (and `gh.cmd`) that always exits 1 first on its `PATH` (`writeNoGhShim`); the old CLI's provider sections then report unavailable and nothing remote is written. File output is unaffected. Verified by sync-manifest.test.ts "cuts the baseline child off from GitHub and the portal (#990)".

  A fourth, related production (not baseline-only) bug surfaced by the same gate: `syncSkills` and `syncSdlcEngine` never populated `SectionResult.filePaths`, so section 2l's formatter never saw skill or blueprint markdown files in a **real** sync either — only the (now-recursive) baseline reconstruction did, permanently disagreeing with what production ever actually wrote and flagging every skill/blueprint file as a false-positive conflict on the very next sync regardless of the three bootstrap fixes above. Fixed by having both sections report every path they write.
- **Error paths:** None propagate — every failure mode inside `buildBaseline` is caught and converted to the conservative fallback result; the caller (`syncProject`) never has to handle a bootstrap-specific error.
- **Fixtures/env:** `cli/test/sync-manifest.test.ts`'s `describe('manifest bootstrap ...')` — the conservative-fallback case (no `devaudit_synced_version`), a stubbed-successful-reconstruction case that doesn't depend on network access to npm's registry, the env-leak regression test (direct, subprocess-free assertion on the pulled-out `baselineRunnerEnv` pure function — a fake-`npx`-on-`PATH` subprocess approach was tried first and dropped: a Unix shebang script isn't executable on Windows, which hung the real defaultBaselineRunner subprocess in Windows CI rather than failing on the actual assertion), the `node_modules`-symlink regression test (a fake, fast, cross-platform `node_modules/.bin/prettier` shim asserts the baseline's format pass produces genuinely-transformed content, not raw passthrough — a real `npm install prettier` was tried first and dropped for the same Windows-CI-timeout reason), the recursive-collection regression test (nested skill + blueprint paths present in `known`), and the `filePaths`-reporting regression test (both sections' `SectionResult.filePaths` non-empty and containing the expected nested files). A live-network integration test (using a real published old version) is explicitly out of scope for this suite per the issue's own "if CI allows network" hedge.

#### REQ-CLI-UPDATE-033 — Unknown/custom `sdlc-config.json` keys survive every sync path untouched (devaudit-installer#930)

- **Priority:** Must — a project's own config additions (anything not read by any template or CLI code path) must never be silently dropped by a tool that doesn't recognize them.
- **Source:** `cli/src/update/stamp-version.ts` (`{ ...existing, devaudit_synced_version: CLI_VERSION }` — spread-preserving); `cli/src/commands/update.ts` (`applyE2eRegressionFlag`'s `{ ...raw, e2e_regression_enabled: enabled }`); `cli/src/install/index.ts` (operator-mode re-run reads the existing config and spreads it the same way)
- **Preconditions / inputs:** `sdlc-config.json` contains at least one top-level key no template or CLI code reads, and/or a nested object value.
- **Given** a consumer's `sdlc-config.json` has custom top-level keys and nested objects **When** `devaudit update` runs (with or without `--enable-/--disable-e2e-regression`), or `devaudit install` re-runs in operator mode against an existing config **Then** every unrecognized key, including nested objects and arrays, is present and byte-identical (JSON round-trip) in the file afterward — every write path in this codebase spreads the existing parsed object before setting only the specific field(s) it owns, never reconstructing the file from a known-fields allowlist.
- **Error paths:** N/A.
- **Fixtures/env:** `cli/test/sync-manifest.test.ts` "preserves unknown/custom top-level and nested sdlc-config.json keys across update".

#### REQ-CLI-UPDATE-034 — Seed the labels the synced issue templates reference (devaudit-installer#970)

- **Priority:** Should — without it `gh issue create --label needs-triage` fails in every onboarded repo.
- **Source:** `cli/src/update/issue-labels.ts` (`ensureIssueTemplateLabels`, `collectTemplateLabels`, `parseTemplateLabels`), called from `syncProject` (so both `install` and `update`).
- **Given** a sync against a GitHub repo with `gh` authenticated **Then** the union of `bug`/`requirement`/`needs-triage` and every `labels: [...]` declared in `sdlc/files/_common/github/ISSUE_TEMPLATE/*.yml` is listed (`gh label list`) and each missing label is created with `gh label create <l> --force`; existing labels are never modified.
- **Given** `--dry-run` **Then** no `gh` call is made; the would-be labels are logged.
- **Error paths:** `gh` missing, unauthenticated, or repo not on GitHub, or an individual create failing, logs a warning (with the manual `gh label create` commands) and never fails the sync.
- **Fixtures/env:** `cli/test/issue-labels.test.ts` (mocked `execa`).

---

#### REQ-CLI-STATUS-001 — Report installed-vs-expected framework state for a consumer (human output)

- **Priority:** Should — read-only inspection; primary diagnostic surface.
- **Source:** `cli/src/commands/status.ts` (`runStatus`); `cli/src/lib/sdlc-config.ts` (`readSdlcConfig`, `checkFrameworkFiles`)
- **Preconditions / inputs:** `devaudit status [path]`; path defaults to `process.cwd()`, resolved to absolute. Consumer should contain `sdlc-config.json`.
- **Given** a consumer with `sdlc-config.json` **When** `devaudit status <path>` **Then** stdout shows `Inspecting <absPath>`, `sdlc-config.json found.`, a key block (`Project slug`, `Stack`, `Host`, optional `Node version`/`Python version`/`Working dir`/`Source dirs`, `DevAudit URL`, `UAT enabled`, `Approval mode`; unset scalars render `(unset)`), then a `✓`/`✗` line per framework file (the fixed list: `INSTRUCTIONS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `GEMINI.md`, `SDLC/0-project-setup.md`, `SDLC/5-deploy-main.md`, `scripts/upload-evidence.sh`, `compliance/RTM.md`, `.github/workflows/ci.yml`), and a trailing `All checked framework files are present.` or `<N> framework file(s) missing. Re-sync with …`. **Exit 0.** **Read-only: no filesystem writes, no network.**
- **Error paths:** See REQ-CLI-STATUS-003 for missing config.
- **Fixtures/env:** Temp consumer with `sdlc-config.json` containing `project_slug`, `stack`, `host`, `node_version`, `devaudit.base_url` (mirrors `cli/test/status.test.ts`).

#### REQ-CLI-STATUS-002 — `--json` machine-readable status

- **Priority:** Should — needed for CI assertions and tooling.
- **Source:** `cli/src/commands/status.ts` (`runStatus` JSON branch); `cli/src/lib/logger.ts` (`isJsonMode`, `emitJsonResult`)
- **Preconditions / inputs:** `devaudit status <path> --json`.
- **Given** an onboarded consumer **When** `--json` is set **Then** exactly one JSON object is written to stdout: `{ ok:true, projectPath, project_slug, stack, host, node_version, python_version, working_directory, source_dirs, devaudit_base_url, uat_enabled, approval_mode, files_present:[…], files_missing:[…] }` (unset scalars null; `uat_enabled` defaults false). No human log lines. **Exit 0.**
- **Error paths:** Missing config → `{ ok:false, reason:"not_onboarded", projectPath }` then exit **7** (REQ-CLI-STATUS-003).
- **Fixtures/env:** As REQ-CLI-STATUS-001 with `--json`.

#### REQ-CLI-STATUS-003 — Not-a-consumer (missing sdlc-config.json) exits 7

- **Priority:** Should — distinct exit code lets callers detect "not onboarded".
- **Source:** `cli/src/commands/status.ts` (`runStatus`); ground-truth `cli/test/status.test.ts` ("warns when no sdlc-config.json")
- **Preconditions / inputs:** `devaudit status <emptyDir>` where no `sdlc-config.json` exists.
- **Given** a directory without `sdlc-config.json` **When** `devaudit status` runs **Then** human mode prints `Inspecting <path>`, `No sdlc-config.json found here. This project is not onboarded to DevAudit.`, `Run \`devaudit install\` to onboard.`; JSON mode emits `{ ok:false, reason:"not_onboarded", projectPath }`; **exit 7** either way. No filesystem writes, no network.
- **Error paths:** A present-but-malformed `sdlc-config.json` (invalid JSON) causes `JSON.parse` to throw (not ENOENT) → propagates to the top-level handler → exit **1** (see Assumptions).
- **Fixtures/env:** Empty temp dir.

---

#### REQ-CLI-DOCTOR-001 — Tool-presence preflight gates the exit code

- **Priority:** Should — operator self-check; the gate is the required-tools result.
- **Source:** `cli/src/commands/doctor.ts` (`runDoctor`, `checkCommand`, `checkNodeVersion`); ground-truth `cli/test/doctor.test.ts`
- **Preconditions / inputs:** `devaudit doctor`. Environment `PATH`. No config required.
- **Given** any environment **When** `devaudit doctor` runs **Then** stdout shows `Running devaudit doctor — checking required tools...` then a `✓`/`✗` line for each of: `node` (`v<ver> (require >=22)`, ok iff major ≥ 22), `git --version`, `gh --version`, `jq --version`, `curl --version` (ok iff each subprocess exits 0; detail is the tool's first stdout line, or `exited <code>` / the spawn error). **If all required tools pass → `All required tools present.` and exit 0; otherwise → `One or more required tools are missing…` and exit 6.** Network: none for the tool checks themselves.
- **Error paths:** A missing tool / spawn failure marks that check `✗` and forces exit **6**. (Test accepts only 0 or 6.)
- **Fixtures/env:** Runs in a bare env; `cli/test/doctor.test.ts` asserts exit ∈ {0,6} and that `node` appears in output.
- **Update (#1089):** every child process `doctor` starts is bounded (tool probes 15 s, `gh` 20 s, `git` 15-30 s, portal calls 5 s) and reported as "timed out" or "not checked" instead of hanging; the five tool probes run in parallel and are still printed in the usual order. `DEVAUDIT_DOCTOR_TIMING=1` prints one `[doctor-timing] <check>: <ms>ms` line per check on stderr (stdout and `--json` unchanged); `devaudit update` has `DEVAUDIT_UPDATE_TIMING=1` for its sections. The CLI tests run against a stub `gh` and a failing `npm` (`cli/test/setup-hermetic-env.ts`), and a sync fixture declares the node stack's devDependencies.

#### REQ-CLI-DOCTOR-002 — Release close-out drift safety-net (non-gating; optional network)

- **Priority:** Could — advisory reconciliation; never affects the tool-gate exit.
- **Source:** `cli/src/commands/doctor.ts` (`checkReleaseCloseoutDrift`)
- **Preconditions / inputs:** Run from a consumer cwd. Reads `sdlc-config.json` and `compliance/pending-releases/` relative to the **git repo root** (resolved from cwd via `resolveRepoRoot`; changed from cwd-relative in #956, so it works from a subdirectory). Network only when slug + `devaudit.base_url` + a portal key (`DEVAUDIT_VIEWER_API_KEY`, else `DEVAUDIT_API_KEY`; REQ-CLI-DOCTOR-008) are all available.
- **Given** a consumer cwd **When** doctor runs **Then** an extra `releases` line is printed: `skipped (not a consumer project)` if no `sdlc-config.json`; `no pending-releases/` if the dir is absent; `no pending release tickets` if none match `RELEASE-TICKET-REQ-<n>.md`; `<N> pending ticket(s); portal drift check skipped (set DEVAUDIT_VIEWER_API_KEY or DEVAUDIT_API_KEY + devaudit.base_url)` when creds are missing; `<N> pending ticket(s); none released on the portal` when reconciled clean. If any pending REQ is `released` on the portal, the line is `⚠` with `released on the portal but still in pending-releases/: … — run ./scripts/close-out-release.sh <REQ>` plus a follow-up WARN. A ticket carrying `Release intent: deferred-to-next` is still a pending ticket for this line (deferred tickets stay in `pending-releases/`); the deferral-specific diagnosis is `REQ-CLI-DOCTOR-007`. **This result never changes the exit code** (gate is REQ-CLI-DOCTOR-001).
- **Network:** `GET <base>/api/ci/releases/resolve?projectSlug=<slug>&versionPrefix=<REQ>` with `Authorization: Bearer <viewer key, else DEVAUDIT_API_KEY>`, 10s abort timeout per REQ; non-2xx / timeout silently skips that REQ.
- **Error paths:** Network/timeout → that REQ skipped (no failure).
- **Fixtures/env:** `cli/test/doctor.test.ts` builds a cwd with `sdlc-config.json` + `compliance/pending-releases/RELEASE-TICKET-REQ-099.md`, unsets `DEVAUDIT_API_KEY`, and asserts output contains `pending ticket(s)` with exit ∈ {0,6}.

#### REQ-CLI-DOCTOR-003 — Plugin `onDoctor` hooks run after the built-in checks

- **Priority:** Could — only with plugins installed; non-gating.
- **Source:** `cli/src/commands/doctor.ts` (`runDoctor` plugin block); `cli/src/lib/plugin/hooks.ts`
- **Preconditions / inputs:** Discovered plugins exposing `onDoctor`.
- **Given** an installed plugin **When** doctor runs **Then** its `onDoctor` hook runs with a context scoped to `process.cwd()`; a throwing hook is caught and warned, not fatal. With no plugins, no extra output. The exit code remains governed solely by the required-tools result.
- **Error paths:** Hook throw → warning only.
- **Fixtures/env:** Plugin install dir with a test plugin.

#### REQ-CLI-DOCTOR-004 — `doctor` checks tools + specific onboarding invariants, not auth/config validity (scope note)

- **Priority:** Won't — scope note on what `doctor` deliberately does **not** do.
- **Source:** `cli/src/commands/doctor.ts` (`runDoctor`); `cli/src/index.ts` (doctor description)
- **Preconditions / inputs:** `devaudit doctor`.
- **Given** the current implementation **When** doctor runs **Then** it verifies the five required tools (REQ-CLI-DOCTOR-001) + the non-gating release-drift line (REQ-CLI-DOCTOR-002) + plugin hooks (REQ-CLI-DOCTOR-003) + the nine onboarding-invariant checks (REQ-CLI-DOCTOR-005). **Corrected 2026-10-03 (#942):** this line previously said "seven", stale since `sync-conflicts` (#930) brought the count to eight before this document was updated to match; it's nine as of `commitlint-config-shadowing` (#942). It does **not** validate the cached auth token (`~/.config/devaudit/auth.json`) or parse `sdlc-config.json` against its full JSON schema — the onboarding checks read a handful of specific fields (`e2e_regression_enabled`, `devaudit.api_key_secret`, `devaudit.viewer_api_key_secret`, `host`) and specific paths, not general config-schema validation. **Resolved doc/behaviour mismatch:** the command's registered description used to claim "auth state, config validity"; it now reads `Verify the local install: required tools on PATH (node>=22, git, gh, jq, curl), a release close-out drift check, and onboarding-checklist invariants (SRS/RTM/secrets/pre-push hook). Use --json for machine-readable output (consumed by the fleet-doctor skill).` — which matches behaviour (it omits `semgrep`, `e2e-regression`, `railway-cli`, and `commitlint-config-shadowing` from the parenthetical but does not overclaim). E2E should assert tool checks + the specific onboarding checks only.
- **Added 2026-10-11 (#956 phase 3a-2), extended 2026-10-12 (phase 3b):** besides the above, doctor also runs the seven non-gating release-deferral checks of REQ-CLI-DOCTOR-007 and -011 (reported under the additive `deferral` JSON key, so the nine-onboarding-check statement above is unchanged). Plain `doctor` stays read-only; only `--fix` (REQ-CLI-DOCTOR-010) acts, and it alone adds exit code 8.
- **Error paths:** N/A.
- **Fixtures/env:** N/A.

#### REQ-CLI-DOCTOR-005 — Onboarding-checklist invariant checks (non-gating) (#826, #867, #843/#889, #912, #942)

- **Priority:** Could — advisory onboarding diagnostics; never affects the tool-gate exit code, same non-gating shape as `REQ-CLI-DOCTOR-002`'s release-close-out-drift check.
- **Source:** `cli/src/commands/doctor.ts` (`readConsumerConfig`, `checkSrsBootstrapped`, `checkRtmInitialized`, `checkSemgrepAvailable`, `checkE2eRegressionConsistency`, `checkRequiredSecretsPresent`, `checkPrePushHookPresent`, `checkRailwayCliPresent`, `checkSyncConflicts`, `checkCommitlintConfigShadowing`); `cli/src/update/resolve-adapters.ts` (`resolveAdapters`); `cli/src/lib/adapter.ts` (`loadHostAdapter`, `HostAdapter.required_secrets?`); `cli/src/update/sync-manifest.ts` (`readManifest`)
- **Preconditions / inputs:** Run from a consumer cwd (has `sdlc-config.json` at the resolved repo root) for every check except `semgrep`, which runs unconditionally. Fifteen checks run, in this order, each printed as `✓`/`⚠ <name padded to 14> <detail>`: `srs`, `rtm`, `semgrep`, `e2e-regression`, `secrets`, `pre-push-hook`, `reconcile-cli` (`railway-cli` before #1022), `sync-conflicts`, `patch-conflicts`, `accepted-exceptions`, `commitlint-config-shadowing`, then the #1040 deploy/CI checks `deploy-host`, `production-url`, `custom-deploy`, `ci-runner` (REQ-CLI-DOCTOR-016..019).
- **Given** no `sdlc-config.json` **Then** every check except `semgrep` prints `skipped (not a consumer project)` (`ok: true`).
- **`srs`:** **Given** a consumer project **When** `docs/SRS.md` is missing **Then** `⚠` with a pointer to bootstrap from `SRS_TEMPLATE.md`, since `requirements-aligner` will refuse to proceed without it; present → `✓ docs/SRS.md present`.
- **`rtm`:** **Given** `compliance/RTM.md` is missing **Then** `⚠ compliance/RTM.md missing — expected from template sync`. **Given** it exists but has no row matching `\|\s*REQ-\d` (a header-only cell like `REQ-ID` does **not** count — this exact false-positive was caught and fixed during development, see the test) **Then** `⚠ … still the generated skeleton`; **given** at least one real `REQ-<digits>` row **Then** `✓ … has at least one requirement row`.
- **`semgrep`:** **Given** `semgrep --version` fails **Then** `⚠ not found locally (CI installs its own copy; only affects local pre-commit SAST runs)` — informational only; unlike `git`/`gh`/`jq`/`curl` (`REQ-CLI-DOCTOR-001`), no local hook depends on `semgrep` today, so this check is never in the gating `checks` array.
- **`e2e-regression`:** **Given** `sdlc-config.json.e2e_regression_enabled === true` **When** `playwright.config.ts` is missing, or is present but lacks a `critical` or `regression` project (`name:\s*['"]critical['"]`/`name:\s*['"]regression['"]` regex, mirroring `e2e-regression.yml.template`'s own detection) **Then** `⚠` names which project(s) are missing and notes the generated workflow falls back to `smoke` on PR-to-main until fixed. **Given** `e2e_regression_enabled` is unset/false but `playwright.config.ts` defines both `critical` and `regression` **Then** `⚠ … e2e_regression_enabled is not set — the full-regression safety-net workflow is not being generated despite the specs existing`. **Given** the two agree **Then** `✓ projects present, workflow enabled` / `✓ not opted in` (or `✓ skipped (no playwright.config.ts)` when neither is present).
- **`secrets` (#867, extended #843/#889, narrowed #912):** the required set is `devaudit.api_key_secret` (default `DEVAUDIT_API_KEY`), plus the resolved host adapter's own `required_secrets` (resolved via `resolveInstallerRoot` → `resolveAdapters` → `loadHostAdapter`; `DEVAUDIT_API_KEY` itself skipped since it's already covered, deduped) — e.g. `RAILWAY_TOKEN` for `host: railway` (the default when `host` is absent), nothing extra for `host: vercel`. An adapter-resolution failure is swallowed and degrades to the non-adapter set. **`DEVAUDIT_USER_TOKEN` is not in the required set (devaudit-installer#912)** — `install` no longer writes it as a repo secret (REQ-CLI-INSTALL-011), so its absence is not a gap. Runs `gh secret list --json name` in the repo root. **Given** `gh` exits non-zero **Then** `✓ skipped (gh secret list failed — not authenticated, or no repo access)`; **given** `gh` can't be spawned/parsed **Then** `✓ skipped (gh secret list unavailable)`. **Given** all required names present **Then** `✓ all required secrets present (<list>)`; **otherwise** `⚠ missing repo secret(s): <missing, comma-joined> — expected from \`devaudit install\``. Presence only — `gh secret list` never returns values.
- **`pre-push-hook`:** checks `.husky/pre-push`, then `.git/hooks/pre-push`, at the repo root. Found → `✓ present (<path>)`; neither → `⚠ no pre-push hook found under .husky/ or .git/hooks/ — bootstrap via \`devaudit install\`/\`devaudit join\``.
- **`reconcile-cli` (#843/#889, adapter-driven and renamed from `railway-cli` by #1022):** **Given** `.github/workflows/reconcile-deployment.yml` is absent (the host adapter has no `reconcile` capability, REQ-FRAMEWORK-CIYML-022) **Then** `✓ skipped (reconcile-deployment.yml not present)`. **Given** it is present and the host adapter's `reconcile.required_cli` is `null` (Vercel: the lookup is curl + jq) **Then** `✓ skipped (the host adapter's reconcile lookup needs no CLI)`. **Given** it is present and names a CLI (Railway: `railway`) **Then** runs `<cli> --version`: success -> `✓ <first stdout line>`; failure -> `⚠ <cli> CLI not found on PATH — required by reconcile-deployment.yml's recovery workflow (devaudit-installer#841); install it for whichever user/account runs self-hosted-runner jobs`. An unresolvable adapter is `✓ skipped`.
- **`sync-conflicts` (devaudit-installer#930):** reads `.devaudit/sync-manifest.json` via `readManifest`. **Given** no manifest exists yet **Then** `✓ skipped (no .devaudit/sync-manifest.json yet)`. **Given** a manifest exists with no `conflict: true` entries **Then** `✓ no unresolved sync conflicts`. **Given** one or more entries have `conflict: true` **Then** `⚠ <N> unresolved sync conflict(s): <path, path, …> — see the matching <path>.devaudit-new next to each, or re-run \`devaudit update\` for the current summary`.
- **`commitlint-config-shadowing` (devaudit-installer#942):** commitlint resolves its config via `cosmiconfig` against a fixed search-place order — `package.json`'s `commitlint` field, then `.commitlintrc`/`.commitlintrc.{json,yaml,yml,js,cjs,mjs,ts,cts}`, then `commitlint.config.{js,cjs,mjs,ts,cts}` (https://commitlint.js.org/reference/configuration.html) — and loads the **first** match found, independent of which file DevAudit manages. `checkCommitlintConfigShadowing` mirrors that fixed order (rather than shelling out to the consumer's own commitlint, which may not be installed yet) to detect a legacy config shadowing the managed `commitlint.config.mjs` — most commonly a leftover `.cjs` file, which sorts ahead of `.mjs` in that order and silently defeats the managed config's `Sdlc-Implementer-Sentinel:` exemption (#814), producing commit-msg rejections that look like a DevAudit bug. **Given** `commitlint.config.mjs` was never synced here (not a node consumer, or hooks not yet bootstrapped) **Then** `✓ skipped (commitlint.config.mjs not synced here)`. **Given** it is present and no higher-priority candidate exists **Then** `✓ only the managed commitlint.config.mjs is in effect`. **Given** a higher-priority candidate also exists (checked in the fixed order above; `package.json`'s `commitlint` key need only be present, not non-empty) **Then** `⚠ <winner> shadows the managed commitlint.config.mjs (commitlint loads the first match in: <full order list>) — remove <winner>, or merge anything it still needs into commitlint.config.mjs`.
- **`suspectedOrigin` tagging (#867):** each result may carry `suspectedOrigin: 'framework' | 'consumer-drift' | 'unknown'` — a first-pass signal the `fleet-doctor` skill re-evaluates with cross-consumer evidence, surfaced only in `--json` output (REQ-CLI-DOCTOR-006). As implemented: `srs` → `consumer-drift` on both present and missing; `rtm` → `consumer-drift` on the has-rows and skeleton branches, **untagged** on the file-missing branch; `secrets`/`pre-push-hook`/`railway-cli`/`sync-conflicts`/`commitlint-config-shadowing` → `consumer-drift` whenever they actually evaluate, `unknown` when skipped (not a consumer / `gh` unavailable / workflow absent / no manifest yet / config not synced); `semgrep`, `e2e-regression`, and the not-a-consumer skips of `srs`/`rtm`/`e2e-regression` → untagged. No check currently emits `framework`.
- **Error paths:** None of the nine checks ever set `allOk = false` or change the process exit code — only `onboardingIssues` (a separate, purely-informational flag) is set, printed as `Onboarding checklist gaps detected — see above. (Does not affect the tool check.)` after the checklist, distinct from the tool-gate `checks` array's `allOk`.
- **Fixtures/env:** `cli/test/doctor.test.ts` against the real built binary (`execa` spawning `dist/index.js`): the SRS/RTM/skeleton/e2e-regression fixture tests from #826; "reports the pre-push hook missing…" / "…present once .husky/pre-push exists"; "skips the required-secrets check gracefully outside a GitHub repo"; a fake `gh` prepended to `PATH` (`fakeGhOnPath`) for "folds the railway host adapter's RAILWAY_TOKEN into the missing-secrets report (default host)" and "does not require RAILWAY_TOKEN for a vercel host consumer" — both seed **only** `DEVAUDIT_API_KEY` and assert `DEVAUDIT_USER_TOKEN` is not mentioned (#912); "skips the railway-cli check when reconcile-deployment.yml is not present" / "reports the railway CLI missing when reconcile-deployment.yml is present but railway is not on PATH" (a node-only `PATH` so a host-installed `railway` can't leak in); #942's "skips when commitlint.config.mjs was never synced" / "reports clean when only the managed commitlint.config.mjs is present" / "warns when a legacy commitlint.config.cjs shadows the managed .mjs" / "warns when a package.json#commitlint field shadows the managed .mjs" / "--json reports commitlint-config-shadowing with a consumer-drift suspectedOrigin".
- **Update (#1099):** `secrets` no longer requires a viewer-key repo secret (none is written; a leftover one is reported as unused and removable, tier C). Two checks are appended at the end of the list: `credentials` (REQ-CLI-DOCTOR-022) and, only when `DEVAUDIT_USER_TOKEN` is set in the environment, an informational `pat-env` note (the variable name, never the value: agent sessions started from that shell inherit the PAT).

#### REQ-CLI-DOCTOR-006 — `doctor --json` machine-readable report (#867)

- **Priority:** Should — the collection contract `doctor --fleet` (REQ-CLI-FLEET-003) and the `fleet-doctor` skill parse.
- **Source:** `cli/src/commands/doctor.ts` (`runDoctor` `jsonMode` branches); `cli/src/lib/logger.ts` (`isJsonMode`, `emitJsonResult`)
- **Preconditions / inputs:** the global `--json` flag.
- **Given** `devaudit doctor --json` **When** it runs **Then** none of the human lines (`Running devaudit doctor…`, per-check `✓`/`✗`/`⚠` lines, the close-out/onboarding WARNs, `All required tools present.`) are printed; instead a single result object is emitted: `{ ok, tools, releaseCloseoutDrift, onboarding }`, where `ok` is the tool-gate result (`allOk` — tools only, unaffected by onboarding or close-out findings), `tools` is the array of the five required-tool `CheckResult`s (`node`, `git`, `gh`, `jq`, `curl`), `releaseCloseoutDrift` is the single `releases` `CheckResult`, and `onboarding` is the array of the nine onboarding `CheckResult`s in REQ-CLI-DOCTOR-005 order (the eighth being `sync-conflicts`, devaudit-installer#930; the ninth being `commitlint-config-shadowing`, devaudit-installer#942). Each `CheckResult` is `{ name, ok, detail, suspectedOrigin? }`. Plugin `onDoctor` hooks still run before the result is emitted.
- **Additive keys (#956):** the object also carries `deferral` (array of the seven REQ-CLI-DOCTOR-007/-011 `CheckResult`s; `[]` outside a consumer project) and `proposals` (REQ-CLI-DOCTOR-009), and, only with `--fix`, `fix` (REQ-CLI-DOCTOR-010). The four keys above are unchanged in name and shape.
- **Error paths:** Exit codes are identical to human mode — **0** if all required tools pass, **6** otherwise (REQ-CLI-DOCTOR-001). Onboarding or close-out findings never change the exit code in either mode (only `--fix` adds exit 8, REQ-CLI-DOCTOR-010).
- **Fixtures/env:** doctor.test.ts "--json emits a structured report including the new checks, tagged with a suspectedOrigin" — parses stdout as JSON and asserts the `onboarding` entries and their `suspectedOrigin` values.

#### REQ-CLI-DOCTOR-007 — Read-only release-deferral checks (D3, D4, D6, D7) (#956)

- **Priority:** Should — surfaces deferral mistakes (a closed release PR nobody resolved, deferred code that will ship unapproved) before they reach a release.
- **Source:** `cli/src/commands/doctor-deferral.ts` (`checkClosedReleasePr`, `checkDeferredWillShip`, `checkPredecessorsNone`, `checkBundleMembers`); `cli/src/lib/req-commits.ts`; `cli/src/lib/release-tickets.ts`
- **Preconditions / inputs:** a consumer project (`sdlc-config.json` at the repo root); tickets in `compliance/pending-releases/`. The ticket's `- **Release intent:** deferred-to-next` line is the sole declaration of deferral.
- **`release-pr-closed` (D3):** **Given** an undeclared pending ticket whose `**PR:**` line names PR #N, `gh pr view N` reports it `CLOSED` with no `mergedAt`, and the portal release is `draft`/`uat_review`/`uat_approved` **Then** `⚠` with the ticket and a tier-B remediation. Skips (ok) without `gh`/remote, without a portal key (the closed PR is reported informationally), or when the portal is unreachable.
- **`deferred-will-ship` (D4):** **Given** a deferred ticket whose `[REQ-x]`/`Ref: REQ-x` commits (skipping `Release-Closeout:`) are in `main..develop` and no non-deferred pending ticket lists it under `Absorbed predecessor releases` **Then** `⚠` "will ship unapproved". Skips when `develop` or `main` is not in the checkout.
- **`predecessors-none` (D6):** **Given** a ticket with `Absorbed predecessor releases: None` and another pending `REQ-<n>` ticket (not a `co_tracked` member of its bundle manifest) with commits in `<last tag or merge-base with main>..HEAD` **Then** `⚠`. TypeScript port of the guard in `generate-bundled-changes.sh`; `doctor.test.ts` runs both on the same fixtures.
- **`bundle-members` (D7):** **Given** a `BUNDLED-CHANGES-<core>.json` manifest **Then** `⚠` (report only, no remediation) when a `co_tracked` member ticket is still pending although the core ticket is archived (`approved-releases/`/`superseded-releases/`) or released on the portal, or when a member has its own `draft` portal release (orphan).
- **D1, D2 and D5** are specified in REQ-CLI-DOCTOR-011. **D8** is the pre-existing `releases` check (REQ-CLI-DOCTOR-002), kept as is apart from the repo-root path fix.
- **Error paths:** every check returns `ok: true` with a `skipped (…)` detail when its data source is unavailable (no `compliance/`, git ref, `gh`, key, network) and never throws. A finding sets `ok: false` for display only: **none of these checks affects the exit code** (same non-gating shape as REQ-CLI-DOCTOR-002/005).
- **Fixtures/env:** `cli/test/doctor.test.ts` — git fixture repos per situation (positive and negative), msw-mocked portal reads for D3/D7, graceful-skip cases, CRLF tickets.

#### REQ-CLI-DOCTOR-008 — Doctor portal reads use the viewer key, read-only (#956)

- **Priority:** Should — a diagnostic tool must not need (or risk) a write-capable credential.
- **Source:** `cli/src/lib/releases-api.ts` (`resolvePortalReadKey`, `resolveReleaseByPrefix`)
- **Given** doctor reads portal release state **Then** the key is `DEVAUDIT_VIEWER_API_KEY` from the environment or the repo-root `.env`, falling back to `DEVAUDIT_API_KEY`; only `GET /api/ci/releases/resolve` is called, with a 10s abort timeout; 404 means "no release", other failures mean "unavailable" (skip). The key value is never printed or returned in a result.
- **Fixtures/env:** `doctor.test.ts` asserts the `Authorization` header received by an msw/local-http portal (viewer preferred, API-key fallback, `.env`) and that the key value does not appear in output.

#### REQ-CLI-DOCTOR-009 — Additive `deferral` and `proposals` JSON surface (#956)

- **Priority:** Should — the surface `doctor --fix` (REQ-CLI-DOCTOR-010) builds on; additive so `fleet-doctor` parsing is unaffected.
- **Source:** `cli/src/commands/doctor.ts` (`runDoctor`); `cli/src/lib/doctor-types.ts`
- **Given** `doctor --json` **Then** the object also carries `deferral` and `proposals`. A finding may carry `remediation: { id, tier: 'A'|'B'|'C', summary, plan[], needsPortal }`; `proposals` is the flat list `{ check, subject, detail, remediation }` over the deferral findings and the `releases` check's drifted tickets (`close-out-release`, tier C since #984: `--fix` prints `./scripts/close-out-release.sh <REQ>` and never runs it). `remediation` may also carry `data` (string map: ticket path, portal release id, candidate REQ, ...) added in phase 3b for D1/D2/D3/D4/D5/D6. Descriptors are inert data: plain doctor performs no state change and never prompts. `--fleet` is unchanged.
- **Fixtures/env:** `doctor.test.ts` asserts the original keys and their shapes are unchanged and the new keys are present.

#### REQ-CLI-DOCTOR-010 — `doctor --fix`: tiered, confirmed, idempotent repair (#956)

- **Priority:** Should — turns the diagnosis into a safe, auditable repair path for deferral drift.
- **Source:** `cli/src/commands/doctor-fix.ts` (`runFix`), `cli/src/commands/doctor.ts` (`runDoctor` `fix` option), `cli/src/index.ts` (`--fix`, `--reason <text>`; `--yes`/`--dry-run`/`--json` are the global flags), `cli/src/lib/ticket-edit.ts`
- **Preconditions / inputs:** `devaudit doctor --fix [--yes] [--reason <text>] [--dry-run] [--json]` inside a consumer project; acts on the run's `proposals`.
- **Tier A** (local, reversible: write the ticket `Release intent` line and RTM `DEFERRED` row for D2, list a predecessor for D4/D6; since #1040 also `set-config`, the `host` fix from REQ-CLI-DOCTOR-016, validated like `configure set` and reporting `unchanged` when already set): **Given** a proposal **Then** it is applied after an interactive confirmation or with `--yes`; with no TTY, `CI` set or `--json` and no `--yes` it stays unapplied. Edits are idempotent: a second run proposes and changes nothing. **Tier B** (portal defer/resume for D1/D3/D5, and since #1099 WP3b `issue-viewer-key`): **Then** it needs the operator's PAT (REQ-CLI-DOCTOR-013), a typed reason **and** an explicit confirmation at an interactive terminal; `--yes` and `--reason` never replace either and there is no non-interactive path (#1099 WP5). It is `applied` only when the portal answers with its confirming JSON `status`; a redirect, an HTML or `status`-less 2xx is a `failed` outcome ("this portal route does not accept a personal access token; use the portal UI"). **Tier C**: printed, never executed (D4 revert commands, the `close-out-release` command). **D5 resume (#984):** a stale deferral is a decision, not a default: interactively the operator picks resume / extend / abandon (only resume calls the portal; extend and abandon are guidance and stay unapplied); non-interactively it is never applied, so one reason given for another proposal never resumes every stale deferral.
- **`--dry-run`** prints each step as `planned`, changes nothing and exits 0. D3 offers defer / abandon / reopen interactively (abandon and reopen are guidance only); portal changes (tier B) are never applied non-interactively (#1099 WP5). A successful resume also removes the ticket's `Release intent` and flips a `DEFERRED` RTM row back to `TESTED - PENDING SIGN-OFF` (assumption: the pre-deferral status).
- **Exit codes:** `0` all applied (or `--dry-run`), `8` proposals remain unapplied (no TTY, declined/cancelled confirmation, `CI` without `--yes` for tier A, a tier B proposal without an interactive terminal, failed portal call, guidance-only proposal; tier C does not count), `6` still wins when a required tool is missing, `2` for `--fleet` with `--fix`/`--reason` and for `--reason` without `--fix`. Plain `doctor` is unchanged (REQ-CLI-DOCTOR-001).
- **JSON:** `--fix --json` adds `fix: { dryRun, outcomes[{ id, check, subject, tier, status, message, uatApprovalIdsAtDefer? }], unapplied }`; it never prompts. After a portal defer the ids the portal returns are printed and kept in the outcome; the portal itself records them in its audit field `uat_approval_ids_at_defer`.
- **Error paths:** a portal 401/403/404/409/422, a 3xx sign-in redirect or non-JSON reply (`unsupported-auth`; the client uses `redirect: 'manual'`), timeout or missing PAT yields a `failed` outcome (counts as unapplied, exit 8) and never prints a secret.
- **Fixtures/env:** `cli/test/doctor-fix.test.ts` (spawns the built binary against a local portal stub: tiers A/B, `--dry-run`, `--yes` and `--yes --reason` never applying tier B, `CI`/no-TTY exit 8, the `pat-env` note and no PAT on read-only portal calls, idempotent second run, API/viewer-key refusal, 403/409/422, `--fleet` rejection, JSON shape; `runFix` with injected prompts for declined/cancelled confirmation and D3 choices); `cli/test/ticket-edit.test.ts`.

#### REQ-CLI-DOCTOR-011 — Checks D1, D2, D5 and `deferral_max_age_days` (#956)

- **Priority:** Should — closes the ticket/portal disagreement cases that read-only D3-D8 could not see.
- **Source:** `cli/src/commands/doctor-deferral.ts` (`checkDeferredTicketNotOnPortal`, `checkPortalDeferredNotInTicket`, `checkStaleDeferrals`); `cli/src/lib/sdlc-config.ts` (`readDeferralMaxAgeDays`); `cli/src/lib/releases-api.ts` (resolve now also parses `id`, `deferredAt`, `deferredReason`, `deferredUntil`, `deferredToVersion`)
- **`deferred-portal-sync` (D1):** **Given** a pending ticket with `Release intent: deferred-to-next` whose portal release is `draft`/`uat_review`/`uat_rejected`/`uat_approved` **Then** `⚠` with a tier-B `defer-portal-release` proposal. Releases already `deferred`, in a non-deferrable state (e.g. `released`) or not found are clean.
- **`deferred-ticket-sync` (D2):** **Given** an undeclared pending `REQ-<n>` ticket whose portal release is `deferred` **Then** `⚠` with a tier-B `resolve-undeclared-deferral` proposal carrying the portal's `deferredReason` and release id (#1083; it was a tier-A `mark-ticket-deferred` proposal before, which recorded a possibly accidental deferral in the repo). Under `--fix` it is applied only after an interactive choice of *record* (ticket `Release intent` + RTM `DEFERRED`, no portal call), *resume* (portal resume with the admin PAT and a typed reason; the release returns to draft, the superseded UAT approvals are not restored) or *leave*; it is never decided non-interactively, even with `--yes --reason`.
- **`deferral-age` (D5):** **Given** a `deferred` portal release deferred more than `deferral_max_age_days` ago (`deferredAt`) or past `deferredUntil` **Then** `⚠` with a tier-B `resume-stale-deferral` proposal (extend and abandon are listed as manual alternatives). Under `--fix` it is applied only after an interactive choice of *resume* (#984).
- **`deferral_max_age_days`:** top-level `sdlc-config.json`, a positive integer, default **30**; any other value falls back to 30 and the check notes it.
- **Error paths:** all three skip (`ok: true`, `skipped (…)`) without `compliance/pending-releases/`, without a portal key (viewer key preferred, `DEVAUDIT_API_KEY` fallback) or when the portal is unreachable; findings never change plain doctor's exit code.
- **Fixtures/env:** `cli/test/doctor-deferral-3b.test.ts` (msw portal; fixed clock for D5).

#### REQ-CLI-DOCTOR-012 — TTY/CI/`--json`-aware prompt helper (#956)

- **Priority:** Could — internal helper with a hard safety contract.
- **Source:** `cli/src/lib/prompt.ts` (`confirm`, `input`, `select`, `canPrompt`, `nonInteractiveReason`)
- **Given** stdin and stdout are TTYs, `CI` is unset (or `0`/`false`) and `--json` is off **Then** the helper prompts (clack). **Given** `--json`, no TTY or `CI` set **Then** it returns `null` without touching the terminal and the caller must treat the proposal as unapplied unless `--yes`/`--reason` were given. Cancel (Ctrl-C) and empty text also return `null`; a declined confirmation returns `false`. A question that looks like it asks for a secret (token, password, API key…) is refused with an error: secrets are never read through prompts.
- **Fixtures/env:** `cli/test/prompt.test.ts` (injectable driver and environment; every mode).
- **Update (#1099):** tier B portal changes (defer, resume, issuing a viewer key) use this helper but are interactive-only: a non-interactive run (`--json`, no TTY, `CI`) never applies them, even with `--yes --reason`. `--reason` supplies the reason text; the terminal confirmation is still asked.

#### REQ-CLI-DOCTOR-013 — Portal defer/resume client, PAT only (#956)

- **Priority:** Should — the only code that mutates portal release state; admin-only by design (ADR-002).
- **Source:** `cli/src/lib/release-deferral-api.ts` (`resolveDeferralCredential`, `deferRelease`, `resumeRelease`); `cli/src/lib/auth.ts` (`resolveToken`)
- **Given** a PAT (`DEVAUDIT_USER_TOKEN` or the `devaudit auth login` cache) **Then** `POST {base}/api/releases/{id}/defer` / `/resume` is sent with header `X-DevAudit-Token: <PAT>` and a minimal JSON body (`reason`, optional `untilDate`, `toVersion`); 15s abort timeout. **Given** only `DEVAUDIT_API_KEY`/`DEVAUDIT_VIEWER_API_KEY` (or one of them placed in `DEVAUDIT_USER_TOKEN`) **Then** `DeferralCredentialError` is thrown before any request. HTTP 401, 403 (not an admin), 404, 409 (wrong state), 422 and 5xx map to typed `DeferralApiError`s with explicit messages; timeouts and network failures are typed too. No token or key value appears in any message (a server echo of the token is redacted).
- **Request shape (verified 2026-10-12 against the portal route handlers `app/api/releases/[id]/defer|resume/route.ts`):** PAT header `X-DevAudit-Token`; defer body `{ reason, deferredUntil?, deferredToVersion? }` (the client's earlier `untilDate`/`toVersion` names were wrong and silently ignored by the portal; fixed in #983); resume takes no body fields (an optional `reason` is ignored). The portal returns 400 for validation **and** wrong-state errors and 409 only for a concurrent change. The release id is `latest.id` from `GET /api/ci/releases/resolve`. `uat_approval_ids_at_defer` is recorded by the portal in its audit event; the client only prints it if the response carries it.
- **Fixtures/env:** `cli/test/release-deferral-api.test.ts` (msw; fake tokens only).
- **Update (#1099 WP5):** the client sends `redirect: 'manual'`. A 3xx (the portal's sign-in redirect for a PAT on a session-only route), a non-JSON body, or a 2xx without the portal's JSON `status` is an error of kind `unsupported-auth` ("this portal route does not accept a personal access token; use the portal UI"), never a success; `doctor --fix` reports `applied` only on a confirming response. Defer and resume are session-only on the portal until metasession-dev/devaudit#923.

#### REQ-CLI-DOCTOR-014 — `patch-conflicts`: persisted, doctor-visible consumer-patch conflicts (#1023)

- **Priority:** Should — a skipped patch is correct (#921/#923) but was only ever reported as one warning line in that sync's output, so a consumer-side fix could silently revert to the upstream template (a consumer).
- **Source:** `cli/src/update/consumer-patches.ts` (returns `patchConflicts`); `cli/src/update/index.ts` (rebuilds the manifest `patches` map each sync, keeping `detected_at` while a patch stays in conflict); `cli/src/update/sync-manifest.ts` (`PatchConflictEntry`, optional `patches`, omitted when empty, keys sorted); `cli/src/commands/doctor.ts` (`checkPatchConflicts`, listed in the `onboarding` JSON array).
- **Given** a consumer whose last sync skipped `.devaudit-patches/x.patch` because it no longer applies cleanly **When** `devaudit doctor` runs **Then** the `patch-conflicts` check reports `⚠ <N> consumer patch(es) no longer apply cleanly and are being skipped — … <name> (see <upstream_issue>) since <detected_at>` plus the pointer `docs/consuming-projects.md#re-rolling-a-conflicting-patch`. **Given** no patch is in conflict **Then** `✓ no consumer patches in conflict`. **Given** no `.devaudit/sync-manifest.json` exists yet or the directory is not a consumer project **Then** `✓ skipped (…)`. **Given** the patch later applies, becomes obsolete, or is deleted **When** the next `update` runs **Then** its `patches` entry is gone.
- **Error paths:** never gating — the check never changes `doctor`'s exit code (same as `sync-conflicts`); a corrupt manifest reads as "no manifest".
- **Fixtures/env:** `cli/test/doctor.test.ts` (conflict listed with upstream issue; clean; no manifest), `cli/test/consumer-patches.test.ts` (`patchConflicts` returned / empty), `cli/test/sync-manifest.test.ts` (round-trip, sorted, omitted when empty).

#### REQ-CLI-DOCTOR-015 — `accepted-exceptions`: overdue accepted E2E failures and dependency risks (#1016, #1017)

- **Priority:** Should — an accepted exception is time-boxed; without this it quietly becomes permanent.
- **Source:** `cli/src/commands/doctor.ts` (`checkAcceptedExceptions`, `findOverdueExceptions`; listed in the `onboarding` JSON array); `cli/src/update/issue-labels.ts` (seeds the `accepted-e2e-failure` and `accepted-dependency-risk` labels).
- **Given** `compliance/security/accepted-vulnerabilities.json` **When** `devaudit doctor` runs **Then** every entry that has expired, has no valid `expiresAt`, or expires within 14 days is reported as `dependency exception <advisory> (<package>) …` (no `gh` needed). **Given** open issues labelled `accepted-e2e-failure` or `accepted-dependency-risk` **When** `devaudit doctor` runs **Then** each whose body has no `Review by: YYYY-MM-DD` date, or whose date is today or earlier, is reported (`⚠ <N> accepted exception(s) overdue for review: #N (label) review date D has passed; …`). **Given** none are overdue **Then** `✓`. **Given** `gh` is missing, unauthenticated or the directory is not a consumer project **Then** `✓ skipped (…)`.
- **Error paths:** never gating. The portal-side half (unresolved failed regression executions) is read by `fleet-doctor`.
- **Fixtures/env:** `cli/test/doctor.test.ts` (`findOverdueExceptions` unit test; a fake `gh issue list`).

#### REQ-CLI-DOCTOR-016 — `deploy-host`: the recorded host matches where production really deploys (#1040)

- **Priority:** Should — `install` hardcoded `host: railway` before 1.9.0, so a project deploying elsewhere silently got the Railway workflows and checks.
- **Source:** `cli/src/lib/deploy-detect.ts` (`detectDeployHost`); `cli/src/commands/doctor-config.ts` (`deployHostCheck`); applied by `doctor-fix.ts` case `set-config`.
- **Given** `gh api repos/{owner}/{repo}/deployments` lists production deployments (environment matching `/prod/i`) **Then** each creator maps to a host (`vercel[bot]` -> vercel, the Railway app -> railway, `github-actions[bot]` -> custom) with weight `3 + min(count, 5)`; committed files add weight (`vercel.json`, `.vercel/project.json`, `railway.json`, `railway.toml`, `fly.toml` 2; `serverless.yml`, `appspec.yml`, `terraform/`, `k8s/`, `helm/` 1). The highest total is the detected host; confidence is `low` when the runner-up is within 3, else `high` with deployment evidence, else `medium`. The latest production deployment's `environment_url` is kept for REQ-CLI-DOCTOR-017.
- **Given** a detected host that differs from the recorded one with `high`/`medium` confidence **Then** the check is not ok and carries a tier A `set-config` remediation (`data: {key: host, value}`); `doctor --fix` applies it after confirmation or `--yes` through `planConfigChange`/`writeConfigValue` (REQ-CLI-CONFIGURE-002) and reports the follow-ups (secrets the new host needs). **Given** `low` confidence **Then** ok with a "mixed evidence" note and no proposal. **Given** no evidence **Then** ok.
- **Error paths:** never gating; `gh` failures are listed as "not checked".
- **Fixtures/env:** `cli/test/repo-configure.test.ts` (fake `gh`).

#### REQ-CLI-DOCTOR-017 — `production-url`: the production URL secret, and an access-gated origin (#1040)

- **Priority:** Should — without the URL secret the post-deploy probe has nothing to check; a 401 from an access-gated origin fails it for a healthy deployment.
- **Source:** `cli/src/commands/doctor-config.ts` (`productionUrlCheck`).
- **Given** no `production_url_secret` **Then** not ok, guidance `devaudit configure set production_url_secret`. **Given** it is set but `gh secret list` lacks it **Then** not ok, guidance `devaudit configure secret <NAME>`. **Given** a production `environment_url` that answers `401`/`403`/`407` to an unauthenticated `HEAD` (8 s timeout) and no `DEVAUDIT_PROBE_HEADER` secret **Then** not ok, naming the secret. Secret values are never read.
- **Error paths:** never gating; unreadable secrets are noted, not failed.
- **Fixtures/env:** `cli/test/repo-configure.test.ts`.

#### REQ-CLI-DOCTOR-018 — `custom-deploy`: the custom host's deploy settings (#1040)

- **Priority:** Should — `deploy-custom.yml` fails every run without a `deploy_command`, and silently drops invalid `deploy_secrets` names.
- **Source:** `cli/src/commands/doctor-config.ts` (`customDeployCheck`).
- **Given** host `custom` **Then** not ok for: no `deploy_command`; a `deploy_secrets` entry that is not `^[A-Z][A-Z0-9_]*$` or not a repo secret; a non-https `deployed_sha_url`; a `deploy_trigger` outside `push_to_main|git_tag|manual`. Ok notes whether the deploy is SHA-verified or health-check only. **Given** any other host **Then** `skipped`.
- **Fixtures/env:** `cli/test/repo-configure.test.ts`.

#### REQ-CLI-DOCTOR-019 — `ci-runner`: the CI runner exists (#1040)

- **Priority:** Could — a label no runner carries leaves every job queued.
- **Source:** `cli/src/commands/doctor-config.ts` (`ciRunnerCheck`).
- **Given** `runner: self-hosted` (or no `runner`) **Then** the label is the repo variable `CI_RUNNER_LABEL`, else `github-ci`. **Given** `github-ci` or an `ubuntu-`/`windows-`/`macos-` label **Then** ok (GitHub-hosted). **Given** another label and a readable `actions/runners` list with no runner carrying it **Then** not ok (organization runners are not visible, which the detail says). **Given** the list is not readable **Then** ok, "not checked".
- **Fixtures/env:** `cli/test/repo-configure.test.ts`.

#### REQ-CLI-CONFIGURE-001 — `devaudit configure list` / `get` (#1040)

- **Priority:** Should — the operator needs to see which keys matter for their host before changing one.
- **Source:** `cli/src/commands/configure.ts` (`runConfigureList`, `runConfigureGet`); `cli/src/lib/repo-config-keys.ts` (`CONFIG_KEYS`).
- **Given** a consumer repo **When** `configure list` runs **Then** every managed key is printed with its value, keys for other hosts hidden, `[required by host]` marked from the host adapter's `config_keys.required`; `--json` returns `{repoRoot, host, hosts, keys[]}` with `type`, `description`, `allowed`, `hosts`, `requiredByHost`, `applies`, `changeWith`. **When** `configure get <key>` runs **Then** the value, meaning, allowed values (for `host`, the shipped adapters) and owner command are shown; an unmanaged key is shown with "not a key `devaudit configure` manages".
- **Error paths:** no readable `sdlc-config.json` -> error naming `devaudit install`.
- **Fixtures/env:** `cli/test/repo-configure.test.ts`.

#### REQ-CLI-CONFIGURE-002 — `configure set` validates before writing (#1040)

- **Priority:** Must — hand-edited config produced workflows that never matched the repo.
- **Source:** `cli/src/commands/configure.ts` (`planConfigChange`, `writeConfigValue`, `runConfigureSet`); `cli/src/lib/repo-config-keys.ts` (`parseConfigValue`).
- **Given** an unknown key, `e2e_regression_enabled` (owned by `update --enable/--disable-e2e-regression`), a value of the wrong type, a value outside the key's enum, an invalid secret name, a non-https `deployed_sha_url`, an empty required string, or a `host` that is not a shipped adapter **Then** nothing is written and the exit code is `2`. **Given** a key that only applies to another host **Then** a warning. **Given** a valid change **Then** the file is rewritten with the same key order and two-space indentation, and the output lists the generated files the next `devaudit update` regenerates (for `host`: added/removed `reconcile-deployment.yml` and `deploy-custom.yml`, plus `post-deploy-prod.yml`) and follow-ups (keys the host requires that are unset; secrets the host, `production_url_secret` or `deploy_secrets` need, each with its `configure secret` command).
- **Fixtures/env:** `cli/test/repo-configure.test.ts`.

#### REQ-CLI-CONFIGURE-003 — Contradicted values need a reason; `--dry-run` writes nothing (#1040)

- **Priority:** Must — the point of the command is that a change makes sense for the repo.
- **Source:** `cli/src/commands/configure.ts` (`planConfigChange` `contradiction`, `runConfigureSet`).
- **Given** `set host <x>` while REQ-CLI-DOCTOR-016's detection points elsewhere with `high`/`medium` confidence **Then** interactively the operator must confirm and type a reason; non-interactively it needs `--reason`, else exit `8` and nothing written; the reason is printed with the result. `low` confidence is a warning only. **Given** an uncontradicted change **Then** interactive runs confirm (skipped by `--yes`); non-interactive runs apply. **Given** `--dry-run` **Then** validation, impact and follow-ups are printed and nothing is written (exit `0`).
- **Fixtures/env:** `cli/test/repo-configure.test.ts`.

#### REQ-CLI-CONFIGURE-004 — `configure secret` never sees the value (#1040)

- **Priority:** Must — secrets must not pass through devaudit, logs or an AI conversation.
- **Source:** `cli/src/commands/configure.ts` (`runConfigureSecret`, `knownSecretPurpose`).
- **Given** a name that is not `^[A-Z][A-Z0-9_]*$` **Then** exit `2`. **Given** a valid name **Then** its purpose is explained (production URL, probe header, portal key, host adapter requirement, reconcile secret, `deploy_secrets` entry) or a warning says nothing generated reads it; without a TTY (or with `CI`/`--json`) it refuses with exit `8` and suggests `gh secret set`; `--dry-run` prints the command; otherwise it runs `gh secret set <NAME>` with the terminal attached (gh's masked prompt) and returns gh's result.
- **Fixtures/env:** manual (interactive); name validation and purpose covered by unit tests.

#### REQ-CLI-DOCTOR-026 — `doctor --explain <check>` (#1116 WP8)

- **Priority:** Should — a finding named only by a check id is hard to act on; the same plain words the gaps carry should be readable on demand.
- **Source:** `cli/src/commands/doctor-guided.ts` (`renderExplanation`, `runExplain`); `cli/src/lib/doctor-explain.ts` (`CHECK_EXPLANATIONS`).
- **Given** `devaudit doctor --explain <check>` for a check doctor can emit **Then** it prints the title, why it matters, the options (including leaving it as it is) with their fix tier, and the standards clauses affected when known; it reads and changes nothing and exits 0. **Given** an unknown name **Then** it lists the checks and exits 2. A test fails when a check doctor can emit has no entry.
- **Fixtures/env:** `cli/test/doctor-guided.test.ts` ("--explain"); `cli/test/doctor-gaps.test.ts`.

#### REQ-CLI-DOCTOR-027 — `doctor --guided` walks the gaps and only offers (#1116 WP8)

- **Priority:** Should — fixing a project is a conversation, and a person must be able to decline every step without it being an error.
- **Source:** `cli/src/commands/doctor-guided.ts` (`runGuided`, `orderGaps`); `cli/src/commands/doctor.ts` (`runDoctorGuided`); `cli/src/commands/doctor-fix.ts` (`runFix`).
- **No terminal. Given** no TTY, `CI` set or `--json` **Then** nothing is prompted or changed, a message says so and the exit code is 8; it never falls back to applying fixes.
- **Leaving and stopping. Given** a gap **Then** the person may choose a fix, "leave this as it is" (recorded nowhere; the next run reports it again) or "stop" (the rest is left). A summary of fixed, left and still-open gaps is printed. The exit code is 0 when there were no gaps or every gap was fixed or left; 8 only when a chosen fix was declined, refused or failed.
- **Neutral options. Given** any gap **Then** the options are listed with their tier and compliance consequence, and "leave this as it is" is always among them.
- **Scope and order. Given** `--guided` **Then** every gap is covered; `--guided <check>` covers that check only (an unknown check exits 2). Gaps with a compliance consequence come first (most clauses first), then gaps with a fix, guidance-only gaps last.
- **Same safeguards. Given** a chosen fix **Then** it is applied by `runFix`, the code behind `--fix`, with `yes: false`: tier A is confirmed, tier B needs an interactive terminal, a typed reason and a confirmation, tier C is printed. `--guided` with `--fix`, `--yes`, `--reason`, `--explain` or `--fleet` is refused with exit 2.
- **Re-check. Given** an applied fix **Then** the check and every check that depends on it (`CHECK_DEPENDENTS`) are run again and the new state is shown; a fix that does not clear the gap is reported as such and stays in the still-open list.
- **Fixtures/env:** `cli/test/doctor-guided.test.ts` ("--guided", "the command line").

#### REQ-CLI-DOCTOR-028 — `preset-drift` (#1116 WP8)

- **Priority:** Should — a preset is only a promise while the configuration still matches it.
- **Source:** `cli/src/commands/doctor-onboarding.ts` (`presetDriftCheck`).
- **Given** no `onboarding_preset`, or `custom` **Then** the check reports nothing (decision 12). **Given** a recorded preset **Then** every key the preset writes that differs, and every key of another preset left behind, is a finding with the closest preset named when another fits better (for preset D, `post_deploy_full_regression: true` is drift with C closest); a value difference has a tier A `set-config` repair, and one more repair records the project as `custom`. **Given** a gate (`release_gate_tier`) with no tests of that tier **Then** it is a finding too.
- **Fixtures/env:** `cli/test/doctor-guided.test.ts` ("preset-drift").

#### REQ-CLI-DOCTOR-029 — `standards-fit` (#1116 WP8)

- **Priority:** Should — a project that needs SOC 2 or ISO 27001 evidence should know when its approval settings leave clauses uncovered.
- **Source:** `cli/src/commands/doctor-onboarding.ts` (`standardsFitCheck`).
- **Given** `compliance_frameworks` includes `soc-2` or `iso-27001` and `approval.mode` is `solo_with_gap` **Then** a finding names `SOC2.CC8.1` and `ISO27001.A.8.32` as a recorded gap. **Given** the portal lists the project's claimed standards **Then** a difference with `compliance_frameworks` in either direction is a finding. It never says a project is compliant.
- **Fixtures/env:** `cli/test/doctor-guided.test.ts` ("standards-fit").

#### REQ-CLI-DOCTOR-030 — `approval-policy` (#1116 WP8)

- **Priority:** Should — the repository and the portal must agree on who may approve a release.
- **Source:** `cli/src/commands/doctor-onboarding.ts` (`approvalPolicyCheck`); `cli/src/lib/onboarding-portal.ts` (`readApprovalPolicy`).
- **Given** the portal reports the project's approval policy (read with the viewer key) **Then** `approval.mode` `solo_with_gap` must match `self_allowed_with_gap` and `dual_actor` must match `independent`; a mismatch is a finding. **Given** the portal does not report a policy or cannot be read **Then** the check passes with a line saying it was not compared.
- **Fixtures/env:** `cli/test/doctor-guided.test.ts` ("approval-policy").

#### REQ-CLI-DOCTOR-031 — `durations` (#1116 WP8)

- **Priority:** Should — the release gate that is practical depends on how long the groups take.
- **Source:** `cli/src/commands/doctor-onboarding.ts` (`durationsCheck`).
- **Given** `gh` and successful runs **Then** the median duration of each job over the last 10 successful runs of `ci.yml` and `e2e-regression.yml` is reported; otherwise "not measured yet". It never fails.
- **Fixtures/env:** `cli/test/doctor-guided.test.ts` ("durations").

#### REQ-CLI-CONFIGURE-005 — `devaudit configure` with no arguments (#1116 WP7)

- **Priority:** Should — changing a preset, the release gate or the approval mode later should be the same guided conversation as the install, not a list of `set` commands.
- **Source:** `cli/src/commands/configure-guided.ts` (`runConfigureGuided`, `diffGuided`); `cli/src/install/guided.ts` (`runGuided`); `cli/src/index.ts`.
- **Given** a terminal and an `sdlc-config.json` **When** `devaudit configure` runs with no subcommand **Then** the preset question defaults to the project's current preset (or "Keep my current settings" when none is recorded), the express summary is shown with the current values, and the answers are compared with the file. **Then** the changes are listed as `key: before -> after`, keys the new preset does not write as `removed`, and the generated files the next `devaudit update` regenerates; after one confirmation only those keys are written (siblings of a dotted key such as `approval.auto_low_risk_threshold` are kept). No change means no write ("Nothing to change").
- **Given** a switch between presets in either direction **Then** exactly the target preset's keys are written and the keys it does not write are removed (C to A leaves no `release_gate_tier`, `post_deploy_full_regression` or `scheduled_full_regression`); C to D writes `post_deploy_full_regression: false` and D to C writes it back, with the recorded preset the only other change.
- **Given** a change that enables a test tier (the release gate question, or moving to preset B, C or D) and no `e2e_data_isolation` **Then** Q18 is asked straight away and its answer appears in the same summary. A change to `release_branch_required_reviews` ends with the reminder to run `devaudit update`, which applies it to GitHub through the existing confirmation.
- **Fixtures/env:** `cli/test/configure-guided.test.ts`.

#### REQ-CLI-CONFIGURE-006 — No terminal, a declined confirmation and the portal policy (#1116 WP7)

- **Priority:** Should — a command that asks questions must not guess in a script, and must not say "I approve my own" while the portal blocks it.
- **Source:** `cli/src/commands/configure-guided.ts` (`NO_TERMINAL_MESSAGE`, `runConfigureGuided`); `cli/src/lib/onboarding-portal.ts` (`setApprovalPolicy`).
- **Given** no TTY, `CI` set or `--json` **Then** nothing is asked or written and the command prints "`devaudit configure` without arguments asks questions; run it in a terminal, or use `devaudit configure set <key> <value>`." and exits 8. A declined confirmation writes nothing and exits 8; an unreadable `sdlc-config.json` exits 1.
- **Given** an approval-policy change **Then** it is a portal action with the personal token after the confirmation. **Given** the portal refuses a solo policy **Then** `approval.mode`, `release_branch_required_reviews` and `onboarding_preset` are not written, one line says why, and the rest of the change is written.
- **Fixtures/env:** `cli/test/configure-guided.test.ts`; `cli/test/paths-overrides.test.ts` (the per-user folder overrides).

#### REQ-CLI-CONFIGURE-007 — Dotted keys, and the onboarding, approval and test-data keys (#1116 WP2)

- **Priority:** Should — the guided install, `configure` and `doctor` of the onboarding work read and write these settings; a dotted key must not clobber the rest of its section, and every new key needs the same validation as the existing ones.
- **Source:** `cli/src/lib/config-path.ts` (`getConfigPath`, `setConfigPath`, `deleteConfigPath`); `cli/src/lib/repo-config-keys.ts` (the new `CONFIG_KEYS` entries, `COMPLIANCE_FRAMEWORK_CODES`); `cli/src/commands/configure.ts` (every read and write of a value goes through the path helpers).
- **Given** a key with a dot, for example `approval.mode` **Then** `configure get` and `set` read and write `cfg.approval.mode`: a write keeps the section's other fields (`approval.auto_low_risk_threshold`) and the file's key order, creates a missing section, and replaces a section that is not an object. A key with no dot behaves exactly as before.
- **Given** `configure set` with one of these keys **Then** it is validated like the others: `approval.mode` is `dual_actor` or `solo_with_gap` (`auto_low_risk` is not implemented and is refused); `production_review.terminal_status` is `prod_review` or `released`; `release_branch_required_reviews` is a whole number from 0 to 2; `compliance_frameworks` is a list of `soc-2`, `iso-27001`, `iso-29119`, `gdpr`, `eu-ai-act` (empty allowed); `onboarding_preset` is `A`, `B`, `C`, `D` or `custom`; `e2e_data_isolation` is `none`, `ephemeral`, `shared_serialised` or `shared`; `e2e_seed_paths` and `feature_e2e_projects` are lists; `e2e_reset_command`, `e2e_preflight_command` and `e2e_leak_check_command` are one line of at most 500 characters (empty unsets); `e2e_max_skipped` is 0 or more. None claims a generated file (they are read by skills, by branch protection or by later work packages), so `set` regenerates nothing for them.
- **Given** `release_branch_required_reviews` **Then** the follow-up says to run `devaudit update` to apply it, that lowering an existing branch asks for a confirmation, and, for 0, that the author can then merge their own release PR (a recorded control gap). **Given** `approval.mode: solo_with_gap` **Then** the follow-up says a self-approved release is a recorded control gap and the portal's approval policy must allow it.
- **Error paths:** an invalid value exits `2` and writes nothing, as for every key.
- **Fixtures/env:** `cli/test/config-keys-1116.test.ts`.

#### REQ-CLI-ONBOARD-001 — The four onboarding presets are data in the core, and `docs/presets.md` is generated from them (#1116 WP5)

- **Priority:** Should — install, configure, scan and the portal's onboarding page must offer the same presets with the same meaning, and a document that is typed by hand drifts from the code.
- **Source:** `core/src/presets.ts` (`PRESETS`, `PRESET_IDS`, `PRESET_CONFIG_KEYS`, `MOMENTS`, `CUSTOM_PRESET`); `core/src/presets-doc.ts` (`renderPresetsMarkdown`); `cli/tools/generate-presets-doc.mjs` (`npm run docs:presets`, `-- --check`); `docs/presets.md`.
- **Given** the preset data **Then** it holds A (solo, fast feedback), B (safety net), C (team with a compliance lead) and D (full gate, tested once; C with `post_deploy_full_regression: false`, written explicitly). Each has the configuration it writes by dotted key (`onboarding_preset`, `e2e_regression_enabled`, `release_gate_tier`, `post_deploy_full_regression`, `scheduled_full_regression`, `approval.mode`, `release_branch_required_reviews`, `production_review.terminal_status`; A does not write the three release-gate keys, so switching to A removes them), the portal approval policy (`self_allowed_with_gap` for A and B, `independent` for C and D), what runs at each of the five moments, the evidence produced, the gap carried, the sentence the CLI shows for it (`gapText`), the clauses with a recorded gap (`SOC2.CC8.1` and `ISO27001.A.8.32` for A and B, none for C and D) and what it needs before it is offered. `custom` is always offered and has no data of its own. The data and its texts never say a project is "compliant".
- **Given** `docs/presets.md` **Then** it is exactly `renderPresetsMarkdown()`; `npm run docs:presets` in `cli/` rewrites it and `-- --check` exits 1 when it differs, and a test fails when the committed file differs.
- **Given** each preset's configuration **Then** `devaudit configure set` accepts every key and value, and the workflows generated from it match the "what runs when" table: A has no `e2e-regression.yml`; B selects `critical` on the release pull request and runs the full pack after deploy and nightly (`0 2 * * *`); C selects `full` and does the same; D selects `full` and has no `deployment_status` trigger. A preset with `approval.mode: dual_actor` has the `independent` policy and the reverse.
- **Fixtures/env:** `core/test/presets.test.ts`; `cli/test/presets-registry.test.ts`.

#### REQ-CLI-ONBOARD-005 — One suggestion rule for scan, install and doctor (#1116 WP5)

- **Priority:** Should — the three commands must recommend the same preset for the same facts, and must never recommend one that cannot be offered.
- **Source:** `core/src/presets.ts` (`suggestPreset`, `offerPresets`).
- **Given** the test groups found, the standards chosen and whether the portal allows a solo approver (`yes`, `no`, `unknown`: a scan makes no portal call) **Then** `offerPresets` says which presets can be offered: A needs a solo approver; B needs that and smoke tests; C and D need a full test pack and carry the note "needs a second portal admin". With `unknown`, A and B are offered with the note "needs portal support for a solo approver".
- **Given** `suggestPreset` **Then** the rule is: no smoke tests, A; else SOC 2 or ISO 27001 chosen and a full pack, C; else those standards and no full pack, B (the reason says C needs a full test pack); else critical or full tests, B; else A. A preset that is not offered is replaced by the next one down (C, B, A) that is; when none is, the suggestion is `custom` with the reason. It never returns D. The reason is one sentence naming the rule's inputs; when C is suggested and D is offered it adds that D is the same without the full regression after deploy.
- **Fixtures/env:** `core/test/presets.test.ts` ("which presets are offered", "suggestPreset").

#### REQ-CLI-ONBOARD-006 — The question registry is data in the core (#1116 WP5)

- **Priority:** Should — install, configure and the portal's web form render the same questions from one table.
- **Source:** `core/src/registry.ts` (`QUESTIONS`, `questionsToAsk`, `conditionHolds`, `questionById`).
- **Given** the registry **Then** it holds Q0a to Q21 in order, each with `id`, `group`, `prompt`, `why`, `kind` (`select`, `multiselect`, `text`, `confirm`), `choices` (value, label and the consequence of choosing it) or where they are worked out from, `parts` for a question with more than one input (Q8, Q9, Q10, Q17, Q19, Q21), `defaults` (D detected, P the chosen preset, F a safe fallback, in order, with the source), `validators` (ids), `writes` (configuration keys; `portal:` for a change on the portal; `secret:` and `variable:` for a repository secret or variable), `express`, `expressWhen`, `askWhen` and `changeLater`. The express questions are Q1, Q2, Q4, Q8, Q9, Q11, Q12 and Q13, and Q18 when a preset that runs the regression is chosen and the data has no answer.
- **Given** the answers so far **Then** `questionsToAsk` skips the test, data and start-command questions (Q5 to Q8, Q17 to Q21) when the project has no end-to-end tests, asks Q18 to Q21 after Q17, and asks Q20 only when the data needs putting back (Q18 is neither `none`, `ephemeral` nor "I do not know yet").
- **Fixtures/env:** `core/test/registry.test.ts`.

#### REQ-CLI-ONBOARD-007 — Validators are pure functions, and every configuration key is asked or declared (#1116 WP5)

- **Priority:** Should — "an answer that cannot work is refused with a reason" must hold in the CLI and the portal alike, and a new setting must not be forgotten by the onboarding.
- **Source:** `core/src/validators.ts` (`VALIDATORS`, `validate`, `validateAll`, `isValidBranchName`); `core/src/registry.ts` (`NOT_ASKED`, `askedConfigKeys`).
- **Given** the validator ids `slug`, `httpsUrl`, `secretName`, `cron5`, `existingDir`, `existingPath`, `branchesDiffer`, `tierHasTests`, `hostAdapterExists`, `nonEmpty`, `positiveInt` **Then** each is a function of the answer and a `ValidationContext` that returns a reason or null. The ones that need the repository (folders, paths, host adapters, test groups) read it from the context and do not refuse what the caller left out.
- **Given** `CONFIG_KEYS` **Then** every key is written by a question or listed in `NOT_ASKED` with a reason, `NOT_ASKED` names no key that does not exist or that a question writes, and a question writes only keys that exist (except `project_slug`, set by install); a test fails otherwise.
- **Fixtures/env:** `core/test/validators.test.ts`; `cli/test/presets-registry.test.ts`.

#### REQ-CLI-SCAN-008 — `doctor --json` lists every finding as a gap with a reason and options (#1116 WP4)

- **Priority:** Should — the guided mode, the scan and the portal need one shape for "this is wrong, here is why, here is what you can do"; today `doctor` reports a sentence per check and a `proposals` list that only has the checks that carry a repair.
- **Source:** `core/src/gap.ts` (`Gap`, `GapOption`, `FixTier`, `ClauseState`, `Remediation`, `findingToGap`, `gapId`); `cli/src/lib/doctor-explain.ts` (`CHECK_EXPLANATIONS`, `gapsFromCheck`, `gapsFromChecks`, `gapsFromCloseout`); `cli/src/commands/doctor.ts` (the `gaps` key).
- **Given** `devaudit doctor --json` **Then** the document gains a top-level `gaps` array and keeps `ok`, `tools`, `releaseCloseoutDrift`, `onboarding`, `deferral`, `proposals` and `fix` exactly as before. **Given** plain `devaudit doctor` **Then** the text output is unchanged.
- **Given** a check that lists findings **Then** `gaps` has one entry per finding, even when the check as a whole is ok (the informational `agent-permissions` check reports a repair without failing). **Given** a check that is not ok and lists none **Then** it has one entry for the check as a whole, and for the close-out check one per release that is released on the portal but still pending locally. A check that is ok and lists no finding has none.
- **Given** a gap **Then** it has `id` (`doctor:<check>:<subject>`, unique), `source: "doctor"`, `check`, `subject`, `title` and `why` in plain words (from the explanation table; never empty), `controls` (registry clause IDs only; empty until a check is tied to a clause) and `options`, never empty. A finding with a repair has one option carrying that repair (`id`, `label` = its summary, `tier` A, B or C, `consequence` for the tier, `remediation` unchanged), so every `proposals` entry is also a gap option. A finding without a repair has one `guidance` option (tier C: nothing is changed for you) whose label says what to do. "Leave this as is" is not part of the data: whoever shows the gaps always offers it.
- **Given** a doctor check name **Then** `CHECK_EXPLANATIONS` has a title, a reason and guidance for it; a test scans the doctor sources and fails when a check has no entry. A name the table does not know still yields a gap, built from the check's own text.
- **Fixtures/env:** `core/test/gap.test.ts`; `cli/test/doctor-gaps.test.ts` (the table covers every check; the unit cases; a real `doctor --json` run on a fresh consumer: every non-ok check has a gap, every gap has a reason and an option, every proposal is a gap option, plain doctor prints no gap data).

#### REQ-CLI-ONBOARD-009 — Detection facts come from the core, through a reader that cannot leave the repository (#1116 WP3)

- **Priority:** Should — the CLI and the portal must give a repository the same answer, and the local scan must never read outside the repository or run its content.
- **Source:** `core/src/repo-reader.ts` (`RepoReader`, `normalizeRepoPath`, `RepoPathError`); `core/src/detect/` (`stack.ts`, `test-runners.ts`, `deploy.ts`, `test-data.ts`, `facts.ts`: `detectFacts`); `core/src/node/fs-repo-reader.ts` (`fsRepoReader`); the CLI delegates in `cli/src/install/detect-stack.ts`, `cli/src/lib/test-runner-detect.ts` and `cli/src/lib/deploy-detect.ts`.
- **Given** a `RepoReader` **Then** `detectFacts(reader)` returns `{ stack, workingDirectory, host, testRunner, testGroups, branches, runner, governanceFiles, testData }` and never throws on a repository with unreadable JSON. `stack`: Python (`pyproject.toml`, then `requirements.txt`) at the root or up to two levels below it (skipping `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`; the first match in sorted order), else Node from a root `package.json`, else null. `host`: the host with the most weight among the committed host files (`vercel.json`, `railway.toml`, `fly.toml`, `terraform/`, ...). `testRunner`: `playwright` before `pytest`. `testGroups`: smoke when the Playwright config has a `smoke` project or the project named by `e2e_project`, critical when it has `critical`, full when it has `regression`; `options.collected` (the CLI's collect-only run) can only add groups. `branches`: `integration_branch` / `release_branch` from `sdlc-config.json`, else `develop`, `development`, `dev` and `main`, `master`, `production` found in `.git`. `runner`: the `runner` key, else the `runs-on` of the workflows. `governanceFiles`: the `.md` files in `compliance/governance/`. `testData.seedScripts`: `npm run <name>` for each `package.json` script whose name contains "seed", then `scripts/seed*` files. `testData.dependentProjects`: the Playwright projects with a non-empty `dependencies` list, read from the config as text (never executed); empty when the list cannot be read simply.
- **Given** a path that is absolute, has a `..` segment (even one that would stay inside) or a NUL byte **Then** every reader refuses it with `RepoPathError`. `fsRepoReader(root)` lists sorted entries with a trailing `/` on directories, cuts a file at `maxBytes`, and treats a symlink that resolves outside the root as absent.
- **Given** the CLI's `detectStack`, `detectTestRunners`, `detectDeployHost` **Then** their signatures and answers are unchanged (the GitHub deployments evidence still comes from `gh` in the CLI).
- **Fixtures/env:** `core/test/{repo-reader,detect,fs-repo-reader}.test.ts`; `cli/test/detect-parity.test.ts` runs the same fixtures through the code as it was before the move (`cli/test/helpers/legacy-detect.ts`, frozen) and through the CLI functions and requires identical answers.

#### REQ-CLI-ONBOARD-002 — The guided install: detect, suggest, summarise, accept or change (#1116 WP6)

- **Priority:** Should — a person who does not know the vocabulary needs one suggestion and one screen, not 24 questions.
- **Source:** `cli/src/install/guided.ts` (`runGuided`, `complianceLine`, `effectivePreset`); `cli/src/install/prompts.ts` (`collectPlan`); `@metasession.co/devaudit-core` (`PRESETS`, `QUESTIONS`, `suggestPreset`, `offerPresets`, `detectFacts`).
- **Given** an interactive `devaudit install` (no `--yes`) **When** the plan is collected **Then** the repository is detected, the preset is suggested by `suggestPreset` with its reason, the presets that cannot be offered are listed with the reason, and the person chooses one (D is listed after C as "the same as C, but the full pack is not run again after the deploy", offered only when C is, never suggested; `custom` is always offered). A summary follows, one line per express setting, then "Use these settings?": Yes writes them, "Change one thing" asks that setting's question and shows the summary again, "Detailed questions" asks every question that applies (`questionsToAsk`) with the current values as defaults.
- **Given** an answer that departs from the preset's own values **Then** `onboarding_preset` is recorded as `custom`. **Given** a flag that names a configuration key **Then** it overrides the preset's value and is not asked.
- **Given** the approval mode or the standards change **Then** the compliance line is recomputed: a solo approver shows the gap for SOC 2 CC8.1 and ISO 27001 A.8.32, a different approver shows none.
- **Given** a project that has an `sdlc-config.json` without `onboarding_preset` **Then** "Keep my current settings" is listed first and is the default, and choosing it applies no preset and no policy.
- **Given** no tests and a portal that does not report an approval policy **Then** only `custom` is offered and suggested.
- **Fixtures/env:** `cli/test/install-guided.test.ts`.

#### REQ-CLI-ONBOARD-003 — `--preset` and `--from-scan` (#1116 WP6)

- **Priority:** Should — scripted and repeated installs need the preset without the questions, and must never silently lower the approval requirement.
- **Source:** `cli/src/install/prompts.ts` (`presetWithoutQuestions`); `cli/src/install/scan-hints.ts` (`readScanHints`); `cli/src/install/refusal.ts` (`InstallRefusal`); `cli/src/index.ts`.
- **Given** `--preset <A|B|C|D|custom>` (either case) with `--yes` **Then** the preset's values are applied without a question. A and B read the project's approval policy from `GET /api/ci/projects/{slug}` with the viewer key and refuse with exit code 2 and the message "Preset A needs the project's approval policy to allow self-approval with a recorded gap. Run `devaudit install` in a terminal (it asks to set it), or set it in the portal's project settings, then run this again." unless it is `self_allowed_with_gap`; C, D and `custom` need no policy check. A preset that cannot be offered (for example C with no full pack) refuses with the reason. An unknown preset refuses before anything is touched.
- **Given** `--preset` in a terminal **Then** the preset question is skipped and the summary is shown.
- **Given** `--from-scan <file>` **Then** the report's `suggestedPreset` is the default of the preset question when it can be offered, and its `frameworks` are the standards. **Given** a report id **Then** install exits 2 with "Reading a scan report by its id is a portal feature that is not available yet; pass the report file instead"; an unreadable or malformed file also exits 2.
- **Fixtures/env:** `cli/test/install-guided.test.ts` ("--preset without questions", "--from-scan").

#### REQ-CLI-ONBOARD-004 — The portal calls of the guided install are tier B and degrade to one line (#1116 WP6)

- **Priority:** Should — a repository must never say "I approve my own" while the portal still blocks it, and nothing on the portal changes without a person agreeing.
- **Source:** `cli/src/lib/onboarding-portal.ts` (`readApprovalPolicy`, `readClaimedStandards`, `setApprovalPolicy`, `claimStandard`); `cli/src/install/onboarding-apply.ts` (`applyOnboardingPortal`).
- **Given** a project on the portal **Then** its approval policy is read with the viewer key (`Authorization: Bearer`): a reported policy, a project without the field (the portal predates the feature, so A and B are listed as unavailable: "this portal does not yet allow a solo approver; ask its operator to upgrade"), or unknown (no project or key yet, so A and B are offered with a note).
- **Given** a preset or answer that needs a different policy **Then** the person is asked ("Allow that?") before the preset is accepted; declining returns to the preset question. After the project exists, `PATCH /api/projects/{id}` sets it with the personal token in `X-DevAudit-Token`. **Given** the portal answers 400, 404 or 405 for a solo policy **Then** the config is reverted to `approval.mode: dual_actor`, `release_branch_required_reviews` is removed and `onboarding_preset` is `custom`, with one plain line saying so. Standards are claimed only after a confirmation and only when the portal lists them; otherwise one line says they are saved in `sdlc-config.json`.
- **Given** developer mode or `--dry-run` **Then** nothing is written to the portal. No token or key appears in a message.
- **Fixtures/env:** `cli/test/install-guided.test.ts` ("the portal reads and writes", "applyOnboardingPortal").

#### REQ-CLI-ONBOARD-008 — `devaudit join` asks nothing and writes no policy or preset (#1116 WP6)

- **Priority:** Should — a second developer joining a configured project must not be asked to re-decide it, nor change what the operator chose.
- **Source:** `cli/src/install/prompts.ts` (`collectPlan`, joining branch); `cli/src/install/guided.ts` (`describeProjectPreset`); `cli/src/install/index.ts`.
- **Given** `devaudit join` **Then** the plan comes from the existing configuration with no prompt, no `onboarding` block is planned (so no policy or preset is written), and the project's preset with its one-line summary (or "custom settings") is printed. The viewer key is issued as before.
- **Fixtures/env:** `cli/test/install-guided.test.ts` ("devaudit join").

#### REQ-CLI-INSTALL-031 — Guided answers are written by dotted key; refused options exit 2 (#1116 WP6)

- **Priority:** Should — a preset switch must leave no keys of the previous preset, and a self-hosted runner needs its label.
- **Source:** `cli/src/install/write-config.ts`; `cli/src/install/github.ts`; `cli/src/install/refusal.ts`; `cli/src/commands/install.ts`.
- **Given** an `onboarding` plan **When** step 4 runs **Then** the keys of other presets are removed and each answer is written by dotted path (`approval.mode` keeps `approval.auto_low_risk_threshold`). **Given** a self-hosted runner label **Then** step 7 sets the `CI_RUNNER_LABEL` repository variable. **Given** a refused option (`InstallRefusal`) **Then** the command prints the message and exits 2, not 1.
- **Fixtures/env:** `cli/test/install-guided.test.ts` ("choosing a preset switches cleanly").

#### REQ-CLI-INSTALL-032 — The release branch's required reviews come from `release_branch_required_reviews` (#1116 WP2)

- **Priority:** Should — GitHub never counts the author's own review, so with the old fixed count of 1 a solo developer cannot merge a release PR (review finding R2); the count must be a project choice.
- **Source:** `cli/src/install/branch-protection.ts` (`configureBranchProtection`); `cli/src/lib/branch-protection-checks.ts` (`configuredReleaseReviewCount`, `releaseReviewCount`); `cli/src/lib/sdlc-config.ts` (`release_branch_required_reviews`).
- **Given** `release_branch_required_reviews` is 0, 1 or 2 in `sdlc-config.json` **When** step 10 runs **Then** `applyBranchProtection` is called for the release branch with that `requiredReviewCount` (the integration branch keeps 0), the dry run states it (`main (0 reviews)`), and the result line reads `main: ok (<n> review(s))`. **Given** the key is unset, or outside 0-2 **Then** the count is 1, today's value, and install behaves exactly as before. `install` does not write the key by default.
- **Fixtures/env:** `cli/test/release-branch-reviews.test.ts` ("install applies the configured review count").

#### REQ-CLI-FLEET-001 — `doctor --fleet`: invocation, auth, and exit codes (#861)

- **Priority:** Should — self-service, multi-tenant, read-only fleet sweep any DevAudit account can run.
- **Source:** `cli/src/index.ts` (`doctor` `--fleet` option — when passed, `runFleetDoctor()` runs **instead of** `runDoctor()`); `cli/src/commands/fleet.ts` (`runFleetDoctor`); `cli/src/lib/auth.ts` (`resolveToken`)
- **Preconditions / inputs:** `devaudit doctor --fleet [--json]`. Token resolved exactly as elsewhere (`DEVAUDIT_USER_TOKEN` env wins, else the cached `~/.config/devaudit/auth.json`) — the operator-local PAT, never a repo secret.
- **Given** no token resolvable **When** it runs **Then** JSON mode emits `{"ok":false,"reason":"not_logged_in"}`, human mode prints `Not logged in. Run \`devaudit auth login\` or set DEVAUDIT_USER_TOKEN.`; exit **3**. **Given** the portal rejects the token (`DevAuditApiError` from `GET /api/projects`) **Then** `{"ok":false,"reason":"portal_rejected","status":<http status>}` / `Portal rejected the token (HTTP <status>). Re-run \`devaudit auth login\`.`; exit **3**. **Given** any other failure fetching projects (network error, etc.) **Then** `{"ok":false,"reason":"portal_error","message":"<msg>"}` / `Could not fetch your projects from the portal: <msg>`; exit **1**.
- **Given** the sweep completes **Then** the process exits **0** regardless of findings — `runFleetDoctor` returns normally with no explicit exit on `anyIssues`; findings are conveyed only via the result's `ok`/`status` fields (REQ-CLI-FLEET-004). This deliberately differs from single-repo `doctor`'s exit 6. The per-project doctor is invoked as `doctor --json`, so the additive `deferral` and `proposals` keys (`REQ-CLI-DOCTOR-009`) appear in each project's embedded `doctor` object without any fleet change; `--fleet` never forwards `--fix`: `doctor --fleet --fix` (or `--reason`) is rejected before any sweep with `--fleet is read-only and never forwards --fix or --reason…` and **exit 2** (`doctor-fix.test.ts`).
- **Error paths:** As above.
- **Fixtures/env:** fleet.test.ts "exits 3 and reports not_logged_in when no token is available", "exits 3 when the portal rejects the token".

#### REQ-CLI-FLEET-002 — `doctor --fleet`: discovery, local-checkout resolution, remote-match defense-in-depth (#861)

- **Priority:** Should — decides which directories doctor is run against.
- **Source:** `cli/src/commands/fleet.ts` (`repoNameFromUrl`, `findLocalCheckout`, `normalizeRemote`, `localRemoteMatches`); `cli/src/lib/devaudit-api.ts` (`listProjects`, `DevAuditProject.repo_url?: string | null`)
- **Preconditions / inputs:** `baseDir` = cwd (injectable in tests). Discovery is `GET /api/projects` — every project the token's account can see. **Tenant isolation is enforced entirely by the portal's own authz on that endpoint**; this command adds no authorization logic of its own.
- **Given** a project with no `repo_url` **Then** `skipped` `project has no repo_url set`. **Given** a `repo_url` from which no name can be derived (`repoNameFromUrl`: trims, strips a trailing `.git` and trailing slashes, takes the last `/`-separated segment — works for `https://host/org/repo(.git)` and `git@host:org/repo.git`; returns `null` when there is no `/`-separated trailing segment) **Then** `skipped` `could not derive a directory name from repo_url`. **Given** a derived name **Then** the checkout is looked for at `<baseDir>/../<name>` then `<baseDir>/<name>` (first existing directory wins); not found → `skipped` `not checked out locally (looked for ../<name>)`.
- **Given** a local directory is found **Then** `git -C <dir> remote get-url origin` is compared to `repo_url` after normalization of both (trim, strip `.git`, strip trailing `/`, rewrite `git@host:` to `https://host/`, lowercase). Mismatch → `skipped` with `local_dir` set and reason `<dir> exists but its git remote doesn't match this project's repo_url — skipped for safety`. **No `origin` remote configured locally → treated as a match** (does not block). This is defense-in-depth only: `repo_url` is an unverified portal string, not proof of ownership.
- **Error paths:** Skips are never failures.
- **Fixtures/env:** fleet.test.ts "derives the trailing path segment, stripping .git and trailing slashes", "returns null for a URL with no discernible trailing segment", "sweeps projects checked out locally as siblings, skipping ones that are not".

#### REQ-CLI-FLEET-003 — `doctor --fleet`: per-project execution and result status (#861)

- **Priority:** Should — the collection step.
- **Source:** `cli/src/commands/fleet.ts` (`defaultRunDoctorJson`, `runFleetDoctor` loop; `FleetDoctorOptions.runDoctorJson` injectable for tests)
- **Preconditions / inputs:** a locally-matched checkout (REQ-CLI-FLEET-002).
- **Given** a matched checkout **When** the sweep reaches it **Then** it spawns `node <this CLI's entry> doctor --json` with `cwd` = that directory (`reject: false`), parses stdout as JSON (on parse failure the stored payload is `{ parseError: true, stdout, stderr }`), and records `status: 'ok'` if the child exited 0, `'issues'` otherwise (a missing exit code is treated as 1), with `local_dir` and the parsed `doctor` payload attached. **Because the child's exit code is single-repo doctor's tool-gate exit (0/6), `'issues'` means "a required tool is missing" — onboarding-checklist findings alone leave the status `'ok'`**; consumers of the result must inspect `doctor.onboarding` for those. **Given** running the child throws **Then** `status: 'error'` with `reason` = the error message; the sweep continues with the remaining projects.
- **Read-only invariant:** the command never files issues, opens branches, writes files, or calls any mutating portal/GitHub endpoint — it only reads `GET /api/projects` and runs read-only `doctor --json` children. Automated write actions are a separate, deliberate layer (the Metasession-internal `fleet-doctor` skill).
- **Error paths:** Per-project errors are isolated to that project's result.
- **Fixtures/env:** fleet.test.ts "propagates a non-zero doctor exit code as an \"issues\" result without throwing" (injected `runDoctorJson`).

#### REQ-CLI-FLEET-004 — `doctor --fleet`: JSON and human output (#861)

- **Priority:** Should — the consumable shape.
- **Source:** `cli/src/commands/fleet.ts` (`runFleetDoctor` tail)
- **Given** `--json` **Then** a single object `{ ok: !anyIssues, checked: anyChecked, results }` is emitted, where `results` is an array of `{ slug, repo_url, status: 'ok' | 'issues' | 'skipped' | 'error', reason?, local_dir?, doctor? }` in portal order; `anyIssues` is true if any result is `issues` or `error`; `checked` is true if at least one project was actually run (skips don't count).
- **Given** human mode **Then** it prints `Sweeping <N> project(s) visible to your account (<baseUrl>)...`, a `→ <slug>  (<dir>)` line as each matched project is run, then a per-project summary (`<slug> — clean` success / `<slug> — findings (see \`devaudit doctor\` inside <dir>)` warn / `<slug> — <reason>` error / `⏭  <slug> — <reason>` for skips), then one of: `No projects visible to your account were found checked out locally next to this directory.` (nothing checked), `One or more projects have findings — see above. This command only reports; nothing was changed.`, or `All locally-available projects are clean.`
- **Error paths:** N/A — exit is 0 in both modes after a completed sweep (REQ-CLI-FLEET-001).
- **Fixtures/env:** fleet.test.ts sweep tests; `docs/doctor.md`'s "`--fleet`: sweeping every project you can see" section is the narrative counterpart.
- **Update (#1099 WP3):** the viewer key is looked up in the order `DEVAUDIT_VIEWER_API_KEY`, `~/.config/devaudit/viewer-keys.json`, then the legacy repo-root `.env`; there is no fallback to `DEVAUDIT_API_KEY` (the uploader key is CI-only). With no viewer key the portal-backed checks report `skipped`.

---

#### REQ-CLI-BOOTSTRAP-001 — Opt-in drop of governance starter templates into `compliance/governance/`

- **Priority:** Must — explicit, non-destructive seeding of the governance docs; the v0.1.36 replacement for the removed auto-seed install step.
- **Source:** `cli/src/commands/bootstrap-governance.ts` (`runBootstrapGovernance`); `cli/src/install/bootstrap-governance.ts` (`bootstrapGovernanceDocs`)
- **Preconditions / inputs:** `devaudit bootstrap-governance [path]`; path defaults to `process.cwd()`, resolved absolute. Source templates at `sdlc/files/_common/governance/*.md.template` (six: `ai-disclosure`, `dpia`, `incident-report`, `periodic-review`, `risk-register`, `ropa`).
- **Given** a consumer with no existing governance docs **When** `devaudit bootstrap-governance <path>` **Then** `<path>/compliance/governance/` is created and each `*.md.template` is copied with the `.template` suffix dropped (e.g. `ropa.md.template` → `compliance/governance/ropa.md`); each copied file retains its `STARTER TEMPLATE — REPLACE BEFORE COMMITTING` banner. stdout (human) prints a `[Bootstrap governance docs] <N> starter(s) copied to compliance/governance/ — STARTERS, edit before production (see docs/governance-templates.md)`. **Exit 0.** **No network calls.**
- **Error paths:** Source dir missing → `warn` status, message `source directory not found: <dir> (…)`. No `*.md.template` files → `warn` status `no .md.template files in <dir>`. (Status command does not set a non-zero exit; see Assumptions.)
- **Fixtures/env:** Temp consumer dir; installer root resolving `sdlc/files/_common/governance/`.

#### REQ-CLI-BOOTSTRAP-002 — Idempotent / non-destructive: existing files preserved, never overwritten

- **Priority:** Must — the entire opt-in rationale hinges on never clobbering operator-edited governance docs.
- **Source:** `cli/src/install/bootstrap-governance.ts` (`bootstrapGovernanceDocs`, skip-if-exists via `isFile`)
- **Preconditions / inputs:** Some `compliance/governance/*.md` already present on disk.
- **Given** a consumer where `compliance/governance/ropa.md` already exists **When** bootstrap runs (again) **Then** existing targets are **skipped** (left byte-for-byte unchanged) and only absent ones are written; message becomes `<copied> copied, <skipped> kept (already on disk) — STARTERS, edit before production …`. Re-running after a full first pass copies 0 and keeps all. **Exit 0.** Implication: `devaudit update` never re-runs this (governance docs are not part of the sync), so operator edits survive updates.
- **Error paths:** None.
- **Fixtures/env:** Temp consumer pre-seeded with one governance file.

#### REQ-CLI-BOOTSTRAP-003 — `--dry-run` plans without writing

- **Priority:** Should — preview before committing the starters.
- **Source:** `cli/src/commands/bootstrap-governance.ts` (forwards `globals.dryRun`); `cli/src/install/bootstrap-governance.ts` (dryRun branch)
- **Preconditions / inputs:** `devaudit bootstrap-governance --dry-run [path]`.
- **Given** `--dry-run` **When** it runs **Then** **no files are written** and **no directory is created**; status is `planned`, human output `[Bootstrap governance docs] (dry-run) would copy <N> starter(s) to compliance/governance/ (skip-if-exists)`. **Exit 0.**
- **Error paths:** Same warn paths as REQ-CLI-BOOTSTRAP-001 take precedence (checked before the dry-run branch).
- **Fixtures/env:** Temp consumer; assert no `compliance/governance/` created.

#### REQ-CLI-BOOTSTRAP-004 — `--json` machine-readable result

- **Priority:** Could — tooling/CI consumption.
- **Source:** `cli/src/commands/bootstrap-governance.ts` (`isJsonMode`/`emitJsonResult`); `StepResult` shape in `cli/src/install/types.ts`
- **Preconditions / inputs:** `devaudit bootstrap-governance --json [path]`.
- **Given** `--json` **When** it runs **Then** exactly one JSON object is emitted: the `StepResult` `{ step:"Bootstrap governance docs", status:"ok"|"warn"|"planned", message, data }` where `data` carries `{ copied:[…], skipped:[…], targetDir:"compliance/governance" }` on success (or `{ templates:[…] }` on dry-run). **Exit 0.** No human log lines.
- **Error paths:** Warn paths emit `status:"warn"` with the diagnostic message; still exit 0.
- **Fixtures/env:** As REQ-CLI-BOOTSTRAP-001 with `--json`.

---

#### Assumptions — Update/Status/Doctor/Bootstrap

- **`update --dry-run` is honoured (resolved).** Earlier revisions of this document recorded that `update --dry-run` mutated the tree; that was fixed in `3e5d8bc` (#154, 2026-06-11) and REQ-CLI-UPDATE-018 was corrected in the 2026-09-29 #912 drift audit to describe the current no-mutation preview.
- **`doctor`'s description now matches its behaviour (resolved).** The registered description no longer claims "auth state, config validity"; it lists the tool checks, the close-out drift check, and the onboarding invariants, and mentions `--json`. `doctor` still does no token or full config-schema validation — see REQ-CLI-DOCTOR-004's scope note.
- **Governance banner wording differs between code comment and templates.** `cli/src/install/bootstrap-governance.ts`'s docstring says the banner reads "STARTER TEMPLATE — REPLACE BEFORE GOING TO PRODUCTION," but the actual templates under `sdlc/files/_common/governance/*.md.template` say "STARTER TEMPLATE — REPLACE BEFORE COMMITTING." Requirements assert the on-disk template text (the externally observable artifact).
- **Malformed `sdlc-config.json` exit code unverified.** `readSdlcConfig`/`resolveAdapters` `JSON.parse` a syntactically-bad config and let the error propagate; for `status` and `update` this surfaces via the top-level handler as exit 1 (inferred, not covered by an existing test).
- **`bootstrap-governance` warn paths still exit 0.** `runBootstrapGovernance` never calls `process.exit`; even `status:"warn"` (missing source dir / no templates) returns normally → exit 0. E2E should not expect a non-zero code for those.
- **Release-deferral diagnosis is read-only and viewer-keyed (#956).** `doctor` reads the portal with `DEVAUDIT_VIEWER_API_KEY` (fallback `DEVAUDIT_API_KEY`) and never mutates it. Defer/resume are admin-only (session or personal access token, never CI/API/viewer keys); `devaudit doctor --fix` (REQ-CLI-DOCTOR-010) calls them with the operator's PAT, and D1/D2/D5 plus `deferral_max_age_days` (default 30) ship in phase 3b (REQ-CLI-DOCTOR-011). The PAT header scheme and body fields the client sends were verified against the portal route handlers on 2026-10-12 (REQ-CLI-DOCTOR-013).
- **Network surface.** Among these four commands, only `update` (via `syncStackDeps`'s conditional `npm install`) and `doctor` (via the optional release-drift `GET /api/ci/releases/resolve`) make outbound calls, and both only under specific preconditions; `status` and `bootstrap-governance` are fully local.
- **Cross-area deps:** these commands share `resolveInstallerRoot` (`DEVAUDIT_INSTALLER_ROOT` / bundled snapshot — same as `install`/`join`), `readSdlcConfig` (consumer-config contract shared with `install`), the stack/host adapter loader (`cli/src/lib/adapter.ts`), the plugin lifecycle (`beforeSync`/`afterSync`/`onDoctor` — shared with the install flow), and `bootstrapGovernanceDocs` (shared with the former install step 11/12). `update`'s output and the framework-file list in `status` are coupled to the same `sdlc/files/` template set.

### Commands: push, auth, plugin, upgrade, global flags & stubs

Black-box SRS for the `devaudit` CLI areas: evidence upload (`push`), authentication (`auth login|logout|status`), plugin lifecycle (`plugin list|install|remove|update`), self-update (`upgrade`), the global flags applied to every command, and the stubbed `org`/`config` command groups. Requirements are derived only from externally observable behaviour: the command line + flags + environment variables → stdout/stderr, process exit code, filesystem deltas (the auth cache and plugin store), and HTTP calls to the DevAudit portal. They are reverse-engineered from `cli/src/index.ts` (commander wiring, global flags, `preAction` hook, `upgrade` stub), `cli/src/commands/push.ts`, `cli/src/lib/ci-upload.ts`, `cli/src/lib/devaudit-api.ts`, `cli/src/lib/auth.ts`, `cli/src/lib/paths.ts`, `cli/src/commands/auth/{login,logout,status}.ts`, `cli/src/commands/plugin/{list,install,remove,update}.ts`, `cli/src/lib/plugin/{load,discover,commands}.ts`, `cli/src/commands/stub.ts`, `cli/src/lib/logger.ts`, and the shell reference `scripts/upload-evidence.sh`. CLI under test is package version **0.1.54** (`cli/package.json`).

Key cross-cutting facts (asserted once, relied on below):

- Config root is resolved by `env-paths('devaudit', { suffix: '' })` (`cli/src/lib/paths.ts`). On Linux this is `~/.config/devaudit/`. `AUTH_FILE = <config>/auth.json`, `PLUGINS_DIR = <config>/plugins`, `CONFIG_FILE = <config>/config.json`. Tests MUST override `HOME`/`XDG_CONFIG_HOME` (or pass `{ root }` to the plugin command functions, which accept it) to sandbox these.
- Default portal base URL is `https://devaudit.ai` (`DEFAULT_BASE_URL` in `push.ts`, `auth.ts`, `login.ts`).
- Logger (`cli/src/lib/logger.ts`): `--json` mode replaces all `consola` output with one NDJSON record per call written to stdout as `{level,tag,args,date}`; `emitJsonResult()` writes a single raw `JSON.stringify(payload)+"\n"` to stdout. `--no-color` sets `process.env.NO_COLOR='1'`. `--verbose` raises log level 3→5. The `preAction` hook configures the logger from `cmd.optsWithGlobals()` before any action runs.

---

#### REQ-CLI-PUSH-001 — Required positionals and portal upload contract

- **Priority:** Must — core evidence-upload path; the reason the command exists.
- **Source:** `cli/src/index.ts` (`program.command('push <project-slug> <requirement-id> <evidence-type> <file>')`), `cli/src/commands/push.ts` (`runPush`), `cli/src/lib/ci-upload.ts` (`uploadEvidence`, `uploadOne`).
- **Preconditions / inputs:** Four required positionals: `<project-slug> <requirement-id> <evidence-type> <file>`. API key present (see PUSH-002). `<file>` exists.
- **Given** a readable file and a valid API key **When** `devaudit push acme REQ-001 test_report ./report.txt --api-key dak_x` **Then** the CLI POSTs `multipart/form-data` to `<baseUrl>/api/evidence/upload` with header `authorization: Bearer dak_x` and form fields `file` (Blob, filename = `basename(file)`), `projectSlug`, `requirementId`, `evidenceType`, and `metadata` (JSON string, `{}` when no `--git-sha/--ci-run-id/--branch`); on 2xx stdout shows `Uploading … → <baseUrl>`, a per-file `✓ <file> (HTTP 200)`, a blank line, then `Uploaded: 1 succeeded, 0 failed.`; exit code 0; no filesystem deltas.
- **Error paths:** missing positionals → commander prints usage to stderr + exits non-zero (commander default). If `uploadEvidence` finds zero files it throws `DevAuditApiError("No files at <path>")` → caught by top-level handler in `index.ts` → message to stderr, exit 1.
- **Fixtures/env:** msw POST handler on `<baseUrl>/api/evidence/upload`; temp file; `--api-key` or `DEVAUDIT_API_KEY`.

#### REQ-CLI-PUSH-002 — API key resolution and missing-key fast-fail (exit 3)

- **Priority:** Must — auth gate for every upload.
- **Source:** `cli/src/commands/push.ts` (`runPush`, lines ~67–75).
- **Preconditions / inputs:** Key resolved as `options.apiKey ?? process.env.DEVAUDIT_API_KEY` (i.e. `--api-key` overrides env).
- **Given** neither `--api-key` nor `DEVAUDIT_API_KEY` is set **When** `devaudit push acme REQ-001 test_report ./f.txt` **Then** (non-JSON) stderr: `DEVAUDIT_API_KEY env var is required (or pass --api-key).` plus an info line pointing at `<portal>/projects/<slug>/settings → API Key Management`; **exit code 3**; no HTTP call made. **And** in `--json` mode it instead emits `{"ok":false,"reason":"missing_api_key"}` to stdout then exits 3.
- **Error paths:** this requirement IS the error path.
- **Fixtures/env:** ensure `DEVAUDIT_API_KEY` unset; capture stdout for JSON variant; spy on `process.exit`.

#### REQ-CLI-PUSH-003 — Base URL resolution precedence and trailing-slash normalisation

- **Priority:** Must — controls where evidence is sent.
- **Source:** `cli/src/commands/push.ts` (`baseUrl = options.baseUrl ?? process.env.DEVAUDIT_BASE_URL ?? DEFAULT_BASE_URL`), `cli/src/lib/ci-upload.ts` (`opts.baseUrl.replace(/\/$/, '')`).
- **Given** `--base-url https://portal.test/` (trailing slash) **When** push runs **Then** the POST URL is exactly `https://portal.test/api/evidence/upload` (single slash). Precedence: `--base-url` > `DEVAUDIT_BASE_URL` > `https://devaudit.ai`.
- **Error paths:** n/a (resolution only).
- **Fixtures/env:** msw handler asserting the resolved URL; set/clear `DEVAUDIT_BASE_URL`.

#### REQ-CLI-PUSH-004 — Metadata assembly from --git-sha / --ci-run-id / --branch

- **Priority:** Must — provenance fields consumers rely on.
- **Source:** `cli/src/commands/push.ts` (`buildMetadata`), `cli/src/lib/ci-upload.ts` (`form.set('metadata', JSON.stringify(opts.metadata ?? {}))`).
- **Given** `--git-sha abc --ci-run-id 99 --branch main` **When** push runs **Then** the `metadata` form field is `{"gitSha":"abc","ciRunId":"99","branch":"main"}`. Omitted flags are omitted from the object; with none set, `metadata` is `{}`.
- **Error paths:** n/a.
- **Fixtures/env:** msw handler parsing the multipart `metadata` field.

#### REQ-CLI-PUSH-005 — Release / environment / category form fields

- **Priority:** Must — gate-relevant fields forwarded to the portal.
- **Source:** `cli/src/commands/push.ts` (maps `--release`→`releaseVersion`, `--create-release-if-missing`→`createReleaseIfMissing`, `--environment`→`environment`, `--category`→`evidenceCategory`), `cli/src/lib/ci-upload.ts` (`uploadOne` form.set calls).
- **Given** `--release v1.0.0 --create-release-if-missing --environment uat --category ci_pipeline` **When** push runs **Then** the form additionally contains `releaseVersion=v1.0.0`, `createReleaseIfMissing=true`, `environment=uat`, `evidenceCategory=ci_pipeline`. Each field is only set when its flag is present; `createReleaseIfMissing` is sent only when truthy.
- **Error paths:** The CLI enforces the same coherence checks as the shell for these flags: `--environment` without `--release` exits 2 with an invalid-arguments message, and `--release` without `--category` does the same.
- **Fixtures/env:** msw handler inspecting form fields.

#### REQ-CLI-PUSH-006 — Retry on 429/5xx with exponential backoff, capped at 5 attempts by default

- **Priority:** Must — rate-limit resilience for CI bursts (devaudit#263 analogue).
- **Source:** `cli/src/lib/ci-upload.ts` (`RETRYABLE_STATUSES = {429,500,502,503,504}`, `DEFAULT_MAX_ATTEMPTS = 5`, `INITIAL_BACKOFF_MS = 1000`, `uploadOne` retry loop).
- **Given** the portal returns 429 (or 500/502/503/504) on attempts 1–2 then 200 **When** push runs **Then** the file is retried (backoff 1000ms then 2000ms), ultimately succeeds, prints `✓ … (HTTP 200)`, exit 0. Backoff doubles each attempt.
- **Error paths:** if all retry attempts return a retryable status, the loop exits and the last response becomes a failure result (status = last code) → `✗` line, `failCount>0` → exit 4 (PUSH-009). Default cap is **5** attempts, overridable by `UPLOAD_MAX_ATTEMPTS`, and backoff is in milliseconds.
- **Fixtures/env:** msw handler returning sequenced statuses; fake timers to avoid real 1–2s waits.

#### REQ-CLI-PUSH-007 — Retry-After header honoured for retryable responses

- **Priority:** Must — respects portal-supplied throttle window.
- **Source:** `cli/src/lib/ci-upload.ts` (`retryAfter = Number.parseInt(res.headers.get('retry-after'))`; `wait = finite>0 ? retryAfter*1000 : backoff`).
- **Given** a 429 with `Retry-After: 2` **When** push retries **Then** the CLI waits `2*1000`ms before the next attempt instead of the default backoff. Non-numeric / absent / ≤0 `Retry-After` falls back to the exponential backoff value.
- **Error paths:** malformed header → fallback backoff (no crash).
- **Fixtures/env:** msw handler setting `Retry-After`; fake timers asserting the delay.

#### REQ-CLI-PUSH-008 — 4xx (other than 429) fast-fail, no retry

- **Priority:** Must — auth/validation errors won't self-heal.
- **Source:** `cli/src/lib/ci-upload.ts` (`uploadOne`: only `RETRYABLE_STATUSES` retry; everything else returns `{ok:false,status,error:errText}` immediately).
- **Given** the portal returns 401 / 403 / 404 / 422 **When** push runs **Then** exactly one POST is made (no retry), the result is a failure carrying the response body text as `error`, stdout shows `✗ <file> (HTTP 4xx): <body>`, summary `Uploaded: 0 succeeded, 1 failed.`, **exit code 4**.
- **Error paths:** this IS the error path; body-read failure substitutes `(no body)`.
- **Fixtures/env:** msw handlers per status; assert a single request hit.

#### REQ-CLI-PUSH-009 — Per-file success/failure tally, summary, and exit code 4 on any failure

- **Priority:** Must — overall result contract.
- **Source:** `cli/src/commands/push.ts` (`okCount`/`failCount` loop; `if (failCount > 0) process.exit(4)`).
- **Given** N files where some succeed and some fail **When** push runs **Then** stdout prints one `✓`/`✗` line per file, then `Uploaded: <ok> succeeded, <fail> failed.`; exit 0 iff `failCount === 0`, else **exit 4**. (Files are uploaded sequentially in directory-listing order.)
- **Error paths:** mixed results still exit 4 if any failed.
- **Fixtures/env:** msw handler returning per-file outcomes.

#### REQ-CLI-PUSH-010 — `--json` machine-readable push result

- **Priority:** Must — CI consumes this.
- **Source:** `cli/src/commands/push.ts` (final `emitJsonResult({ ok, uploaded, failed, results:[{file,ok,status,error}] })`).
- **Given** `--json` on a real (non-dry-run) push **When** it completes **Then** stdout contains a single JSON object `{"ok":<failed===0>,"uploaded":N,"failed":M,"results":[{file,ok,status,error|null}]}`. (Human `✓/✗` lines still emit as NDJSON via the JSON logger reporter; the `emitJsonResult` object is the authoritative result line.) Exit code still 4 if any failed.
- **Error paths:** missing-key JSON variant → `{"ok":false,"reason":"missing_api_key"}` (PUSH-002).
- **Fixtures/env:** capture stdout, parse last JSON object.

#### REQ-CLI-PUSH-011 — Directory upload (recursive) vs single file

- **Priority:** Must — directory uploads are the common CI shape.
- **Source:** `cli/src/lib/ci-upload.ts` (`collectFiles`: file→`[file]`; directory→`readdir` + recursive descent through `entry.isDirectory()`).
- **Given** `<file>` is a directory containing files + subdirectories **When** push runs **Then** every nested regular file is uploaded as a separate POST (parity with the shell script's `find -type f`). A single-file path uploads exactly that file.
- **Error paths:** empty directory → `uploadEvidence` throws `No files at <path>` → exit 1 (top-level handler).
- **Fixtures/env:** temp dir with a nested subdir; assert nested files are POSTed too.

#### REQ-CLI-PUSH-012 — `--dry-run` previews without any HTTP or filesystem mutation

- **Priority:** Must — safe preview; explicitly tested in `flag-polish.test.ts`.
- **Source:** `cli/src/commands/push.ts` (`runDryRun`; gated by `options.dryRun` before key resolution).
- **Given** `--dry-run` (global flag, threaded into `PushOptions.dryRun`) **When** `devaudit push acme REQ-001 test_report <dir>` **Then** NO POST is made; (non-JSON) stdout: `[dry-run] Would upload N file(s) for acme/REQ-001 (test_report) → <baseUrl>` followed by one `· <file>` line per collected file; exit 0. **And** dry-run does NOT require an API key (it runs before the key check).
- **Error paths:** if `<file>` does not exist, `collectFiles` `fs.stat` rejects → top-level handler → exit 1.
- **Fixtures/env:** msw with `onUnhandledRequest:'error'` to prove no upload; temp dir of files.

#### REQ-CLI-PUSH-013 — `--dry-run --json` structured plan payload

- **Priority:** Should — JSON preview for CI dry-runs; tested in `flag-polish.test.ts`.
- **Source:** `cli/src/commands/push.ts` (`runDryRun` JSON branch).
- **Given** `--dry-run --json` **When** push runs **Then** stdout is a single object `{dryRun:true, projectSlug, requirementId, evidenceType, baseUrl, files:[{path}], metadata, release?, environment?, category?}` (release/environment/category present only when their flags are set); no POST; exit 0.
- **Error paths:** n/a.
- **Fixtures/env:** capture stdout; assert `files.length` matches collected files and `uploadHits` is empty.

#### REQ-CLI-PUSH-014 — Base-URL redirect handling / drift warning (parity note)

- **Priority:** Should — both the shell reference and the CLI now surface host-drift warnings before upload.
- **Source:** `scripts/upload-evidence.sh` (`probe_base_url_drift`, `curl -X POST -L --max-redirs 3`); `cli/src/commands/push.ts` (`probeBaseUrlDrift` call before upload); `cli/src/lib/ci-upload.ts` (`probeBaseUrlDrift`).
- **Given** the portal host issues a 301/302 to a new host **When** the shell script runs **Then** it prints a `WARNING: DEVAUDIT_BASE_URL host '<old>' redirects to '<new>' …` block (issue #143) but still uploads (curl follows the redirect). **When the CLI runs**, it first probes `<baseUrl>/api/health` with `redirect:'manual'`; if that redirects cross-host it emits a warning via the logger, then continues to upload using `fetch`, which follows redirects by default. E2E should assert both the warning and the successful upload-through-redirect behaviour.
- **Error paths:** redirect loop — `fetch` caps redirects internally (no `--max-redirs 3` equivalent surfaced).
- **Fixtures/env:** msw 301→200 chain for the CLI; for shell parity, a curl-level redirect fixture.

#### REQ-CLI-PUSH-015 — beforePush / afterPush plugin hooks fire around a real upload

- **Priority:** Could — plugin integration on the push path.
- **Source:** `cli/src/commands/push.ts` (`discoverPlugins().loaded`; `runHook(plugins,'beforePush',ctx)` before upload, `'afterPush'` after).
- **Given** an installed plugin declaring `beforePush`/`afterPush` hooks **When** a non-dry-run push runs **Then** `beforePush` runs before the first POST and `afterPush` after the summary, with a context built from `projectPath = cwd`. Dry-run does NOT invoke hooks. Hook errors are isolated per-plugin (do not abort the push) per `runHook`'s error isolation (`plugin.test.ts`).
- **Error paths:** a throwing hook is reported but push continues.
- **Fixtures/env:** temp `PLUGINS_DIR` with a fixture plugin; assert hook ordering relative to upload.

#### REQ-CLI-PUSH-016 — `--test-execution` identifies execution-scoped evidence

- **Priority:** Should — associates execution output with a governed test-execution record (ISO/IEC/IEEE 29119-3 test execution logs / Test Status Reports).
- **Source:** `cli/src/commands/push.ts`, `cli/src/lib/ci-upload.ts`, `cli/src/lib/release-lineage-contract.ts`, `cli/src/index.ts`.
- **Preconditions / inputs:** `--test-execution <id>` identifies the provider execution; execution-scoped uploads also carry `--evidence-scope execution` and the first-class record identifier where available.
- **Given** an execution-scoped upload **When** push runs **Then** the canonical producer fields identify the execution and the upload helper maps them to the portal's current multipart field names at the HTTP boundary. **Given** release-, stage-, or approval-scoped evidence **Then** it must not acquire an execution record merely because it was uploaded during that workflow.
- **Error paths:** n/a — the value is an opaque string; no client-side validation.
- **Fixtures/env:** msw handler asserting the form field presence/absence.

#### REQ-CLI-PUSH-019 — Shared release-lineage contract publishes canonical enums, payload shapes, and execution rendering

- **Priority:** Should — later workflow/CLI emission work must use one contract rather than inventing payloads ad hoc (`DevAudit-Installer#391`).
- **Source:** `contracts/release-lineage-contract.json`, `cli/src/lib/release-lineage-contract.ts`, `cli/test/release-lineage-contract.test.ts`.
- **Preconditions / inputs:** none; this is a shared producer contract consumed by later CLI/workflow code.
- **Given** the installer repo **When** a developer or generated workflow needs canonical values for SDLC stages, environments, suite kinds, providers, outcomes, evidence scopes, iteration provenance, bundle roles/relationships, or the idempotency-key shape **Then** those values are defined in the shared contract file and mirrored by the typed helper module. **Given** the portal lacks first-class test-execution support **When** a producer reports execution evidence **Then** it fails or leaves readiness unresolved rather than fabricating an execution from artifact grouping.
- **Error paths:** a `testExecutionRecordId` paired with a non-`execution` scope throws in the helper; malformed idempotency keys fail the contract tests.
- **Fixtures/env:** Vitest contract suite validating documented examples, invalid enum values, invalid idempotency-key shape, and execution rendering.

#### REQ-CLI-PUSH-017 — Upload bodies are sourced from disk-backed blobs, not `fs.readFile()` whole-buffer preloading

- **Priority:** Should — this is the installer-side memory reduction for large CI/local uploads (issue #331).
- **Source:** `cli/src/lib/ci-upload.ts` (`createUploadSource`, `buildUploadForm`, `uploadOne`, `uploadPresigned`).
- **Preconditions / inputs:** Any normal `push` upload path.
- **Given** a readable evidence file **When** `uploadEvidence` prepares the request body **Then** it creates a disk-backed `Blob` source (`openAsBlob` on Node 22+) and reuses that blob across multipart retries or the presigned PUT flow, instead of calling `fs.readFile()` to preload the whole file into heap memory. The presigned metadata request still sends `fileSizeBytes` and `mimeType`, but those come from file stat / mime derivation, not a preloaded buffer.
- **Error paths:** If the runtime cannot provide a disk-backed blob, the helper may fall back to `fs.readFile()` compatibility mode; the observable contract is that supported Node 22+ runtimes take the blob-backed path.
- **Fixtures/env:** unit test spying on `fs.readFile` while asserting successful multipart and presigned uploads without that function being called.

#### REQ-CLI-PUSH-018 — Starter-stub skip uses a small text prefix read, not whole-file buffering

- **Priority:** Should — this avoids loading full files just to decide “skip vs upload” (issue #331).
- **Source:** `cli/src/lib/ci-upload.ts` (`isTextLikeEvidenceFile`, `readFilePrefix`, `isUneditedStub`).
- **Preconditions / inputs:** A governance/compliance starter file that still contains the `STARTER TEMPLATE … REPLACE BEFORE` banner.
- **Given** a text-like evidence file (`.md`, `.txt`, `.json`, `.yml`, `.yaml`, `.csv`, `.html`, `.xml`, `.log`) **When** uploadEvidence checks whether it is still an unedited starter stub **Then** it reads only a small prefix from disk, matches the starter banner there, and returns `{ skipped: true }` without uploading. Binary/non-text evidence files do not go through this text decode path.
- **Error paths:** If the banner is absent in the prefix, the file proceeds to the normal upload path.
- **Fixtures/env:** unit test with a starter markdown stub; assert `skipped: true`, no fetch call, and no `fs.readFile()` buffering.

---

#### REQ-CLI-AUTH-001 — `auth login --token` validates against the portal then caches at mode 0600

- **Priority:** Must — token acquisition + secure cache are core security behaviour.
- **Source:** `cli/src/commands/auth/login.ts` (`runAuthLogin`), `cli/src/lib/auth.ts` (`writeAuth`), `cli/src/lib/devaudit-api.ts` (`DevAuditClient.listProjects` → `GET /api/projects` with header `x-devaudit-token`).
- **Preconditions / inputs:** `--token mctok_…` (or `DEVAUDIT_USER_TOKEN` env). `--base-url` defaults to `https://devaudit.ai` (commander default in `index.ts`).
- **Given** a token the portal accepts **When** `devaudit auth login --token mctok_abc` **Then** the CLI sends `GET <baseUrl>/api/projects` with header `x-devaudit-token: mctok_abc`; on success it writes `~/.config/devaudit/auth.json` containing `{"version":1,"token":"mctok_abc","base_url":"<baseUrl>"}` (pretty-printed + trailing newline); the parent dir is created `mode 0o700`, the file `mode 0o600`; stdout: `Logged in. Token cached at ~/.config/devaudit/auth.json (mode 0600).`; exit 0.
- **Error paths:** see AUTH-003.
- **Fixtures/env:** msw `GET /api/projects`; temp `HOME`; assert `(await fs.stat(authFile)).mode & 0o777 === 0o600` and parsed contents shape.

#### REQ-CLI-AUTH-002 — `auth login` interactive PAT paste with `mctok_` validation

- **Priority:** Should — the human onboarding flow (CI uses `--token`/env).
- **Source:** `cli/src/commands/auth/login.ts` (`clack.password` with `validate`).
- **Given** no `--token` and no `DEVAUDIT_USER_TOKEN` **When** `devaudit auth login` (TTY) **Then** stdout prints the `Open <baseUrl>/settings/tokens …` + `Paste the mctok_… value …` guidance and prompts via a masked password input; the validator rejects empty (`Token is required.`) and any value not starting with `mctok_` (`Token should start with 'mctok_'.`). On accept it proceeds to validation+cache (AUTH-001).
- **Error paths:** Ctrl-C / cancel (`clack.isCancel`) → stderr `Cancelled.`, **exit 0** (clean cancel, not error).
- **Fixtures/env:** hard to E2E non-interactively → prefer `--token`/env in CI; document prompt contract for completeness. (Assumption: tests cover the `--token` path instead.)

#### REQ-CLI-AUTH-003 — `auth login` rejects an invalid token (exit 3) without caching

- **Priority:** Must — must not persist a known-bad token.
- **Source:** `cli/src/commands/auth/login.ts` (catch on `DevAuditApiError` with `status 401||403`).
- **Given** the portal returns 401 or 403 to `GET /api/projects` **When** `devaudit auth login --token mctok_bad` **Then** stderr: `Token rejected by portal (HTTP <status>). Check it was copied correctly + is not revoked.`; **exit 3**; `auth.json` is NOT written/modified.
- **Error paths:** any non-401/403 error is rethrown → top-level handler → message to stderr, exit 1.
- **Fixtures/env:** msw returning 401/403; assert no auth.json created.

#### REQ-CLI-AUTH-004 — `auth logout` deletes the cached token

- **Priority:** Should — credential removal.
- **Source:** `cli/src/commands/auth/logout.ts` (`runAuthLogout`), `cli/src/lib/auth.ts` (`deleteAuth`).
- **Given** `~/.config/devaudit/auth.json` exists **When** `devaudit auth logout` **Then** the file is unlinked; stdout: `Removed cached token at <AUTH_FILE>.`; exit 0. **Given** no cached file, stdout: `No cached token to remove.`; exit 0 (idempotent, no error).
- **Error paths:** ENOENT is treated as "did not exist" (returns false), not an error; other unlink errors propagate → exit 1.
- **Fixtures/env:** temp `HOME`; pre-seed (or omit) auth.json; assert deletion.

#### REQ-CLI-AUTH-005 — `auth status` resolves token source and verifies against portal

- **Priority:** Should — diagnostic; tested in `flag-polish.test.ts` (JSON path).
- **Source:** `cli/src/commands/auth/status.ts` (`runAuthStatus`), `cli/src/lib/auth.ts` (`resolveToken`: env `DEVAUDIT_USER_TOKEN` wins over the cached file).
- **Given** a cached token (or `DEVAUDIT_USER_TOKEN`) the portal accepts **When** `devaudit auth status` **Then** (non-JSON) stdout shows `Token source:` (= `DEVAUDIT_USER_TOKEN env var` when from env, else `~/.config/devaudit/auth.json`), `Portal: <baseUrl>`, `Verifying token against portal...`, then `Token is valid. Accessible projects: <N>` and up to 10 `• <slug>` lines (`… and K more` if >10); exit 0. **In `--json`** it emits a single `{ok:true,source,baseUrl,projects:[slugs]}` (verified by `flag-polish.test.ts`).
- **Error paths:** see AUTH-006/007.
- **Fixtures/env:** msw `GET /api/projects` returning a project list; set `DEVAUDIT_USER_TOKEN` + `DEVAUDIT_BASE_URL` or seed auth.json.

#### REQ-CLI-AUTH-006 — `auth status` when not logged in (exit 3)

- **Priority:** Should — clear "logged out" signal.
- **Source:** `cli/src/commands/auth/status.ts` (`!resolved` branch).
- **Given** no `DEVAUDIT_USER_TOKEN` and no `auth.json` **When** `devaudit auth status` **Then** (non-JSON) stderr: `Not logged in. Run \`devaudit auth login\` or set DEVAUDIT_USER_TOKEN.`; **exit 3**. In `--json`: `{"ok":false,"reason":"not_logged_in"}` to stdout, exit 3.
- **Error paths:** this IS the error path.
- **Fixtures/env:** clear env + empty temp HOME.

#### REQ-CLI-AUTH-007 — `auth status` when the portal rejects the cached token (exit 3)

- **Priority:** Should — stale/revoked token detection.
- **Source:** `cli/src/commands/auth/status.ts` (catch `DevAuditApiError`).
- **Given** a resolvable token that the portal rejects (any `DevAuditApiError`) **When** `devaudit auth status` **Then** (non-JSON) stderr: `Portal rejected the token (HTTP <status>). Re-run \`devaudit auth login\`.`; **exit 3**. In `--json`: `{"ok":false,"reason":"portal_rejected","status":<n>}`, exit 3. A non-API (unexpected) error → `{"ok":false,"reason":"unexpected","message":…}`/`Unexpected error: …`, **exit 1**.
- **Error paths:** distinguishes portal-rejection (exit 3) from unexpected errors (exit 1).
- **Fixtures/env:** msw returning 401/403 (→ DevAuditApiError) vs a network failure (→ unexpected).
- **Update (#1099 WP3):** `auth status` also lists, per project and base URL, whether a viewer key is saved on this machine and under what name (`viewerKeys` in `--json`); never the value.

---

#### REQ-CLI-PLUGIN-001 — `plugin list` enumerates the store and reports load failures

- **Priority:** Should — visibility into installed plugins; tested in `plugin-commands.test.ts`.
- **Source:** `cli/src/commands/plugin/list.ts` (`runPluginList`), `cli/src/lib/plugin/discover.ts` (`discoverPlugins`).
- **Given** `~/.config/devaudit/plugins/` (or `--root`-equivalent `{root}`) **When** `devaudit plugin list` **Then** stdout prints `Plugin directory: <root>`; if empty (no loaded, no failures) → `  (no plugins installed)`; otherwise a `Loaded:` section with `  ✓ <pkg>@<ver> hooks=[…] commands=[…]` per valid plugin, and a `Failed to load:` section with `  ✗ <dir> — <reason>` per invalid plugin. Exit 0 regardless. No filesystem mutation; no HTTP.
- **Error paths:** a missing plugins dir is treated as empty (`discoverPlugins` returns empty on ENOENT).
- **Fixtures/env:** temp plugins root with valid + invalid (missing `devaudit` field) fixture dirs.

#### REQ-CLI-PLUGIN-002 — `plugin install <git-url>` clones, npm-installs, validates manifest

- **Priority:** Should — the install lifecycle; tested in `plugin-commands.test.ts`.
- **Source:** `cli/src/commands/plugin/install.ts` (`runPluginInstall`, `deriveDirName`), `cli/src/lib/plugin/load.ts` (`loadPluginFromDir`).
- **Preconditions / inputs:** `<source>` is a Git URL (registry resolution is NOT implemented). Target dir name = last path segment with `.git` stripped.
- **Given** a valid plugin repo **When** `devaudit plugin install git@github.com:foo/devaudit-plugin-x.git` **Then** the CLI `mkdir -p`s the plugins root, runs `git clone --depth 1 <source> <root>/<name>` (`stdio: inherit`); if the clone contains `package.json` it runs `npm install --legacy-peer-deps` in the target; it then validates via `loadPluginFromDir`; on success stdout: `Installed: <pkg>@<ver> at <target>`; exit 0. Filesystem delta: a new `<root>/<name>/` directory.
- **Error paths:** target already exists → stderr `Plugin directory already exists: <target>. Run \`devaudit plugin remove <name>\` first.`, **exit 2**. `git clone`fails → stderr`git clone failed: …`, **exit 6**. `npm install`non-zero → stderr`npm install failed — leaving the plugin dir in place for inspection.`, **exit 5** (dir left behind). Manifest validation fails → stderr `Plugin validation failed: …`, the target dir is `rm -rf`'d, **exit 9**. Underivable name → **exit 2**.
- **Fixtures/env:** mock `execa` (as the tests do) so `git clone`/`npm install` are stubbed and the clone fixture writes a valid `package.json`+`plugin.js`; temp `{root}`.

#### REQ-CLI-PLUGIN-003 — `plugin remove <name>` deletes a plugin by package or directory name

- **Priority:** Should — removal lifecycle; tested in `plugin-commands.test.ts`.
- **Source:** `cli/src/commands/plugin/remove.ts` (`runPluginRemove`).
- **Given** an installed plugin **When** `devaudit plugin remove <name>` **Then** the CLI matches `<name>` against each plugin's `packageName` OR its directory basename (loaded and failed-to-load alike), `rm -rf`s the matched dir, prints `Removed plugin at <dir>`, exit 0. Filesystem delta: the dir is gone.
- **Error paths:** no match → stderr `No plugin found matching '<name>'.` + `Run \`devaudit plugin list\` …`, **exit 2** (the dir is not touched).
- **Fixtures/env:** temp `{root}` with a fixture plugin; assert `fs.access` rejects after removal.

#### REQ-CLI-PLUGIN-004 — `plugin update` git-pulls + npm-installs each git-backed plugin

- **Priority:** Should — update lifecycle; tested in `plugin-commands.test.ts`.
- **Source:** `cli/src/commands/plugin/update.ts` (`runPluginUpdate`, `updateOne`).
- **Given** installed plugins (some git checkouts, some not) **When** `devaudit plugin update` **Then** stdout: `Updating N plugin(s)...`; for each plugin with a `.git` dir it runs `git pull --ff-only` (cwd = plugin dir) and, if `package.json` exists, `npm install --legacy-peer-deps`; per-plugin lines: `  ✓ <p> — updated` (pulled changes), `  · <p> — already up to date` (when `git pull` stdout matches `Already up to date`), `  ⚠ <p> — not a git checkout, skipped` (no `.git`), or `  ✗ <p> — <detail>` (pull or post-pull npm install failed). Exit 0 (no aggregate failure exit code). Non-git plugins are NOT pulled.
- **Error paths:** zero installed plugins → stdout `No plugins installed.`, exit 0. `git pull` non-zero → status `failed` with first stderr line. `npm install` non-zero after a successful pull → `failed` (`npm install failed after pull`).
- **Fixtures/env:** mock `execa`; temp `{root}` with one `gitDir:true` and one plain fixture; assert exactly one `git pull` + one `npm install`.

#### REQ-CLI-PLUGIN-005 — Manifest validation contract gates load/install

- **Priority:** Could — defines what a "valid plugin" is (the SDK contract); tested in `plugin.test.ts` + `plugin-sdk`.
- **Source:** `plugin-sdk/src/manifest.ts` (`validateManifest`), `cli/src/lib/plugin/load.ts` (`loadPluginFromDir`).
- **Given** a plugin dir **When** it is discovered/installed **Then** validity requires: non-empty `name`, `version`, `main` strings in package.json; a `devaudit` object with `apiVersion === '1'` (the only supported version); optional `commands[]` (each `{name,description}`, name matching `/^[a-z][a-z0-9-]*$/`) and `hooks[]` (recognised lifecycle names). Additionally the resolved `main` module must `default`-export an object with `apiVersion === '1'` and a non-empty `name` (runtime check). Any failure → discovery records it as a load failure / install aborts (PLUGIN-002).
- **Error paths:** missing `devaudit` field → `package.json must include a top-level \`devaudit\` object`; runtime apiVersion mismatch → `apiVersion '<x>' at runtime, expected '1'` (tested).
- **Fixtures/env:** fixture plugins with malformed manifests; assert failure reasons match.

#### REQ-CLI-PLUGIN-006 — Plugin-contributed commands register under a derived namespace

- **Priority:** Could — plugins extend the CLI surface.
- **Source:** `cli/src/lib/plugin/commands.ts` (`registerPluginCommands`, `pluginNamespace` strips `@scope/` and `devaudit-plugin-` prefix), `cli/src/index.ts` (called after stub/auth/plugin wiring).
- **Given** a loaded plugin `devaudit-plugin-foo` declaring command `bar` **When** the CLI builds **Then** `devaudit foo bar [args...]` becomes available; invoking it calls the plugin's command impl with a context (cwd) and the args array; a thrown impl error prints `Plugin '<pkg>' command '<bar>' failed: <msg>` to stderr and exits 1. Plugins with zero manifest commands add no group.
- **Error paths:** impl error → exit 1.
- **Fixtures/env:** fixture plugin with a `commands` entry; assert help text includes the namespace (`plugin.test.ts` pattern).


#### REQ-CLI-PLUGIN-007 — Plugins read the person's PAT from the CLI via `getPersonalAuth()` (#1100)

- **Priority:** Could — removes the instruction to export the PAT into a shell, which every agent session started from that shell would inherit (REQ-CLI-DOCTOR-005 `pat-env`).
- **Source:** `plugin-sdk/src/types.ts` (`PluginContext.getPersonalAuth?`, `PluginPersonalAuth`), `cli/src/lib/plugin/context.ts` (`buildPluginContext`), `plugins/devaudit-plugin-evidence-export/src/util/token.ts` (`resolveAuth`, `hasAuth`) and `src/hooks/on-doctor.ts`.
- **Given** a plugin hook or command **Then** `ctx.getPersonalAuth()` resolves like `devaudit auth status` (`DEVAUDIT_USER_TOKEN`, else the `auth login` cache) to `{ token, baseUrl }`, or `null` when not logged in. The accessor is optional in the type: a CLI without it leaves `ctx.getPersonalAuth` undefined. `evidence-export` uses the accessor and falls back to `DEVAUDIT_USER_TOKEN`; its `onDoctor` hook warns only when neither is available. The token is never logged or written by the plugin.
- **Error paths:** no token from either source → `No personal access token available. Run \`devaudit auth login\` …` (no instruction to export the token).
- **Fixtures/env:** `cli/test/plugin.test.ts` (accessor), `plugins/devaudit-plugin-evidence-export/test/plugin.test.ts` (CLI token, env fallback, no auth, hook).

---

#### REQ-CLI-UPGRADE-001 — `upgrade` is a stub, not a real self-update (exit 1)

- **Priority:** Could — documents that self-update is NOT yet implemented (the prompt's premise that `upgrade` performs an npm self-update is FALSE for v0.1.54).
- **Source:** `cli/src/index.ts` (`.command('upgrade')` → `makeStub({command:'upgrade', summary:'Self-update via npm or the platform package manager. Workstream A milestone 8.', trackedIn: TRACKING_ISSUE})`), `cli/src/commands/stub.ts` (`makeStub`).
- **Given** any invocation **When** `devaudit upgrade` **Then** it performs NO npm install and NO network call; stderr/stdout (via logger): `\`devaudit upgrade\` is not implemented yet.`(warn), then the summary`Self-update via npm or the platform package manager. Workstream A milestone 8.`, then `Tracked in: https://github.com/metasession-dev/DevAudit-Installer/issues/1`, then the "File an issue …" line; **exit 1**.
- **Error paths:** the stub itself is the terminal state (always exit 1).
- **Fixtures/env:** spy `process.exit`; assert no child process / HTTP. (Note: there is no separate `cli/test/update.test.ts` coverage for `upgrade`; `update.test.ts` covers the unrelated `devaudit update` template-sync command.)

---

#### REQ-CLI-GLOBAL-001 — Global flags accepted on every command via `applyCommonFlags`

- **Priority:** Could — flags are wired once on the root program and merged with `optsWithGlobals()`.
- **Source:** `cli/src/index.ts` (`applyCommonFlags`: `--json`, `-y/--yes`, `--dry-run`, `-v/--verbose`, `--no-color`, `--org <slug>`).
- **Given** any subcommand **When** a global flag is passed (before or after the subcommand) **Then** it is honoured because the `preAction` hook reads `cmd.optsWithGlobals()`. `-V/--version` prints `CLI_VERSION` (0.1.54); `--help`/`-h` prints commander help.
- **Error paths:** unknown options → commander usage error on stderr, non-zero exit.
- **Fixtures/env:** invoke through `main(argv)` with assorted flag positions.

#### REQ-CLI-GLOBAL-002 — `--json` switches to NDJSON logging + raw result objects

- **Priority:** Could — machine output mode.
- **Source:** `cli/src/lib/logger.ts` (`build` JSON reporter; `isJsonMode`, `emitJsonResult`), `preAction` hook in `index.ts`.
- **Given** `--json` **When** any command logs **Then** every log call is written to stdout as one JSON line `{level,tag,args,date}`, and command result summaries use `emitJsonResult` (a bare `JSON.stringify(payload)+"\n"`). Consumers should parse the last well-formed JSON object (the result), as human lines are also JSON-encoded.
- **Error paths:** n/a.
- **Fixtures/env:** capture stdout; `findJsonLine`-style parse (per `flag-polish.test.ts`).

#### REQ-CLI-GLOBAL-003 — `--no-color` strips ANSI (sets NO_COLOR)

- **Priority:** Could — plain output for logs/CI.
- **Source:** `cli/src/lib/logger.ts` (`if (opts.noColor) process.env.NO_COLOR='1'`), `index.ts` (`noColor: opts.color === false` — commander exposes `--no-color` as `color=false`).
- **Given** `--no-color` **When** any command runs **Then** `NO_COLOR=1` is set in-process and consola emits uncoloured output; exit unchanged.
- **Error paths:** n/a.
- **Fixtures/env:** assert `process.env.NO_COLOR` set and output free of ANSI escapes.

#### REQ-CLI-GLOBAL-004 — `--verbose` raises log verbosity

- **Priority:** Could — extra detail.
- **Source:** `cli/src/lib/logger.ts` (`level = verbose ? 5 : 3`).
- **Given** `-v/--verbose` **When** any command runs **Then** debug/verbose-level messages (level 4–5) become visible; default suppresses them.
- **Error paths:** n/a.
- **Fixtures/env:** a command that logs at debug level; assert presence/absence.

#### REQ-CLI-GLOBAL-005 — `--dry-run` and `-y/--yes` thread into commands

- **Priority:** Could — preview / non-interactive acceptance.
- **Source:** `index.ts` (push/install/join read `globals.dryRun`/`globals.yes` from `optsWithGlobals()`).
- **Given** `--dry-run` **When** `push` runs **Then** preview only (see PUSH-012). `-y/--yes` is forwarded to `install`/`join` to accept interactive defaults (CI-friendly); it has no effect on `push`/`auth`/`plugin` which take no prompts on these paths.
- **Error paths:** n/a.
- **Fixtures/env:** assert `dryRun`/`yes` propagation into the action option objects.

#### REQ-CLI-GLOBAL-006 — `--org <slug>` is accepted but currently inert

- **Priority:** Won't — declared as "override active org context for this invocation" but no command in this area consumes it (org context is part of the not-yet-built workstream B).
- **Source:** `index.ts` (`new Option('--org <slug>', …)`); no reader in push/auth/plugin code paths.
- **Given** `--org acme` on `push`/`auth`/`plugin` **When** the command runs **Then** the flag parses without error but has NO observable effect on HTTP calls or filesystem; behaviour is identical to omitting it.
- **Error paths:** n/a (silently inert).
- **Fixtures/env:** assert behaviour is unchanged with/without `--org`.

---

#### REQ-CLI-STUB-001 — `org` subcommands are not-yet-implemented stubs (exit 1)

- **Priority:** Won't — placeholders; the contract is the "not implemented" message + exit 1.
- **Source:** `cli/src/index.ts` (`org list`, `org switch <slug>`, `org policy list`, `org policy apply [path]`, `org report --format`), all via `makeStub` (`cli/src/commands/stub.ts`).
- **Given** any of `devaudit org list|switch <slug>|policy list|policy apply|report` **When** invoked **Then** output (via logger): warn `\`devaudit <command>\` is not implemented yet.`, the per-stub summary line (e.g. `org switch`→`Updates ~/.config/devaudit/config.json.`), `Tracked in: https://github.com/metasession-dev/DevAudit-Installer/issues/1`, then `File an issue at https://github.com/metasession-dev/DevAudit-Installer/issues …`; **exit 1**. No filesystem/HTTP side effects.
- **Error paths:** the stub is terminal (always exit 1); required args still enforced by commander first (e.g. `org switch` with no `<slug>` → usage error before the stub runs).
- **Fixtures/env:** spy `process.exit(1)`; assert the message lines.

#### REQ-CLI-STUB-002 — `config` subcommands are not-yet-implemented stubs (exit 1)

- **Priority:** Won't — placeholders.
- **Source:** `cli/src/index.ts` (`config get <key>`, `config set <key> <value>`, `config list`) via `makeStub`.
- **Given** any of `devaudit config get|set|list` **When** invoked **Then** same stub contract as STUB-001 with per-command summaries (`config get` → `Reads ~/.config/devaudit/config.json.`; `config set` → `Writes to ~/.config/devaudit/config.json (mode 0600).`; `config list` → `Lists all CLI config keys with their current values.`); **exit 1**; `config.json` is NOT read or written despite the messaging.
- **Error paths:** terminal exit 1; commander enforces required `<key>`/`<value>` first.
- **Fixtures/env:** assert exit 1 + message; assert `~/.config/devaudit/config.json` is untouched.

---

#### Assumptions — Push/Auth/Plugin/Global

- **`upgrade` is a stub, not a self-updater.** The task brief describes `upgrade` as "self-update to latest npm release". In v0.1.54 it is wired to `makeStub` and only prints a "not implemented" message + exits 1 (REQ-CLI-UPGRADE-001). I documented the actual stub behaviour, not the aspirational one.
- **CLI vs `scripts/upload-evidence.sh` parity gaps** (documented where load-bearing): the CLI now implements the base-URL **drift warning**, recursive directory traversal, starter-stub skip, `releaseBranch`/`releaseTitle`/`changeType`/`gateStatus`/`--meta-key` form fields, and the `--environment requires --release` / `--release requires --category` validations. The remaining notable gaps are: the CLI still does **not** validate `--sdlc-stage 1-5` client-side because that flag belongs to the shell contract, and the shell remains the CI-authoritative path for stage stamping. The shell sends `releaseBranch=<branch>` while the CLI also keeps `branch` in metadata. These are stated as facts from the two sources, not as defects.
- **API key header / format:** the upload uses `Authorization: Bearer <key>` (`ci-upload.ts`); the portal-validation calls in `devaudit-api.ts` use header `x-devaudit-token`. The shell docs describe project keys as `mc_…` and PATs as `mctok_…`; the CLI only validates the `mctok_` prefix on interactive login (AUTH-002) — `--api-key`/`DEVAUDIT_API_KEY` values are not format-checked.
- **`auth login --base-url` default:** set as a commander option default (`'https://devaudit.ai'`) in `index.ts`, so `runAuthLogin` always receives a base URL; the `?? DEFAULT_BASE_URL` fallback inside `login.ts` is belt-and-suspenders.
- **`auth status` env precedence:** `resolveToken` lets `DEVAUDIT_USER_TOKEN` override the cached file, and `DEVAUDIT_BASE_URL` overrides the file's `base_url` only for the env-token path. Tests must clear these envs to exercise the file path.
- **Interactive `auth login` prompt** (AUTH-002) is impractical to E2E headlessly; assumed coverage is via `--token`/`DEVAUDIT_USER_TOKEN`.
- **`--org` is inert** in this command area (GLOBAL-006) — no reader exists in push/auth/plugin code; treated as parse-only.
- **Exit-code map (this area):** 0 success; 1 generic/top-level error, stub terminal, plugin-command impl error; 2 plugin name/dir conflict or no-match; 3 missing API key (push), token rejected (login/status), not-logged-in (status); 4 one-or-more upload failures (push); 5 plugin npm install failed; 6 git clone failed; 9 plugin manifest validation failed. (7 = `status` not-onboarded belongs to the `status` command, out of this area but observed in `flag-polish.test.ts`.)
- **Cross-area deps:** `push` invokes the plugin subsystem (`discoverPlugins`, `beforePush`/`afterPush` hooks) — overlaps the plugin area and the plugin-lifecycle SRS. `auth`/`push`/`status` all share `DevAuditClient` (`devaudit-api.ts`) and the portal endpoints `GET /api/projects` (auth) and `POST /api/evidence/upload` (push) — coordinate the msw portal stub across auth/push/status test suites. `paths.ts` (`AUTH_FILE`, `PLUGINS_DIR`, `CONFIG_FILE`) is shared by auth, plugin, and the config stubs — a single temp-HOME/XDG sandbox fixture serves all three.

### Framework Skills (.claude/skills/\*)

Scope note: The six entries below are **Claude Code skills** — directories under `sdlc/files/_common/skills/<name>/` that `devaudit install` / `devaudit update` sync verbatim into a consumer repo's `.claude/skills/<name>/`. Each skill's entire observable contract lives in its `SKILL.md`: a YAML frontmatter (`name`, `description`) validated by `sdlc/files/_common/skills/_schema/skill.schema.json`, plus free-form Markdown body that Claude reads as instructions. Because these are agent instructions, every requirement here is framed black-box: a trigger phrase or stage-reached event fires the skill; the skill emits an artefact at a known path with required sections/frontmatter, delegates to a named sub-skill, or pauses for a human. An E2E test can assert each one as "after invoking skill X on REQ-Y, file Z exists at path P containing section S" or "the orchestrator output the literal delegation line before any `e2e/**/*.spec.ts` edit". Requirements derive ONLY from the SKILL.md specs (and the shipped reference files where they are part of the observable contract); nothing is invented. `sdlc-implementer` (the orchestrator) requirements are **Must**; `e2e-test-engineer`'s pack contract is **Must**; the four SoT/governance authoring skills' artefact contracts are **Should**; cross-link/edge details are **Could**.

#### REQ-SKILL-IMPLEMENTER-001 — Trigger phrases fire the orchestrator (Phases 0–4)

- **Priority:** Must — the skill's discovery hinges on its `description` trigger phrases; without them the whole SDLC automation is unreachable.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (frontmatter `description`; § The workflow)
- **Preconditions / inputs:** a GitHub issue `#N`; a consumer repo with the skill synced; `sdlc-config.json` present.
- **Given** a synced consumer repo and issue `#N` **When** the operator says any of "implement issue #N under the SDLC", "run the SDLC for issue #N", "automate REQ-XXX from issue to release", or "do the SDLC stages for [issue]" **Then** the skill activates and begins at Phase 0 (Workflow triage) — fetching the issue via `gh issue view <N> --json labels,title,body` before assigning any `REQ-XXX`.
- **Error paths:** invoked for partial work (stage-1 planning only, or test work alone) → the skill is the wrong entry point; spec directs the user to the manual walkthrough or to `e2e-test-engineer` directly.
- **Fixtures/env:** consumer repo with `.claude/skills/sdlc-implementer/`; a sample GitHub issue; `sdlc-config.json` with `integration_branch`/`release_branch`.

#### REQ-SKILL-IMPLEMENTER-002 — Resume phrase invokes Phase 5 separately

- **Priority:** Must — Phase 5 is a distinct human-gated re-entry; the resume trigger is its only entry point.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (frontmatter `description` "Resume phrase"; § Phase 5)
- **Preconditions / inputs:** a REQ that has already reached the Phase 4 hard stop (release PR open, UAT requested).
- **Given** an issue paused at the Phase 4 UAT gate **When** the operator says "resume REQ-XXX" (or "REQ-XXX UAT done", or re-fires the skill on the same issue) **Then** the skill enters Phase 5, reads portal release state via `curl …/api/projects/<slug>/releases/<version>`, and branches on approval status.
- **Error paths:** resume fired before any Phase 4 stop → no release record to read; skill should report state and not act.
- **Fixtures/env:** a portal release record in `pending` / `approved` / `changes-requested` state.

#### REQ-SKILL-IMPLEMENTER-003 — Phase 0 emits a "Workflow Decision" block and routes

- **Priority:** Must — triage is the gate that stops every issue defaulting to maximum ceremony; it is directly observable as a posted block.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 0 — Workflow triage; "Workflow Decision" announcement template)
- **Preconditions / inputs:** a fetched issue with labels/title/body.
- **Given** issue `#N` fetched **When** Phase 0 runs **Then** the skill announces a "Workflow decision — #N" block containing exactly these fields: Change type, Commit type, Requirement (REQ-XXX or none), Risk, Path, Gates/evidence, Your approvals, Skipped — and then routes: **tracked** → Phase 1; **housekeeping/trivial** → Lightweight path; **compliance-doc-only** → Lightweight path against the existing REQ.
- **Error paths:** classification ambiguous → pause for explicit confirmation; operator may reclassify ("treat this as housekeeping" / "this is HIGH risk").
- **Fixtures/env:** issues seeded with `type:*`/`risk:*` labels, conventional-commit-prefixed titles, and template-typed bodies to exercise the precedence rules.

#### REQ-SKILL-IMPLEMENTER-004 — Phase 0 writes inferred labels back to the issue

- **Priority:** Should — observable side effect; not load-bearing for the cycle but specified as a mandatory step.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 0 step 6)
- **Preconditions / inputs:** a classification result from step 2.
- **Given** Phase 0 has classified the change **When** routing completes **Then** the skill applies the inferred `type:*`/`risk:*` labels — `gh label create <label> --force` (idempotent) then `gh issue edit <N> --add-label <label>` — so the issue ends up labelled.
- **Error paths:** label-seeding step never ran → `--force` create makes it idempotent, no failure.
- **Fixtures/env:** a repo where the labels do not pre-exist.

#### REQ-SKILL-IMPLEMENTER-005 — Lightweight path drives non-tracked work to merge without ceremony

- **Priority:** Must — the off-ramp is the explicit anti-over-ceremony behaviour and has a distinct observable shape (no REQ, no evidence pack, no UAT four-eyes).
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Lightweight path, steps 1–9)
- **Preconditions / inputs:** Phase 0 routed to housekeeping/trivial/compliance-doc-only.
- **Given** a housekeeping/doc-only issue **When** the Lightweight path runs **Then** the skill branches off `$INTEGRATION_BRANCH` with a `chore/` `docs/` `ci/` `build/` `test/` `compliance/` prefix, runs all gates locally (never `--no-verify`), commits with a housekeeping type and **no** `[REQ-XXX]` (compliance: references existing REQ), opens a PR into `$INTEGRATION_BRANCH`, and guides review→merge — with **no** RTM row, evidence pack, UAT four-eyes, or Production approval.
- **Error paths:** the change touches runtime behaviour in `app/`/`lib/` → stop and reclassify as tracked (commit-type rule is the backstop); a `ci:` change → verify-via-dispatch (`gh workflow run <file> --ref <branch>`) before merge.
- **Fixtures/env:** a docs-only issue and a `ci:`-workflow-tweak issue; current generated `ci.yml` with PR-time Quality Gates plus an older post-merge-only fixture to exercise step 7's legacy "no PR-time checks" reporting.

#### REQ-SKILL-IMPLEMENTER-006 — Phase 1 writes the implementation plan from the template at a fixed path

- **Priority:** Must — the implementation plan is the primary Stage-1 artefact and closes four framework clauses on upload.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 1 step 5; clause table)
- **Preconditions / inputs:** tracked route; REQ-XXX assigned (next free in `compliance/RTM.md`); risk classified per `Test_Policy.md`.
- **Given** a tracked issue with REQ-XXX assigned **When** Phase 1 runs **Then** the skill creates `compliance/plans/REQ-XXX/implementation-plan.md` from `sdlc/files/_common/Implementation_Plan_TEMPLATE.md`, retaining the Framework-attribution section that closes **ISO 29119 §3.4** (acceptance criteria + verification strategy), **ISO 27001 A.8.25** (threat model + secrets/deps), **GDPR Art. 25** (data flows + lawful basis + retention, or explicit "no personal data"), and **EU AI Act Art. 11** (model provenance + oversight, or explicit "no AI in scope"); HIGH/CRITICAL additionally include threat model (STRIDE), four-eyes attestation slot, rollback plan.
- **Error paths:** a clause genuinely doesn't apply → mark `N/A — <reason>`, never delete the section (empty stubs break the audit trail).
- **Fixtures/env:** the synced `Implementation_Plan_TEMPLATE.md`; an empty `compliance/RTM.md`.

#### REQ-SKILL-IMPLEMENTER-007 — Phase 1 delegates to requirements-aligner, adr-author, risk-register-keeper (steps 6→7→8)

- **Priority:** Must — the delegation chain is the observable contract that the plan's SRS-ID / ADR / risk sections are produced by sub-skills, not inline.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 1 steps 6, 7, 8; § Sub-skill return semantics)
- **Preconditions / inputs:** the implementation plan exists; risk class known.
- **Given** the plan is drafted **When** Phase 1 steps 6→7→8 run as one flowing sequence (no pause between) **Then** the skill invokes `Skill(name:"requirements-aligner")` to populate the AC table's SRS-ID column, `Skill(name:"adr-author")` to decide ADR-worthiness and inject an ADR-NNN reference or no-ADR rationale, and `Skill(name:"risk-register-keeper")` for MEDIUM/HIGH classifications to inject the RISK-NNN reference list — each via the standard Claude Code Skill mechanism, never authored inline.
- **Error paths:** stopping after a sub-skill's "Return to the running sdlc-implementer context" line is the documented bug; the orchestrator must keep going (opt-in-to-pause, not opt-out).
- **Fixtures/env:** all three sub-skills synced; a MEDIUM-risk REQ to exercise the risk-register-keeper branch.

#### REQ-SKILL-IMPLEMENTER-008 — Phase 1 updates RTM and posts a plan-summary comment

- **Priority:** Should — observable artefacts (RTM row + issue comment) but supporting rather than gate-defining.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 1 steps 9, 10)
- **Preconditions / inputs:** plan written; sub-skills returned.
- **Given** the plan is complete **When** Phase 1 finishes authoring **Then** the skill updates `compliance/RTM.md` with REQ-XXX (title, risk class, linked issue, placeholder test cases) and posts a plan-summary issue comment containing: TL;DR, Risk class + signals, Acceptance criteria (with SRS-IDs), Architectural decisions (ADR-NNN or no-ADR rationale), Risk register entries (RISK-NNN list), Technical approach, Dependencies, Test scope.
- **Error paths:** none specified.
- **Fixtures/env:** a writable `compliance/RTM.md`.

#### REQ-SKILL-IMPLEMENTER-009 — Phase 1 PAUSE for HIGH/CRITICAL plan approval

- **Priority:** Must — this is the first explicit human pause point and a hard compliance constraint.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 1 step 11; § Sub-skill return semantics bullet 1; § Compliance constraints #3)
- **Preconditions / inputs:** risk class computed in Phase 1 step 2.
- **Given** a tracked REQ at the end of Phase 1 **When** the risk class is HIGH or CRITICAL (or `--require-plan-approval` / `DEVAUDIT_REQUIRE_PLAN_APPROVAL=1` is set) **Then** the skill pauses for human plan approval before any code is written; LOW and MEDIUM pass through to Phase 2 automatically.
- **Error paths:** forcing pause-on for all classes via the flag/env var must hold even for LOW/MEDIUM.
- **Fixtures/env:** a HIGH-risk REQ; a LOW-risk REQ with `DEVAUDIT_REQUIRE_PLAN_APPROVAL=1` to assert the override.

#### REQ-SKILL-IMPLEMENTER-010 — Phase 2 E2E delegation gate: pre-test-work declaration

- **Priority:** Must — structurally-enforced delegation contract (devaudit#132); the literal line is directly assertable in the transcript.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Sub-skill invocation contract; § Phase 2 step 3)
- **Preconditions / inputs:** Phase 2 reached; the change needs e2e/visual-regression coverage.
- **Given** the orchestrator is about to create or edit ANY `e2e/**/*.spec.ts` file **When** that test work is reached **Then** it must first output the single literal line verbatim — `Delegating e2e test work to e2e-test-engineer.` — then immediately invoke `Skill(name:"e2e-test-engineer", args:"<change summary + plan pointer compliance/plans/REQ-XXX/implementation-plan.md>")`, and **must not** author or edit any `e2e/**/*.spec.ts` in its own tool calls.
- **Error paths:** authoring a spec inline is the inertia trap → STOP and re-invoke the skill.
- **Fixtures/env:** a UI-facing MEDIUM+ REQ that requires e2e; transcript capture to assert the literal line precedes any spec edit.

#### REQ-SKILL-IMPLEMENTER-011 — Phase 2 E2E delegation self-audit before Phase 3

- **Priority:** Must — the post-hoc gate that catches a missed delegation; observable as a per-spec attestation over the diff.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 2 step 9)
- **Preconditions / inputs:** Phase 2 implementation landed; a feature branch diff vs `$INTEGRATION_BRANCH`.
- **Given** Phase 2 is complete **When** the skill runs `git diff "$INTEGRATION_BRANCH"...HEAD --name-only` **Then** for every `e2e/**/*.spec.ts` entry it states one of: "Authored via e2e-test-engineer skill invocation on turn N" (with a verifiable turn pointer) or "Pre-existing file; only mechanical edits applied directly"; if a spec fits neither category it must STOP, not proceed to Phase 3, revert the direct edits (`git checkout "$INTEGRATION_BRANCH" -- <file>`), and redo via `Skill(name:"e2e-test-engineer")`.
- **Error paths:** fabricating a turn pointer or omitting a file is worse than the original gap (pollutes the audit trail with false attribution).
- **Fixtures/env:** a branch with a directly-authored spec to assert the STOP path fires.

#### REQ-SKILL-IMPLEMENTER-012 — Phase 2 gate-failure retry cap and no-bypass rule

- **Priority:** Must — observable as: after 3 failed gate attempts the skill halts and surfaces output; no bypass tokens appear.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 2 steps 5–6; § Principles "Never bypass a gate")
- **Preconditions / inputs:** a local gate (lint/tsc/unit/semgrep/audit/e2e) is failing.
- **Given** a failing gate **When** Phase 2 iterates **Then** the skill retries up to N=3 (read failure → propose fix → apply → re-run); on exhausted attempts it halts with full failure output and surfaces to the human — never using `--no-verify`, `eslint-disable`, `@ts-expect-error`, or `xfail`.
- **Error paths:** a structurally-wrong gate → halt and surface the blocker (fix the gate, not the bypass).
- **Fixtures/env:** a REQ whose change deterministically fails a fast gate.

#### REQ-SKILL-IMPLEMENTER-013 — Phase 3 delegates the three per-REQ SoT artefacts then organises + uploads evidence

- **Priority:** Must — the evidence-pack composition (three sub-skill artefacts at fixed paths + uploads) is the core auditable output of Stage 3.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 3 steps 1–8)
- **Preconditions / inputs:** Phase 2 landed; REQ-XXX known.
- **Given** Phase 3 reached **When** the skill runs steps 1→2→3 (one flowing sequence) **Then** it invokes `requirements-aligner` (drops `compliance/evidence/REQ-XXX/srs-alignment.md`, `evidence_type=srs_alignment`), `adr-author` (`compliance/evidence/REQ-XXX/architecture-decision.md`, `evidence_type=architecture_decision`), and `risk-register-keeper` (`compliance/evidence/REQ-XXX/risk-assessment.md`, `evidence_type=risk_assessment`); then organises all artefacts under `compliance/evidence/REQ-XXX/` with date-prefixed naming and uploads each via `devaudit push <slug> REQ-XXX <evidence-type> <file> …`.
- **Error paths:** uploads not landing → step 7 verifies via portal `/requirements/REQ-XXX/evidence` listing.
- **Fixtures/env:** the three sub-skills synced; a `devaudit` CLI shim; a portal slug.

#### REQ-SKILL-IMPLEMENTER-014 — Phase 4 opens the release PR and HARD STOPS for UAT review

- **Priority:** Must — the second explicit human pause; the UAT review gate is the load-bearing control and must never be skipped or merged with the check red.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 4 steps 1, 4–6; § Sub-skill return semantics bullet 2; § Compliance constraints #1)
- **Preconditions / inputs:** evidence uploaded; branch targets resolved from `sdlc-config.json`.
- **Given** Stage 3 complete **When** Phase 4 runs **Then** the skill opens the release PR into `$RELEASE_BRANCH` (`--base $RELEASE_BRANCH --head $INTEGRATION_BRANCH`, e.g. `develop → main`) with a body containing Closes #N, REQ-XXX, Risk, Evidence link, (HIGH/CRITICAL) four-eyes attestation + rollback reference, test plan, SDLC checklist; comments the resume instruction on the issue; then **hard stops** — it does not merge; the next action is the human reviewing on the portal.
- **Error paths:** external gate hangs for unrelated reasons → cancel-and-admin-merge allowed only when all three hold (≥3 other gates green, no scope overlap, fallback verification exists), documented on PR + release ticket `## Verification`.
- **Fixtures/env:** `sdlc-config.json` with `integration_branch` and `release_branch` configured; `check-release-approval.yml` present.
- **Update (#1099 WP1):** Phase 4 handoffs name the portal action and give the release URL (`<base_url>/projects/<slug>/releases/<id>`): click Submit for UAT review, perform and record UAT, approve or request changes, resolve a failed execution (a project admin, pending metasession-dev/devaudit#918). The skill runs `devaudit release check` first and never tells anyone to run a script to record or submit UAT. Evidence reaches the portal through CI, so "evidence uploaded" means the `Compliance Evidence Upload` run succeeded.
- **Update (#1096):** Phase 4 step 5b runs `devaudit doctor --json` and lists every AC of the in-scope REQ that is not `covered` (REQ-CLI-DOCTOR-024) in the handoff with three options (add or retitle a test; raise `release_gate_tier`; mark the AC not applicable on the portal with a reason). It reports and never blocks.

#### REQ-SKILL-IMPLEMENTER-015 — Phase 4 four-eyes reviewer ≠ trigger user for HIGH/CRITICAL

- **Priority:** Must — segregation-of-duties is a hard compliance constraint (SOC 2 CC8) and an observable halt.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 4 step 2; § Compliance constraints #2)
- **Preconditions / inputs:** risk class HIGH or CRITICAL; configured UAT reviewer.
- **Given** a HIGH/CRITICAL release PR **When** the configured UAT reviewer equals the skill-trigger user **Then** the skill halts with a configuration error ("HIGH/CRITICAL risk requires an independent UAT reviewer …"); on solo-operator teams the supported interpretation is actor-type (AI trigger vs human approver) documented under `## Sign-off (dual-actor)`.
- **Error paths:** missing independent reviewer and no dual-actor attestation → four-eyes claim is performative; halt.
- **Fixtures/env:** a HIGH REQ with reviewer == trigger user to assert the halt.

#### REQ-SKILL-IMPLEMENTER-016 — Phase 5 finalise vs change-request loop branches on portal state

- **Priority:** Must — Phase 5 is the release-outcome gate; full UAT re-review on change-requests is a hard constraint.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 5; § Compliance constraints #4)
- **Preconditions / inputs:** `resume REQ-XXX`; a portal release in a known state.
- **Given** Phase 5 invoked **When** portal state is **UAT approved** **Then** the skill merges with `--merge` (squash/rebase blocked), watches `post-deploy-prod.yml`, verifies production smoke evidence (`--environment production`) landed, PATCHes the release to `released`, comments + closes the issue. **When** state is **changes requested** **Then** it adds `## Change-request iteration N` to the implementation plan, re-runs Phase 2 (same e2e delegation) + Phase 3 (new artefacts only), pushes to the same branch (no force-push), re-requests UAT review, and hard-stops again. **When** still pending → report and do not act.
- **Error paths:** production smoke fails → do NOT mark Released; file an `[INCIDENT]` defect, page on-call, follow rollback plan.
- **Fixtures/env:** portal releases in approved / changes-requested / pending states; a `post-deploy-prod.yml`.

#### REQ-SKILL-IMPLEMENTER-017 — LAST/NEXT status sticky maintained on every transition + handoff

- **Priority:** Should — navigability convention; observable as an idempotent marker-tagged issue comment but not gate-defining.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ SDLC navigability — LAST/NEXT status sticky; per-phase "Update SDLC status sticky" steps)
- **Preconditions / inputs:** an issue number; `scripts/update-sdlc-status.sh` synced.
- **Given** a stage transition or operator-action handoff **When** it occurs **Then** the skill invokes `bash scripts/update-sdlc-status.sh "$ISSUE_NUM" "<LAST: past-tense, identifiers>" "<NEXT: names the actor>"` — idempotently editing the single marker-tagged comment (never duplicating) — and leads the in-chat turn with the matching `**LAST:** / **NEXT:**` two-line shape; on divergence the comment is canonical.
- **Error paths:** updating on every internal step spams the sticky → update only at transition/handoff cadence.
- **Fixtures/env:** the synced `scripts/update-sdlc-status.sh`.

#### REQ-SKILL-IMPLEMENTER-018 — Over-scoped issue refused at Phase 1

- **Priority:** Should — observable halt with a split proposal; protects the one-issue contract.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 1 step 4; § Principles "Issue too big? Refuse at Phase 1")
- **Preconditions / inputs:** an issue spanning multiple distinct deliverables.
- **Given** an issue that decomposes into multiple requirements **When** Phase 1 detects over-scoping **Then** the skill halts with a clear split proposal and does not proceed past Phase 1 (never silently sub-divides into multiple REQs).
- **Error paths:** none — halting is the specified behaviour.
- **Fixtures/env:** a multi-deliverable issue (e.g. "SAML SSO + dashboard reorg + DB migration").

#### REQ-SKILL-IMPLEMENTER-019 — Scope-expansion halt gate fires on any user request outside ACs, across all phases

- **Priority:** Should — observable halt when a user requests work outside the current REQ's acceptance criteria during any phase (DevAudit-Installer#171); generalises the change-request loop's scope-expansion halt (change-request-loop.md §"If the change-request is fundamentally a different REQ") to all phases, not just Phase 5.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Scope-expansion halt gate): fires on every user work request while a REQ is active. Reads the current REQ's `test-scope.md` (or `implementation-plan.md` § Acceptance Criteria), checks whether the request maps to an existing AC. If no — halts with a scope-expansion message and waits for the user to choose: (a) file a separate issue, (b) amend REQ-XXX's scope (with a warning that Stage 3+ evidence is invalidated), or (c) abandon the request. Distinct from Phase 2 step 4's "plan deviation" rule (approach deviations, not scope expansions).
- **Preconditions / inputs:** An active REQ in any phase (2–5); a user request that may or may not map to an existing AC.
- **Given** a user request that maps to an existing AC **When** the scope-expansion gate checks **Then** the agent proceeds (or enters the change-request loop if in Phase 5). **Given** a user request that does NOT map to any existing AC **When** the gate checks **Then** the agent halts with the scope-expansion message and does not implement the change until the user picks (a), (b), or (c). **Given** the user picks (b) amend scope **When** evidence is already compiled (Stage 3+) **Then** the agent warns that existing evidence is invalidated and must be re-compiled.
- **Error paths:** The agent must not implement the out-of-scope change before the user decides — the inertia trap is the failure mode this gate exists to interrupt.
- **Fixtures/env:** A REQ in Phase 2 with a user request for a behaviour not in any AC; a REQ in Phase 3 with a user request to add an evidence artefact not in the plan; a REQ in Phase 5 where the request maps to an existing AC (proceeds to change-request loop).

#### REQ-SKILL-IMPLEMENTER-020 — Phase 3 test-execution-summary.md includes Test Executions section (ISO 29119-3 Test Completion Report)

- **Priority:** Should — the Test Completion Report (ISO/IEC/IEEE 29119-3 §4.14) is the encompassing artefact summarising all test executions for a release; the Test Executions section is what distinguishes it from a single-run log (DevAudit-Installer#209).
- **Source:** `sdlc/files/_common/3-compile-evidence.md` and `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`: the summary records first-class iterations and test executions returned by the portal, including stage, outcome, provenance, and linked remediation.
- **Preconditions / inputs:** At least one CI run (test execution) has completed for the release; execution data available from the portal API or local `compliance/evidence/REQ-XXX/` directory.
- **Given** a release with N completed test executions **When** the `sdlc-implementer` runs Phase 3 Step 4a **Then** it queries first-class portal execution data and populates the Test Executions table; the operator does not reconstruct executions from filenames. **Given** the execution API is unavailable or incomplete **Then** readiness remains unresolved and the gap is recorded. **Given** a release with a single execution **Then** the summary lists that execution. **Given** an execution failed **Then** the final assessment identifies the failure, linked incident, remediation, and later resolving execution where one exists.
- **Error paths:** No execution data available from portal or local → the section is populated with placeholder rows and a note that execution data was unavailable; the summary still uploads (the Test Completion Report is required evidence, not optional). The skill must not skip Step 4a — even an empty query result is recorded, preventing silent gaps in the audit trail.
- **Fixtures/env:** A REQ with 2 completed CI runs (execution data from portal stub or local evidence directory); a REQ with a single execution; a REQ with a failed execution.

#### REQ-SKILL-IMPLEMENTER-021 — Phase 3 delegates incident filing to e2e-test-engineer, never files inline (#210 AC10)

- **Priority:** Must — the sdlc-implementer must not file incident issues directly; incident filing is delegated to `e2e-test-engineer` which emits the `### Framework attribution` section and applies the `incident` label.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` Phase 3: when a test failure is discovered during evidence compilation, the skill delegates to `e2e-test-engineer` to file the incident issue rather than filing it inline.
- **Preconditions / inputs:** Test failure discovered during Phase 3 evidence compilation.
- **Given** a test failure during Phase 3 **When** the skill discovers it **Then** it invokes `e2e-test-engineer` to file the incident issue with `incident` label and `### Framework attribution` section; the skill does not file the issue itself.
- **Error paths:** e2e-test-engineer unavailable → halt with "Cannot file incident — e2e-test-engineer skill required for incident filing."
- **Fixtures/env:** Phase 3 with a test failure; verify issue is filed by e2e-test-engineer, not sdlc-implementer.

#### REQ-SKILL-IMPLEMENTER-022 — Phase 5 change-request loop classifies defect vs scope change, delegates defect filing (#210 AC11)

- **Priority:** Must — the change-request loop must distinguish defects (implementation doesn't match ACs) from scope changes (user wants more), and delegate defect filing to `e2e-test-engineer`.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` Phase 5 change-request loop: classifies each change request as **defect** (delegate to `e2e-test-engineer` to file incident before fixing) or **scope change** (use the existing scope-expansion halt gate).
- **Preconditions / inputs:** Change-request comments from the PR or portal release page.
- **Given** a change request classified as a defect **When** the change-request loop processes it **Then** it delegates to `e2e-test-engineer` to file the incident issue before fixing; **Given** a change request classified as a scope change **When** the loop processes it **Then** it triggers the scope-expansion halt gate.
- **Error paths:** Misclassification risk — the skill must err on the side of "defect" when ambiguous (filing an incident is safer than silently absorbing a defect as scope change).
- **Fixtures/env:** Change request that is a defect (expect incident filed by e2e-test-engineer); change request that is a scope change (expect halt gate).

#### REQ-SKILL-IMPLEMENTER-023 — Compliance constraint: never file incidents inline — delegate to sub-skills (#210 AC13)

- **Priority:** Must — the sdlc-implementer must never file incident issues directly; it must delegate to `e2e-test-engineer` or `governance-doc-author` for incident filing.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` compliance constraints #7: "Never file incidents inline. Delegate incident filing to `e2e-test-engineer` (test-related incidents) or `governance-doc-author` (governance/process incidents). The sdlc-implementer orchestrates; sub-skills execute."
- **Preconditions / inputs:** Any phase where an incident is discovered.
- **Given** an incident is discovered during any phase **When** the skill needs to file it **Then** it delegates to the appropriate sub-skill (`e2e-test-engineer` for test-related, `governance-doc-author` for governance/process); it never files the issue itself.
- **Error paths:** N/A — this is a constraint, not a flow.
- **Fixtures/env:** Incident discovered in Phase 2, 3, 5; verify delegation to sub-skill in each case.

#### REQ-SKILL-IMPLEMENTER-024 — Phase 3 generates nil-incident report when no incidents occurred (#210 AC15-AC18)

- **Priority:** Should — when no incidents occurred during the release cycle, a nil-incident report must be generated as a positive attestation.
- **Source:** `sdlc/files/_common/3-compile-evidence.md` Step 4b: nil-report generation walkthrough; `sdlc/files/_common/governance/nil-incident-report.md.template`: when no `incident-report-*.md` files exist, generates `nil-incident-report.md` with the release version, date, and "no incidents" attestation.
- **Preconditions / inputs:** No incident reports in `compliance/governance/`; release version and date available.
- **Given** a release with no incidents **When** Phase 3 Step 4b runs **Then** `nil-incident-report.md` is generated from the template with the release version and date; the file is uploaded as `compliance_document` evidence. **Given** incident reports exist **Then** Step 4b is skipped.
- **Error paths:** Template missing → warning, continue.
- **Fixtures/env:** Release with no incidents (expect nil report generated and uploaded); release with incidents (expect no nil report).

#### REQ-SKILL-IMPLEMENTER-025 — Phase 1 step 5b extracts test-scope.md and test-plan.md into compliance/evidence/ (#226)

- **Priority:** Must — the CI validator and the pre-push hook (REQ-FRAMEWORK-HOOK-004) look for these two files in `compliance/evidence/REQ-XXX/`, not in the plan folder.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 1 step 5b, and its drift-management paragraph).
- **Preconditions / inputs:** The implementation plan exists at `compliance/plans/REQ-XXX/implementation-plan.md` (step 5).
- **Given** the plan **Then** the skill writes `test-scope.md` (the AC table with SRS-IDs, risk class and verification method per AC, from the plan's acceptance-criteria table) and `test-plan.md` (the test file listing with AC coverage, test type and whether each AC has a test, from the plan's test-scope section) under `compliance/evidence/REQ-XXX/`. The plan folder keeps the full plan.
- **Given** the AC table later changes (requirements-gap flow option b, scope-expansion halt option b, a plan deviation) **Then** both files are re-extracted from the updated plan and the existing evidence invalidated, so the three never disagree.
- **Error paths:** Without them `validate-compliance-artifacts.sh` fails and the push is blocked.
- **Fixtures/env:** A plan with an AC table; the two extracted files in the evidence folder.

#### REQ-SKILL-IMPLEMENTER-026 — Phase 3 step 6b copies implementation-plan.md to compliance/evidence/ (#226)

- **Priority:** Must — the third artefact the compliance validator expects (with REQ-SKILL-IMPLEMENTER-025's two).
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 3 step 6b).
- **Given** Phase 3 evidence compilation **Then** the skill copies, not moves, `compliance/plans/REQ-XXX/implementation-plan.md` to `compliance/evidence/REQ-XXX/implementation-plan.md` for every risk class (the portal's release checklist wants a plan for every requirement), so the plan directory keeps its original and the evidence folder holds the version that shipped. **Given** a requirement whose evidence folder has no copy but whose `compliance/plans/REQ-XXX/` does **When** `upload-compliance-documents.sh` runs **Then** it uploads the plan from `compliance/plans/` as `implementation_plan` (once; an evidence-folder copy wins, and a plan of a requirement outside the release is never uploaded) (#1080).
- **Error paths:** A missing copy fails `validate-compliance-artifacts.sh` for MEDIUM/HIGH and blocks the push.
- **Fixtures/env:** The evidence folder listing after Phase 3 (`test-scope.md`, `test-plan.md`, `implementation-plan.md`).

#### REQ-SKILL-IMPLEMENTER-027 — Resume protocol: the skill is re-invoked after environment detours and re-reads its state idempotently (#226)

- **Priority:** Must — a skill invocation is stateless instruction injection, so continuity depends on re-entry reconstructing state from the repository.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` ("Re-invocation protocol"; Phase 5 step 0).
- **Preconditions / inputs:** The native agent finished an environment detour (service start-up failure, test-debug loop, CI failure fix) or a UAT activity.
- **Given** a detour **Then** the agent re-invokes `Skill(name: "sdlc-implementer", args: "resume REQ-XXX — <detour>, re-enter at Phase N")`. The skill re-reads `compliance/RTM.md` (row exists and carries the provenance stamp), `compliance/evidence/REQ-XXX/` (which artefacts exist), `git log` (commits already made) and, in Phase 5, the release ticket location and the merge commit, then resumes at the right phase (for example Phase 3 step 1 when implementation is complete but evidence is missing).
- **Given** a phase boundary **Then** the agent must not advance (Phase 2 to 3, 3 to 4) without re-invoking, except at steps where the skill says it continues in the same turn.
- **Given** the release PR was merged **Then** the workflow is not done until deploy verification, portal `released` and the close-out PR (REQ-SKILL-IMPLEMENTER-029).
- **Error paths:** None; the re-read is read-only.
- **Fixtures/env:** A repo with evidence for Phases 1 to 2 only; the resume lands at Phase 3.

#### REQ-SKILL-IMPLEMENTER-028 — Native-agent responsibilities and the re-invocation boundary are documented in SKILL.md (#226)

- **Priority:** Must — the division of labour is what makes REQ-SKILL-IMPLEMENTER-027 work; unwritten, agents either stall on environment problems or skip the skill.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` ("Native agent responsibilities and re-invocation protocol").
- **Given** the skill text **Then** it states that the native agent executes commands (`npx playwright test`, dev servers, databases), debugs the environment (ports, locks, Playwright browser installs), inspects the browser, interacts with external services (host deploy status, UAT health checks; the DevAudit portal is human-only) and does git operations (merge conflicts, push retries, branches), while the skill owns workflow decisions, compliance checklists and phase transitions.
- **Error paths:** None; documentation requirement, checked by the skill-text tests.
- **Fixtures/env:** The rendered `.claude/skills/sdlc-implementer/SKILL.md` in a consumer.

#### REQ-SKILL-IMPLEMENTER-029 — Phase 5 close-out: RTM to APPROVED - DEPLOYED, ticket to approved-releases/, commit and push; a deferred ticket is not closed out (#226, #956)

- **Priority:** Must — without it a released REQ stays in `pending-releases/` and the next release treats it as in flight.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 5); `scripts/close-out-release.sh` (REQ-FRAMEWORK-BUNDLE-004).
- **Preconditions / inputs:** The portal release is `released` (UAT approved, merged to the release branch with `gh pr merge --merge`, deployed and verified).
- **Given** the portal `repository_dispatch('release-closed')` **Then** the automated `chore/close-out-REQ-XXX` PR against the integration branch updates the RTM, moves the ticket to `compliance/approved-releases/` and moves manifest-listed predecessors to `superseded-releases/`; the skill verifies and merges it once its required checks are terminal green on the current head SHA. If no PR appears, the skill manually dispatches the Release Close-out workflow; `scripts/close-out-release.sh` runs locally only for documented recovery or catch-up, and a normal direct close-out commit to a protected branch is never made.
- **Given** the ticket carries `Release intent: deferred-to-next` (REQ-FRAMEWORK-BUNDLE-006) **Then** it is not closed out: it stays in `pending-releases/` with RTM status `DEFERRED` (REQ-FRAMEWORK-DEFERRAL-001, REQ-SKILL-IMPLEMENTER-034).
- **Error paths:** A close-out PR with failing checks is not merged; the skill reports and stops.
- **Fixtures/env:** A fixture release moving from `pending-releases/` to `approved-releases/`; a deferred ticket left in place.

#### REQ-SKILL-IMPLEMENTER-030 — Commit-scoping rule: the subject cites the active REQ only, other REQs go in the body (#226)

- **Priority:** Must — the portal's commit scanner reads `REQ-XXX` tags from commit subjects, so citing another REQ in the subject attributes out-of-scope requirements to the current release.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` ("Commit-scoping rule for SRS updates").
- **Given** a commit authored in REQ-XXX's flow **Then** the subject cites `[REQ-XXX]` (the active REQ) even when the content touches others; other REQs appear in the body (`Ref: REQ-083, REQ-084`), never the subject. A subject such as `docs: [REQ-083/084] ...` is wrong.
- **Error paths:** A wrong subject is not rejected by a hook; the portal association is wrong. `validate-commits.sh` accepts the `[REQ-NNN]` or `Ref:` forms (REQ-FRAMEWORK-VALIDATE-001).
- **Fixtures/env:** Two commit messages, correct and incorrect.

#### REQ-SKILL-IMPLEMENTER-031 — Phase 4 blocker classification can run as an executable PR watch loop with persisted retry state (#304)

- **Priority:** Must — the phase-4 handoff must be able to keep classifying blocked/waiting PRs without relying on a one-shot manual `gh` read.
- **Source:** `sdlc/src/bin/devaudit-sdlc.cjs` (`--watch-pr` path), `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 4 blocker classification / executable loop)
- **Preconditions / inputs:** A release PR number, repo name, and optionally release/version context (`--repo`, `--release`, `--project-slug`, `--base-url`).
- **Given** a blocked or waiting release PR **When** the operator or skill runs `node SDLC/bin/devaudit-sdlc.cjs --watch-pr=<N> ...` **Then** the watcher polls `gh pr view` / `gh pr checks`, classifies the blocker truthfully, persists retry state to `.sdlc-pr-watch.json`, re-runs likely flaky workflows within bounded retry counts, and re-runs the Release Approval Gate when the portal is already approved but GitHub has not yet converged. **Given** `--once` is supplied **Then** it performs a single classification pass and exits without the bounded poll loop.
- **Error paths:** Missing required args or unreachable GitHub/portal state cause a classified halt; the watcher must not claim a PR is ready while checks are still pending or blocked.
- **Fixtures/env:** Green PR, pending PR, flaky-failing PR, and portal-approved-but-gate-stale PR fixtures; assert `.sdlc-pr-watch.json` persistence.

#### REQ-SKILL-IMPLEMENTER-032 — Phase 2 step 5b plan↔spec cross-check before running E2E

- **Priority:** Should — closes the specific gap REQ-FRAMEWORK-HOOK-005 catches at push time, but earlier: a plan can name Playwright as the verification method for a surface and ship zero of it, undetected by both the AC-consistency check (compares plan vs. test-scope.md, not vs. actual specs) and the pre-push freshness check (answers "did *a* run happen," not "does coverage exist for *this* REQ") — observed concretely on `example-app` REQ-095. Devaudit-installer#578.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 2 step 5b, "Plan ↔ spec cross-check") — commit `a0de8a1`. CI-side mirror: `validate-compliance-artifacts.sh`, so a `--no-verify` bypass or non-husky push path is still caught before Stage 3 evidence compilation completes.
- **Preconditions / inputs:** `compliance/plans/REQ-XXX/implementation-plan.md`'s test-strategy/surface-inventory section names at least one surface with "Playwright"/"E2E" as its verification method.
- **Given** Phase 2 reaches step 5b, before running E2E **When** the skill reads the plan's surface inventory **Then** for each surface naming Playwright/E2E, it checks whether any `e2e/**/*.spec.ts` file tags the REQ (`tagTest('REQ-XXX', ...)` or `@requirement REQ-XXX`) covering that surface. **Given** the plan names Playwright for a surface and no spec tags the REQ at all **Then** the skill halts: "Plan requires Playwright coverage for REQ-XXX (surface: `<surface>`); no spec tags this REQ... Invoke `e2e-test-engineer` to write the planned coverage, or amend the plan (Phase 1 step 5b drift management) if the surface genuinely doesn't need it — do not silently ship the gap." **Given** the plan names no Playwright coverage anywhere **Then** the check is a no-op.
- **Error paths:** Halt is non-bypassable within the skill's own flow (operator must either write coverage or amend the plan); a `--no-verify` git bypass still gets caught by the CI-side `validate-compliance-artifacts.sh` mirror before Stage 3 completes.
- **Fixtures/env:** A plan naming Playwright for a surface with a tagging spec (no-op, proceeds); a plan naming Playwright with zero tagging specs (halts); a plan naming no Playwright coverage (no-op, check skipped entirely).

#### REQ-SKILL-IMPLEMENTER-033 — Phase 5 portal-state read uses `devaudit release status` with the person's viewer key (#876, #1099)

- **Priority:** Should — least-privilege for the one read-only portal lookup the skill performs locally; the uploader key can mutate evidence/releases, the viewer key structurally cannot, and the uploader key is CI-only.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 5 step 1, "Read portal state with `devaudit release status --json`").
- **Preconditions / inputs:** A REQ resumed into Phase 5 (`resume REQ-XXX`); the person's viewer key (REQ-CLI-AUTH-008) and `devaudit release status` (REQ-CLI-RELEASE-002).
- **Given** Phase 5 step 1 **Then** the skill reads the release with `devaudit release status --json`, never a raw `curl`, and never falls back to the uploader key. **Given** the portal is unreachable (exit 4) **Then** it retries up to 3 times (5s, 15s, 45s) and halts "Portal unreachable…" if all fail. **Given** no working viewer key (exit 3) **Then** it halts naming the operator's repair (`devaudit doctor --fix` or `devaudit auth viewer-key set`). It never guesses portal state.
- **Error paths:** Never guesses portal state — halts on unreachable or missing key.
- **Fixtures/env:** Skill-behaviour contract (prose in `SKILL.md`); `cli/test/release-lifecycle-workflows.test.ts` pins that the skill names `devaudit release status` and no retired script.

#### REQ-SKILL-IMPLEMENTER-034 — Closing a release PR without releasing: ticket intent, RTM `DEFERRED`, manual portal defer, promotion gate (#955, #956)

- **Priority:** Should — without a documented procedure a REQ whose release PR is closed unmerged either loses its deferral decision (only a closed PR) or ships unapproved inside another release.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` ("Closing a release PR without releasing"), `references/change-request-loop.md` ("If the release PR is closed without releasing"), `docs/ADR/ADR-002-release-deferral.md`. Builds on `REQ-FRAMEWORK-BUNDLE-006..008` and `REQ-FRAMEWORK-DEFERRAL-001..004`; it does not add scripts.
- **Preconditions / inputs:** a REQ that finished Phases 1–4 (any of `draft`, `uat_review`, `uat_rejected`, `uat_approved` on the portal) whose release PR is closed unmerged and whose work is meant to ship with the next release.
- **Given** that situation **Then** the skill (1) sets `- **Release intent:** deferred-to-next — <reason, PR #N closed unmerged>` on `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md` (the sole declaration; the ticket stays in `pending-releases/`), (2) sets the RTM row to `DEFERRED`, (3) comments on the closed PR, (4) tells the operator that deferring the **portal** release is a **manual, admin-only** action (portal UI session or `POST /api/releases/[id]/defer` with a personal access token; never the CI/API/viewer keys, never the CI status PATCH) which the skill does not perform, and that without it the release stays at its state until the absorbing release supersedes it at close-out, and (5) states that the absorbing release must list the REQ under `**Absorbed predecessor releases:**`, otherwise the `develop -> main` promotion gate (`check-deferred-reqs-in-range.sh`, inside Release Scope Integrity) fails. A deferred ticket is not closed out by Phase 5 (`REQ-SKILL-IMPLEMENTER-029`).
- **Error paths:** the skill never runs a portal action itself and never invents a defer/resume command: for the portal step it hands the operator `devaudit doctor --fix` (their PAT, a typed reason, confirmation; REQ-CLI-DOCTOR-010) and documents the manual route as the fallback; the admin/PAT requirement is stated for both routes.
- **Fixtures/env:** prose contract in `SKILL.md`; text-pinning assertions in `cli/test/req-bundling.test.ts`.
- **Update (#1099 WP1):** the skill never runs `devaudit doctor --fix` itself and never uses the PAT. The operator runs `doctor --fix` (their PAT, at a terminal, typed reason and confirmation; interactive-only) or uses the portal UI; defer and resume are session-only on the portal until metasession-dev/devaudit#923, where `doctor --fix` reports that the route does not accept a PAT.

#### REQ-SKILL-E2E-001 — Trigger phrases fire the e2e pack maintainer / bootstrapper

- **Priority:** Must — discovery of the test-pack skill, including its invocation by `sdlc-implementer` Phase 2.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (frontmatter `description`; § The workflow Phase 1)
- **Preconditions / inputs:** a change (issue/PR/branch/pasted description) and a consumer repo.
- **Given** a consumer repo with the skill synced **When** the operator says "add e2e tests for [ticket]", "update the test pack", "what tests do we need for this issue", "are any tests obsolete", "run the e2e tests and file issues", "add visual regression coverage", "set up e2e tests for this project", or "bootstrap an e2e suite" — OR `sdlc-implementer` invokes it in Phase 2 **Then** the skill activates at Phase 1 (Orient): detect test stack, detect issue tracker, take in the change.
- **Error paths:** invoked for unit/component/API-only or performance tests → out of scope; the skill should decline.
- **Fixtures/env:** a repo with a Playwright/Cypress config (or none, to exercise bootstrap); a `gh`-resolvable issue.

#### REQ-SKILL-E2E-002 — Bootstrap (Phase 1b) only when no suite exists, with confirmation gates

- **Priority:** Must — bootstrap is a distinct, observable branch that ends with one passing smoke test; it pauses for a framework-choice "yes".
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 1b — Bootstrap)
- **Preconditions / inputs:** Phase 1 found no e2e framework, no test directory, no relevant deps.
- **Given** a repo with no e2e suite **When** Phase 1b runs **Then** the skill proposes a framework with a one-line rationale and **gets explicit confirmation** before installing, installs via the official installer, lays out the test directory, configures best-practice options, writes one Page Object + one smoke test that **must pass** before continuing, wires runner scripts, and offers a CI job **without committing it without confirmation**.
- **Error paths:** on a DevAudit project `.github/workflows/ci.yml` is generated/do-not-edit → drive the E2E gate from `sdlc-config.json` (`e2e_setup_command`/`e2e_env`), then `devaudit update`; never hand-edit `ci.yml`.
- **Fixtures/env:** an empty repo with a frontend framework signal; a DevAudit project to assert the no-hand-edit rule.

#### REQ-SKILL-E2E-003 — evidenceShot helper produces per-AC PNG + sidecar at the canonical path

- **Priority:** Must — the evidence-capture convention is the load-bearing proof an AC was verified; path + filename + sidecar are exactly assertable.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Evidence vs failure forensics); `references/evidence.ts`
- **Preconditions / inputs:** a Playwright `page`; the helper shipped into `e2e/helpers/evidence.ts` by the SDLC sync.
- **Given** a passing test that proves AC<n> **When** the spec calls `evidenceShot(page, 'REQ-XXX', n, '<kebab-slug>')` immediately after the AC-proving assertion **Then** a PNG lands at `compliance/evidence/REQ-XXX/screenshots/REQ-XXX-AC<n>-<slug>.png` plus a sidecar `<filename>.meta.json` carrying `{ origin, reqId, ac, slug, specFile, capturedAt }`; `origin` auto-detects `feature` vs `regression` from `process.env.E2E_NEW_SPECS`.
- **Error paths:** capitalised slug, underscores, or spaces throw (slug must be `[a-z0-9-]+`); the AC number is a separate argument, not embedded in the slug.
- **Fixtures/env:** a repo with `e2e/helpers/evidence.ts` synced; `E2E_NEW_SPECS` set and unset to exercise both origins.

#### REQ-SKILL-E2E-004 — Three-tier classification places specs at tier-specific paths

- **Priority:** Must — tier choice maps to gating point and is recorded in evidence; the file location is directly assertable.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 3 "Classify each spec into a tier")
- **Preconditions / inputs:** scenarios designed in Phase 3; MoSCoW priority of each.
- **Given** a designed scenario **When** the skill classifies its tier **Then** it lands the spec at `e2e/smoke/*.spec.ts` (cross-cutting "app is up" sanity, runs on every push to integration), `e2e/critical/*.spec.ts` (Must-priority headline flow, runs on a consumer-enabled PR-to-release-branch gate), or `e2e/<area>/*.spec.ts` (Should/Could/edge, runs by dispatch and any consumer-configured post-merge or schedule); when undecided between critical and regression, defaults to **regression**; the tier choice is recorded in `test-execution-summary.md` § Test design. The same tiers apply to every runner (#1060): for pytest, Jest and Vitest the skill places the test so the project's `test_tier_*` command selects it (`@pytest.mark.smoke` / `critical`, the `smoke/` and `critical/` paths or projects), tags it with its `REQ-XXX` in the form that runner's feature scope reads, and treats `critical` as optional; unit and component tests are not tiered.
- **Error paths:** putting a Should-priority spec in critical inflates every PR-to-main wait — defensible-tier check happens at the WAIT CHECKPOINT.
- **Fixtures/env:** an `e2e/` tree; a Must- and a Should-priority AC.

#### REQ-SKILL-E2E-005 — Screenshot density scales by spec role (feature vs regression tier)

- **Priority:** Should — observable as stage screenshots present on feature runs and auto-suppressed on regression runs.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Screenshot density per spec role); `references/evidence.ts` (`tier`, `shouldSuppressEvidenceShot`)
- **Preconditions / inputs:** a spec authoring multiple `evidenceShot` calls.
- **Given** a feature-branch spec **When** it calls `evidenceShot(…, { tier: 'feature' })` for intermediate stages plus a default-tier (`'always'`) canonical anchor **Then** all stage shots fire while the spec is a feature artefact and auto-suppress once it joins the regression pack (`E2E_NEW_SPECS` no longer matches), while the canonical anchor always fires.
- **Error paths:** reviewer says evidence feels thin on a HIGH-risk REQ → tier `'feature'` stages are missing; add them on the feature branch.
- **Fixtures/env:** a spec run with the file present and absent from `E2E_NEW_SPECS`.

#### REQ-SKILL-E2E-006 — Transport-layer specs use test-execution-summary.md, not evidenceShot

- **Priority:** Should — an explicit carve-out (devaudit#127); observable as a summary table row standing in for the screenshot.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Specs with no page object — transport-layer evidence)
- **Preconditions / inputs:** a spec exercising a webhook / socket / DB transport boundary with no `page`.
- **Given** a transport-layer spec under `e2e/` **When** it cannot call `evidenceShot` (no Playwright `page`) **Then** its evidence form is the per-spec row in `test-execution-summary.md` (spec → pass/fail → asserted behaviour in operator-facing terms), the test title uses the `[REQ-XXX][ACn]` bracket convention, and the screenshot check is N/A for it.
- **Error paths:** pairing with a thin UI shim buys back screenshot evidence; otherwise the transport spec stands alone and the portal screenshots panel correctly shows zero.
- **Fixtures/env:** a webhook-signature or socket-broadcast spec; a `test-execution-summary.md`.

#### REQ-SKILL-E2E-007 — Phase 4 never deletes a test without explicit confirmation

- **Priority:** Must — destructive-action pause; the conservative-deletion rule is a hard human gate.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 4 — Reconcile; § Principles "Confirm before destructive or public actions")
- **Preconditions / inputs:** existing tests in the touched area.
- **Given** a reconcile pass **When** the skill identifies obsolete tests **Then** it presents three lists (To add / To update / To delete, each delete with a one-line rationale) and **does not delete anything** until a clear "yes, delete those"; a failing test is not obsolete (signal, not garbage).
- **Error paths:** deleting on 95% confidence is disallowed — wait for the explicit yes.
- **Fixtures/env:** a suite with one genuinely-superseded spec and one merely-failing spec.

#### REQ-SKILL-E2E-008 — Phase 6 defect filing emits Framework attribution + applies the incident label

- **Priority:** Must — the defect→incident_report pipeline is an observable evidence path closing framework clauses on issue close.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Filing defects; § Framework classification + the incident label); `references/incident-classification.md`
- **Preconditions / inputs:** a Phase 6 application-defect or missed-AC failure; a tracker integration.
- **Given** a defect to file **When** the skill files it **Then** the issue body embeds a `### Framework attribution` section always ticking `ISO29119.3.5.4` (baseline) plus conditional clauses (`SOC2.CC7.2` ops, `GDPR.Art-33`/`Art-34` PII, EU AI Act `Art-9/14/15` AI), and it applies the `incident` label at filing time (creating it idempotently: `gh label list … | grep -qx incident || gh label create incident …`) after operator confirmation, so close-with-label → `incident-export.yml` → `compliance-evidence.yml` flips the clauses MISSING→COVERED.
- **Error paths:** never silently drop the artefact for "just a bug" — the baseline `ISO29119.3.5.4` row is mandatory; never pad with false GDPR/security ticks.
- **Fixtures/env:** a `gh`-backed repo without a pre-existing `incident` label; a non-PII bug and a PII-exposure defect to exercise the conditional ticks.

#### REQ-SKILL-E2E-009 — Phase 6 checks every AC has a passing test and files missed requirements

- **Priority:** Should — observable as a missed-requirement defect when an AC has no passing test.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 6 "Then check for missed requirements")
- **Preconditions / inputs:** numbered ACs from Phase 2; a completed run.
- **Given** a green/partly-green run **When** Phase 6 reconciles ACs **Then** for each numbered AC the skill confirms at least one _passing_ test covers it; an AC with no passing test (unwritten or failing) is filed as a missed requirement.
- **Error paths:** failures must be triaged into flake/test-bug/app-defect/seed-gap/visual-intended/visual-unintended buckets before any action; terminal statuses `failed|timedOut|interrupted` all count.
- **Fixtures/env:** a REQ with one AC deliberately uncovered.

#### REQ-SKILL-E2E-010 — Phase 7 regression-pack graduation is implicit on merge

- **Priority:** Could — a property of the pipeline rather than an action, but observable in origin tagging.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 7 — Regression-pack handoff)
- **Preconditions / inputs:** a green run, ACs proved, the new spec merged to develop.
- **Given** a new spec under `tests/e2e/` or `e2e/` **When** it is committed and merged to develop **Then** it is in the regression pack with no separate graduation step (no `regression/` dir, no `@regression` tag, no manifest); the feature-branch captures stay tagged `feature`, post-merge develop runs tag captures `regression` (empty `E2E_NEW_SPECS`).
- **Error paths:** none — the skill surfaces this in the final report, it takes no explicit action.
- **Fixtures/env:** a merged spec; a develop run with empty `E2E_NEW_SPECS`.

#### REQ-SKILL-E2E-011 — Phase 5½ evidence wiring validation: evidenceShot + @requirement + test title tags

- **Priority:** Should — prevents specs from passing Phase 6's "AC covered" check without producing portal evidence (DevAudit-Installer#170); the skill-side complement to CIYML-011 (CI-side gate).
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 5½ — Evidence wiring validation): for each in-scope REQ and its ACs from Phase 2's scenario table, checks (1) `@requirement REQ-XXX` annotations in spec files, (2) at least one `evidenceShot(page, 'REQ-XXX', <ac>, ...)` call per AC in UI specs (API-only specs exempt), (3) `[REQ-XXX]` tag in test titles or `test.info().annotations`. If any check fails, halts with a gap report and does not proceed to Phase 6 until resolved. Exemptions (e.g. API-only, transport-only) must be explicit decisions recorded in the test-execution-summary.
- **Preconditions / inputs:** Authored/modified spec files for in-scope REQs; Phase 2's scenario table with numbered ACs.
- **Given** a spec file covering REQ-X **When** Phase 5½ checks **Then** it must carry `@requirement REQ-X`, at least one `evidenceShot()` per AC (for UI specs), and `[REQ-X]` in test titles/annotations. **Given** all checks pass **Then** the skill writes a `.e2e-evidence-wired` sentinel file in the repo root (gitignored, local-only signal). **Given** any check fails **Then** the skill halts with a gap report and does not proceed to Phase 6. **Given** an AC is API-only (no visual surface) **When** the user confirms the exemption **Then** the exemption is recorded in the test-execution-summary and the sentinel notes the skipped AC.
- **Error paths:** Missing `evidenceShot()` for a UI AC → halt; missing `@requirement` annotation → halt; missing `[REQ-XXX]` tag → halt. All must be fixed before Phase 6. Missing `.e2e-evidence-wired` sentinel → pre-push hook blocks push of e2e spec files.
- **Fixtures/env:** A spec with all wiring correct (passes, sentinel written); a spec missing `evidenceShot()` for AC2 (halts); a spec missing `@requirement` (halts); an API-only spec with an explicit exemption (passes, sentinel notes skip).
- **Update (#1095):** Phase 5½ step 3 also runs `scripts/check-req-title-tags.sh --req REQ-XXX` (REQ-SKILL-E2E-012) and does not proceed to Phase 6 while it reports a `tagTest('REQ-XXX', n)` whose test title and enclosing describes lack the id: one tagging rule, both parts required (the id in the title or a describe so the feature run's `--grep` selects the test, and `tagTest()` in the body for the portal's join key).

#### REQ-SKILL-GOVERNANCE-001 — Trigger phrases / MISSING-clause prompts route to the right doc

- **Priority:** Should — discovery + Phase 0 routing across five doc classes.
- **Source:** `sdlc/files/_common/skills/governance-doc-author/SKILL.md` (frontmatter `description`; § Phase 0 — Route)
- **Preconditions / inputs:** a governance trigger phrase or a portal MISSING-clause prompt.
- **Given** a synced consumer **When** the operator says "create/refresh the RoPA", "write a DPIA", "update the AI disclosure", "set up the periodic security review schedule", "incident-report template", or asks how to close `GDPR.Art-30`/`GDPR.Art-35`/`EUAIA.Art-13`/`SOC2.CC4.1`/`ISO27001.A.12.1` shown MISSING **Then** Phase 0 routes to the matching doc (ROPA/DPIA/AI_DISCLOSURE/REVIEW_SCHEDULE/INCIDENT_TEMPLATE); "register a new risk" / "document a control gap" **delegates to `risk-register-keeper`**.
- **Error paths:** ambiguous trigger → ask; per-incident report request → remind that those come from `incident-export.yml`, not this skill.
- **Fixtures/env:** a consumer repo with the governance starters; a portal matrix showing MISSING clauses.

#### REQ-SKILL-GOVERNANCE-002 — Each doc class emits its artefact at the fixed path and closes its clause

- **Priority:** Should — the five doc→path→clause mappings are the skill's core observable contract.
- **Source:** `sdlc/files/_common/skills/governance-doc-author/SKILL.md` (§ doc table; § Phase 3 Author; § Phase 4 Verify attribution)
- **Preconditions / inputs:** the starter template present (Phase 1 confirms; else offer `devaudit bootstrap-governance`).
- **Given** a routed doc class **When** Phases 3–4 run **Then** the skill fills the starter at its path — `compliance/governance/ropa.md` (closes `GDPR.Art-30`), `compliance/governance/dpia.md` (or `dpia-<reqid>.md`, `GDPR.Art-35`), `compliance/governance/ai-disclosure.md` (`EUAIA.Art-13`), `SDLC/Periodic_Security_Review_Schedule.md` (`ISO27001.A.12.1`), `compliance/governance/incident-report.md` (`ISO29119.3.5.4` baseline) — replacing every `REPLACE —` marker, ticking the Framework checklist only when honestly true, and confirming the per-clause non-stub section before commit.
- **Error paths:** a required section still stub → **do not commit**; surface the gap and ask the operator for the missing input.
- **Fixtures/env:** each starter template synced; a populated codebase to derive RoPA/DPIA source data.

#### REQ-SKILL-GOVERNANCE-003 — Phase 5 commit + upload routes by tier; PAUSE for confirmation before push

- **Priority:** Should — the commit/upload split (manual portal form for Tier 1/2 vs CI auto for Tier 3) plus the confirm-before-push pause.
- **Source:** `sdlc/files/_common/skills/governance-doc-author/SKILL.md` (§ Phase 5 — Commit + verify; § Principles "Confirm before destructive or public actions")
- **Preconditions / inputs:** a non-stub authored doc; a working branch.
- **Given** an authored governance doc **When** Phase 5 runs **Then** the skill shows the diff and **confirms before committing**, commits as `compliance(governance): refresh <doc> for <reason>`, pushes, and drives the right upload: Tier 1/2 (RoPA/DPIA/AI Disclosure/Review Schedule) → operator uses the portal Upload form with the exact evidence type (`ropa`/`dpia`/`ai_disclosure`/`compliance_document`); Tier 3 (Incident template, periodic-review, incident-report-<n>) → CI `compliance-evidence.yml` auto-uploads on push.
- **Error paths:** none beyond the stub-block in REQ-SKILL-GOVERNANCE-002.
- **Fixtures/env:** a portal Upload form; a `compliance-evidence.yml`.

#### REQ-SKILL-GOVERNANCE-004 — One doc per invocation; Review Schedule ≠ quarterly execution

- **Priority:** Could — guardrail behaviours; observable as a refusal to batch and a clarifying question.
- **Source:** `sdlc/files/_common/skills/governance-doc-author/SKILL.md` (§ Phase 6; § Principles "One doc per invocation")
- **Preconditions / inputs:** a request that batches docs or conflates the schedule with its execution.
- **Given** a request to refresh multiple docs at once **When** the skill runs **Then** it handles one doc per invocation; and when asked for "the periodic review" it clarifies whether the operator means `Periodic_Security_Review_Schedule.md` (the plan — in scope) or `periodic-review.md` (the quarterly execution — out of scope, auto-generated by `periodic-review.yml`).
- **Error paths:** none — clarification is the specified behaviour.
- **Fixtures/env:** a request mixing RoPA + DPIA + AI disclosure.

#### REQ-SKILL-REQALIGN-001 — Triggers + non-spontaneous firing; Stage 1 / Stage 3 hooks

- **Priority:** Should — discovery and the no-spontaneous-fire contract with `sdlc-implementer`.
- **Source:** `sdlc/files/_common/skills/requirements-aligner/SKILL.md` (frontmatter `description`; § Phase 0 — Route)
- **Preconditions / inputs:** a REQ; `docs/SRS.md` present; the parent skill or operator invoking.
- **Given** a synced consumer **When** the operator says "align SRS for REQ-XXX", "what SRS items did this REQ need?", "is the SRS in sync with this branch?", or "audit SRS drift across this branch" — OR `sdlc-implementer` delegates at Stage 1 (plan APPROVAL) or Stage 3 (evidence) **Then** the skill routes to Phase 1 (Stage-1), Phase 2 (Stage-3), Phase 3 (per-REQ ad-hoc), or Phase 4 (branch-wide); it **does not fire spontaneously**.
- **Error paths:** asked to author SRS prose from scratch → out of scope (proposes IDs+stubs only).
- **Fixtures/env:** a `docs/SRS.md` with existing `REQ-AREA-NNN` items.

#### REQ-SKILL-REQALIGN-002 — Phase 1 injects the SRS-items table into the plan and (conditionally) blocks approval

- **Priority:** Should — the plan-injection table + the asymmetric Stage-1 block are the observable Stage-1 contract.
- **Source:** `sdlc/files/_common/skills/requirements-aligner/SKILL.md` (§ Phase 1 steps 1–6; § Configuration)
- **Preconditions / inputs:** the REQ's implementation plan AC table + working-tree diff.
- **Given** a plan at Stage 1 **When** Phase 1 runs **Then** the skill fuzzy-matches each AC against `docs/SRS.md`, allocates next-free `REQ-AREA-NNN` per area for unmatched ACs, and injects a `## SRS items proposed/touched` table (AC | SRS item | Status | Notes); approval blocks until each AC has an existing item / a new stub / an `@srs-deferred: <reason>` annotation — blocking governed by `sdlc-config.json:requirements_aligner.block_on_stage_1` (default `false`, ramp-up audit-only for first 5 runs).
- **Error paths:** low-confidence match → surface the candidate and ask (false-positive matches hide the gap).
- **Fixtures/env:** a plan with one AC matching SRS and one with no match; `sdlc-config.json` toggling `block_on_stage_1`.

#### REQ-SKILL-REQALIGN-003 — Phase 2 drops srs-alignment.md with frontmatter, trace table, and operator sign-off

- **Priority:** Should — the per-REQ Tier-3 artefact is the hard Stage-3 gate; its frontmatter + sections are exactly assertable.
- **Source:** `sdlc/files/_common/skills/requirements-aligner/SKILL.md` (§ Phase 2 steps 1–3; § Principles "Block at Stage 3")
- **Preconditions / inputs:** the post-approval plan + diff.
- **Given** Stage 3 reached **When** Phase 2 runs **Then** the skill writes `compliance/evidence/REQ-XXX/srs-alignment.md` with frontmatter (`req`, `generated_by: requirements-aligner`, `generated_at`), an `## ACs traced` table, and an `## Operator sign-off` block (three checkboxes + Reviewer + Date); CI uploads it as `evidence_type=srs_alignment`; control then returns synchronously to `sdlc-implementer` (no pause).
- **Error paths:** the Stage-3 artefact is the asymmetric hard gate (`block_on_stage_3: true` default) — missing it leaks; `@srs-deferred` is allowed only in the Stage-1 plan, not here.
- **Fixtures/env:** an approved plan; a writable `compliance/evidence/REQ-XXX/`.

#### REQ-SKILL-ADR-001 — Triggers + Stage 1 / Stage 3 hooks; non-spontaneous firing

- **Priority:** Should — discovery and the delegation contract.
- **Source:** `sdlc/files/_common/skills/adr-author/SKILL.md` (frontmatter `description`; § Phase 0 — Route)
- **Preconditions / inputs:** a REQ; `docs/ADR/`; the parent skill or operator invoking.
- **Given** a synced consumer **When** the operator says "draft an ADR for REQ-XXX", "does this REQ need an ADR?", or "is the architectural decision documented?" — OR `sdlc-implementer` delegates at Stage 1 or Stage 3 **Then** the skill routes to Phase 1 (Stage-1), Phase 2 (Stage-3), or Phase 3 (ad-hoc audit); it does not fire spontaneously.
- **Error paths:** asked to author full ADR prose end-to-end → out of scope (drafts a stub only).
- **Fixtures/env:** a `docs/ADR/` with existing ADR-NNN files (or absent, to assert ADR-001 bootstrap).

#### REQ-SKILL-ADR-002 — Phase 1 applies the decision tree and drops docs/ADR/ADR-NNN-<slug>.md or a no-ADR rationale

- **Priority:** Should — the ADR-worthiness verdict + the SoT ADR file (or negative annotation) are the Stage-1 observable output.
- **Source:** `sdlc/files/_common/skills/adr-author/SKILL.md` (§ Phase 1 steps 2–8)
- **Preconditions / inputs:** the REQ's plan + diff; the file list it touches.
- **Given** a plan at Stage 1 **When** Phase 1 runs **Then** the skill applies the decision tree (new dependency / new external service / new DB-cache-queue / pattern change >3 files / schema change / HIGH-CRITICAL risk / `file_paths_signal_architecture` match ⇒ ADR; bug-fix≤3-files / single-file refactor / styling / dep-bump / docs ⇒ no ADR), and on an ADR verdict allocates next `ADR-NNN` (bootstraps `docs/ADR/` + ADR-001 if absent), drafts `docs/ADR/ADR-NNN-<slug>.md` with frontmatter (`adr_id`, `status: "Proposed"`, `date`, `related_reqs`, `supersedes`, `superseded_by`) and Status/Context/Decision/Consequences/Alternatives considered/Cross-references sections, and injects an ADR-NNN reference into the plan's `## Architecture decisions`; on a no-ADR verdict it injects "No ADR needed — <rationale>".
- **Error paths:** ambiguous verdict → surface candidate + ask, never silently default; the section must always carry one annotation or the other (empty = silent-drift failure).
- **Fixtures/env:** a REQ adding a new dependency (ADR), a typo-fix REQ (no ADR), and an empty `docs/ADR/`.

#### REQ-SKILL-ADR-003 — Phase 2 drops architecture-decision.md with outcome + operator sign-off

- **Priority:** Should — the per-REQ Tier-3 artefact; frontmatter + Outcome + sign-off are assertable.
- **Source:** `sdlc/files/_common/skills/adr-author/SKILL.md` (§ Phase 2 steps 1–3)
- **Preconditions / inputs:** the post-approval plan + diff.
- **Given** Stage 3 reached **When** Phase 2 runs **Then** the skill writes `compliance/evidence/REQ-XXX/architecture-decision.md` with frontmatter (`req`, `generated_by: adr-author`, `generated_at`), an `## Outcome` of either "Produced ADR-NNN: <title> (`docs/ADR/ADR-NNN-<slug>.md`)" or "No ADR needed — <rationale>", a `## Detail` block, and an `## Operator sign-off` (three checkboxes + Reviewer + Date); CI uploads it as `evidence_type=architecture_decision`; control returns synchronously to the orchestrator.
- **Error paths:** `block_on_stage_3: true` default — the artefact must exist before Stage 3 completes.
- **Fixtures/env:** an approved plan with a known ADR verdict.

#### REQ-SKILL-RISK-001 — Triggers + Stage 1 (MEDIUM/HIGH) / incident-close / Stage 3 / solo_with_gap hooks

- **Priority:** Should — discovery and the four invocation entry points.
- **Source:** `sdlc/files/_common/skills/risk-register-keeper/SKILL.md` (frontmatter `description`; § Phase 0 — Route)
- **Preconditions / inputs:** a REQ or a closed incident; `compliance/risk-register.md` (or its starter); risk class.
- **Given** a synced consumer **When** the operator says "draft a risk-register entry for REQ-XXX" / "is the risk register up to date for this branch?" — OR `sdlc-implementer` delegates at Stage 1 for MEDIUM/HIGH or Stage 3 — OR `incident-export.yml` fires at incident close — OR approval mode is `solo_with_gap` **Then** the skill routes to Phase 1, Phase 2 (post-incident), Phase 3 (Stage-3), Phase 4 (`solo_with_gap` check), or Phase 5 (ad-hoc); it does not fire spontaneously.
- **Error paths:** asked for canonical risk-treatment prose or full STRIDE/LINDDUN → out of scope (drafts stubs only).
- **Fixtures/env:** a `compliance/risk-register.md` (present and absent, to assert bootstrap from `risk-register.md.template`).

#### REQ-SKILL-RISK-002 — Phase 1 opens RISK-NNN rows and injects the reference list into the plan

- **Priority:** Should — the canonical register row + the plan's "Risk register entries" sub-section are the Stage-1 observable output.
- **Source:** `sdlc/files/_common/skills/risk-register-keeper/SKILL.md` (§ Phase 1 steps 1–5; § Configuration `stage_1_min_risk_class`)
- **Preconditions / inputs:** risk class MEDIUM or HIGH (LOW skipped); the plan §4 + diff.
- **Given** a MEDIUM/HIGH plan at Stage 1 **When** Phase 1 runs **Then** the skill identifies discrete risks, allocates next-free `RISK-NNN` (bootstraps the register from `risk-register.md.template` if absent), drafts canonical rows (Status / Opened / Owner / Description / Inherent L×I / Mitigations / Residual L×I / Framework cross-refs / Review due / Cross-links) in `compliance/risk-register.md`, and replaces the plan's Risks/Considerations bullets with a `### Risk register entries` RISK-NNN reference list; `@risk-deferred: <reason>` allowed for LOW×LOW surfaces; blocks approval per `block_on_stage_1` (default `false`).
- **Error paths:** LOW REQs skip the Stage-1 hook entirely (`stage_1_min_risk_class: 'MEDIUM'`).
- **Fixtures/env:** a HIGH REQ; an absent register to assert bootstrap.

#### REQ-SKILL-RISK-003 — Phase 3 drops risk-assessment.md with summary table + framework cross-refs + sign-off

- **Priority:** Should — the per-REQ Tier-3 artefact; the hard Stage-3 gate.
- **Source:** `sdlc/files/_common/skills/risk-register-keeper/SKILL.md` (§ Phase 3 steps 1–3)
- **Preconditions / inputs:** the post-approval plan + diff; RISK-NNN entries opened in Phase 1.
- **Given** Stage 3 reached **When** Phase 3 runs **Then** the skill writes `compliance/evidence/REQ-XXX/risk-assessment.md` with frontmatter (`req`, `generated_by: risk-register-keeper`, `generated_at`), a `## Summary` table (RISK-NNN | Title | Status this cycle | Residual L×I), `## Framework cross-references`, and an `## Operator sign-off` (three checkboxes + Reviewer + Date); CI uploads it as `evidence_type=risk_assessment`; control returns synchronously to the orchestrator.
- **Error paths:** `block_on_stage_3: true` default — the artefact is the hard gate.
- **Fixtures/env:** an approved MEDIUM/HIGH REQ with ≥1 open RISK-NNN.

#### REQ-SKILL-RISK-004 — Phase 2 post-incident entry cross-links incident report ↔ register both directions

- **Priority:** Could — incident-driven branch; observable as a new register row plus a `risk_register_entry:` frontmatter line on the incident file.
- **Source:** `sdlc/files/_common/skills/risk-register-keeper/SKILL.md` (§ Phase 2 steps 1–3)
- **Preconditions / inputs:** a closed `incident`-labelled report exported to `compliance/governance/incident-report-N.md`.
- **Given** an exported incident report **When** Phase 2 runs **Then** the skill drafts a residual-risk entry with status MITIGATED / OPEN / ACCEPTED per outcome, the register entry references `incident-report-N.md`, and the incident report's frontmatter gains a `risk_register_entry: RISK-NNN` line (bidirectional audit trail).
- **Error paths:** none specified beyond status-semantics correctness.
- **Fixtures/env:** a closed incident exported by `incident-export.yml`.

#### REQ-SKILL-RISK-005 — Phase 4 solo_with_gap PAUSE: refuse approval until the control-gap entry is signed off

- **Priority:** Could — a conditional human gate tied to approval mode; observable as a refused approval.
- **Source:** `sdlc/files/_common/skills/risk-register-keeper/SKILL.md` (§ Phase 4 steps 1–4; § Principles "solo_with_gap is a deliberate trade-off")
- **Preconditions / inputs:** `sdlc-config.json:approval.mode = 'solo_with_gap'`; a release about to be approved.
- **Given** a `solo_with_gap` project **When** a release is about to be approved **Then** the skill greps the register for a control-gap entry (Framework cross-ref `SOC2.CC8.1`, description referencing solo/self-approval); if absent it drafts one (Status ACCEPTED, compensating-controls list) and **refuses approval until the operator signs it off**.
- **Error paths:** mode ≠ `solo_with_gap` → exit, no check needed.
- **Fixtures/env:** a `sdlc-config.json` with `approval.mode: 'solo_with_gap'` and a register lacking the gap entry.

#### REQ-SKILL-CONFIGURE-001 — `devaudit-configure`: guided, validated repo configuration (#1040)

- **Priority:** Should — the operator-facing half of `devaudit configure`.
- **Source:** `sdlc/files/_common/skills/devaudit-configure/SKILL.md`.
- **Given** a trigger ("configure devaudit", "we deploy on Vercel, not Railway", "doctor says the host is wrong", "our prod is behind Vercel protection", "we deploy to AWS", "change the CI runner") **Then** the skill runs `devaudit doctor --json` and `devaudit configure list --json`, explains the deploy/CI findings and what was not checked, asks what to change (and why, for a contradicted value), shows `configure set … --dry-run`, applies only after confirmation, asks the operator to run `devaudit configure secret <NAME>` for each secret, runs `devaudit update` and `devaudit doctor`, and opens a `fix/<issue#>-<slug>` PR to the integration branch.
- **Never:** edits `sdlc-config.json` or generated workflows directly, works around a refused key, asks for or handles a secret value, changes portal state or hosting-provider settings.
- **Fixtures/env:** skill frontmatter validated by `scripts/validate-adapter.cjs`; behaviour by review.

#### Assumptions — Skills

- **Frontmatter validation belongs to the schema, not a per-skill requirement.** `_schema/skill.schema.json` validates `name` (kebab, 2–64) and `description` (≥50 chars) for every SKILL.md. Treated as a single cross-cutting fixture rather than one requirement per skill; an E2E suite can assert each skill's frontmatter validates against the schema as a setup check.
- **`requirements-aligner` / `adr-author` / `risk-register-keeper` evidence-type clause closures are stated as "per META-COMPLY `framework-registry-auditor` review" and may ship orphan-by-design in v1.** Requirements assert the `evidence_type` tag and upload path (observable from the consumer side) but NOT a specific clause closure, since the specs explicitly defer that mapping to the portal side.
- **Exact section order within `compliance/risk-register.md` rows and the governance starters is template-defined, not SKILL.md-defined.** The skills fill `REPLACE` markers in starters shipped via `devaudit bootstrap-governance`; requirements assert the named sections/fields the SKILL.md enumerates, not a byte-exact template layout (the template files were not all read in full here).
- **`sdlc-implementer` references several CI workflow files (`check-release-approval.yml`, `post-deploy-prod.yml`, `compliance-evidence.yml`, `incident-export.yml`) and the `devaudit` CLI as external collaborators.** These are environment fixtures the E2E tests must stub/provide; their internal behaviour is out of scope for the SKILL black-box contract.
- **No contradictions found** between the six specs. The sub-skill return semantics ("Returns to the running sdlc-implementer context" = keep going, do not pause) is consistently echoed in all three SoT-skill Phase-2/3 steps and in the orchestrator's § Sub-skill return semantics.

### CI Workflow Templates (.github/workflows/\*)

These requirements specify the **black-box, observable contract** of the CI workflow `.yml.template` files shipped under `sdlc/files/ci/` of the DevAudit-Installer. They are not run as-is. On `devaudit install` / `devaudit update`, `cli/src/update/ci-templates.ts:syncCiTemplates()` reads the consumer's `sdlc-config.json`, resolves a token map + block map, picks the stack-specific template if `sdlc/files/ci/<stack>/<name>` exists (else the default `sdlc/files/ci/<name>`), substitutes tokens (`cli/src/lib/templates.ts:substituteTokens`), substitutes multi-line blocks (`substituteBlocks`), optionally strips the `services:` block when no DB is configured (`stripServicesBlock`), and writes the rendered file to `<consumer>/.github/workflows/<name>.yml`. Two units of observability therefore exist for every requirement: (1) **rendered file content** — what text appears/disappears in the consumer's workflow file after substitution; and (2) **runtime behaviour** — what the rendered workflow does when GitHub Actions runs it in the consumer repo (gates pass/fail, evidence POSTed to the DevAudit portal, release status advanced, PRs blocked/opened). Currently the only detected host is `railway` and stack is `node` or `python` (`cli/src/install/detect-stack.ts`); the substitution engine, however, is host/stack-agnostic and driven entirely by `sdlc-config.json` keys.

**Recurring pattern — runtime `CI_RUNNER_LABEL`-gated config-resolution helpers.** Several template tokens can't be decided at sync time, because a consumer configured with `runner: "self-hosted"` only learns which runner a given workflow run actually lands on at *runtime* (`inputs.runner_label || vars.CI_RUNNER_LABEL || 'github-ci'` — a one-run override, or an unset variable, can still put it on an ephemeral GitHub-hosted box). `cli/src/update/ci-templates.ts` therefore has a family of small `resolveX(cfg): string` helpers with one shared shape: **when `cfg.runner !== 'self-hosted'`, return a literal** (the static-runner behaviour, byte-for-byte what the template did before the helper existed); **when `cfg.runner === 'self-hosted'`, return a GitHub Actions `${{ … }}` expression** over that same three-way label fallback, so the decision is made per run. Members today: `resolveRunner` (`{{RUNNER}}`), `resolveCheckoutClean` (`{{CHECKOUT_CLEAN}}`, REQ-FRAMEWORK-CIYML-015), `resolvePlaywrightWithDeps` (`{{PLAYWRIGHT_WITH_DEPS_FLAG}}`, REQ-FRAMEWORK-CIYML-019), `resolveStaleNextCleanupCondition` (`{{STALE_NEXT_CLEANUP_IF}}`, REQ-FRAMEWORK-CIYML-020), and `resolveNpmAuditMaxAttempts` (`{{NPM_AUDIT_MAX_ATTEMPTS}}`, REQ-FRAMEWORK-CIYML-021). A new self-hosted-vs-ephemeral behaviour difference should be added as another member of this family (and documented here) rather than as a sync-time boolean, which would be wrong whenever the label falls back to `github-ci`. Separately, some templates are **whole-file conditional** rather than token-conditional: `e2e-regression.yml` (on `e2e_regression_enabled`, REQ-FRAMEWORK-E2EREGRESSION-001) and `reconcile-deployment.yml` (on `host: railway`, REQ-FRAMEWORK-CIYML-022) — each with a remove-on-disable sweep.

Area codes: FRAMEWORK-CIYML (ci.yml quality gates + evidence job), FRAMEWORK-EVIDENCE (compliance-evidence.yml), FRAMEWORK-VALIDATION (compliance-validation.yml + secondary governance workflows), FRAMEWORK-APPROVAL (check-release-approval.yml merge gate), FRAMEWORK-POSTDEPLOY (post-deploy-prod.yml), FRAMEWORK-RENDER (token/block substitution semantics).

---

#### REQ-SKILL-E2E-012 — `check-req-title-tags.sh`: a tagged test must carry the requirement id in its title (#1095)

- **Priority:** Should — a test tagged only by `tagTest()` annotation is invisible to the feature run's `--grep` and reads as untested.
- **Source:** `sdlc/files/_common/scripts/check-req-title-tags.sh` (synced to `scripts/`), `check-req-title-tags.test.sh` (run in Template Lint), called from `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` Phase 5½.
- **Preconditions / inputs:** `check-req-title-tags.sh [--req REQ-XXX] [dir...]`; dirs default to `e2e` and `tests/e2e`; `*.spec.ts` / `*.spec.tsx`, `node_modules` skipped.
- **Given** a spec with `tagTest('REQ-x', n)` whose test title and every enclosing `test.describe` title lack `REQ-x` **Then** the script prints `file:line: tagTest('REQ-x', n) but neither the test title nor a describe contains REQ-x` and exits `1`; adding `[REQ-x][ACn]` to the title makes it pass. **Given** `REQ-11` in a title and `tagTest('REQ-111', …)` (or the reverse) **Then** it is reported (exact id). A describe that has closed does not cover a later test; braces in strings and comments are ignored; a title on the line after `test(` is read. `--req` limits the check to one requirement; no e2e directory exits `0`; a bad flag or `--req` value exits `2`.
- **Error paths:** dynamically built titles are not supported (reported as offenders; documented).
- **Fixtures/env:** `check-req-title-tags.test.sh` (21 assertions over temp projects).

---

#### REQ-FRAMEWORK-CIYML-001 — ci.yml triggers on develop PRs and develop code pushes

- **Priority:** Must — the main pipeline's scope (which commits run the heavy gates) is the foundational contract.
- **Source:** `sdlc/files/ci/ci.yml.template` (`on: pull_request: branches: [develop]`, `push: branches: [develop]`, `paths-ignore: {{PATHS_IGNORE}} - 'sdlc-config.json'`, `workflow_dispatch`)
- **Preconditions / inputs:** Consumer repo with rendered `ci.yml`; `paths_ignore` array in `sdlc-config.json`.
- **Given** the rendered `ci.yml` **When** a PR targets `develop` **Then** the `CI Pipeline` workflow runs and reports the `Quality Gates` check on the PR. **When** the PR head branch starts with `chore/close-out-` **Then** the heavy `quality-gates` job is skipped because the branch is administrative release reconciliation rather than feature/release implementation. **When** a commit is pushed to `develop` touching only paths in `paths-ignore` (rendered from `{{PATHS_IGNORE}}`) plus `sdlc-config.json` **Then** the push-side `CI Pipeline` workflow does NOT run; **When** a pushed commit touches any non-ignored path **Then** it runs. The workflow is also dispatchable manually (`workflow_dispatch`) and uses a `concurrency` group `${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`. Release registration and evidence upload jobs are skipped on `pull_request` events.
- **Error paths:** A push to a branch other than `develop` produces no run (PRs to main inherit status via branch protection per the header comment).
- **Fixtures/env:** Rendered consumer repo on `develop`; a docs-only commit fixture and a code commit fixture.

#### REQ-FRAMEWORK-CIYML-002 — Single quality-gates job enforces TypeScript, SAST, dep-audit, E2E, build (node)

- **Priority:** Must — these are the mandatory merge gates the whole framework exists to enforce.
- **Source:** `sdlc/files/ci/ci.yml.template` job `quality-gates` steps: `TypeScript Check` (id `typescript`, `npx tsc --noEmit`), `SAST Scan` (id `sast`), `Dependency Audit` (id `dep-audit`), `E2E Tests` (rendered from `{{E2E_TEST_STEP}}`), `Build Check` (id `build`, `npm run build`).
- **Preconditions / inputs:** node stack; rendered `ci.yml`; `{{RUNNER}}`, `{{NODE_VERSION}}`, `{{SOURCE_DIRS}}`, and `{{SAST_BASELINE}}` substituted; optional repository-owned `compliance/security/accepted-vulnerabilities.json`.
- **Given** the rendered `ci.yml` runs **When** `npx tsc --noEmit` reports any error **Then** the `typescript` step (and the job) fails. **When** the SAST findings count `> {{SAST_BASELINE}}` **Then** the `sast` step emits `::error::New SAST findings` and exits 1. **When** any high/critical npm advisory lacks an exact, unexpired advisory-and-lockfile-path risk acceptance **Then** the `dep-audit` step exits 1. **When** Playwright tests fail or `npm run build` fails **Then** the respective step fails. All five must pass for `quality-gates` to be green.
- **Error paths:** Each gate exits 1 on violation. Unparseable npm-audit JSON, missing/cyclic npm vulnerability references, a high/critical chain without a reachable concrete advisory, malformed/expired exception JSON, unresolved installed versions, and broad package-only exceptions fail closed.
- **Fixtures/env:** Rendered node consumer with a tsc error / a seeded high-sev dependency / a failing spec to exercise each gate.

#### REQ-FRAMEWORK-CIYML-003 — SAST baseline and advisory-scoped dependency-risk decisions

- **Priority:** Must — exceptions are security decisions and must be narrower than a package-name allowlist.
- **Source:** `sdlc/files/ci/ci.yml.template` `SAST Scan`; `sdlc/files/_common/scripts/evaluate-npm-audit.sh`; `compliance/security/accepted-vulnerabilities.json` in a consumer when an exception is approved.
- **Preconditions / inputs:** `sast_baseline` (default `0`), npm audit JSON, package-lock JSON, and an optional schema-versioned exception document.
- **Given** a rendered `ci.yml` with `{{SAST_BASELINE}}=N` **When** semgrep returns exactly `N` findings **Then** the SAST gate passes; at `N+1` it fails. **Given** npm reports a high/critical meta-vulnerability through string `via` references **When** the graph reaches a concrete advisory object **Then** the evaluator records the affected meta findings and evaluates the concrete advisory at each exact installed leaf path once. **Given** a high/critical npm advisory **When** its advisory ID, package, vulnerable range, installed version, dependency path, and introducing dependency exactly match one non-expired record with approver, dates, reason, and GitHub remediation issue **Then** the dependency gate records it as accepted. **When** every finding is accepted or no high/critical finding exists **Then** the gate passes and writes `dependency-risk-evaluation.json`.
- **Error paths:** Missing exception file means no accepted risks. Missing graph references, graph cycles, high/critical chains without a reachable concrete advisory, unmatched, expired, malformed, duplicate, package-only, range/version/path/introducer mismatch, or an invalid remediation URL fails closed. Multiple findings and shared advisory leaves are evaluated independently and deduplicated by advisory/path.
- **Fixtures/env:** No finding, unaccepted finding, valid exact match, advisory/range/version/path/introducer mismatches, expiry, malformed documents, invalid remediation URL, multiple-advisory fixtures, one-level and multi-level meta chains, shared leaves, missing references, and cycles.

#### REQ-FRAMEWORK-CIYML-004 — E2E origin tagging via E2E_NEW_SPECS diff against merge base

- **Priority:** Should — observable in the workflow env and downstream screenshot metadata, but not a pass/fail gate itself.
- **Source:** `sdlc/files/ci/ci.yml.template` steps `Compute new-spec list for E2E origin tagging` (writes `E2E_NEW_SPECS` to `$GITHUB_ENV` via `git diff --diff-filter=A` of `tests/e2e/**` / `e2e/**` spec files against `git merge-base`), `fetch-depth: 0` on checkout.
- **Preconditions / inputs:** Full git history (`fetch-depth: 0`); consumer's `evidenceShot` helper reads `E2E_NEW_SPECS`.
- **Given** the rendered `ci.yml` runs **When** new `*.spec.ts(x)` files exist relative to the merge base **Then** `E2E_NEW_SPECS` lists them and captures from those specs are tagged `origin=feature`; **When** none (post-merge on develop/main) **Then** the list is empty and every capture tags `origin=regression`.
- **Error paths:** A `git merge-base` failure falls back to `git rev-parse HEAD` (empty diff).
- **Fixtures/env:** Rendered repo with a new spec added on a branch vs a clean merge-base.

#### REQ-FRAMEWORK-CIYML-005 — Gate outcomes summarised unconditionally to gate-outcomes.json

- **Priority:** Must — the portal's "ran-and-failed vs never-ran" distinction (DevAudit-Installer#96) depends on this artefact.
- **Source:** `sdlc/files/ci/ci.yml.template` step `Summarise gate outcomes` (`if: always()`) writes `gate-outcomes.json` with `${{ steps.<id>.outcome }}` for `typescript`/`sast`/`dependency_audit`/`build`; `upload-artifact@v4` (`if: always()`) bundles it (+ sast/dep/e2e JSON, playwright-report, coverage, per-AC screenshots) as `ci-results`, retention 90 days. The upload step attaches `gate-outcomes.json` only to the commit-derived release/run. Pending tickets are not ownership and must not trigger `gate_outcome` fan-out to unrelated REQs; bundled approval uses explicit bundle lineage instead of duplicate upload rows.
- **Preconditions / inputs:** node stack rendered `ci.yml`.
- **Given** any gate failed earlier **When** the job reaches `Summarise gate outcomes` **Then** the step still runs (`always()`) and records each step's `outcome` (`success`/`failure`/`skipped`); the `ci-results` artifact is uploaded regardless of job result. **Given** multiple pending REQ tickets exist **When** a generic develop Quality Gates run uploads evidence **Then** `gate_outcome` remains on the commit-derived release only; the workflow may attach E2E JSON to another REQ only when that JSON contains an executed test tagged for that REQ.
- **Error paths:** `upload-artifact` is `continue-on-error: true` so an upload hiccup does not fail the job.
- **Fixtures/env:** Rendered repo where an early gate fails; assert `gate-outcomes.json` still produced. Rendered repo with multiple pending tickets; assert no `gate-outcomes.json -> REQ_ID` fan-out path exists.

#### REQ-FRAMEWORK-CIYML-006 — register-release job creates the UAT release record early

- **Priority:** Must — the approval gate (APPROVAL-002) can only resolve a release that this job registers.
- **Source:** `sdlc/files/ci/ci.yml.template` job `register-release` (`if: vars.DEVAUDIT_BASE_URL != ''`): derives version via `scripts/derive-release-version.sh`, then `bash scripts/upload-evidence.sh {{PROJECT_SLUG}} _compliance-docs compliance_document README.md --release <version> --create-release-if-missing --environment uat --category planning`; outputs `version`.
- **Preconditions / inputs:** Repo Variable `DEVAUDIT_BASE_URL` set; secret `DEVAUDIT_API_KEY` set; `scripts/derive-release-version.sh` + `scripts/upload-evidence.sh` present.
- **Given** the rendered `ci.yml` runs on develop **When** `DEVAUDIT_BASE_URL` variable is non-empty **Then** `register-release` derives a release version (REQ-XXX tag on latest commit, else bare-date), ensures the release exists in the portal (UAT, `--create-release-if-missing`), and exposes it as job output `version`. **When** the variable is empty **Then** the whole job is skipped.
- **Error paths:** `Validate DevAudit env` exits 1 if either `DEVAUDIT_BASE_URL` or `DEVAUDIT_API_KEY` is empty; the `Ensure release exists` upload is `|| true` (best-effort).
- **Fixtures/env:** Portal stub accepting the ensure-release upload; `DEVAUDIT_BASE_URL` variable + `DEVAUDIT_API_KEY` secret.

#### REQ-FRAMEWORK-CIYML-007 — register-release syncs known requirements (title + risk class) from RTM.md

- **Priority:** Should — enriches portal rendering; portal tolerates nulls so absence is non-fatal.
- **Source:** `sdlc/files/ci/ci.yml.template` step `Sync known requirements from RTM`: for each `REQ-[0-9]+` row in `compliance/RTM.md` derives `title` (release-ticket H1, else linked issue title via `gh issue view`) and `riskClass` (first LOW/MEDIUM/HIGH/CRITICAL token), `PATCH ${BASE}/api/ci/projects/{{PROJECT_SLUG}}/known-requirements` with `{requirements:[…]}`.
- **Preconditions / inputs:** `compliance/RTM.md` present with REQ rows; `GH_TOKEN: github.token`; valid API key.
- **Given** an RTM with REQ rows **When** `register-release` runs **Then** a PATCH to `/known-requirements` carries each REQ's id/title/riskClass (nulls allowed); **When** RTM has no REQ rows or is absent **Then** the step exits 0 without a PATCH.
- **Error paths:** Missing `RTM.md` → early `exit 0`; HTTP code is logged but not gated.
- **Fixtures/env:** RTM fixture + portal stub recording the PATCH body.

#### REQ-FRAMEWORK-CIYML-008 — upload-evidence job uploads gate evidence to the portal even on gate failure (stage 2)

- **Priority:** Must — tamper-resistant CI evidence is the core deliverable; failed gates must still leave an audit trail (DevAudit-Installer#96, #132).
- **Source:** `sdlc/files/ci/ci.yml.template` job `upload-evidence` (`needs: [quality-gates, register-release]`, `if: always() && !cancelled() && vars.DEVAUDIT_BASE_URL != '' && needs.register-release.result == 'success'`): maps `gate-outcomes.json` to `gateStatus` (`success→passed`, `failure→failed`, else `skipped`) and uploads via `scripts/upload-evidence.sh` — `sast-results.json` as `sast_report`/`security_scan`, `dependency-audit.json` as `dependency_audit`/`security_scan`, `e2e-results.json` as `e2e_result`/`ci_pipeline`, `playwright-report.zip` as `test_report`, coverage as `test_report`, all with `--environment uat` + `--release <register-release.version>` + `--sdlc-stage 2` (implement & test stage). The `--sdlc-stage 2` flag is set once on the shared `FLAGS` variable and reused by every upload in the job.
- **Preconditions / inputs:** `register-release` succeeded; `DEVAUDIT_BASE_URL` variable + `DEVAUDIT_API_KEY` secret set; `ci-results` artifact (or regenerated fallback).
- **Given** quality-gates ran (pass or fail) **When** `upload-evidence` runs **Then** each gate artefact is POSTed to the portal carrying `--gate-status` derived from `gate-outcomes.json` and `sdlcStage=2`, so a failed gate uploads `gateStatus=failed` (not "missing"). **When** any `upload()` call fails **Then** `UPLOAD_FAILURES` increments and the step exits 1 at the end (a release missing gate evidence cannot pass UAT, DevAudit #132).
- **Error paths:** Artifact download is `continue-on-error: true` and the step regenerates SAST/dep JSON if missing; the job is skipped entirely if `register-release` did not succeed or the base-URL variable is empty.
- **Fixtures/env:** Portal stub asserting evidence_type + gateStatus + sdlcStage per upload; a failing-gate fixture to assert non-missing upload.

#### REQ-FRAMEWORK-CIYML-009 — Per-AC E2E screenshots uploaded scoped to in-scope REQs only (stage 2)

- **Priority:** Should — per-requirement evidence rendering; scoping bug (#147) makes mis-scoping observably fail (red step).
- **Source:** `sdlc/files/ci/ci.yml.template` `upload-evidence` screenshot loop: `SHOT_REQS` derived from `compliance/pending-releases/RELEASE-TICKET-REQ-*.md`; per REQ globs only `ci-evidence/compliance/evidence/<REQ>/screenshots/*.png`, uploads each as `screenshot`/`test_report` with `--release <REQ>`, `--meta-key origin=<feature|regression>` (from the `<png>.meta.json` sidecar), and `--sdlc-stage 2` (inherited from the shared `FLAGS` variable). A failed screenshot upload bumps `UPLOAD_FAILURES`. REQs with zero screenshots are tracked in `ZERO_Screenshot_REQS` and checked against the Playwright JSON report (`ci-evidence/e2e-results.json`) for tagged tests — if a REQ has zero screenshots AND zero tagged tests, `EVIDENCE_GAPS` increments and the step exits 1 (DevAudit-Installer#169).
- **Preconditions / inputs:** Pending release tickets present; screenshots named `REQ-XXX-AC<n>-<slug>.png` (portal validates this shape — others 400); `ci-evidence/e2e-results.json` from the downloaded `ci-results` artifact.
- **Given** a pending release ticket for REQ-X **When** `upload-evidence` runs **Then** only `compliance/evidence/REQ-X/screenshots/*.png` are uploaded (scoped, `--release REQ-X`), legacy out-of-scope folders ignored; a mis-named PNG that the portal 400s turns the step red. **Given** REQ-X has zero screenshots **When** the evidence-completeness gate checks the Playwright JSON **Then** if zero tests are tagged with REQ-X (in title or annotations), `EVIDENCE_GAPS` increments and the step exits 1 — the release cannot proceed to UAT with no traceable evidence. **Given** REQ-X has zero screenshots but ≥1 tagged test **Then** the gate passes (screenshot gap is non-blocking).
- **Error paths:** No pending tickets → loop skipped; missing sidecar → upload without origin meta; missing `e2e-results.json` → `TAGGED_COUNT=0` (fails the gate if screenshots are also zero).
- **Fixtures/env:** Pending ticket + correctly-named PNG + sidecar; plus a mis-named PNG to assert the red path; plus a REQ with zero screenshots and zero tagged tests to assert the evidence-completeness gate.

#### REQ-FRAMEWORK-CIYML-010 — ci.yml does not upload committed compliance docs (single-owner rule)

- **Priority:** Should — prevents duplicate append-only rows; ownership boundary with compliance-evidence.yml (#45).
- **Source:** `sdlc/files/ci/ci.yml.template` `upload-evidence` trailing NOTE block: committed planning docs (RTM/test-plan/test-cases, release tickets, per-REQ evidence folders) are intentionally NOT uploaded here; only run-generated gate evidence (security_scan / ci_pipeline / test_report) is.
- **Preconditions / inputs:** Both `ci.yml` and `compliance-evidence.yml` rendered; a push touching both code and `compliance/`.
- **Given** a push touching code + `compliance/` **When** both workflows run **Then** `ci.yml` uploads only run-generated gate evidence and `compliance-evidence.yml` is the sole uploader of committed compliance docs (no duplicate rows).
- **Error paths:** N/A (negative requirement — assert absence of doc uploads from ci.yml).
- **Fixtures/env:** Portal stub counting rows per doc across both workflows.

#### REQ-FRAMEWORK-CIYML-011 — Evidence-completeness gate: 3-scenario logic with unit test evidence (#237)

- **Priority:** Should — prevents releases reaching UAT with no traceable per-REQ evidence (DevAudit-Installer#169); complements E2E-011 (skill-side prevention) as the CI-side safety net.
- **Source:** `sdlc/files/ci/ci.yml.template` `upload-evidence` job: after the screenshot loop, REQs in `ZERO_Screenshot_REQS` are checked against `ci-evidence/e2e-results.json` using a Python script that counts tests tagged with the REQ. If `TAGGED_COUNT == 0`, the gate runs a 3-scenario fallback: (A) no evidence at all → hard error, (B) E2E specs on disk → non-blocking warning (#195), (C) `test-execution-summary.md` exists → non-blocking warning (#237, relaxed by #349). When unit test files with `@requirement` exist, the warning mentions them; otherwise the summary alone still downgrades the gate for test-maintenance REQs. After all REQs are checked, if `EVIDENCE_GAPS > 0`, the step exits 1.
- **Preconditions / inputs:** `ci-evidence/e2e-results.json` from the downloaded `ci-results` artifact; pending release tickets (`SHOT_REQS`); at least one REQ with zero screenshots in `ZERO_Screenshot_REQS`.
- **Given** REQ-X has zero screenshots and zero tagged tests and no E2E specs on disk and no unit test files with `@requirement` and no `test-execution-summary.md` (Scenario A) **When** the gate runs **Then** `EVIDENCE_GAPS` increments and the step exits 1. **Given** REQ-X has zero tagged tests but E2E spec files on disk reference it (Scenario B) **When** the gate runs **Then** a non-blocking `::warning::` is emitted and `EVIDENCE_GAPS` does not increment. **Given** REQ-X has zero tagged tests and a `test-execution-summary.md` exists (Scenario C), whether or not unit test files with `@requirement` exist on disk, **When** the gate runs **Then** a non-blocking `::warning::` is emitted and `EVIDENCE_GAPS` does not increment. This covers test-maintenance REQs whose evidence is an existing spec tagged for an earlier REQ. **Given** REQ-X has zero screenshots but ≥1 tagged test **Then** the gate passes (non-blocking). **Given** `e2e-results.json` is missing **Then** `TAGGED_COUNT=0` (falls through to 3-scenario logic).
- **Error paths:** Missing `e2e-results.json` → Python script returns 0 (enters 3-scenario logic); Python parse error → 0 (enters 3-scenario logic).
- **Fixtures/env:** A REQ with zero screenshots and no evidence at all (Scenario A, fails); a REQ with E2E specs on disk but not in smoke tier (Scenario B, warning); a REQ with only `test-execution-summary.md` for a test-maintenance change (Scenario C, warning); a REQ with unit test files + summary but no E2E (Scenario C, warning); a REQ with zero screenshots but tagged tests (passes); missing `e2e-results.json` (enters 3-scenario logic).

#### REQ-FRAMEWORK-CIYML-012 — CI templates stamp `--test-execution` on all uploads for portal test execution grouping

- **Priority:** Should — enables the portal to group evidence by test execution (DevAudit-Installer#209); additive/optional, no regression for portals that don't yet accept `testExecutionId`.
- **Source:** `sdlc/files/ci/ci.yml.template`, `sdlc/files/ci/compliance-evidence.yml.template`, and `scripts/upload-evidence.sh`.
- **Preconditions / inputs:** CI run on a rendered consumer repo; `DEVAUDIT_BASE_URL` + `DEVAUDIT_API_KEY` configured.
- **Given** a governed CI execution **When** execution output is uploaded **Then** the workflow carries the provider execution identifier, first-class record identifier, and `evidenceScope=execution`. Release and stage documents omit those execution fields. The upload helper may translate canonical names at the HTTP boundary, but generated workflows do not enter a grouping-only fallback mode.
- **Error paths:** Missing first-class execution capability leaves the release unresolved; the producer must not manufacture an execution from artifact presence.
- **Fixtures/env:** Rendered consumer repo; portal stub asserting execution lineage on execution output and its absence on release/stage documents.

#### REQ-FRAMEWORK-CIYML-013 — First-class test execution rollout uses execution-scoped uploads and forbids document-as-execution attribution

- **Priority:** Should — this is the producer-side lineage rule (`DevAudit-Installer#391`).
- **Source:** `contracts/release-lineage-contract.json`, `docs/release-lineage-producer-contract.md`, `docs/evidence-tiers.md`.
- **Preconditions / inputs:** generated workflow and script authors need the contract before test execution lifecycle emission is implemented.
- **Given** a release ticket, RTM, implementation plan, test plan, bundled-change manifest, test execution summary, security summary, or approval document **When** it is uploaded to the portal **Then** it is release-, stage-, or approval-scoped evidence, never execution-scoped evidence. **Given** the portal lacks first-class test-execution APIs **When** generated workflows report execution evidence **Then** they fail or leave the release unresolved rather than fabricating execution evidence. **Given** the required API is present **Then** execution evidence carries `evidenceScope=execution` and `testExecutionRecordId`.
- **Error paths:** treating a document upload as a test execution is a producer-contract violation; tests and docs are the enforcement surface at this phase.
- **Fixtures/env:** contract examples and rollout documentation; later workflow-emission issues consume this rule.

> **Note:** REQ-FRAMEWORK-CIYML-014 (index above) has no body section in this document — flagged as a pre-existing gap found while adding CIYML-015..018 below, not authored here (no requirement is invented; its content would need to be reverse-engineered from `sdlc/files/ci/ci.yml.template`'s register-release job before it can be written accurately).

#### REQ-FRAMEWORK-CIYML-014 — register-release derives the release version and ensures the portal release exists for gate-execution lineage (#226, corrected 2026-10-13)

- **Priority:** Must — the first-class test-execution APIs need an exact release row before the stage-2 execution can start (REQ-FRAMEWORK-CIYML-013), and a failed gate run must stay visible even when later evidence generation fails.
- **Source:** `sdlc/files/ci/ci.yml.template` (job `register-release`, steps `Resolve DevAudit base URL`, `Determine release version`, `Ensure release exists for gate-execution lineage`, `Upload standalone housekeeping declaration`, `Generate and upload bundled changes`).
- **Correction (2026-10-13):** the original index entry (#226) said register-release does not create portal release records and leaves creation to `upload-evidence`. The template has since changed (cycle lifecycle and test-execution provenance work, `f24d8ae`, `bf9ed51`): the job now calls `scripts/upload-evidence.sh ... _compliance-docs release_registration README.md --release <version> --create-release-if-missing --environment uat --category planning`, with `|| true` so a portal error never fails the gate.
- **Preconditions / inputs:** Not a pull request (PRs to the integration branch report Quality Gates without mutating releases), `github.ref_name` is the integration branch, and a DevAudit base URL is configured (`devaudit.base_url` in `sdlc-config.json`, else the deprecated `DEVAUDIT_BASE_URL` variable, #156).
- **Given** a configured base URL and no `DEVAUDIT_API_KEY` **Then** the job fails with `::error::DEVAUDIT_API_KEY (secret) must be set...`. **Given** no base URL **Then** release registration is skipped with a warning.
- **Given** `scripts/derive-release-version.sh` (the helper shared with `compliance-evidence.yml`) prints an empty version (close-out reconciliation) **Then** `version=skip` and every later step is skipped. **Given** a version **Then** the release is created if missing and later steps use it.
- **Given** a bare-date version with a `compliance/standalone-housekeeping/` declaration **Then** it is validated and uploaded as a `release_ticket`.
- **Error paths:** As above; the lineage step swallows upload errors.
- **Fixtures/env:** The rendered `ci.yml` job (template-lint, `workflow-run-syntax.test.ts`).

#### REQ-FRAMEWORK-CIYML-015 — Checkout `clean:false` self-hosted expression propagated to the 8 remaining self-hosted-capable templates (#815)

- **Priority:** Should — `#676` fixed `ci.yml.template`'s `actions/checkout` step to skip the default `clean: true` (which runs `git clean -ffdx`, wiping `node_modules` and the npm-ci lockfile-hash skip marker) on a persistent self-hosted runner, but left the other 8 self-hosted-capable templates unfixed — a `devaudit-cli update` sync silently dropped a consumer's hand-patched equivalent every time.
- **Source:** `sdlc/files/ci/{check-release-approval,close-out-completion,close-out-release,compliance-evidence,compliance-validation,feature-e2e,post-deploy-prod,reconcile-deployment}.yml.template` (10 `actions/checkout@v6` steps total — `compliance-evidence.yml.template` and `feature-e2e.yml.template` each have two); `cli/src/update/ci-templates.ts` (`resolveCheckoutClean`, the shared `{{CHECKOUT_CLEAN}}` token already used by `ci.yml.template`).
- **Preconditions / inputs:** `cfg.runner === 'self-hosted'` (the dynamic, runtime-resolved mode).
- **Given** any of the 8 templates' `actions/checkout@v6` steps **When** rendered **Then** each carries `clean: {{CHECKOUT_CLEAN}}` in its `with:` block, resolving at workflow runtime to `${{ (inputs.runner_label || vars.CI_RUNNER_LABEL || 'github-ci') == 'github-ci' && 'true' || 'false' }}` when `cfg.runner === 'self-hosted'`, or the literal `true` otherwise — identical resolution to `ci.yml.template`'s existing checkout steps, since all templates share the one `CHECKOUT_CLEAN` token computed once per sync target.
- **Error paths:** N/A — token substitution only, no new failure mode.
- **Fixtures/env:** `cli/test/update.test.ts`'s two `#676` tests (`sets checkout clean:false…`, `leaves checkout clean at its default true…`) were extended to assert across every generated workflow file (≥13 `clean:` lines total, not just `ci.yml`), so a future regression that narrows the fix back to one file fails the test.

#### REQ-FRAMEWORK-CIYML-016 — Declared-bundle co-tracked members survive the automatic bundled-changes regeneration (#817)

- **Priority:** Should — `sdlc-implementer` Phase 1 step 4 commits a declared-bundle manifest (`compliance/pending-releases/BUNDLED-CHANGES-<VERSION>.{md,json}`, carrying a "Co-Tracked Bundle Members" section, `generate-bundled-changes.sh --declared-bundle`) at the same path `ci.yml.template`'s "Generate and upload bundled changes" step unconditionally regenerates on every push via a retroactive predecessor/housekeeping-absorption scan (no `--declared-bundle` flag) — silently overwriting the declared membership data before it could ever reach the portal.
- **Source:** `sdlc/files/ci/ci.yml.template` ("Generate and upload bundled changes" step, register-release job); `sdlc/files/_common/scripts/generate-bundled-changes.sh` (`--declared-bundle` mode); `sdlc/files/_common/scripts/submit-bundle-manifest.sh`.
- **Preconditions / inputs:** A release whose resolved `$VERSION` has an already-committed `compliance/pending-releases/BUNDLED-CHANGES-${VERSION}.md` containing the literal string `Co-Tracked Bundle Members`, and a matching `.json` manifest.
- **Given** such a committed manifest **When** the step runs **Then** it re-derives a `--declared-bundle "REQ-A,REQ-B,..."` argument from that manifest's `.members[] | select(.role == "co_tracked") | .version` (comma-joined) **before** regenerating, and passes it to `generate-bundled-changes.sh` alongside the normal `$SINCE_REF`/`$VERSION` scan — so the regenerated manifest carries both the preserved co-tracked members and any newly-discovered predecessor/housekeeping absorption items from the same run, neither clobbering the other. **Given** no such committed manifest exists (or it lacks the "Co-Tracked Bundle Members" marker — the same guard `derive-release-version.sh` step 0 uses to distinguish a declared bundle from a retroactive-absorption-only one) **Then** `DECLARED_BUNDLE_ARGS` is empty and behavior is unchanged from before this REQ.
- **Given** the regenerated manifest still has zero `.members` and zero `.nonReleaseWorkItems` **Then** both files are removed and the step exits 0, unchanged from prior behavior.
- **Error paths:** None specific to regeneration. **Corrected 2026-10-04 (#955):** this REQ previously described a template-side filter (`jq '.members |= map(select(.role != "co-tracked"))'`, hyphenated, "dropped once `devaudit#857` ships"). That filter was lifted by #817/#884 and the hyphenated spelling is gone (`co_tracked`, underscore). What the template does today is hand the full committed manifest to `submit-bundle-manifest.sh`, which owns the (permanent, deliberate) removal of `co_tracked` members from the submitted payload — see REQ-FRAMEWORK-BUNDLE-003. The full manifest (members included) is still what is committed to `$BUNDLED_FILE`/`$BUNDLED_MANIFEST` and uploaded as `bundled_changes` evidence, so the declared membership stays visible in the PR/evidence trail.
- **Fixtures/env:** Verified end-to-end against a real git fixture (not just source-string assertions) — a committed declared-bundle manifest (built via the actual `--declared-bundle` flag) dropped to zero members after one unguarded regeneration (reproducing the bug), then was correctly preserved alongside a newly-added housekeeping commit once the fix's re-derivation logic ran. `cli/test/req-bundling.test.ts` — tests asserting the re-derivation code, that the template itself does not filter (the filter lives in `submit-bundle-manifest.sh`, REQ-FRAMEWORK-BUNDLE-003), and the full manifest still being uploaded as evidence after submission.

#### REQ-FRAMEWORK-CIYML-017 — SAST/dependency-audit evidence fans out to declared-bundle co-tracked sibling REQs (#819)

- **Priority:** Should — implements `#438`'s own deferred item-3 exception (an explicit bundle manifest may extend gate-evidence attachment beyond the single commit-derived release) for SAST/dependency-audit specifically; E2E already had the equivalent fan-out (`has_req_tagged_e2e_result`) but SAST/dependency-audit stayed hard-restricted, so a non-primary declared-bundle member permanently showed both gates as missing (every push resolves to the bundle's primary REQ via `derive-release-version.sh` step 0, and nothing previously fanned the primary's scan results out to siblings).
- **Source:** `sdlc/files/ci/ci.yml.template` ("Generate and upload gate evidence" step, `upload-evidence` job — the fan-out block sits between the primary `dependency-risk-evaluation.json` upload and the existing E2E fan-out block).
- **Preconditions / inputs:** A committed `compliance/pending-releases/BUNDLED-CHANGES-${VERSION}.md`/`.json` (the declared-bundle manifest preserved by CIYML-016 above) exists for the commit-derived `$VERSION`, containing the "Co-Tracked Bundle Members" marker.
- **Given** such a manifest **When** the SAST/dependency-audit uploads run **Then** `sast-results.json` and `dependency-audit.json` (whichever exist) additionally upload — tagged with each `role == "co_tracked"` member's own REQ as the requirement id, but **filed against the bundle's single release** resolved by `scripts/resolve-bundle-release.sh` (`--release <core> --create-release-if-missing`, REQ-FRAMEWORK-BUNDLE-001; **corrected 2026-10-04 (#955)**, previously each member got a release of its own) — using the same `--category security_scan --gate-status ...` flags and `PRIMARY_LINEAGE_FLAGS` as the primary upload — unlike E2E's fan-out (gated on a REQ-tagged test having actually executed), SAST/dependency-audit apply uniformly to the whole bundle's shared diff, since there's no per-REQ tagging concept for a security scan.
- **Given** a member REQ already has a ticket in `compliance/approved-releases/` or `compliance/superseded-releases/` **Then** it is skipped (mirrors the existing E2E fan-out's `#192` terminal-release skip). Deferred tickets stay in `compliance/pending-releases/` (ADR-002), so this skip never applies to them: a deferred member keeps receiving evidence uploads (whether the portal accepts uploads against a `deferred` release is unverified, #956).
- **Error paths:** No manifest, or a manifest without the "Co-Tracked Bundle Members" marker (e.g. a retroactive-absorption-only manifest) → the fan-out block is a no-op, unchanged from before this REQ.
- **Fixtures/env:** Verified standalone against a fixture before adding test coverage — a co-tracked member correctly received both uploads, a terminal member was correctly skipped, and a `role: "predecessor"` manifest entry was correctly excluded from fan-out. `cli/test/release-lifecycle-workflows.test.ts` — source-assertion test confirming the fan-out block's role filter, requirement id (`"${MEMBER_REQ}"`, not `_compliance-docs`), release target (`MEMBER_RELEASE` from the resolver, never `--release ${MEMBER_REQ}`), the terminal-release skip paths, and that the block appears before the (unrelated, pre-existing) E2E fan-out block begins.

#### REQ-FRAMEWORK-CIYML-018 — "Kill stale dev server" fails loudly instead of silently swallowing a stale-process kill failure (#820)

- **Priority:** Should — the prior `lsof -ti:{{E2E_PORT}} | xargs kill -9 2>/dev/null || true` silently swallowed a cross-user `EPERM` on a persistent self-hosted runner (the runner's system user cannot kill a process a different user's session started on the same host). CI's own dev server then failed to bind the port, but the immediately-following `wait-on` step passed anyway — against the stale process — and the E2E suite ran against unrelated old code with no indication anything was wrong. Traced live on a real incident (`example-app` PR #786).
- **Source:** `sdlc/files/ci/ci.yml.template`, `sdlc/files/ci/feature-e2e.yml.template` ("Kill stale dev server" step, immediately before `{{E2E_DEV_SERVER_STEP}}` / "Wait for dev server") and, since #1054, `sdlc/files/ci/e2e-regression.yml.template` (same step, between `{{E2E_SETUP_STEP}}` and `{{E2E_REGRESSION_SERVER_STEP}}`).
- **Preconditions / inputs:** `{{E2E_PORT}}` resolves to the configured (or default `3000`) E2E dev-server port.
- **Given** `lsof -ti:{{E2E_PORT}}` finds a listening process **When** the step runs **Then** it attempts `kill -9`, waits 1s, and re-checks `lsof -ti:{{E2E_PORT}}`; **if the port is still held** **Then** the step prints `::error::` naming the port and the likely cross-user cause, and exits 1 (hard-failing the job) instead of proceeding. **Given** `lsof` finds nothing (the common case on the ephemeral `github-ci` path, where nothing is ever listening on `{{E2E_PORT}}` before this step) **Then** the step is a no-op — byte-for-byte the same outcome as before this REQ.
- **Error paths:** The hard-fail **is** the intended error path — a stale process the runner genuinely cannot kill now blocks the job loudly instead of producing a misleadingly-passing "Wait for dev server" step against the wrong server.
- **Fixtures/env:** `cli/test/release-lifecycle-workflows.test.ts` — a parameterized test (`it.each(['ci.yml.template', 'feature-e2e.yml.template'])`) asserting both templates contain the re-check-then-`exit 1` pattern and that neither adds a `runner_label == 'github-ci'`-style branch (the fix is unconditional, not self-hosted-gated).

#### REQ-FRAMEWORK-CIYML-019 — `playwright install --with-deps` gated to the runtime-resolved `github-ci` path on self-hosted configs (#868, PR #882)

- **Priority:** Should — `--with-deps` needs root to `apt-get` system libraries; on a non-root self-hosted runner it always failed, and the old `npx playwright install --with-deps chromium 2>/dev/null || npx playwright install chromium` fallback merely masked that, wasting a doomed install attempt on every self-hosted run.
- **Source:** `cli/src/update/ci-templates.ts` (`resolvePlaywrightWithDeps`, token `PLAYWRIGHT_WITH_DEPS_FLAG`); `sdlc/files/ci/ci.yml.template`, `sdlc/files/ci/feature-e2e.yml.template`, `sdlc/files/ci/e2e-regression.yml.template` ("Install Playwright (skip if already cached)": `npx playwright install{{PLAYWRIGHT_WITH_DEPS_FLAG}} chromium`). The `e2e-test-engineer` skill's copy-paste reference `references/e2e-regression-3-tier.yml` hardcodes the equivalent inline expression (not template-substituted).
- **Preconditions / inputs:** `cfg.runner`.
- **Given** `cfg.runner !== 'self-hosted'` **When** rendered **Then** the token is the literal ` --with-deps` (leading space), rendering `npx playwright install --with-deps chromium` unconditionally — no fallback, no runtime branching. **Given** `cfg.runner === 'self-hosted'` **Then** it renders `${{ (inputs.runner_label || vars.CI_RUNNER_LABEL || 'github-ci') == 'github-ci' && ' --with-deps' || '' }}`, so `--with-deps` is requested only when the run resolves to `github-ci`; on any other label the step collapses to plain `npx playwright install chromium` (version-aware; skips the download when already cached; system libs are expected to be provisioned on the host).
- **Error paths:** N/A — substitution only. The masking `2>/dev/null || …` fallback is gone, so a genuine install failure now fails the step.
- **Fixtures/env:** update.test.ts "only requests playwright install --with-deps on the runtime-resolved github-ci path for a self-hosted runner (#868)", "leaves playwright install --with-deps unconditional for a non-self-hosted runner (#868)".

#### REQ-FRAMEWORK-CIYML-020 — Stale `.next` build output cleaned only on an actually-self-hosted runtime runner (#816, PR #885)

- **Priority:** Should — `clean: false` checkout (REQ-FRAMEWORK-CIYML-015) keeps gitignored state on a persistent runner, including `.next`; a dev-server-writing job killed mid-write (timeout/OOM/cancellation) could leave it torn and break every later run's TypeScript Check / Build Check on unrelated PRs.
- **Source:** `cli/src/update/ci-templates.ts` (`resolveStaleNextCleanupCondition`, token `STALE_NEXT_CLEANUP_IF`); `sdlc/files/ci/ci.yml.template` ("Clean stale build and test output (self-hosted only)" step, `if: {{STALE_NEXT_CLEANUP_IF}}`, immediately after checkout). Since #1054 the step is named "Clean stale build and test output", also removes the previous run's result files and server log (`rm -rf .next test-results playwright-report e2e-results.json e2e-auth-results.json e2e-regression-results*.json e2e-regression-metadata.json e2e-server.log .e2e-server.pid test-results-shard-* playwright-report-shard-*`; the shard names are listed exactly, never as `test-results*`, which could remove a tracked directory), and is also present in `feature-e2e.yml.template` and `e2e-regression.yml.template`. Checkout stays `clean: false` (REQ-FRAMEWORK-CIYML-015): `node_modules` and the skip-install marker are kept.
- **Preconditions / inputs:** `cfg.runner`.
- **Given** `cfg.runner !== 'self-hosted'` **When** rendered **Then** the step's `if:` is the literal `false` — the step never runs (nothing persists between ephemeral runs, so it's skipped outright rather than run as a no-op, to keep the `if:` legible). **Given** `cfg.runner === 'self-hosted'` **Then** `if: ${{ (inputs.runner_label || vars.CI_RUNNER_LABEL || 'github-ci') != 'github-ci' }}` — it runs only when the run actually lands on a persistent self-hosted runner.
- **Error paths:** N/A.
- **Fixtures/env:** update.test.ts "only cleans stale .next output and retries npm audit on the runtime-resolved self-hosted path (#816)", "leaves the stale .next cleanup disabled and npm audit retry at 1 attempt for a non-self-hosted runner (#816)".

#### REQ-FRAMEWORK-CIYML-021 — Dependency Audit retries unparseable `npm audit` output; npm pinned past the retired audit endpoint (#816, PR #885)

- **Priority:** Should — a transient registry blip (ECONNRESET/5xx) used to hard-fail the gate outright; separately, Node's bundled npm (10.8.2) calls the retired `/v1/security/audits/quick` endpoint, which 400s regardless of lockfile validity.
- **Source:** `cli/src/update/ci-templates.ts` (`resolveNpmAuditMaxAttempts`, token `NPM_AUDIT_MAX_ATTEMPTS`); `sdlc/files/ci/ci.yml.template` ("Ensure npm supports the current audit API endpoint" step; "Dependency Audit" step's retry loop).
- **Preconditions / inputs:** `cfg.runner`.
- **Given** any runner **When** `ci.yml` runs **Then** an unconditional step `npm install -g npm@^10.9.8` runs before Dependency Audit (not runner-gated). **Given** `cfg.runner !== 'self-hosted'` **Then** `MAX_ATTEMPTS=1` (no retry — the pre-#885 behaviour); **given** `cfg.runner === 'self-hosted'` **Then** `MAX_ATTEMPTS=${{ (inputs.runner_label || vars.CI_RUNNER_LABEL || 'github-ci') == 'github-ci' && '1' || '5' }}`. The step loops `npm audit --json > dependency-audit.json 2>/dev/null || true` and breaks as soon as `jq empty dependency-audit.json` succeeds — it retries **only** when the output isn't parseable JSON (the call itself didn't complete), **never** on npm audit's own nonzero exit (which just means vulnerabilities were found — a successful audit). Between attempts it logs `npm audit attempt <n>/<max> produced no parseable JSON — retrying...` and sleeps `ATTEMPT*2` seconds. After the last attempt it emits `::warning::npm audit produced no parseable JSON after <n> attempt(s); continuing with an empty result.` and writes `{"vulnerabilities":{}}`, so the downstream decision logic (REQ-FRAMEWORK-CIYML-003, unchanged) evaluates an empty result rather than the step hanging or crashing.
- **Error paths:** Exhausted retries degrade to a warning + empty result (not a hard fail) — note this means a persistent audit-endpoint outage yields a passing dependency gate with a visible `::warning::`, not a failed one.
- **Fixtures/env:** Same update.test.ts pair as REQ-FRAMEWORK-CIYML-020.

#### REQ-FRAMEWORK-CIYML-022 — `reconcile-deployment.yml` is generated for a host adapter that declares a `reconcile` capability, removed otherwise (#841, PR #883; adapter-driven by #1022)

- **Priority:** Should — a host with no recovery path must not receive a dead workflow, and the host-specific parts (the CLI, the secrets, the provider lookup) are the adapter's data, not a hardcoded host name.
- **Source:** `cli/src/update/ci-templates.ts` (`syncCiTemplates`: `loadHostAdapter` -> `reconcile`; the `!reconcile` removal sweep and the `!reconcile` skip in the render loop; tokens `HOST` and `RECONCILE_SECRETS_ENV`); `sdlc/files/ci/reconcile-deployment.yml.template`; `sdlc/files/hosts/<host>/adapter.json` (`reconcile`); `sdlc/files/hosts/_schema/adapter.schema.json`.
- **Preconditions / inputs:** The resolved host adapter (`ctx.host`) and its `reconcile` object (`lookup_script`, `required_cli`, `secrets`).
- **Given** a host whose adapter has `reconcile` (railway, vercel) **When** `syncCiTemplates` runs **Then** `reconcile-deployment.yml` is generated for that host: neutral dispatch inputs (`provider_deployment_id`, `provider_project`, `provider_service`), `--provider="<host>"`, `scripts/lookup-deployment-<host>.sh`, one `NAME: ${{ secrets.NAME }}` per entry of `reconcile.secrets`, `provider=<host>` in the evidence metadata; it still carries `clean: {{CHECKOUT_CLEAN}}` (REQ-FRAMEWORK-CIYML-015). Changing the host regenerates the same managed path for the new host. **Given** a host with no `reconcile` **Then** the template is skipped, and any existing `reconcile-deployment.yml` or target-namespaced `reconcile-deployment-<target>.yml` (`/^reconcile-deployment(-.+)?\.yml$/`) is removed via `removeManaged`: **manifest-driven since devaudit-installer#930**, deleted only if its on-disk content still matches what devaudit last wrote; a hand-edited stale copy is kept and reported as a conflict (REQ-CLI-UPDATE-030). Its presence also gates `doctor`'s `reconcile-cli` check (REQ-CLI-DOCTOR-005).
- **Breaking for operators:** the manual dispatch inputs were renamed (`railway_deployment_id` -> `provider_deployment_id`, `railway_project` -> `provider_project`, `railway_service` -> `provider_service`); `reconcile-railway-deployment.sh` is replaced by `reconcile-deployment.sh` plus `lookup-deployment-<host>.sh` (a consumer's stale copy of the old script is left in place, harmless).
- **Error paths:** N/A.
- **Fixtures/env:** update.test.ts "generates a vercel-flavoured reconcile-deployment.yml for the vercel host adapter (#1022)", "does not generate reconcile-deployment.yml for a host adapter with no reconcile capability (#841, #1022)", "generates reconcile-deployment.yml for the railway host adapter, retargets it on a host change, and removes it for a host with no reconcile capability".

#### REQ-FRAMEWORK-CIYML-023 — Release-PR provenance requires a real `ci.yml` Quality Gates success on the latest code-bearing commit (#971)

- **Priority:** Must — before this, a docs-only commit landing on the integration branch after a code merge made the release PR show `Quality Gates` green for code that no gate had run (example-api release PRs #153/#157).
- **Source:** `sdlc/files/ci/quality-gates-provenance.yml.template` (step "Verify prior Quality Gates success on head SHA", non-hotfix path); `sdlc/files/_common/scripts/provenance-gated-commit.sh`; `cli/src/update/ci-templates.ts` (`{{PATHS_IGNORE_LIST}}` token, the same `paths_ignore` patterns as `ci.yml`'s push filter).
- **Preconditions / inputs:** A release PR (`<integration> → <release>`, not a hotfix) whose checkout has full history (`fetch-depth: 0`).
- **Given** a release PR **When** provenance runs **Then** it finds the latest first-parent commit in `origin/<release>..<head>` that touches at least one path not matched by `paths_ignore` (the gated commit) and requires a completed+`success` `Quality Gates` check-run on it whose workflow run (resolved from `details_url` via `GET /repos/{repo}/actions/runs/{id}`) has `.path == .github/workflows/ci.yml`. **Given** the only success is from `ci-status-fallback.yml`, from this provenance workflow, or `ci.yml` was `skipped` **Then** it does not count and the check fails after the existing MAX_ATTEMPTS/WAIT_SECONDS wait, naming the ungated commit and telling the operator to rerun CI on it / push it through the develop flow. **Given** every commit in the range is docs-only **Then** any `Quality Gates` success on the head is accepted. The current run is always excluded. The hotfix dispatch path is unchanged.
- **Consequence:** a release PR stays red while the runner is offline or the code commit never got a real `ci.yml` run. This is intended.
- **Error paths:** Check-run lookup or run-path resolution failing is treated as "no success yet" and retried.
- **Fixtures/env:** `sdlc/files/_common/scripts/provenance-gated-commit.test.sh` (fixture git repos: all-code, docs-only head over code, all-docs, glob, fallback-only success); `cli/test/release-lifecycle-workflows.test.ts` "provenance requires a real ci.yml Quality Gates success…"; `cli/test/update.test.ts`.

#### REQ-FRAMEWORK-CIYML-024 — Integration housekeeping registers no portal release unless a standalone declaration exists (#1020)

- **Priority:** Must — since #409 a bare-date row for normal housekeeping is not an approval task and is later superseded, so it only added portal records and "is this pending?" confusion; GitHub already holds the CI history.
- **Source:** `sdlc/files/_common/scripts/derive-release-version.sh` (step 5, opt-in `DEVAUDIT_SKIP_INTEGRATION_HOUSEKEEPING=1`; declaration looked up at `compliance/standalone-housekeeping/STANDALONE-HOUSEKEEPING-<version>.json`, directory overridable with `STANDALONE_HOUSEKEEPING_DIR`); `sdlc/files/ci/ci.yml.template` (`register-release` "Determine release version"; `upload-evidence` job `if` also requires `needs.register-release.outputs.version != 'skip'`); `sdlc/files/ci/compliance-evidence.yml.template` (both "Determine release version" steps); the two disabled `Legacy housekeeping …` steps were removed.
- **Given** an untagged integration commit (no REQ tag, `Ref:`, single-REQ merge range, pending ticket or IN PROGRESS RTM row) **When** `ci.yml` / `compliance-evidence.yml` derive the version **Then** the helper prints nothing, the workflows emit `version=skip`, and no release row is created, no gate-execution lineage started, no bundled-changes or compliance/E2E evidence uploaded against a bare-date version, and the `upload-evidence` job does not run. **Given** the same commit with a standalone declaration for today's `vYYYY.MM.DD` **Then** behaviour is unchanged: the row is created, the declaration uploaded, the portal promotes the row. **Given** a REQ-tagged commit **Then** the opt-in has no effect. **Given** a caller that does not set the variable (release-PR scope check, post-deploy, close-out) **Then** behaviour is unchanged.
- **Absorption:** the next tracked release still lists the housekeeping, because `generate-bundled-changes.sh` scans the git range from the last tag (or the merge-base with `main`), not portal rows. The declaration filename carries exactly the derived version (no `.N` suffix), so the same-day standalone path is stable between the PR and the push.
- **Out of scope:** the Python `ci.yml` registers its release through the portal's `resolve` endpoint rather than this helper (parity is #995); the dead `generate-housekeeping-release-ticket.sh` is kept (a synced script cannot be removed from consumers cleanly).
- **Fixtures/env:** `derive-release-version.test.sh` (opt-in with/without declaration, other-date declaration, tagged commit, no opt-in); `cli/test/release-lifecycle-workflows.test.ts` "integration housekeeping registers no portal release (#1020)".

---

#### REQ-FRAMEWORK-CIYML-025 — Every generated workflow job runs on the configured runner (#1044)

- **Priority:** Should — a consumer on a self-hosted runner with no GitHub-hosted minutes otherwise gets housekeeping jobs that never start, and the `Quality Gates` status emitted by `ci-status-fallback` and `quality-gates-provenance` never reports, leaving a PR BLOCKED.
- **Source:** `sdlc/files/ci/{incident-export,ci-status-fallback,label-retention,periodic-review,quality-gates-provenance}.yml.template` (`runs-on: {{RUNNER}}`); `cli/src/update/ci-templates.ts:resolveRunner`.
- **Given** any generated workflow **When** its job declares `runs-on` **Then** the value is the rendered `{{RUNNER}}` token: the config's static `runner` override, or for `runner: self-hosted` the `CI_RUNNER_LABEL` expression (`github-ci` maps to `ubuntu-latest`).
- **Fixtures/env:** `cli/test/ci-templates-runner.test.ts` (no template carries a literal hosted label).

#### REQ-FRAMEWORK-CIYML-026 — Postgres service on a random host port; E2E workflows isolate port, database URI and run output between jobs (#1054)

- **Priority:** Should — jobs on a shared self-hosted host otherwise collide on a fixed postgres host port, and `e2e-regression.yml` pointed `database_env` at a fixed `localhost` port with no kill-stale-server or database-URI step, so it could reach another job's database or server.
- **Source:** `cli/src/update/ci-templates.ts` (`postgresUriEnvEntries`, `buildDbUriStep`, `resolveDatabasePort`); `sdlc/files/ci/e2e-regression.yml.template` (`{{DATABASE_URI_STEP}}` before `{{E2E_SETUP_STEP}}`, "Kill stale dev server", cleanup step).
- **Preconditions / inputs:** `database_service: postgres`; zero or more `*_URL` / `*_URI` keys in `database_env`, `build_env`, `app_env` or `e2e_env`.
- **Given** at least one such key whose value is a `postgres://` or `postgresql://` URL with host `localhost` or `127.0.0.1` (with or without credentials) **When** the workflows render **Then** the service publishes the bare container port `5432` (random host port) and "Set database URI from dynamic port" re-exports each key through `$GITHUB_ENV` with the mapped port, keeping credentials, database and query; the steps that carry `e2e_env` or `build_env` (setup, dev server, E2E, authenticated E2E, feature E2E, build) omit the remapped keys from their own `env:`, which would otherwise override `$GITHUB_ENV`. **Given** no such key (including a `${{ secrets.* }}` value) **Then** the output is unchanged: `<database_port>:5432` and no URI step. **Given** `e2e_regression_enabled` **Then** `e2e-regression.yml` contains the database-URI step (when a database is configured), the kill-stale-server step and the self-hosted cleanup step, in the same order as `ci.yml`/`feature-e2e.yml`.
- **Error paths:** a port still held after the kill attempt fails the job (REQ-FRAMEWORK-CIYML-018).
- **Fixtures/env:** `cli/test/database-service.test.ts` "postgres dynamic host port (#1054)".

#### REQ-FRAMEWORK-CIYML-027 — Every generated workflow takes its branches from `integration_branch` and `release_branch` (#1116 WP2)

- **Priority:** Should — `install` lets a project name its own branches; four templates (`compliance-validation`, `compliance-evidence`, `ci-status-fallback`, `close-out-completion`) hard-coded `main` or `develop` in their triggers, so with other names they would never have run, and eight more used the names in git commands, evidence arguments and messages.
- **Source:** `sdlc/files/ci/*.yml.template`, `sdlc/files/ci/python/ci.yml.template`, `sdlc/files/ci/runners/pytest/e2e-regression.yml.template` (the `{{INTEGRATION_BRANCH}}` and `{{RELEASE_BRANCH}}` tokens, `cli/src/update/ci-templates.ts`).
- **Given** `integration_branch` and `release_branch` in `sdlc-config.json` (defaults `develop` and `main`) **When** the workflows render **Then** every trigger, `git fetch`/`merge`/`push`, `gh pr list/create --base`, `--branch` evidence argument, `ref:` and message uses those names. With `release_branch: production` and `integration_branch: staging` no generated workflow (Node or Python) contains `main` or `develop` outside comments and links to other repositories' documents. With the defaults the rendered workflows are byte-identical to what they were before this change (verified across 80 files in five configurations).
- **Fixtures/env:** `cli/test/custom-branches.test.ts`.

#### REQ-CLI-DOCTOR-020 — `devaudit doctor` reviews the test tiers (`test-tiers`) (#1060)

- **Priority:** Should — a tier that resolves to no tests, an untagged test, or a missing smoke tier silently weakens the gate it feeds; doctor catches it without running the suite.
- **Source:** `cli/src/commands/doctor-tiers.ts` (`testTiersCheck`, `collectVariant`, `parseCollected`); `cli/src/lib/test-runner-detect.ts`; registered in `runConfigChecks` (`cli/src/commands/doctor-config.ts`) so it appears under `onboarding` in `--json`.
- **Preconditions / inputs:** a Playwright or pytest setup, or any `test_tier_*` command; an injected command runner (a test seam) and `gh`.
- **Given** a declared tier **When** doctor runs **Then** it collects (`pytest --collect-only -q`, `npx playwright test --list --project=<p>`, or the collect-only form of a custom command) and reports a tier with zero tests, an empty smoke tier (with the `e2e-test-engineer` skill as the next step), test files without a `REQ-XXX` tag, and recent regression runs longer than `e2e_regression_timeout_minutes`; notes a `critical` tier that equals smoke or is absent, RTM requirements with no test, and a custom command it cannot collect. **Given** a collect command fails **Then** the count is unknown, never a finding.
- **Error paths:** nothing is run beyond the collect commands; every finding is tier C guidance and `--fix` applies nothing; `gh` unavailable skips only the run-history item.
- **Fixtures/env:** `cli/test/doctor-tiers.test.ts` (fake `gh` and command runner).

#### REQ-CLI-DOCTOR-021 — `devaudit doctor` reviews the E2E release gate (`e2e-release-gate`) (#1059)

- **Priority:** Should — the gate is a policy choice with a time and flakiness cost; doctor confirms it makes sense before anything depends on it, and proposes but never applies a change.
- **Source:** `cli/src/commands/doctor-tiers.ts` (`e2eReleaseGateCheck`, `recentRegressionRuns`); registered in `runConfigChecks`.
- **Given** a gate key without `e2e_regression_enabled`, an invalid gate, or a `full` gate with no runnable full tier **Then** a tier C finding names the `devaudit configure` command. **Given** a `full` gate whose median recent `E2E Regression` run (last 30 finished runs via `gh run list`) exceeds the limit that stops it **Then** a finding names that limit: the fixed 40-minute test-command timeout (no `e2e/ci-reliability/regression-run.sh` hook, or `test_runner: pytest`), where it proposes sharding or moving slow tests and never a larger `e2e_regression_timeout_minutes`; or the job timeout (hook present), where it proposes a larger budget or sharding. **Given** enough history **Then** notes recommend `full` (median under 20 minutes) or `critical` plus a schedule, flag a post-deploy run that repeats a `full` gate, and a cron with no scheduled run in 7 days. **Given** no gate key and no workflow **Then** the check is ok and says it is not opted in.
- **Error paths:** run history `gh` cannot show is listed as not checked, not a failure.
- **Fixtures/env:** `cli/test/doctor-tiers.test.ts`.

#### REQ-FRAMEWORK-RELGATE-001 — Release gate keys drive the `e2e-regression.yml` triggers (#1059)

- **Priority:** Should — the full regression ran only after the production deploy, outside the fix/accept/defer rules of the release PR. Projects need to choose, per project, which tier gates the release and be able to change it later.
- **Source:** `cli/src/lib/repo-config-keys.ts` (`release_gate_tier` enum `none|smoke|critical|full`, `post_deploy_full_regression`, `scheduled_full_regression` five-field cron or empty); `cli/src/update/ci-templates.ts` (`buildE2eRegressionTriggers`, `buildE2eRegressionSelectCases`, `buildE2eRegressionCheckoutRef`, `buildE2eRegressionScheduleIssueStep`); `sdlc/files/ci/e2e-regression.yml.template` and its pytest variant.
- **Preconditions / inputs:** `e2e_regression_enabled`; the three keys, each optional.
- **Given** none of the keys is set **Then** the rendered `e2e-regression.yml` and `check-release-approval.yml` are identical to the output before the keys existed. **Given** any key is set **Then** `pull_request` into the release branch is present unless the gate is `none`, `deployment_status` unless `post_deploy_full_regression` is `false`, and `schedule` with the cron when it is a valid five-field expression; `workflow_dispatch` is always present. **Given** the gate is `smoke`, `critical` or `full` **Then** the pull-request run uses the smoke project (`e2e_project`), the critical project (falling back to smoke) or the regression project; post-deploy, scheduled and dispatch runs use the full tier. **Given** a schedule **Then** the run checks out the integration branch, and a failure opens or updates one `bug` issue titled `[scheduled regression] Full E2E failing on <branch>`.
- **Error paths:** an invalid cron expression is ignored when rendering and rejected by `devaudit configure set`.
- **Fixtures/env:** `cli/test/release-gate.test.ts`.

#### REQ-FRAMEWORK-RELGATE-002 — The executed tier is recorded and labelled; scheduled runs stay out of the portal (#1059)

- **Priority:** Should — the portal tier must come from what the run executed, not from the trigger event, and a nightly run on the integration branch must not attach to an in-flight release or raise a triage blocker.
- **Source:** `sdlc/files/ci/e2e-regression.yml.template` and `sdlc/files/ci/runners/pytest/e2e-regression.yml.template` (`tier` in `e2e-regression-metadata.json` only when a gate key is set, so an unconfigured project, pytest included, never reports `e2e-release-gate`); `sdlc/files/ci/compliance-evidence.yml.template` (`TIER_LABEL`, `CHECK_REQUIRED`, the schedule skip); `sdlc/files/_common/scripts/e2e-release-gate.sh resolve` (reads the recorded tier; kept in a script because the workflow's run block is near GitHub's size limit).
- **Given** a pull-request run whose metadata carries `tier` of `smoke`, `critical` or `full` **Then** compliance-evidence uses it: labels `E2E Smoke (pre-merge)`, `E2E Critical (pre-merge)`, `E2E Full (pre-merge)`, all `required`. **Given** no recorded tier **Then** the event mapping applies (pull request is critical). **Given** a `deployment_status` run **Then** it is still `regression` at stage 5 in production, `E2E Regression (post-deploy production)`, not required, which the portal exempts by stage and environment. **Given** a `schedule` run **Then** compliance-evidence logs that it is preserved as GitHub historical CI and uploads nothing.
- **Fixtures/env:** `cli/test/release-gate.test.ts` "tier recording, labels and the release check"; `sdlc/files/_common/scripts/e2e-release-gate.test.sh` (21 assertions).

#### REQ-FRAMEWORK-RELGATE-003 — A configured gate is reported to the portal (#1059)

- **Priority:** Should — a setting nothing checks can be ignored; the portal can only require the gate if it is told the gate and sees a check for it.
- **Source:** `sdlc/files/ci/check-release-approval.yml.template` ("Link PR to release": `releaseGateTier`; trigger on `{{RELEASE_BRANCH}}`); `sdlc/files/_common/scripts/e2e-release-gate.sh report` (the `e2e-release-gate` check, called from `compliance-evidence.yml.template`).
- **Given** a release PR is opened, updated or reopened **Then** the release-PR PATCH body carries `prInfo.headSha`, the pull request's head commit (`github.event.pull_request.head.sha`, never the synthetic merge commit), so the portal can compare it with the gate check's `commit_sha` and treat a gate that ran on another commit as stale (#1074). **Given** `release_gate_tier` is configured **Then** the PATCH body also carries `releaseGateTier`, and each pull-request run reports one release check with the stable key `e2e-release-gate`, label `E2E Release Gate (<tier>)`, `required: true` and details holding the tier and the head SHA. **Given** it is not configured **Then** neither the field nor the check is sent. An older portal ignores the field; the portal is deployed first (metasession-dev/devaudit#910).
- **Fixtures/env:** `cli/test/release-gate.test.ts`.

#### REQ-FRAMEWORK-TIERS-001 — Test tier commands and `run-test-tier.sh` (#1060)

- **Priority:** Should — the smoke/critical/full model existed only as Playwright projects, so a project on another runner could not name a fast gate, a stronger pre-release gate and a full pack.
- **Source:** `sdlc/files/_common/scripts/run-test-tier.sh`; `cli/src/lib/repo-config-keys.ts` (`test_tier_smoke`, `test_tier_critical`, `test_tier_full`, `test_feature_command`, `test_runner`); `cli/src/update/ci-templates.ts` (`buildE2eTestStep`, `buildFeatureE2eTestStep`, `buildE2eRegressionTierCommand`, token `E2E_REGRESSION_TIER_COMMAND`).
- **Preconditions / inputs:** zero or more of the five keys in `sdlc-config.json`.
- **Given** none of the tier keys is set (blank counts as unset) **When** the workflows render **Then** they are identical to the previous output: inline `npx playwright test` commands and no reference to the script. **Given** `test_tier_smoke` **Then** the `ci.yml` E2E step runs `run-test-tier.sh smoke`; **given** `test_feature_command` **Then** `feature-e2e.yml` runs `run-test-tier.sh feature "$REQ_ID"`; **given** `test_tier_critical` or `test_tier_full` **Then** only the unscoped command of the `e2e-regression.yml` test step becomes `run-test-tier.sh full|critical` (the hook script, scoped dispatch, timeout and outcome handling stay). **Given** the script runs **Then** it runs the tier's key when set, else the `test_runner` default (playwright, or pytest with `--junit-xml`), replaces `{REQ}` (accepting only `[A-Za-z0-9._-]`), and exits with the command's exit code.
- **Error paths:** exit 2 on an unknown tier, a missing or unsafe requirement id for the feature scope, or an unknown `test_runner`. The pytest feature default runs the test files under `tests/` that mention the id (exact-id match, sorted in the C locale) because `pytest -k` cannot see docstrings or comments; no matching file exits 5 rather than running the whole suite. `devaudit configure set` rejects a tier command that is empty, multi-line or over 500 characters, a `test_feature_command` without `{REQ}`, and a `test_runner` other than `playwright`/`pytest`.
- **Fixtures/env:** `sdlc/files/_common/scripts/run-test-tier.test.sh` (23 assertions); `cli/test/test-tiers.test.ts`.

#### REQ-FRAMEWORK-TIERS-002 — `test_runner: pytest` selects pytest tier workflows (#1060)

- **Priority:** Should — python projects without Playwright could not get a feature-scoped run, a stronger pre-release gate or a full pack. The stack default cannot change (python projects already receive the Node workflows), so this is opt-in.
- **Source:** `sdlc/files/ci/runners/pytest/feature-e2e.yml.template`, `sdlc/files/ci/runners/pytest/e2e-regression.yml.template`; `cli/src/update/ci-templates.ts` (`PYTEST_RUNNER_TEMPLATES`, `buildFeatureE2eTestStep`, `buildE2eXmlReqFallback`, `buildE2eXmlResultUpload`, token `PYTEST_PYTHON_VERSION`); `sdlc/files/ci/compliance-evidence.yml.template`.
- **Preconditions / inputs:** `test_runner: pytest` in `sdlc-config.json` (any stack); `e2e_regression_enabled` for the regression workflow.
- **Given** `test_runner: pytest` **When** the workflows render **Then** `feature-e2e.yml` and `e2e-regression.yml` come from `runners/pytest/`: `actions/setup-python`, a pip install, `run-test-tier.sh feature|critical|full`, JUnit XML (`feature-e2e-results.xml`, `e2e-regression-results.xml`) uploaded as `e2e_result`; the workflow name `E2E Regression`, job `E2E Regression Suite`, artifact `e2e-regression-report`, triggers, execution lifecycle and metadata file are those of the Playwright workflows, so the portal labels and triage are unchanged. **Given** `compliance-evidence.yml` runs for such a project **Then** it derives requirements from the XML when no pending ticket names them and uploads `e2e-regression-results.xml` as `e2e_result` when there is no Playwright JSON. **Given** `test_runner` is absent or `playwright` **Then** every workflow, including `compliance-evidence.yml`, is unchanged.
- **Error paths:** a feature run with no `feature-e2e-results.xml` fails the upload step; a regression timeout is recorded as `timed_out` in the metadata, as for Playwright.
- **Fixtures/env:** `cli/test/test-tiers.test.ts` "test_runner pytest selects the pytest tier workflows"; `cli/test/workflow-run-syntax.test.ts` (`bash -n` on both stacks with `test_runner: pytest`).

#### REQ-FRAMEWORK-TIERS-003 — `feature-e2e.yml` triggers on the integration branch (#1060)

- **Priority:** Should — the trigger hardcoded `branches: [develop]` and the base-ref fallback `'develop'`, so a project with another `integration_branch` never ran the in-scope E2E.
- **Source:** `sdlc/files/ci/feature-e2e.yml.template` (`{{INTEGRATION_BRANCH}}`).
- **Given** `integration_branch` is unset **Then** the rendered trigger is `branches: [develop]`, unchanged. **Given** `integration_branch: next` **Then** it is `branches: [next]` and the base-ref fallback is `'next'`.
- **Fixtures/env:** `cli/test/test-tiers.test.ts` "feature-e2e.yml triggers on the integration branch".

---

#### REQ-CLI-DOCTOR-022 — `devaudit doctor` reports the credentials this machine holds (`credentials`) (#1099)

- **Priority:** Should — the credential model (uploader key CI-only; per-person viewer key; PAT never used by agents) is only real if a misplaced credential is visible.
- **Source:** `cli/src/lib/credentials-check.ts` (`buildCredentialsReport`, `credentialsCheck`), wired in `cli/src/commands/doctor.ts` (`checkCredentials`).
- **Given** `DEVAUDIT_API_KEY` set in the environment, in a repo-root `.env` / `.env.local`, or as a literal (or a `dak_` key) in a tracked file **Then** the uploader entry is `warn` and names each place, never the value, with a tier C `remove-local-uploader-key` proposal. **Given** a viewer key (env, else `.env`) **Then** `GET /api/ci/releases/resolve?projectSlug=<slug>&versionPrefix=REQ-` classifies it: 200 ok (`warn` when found only in `.env`), 401 invalid, 403 belongs to another project, 404 unknown project slug; a missing or invalid viewer key gets a tier B `issue-viewer-key` proposal (REQ-CLI-DOCTOR-010: interactive terminal, typed reason, confirmation; issues `viewer:<email>:<hostname>` with the person's PAT, saves it, and replaces a live key of that name only after a second confirmation), and a legacy `.env` key gets a tier A `move-viewer-key` proposal (saved to `viewer-keys.json`, its `.env` line removed, idempotent); the uploader-key and PAT findings stay tier C. **Given** a PAT **Then** it is validated (`GET /api/projects`, this project in the list) only at an interactive terminal; a non-interactive run reports `not-checked` and never sends it. An accepted PAT's expiry is read from `GET /api/auth/token` (metasession-dev/devaudit#922; `expires_at` top-level or under `token`): within `DEVAUDIT_PAT_EXPIRY_WARN_DAYS` (a positive whole number, default 14) days it is `warn` with a tier C `renew-pat` proposal ("before it expires"), past it is `invalid`, no expiry is `ok` ("expiry: none set"), and a 404, redirect, timeout or other status leaves "expiry: not available"; `expiresAt` carries the timestamp.
- **Error paths:** every portal call times out after 5 s and is skipped without its credential; a timeout, network error or unexpected status is `not-checked`, never a failure. No output, `--json` included, contains a credential value. `--json` carries `credentials: { uploaderKey, viewerKey, pat }` on the `credentials` onboarding entry. The `secrets` check no longer requires a viewer-key repo secret and reports an existing one as unused and removable (tier C).
- **Fixtures/env:** `cli/test/credentials-check.test.ts` (injected probes, no network), `cli/test/doctor.test.ts` (check count, `secrets` with a fake `gh`).

---

#### REQ-CLI-DOCTOR-023 — A read-only Credentials block follows `update`, `install` and `join` (#1099)

- **Priority:** Should — the moment a person is touching their setup is when a stray uploader key or missing viewer key is cheapest to fix.
- **Source:** `cli/src/lib/credentials-check.ts` (`credentialsBlockFor`, `printCredentialsBlock`), called from `cli/src/commands/update.ts`, `install.ts`, `join.ts`.
- **Given** a successful `update`, `install` or `join` (not `--dry-run`) outside CI **Then** one `Credentials:` heading is printed with the result of the REQ-CLI-DOCTOR-022 check, one line per project for a multi-path `update`, repo roots shared by several paths once. **Given** `CI` or `GITHUB_ACTIONS` is set **Then** nothing is printed. The block makes no portal write, asks nothing and never changes the exit code.
- **Error paths:** a path that is not a consumer project, or any unexpected error, prints nothing.
- **Fixtures/env:** `cli/test/credentials-check.test.ts`.

---

#### REQ-CLI-DOCTOR-024 — `test-tiers` reports acceptance-criterion coverage (#1096)

- **Priority:** Should — the portal marks an AC "tested" only from a tagged Playwright result, and nothing told the operator before approval which ACs had none.
- **Source:** `cli/src/lib/ac-coverage.ts` (`planAcs`, `parsePlaywrightList`, `preApprovalProjects`, `acCoverageForReq`, `activeRtmReqs`), called from `cli/src/commands/doctor-tiers.ts` (`testTiersCheck`) and, for the Phase 4 handoff, from `sdlc-implementer` Phase 4 step 5b via `devaudit doctor --json`.
- **Given** a Playwright project and RTM requirements not `RELEASED` / `APPROVED - DEPLOYED` that have an `implementation-plan.md` (`compliance/plans/` first, then `compliance/evidence/`) **Then** each `AC<n>` row of its `## 1. Goal + acceptance criteria` table (rows with `@e2e-deferred` skipped) is `covered` when a test whose full title (describes included) contains `REQ-x` and `AC<n>` as exact tokens exists in `playwright test --list --reporter=json` (one listing, all projects); `screenshot-but-no-test` when only `compliance/evidence/<REQ>/screenshots/<REQ>-AC<n>-*.png` exists; `no-test` when neither; `covered, not re-run on the release PR` (information, a note not a finding) when every covering test is outside the smoke (`e2e_project`) and release-gate projects (mapped from `release_gate_tier` as `buildE2eRegressionSelectCases` does). `REQ-11` does not cover `REQ-111`; `tagTest()` annotations are not used (they are not in `--list` output).
- **Error paths:** unreadable listing → "AC coverage not checked"; non-Playwright runner → "not checked (runner: <name>)"; no plan or no ACs → nothing to check. Findings are tier C guidance (REQ-CLI-DOCTOR-010 never applies them), `doctor`'s exit code is unchanged, and `--json` carries `acCoverage` on the `test-tiers` entry. No portal call, no PAT, no network.
- **Fixtures/env:** `cli/test/ac-coverage.test.ts` (the issue's fixtures with a fake `--list` runner).

---

#### REQ-CLI-DOCTOR-025 — `doctor` reports whether the recommended agent permission rules are present (`agent-permissions`) (#1098)

- **Priority:** Could — layer 4 of the credential model (docs/credentials.md) is recommended, not required, and the installer never writes a user's agent settings; the check only makes its absence visible.
- **Source:** `cli/src/lib/agent-permissions.ts` (`claudeCodeDenyRules`, `claudeCodeSettingsSnippet`, `agentPermissionsReport`), `cli/src/commands/doctor.ts` (`checkAgentPermissions`); the rules and their limits are in `docs/agent-permissions.md`, whose snippet a test keeps equal to the code.
- **Given** a consumer project **Then** `doctor` reads `.claude/settings.json`, `.claude/settings.local.json` and `~/.claude/settings.json` (the union of their `permissions.deny` arrays) and reports, with `ok: true` always: all recommended rules present; or how many are present and which group is missing (`pat-commands`: `devaudit` / `npx ...devaudit-cli` `install`, `join`, `uninstall`, `auth`, `doctor --fix`, `doctor --fleet`, also with global flags first; `credential-store`: `Read` on the DevAudit config folder for Linux, macOS and Windows); or that no Claude Code settings file was found. Other agents are reported as "not checked". A missing group adds a tier C `add-agent-permission-rules` finding that points at the documentation.
- **Error paths:** an unreadable or unparsable settings file counts as having no rules and never fails the run. The check writes nothing, ever.
- **Fixtures/env:** `cli/test/agent-permissions.test.ts` (rules, report, docs equality) and `cli/test/doctor.test.ts` (the real binary against a temporary home). `scripts/agent-permissions-smoke.sh` (manual, starts headless `claude -p` sessions) proved on Claude Code 2.1.311 that all 8 PAT commands and both credential-store reads are refused with broad allow rules in force, and that `devaudit doctor --json`, `release status` and a project file still run.

---

#### REQ-CLI-RELEASE-001 — `devaudit release check` confirms a release is ready to submit for UAT review (#1099)

- **Priority:** Must — submitting for UAT review, recording UAT and approving are distinct audit events done by a person in the portal; this is the read-only gate before the first of them (replaces the retired `submit-for-uat-review.sh` readiness checks and `record-uat-execution.sh`, formerly REQ-FRAMEWORK-UAT-001).
- **Source:** `cli/src/commands/release-check.ts` (`runReleaseChecks`, `runReleaseCheck`), registered in `cli/src/index.ts`.
- **Preconditions / inputs:** `devaudit release check [<REQ-or-version>] [--json]` inside a consumer project (`sdlc-config.json`). With no argument the single non-deferred ticket in `compliance/pending-releases/` is used.
- **Given** a clean working tree, local integration branch equal to its remote, every workflow run for that head green, `compliance/pending-releases/RELEASE-TICKET-<REQ>.md` present and the portal release `draft` (read with the viewer key) **Then** each check prints `✓`, the command prints the next step (click **Submit for UAT review** in the portal) and exits `0`. **Given** the portal release is already `uat_review`, `uat_approved`, `uat_rejected` or `released` **Then** the portal check passes as "already submitted". **Given** any check fails **Then** it prints `✗` with its fix and the command exits `1`; `--json` prints `{ ready, version, results[{ name, ok, detail, fix? }] }`.
- **Error paths:** not a consumer project → exit `2`; several pending tickets and no argument → the ticket check fails and names them; no viewer key, unreadable portal, `deferred` or missing portal release → the portal check fails with its fix. The command makes no portal write and never reads or sends the personal access token.
- **Fixtures/env:** `cli/test/release-check.test.ts` (injected command runners and portal lookup; no network).

---

#### REQ-CLI-AUTH-008 — Per-person viewer keys: `viewer-keys.json`, lookup order, `auth viewer-key set` (#1099)

- **Priority:** Should — a viewer key is read-only and personal, so it lives with the person (CLI config folder), never in the repository or a repo secret.
- **Source:** `cli/src/lib/viewer-keys.ts`, `cli/src/lib/paths.ts` (`VIEWER_KEYS_FILE`), `cli/src/lib/releases-api.ts` (`resolvePortalReadKey`), `cli/src/commands/auth/viewer-key.ts`, `cli/src/commands/auth/status.ts`.
- **Storage:** `~/.config/devaudit/viewer-keys.json` (the folder of `auth.json`), mode `0600`, written to a temporary file and renamed, shape `{ "<baseUrl>": { "<projectSlug>": { "key", "name", "createdAt" } } }`. A missing or corrupt file reads as empty. The CLI never writes `.env`.
- **Lookup (everywhere the CLI reads the key):** `DEVAUDIT_VIEWER_API_KEY` in the environment, then the file for this base URL and project, then the repo-root `.env` (legacy, read-only). `DEVAUDIT_API_KEY` is never a fallback.
- **Given** `devaudit auth viewer-key set [--project <slug>]` at an interactive terminal **Then** the key is read at a masked prompt (never argv, history or output) and saved for the project and base URL of `sdlc-config.json` (or `--project`). **Given** no terminal, no project, or a cancelled prompt **Then** nothing is saved (exit `2`, `2`, `1`).
- **Fixtures/env:** `cli/test/viewer-keys.test.ts`.

---

#### REQ-CLI-RELEASE-002 — `devaudit release status` reads a release with the viewer key (#1099)

- **Priority:** Should — gives people and agents one supported, read-only way to see portal release state without a raw `curl` or the uploader key.
- **Source:** `cli/src/commands/release-status.ts` (`getReleaseStatus`, `runReleaseStatus`), registered in `cli/src/index.ts`.
- **Given** `devaudit release status [<REQ-or-version>] [--json]` with a viewer key **Then** it resolves the release (`GET /api/ci/releases/resolve`) and reads its required checks (`GET /api/ci/releases/{id}/checks`) and test executions (`GET /api/ci/releases/{id}/cycles`), all read-only with the viewer key. `--json` prints `{ ok, project, version, releaseId, status, url, deferred?, checks, executions }`; `checks`/`executions` are what the portal returned, or `null` when they could not be read (the status is still reported). With no argument the single non-deferred pending ticket is used.
- **Error paths:** no consumer project or ambiguous ticket → exit `2`; no viewer key → `3`; portal unreadable → `4`; no portal release → `5`. It never reads the PAT or the uploader key.
- **Fixtures/env:** `cli/test/release-status.test.ts`.

#### REQ-CLI-RELEASE-003 — Six published packages; `core` is published before the cli and has a manual prerelease (#1129)

- **Priority:** Should — the guided-onboarding work (DevAudit-Installer#1116) puts logic shared by the CLI and the portal in one package, so a release now has six packages, and the portal can build on `core` before the release that first publishes it.
- **Source:** `core/` (`package.json`, `src/index.ts`, `src/node/index.ts`), `.github/workflows/release.yml` (`publish` and `core-prerelease` jobs), `.github/workflows/cli.yml`, `scripts/check-package-contents.sh`, `scripts/release-validation.sh`, `docs/devaudit-release-procedure.md`.
- **Given** a `v<major>.<minor>.<patch>` tag push, or a manual run with `mode: release` and a `version` **Then** `release.yml` publishes `plugin-sdk`, then `@metasession.co/devaudit-core` (built and tested first, verified publicly installable), then rewrites `file:../plugin-sdk` and, in the cli only, `file:../core` to `^X.Y.Z`, then publishes `cli`, the two plugins and `sdlc`, and creates the GitHub Release only after every package is verified. A manual `mode: release` without a `version` fails before publishing anything.
- **Given** a manual run with `mode: core-prerelease` **Then** it runs only from `develop` (any other ref fails before building), sets `<cli version>-next.<7-character commit sha>` as `core`'s version in the build only, builds and tests `core`, publishes **only** that package with `npm publish --provenance --access public --tag next`, and verifies it. It publishes no other package, never moves the `latest` tag, and creates no git tag and no GitHub Release. `core` has one Trusted Publisher, so this job lives in `release.yml`.
- **Given** `scripts/check-package-contents.sh` **Then** `core` is one of the default packages, and every string under a package's `exports` (including `core`'s `./node` entry) must be in its tarball. `core`'s tarball holds only `dist/`, `README.md`, `LICENSE` and `package.json`. `scripts/release-validation.sh` builds, version-checks (`versions-aligned`, six packages) and packs `core`, and points the packed cli at the packed `core` and `plugin-sdk` tarballs.
- **Error paths:** the prerelease from a branch other than `develop`: the run fails with "The core prerelease runs only from develop"; a version already on npm is skipped (resumable).
- **Fixtures/env:** `cli/test/release-lifecycle-workflows.test.ts` ("`@metasession.co/devaudit-core` in the release"), `scripts/check-package-contents.test.sh`, `core/test/core.test.ts`.

---

#### REQ-FRAMEWORK-BUNDLE-001 — A declared bundle is ONE portal release: member evidence is filed under the core's release (#955)

- **Priority:** Must — the intended model since #736/#817/#884 is one release with one UAT approval per `Bundles: #A, #B` declaration. Filing a member's evidence against a release named after the member created one orphan portal release per member (`REQ-036`, `REQ-037`, `REQ-038` for the consumer bundle, `REQ-035` core); the portal treats a member as a separate sibling release that must itself reach UAT approval before the core can proceed (`co_tracked_sibling_not_ready`), and nothing ever submits those releases, so the bundle could never be approved.
- **Source:** `sdlc/files/_common/scripts/resolve-bundle-release.sh`; `sdlc/files/ci/ci.yml.template` (SAST/dependency-audit fan-out, E2E fan-out, per-AC screenshot upload); `sdlc/files/_common/scripts/upload-compliance-documents.sh` (release-ticket upload loop, per-REQ evidence loop); `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 1 step 3 bundle mode).
- **Preconditions / inputs:** A committed declared-bundle manifest `compliance/pending-releases/BUNDLED-CHANGES-<core>.{md,json}` (REQ-FRAMEWORK-CIYML-016) whose core ticket is not archived, naming the member REQ with `role: "co_tracked"`.
- **Given** an upload for a declared-bundle member `REQ-M` **When** it runs from the CI templates or `upload-compliance-documents.sh` **Then** the positional requirement id is `REQ-M` (so the evidence row is attributable to the member's own requirement and the portal records `REQ-M` as a requirement of the release) and `--release` is the **core** returned by `resolve-bundle-release.sh REQ-M`, never `REQ-M`. **Given** a member **Then** its `--release-title`/`--release-summary`/`--change-type` metadata is not sent (those describe the core's own release row). **Given** a REQ that is not a member (the core itself, a predecessor, an unrelated pending REQ, a bare-date version, `_compliance-docs`) **Then** behaviour is unchanged. **Given** `sdlc-implementer` bundle mode **Then** only the primary REQ creates the portal release and every other bundled REQ files its Stage 1 evidence under it (SKILL.md Phase 1 step 3), matching what CI now does.
- **Given** the resolver fails (REQ-FRAMEWORK-BUNDLE-002 exit 3) **When** `upload-compliance-documents.sh` runs **Then** that upload is skipped with a `::warning::` rather than filed against the wrong release; in `ci.yml.template` (bash `-e`) the step fails visibly.
- **Not covered, by design:** `feature-e2e.yml.template` is single-REQ (it resolves one REQ from the commit range or branch name and skips a multi-REQ bundle PR), and, since #995, the Python `ci.yml.template` handles a declared bundle (REQ-FRAMEWORK-BUNDLE-009).
- **Error paths:** A member listed in two live bundles is a genuine conflict (REQ-FRAMEWORK-BUNDLE-002).
- **Fixtures/env:** `cli/test/req-bundling.test.ts` "declared bundle = one portal release (#955)" (source assertions on every call site) and `cli/test/release-lifecycle-workflows.test.ts` (fan-out no longer uses `--release ${MEMBER_REQ}`); pre-release validation against a clone of the consumer consumer.

#### REQ-FRAMEWORK-BUNDLE-002 — `resolve-bundle-release.sh` maps a co_tracked member to its live bundle's core (#955)

- **Priority:** Should — the single decision point every call site shares.
- **Source:** `sdlc/files/_common/scripts/resolve-bundle-release.sh`; tested by `sdlc/files/_common/scripts/resolve-bundle-release.test.sh` (13 assertions). Synced to consumers' `scripts/` automatically (every `_common/scripts/*.sh`).
- **Preconditions / inputs:** `resolve-bundle-release.sh <REQ-XXX>`, run from the repo root; `jq` optional (markdown fallback).
- **Given** `<REQ-XXX>` is a `co_tracked` member of a `compliance/pending-releases/BUNDLED-CHANGES-<core>.json` **Then** it prints `<core>`. **Given** the JSON is absent **Then** it falls back to the markdown member list (`` `REQ-M` (co-tracked/bundled) ``). **Given** the core is `<REQ-XXX>` itself, a predecessor, an unrelated REQ, no `pending-releases/` directory, a non-`REQ-` argument (`_compliance-docs`, `vYYYY.MM.DD`) **Then** it prints the argument unchanged. **Given** the core's own ticket is already in `approved-releases/` or `superseded-releases/` **Then** that manifest is stale and ignored (same guard as `derive-release-version.sh` step 0, #838).
- **Error paths:** exit 1 on a missing argument; exit 3 when `<REQ-XXX>` is a `co_tracked` member of more than one live bundle (never guesses).
- **Fixtures/env:** the 13 assertions above.

#### REQ-FRAMEWORK-BUNDLE-003 — The bundle manifest is submitted without co_tracked members; manifestHash recomputed (#220, #622, #955)

- **Priority:** Must — a submitted `co_tracked` member is ingested by the portal as a membership of a separate sibling release (which must exist: `Referenced release not found`), is refused by the production database's `chk_bundle_membership_*` constraints (HTTP 400, metasession-dev/devaudit#885), and would block the core's approval even when accepted. `co_tracked` is a local declaration only.
- **Source:** `sdlc/files/_common/scripts/submit-bundle-manifest.sh`; `sdlc/files/ci/ci.yml.template` ("Generate and upload bundled changes" step: generates `BUNDLED-CHANGES-${VERSION}.{md,json}` from `$SINCE_REF`, submits it, then uploads the markdown as `bundled_changes` evidence).
- **Preconditions / inputs:** `submit-bundle-manifest.sh <project-slug> <release-version> <manifest-path> [--reconcile-existing-ownership]`; `schemaVersion` 1 or 2.
- **Given** a manifest with at least one `role == "co_tracked"` member **When** it is submitted **Then** the POST body has those members removed, and for `schemaVersion 2` `manifestHash` is recomputed over the stripped payload with the generator's own recipe (canonical sorted-key JSON minus `generator.generatedAt`, sha256), which equals the portal's `hashCanonicalBundleManifest`; predecessors, housekeeping members and `nonReleaseWorkItems` are submitted unchanged. The committed manifest file is never modified. **Given** nothing remains (no members and no work items) **Then** submission is skipped with exit 0 (`Bundle manifest has no members or non-release work items; skipping submission.`). **Given** a manifest with no `co_tracked` member **Then** the file is submitted byte-for-byte as before.
- **Error paths:** unchanged: missing env/manifest/`jq`, unsupported `schemaVersion`, unresolvable release, non-201 response.
- **Fixtures/env:** `submit-bundle-manifest.test.sh` (11 assertions; the hash is cross-checked against an independent Node reimplementation of the portal's canonicalisation) and `tests/scripts/submit-bundle-manifest.test.ts`.

#### REQ-FRAMEWORK-BUNDLE-004 — Close-out releases declared-bundle members with the core and still supersedes predecessors (#955)

- **Priority:** Should — members have no portal release of their own to wait on; left in `pending-releases/` their tickets re-enter the ambiguity guard (REQ-FRAMEWORK-BUNDLE-005) on every later release and their RTM rows stay `TESTED - PENDING SIGN-OFF`.
- **Source:** `sdlc/files/_common/scripts/close-out-release.sh` (`mark_ticket_released_with_bundle`, called from the bundle-manifest reconciliation block; predecessors still use `mark_ticket_superseded`); `sdlc/files/_common/scripts/close-out-release.test.sh`.
- **Preconditions / inputs:** `close-out-release.sh <core-REQ> [--release-pr <url-or-number>]` after the portal reports the core `released`; a manifest for the core in `pending-releases/`, `approved-releases/` or `superseded-releases/`.
- **Given** a `co_tracked` member **Then** its ticket moves to `compliance/approved-releases/`, `**Status:**` becomes `RELEASED`, `**Release PR:**` is recorded when given, a `**Released with bundle:** <core> (closed out <date>)` line is added once, and its RTM row becomes `RELEASED`. **Given** the member's ticket is already in `approved-releases/` **Then** status and backlink are re-asserted without duplication (idempotent). **Given** it is already in `superseded-releases/` **Then** it is left alone. **Given** no ticket **Then** a warning. **Given** predecessor members (`superseded`/`absorbed`) **Then** behaviour is unchanged (`mark_ticket_superseded`: ticket to `superseded-releases/`, Status `SUPERSEDED`, RTM `SUPERSEDED`). The workflow that invokes this script is REQ-FRAMEWORK-VALIDATION-005; the daily catch-up is REQ-FRAMEWORK-VALIDATION-006.
- **Error paths:** none new; a missing member ticket warns and continues.
- **Fixtures/env:** `close-out-release.test.sh` bundle case (45 assertions in the file): members moved/RELEASED/backlinked/RTM-flipped, predecessor still superseded, second run idempotent.

#### REQ-FRAMEWORK-BUNDLE-005 — The predecessor-ownership guard accounts for declared members (#746, #952, #953)

- **Priority:** Should — without it a bundle whose members each have a release ticket (the compliance validator requires one per REQ) and whose core ticket also names an absorbed predecessor fails `Register Release` with "ambiguous predecessor ownership" (a consumer run 37184402791).
- **Source:** `sdlc/files/_common/scripts/generate-bundled-changes.sh` (candidate list, `PREDECESSORS_FIELD_PRESENT`, `UNACCOUNTED`); `sdlc/files/_common/scripts/generate-bundled-changes.test.sh`; `tests/scripts/generate-bundled-changes.test.ts`.
- **Preconditions / inputs:** a REQ-tracked version, `compliance/pending-releases/` present, `--declared-bundle` optionally given.
- **Given** pending tickets other than the core's **Then** each is a candidate predecessor, except versions named in `--declared-bundle` (they are emitted as `co_tracked`). **Given** candidates exist and the core ticket omits the `**Absorbed predecessor releases:**` field **Then** exit 1 `ambiguous predecessor ownership` (#746: omitted differs from an explicit `None`). **Given** an explicit `None` **Then** all candidates are accounted for. **Given** the field names at least one real predecessor **Then** every other candidate must also be listed or declared, else exit 1 listing the unaccounted versions. **Given** a ticketed member that is neither declared nor listed **Then** still exit 1.
- **Error paths:** exit 1 as above; self-supersede, duplicate and missing-ticket predecessor errors unchanged.
- **Fixtures/env:** `generate-bundled-changes.test.sh` (45 assertions) and `tests/scripts/generate-bundled-changes.test.ts` (3 cases added by #953).

#### REQ-FRAMEWORK-BUNDLE-006 — The `Release intent` ticket field is optional and validated (#955)

- **Priority:** Should — the deferral decision must live in the repo, not only in a closed PR (REQ-034 in a consumer). Designed so #956 (doctor, RTM `DEFERRED`, promotion gate) can build on it.
- **Source:** `sdlc/src/blueprints/3-compile-evidence.raw.md` (release-ticket template documents the field in an optional comment block); `sdlc/files/_common/scripts/validate-compliance-artifacts.sh`; `validate-compliance-artifacts.test.sh` cases 16-18.
- **Preconditions / inputs:** a release ticket (pending, approved or superseded) for a REQ in the validated range.
- **Given** the ticket has no `- **Release intent:**` line **Then** no declared intent and no validator output. **Given** `- **Release intent:** deferred-to-next — <reason, PR #N closed unmerged>` (em/en dash, `-` or `--` accepted before a non-empty reason) **Then** `OK: Release intent is well-formed`. **Given** any other value (unknown intent, missing reason) **Then** `ERROR` and exit 1.
- **Error paths:** malformed value → validator exit 1.
- **Fixtures/env:** `validate-compliance-artifacts.test.sh`; `cli/test/req-bundling.test.ts`.

#### REQ-FRAMEWORK-BUNDLE-007 — Deferred REQs are never absorbed silently (#955)

- **Priority:** Should — otherwise a deferred REQ's code ships under another release's approval with no lineage and its ticket stays pending forever.
- **Source:** `sdlc/files/_common/scripts/generate-bundled-changes.sh` (`extract_release_intent`, `req_has_commits_in_range`); `generate-bundled-changes.test.sh` tests 10-14.
- **Preconditions / inputs:** a REQ-tracked version with other pending tickets (candidates not named in `--declared-bundle`).
- **Given** a candidate ticket carries `Release intent: deferred-to-next` and the core ticket's `Absorbed predecessor releases` says `None` or omits the field **Then** exit 1 naming the candidate ticket and telling the author to list it under "Absorbed predecessor releases". **Given** the core field says `None` and a candidate's `[REQ-x]` / `Ref: REQ-x` commits appear in `SINCE..HEAD` **Then** exit 1 likewise. **Given** the candidate is listed **Then** it is emitted as a predecessor. **Given** no intent and no commits in range **Then** behaviour is unchanged (REQ-FRAMEWORK-BUNDLE-005). Declared-bundle members are never candidates.
- **Error paths:** exit 1 as above.
- **Fixtures/env:** fixture git repos in `generate-bundled-changes.test.sh`.

#### REQ-FRAMEWORK-BUNDLE-008 — Closing a PR without releasing is a documented procedure; bundle mode no longer rejects `stack: python` (#955, #995)

- **Priority:** Should — a release PR that is closed unmerged must park its REQ visibly, and (before #995) a declared bundle on the Python template silently did nothing.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 1 step 4 "Python parity"; "Closing a release PR without releasing"), `references/change-request-loop.md`, `docs/change-workflows.md`.
- **Given** a release PR closed unmerged **Then** the skill sets the Release intent field, keeps the RTM row, comments on the PR and leaves the portal release as is (superseded at the absorbing release's close-out). **Given** a declared bundle and `stack: python` **Then** the skill proceeds (the former "Node-template-only" stop was removed by #995; see REQ-FRAMEWORK-BUNDLE-009 for what the Python template does).
- **Error paths:** none.
- **Fixtures/env:** text-pinning tests in `cli/test/req-bundling.test.ts` (the Python rejection is asserted absent).

#### REQ-FRAMEWORK-BUNDLE-009 — Declared-bundle parity in the Python CI template (#995)

- **Priority:** Should — two active consumers are Python (example-api, example-monorepo); a declared bundle had no Python path.
- **Source:** `sdlc/files/ci/python/ci.yml.template` (`register-release`: "Determine release version" sets `bundle_core`; "Generate and upload bundled changes (declared bundle)"; `upload-evidence`: per-REQ loop appends `--release` from `resolve-bundle-release.sh` for a member); `sdlc/files/_common/scripts/derive-release-version.sh` (`DEVAUDIT_DERIVE_BUNDLE_ONLY=1` stops after step 0); `scripts/release-validation.sh` (`python-bundle-parity` on the Python fixture).
- **Given** a live declared bundle (exactly one `compliance/pending-releases/BUNDLED-CHANGES-REQ-*.md` with a "Co-Tracked Bundle Members" section whose ticket is not archived) **When** the Python `register-release` job runs **Then** the version is the bundle's core REQ (output `bundle_core`), the manifest is regenerated preserving the `co_tracked` members, the core release is created if missing, the manifest is submitted with `submit-bundle-manifest.sh` and `bundled_changes` evidence uploaded. **Given** a member REQ in the per-REQ evidence loop **Then** its artifacts are filed against the core release (the member stays the requirement tag); a non-member keeps this run's release. **Given** no declared bundle (or a stale one) **Then** the date-based release model is unchanged. Member close-out is the shared `close-out-release.sh` (REQ-FRAMEWORK-BUNDLE-004), identical for both stacks.
- **Limit:** the Python template still registers a date release per run for ordinary work (it does not use `derive-release-version.sh` for that), so the Node template's per-commit REQ derivation is not part of this parity.
- **Fixtures/env:** `cli/test/python-bundle-parity.test.ts` (runs the rendered "Determine release version" against a mock portal with and without a bundle, and with a stale one; pins the bundle step and the member fan-out); `derive-release-version.test.sh` (bundle-only mode).

---

#### REQ-FRAMEWORK-DEFERRAL-001 — RTM `DEFERRED` is a valid non-terminal status that derive/validate ignore (#956)

- **Priority:** Should — a release PR closed without releasing must park its REQ without blocking CI or hijacking the next release's version.
- **Source:** `validate-compliance-artifacts.sh` (RTM status branch + mismatch warning); `validate-commits.sh` (`ACTIVE_RELEASE_REQS`); `derive-release-version.sh` (`is_deferred_ticket`, steps 4 and 4-bis); tests `validate-compliance-artifacts.test.sh` cases 19-20, `validate-commits.test.sh` cases 16-17, `derive-release-version.test.sh` cases 19-21.
- **Preconditions / inputs:** a pending ticket with `- **Release intent:** deferred-to-next — <reason>` (the sole declaration of deferral; the ticket stays in `compliance/pending-releases/`) and/or an RTM row whose status is `DEFERRED`.
- **Given** an RTM row `DEFERRED` **Then** the validator prints `OK: RTM status is DEFERRED`, not the not-TESTED warning, and exits 0; if the ticket lacks the intent field it additionally warns of the mismatch (warning only). **Given** a deferred ticket **Then** `validate-commits.sh` does not count it as an active release and `derive-release-version.sh` step 4 does not treat it as the single in-flight ticket; step 4-bis drops an IN PROGRESS row whose ticket is deferred (DEFERRED rows never match IN PROGRESS). Steps 1-3 (commit-carried REQ tags) are unchanged.
- **Error paths:** none new.
- **Fixtures/env:** fixture git repos. Assumption: `close-out-*.sh`, the pre-push Phase-5 check and the CI terminal-directory skips need no change because deferred tickets stay in `pending-releases/` and `DEFERRED` contains no `RELEASED` word.

#### REQ-FRAMEWORK-DEFERRAL-002 — `list-reqs-in-range.sh` enumerates the REQs a range references (#956)

- **Priority:** Should — shared input for the promotion gate and the later `doctor` checks.
- **Source:** `sdlc/files/_common/scripts/list-reqs-in-range.sh`; `list-reqs-in-range.test.sh`.
- **Given** `[SINCE] [HEAD]` **Then** it prints each distinct `REQ-n` named by a bracketed subject tag or a `Ref: REQ-n` trailer, sorted. SINCE defaults to the last reachable tag, else the merge-base with `origin/main`/`main`. Prose mentions are ignored, `REQ-1` never matches `REQ-10`, commits with a `Release-Closeout:` marker are skipped. Unresolvable ref → exit 1.
- **Fixtures/env:** the lookup is a copy of the `derive-release-version.sh` / `generate-bundled-changes.sh` regex, not a refactor of them (low-risk choice).

#### REQ-FRAMEWORK-DEFERRAL-003 — Promotion gate for deferred REQs (#956)

- **Priority:** Should — otherwise a deferred REQ's commits on `develop` ship to production on another release's approval.
- **Source:** `check-deferred-reqs-in-range.sh`, invoked by `check-release-pr-scope.sh` for the `develop -> main` PR (step of the Release Scope Integrity job); tests `check-deferred-reqs-in-range.test.sh`.
- **Given** a REQ is deferred (ticket `Release intent: deferred-to-next` or RTM `DEFERRED`) and has commits in `origin/main..HEAD` **When** the release ticket being promoted does not list it under `Absorbed predecessor releases` **Then** the step fails naming the REQ and its ticket and telling the author to list it there or revert its commits. Listed → pass. No deferred REQs → pass as before. The release being promoted is never itself reported.
- **Error paths:** exit 1; missing script → exit 1 with a `devaudit update` hint. `Quality Gates` remains the only required status context.

#### REQ-FRAMEWORK-DEFERRAL-004 — Deferred portal status gets a specific approval-gate message (#956)

- **Priority:** Should — the generic "approval required" text hides that the release was parked.
- **Source:** `sdlc/files/ci/check-release-approval.yml.template` ("Enforce release approval").
- **Given** portal status `deferred` **Then** the step fails (exit 1) with a message saying the release is deferred and to resume it in the portal or promote its REQs through a successor release listing it as an absorbed predecessor. Other statuses keep the existing text.
- **Assumption:** the portal's `deferred` state (metasession-dev/devaudit#895) is merged but not deployed; until then the branch is unreachable and harmless.

#### REQ-FRAMEWORK-DEFERRAL-005 — Deferred tickets are skipped by the CI loops over `pending-releases/` (#956)

- **Priority:** Should — without it a deferred REQ whose code never reached `main` would be promoted, uploaded to and status-PATCHed (the defect recorded under `REQ-FRAMEWORK-POSTDEPLOY-002` in the 3a-3 changelog).
- **Source:** `sdlc/files/_common/scripts/is-deferred-ticket.sh` (same `Release intent: deferred-to-next` pattern as `derive-release-version.sh`/`generate-bundled-changes.sh`; parity asserted by its test); loops in `sdlc/files/ci/post-deploy-prod.yml.template`, `ci.yml.template` (E2E fan-out and per-REQ screenshots), `python/ci.yml.template`, `compliance-evidence.yml.template`, `_common/scripts/upload-compliance-documents.sh`, `periodic-review.yml.template`, `close-out-reconcile.yml.template` + `close-out-reconcile.sh`
- **Given** a pending ticket with `Release intent: deferred-to-next` **Then** each of those loops logs `Skipping <REQ>: deferred (Release intent: deferred-to-next)` and does not include it. **Given** every pending ticket is deferred **Then** `post-deploy-prod` says so and falls through to the existing "no tracked release ticket" path (standalone-housekeeping declaration or no portal promotion). `periodic-review` reports deferred tickets in their own row, not as pending. `close-out-reconcile` does not report a deferred ticket whose code is not on `origin/main`; if its commits ARE reachable from `origin/main` (silent absorption) it prints `REQ-x deferred`, the workflow does not trigger a close-out for it and lists it separately in the tracking issue.
- **Error paths:** a consumer without the helper (older sync) keeps the previous behaviour (`[ -f scripts/is-deferred-ticket.sh ] &&` guard); the helper syncs with the other `_common/scripts/*.sh`.
- **Fixtures/env:** `sdlc/files/_common/scripts/is-deferred-ticket.test.sh`, `close-out-reconcile.test.sh`; text-pinning assertions in `cli/test/release-lifecycle-workflows.test.ts`.

---

#### REQ-FRAMEWORK-EVIDENCE-001 — compliance-evidence.yml triggers on compliance pushes, and on E2E Regression completion only when opted in (#869)

- **Priority:** Must — the load-bearing push-early evidence path (sdlc-v1.22.0+).
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` (`on: push: branches:[develop] paths:['compliance/**']`, `workflow_dispatch`, `workflow_run: workflows:['E2E Regression'] types:[completed]`); `cli/src/lib/templates.ts` (`stripE2eRegressionListener`); `cli/src/update/ci-templates.ts` (`syncCiTemplates`: `if (tmpl === 'compliance-evidence.yml.template' && !cfg.e2e_regression_enabled) content = stripE2eRegressionListener(content)`).
- **Preconditions / inputs:** Rendered consumer; `sdlc-config.json.e2e_regression_enabled`. The `workflow_run` trigger and the `upload-e2e-regression-evidence` job are **conditionally present** (#869) — they only make sense when the consumer also generates `e2e-regression.yml` (REQ-FRAMEWORK-E2EREGRESSION-001).
- **Given** `e2e_regression_enabled` is unset/false **When** the template is rendered **Then** `stripE2eRegressionListener` removes the `  workflow_run:` block from `on:` (plus any `  #` comment lines immediately above it) **and** the entire `  upload-e2e-regression-evidence:` job (plus its immediately-preceding comment lines) through end of file — it assumes that job is the last one in the template. None of that job's content (REQ extraction script, incident filing, `[REGRESSION]` titles, nil-incident attestation upload) appears in the rendered file at all. **Given** `e2e_regression_enabled: true` **Then** both are kept, unchanged.
- **Given** the rendered `compliance-evidence.yml` **When** a develop push touches `compliance/**` (or manual dispatch) **Then** the `upload-compliance-evidence` job runs (gated `if: github.event_name != 'workflow_run'`); **When** (opted in only) the `E2E Regression` workflow completes **Then** only the `upload-e2e-regression-evidence` job runs (`if: github.event_name == 'workflow_run'`) — never both on one event (avoids double-upload, #149).
- **Error paths:** Concurrency group keyed on `${{ github.workflow }}-${{ github.ref }}-${{ github.event.workflow_run.id || '' }}` with cancel-in-progress.
- **Fixtures/env:** Rendered repo; a `compliance/**` push fixture and a `workflow_run` event fixture. update.test.ts "strips compliance-evidence.yml's dead E2E Regression workflow_run listener + job unless e2e_regression_enabled is set (#869)", "keeps compliance-evidence.yml's E2E Regression workflow_run listener + job when e2e_regression_enabled is true (#869)".

#### REQ-FRAMEWORK-EVIDENCE-002 — base URL resolution prefers sdlc-config.json with reachability pre-flight

- **Priority:** Must — destination misconfiguration must fail fast and visibly (the push-early design intent).
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` step `Resolve DevAudit base URL`: prefers `jq '.devaudit.base_url' sdlc-config.json`, falls back to repo Variable `DEVAUDIT_BASE_URL` (deprecated warning), else skip; pre-flight `curl -I "${BASE%/}/"` — 2xx/3xx proceeds, else `::error::` + exit 1; missing `DEVAUDIT_API_KEY` → skip with warning. Exports `DEVAUDIT_BASE_URL` to `$GITHUB_ENV` for `upload-evidence.sh`.
- **Preconditions / inputs:** `sdlc-config.json` `devaudit.base_url`; secret `DEVAUDIT_API_KEY`.
- **Given** the workflow **When** `devaudit.base_url` is set and reachable **Then** `skip=false` and uploads proceed; **When** the URL returns a non-2xx/3xx HTTP code (dead alias/wrong host) **Then** the step errors and exits 1; **When** no base URL or no API key is configured **Then** `skip=true` and uploads are skipped (warning, not failure).
- **Error paths:** Unreachable host = hard fail; missing config = soft skip.
- **Fixtures/env:** Portal stub returning 200 / 404 / unreachable; with and without `DEVAUDIT_API_KEY`.

#### REQ-FRAMEWORK-EVIDENCE-003 — Per-requirement evidence uploaded with correct evidence_type routing (stage 3)

- **Priority:** Must — the framework-coverage matrix attributes clauses by evidence_type (DevAudit-Installer#146/#101/#119/#120/#121).
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` `Upload compliance documents` step: planning docs (RTM/test-plan/test-cases) → `compliance_document`/`planning`; per-REQ artefacts in `compliance/evidence/<REQ>/*.md` routed by basename — `test-execution-summary.md`/`test-summary-report.md`→`test_report`, `srs-alignment.md`→`srs_alignment`, `architecture-decision.md`→`architecture_decision`, `risk-assessment.md`→`risk_assessment`, `e2e-scope-decision.md`→`e2e_scope_decision` (DevAudit-Installer#737), default→`compliance_document`. Each per-REQ upload uses `--release <REQ_ID>` (per-requirement release attribution, #135). All uploads carry `--sdlc-stage 3` (compile-evidence stage), set via the shared `FLAGS` variable.
- **Preconditions / inputs:** Pending release tickets define in-scope REQs; per-REQ evidence folders present.
- **Given** an in-scope REQ with these artefacts **When** the workflow runs **Then** each file uploads under its dedicated evidence_type against release `<REQ_ID>` with `sdlcStage=3`, so the portal attributes SOC2.CC3.2 / ISO27001.A.8.25 etc. correctly. **When** no pending tickets exist **Then** per-requirement upload is skipped (avoids re-uploading the whole catalogue, #135/#133).
- **Error paths:** Pending ticket but no `compliance/evidence/<REQ>/` → warning, continue; each upload `|| echo Warning` (soft).
- **Fixtures/env:** Pending ticket + per-REQ artefact set of each basename; portal stub asserting evidence_type + sdlcStage per file.

#### REQ-FRAMEWORK-EVIDENCE-004 — Audit-log export uploaded as audit_log evidence (90-day window)

- **Priority:** Should — closes ISO27001.A.8.16 / EUAIA.Art-12 / GDPR.Art-32; soft-fails so it cannot break the pipeline.
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` audit-log block: `curl -sSf -H Authorization ".../api/ci/projects/{{PROJECT_SLUG}}/audit-log/export"` then `upload-evidence.sh … audit_log … --category compliance_document`.
- **Preconditions / inputs:** API key with read access (`resolveCiUploadAuth`); portal export endpoint.
- **Given** the workflow **When** the audit-log export succeeds **Then** it's uploaded as `audit_log`; **When** the export 4xx/5xx or is unreachable **Then** a `::warning::` is emitted and the three clauses stay MISSING until the next run (no job failure).
- **Error paths:** Export failure is soft (warning only).
- **Fixtures/env:** Portal stub serving / failing the export endpoint.

#### REQ-FRAMEWORK-EVIDENCE-005 — Normal housekeeping remains integration history; standalone promotion is an explicit, validated exception

- **Priority:** Must — a bare-date integration record must not be mistaken for an approval-ready release.
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template`; `sdlc/files/_common/scripts/check-release-pr-scope.sh`; `sdlc/files/_common/scripts/standalone-housekeeping-release.sh`; `sdlc/files/ci/post-deploy-prod.yml.template`; `docs/release-playbooks/housekeeping-release.md`.
- **Preconditions / inputs:** A lightweight `docs:` / `chore:` / `ci:` / `build:` / `test:` housekeeping change reaches `develop`. A standalone promotion additionally supplies `compliance/standalone-housekeeping/STANDALONE-HOUSEKEEPING-vYYYY.MM.DD.json` with `schemaVersion: 1`, exact version, `releaseMode: standalone_housekeeping`, and a specific reason.
- **Given** normal housekeeping is merged after terminal-green PR review **When** its develop workflow runs **Then** any bare-date record is integration/history only: no release-ticket/security-summary stub PR is generated, no UAT or production approval is requested, and the work waits to be represented by the next tracked REQ's bundled-change lineage. **Given** an operator explicitly requests standalone housekeeping promotion **When** the declaration validates and production post-deploy completes **Then** registration, production smoke, and declaration evidence use `_compliance-docs` as requirement scope while retaining the exact bare-date value in `--release`, and the portal row is promoted to `standalone_housekeeping`; tracked releases retain `REQ-XXX` for both fields. **Given** the declaration is absent, malformed, or mismatched **Then** the standalone path fails rather than silently treating normal housekeeping as approval-ready.
- **Error paths:** A runtime-behaviour change discovered after a housekeeping merge requires reclassification/backfill per the `sdlc-implementer` lightweight-path contract; it is not legitimised by a bare-date release. A normal integration record must never be auto-promoted by an approval workflow.
- **Fixtures/env:** Bare-date develop push without a declaration (no release-stub PR or approval-ready release); valid standalone declaration (validated then promoted post-deploy); invalid declaration (release-scope validation failure).

#### REQ-FRAMEWORK-EVIDENCE-006 — E2E Regression evidence preserves source REQ, stage, execution, and feature/regression provenance

- **Priority:** Must — reviewers must be able to distinguish evidence created by a source release from evidence inherited through a bundled approval envelope.
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` job `upload-e2e-regression-evidence`; `sdlc/files/ci/feature-e2e.yml.template`; `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` Phase 5½; `scripts/upload-evidence.sh`.
- **Preconditions / inputs:** `e2e_regression_enabled: true` for the `compliance-evidence.yml` half of this contract — otherwise the `upload-e2e-regression-evidence` job is not rendered at all (REQ-FRAMEWORK-EVIDENCE-001, #869); the `feature-e2e.yml` half is unaffected. A consumer E2E workflow produces the configured result/report artifact and names the originating `REQ-XXX` in release-ticket scope or artifact metadata. The workflow has a CI run ID, source SHA, SDLC stage, release iteration, and test-execution context.
- **Given** a tracked E2E workflow completes **When** the evidence uploader runs **Then** it uploads the JSON result and human-readable report with the originating REQ, source SHA, `testExecutionId`, SDLC stage, and `origin`/tier metadata. **Given** an artifact precedes its release ticket at the same SHA **When** exactly one REQ is recoverable from artifact metadata **Then** it attaches to that source REQ rather than a bare-date or `_compliance-docs` fallback. **Given** the source release is later bundled **Then** the approval release can reference the source evidence through lineage but must not relabel the E2E run as newly produced by the absorbing REQ. **Given** no unambiguous tracked or declared standalone release context exists **Then** the workflow records historical CI only and does not create an approval-ready E2E evidence set.
- **Error paths:** Missing artifact, missing API configuration, or ambiguous/multiple REQ recovery yields a visible skip/warning; the workflow must not fabricate release attribution. A local E2E pass is local verification, not a substitute for the configured CI upload.
- **Fixtures/env:** Tracked workflow-run with a ticket; workflow-run where one REQ is recovered from result metadata; bundled successor referencing source evidence; bare-date housekeeping run; ambiguous multiple-REQ artifact.

#### REQ-FRAMEWORK-EVIDENCE-014 — workflow_run E2E upload recovers tracked release context from artifact metadata before falling back to `_compliance-docs` (#311)

- **Priority:** Should — a regression run that happened before the release ticket landed on the triggering SHA must still attach to the truthful tracked release when the artifact clearly names it.
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` (`upload-e2e-regression-evidence`): after scanning pending release tickets at the triggering SHA, parses `e2e-regression-results.json` for `REQ-XXX` identifiers, populates `REQS`, and if exactly one REQ is recovered while the derived release is still a bare-date `vYYYY.MM.DD(.n)` release, overrides `DERIVED_RELEASE` to that tracked `REQ-XXX` before upload.
- **Preconditions / inputs:** `workflow_run` event with no in-scope pending release ticket at the triggering SHA, but a Playwright JSON artifact that contains one or more `REQ-XXX` references.
- **Given** no pending ticket exists yet at the triggering SHA **When** the artifact names exactly one tracked requirement **Then** the workflow uploads against that `REQ-XXX` release rather than leaving the evidence attached to a bare-date housekeeping release. **Given** no REQ can be recovered from tickets or artifact metadata **Then** the workflow falls back to `_compliance-docs`.
- **Error paths:** Artifact parse failure or zero recovered REQs simply preserves the fallback path; the job does not hard-fail on metadata recovery alone.
- **Fixtures/env:** `workflow_run` fixture with empty pending tickets + artifact mentioning one `REQ-XXX`; another fixture with no recoverable REQ.

#### REQ-FRAMEWORK-EVIDENCE-007 — `test-execution-summary.md` template carries Test Executions section (ISO 29119-3 Test Completion Report)

- **Priority:** Should — the Test Completion Report is the encompassing artefact after all test executions; the Test Executions section distinguishes the release summary from individual execution records (DevAudit-Installer#209, ISO/IEC/IEEE 29119-3 §4.14).
- **Source:** `sdlc/src/blueprints/3-compile-evidence.raw.md` (Step 1a template): the `test-execution-summary.md` markdown template includes a `## Test Executions` section with source release, stage, execution ordinal, kind, outcome, run provenance, related evidence, remediation, and date, followed by a `**Final assessment:**` line. The section is populated at Stage 3 from the portal execution read model.
- **Preconditions / inputs:** The release has at least one completed test execution; execution data is available from the portal API or from local evidence directories.
- **Given** the `test-execution-summary.md` template **When** Stage 3 generates the file **Then** it contains a `## Test Executions` section with one row per first-class execution and a final assessment line. **Given** an unchanged build is retried **When** the retry is recorded **Then** it is another execution in the same release iteration. **Given** a failed execution causes implementation rework linked to a defect or scope correction **Then** the later executions belong to a new, reasoned iteration. **Given** a release with a single execution **Then** the table has one row.
- **Error paths:** No execution data available → the section carries placeholder rows with a note; the summary still uploads as required evidence.
- **Fixtures/env:** A REQ with 2 executions in one iteration; a REQ with a deliberate rework iteration; a REQ with a single execution; a REQ with a failed execution.

---

#### REQ-FRAMEWORK-EVIDENCE-008 — Incident export enriched with structured sections from PR/issue body (#210 AC6)

- **Priority:** Should — incident reports must carry structured root-cause/impact/containment/lessons sections for SOC2.CC7.2 / ISO29119.3.5.4 / GDPR.Art-33 compliance.
- **Source:** `sdlc/files/ci/incident-export.yml.template` Path A: when an `incident`-labelled issue closes, the workflow exports the issue body into `compliance/governance/incident-report-<n>.md` with structured sections (`### Root cause`, `### Impact`, `### Containment`, `### Lessons learned`) extracted from the issue body and PR comments.
- **Preconditions / inputs:** Issue closed with `incident` label; `permissions: contents:write, pull-requests:write`.
- **Given** an incident issue with `incident` label is closed **When** the workflow fires **Then** it generates `incident-report-<n>.md` with the structured sections populated from the issue body; **When** sections are missing from the issue body **Then** REPLACE markers are inserted for human attestation.
- **Error paths:** PR-create failure degrades to warning; idempotent no-op when no diff.
- **Fixtures/env:** Issue-close event fixture with `incident` label; issue body with/without structured sections.

#### REQ-FRAMEWORK-EVIDENCE-009 — Completeness gate blocks incomplete incident reports with unresolved REPLACE markers (#210 AC9)

- **Priority:** Must — an incident report with unresolved REPLACE markers is not valid evidence; the gate must block the release.
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` `upload_incident_report` function: validates incident ownership frontmatter and checks structured sections for unresolved `REPLACE` markers before upload.
- **Preconditions / inputs:** Incident report files in `compliance/governance/` with `incident_kind`, `source_release` / `release_scope`, `source_issue` for real incidents, and a stable semantic id.
- **Given** an owned incident report with unresolved REPLACE markers **When** the evidence upload runs **Then** the upload is skipped/blocked with a visible workflow diagnostic and the release remains uncovered; **Given** all required ownership and content fields are resolved **Then** the report uploads as source-owned `incident_report` evidence.
- **Error paths:** This requirement is itself the error path.
- **Fixtures/env:** Incident report with REPLACE markers (expect gate failure); incident report with all markers resolved (expect pass).

#### REQ-FRAMEWORK-EVIDENCE-010 — E2E regression incident filing with heuristic triage on test failure (#210 AC19-AC27)

- **Priority:** Should — E2E regression failures must file an incident issue with structured triage sections for traceability.
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` E2E regression incident step: on E2E test failure, the workflow files a GitHub issue with `incident` label and structured sections (`### Framework attribution`, `### Failing scenarios`, `### Heuristic triage`, `### Test execution`); the triage heuristics classify the failure (flaky, environment, regression, or unknown).
- **Preconditions / inputs:** `e2e_regression_enabled: true` — the incident step lives in the `upload-e2e-regression-evidence` job, which is stripped from the rendered file otherwise (REQ-FRAMEWORK-EVIDENCE-001, #869). E2E regression workflow with failing tests; `GH_TOKEN` with issue-write permission.
- **Given** an E2E regression run with test failures **When** the incident step runs **Then** it files a GitHub issue with `incident` label, structured sections, and `testExecutionId` cross-reference; **When** the failure is classified as flaky **Then** the triage section notes the flaky classification; **When** the failure is a regression **Then** the triage section identifies the likely causing commit.
- **Error paths:** Issue-create failure degrades to warning; no in-scope REQs → skip.
- **Fixtures/env:** E2E regression with failing tests; portal/gh stubs recording issue creation.

#### REQ-FRAMEWORK-EVIDENCE-011 — Nil incident report generated and uploaded when no incidents occurred (#210 AC15-AC18)

- **Priority:** Should — a per-release "no incidents" attestation is required evidence when no incidents occurred during the release cycle.
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` incident upload step and `nil-incident-report.md.template`: the agent creates one `nil-incident-report-<version>.md` after the scoped verification passes and the workflow uploads it as source-owned `incident_report` evidence when `incident_kind: no_incidents_attestation` and `source_release: <version>` are present.
- **Preconditions / inputs:** For the workflow-side upload: `e2e_regression_enabled: true` (the upload step lives in the conditionally-rendered `upload-e2e-regression-evidence` job, REQ-FRAMEWORK-EVIDENCE-001, #869). No incident reports in `compliance/governance/`; `nil-incident-report.md.template` present.
- **Given** a release with no incidents **When** the evidence compile step runs **Then** `nil-incident-report-<version>.md` is generated with release ownership frontmatter, scope, date, and sign-off placeholders, and uploaded as `incident_report` after sign-off; **Given** incident reports exist for the same source release **Then** the nil report is not generated.
- **Error paths:** Template missing → warning, continue.
- **Fixtures/env:** Release with no incidents (expect nil report); release with incidents (expect no nil report).

#### REQ-FRAMEWORK-EVIDENCE-012 — Catch-all compliance_document fallback eliminated; unrecognized files skip-with-warning (#205)

- **Priority:** Must — the catch-all `compliance_document` fallback caused evidence_type collisions, making the portal's per-type panels show incorrect content (DevAudit-Installer#205).
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` evidence routing: unrecognized file basenames no longer default to `compliance_document`; instead they are skipped with a `::warning::` naming the file and stating it has no evidence_type mapping.
- **Preconditions / inputs:** Per-REQ evidence folders with files.
- **Given** an unrecognized file basename in `compliance/evidence/<REQ>/` **When** the routing runs **Then** the file is skipped with a warning (not uploaded as `compliance_document`); **Given** a recognized basename **Then** it uploads under its dedicated evidence_type.
- **Error paths:** Unrecognized file → warning, continue (not a hard failure).
- **Fixtures/env:** Evidence folder with recognized and unrecognized basenames; portal stub asserting only recognized files are uploaded.

#### REQ-FRAMEWORK-EVIDENCE-013 — Typed evidence_type per artifact (#207)

- **Priority:** Must — each artifact type must upload under its dedicated evidence_type so the portal's per-type panels render correctly (DevAudit-Installer#207).
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template`, `sdlc/files/ci/ci.yml.template`, `sdlc/files/ci/python/ci.yml.template`: SAST → `sast_report`, dependency audit → `dependency_audit`, E2E HTML report → `e2e_report`, E2E JSON results → `e2e_result`, smoke test → `smoke_test`, release ticket → `release_ticket`, coverage report → `coverage_report`, gate outcomes → `gate_outcome`. Each upload carries the correct `--category` and `--evidence_type`.
- **Preconditions / inputs:** CI artifacts in `ci-evidence/`; in-scope REQs from pending release tickets.
- **Given** a CI run producing SAST, dep-audit, E2E, coverage, and gate-outcome artifacts **When** the upload step runs **Then** each artifact uploads under its dedicated evidence_type (not a shared `audit_log` or `compliance_document`); the portal receives correctly typed evidence for each panel.
- **Error paths:** Individual upload failures are soft (`|| echo Warning`); `UPLOAD_FAILURES` tracked across all uploads.
- **Fixtures/env:** CI run with all artifact types; portal stub asserting evidence_type per upload.

#### REQ-FRAMEWORK-EVIDENCE-015 — E2E scope decision persisted as evidence, distinguishing deliberate skip from missing coverage (#737)

- **Priority:** Must — without a persisted record, a backend-only REQ where `e2e-test-engineer` was correctly not invoked reads identically, on the portal's production-review page, to a REQ that genuinely never got E2E coverage (DevAudit-Installer#737).
- **Source:** `sdlc/files/_common/Implementation_Plan_TEMPLATE.md` §4 *E2E test coverage* (new section, populated by `sdlc-implementer` Phase 2 step 5b or by `e2e-test-engineer` Phase 7); `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` Phase 7 (writes `compliance/evidence/REQ-XXX/e2e-scope-decision.md` when invoked); `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` Phase 2 step 5b (writes the same artefact directly when `e2e-test-engineer` is never invoked at all) and Phase 3 step 3b (verifies it exists before upload); `sdlc/files/_common/scripts/upload-compliance-documents.sh` (`e2e-scope-decision.md` → `evidence_type=e2e_scope_decision`); `sdlc/files/ci/feature-e2e.yml.template` `detect-req` job (uploads the artefact at the feature-PR stage when the `has_tests=false` branch fires and the artefact was committed, rather than leaving only a `::warning::`).
- **Preconditions / inputs:** A tracked REQ reaches the point where `sdlc-implementer` decides whether to invoke `e2e-test-engineer` (Phase 2 step 3).
- **Given** a REQ whose diff touches UI-facing files **When** `e2e-test-engineer` is invoked and writes spec(s) **Then** the plan's §4 records the spec path(s) and `compliance/evidence/REQ-XXX/e2e-scope-decision.md` records `e2e_required: true`. **Given** a REQ whose diff touches no UI-facing files (e.g. a pure backend service change) **When** `sdlc-implementer` decides not to invoke `e2e-test-engineer` **Then** it writes the plan's §4 `@e2e-deferred: <rationale>` annotation and the evidence artefact itself, with `e2e_required: false` and the rationale. **Given** neither `e2e-test-engineer` was invoked nor `sdlc-implementer`'s no-UI-facing-files path fired (the ambiguous case — no REQ could even be determined, or REQ was determined but nothing recorded a decision) **Then** no `e2e-scope-decision.md` exists and the portal's advisory keeps today's cautious wording unchanged — this case is explicitly out of scope for suppression.
- **Error paths:** `compliance/evidence/REQ-XXX/e2e-scope-decision.md` missing when Phase 3 step 3b runs → halt, do not fabricate the artefact retroactively. Unrecognized evidence basenames still skip-with-warning per REQ-FRAMEWORK-EVIDENCE-012 (unaffected — `e2e-scope-decision.md` is now a recognized basename).
- **Fixtures/env:** A UI-touching REQ (spec exists, `e2e_required: true`); a backend-only REQ (`e2e_required: false` with rationale, portal advisory suppressed); the genuinely-ambiguous case (no artefact, advisory unchanged). Portal-side advisory copy and evidence-presence check are a separate cross-repo change (`metasession-dev/devaudit`), not scoped here.

---

#### REQ-FRAMEWORK-EVIDENCE-016 — Report-bundle upload falls back to the presigned flow, logs diagnostics, and surfaces a missing report (#1018)

- **Priority:** Should — a Playwright HTML report that silently fails to upload leaves approvers unable to inspect a failing or flaky spec from the portal (DevAudit-Installer#1018, observed on example-app REQ-109: `HTTP 400 {"error":"Failed to parse body as FormData."}`, one attempt, no diagnostics, job green).
- **Source:** `sdlc/files/_common/scripts/upload-evidence.sh` (multipart loop: presigned fallback on HTTP 400/413 for files under `PRESIGNED_THRESHOLD_BYTES`; `Diagnostics:` and `Response headers:` lines on failure); `sdlc/files/ci/compliance-evidence.yml.template` ("Upload E2E Regression Evidence" calls the helper below); `sdlc/files/_common/scripts/playwright-report-evidence.sh` (`zip`: zip errors no longer swallowed, size logged; `missing`: `$GITHUB_STEP_SUMMARY` note when the report upload fails for a non-passing run; a separate script because `compliance-evidence.yml`'s `run:` block is within ~200 bytes of GitHub's 21,000-character limit); tests `upload-evidence.test.sh` and `playwright-report-evidence.test.sh`.
- **Preconditions / inputs:** An evidence file below the 25 MB presigned threshold that the portal or a proxy in front of it rejects on the multipart path with 400 or 413.
- **Given** the multipart POST returns 400 or 413 for a file under the threshold **When** the upload loop ends **Then** the script retries once through the presigned flow (`upload-url` → PUT → `upload-complete`); on success it prints `OK (<n> bytes, presigned R2 upload after multipart HTTP <code>)` and exits 0. **Given** the presigned flow is unavailable or also fails **Then** the file counts as FAILED, the portal response body is printed, plus `Diagnostics: file=… size=…B path=multipart evidenceType=… presigned_threshold=…B` and the response headers (`HTTP/`, `server`, `content-type`, `content-length`, `via`, `x-*`), and the script exits 1. **Given** `zip` fails while building `playwright-report.zip` **Then** a `::warning::` is emitted and no archive is uploaded. **Given** the run concluded other than `success` and the report upload fails **Then** a "Playwright report unavailable" note is appended to the job summary; a passing run stays non-blocking.
- **Error paths:** 429/5xx keep the existing retry-with-backoff; 4xx other than 400/413 is terminal as before.
- **Fixtures/env:** `upload-evidence.test.sh` cases 4 (400 then presigned success) and 5 (400, presigned unsupported: diagnostics asserted). Portal-side multipart body limit is a separate cross-repo item (`metasession-dev/devaudit`).

#### REQ-FRAMEWORK-EVIDENCE-017 — Sentinel trailer discovery is wide enough, requirement-aware and visible (#1082)

- **Priority:** Should — a tracked upload with no sentinel is stored by the portal as `unverified` and blocks approval, and from the upload side that was indistinguishable from a genuine bypass (DevAudit-Installer#1082).
- **Source:** `sdlc/files/_common/scripts/upload-evidence.sh` (`detect_sentinel_git_trailer`, `check_sentinel_shape`, `resolve_sentinel_context`); test `upload-evidence.test.sh` cases 10-15.
- **Preconditions / inputs:** An upload with `--change-type` one of `feat|fix|refactor|perf|compliance|revert`, no `.sdlc-implementer-invoked` file (a CI checkout), and a `Sdlc-Implementer-Sentinel:` trailer somewhere in the history of the target commit.
- **Given** no local sentinel file **When** the upload resolves provenance **Then** it scans up to `SENTINEL_SCAN_LIMIT` commits (default 500, was 50) from the target commit and uses the newest trailer on a commit that mentions the upload's requirement id, else the newest trailer. **Given** a sentinel is found **Then** the script prints `sentinel: <local file | trailer from commit <sha>> (change type <t>)`; **given** none is found **Then** it prints `sentinel: none found (change type <t>, scanned up to <n> commits from <ref>); the portal will record this upload as unverified`. **Given** the value is neither a JSON array/object nor the legacy `INVOKED` marker (and `jq` is available) **Then** it emits a `::warning::` and still forwards the value.
- **Error paths:** No trailer is not an error: the upload proceeds without `sentinelContent`, as before. A scan that finds nothing never aborts the script under `set -e` / `pipefail`.
- **Fixtures/env:** `upload-evidence.test.sh`: a trailer 120 commits back is found; `SENTINEL_SCAN_LIMIT=10` misses it and says so; the upload's own requirement beats a newer trailer for another; fallback to the newest; malformed and legacy values.

---

#### REQ-FRAMEWORK-E2ETRIAGE-001 — A failing required release check halts with fix-or-accept (#1016)

- **Priority:** Must — the failure used to surface only at portal UAT approval, about two weeks after the release PR opened (example-app REQ-109).
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` Phase 4 step 5a; `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` Phase 6 ("Emit the failure table"); `docs/ADR/ADR-003-required-gate-failure-acceptance.md`.
- **Given** a required check on the release PR is failing **When** `sdlc-implementer` reaches Phase 4 **Then** it ends the turn `[Blocked]`, lists each failed spec/step with error excerpt and run URL, delegates classification to `e2e-test-engineer` Phase 6, and offers exactly (a) Fix (a `fix/` PR and a green re-run on the PR head SHA) or (b) Accept (a documented exception, never automatic), stating the release is blocked until one is completed; it never proceeds to UAT or evidence upload with an unresolved failure. Phase 5's `accepted_exception` resolutions need the same record.
- **Fixtures/env:** text-pinning assertions in `cli/test/`; the validator and script behaviour below.

#### REQ-FRAMEWORK-E2ETRIAGE-002 — Accepted-exception record and validator (#1016)

- **Priority:** Must — "accept" was a one-line reason; nothing required impact, ownership or an expiry.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/references/e2e-accepted-failure.md.template`; `sdlc/files/_common/scripts/validate-risk-acceptance-record.sh` (`--kind e2e|dependency`); `contracts/evidence-types.json` (`accepted_e2e_failure`); `sdlc/files/_common/scripts/upload-compliance-documents.sh` (`accepted-e2e-failure-*.md`).
- **Given** a record **When** `validate-risk-acceptance-record.sh --kind e2e <record>` runs **Then** it exits 0 only if the frontmatter has the right `record_kind`, a real decision-maker, `decided_at` not in the future, a `review_by` date in the future, an exact GitHub issue URL as `tracking_issue`, at least one failing spec, a known classification, a CI run and head SHA, and the sections Failure, Evidence of classification, Impact assessment, Why this does not block this release and Remediation are present with no `REPLACE` placeholder; an unedited template fails. **Given** the record sits at `compliance/evidence/REQ-XXX/accepted-e2e-failure-<spec>.md` **Then** it uploads as `accepted_e2e_failure` (category `planning`).
- **Fixtures/env:** `validate-risk-acceptance-record.test.sh` (11 cases). The evidence type is mirrored from the portal's contract (`sync-evidence-contract.yml`); the portal must carry the same entry.

#### REQ-FRAMEWORK-E2ETRIAGE-003 — `resolve` requires a record to accept a failure (#1016)

- **Priority:** Must — the portal's `execution_triage_missing` is cleared only by a recorded resolution, which must not require merging into the release head.
- **Source:** `sdlc/files/_common/scripts/report-test-execution.sh` (`--record`; validation before any network call).
- **Given** `resolve --resolution-type accepted_exception` **When** `--remediation-reference` or `--record` is missing, or the record fails `validate-risk-acceptance-record.sh --kind e2e` **Then** it exits non-zero and makes no portal call. **Given** a valid record **Then** the call is sent with the record path appended to the reason. **Given** `retry_passed` or `incident_remediated` **Then** neither flag is needed.
- **Fixtures/env:** `report-test-execution.test.sh` (31 cases).

#### REQ-FRAMEWORK-E2ETRIAGE-004 — Test-execution-summary integrity (#1016)

- **Priority:** Must — the REQ-109 summary read "PASS (with known unrelated flakes)" and recorded a run with 3 failures as `passed`.
- **Source:** `sdlc/files/_common/scripts/validate-test-summary.sh` (checks 9-11); `sdlc/files/_common/scripts/render-test-executions.sh` (`generated-by` marker); `sdlc/src/blueprints/3-compile-evidence.raw.md` Step 1a.
- **Given** a summary recording any failed execution (`N failed`, or an outcome of `failed`/`timed_out` in the executions table) **When** `validate-test-summary.sh` runs **Then** it fails unless `## E2E failures & triage` has a row per failure with a valid classification (flake / test bug / app defect / seed-data gap), a disposition (Fix / Accepted exception / Deferral) and a reference (PR or issue for Fix and Deferral; the record path or tracking issue URL for Accepted exception); "known unrelated flakes" without the table fails. **Given** a summary carrying `CI as of: <run>/<attempt> @ <sha>` **Then** it must contain the `<!-- generated-by: render-test-executions.sh -->` marker, and when `DEVAUDIT_PR_HEAD_SHA` is set the stamp must match it (either SHA may be abbreviated). **Given** no stamp **Then** it only warns (releases already in flight keep passing).
- **Fixtures/env:** `validate-test-summary.test.sh` (36 cases, including the REQ-109 shape).

#### REQ-FRAMEWORK-E2ETRIAGE-005 — Summary-vs-CI reconciliation (#1016)

- **Priority:** Should — a hand-edited summary can name a different spec than CI failed.
- **Source:** `sdlc/files/_common/scripts/reconcile-e2e-summary.sh`; invoked by `validate-test-summary.sh` when `E2E_RESULTS_JSON` (default `e2e-artifacts/e2e-regression-results.json`) exists, narrowed by `E2E_RUN_ID` / `E2E_RUN_ATTEMPT`.
- **Given** a Playwright JSON results file **When** the reconciler runs **Then** it fails if CI reported a failed spec that no triage row names, and (with `--run-id`) if the rows tied to that run (`CI <run>/<attempt>`) differ in count or in spec from CI's failures; a passing re-run attempt reconciles with zero rows.
- **Fixtures/env:** `reconcile-e2e-summary.test.sh` (9 cases).

#### REQ-FRAMEWORK-E2ETRIAGE-006 — Early visibility of a red required release check (#1016)

- **Priority:** Should — nothing surfaced a red required check between PR open and UAT.
- **Source:** `sdlc/src/bin/devaudit-sdlc.cjs` (`requiredFailingChecks`, `notifyRequiredGateFailure`; `--issue <n>` or `ISSUE_NUM`; `phase4.gate_timeout_hours` from `sdlc-config.json`).
- **Given** a release promotion PR with a required check (other than the Release Approval Gate, which has its own retry path) failing **When** the watcher polls **Then** it comments on the issue once per distinct failing set with the fix-or-accept options, updates the sticky via `scripts/update-sdlc-status.sh`, and re-arms after the checks recover; after `phase4.gate_timeout_hours` (default 24) it escalates once. Without an issue number it still reports the block on stdout.
- **Fixtures/env:** `cli/test/devaudit-sdlc-engine.test.ts` ("required-gate failure visibility").

---

#### REQ-FRAMEWORK-DEPRISK-001 — Dependency exceptions need a valid, matching acceptance record (#1017)

- **Priority:** Must — `accepted-vulnerabilities.json` entries carried an approver, expiry and reason but no impact assessment, and nothing tied an entry to a reviewable record.
- **Source:** `sdlc/files/_common/scripts/evaluate-npm-audit.sh` (`validate_acceptance_record`, `record_frontmatter`).
- **Given** `compliance/security/accepted-vulnerabilities.json` with `"schemaVersion": 2` **When** the helper evaluates the audit **Then** each entry must also carry `acceptanceRecord`: a repo-root-relative path (no `..`, not absolute) to a file that exists, passes `validate-risk-acceptance-record.sh --kind dependency`, lists the entry's `advisoryId` in `advisory_ids`, and whose `tracking_issue` equals the entry's `remediationIssue`; otherwise the evaluation fails closed with the reason. The path and the record's SHA-256 are written to `dependency-risk-evaluation.json` (`accepted[].acceptance`). **Given** `schemaVersion` 1 **Then** the entry still works and a `::warning::` says new exceptions should use version 2. **Given** an expired entry (`expiresAt` today or earlier) **Then** the gate fails again, as before.
- **Fixtures/env:** `evaluate-npm-audit.test.sh` (v2 success; missing field; missing file; wrong advisory; tracking-issue mismatch; past review date; `..` path; expired).

#### REQ-FRAMEWORK-DEPRISK-002 — Risk-acceptance record template, validation and evidence (#1017)

- **Priority:** Should — a documented acceptance should be reviewable by the approver on the portal.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/references/dependency-risk-acceptance.md.template`; `validate-risk-acceptance-record.sh --kind dependency` (advisory_ids, package, severity, decision-maker, future `review_by`, `remediation_deadline`, exact tracking-issue URL, sections Advisories / Reachability and exploitability / Impact assessment / Compensating controls / Remediation); `upload-compliance-documents.sh` (`compliance/security/risk-acceptances/*.md` -> `accepted_dependency_risk`, category `security`, on the derived release); `contracts/evidence-types.json`.
- **Given** an unedited template **Then** validation fails. **Given** records under `compliance/security/risk-acceptances/` **When** compliance documents upload **Then** each uploads as `accepted_dependency_risk`.
- **Fixtures/env:** `validate-risk-acceptance-record.test.sh` (shared validator); the evidence type is mirrored from the portal's contract.

#### REQ-FRAMEWORK-DEPRISK-003 — Agent halt on a failing dependency audit (#1017)

- **Priority:** Should — the operator was left to improvise, and a bump that moves the head of a `develop`-headed release PR re-triggers its checks.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` Phase 4 step 5a ("Dependency-audit gate failures").
- **Given** a failing dependency audit on the release PR **When** `sdlc-implementer` reaches Phase 4 **Then** it ends `[Blocked]`, lists the unresolved advisories from `dependency-risk-evaluation.json` with fix availability, and offers (a) a dependency-bump PR (landed first, because it moves the release head) or (b) a documented acceptance (record, `accepted-dependency-risk` tracking issue with `Review by:`, a v2 exception entry); it never creates the acceptance itself.

---

#### REQ-FRAMEWORK-LIFECYCLE-001 — Behavioural test of the generated Release Close-out workflow (#941)

- **Priority:** Should — a regression in how the generated close-out workflow reconciles the compliance tree or reports to the portal was caught by no automated test; only string/YAML assertions covered it.
- **Source:** `cli/test/close-out-workflow-behavior.test.ts` (renders `close-out-release.yml` from the real sync, or uses `CLOSEOUT_WORKFLOW_FILE`, and runs the `Resolve inputs`, `Run close-out`, `Report close-out PR opened` and `Wait for close-out PR merge and report completion` steps with bash); `scripts/release-validation/layer2b.sh` (`scenario_close_out`); `scripts/release-validation/surfaces.tsv` (`close-out` surface).
- **Given** a tracer-consumer fixture (RTM row `TESTED - PENDING SIGN-OFF`, a pending release ticket), a fake `gh` and a mock portal **When** the rendered steps run for `REQ-777` **Then** the ticket moves to `approved-releases/` with status RELEASED, the RTM row becomes RELEASED, and the portal receives, in order, `status: pr_opened` (PR number and URL) then `status: completed` (PR number, URL, merge SHA), both on the release id the portal resolved for that REQ. **Given** a non-REQ release input **Then** it is a no-op. **Given** a second run on the reconciled tree **Then** nothing changes and nothing is reported. **Given** the portal resolves a different release, a PR closed without merging, or no API key **Then** no report is posted and a warning says why.
- **Test-harness only:** the mock portal simulates what the portal would answer; nothing creates an approval, a UAT execution or a "Mark as Released" transition. The human click is the control being reacted to.
- **Fixtures/env:** the test file (9 cases, including the two #1088 cases that run the `Open close-out PR` step against a local bare `origin` with stray shard directories in the workspace). Mutation-checked: a no-op `close-out-release.sh` call and a renamed `pr_opened` status each make it fail.
#### REQ-FRAMEWORK-ATTRIBUTION-001 — Classify a PR before attributing its evidence to a release (#1019)

- **Priority:** Must — CI on an unrelated doc-only PR carrying `Ref: REQ-109` attached its head SHA, branch and a Feature E2E execution to REQ-109's release (example-app, release PR #906 vs compliance PR #909), so an approval could name code the reviewer never reviewed.
- **Source:** `sdlc/files/_common/scripts/classify-pr-attribution.sh`; `sdlc/files/_common/scripts/derive-release-version.sh` (step 2-bis and the merge-range scan).
- **Given** `--base <ref>` **When** the classifier runs **Then** it prints `attach` if any file in `merge-base(base, head)..head` is outside the documentation paths (`compliance/`, `docs/`, `SDLC/`, `.devaudit/`, `.github/ISSUE_TEMPLATE/`, `*.md`; override with `DEVAUDIT_DOC_PATH_REGEX`), `skip:doc-only` if all are documentation, `skip:compliance-record` if additionally a commit carries `Compliance-Record: REQ-XXX`, `skip:no-changes` for an empty range; a marker on a code-bearing PR attaches with a warning; an unresolvable range degrades to `attach`. **Given** a commit whose body has a `Compliance-Record: REQ-XXX` trailer line **Then** `derive-release-version.sh` derives that REQ (a bracketed subject tag still wins), so the PR's documents reach that release.
- **Fixtures/env:** `classify-pr-attribution.test.sh` (10 cases incl. the REQ-109 shape); `derive-release-version.test.sh` (50).

#### REQ-FRAMEWORK-ATTRIBUTION-002 — Guards on the PR-event producers (#1019)

- **Priority:** Must — the classifier is only useful where evidence is produced.
- **Source:** `sdlc/files/ci/feature-e2e.yml.template` (`detect-req`: a `skip:*` result emits `req_id=none`, `has_tests=false` and a `::notice::`); `upload-evidence.sh` (on `GITHUB_EVENT_NAME=pull_request` with `GITHUB_BASE_REF`, a `skip:*` result clears `--git-sha`, `--branch` and `--create-release-if-missing`, uploads the document anyway, and warns); `report-test-execution.sh` (`start`/`complete` record nothing, write `execution_supported=false` and `execution_skipped_reason=attribution_guard_<reason>`; `resolve` is unaffected). `--no-attribution-guard` / `DEVAUDIT_ATTRIBUTION_GUARD=0` disable it; `push` events are never guarded.
- **Given** a doc-only PR into the integration branch whose commits carry `Ref: REQ-XXX` **Then** no execution, SHA or branch is attached to REQ-XXX and the skip is visible in the log. **Given** a code PR **Then** behaviour is unchanged.
- **Confirmed portal behaviour:** an upload to an existing release never overwrites its `branch`; cycles keep the uploader's SHA/branch (see `docs/release-lineage-producer-contract.md`). Server-side enforcement is an open design question in #1024.
- **Fixtures/env:** `upload-evidence.test.sh` (cases 6-9), `report-test-execution.test.sh` (`case_attribution_guard`), `cli/test/update.test.ts` (rendered `feature-e2e.yml`).

---

#### REQ-FRAMEWORK-CONTRACT-001 — Shared evidence-types.json contract file (#247)

- **Priority:** Must — the contract file is the single source of truth for evidence type names shared between the installer CI templates and the portal's `EvidenceType` union.
- **Source:** `contracts/evidence-types.json` (canonical copy in portal repo `metasession-dev/devaudit`); synced copy in installer repo at `contracts/evidence-types.json`.
- **Preconditions / inputs:** Portal repo's `contracts/evidence-types.json` defines `evidence_types` (array of `{ value, label, category, ac_proof, group }`), `evidence_categories` (array matching portal's `EvidenceCategory` union), and `release_shapes` (patterns matching `classifyReleaseShape()`).
- **Given** the portal repo **When** `contracts/evidence-types.json` is modified on `develop` **Then** the portal-side contract test (`tests/unit/contract/evidence-contract.test.ts`) validates that every type in the contract is in `VALID_EVIDENCE_TYPES` and vice versa, every category matches the `EvidenceCategory` union, and release shape patterns match `classifyReleaseShape()`. **Given** the installer repo **When** the contract test runs **Then** `contracts/evidence-types.json` is loaded from the local copy and every evidence type extracted from CI templates must exist in the contract's `evidence_types` array.
- **Error paths:** Contract file missing → test fails with "Contract file not found". Type mismatch → test fails listing the diff. Category mismatch → test fails listing the diff.
- **Fixtures/env:** Contract JSON file on disk; portal `EVIDENCE_TYPE_REGISTRY` loaded in test.

#### REQ-FRAMEWORK-CONTRACT-002 — Installer-side contract test extracts evidence types from CI templates (#247)

- **Priority:** Must — prevents drift where a CI template sends an evidence type the portal doesn't recognize.
- **Source:** `cli/test/evidence-contract.test.ts` (`extractEvidenceTypes`, `preprocess`, `collectTemplateFiles`).
- **Preconditions / inputs:** `contracts/evidence-types.json` present in repo root; `sdlc/files/ci/*.yml.template` files present.
- **Given** the installer repo **When** the contract test runs **Then** it recursively collects all `.yml.template` files under `sdlc/files/ci/`, preprocesses each (normalizes CRLF → LF, joins line continuations `\` + newline → space, strips comments), and extracts evidence types via regex patterns matching: (a) `upload-evidence.sh ... <TYPE>` positional args, (b) `EVTYPE=<type>` assignments in case statements, (c) `upload_project_doc ... <TYPE>` patterns. The test asserts every extracted type exists in the contract's `evidence_types` array. Types in the contract but not sent by the installer are informational only (forward compatibility, not a failure).
- **Error paths:** Extracted type not in contract → `AssertionError: Expected CI templates to send "<type>": expected false to be true`. No CI templates found → test fails with "No CI template files found". Contract file missing → test fails with "Contract file not found".
- **Fixtures/env:** Real `sdlc/files/ci/` directory; real `contracts/evidence-types.json`. Test resolves paths via `__dirname` (not `process.cwd()`) for CI compatibility.

#### REQ-FRAMEWORK-CONTRACT-003 — Cross-repo sync workflow (#247)

- **Priority:** Should — automates the second PR when the portal contract changes, removing manual sync burden.
- **Source:** `.github/workflows/sync-evidence-contract.yml` (both repos).
- **Preconditions / inputs:** Portal repo: `INSTALLER_DISPATCH_TOKEN` secret (PAT with `repo` scope on `metasession-dev/DevAudit-Installer`). Installer repo: `repository_dispatch` trigger enabled.
- **Given** the portal repo **When** `contracts/evidence-types.json` changes on `develop` **Then** `sync-evidence-contract.yml` fires a `repository_dispatch` event (type: `evidence-contract-updated`) to `metasession-dev/DevAudit-Installer` with `client_payload` containing source, SHA, and commit message. **Given** the installer repo **When** it receives the dispatch **Then** `sync-evidence-contract.yml` fetches the latest contract from `raw.githubusercontent.com/metasession-dev/devaudit/develop/contracts/evidence-types.json`, checks for diff against the local copy, and if changed: creates a branch `chore/sync-evidence-contract`, commits the updated file, force-pushes (with lease), and opens or updates a PR to `develop`. Also triggerable manually via `workflow_dispatch`.
- **Error paths:** PAT missing or expired → dispatch fails with 401 (portal side). Fetch from raw.githubusercontent.com fails → workflow fails (installer side). No diff → workflow exits with "Contract file is already up to date". PR already open → branch updated in place, no duplicate PR created.
- **Fixtures/env:** Both repos on `develop`; `INSTALLER_DISPATCH_TOKEN` secret configured in portal repo.

#### REQ-FRAMEWORK-CONTRACT-004 — CLI CI triggers on CI template and contract file changes (#247)

- **Priority:** Must — ensures the contract test runs when CI templates are modified, not just when `cli/` code changes.
- **Source:** `.github/workflows/cli.yml` (`on.push.paths`, `on.pull_request.paths`).
- **Preconditions / inputs:** PR or push touching files in `sdlc/files/ci/**`, `contracts/evidence-types.json`, `cli/**`, `plugin-sdk/**`, or `.github/workflows/cli.yml`.
- **Given** a PR that adds a new evidence type to a `.yml.template` in `sdlc/files/ci/` without touching `cli/` **When** the PR opens **Then** `cli.yml` CI triggers (because `sdlc/files/ci/**` is in the paths trigger) and the contract test (`evidence-contract.test.ts`) runs, catching the new type if it's not in the contract. **Given** a PR that updates `contracts/evidence-types.json` **When** the PR opens **Then** CI triggers and the contract test validates the updated file.
- **Error paths:** Paths not matched → CI does not run (no false trigger). Contract test failure → PR check fails, blocking merge.
- **Fixtures/env:** PR touching only `sdlc/files/ci/ci.yml.template`; PR touching only `contracts/evidence-types.json`.

---

#### REQ-FRAMEWORK-VALIDATION-001 — compliance-validation.yml gates PRs to main on artifact + commit validity

- **Priority:** Should — a merge-gate but delegated entirely to consumer-side scripts (black-box: it must run them on PRs to main).
- **Source:** `sdlc/files/ci/compliance-validation.yml.template` (`on: pull_request: branches:[main]`): job `compliance-validation` runs `bash scripts/validate-compliance-artifacts.sh origin/main`, then `bash scripts/validate-test-summary.sh origin/main`, then `bash scripts/validate-commits.sh origin/main` with `fetch-depth: 0`.
- **Preconditions / inputs:** PR targeting `main`; `scripts/validate-compliance-artifacts.sh` + `scripts/validate-test-summary.sh` + `scripts/validate-commits.sh` present.
- **Given** the rendered `compliance-validation.yml` **When** a PR to `main` is opened/updated **Then** all three validation scripts run against `origin/main`; a non-zero exit from any one fails the check (blocking merge under branch protection). It does NOT run on develop pushes (validation only makes sense when work is merge-ready).
- **Error paths:** Any script exits non-zero → job fails.
- **Fixtures/env:** Rendered repo with a PR to main; complete vs incomplete compliance artifact fixtures; test-execution-summary.md with valid vs invalid gate states.

#### REQ-FRAMEWORK-VALIDATION-002 — ci-status-fallback emits the Quality Gates status on docs-only commits

- **Priority:** Could — secondary; keeps branch protection from stalling but enforces nothing.
- **Source:** `sdlc/files/ci/ci-status-fallback.yml.template` (`on: push: branches:[develop] paths: {{PATHS_IGNORE}} - 'sdlc-config.json'`): job named `quality-gates` on `ubuntu-latest` (hardcoded, not `{{RUNNER}}`) emits a passing `Quality Gates` status via the GitHub commit-status API.
- **Preconditions / inputs:** Same `{{PATHS_IGNORE}}` list as `ci.yml`, used as `paths:` (the inverse trigger of ci.yml's `paths-ignore`).
- **Given** the rendered fallback **When** a develop commit touches only the ignored paths **Then** it emits a passing `Quality Gates` status so a develop→main PR's branch protection check is satisfied without running the heavy gates; mixed commits trigger both ci.yml and this (same status name).
- **Error paths:** N/A (always passes).
- **Fixtures/env:** Docs-only develop commit fixture.

#### REQ-FRAMEWORK-VALIDATION-004 — ci-status-fallback declares the token permission needed to write commit statuses (`statuses: write`)

- **Priority:** Must — the fallback is only truthful if the workflow token can actually create the `Quality Gates` status it promises to emit.
- **Source:** `sdlc/files/ci/ci-status-fallback.yml.template`, GitHub commit-status REST endpoint used by the workflow step.
- **Preconditions / inputs:** Generated fallback workflow running under `github.token` / `GITHUB_TOKEN`.
- **Given** the workflow emits a commit status via the GitHub API **When** the rendered workflow is inspected **Then** it declares the workflow-level permission required for that call (`statuses: write`; `contents: read` sufficient otherwise) rather than relying on repo-default token scopes.
- **Error paths:** Missing `contents: write` prevents the back-merge branch push. Missing repository Actions PR-creation permission causes `gh pr create` to fail with `403 Resource not accessible by integration`; the workflow must report that setting explicitly instead of calling the repository workflow-permissions endpoint with `GITHUB_TOKEN`.
- **Fixtures/env:** Rendered workflow file content; a docs-only push fixture asserting the status-post step succeeds.

#### REQ-FRAMEWORK-VALIDATION-003 — Governance auto-PR workflows (periodic-review, incident-export, close-out)

- **Priority:** Could — secondary governance automation; each opens a human-reviewed PR.
- **Source:** `sdlc/files/ci/periodic-review.yml.template` (`on: schedule cron '0 9 1 */3 *' + workflow_dispatch` → quarterly auto-PR of `compliance/governance/periodic-review.md`, SOC2.CC4.1/ISO27001.A.12.1); `incident-export.yml.template` (`on: issues: types:[closed]`, `if: contains(labels,'incident')` → auto-PR exporting the issue to `compliance/governance/incident-report-<n>.md`, ISO29119.3.5.4/SOC2.CC7.2/GDPR.Art-33/34); `close-out-release.yml.template` (`on: repository_dispatch type release-closed + workflow_dispatch` → runs `scripts/close-out-release.sh`, opens close-out PR to develop).
- **Preconditions / inputs:** `permissions: contents:write, pull-requests:write`; bot identity `devaudit-bot`; `incident` label created by operator; `scripts/close-out-release.sh` present.
- **Given** the respective trigger **When** it fires **Then** the workflow regenerates/exports the artefact and opens (or updates in place) a PR to `develop` carrying REPLACE markers requiring human attestation; an idempotent no-op (no diff) opens no PR. For `close-out-release.yml` "no diff" and the commit are scoped to `compliance/`, the only tree `close-out-release.sh` writes (`git status --porcelain -- compliance`, `git add -A -- compliance`), so untracked E2E output left on a self-hosted runner (`playwright-report-shard-*/`, `test-results-shard-*/`) neither opens an empty PR nor lands in the commit and trips the pre-commit hook (#1088). The close-out PR uses the reserved branch pattern `chore/close-out-*`, and installer-generated heavy PR workflows are expected to treat that branch class as administrative reconciliation rather than feature/release validation.
- **Error paths:** `close-out-release.yml` requires a valid `^REQ-[0-9]{3,}$`, else `::error::` exit 1; PR-create failures degrade to warnings.
- **Fixtures/env:** Cron/dispatch/issue-close/repository_dispatch event fixtures; gh stub.

#### REQ-FRAMEWORK-VALIDATION-005 — close-out-release.yml auto-merges its PR and self-reports both `pr_opened` and `completed` status

- **Priority:** Should — VALIDATION-003 only covers opening the close-out PR; before this, a human had to notice it was green and click merge, and the portal's guidance panel showed only generic "monitor the consumer repo" text the entire time it sat open (observed concretely on example-app REQ-096's close-out, PR #619). Commits `dd30a7b` (#620), `24d0644` (#601), `c33e418` (#602).
- **Source:** `sdlc/files/ci/close-out-release.yml.template`. Three steps added after the existing PR-open step (VALIDATION-003): (1) `gh pr merge "$BRANCH" --auto --merge`, unconditional on whether `gh pr create` succeeded or the PR already existed — only *arms* auto-merge, GitHub still waits for `develop`'s required checks; requires the repo's "Allow auto-merge" setting. (2) "Report close-out PR opened" — best-effort `POST {base}/api/ci/releases/{id}/close-out` with `status:"pr_opened"` plus workflow/PR provenance (`workflowRunId`, `workflowUrl`, `pullRequestNumber`, `pullRequestUrl`). (3) "Wait for close-out PR merge and report completion" — polls the close-out PR (`gh pr view`, 40 attempts × 30s) and self-reports `status:"completed"` (with `mergeSha`) the moment it observes `MERGED`, because a GitHub-auto-merged PR's `pull_request:closed` event doesn't reliably fire `close-out-completion.yml` (GitHub suppresses new workflow runs for events whose actor is the same `GITHUB_TOKEN` identity that caused them).
- **Preconditions / inputs:** `DEVAUDIT_BASE_URL` + `DEVAUDIT_API_KEY` configured (both status-report steps skip gracefully, not fatally, if absent); repo has "Allow auto-merge" enabled; a resolvable portal release matching the REQ version. **Optional** repo secret `INSTALLER_DISPATCH_TOKEN` (devaudit-installer#613, #795) — see below.
- **Given** the close-out PR is created or already exists **When** the workflow reaches the auto-merge step **Then** `gh pr merge --auto --merge` is invoked; failure (e.g. "Allow auto-merge" disabled) → `::warning::`, non-fatal. **A PR authored by the default `GITHUB_TOKEN` is subject to GitHub's own `action_required` gate on its own `pull_request`-triggered checks** (actor `github-actions[bot]`) — the auto-merge armed here waits indefinitely on a required check (e.g. `Quality Gates`) that never runs until a maintainer manually clicks "Approve and run" once per PR. Confirmed live: `example-app` REQ-098's close-out PR (#650) sat `mergeStateStatus: BLOCKED` for this exact reason (devaudit#795). The checkout step and every `gh` call in this job authenticate as `${{ secrets.INSTALLER_DISPATCH_TOKEN || github.token }}` — when the optional secret is configured (a PAT/deploy token, classic `repo` scope or fine-grained Contents+Pull-requests read/write, on this repo), the PR is authored by that real, already-trusted account instead and is not subject to the gate; unset, behavior is unchanged from before this note (manual approval click still needed once per close-out PR). Same secret name and pattern as `DevAudit-Installer`'s own `hotfix-backmerge.yml`. **Given** the PR-opened/exists condition holds **When** the "Report close-out PR opened" step runs **Then** it resolves the release via `/api/ci/releases/resolve?projectSlug=...&versionPrefix=<REQ>` and POSTs `pr_opened`; any resolution failure (unconfigured base URL/key, unresolvable release, unresolvable PR) → `::warning::`, skipped, non-fatal — an older portal deployment that doesn't yet accept `pr_opened` must not break close-out. **Given** the same conditions **When** the completion-wait step polls and observes `MERGED` **Then** it POSTs `completed` with `mergeSha`; observes `CLOSED` (without merging) → skip, no report; polls exhaust (20 minutes) without merging → `::warning::` naming the manual catch-up path (`workflow_dispatch` with `release=<REQ>`, `release_pr=<PR>`). A duplicate `completed` report from `close-out-completion.yml` also firing (e.g. a genuinely human-authored merge, which that workflow still handles normally) is harmless — same already-true status.
- **Error paths:** Every network/resolution step in both status-report steps degrades to a `::warning::` and `exit 0` — none of this can fail the workflow job. `close-out-completion.yml` itself is left in place unmodified as the primary/authoritative completion signal for human-authored merges; this is a supplement for the auto-merge case specifically, not a replacement.
- **Fixtures/env:** `release-lifecycle-workflows.test.ts` asserts the auto-merge line's position relative to PR creation and the completion-wait step's non-fatal shape/ordering. Portal-stub fixtures: `pr_opened` accepted, `pr_opened` rejected (old portal, non-fatal), PR merged within poll window (completion reported), PR merged after poll window exhausts (warning + manual catch-up path), PR closed without merging (no report).

#### REQ-FRAMEWORK-VALIDATION-006 — close-out-reconcile.yml catches a missed release-closed dispatch on a daily schedule (#786)

- **Priority:** Should — `close-out-release.yml`'s `repository_dispatch` trigger is a single one-shot webhook with no consumer-visible retry; on project `example-app` it silently failed to fire for two consecutive real releases, leaving their tickets stale in `compliance/pending-releases/` for 1-3 days despite the code already being live on `main`. Complementary defense-in-depth, not a replacement for fixing the dispatch reliability gap portal-side (devaudit#833).
- **Source:** `sdlc/files/ci/close-out-reconcile.yml.template` (`on: schedule cron '17 6 * * *' + workflow_dispatch`), `sdlc/files/_common/scripts/close-out-reconcile.sh` (detection logic), registered in `cli/src/update/ci-templates.ts`'s `CI_TEMPLATES` list so `devaudit install`/`devaudit update` sync it like every other generated workflow.
- **Preconditions / inputs:** `compliance/pending-releases/RELEASE-TICKET-REQ-*.md` tickets on `develop`; `origin/main` fetched.
- **Given** the scheduled (or manually dispatched) run **When** `close-out-reconcile.sh` scans `compliance/pending-releases/` **Then** it prints one `REQ-XXX` per ticket whose REQ has a matching commit reachable from `origin/main` (subject `[REQ-XXX]` or body `Ref: REQ-XXX`) — i.e. the code demonstrably already shipped despite the ticket still being pending. **Given** at least one stale REQ is found **Then** the workflow triggers `close-out-release.yml`'s own `workflow_dispatch` for each one (`gh workflow run close-out-release.yml -f release=<REQ>`) rather than duplicating its reconciliation logic, and opens a tracking issue titled "Release close-out reconciliation: stale pending release(s) detected" listing what was (and wasn't) successfully triggered, for auditability. **Given** nothing is stale **Then** the job is a silent no-op — no dispatch, no issue.
- **Error paths:** A failed `gh workflow run` for one REQ is logged as `::warning::` and listed in the tracking issue's "Failed to trigger" section rather than aborting the scan for the remaining REQs. A failed `gh issue create` degrades to `::warning::`, non-fatal.
- **Fixtures/env:** `close-out-reconcile.test.sh` (self-contained git fixture: two REQs with commits on `main` but still pending, one REQ never shipped, one malformed ticket filename — asserts exactly the two genuinely stale REQs are reported and nothing else). `release-lifecycle-workflows.test.ts` asserts the workflow's schedule/dispatch shape, the trigger-not-duplicate design, the tracking-issue step, and CI_TEMPLATES registration.

---

#### REQ-FRAMEWORK-APPROVAL-001 — check-release-approval.yml runs as the PR-to-main merge gate

- **Priority:** Must — this is the four-eyes release-approval gate that blocks production merge.
- **Source:** `sdlc/files/ci/check-release-approval.yml.template` (`on: pull_request: branches:[main]`, `workflow_dispatch`): job `check-approval` (`name: DevAudit Release Approval`) on `{{RUNNER}}`, env `PROJECT_SLUG: {{PROJECT_SLUG}}`, checks out `github.event.pull_request.head.sha` with `fetch-depth: 0`.
- **Preconditions / inputs:** PR from develop to main; `DEVAUDIT_API_KEY` secret; `devaudit.base_url` in sdlc-config.json (or deprecated Variable).
- **Given** the rendered `check-release-approval.yml` **When** a PR to main is opened **Then** the gate runs against the PR head SHA (not the synthetic merge commit, so `derive-release-version.sh` sees the `[REQ-XXX]` tag, #81).
- **Error paths:** No base URL configured → `::error::` exit 1.
- **Fixtures/env:** Rendered repo with a develop→main PR; portal stub.

#### REQ-FRAMEWORK-APPROVAL-002 — Gate blocks merge unless the resolved release is approved

- **Priority:** Must — the load-bearing blocking behaviour of the entire compliance flow.
- **Source:** `sdlc/files/ci/check-release-approval.yml.template` steps `Resolve current release` (`if: BOOTSTRAP_MODE != 'true'`; derives prefix via `derive-release-version.sh`, polls `GET ${BASE}/api/ci/releases/resolve?projectSlug=…&versionPrefix=…` up to 6× × 10s; reads `.latest.status`) and `Enforce release approval` (runs after the PR-link steps, #973); passes only when status ∈ `{uat_approved, prod_review, prod_approved, released}`; every other status fails with `::error::` exit 1 — the portal vocabulary being `draft`, `uat_review`, `uat_changes_requested`, `uat_rejected`, `uat_approved`, `released`, `superseded` and `deferred`, with a specific message for `deferred` (parked, not approved; resume it in the portal or promote it through a successor release that lists it under `Absorbed predecessor releases`, #980).
- **Preconditions / inputs:** A registered release (from ci.yml `register-release`); a reviewer has approved in the portal.
- **Given** a PR to main with a resolvable release **When** the release status is approved (`uat_approved`+) **Then** the gate passes and merge is allowed; **When** the status is unapproved (e.g. `draft`, `uat_review`, `uat_rejected`; `uat_pending` was a stale name and is not a portal status) **Then** the gate fails and merge is blocked. **When** no release resolves after 6 attempts **Then** `::error::No release found … Push to develop first` + exit 1.
- **Error paths:** Race with `register-release` handled by the 6×10s retry; no release = hard fail.
- **Fixtures/env:** Portal stub returning each status value (including `deferred`, asserting the specific message and a failing gate); assert pass/fail per status. `deferred` must never be in the approved set (`cli/test/release-lifecycle-workflows.test.ts`).

#### REQ-FRAMEWORK-APPROVAL-003 — Bootstrap mode passes the gate on the introducing PR

- **Priority:** Must — without it the first PR introducing the framework could never merge (#301).
- **Source:** `sdlc/files/ci/check-release-approval.yml.template` step `Resolve DevAudit base URL`: missing `DEVAUDIT_API_KEY` → `::notice::` + `BOOTSTRAP_MODE=true` + exit 0; project probe `GET /api/ci/projects/<slug>` — 404 cross-checked against `/api/ci/releases/resolve?versionPrefix=v`: both 404 → bootstrap (gate passes); resolve 2xx while projects 404 → `::error::` fail-closed (portal bug, #74/#75); 401/403 → fail.
- **Preconditions / inputs:** First framework-introducing PR (no API key yet, or project not yet auto-created).
- **Given** the gate **When** the API key secret is unset OR the project 404s on both endpoints **Then** `BOOTSTRAP_MODE=true`, the gate passes, and the resolve/link/SHA steps are skipped (`if: BOOTSTRAP_MODE != 'true'`). **When** the projects endpoint 404s but releases/resolve confirms the project (2xx) **Then** the gate fails closed (avoids silently bypassing four-eyes).
- **Error paths:** 401/403 on either probe → invalid key → exit 1; unexpected codes → exit 1.
- **Fixtures/env:** Portal stub with/without project; with/without API key.

#### REQ-FRAMEWORK-APPROVAL-004 — Gate links the PR to the release and posts a portal link comment

- **Priority:** Should — traceability side-effects; not the blocking decision itself.
- **Source:** `sdlc/files/ci/check-release-approval.yml.template` steps `Link PR to release` (`PATCH ${BASE}/api/ci/releases/<id>` with `prInfo`), `Post release link on PR` (`gh pr comment`/patch existing `**DevAudit Release:**` comment), `SHA comparison` (warn if `approved_sha != PR head sha`), `Create refreshed PR check run (workflow_dispatch / repository_dispatch re-trigger)` (creates a fresh success check run on the approved SHA via `gh api … /check-runs`).
- **Preconditions / inputs:** Non-bootstrap; `github.token` for `gh`; pull_request or workflow_dispatch event.
- **Given** a non-bootstrap PR **When** the gate passes **Then** the release record is PATCHed with the PR url/number, a `**DevAudit Release:**` comment is posted/updated, and a SHA-drift `::warning::` appears if the approved SHA differs from PR HEAD. **When** re-triggered via `workflow_dispatch` or `repository_dispatch` **Then** a fresh success `DevAudit Release Approval` check run is created on the approved PR head SHA.
- **Error paths:** `gh` failures degrade to `|| true` / warnings; no open PR on dispatch → status update skipped.
- **Fixtures/env:** PR fixture + portal/gh stubs; an approved-SHA mismatch fixture.

---

#### REQ-FRAMEWORK-APPROVAL-005 — PR is linked to the release before the approval gate fails (#973)

- **Priority:** Should — traceability; ensures the portal `pr_url`/`pr_number` are set while the release is still draft.
- **Source:** `sdlc/files/ci/check-release-approval.yml.template` step order: `Resolve current release` (always outputs `release_id`/`version`/`status`/`approved_sha`; fails only if no release exists after its retries) → `Link PR to release` → `Post release link on PR` → `Enforce release approval` (the `case "$STATUS"` gate, unchanged error text) → `SHA comparison` → `Create refreshed PR check run`.
- **Preconditions / inputs:** Non-bootstrap, non-standalone `pull_request` run against a release whose status is not yet approved.
- **Given** a PR to main with a `draft` release **When** `Check Release Approval` runs **Then** the release is PATCHed with `prInfo` and the `**DevAudit Release:**` comment is posted, and only then `Enforce release approval` fails with `release approval required`. **When** the release is approved **Then** all steps run and the SHA comparison still runs (only reachable for approved releases). Bootstrap and standalone-housekeeping runs skip all of these steps as before.
- **Error paths:** No release found → `Resolve current release` fails and nothing is linked; PR check stays red until approval.
- **Fixtures/env:** Workflow-text test in `cli/test/release-lifecycle-workflows.test.ts` pinning the step order.

#### REQ-FRAMEWORK-POSTDEPLOY-001 — post-deploy-prod.yml runs read-only prod verification on push to main

- **Priority:** Should — production verification + promotion; read-only by design.
- **Source:** `sdlc/files/ci/post-deploy-prod.yml.template` (`on: push: branches:[main]`, `workflow_dispatch` with `release` input): job `production-evidence`, env `PROD_URL: secrets.{{PRODUCTION_URL_SECRET}}`. Steps wait for prod (curl until 2xx/3xx, 30×10s), run read-only smoke (health curl + security-header grep, writes `prod-smoke-results.json`); never runs E2E/DB/API mutations.
- **Preconditions / inputs:** railway host (push-to-main auto-deploy); `{{PRODUCTION_URL_SECRET}}` secret set; `DEVAUDIT_API_KEY`.
- **Given** the rendered `post-deploy-prod.yml` **When** a commit lands on main **Then** it polls `${PROD_URL}/` until healthy then asserts the health check returns 2xx/3xx (else `::error::Production health check failed` exit 1) and writes smoke evidence JSON; **When** prod never comes up **Then** the wait loop exhausts and the subsequent health check fails.
- **Error paths:** Health check <200 or ≥400 = hard fail; security-header grep is non-blocking (`|| true`).
- **Fixtures/env:** Prod URL stub returning healthy/unhealthy; `{{PRODUCTION_URL_SECRET}}` secret.

#### REQ-FRAMEWORK-POSTDEPLOY-002 — Promotes every in-scope release and uploads production evidence (stage 5)

- **Priority:** Should — advances release status to the terminal state, the last step of the release lifecycle.
- **Source:** `sdlc/files/ci/post-deploy-prod.yml.template` steps `Resolve in-scope releases` (all `compliance/pending-releases/RELEASE-TICKET-REQ-*.md`, or `release` input, or bare-date fallback) and `Promote in-scope releases`: per release resolves version, uploads `prod-smoke-results.json` as `test_report`/`--environment production` with `--sdlc-stage 5` and the release ticket as `compliance_document`/`release_artifact` with `--sdlc-stage 5`, then `PATCH /api/ci/releases/<id>` to `${TERMINAL_STATUS}`.
- **Preconditions / inputs:** `sdlc-config.json` `production_review.terminal_status` ∈ {`prod_review` (default), `released`}; pending release tickets or `release` dispatch input.
- **Given** a develop→main merge bundling several REQs **When** the workflow runs **Then** ALL in-scope releases are promoted to `${TERMINAL_STATUS}` (not just the first) with production smoke + ticket evidence attached (both carrying `sdlcStage=5`); status PATCH is idempotent. **When** `terminal_status` is invalid **Then** `::error::` exit 1. **When** `prod_review` **Then** a human must click Approve/Mark-as-Released in the portal; **When** `released` **Then** auto-release (v1.21.x behaviour).
- **Deferred tickets (#956, fixed in phase 3b):** deferred tickets stay in `compliance/pending-releases/` (ADR-002) but are no longer part of the in-scope set: the `Resolve in-scope releases` step skips each with `Skipping <REQ>: deferred (Release intent: deferred-to-next)` (REQ-FRAMEWORK-DEFERRAL-005), so a deferred REQ's release is never promoted, never receives production evidence and is never status-PATCHed. If every pending ticket is deferred the step says so and takes the existing no-tracked-ticket path (standalone housekeeping declaration, else no portal promotion).
- **Error paths:** No `release_id` resolved → `::warning::` skip status patch for that release; evidence uploads `|| echo Warning` (soft).
- **Fixtures/env:** Portal stub recording PATCH status + uploads (asserting `sdlcStage=5`); multi-REQ pending-tickets fixture; both terminal_status values.

---

#### REQ-FRAMEWORK-POSTDEPLOY-003 — Post-deploy smoke failure files incident issue with structured sections (#210 AC28-AC29)

- **Priority:** Should — production smoke failures must file an incident issue for traceability and post-incident review.
- **Source:** `sdlc/files/ci/post-deploy-prod.yml.template` incident step: on smoke test failure, the workflow files a GitHub issue with `incident` label and structured sections (`### Framework attribution`, `### Smoke failure detail`, `### Production URL`, `### Release version`); the issue is cross-referenced with the release ticket.
- **Preconditions / inputs:** Smoke test failure; `GH_TOKEN` with issue-write permission; `incident` label exists.
- **Given** a post-deploy smoke test failure **When** the incident step runs **Then** it files a GitHub issue with `incident` label, structured sections, and release version cross-reference; **When** the smoke test passes **Then** no incident is filed.
- **Error paths:** Issue-create failure degrades to warning (smoke failure still fails the job).
- **Fixtures/env:** Smoke test failure fixture; gh stub recording issue creation; smoke pass fixture (expect no issue).

---

#### REQ-FRAMEWORK-LABELRET-001 — label-retention.yml enforces incident label survives to issue close (#210 AC1-AC5)

- **Priority:** Must — the `incident` label must survive to issue close so `incident-export.yml` fires and evidence lands on the portal.
- **Source:** `sdlc/files/ci/label-retention.yml.template`: runs on `issues: types: [labeled, unlabeled, reopened]`; if the `incident` label is removed from an issue that had it, the workflow re-applies it with a comment explaining the enforcement. A daily cron scan catches any issues where the label was removed between events (belt-and-suspenders). Opt-in via `sdlc-config.json: incident_label_retention: true`.
- **Preconditions / inputs:** `incident` label exists in the repo; `sdlc-config.json` with `incident_label_retention: true`; `GH_TOKEN` with label-write permission.
- **Given** an issue with `incident` label **When** the label is removed **Then** the workflow re-applies it within seconds and posts a comment explaining the enforcement; **Given** the daily cron runs **When** it finds an issue that lost the label **Then** it re-applies it. **Given** `incident_label_retention` is not set or false **Then** the workflow does not run.
- **Error paths:** Label-write failure → warning (non-blocking); issue not found → skip.
- **Fixtures/env:** Issue with `incident` label removed (expect re-applied); issue without `incident` label (expect no action); opt-out config fixture.

---

#### REQ-FRAMEWORK-SDLCSTAGE-001 — `upload-evidence.sh --sdlc-stage` flag validates 1-5 and forwards as `sdlcStage` multipart field

- **Priority:** Should — the SDLC-stage dimension lets the portal group evidence by stage and drive a stage-aware completeness matrix; the flag is optional and backwards-compatible (older portals ignore it).
- **Source:** `scripts/upload-evidence.sh` (`SDLC_STAGE` variable, arg parser `--sdlc-stage) SDLC_STAGE="$2"; shift 2`, validation `[[ "$SDLC_STAGE" =~ ^[1-5]$ ]]`, CURL_ARGS `-F "sdlcStage=${SDLC_STAGE}"`).
- **Preconditions / inputs:** `--sdlc-stage <1-5>` passed on the command line; the portal's `POST /api/evidence/upload` endpoint.
- **Given** a valid `--sdlc-stage` value (1-5) **When** the uploader runs **Then** the multipart form includes `sdlcStage=<value>` so the portal can store and display it. **Given** an invalid value (e.g. `9`, `abc`) **When** the uploader runs **Then** it prints `Error: --sdlc-stage must be an integer 1-5 (got: <value>)` to stderr and exits 1 before any HTTP call. **Given** the flag is omitted **Then** no `sdlcStage` field is sent (older portals are unaffected; the portal defaults to `unspecified` server-side).
- **Error paths:** Invalid value → exit 1 with the validation error message; absent flag → no field sent (no error).
- **Fixtures/env:** Stub portal asserting the `sdlcStage` form field; invoke `upload-evidence.sh` with valid (1-5), invalid (9, abc), and omitted values.
- **Stage mapping (reference — encoded by the CI templates):**

  | Source                                                                                                     | Stage                                      |
  | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
  | `ci.yml` gate evidence + per-AC evidenceShot screenshots                                                   | **2** (implement & test)                   |
  | `compliance-evidence.yml` committed docs (RTM, plans, srs/adr/risk, test-exec-summary, tickets, audit-log) | **3** (compile-evidence)                   |
  | `compliance-evidence.yml` E2E report — PR-to-develop                                                       | **2** (implement & test)                   |
  | `compliance-evidence.yml` E2E report — push-to-main                                                        | **5** (deploy)                             |
  | `feature-e2e.yml` feature-branch run                                                                       | **2** (implement & test, `origin=feature`) |
  | `post-deploy-prod.yml` smoke + ticket                                                                      | **5** (deploy)                             |

---

#### REQ-FRAMEWORK-FEATUREE2E-001 — `feature-e2e.yml` runs in-scope E2E on PRs to develop, uploads stage-2 origin=feature evidence

- **Priority:** Should — surfaces feature-branch E2E regressions during the feature cycle (issue #174) rather than at the release gate; evidence is tagged `origin=feature` so the portal does NOT count it as release/UAT evidence.
- **Source:** `sdlc/files/ci/feature-e2e.yml.template` (`on: pull_request: branches: [develop]`): job `detect-req` (checkout with `fetch-depth: 0`) resolves the in-scope REQ primarily by scanning the PR's own commits (`git log "${BASE_SHA}..HEAD" --pretty=%B`, `BASE_SHA` from `git merge-base "origin/${BASE_REF}" HEAD`) for `Ref: REQ-XXX` trailers or `[REQ-XXX]` tags — commitlint already enforces the trailer on every `feat`/`fix`/`refactor`/`perf` commit — falling back to a `REQ-[0-9]+` regex on `github.head_ref` only when zero commits in range carry a trailer (commit `400d1c6`, #580). Then checks for matching `@requirement REQ-XXX` tags in `e2e/**/*.spec.ts`; job `run-feature-e2e` (needs `detect-req`, `if: has_tests == 'true'`) includes a `services:` block (`{{DATABASE_SERVICE}}`/`{{DATABASE_IMAGE}}`/`{{DATABASE_PORT}}`), `{{DATABASE_AND_APP_ENV}}` env block (a merged, deduped token as of devaudit-installer#928 — see REQ-FRAMEWORK-RENDER-002), `{{DATABASE_URI_STEP}}` for dynamic port resolution, `{{E2E_SETUP_STEP}}` for pre-test seeding, dev server startup (`{{E2E_DEV_SERVER_STEP}}`) + `wait-on http://localhost:3000`, `E2E_NEW_SPECS` computation for origin tagging, and `{{E2E_FEATURE_TEST_STEP}}` (built by `buildFeatureE2eTestStep` in `ci-templates.ts`) which runs `npx playwright test --grep "$REQ_ID" --reporter=json,html` with `e2e_env` threaded onto the Playwright process. Zips `playwright-report/` into `playwright-report.zip` and uploads via `scripts/upload-evidence.sh` as `test_report` with `--sdlc-stage 2`, `--meta-key "origin=feature"`, `--release "$REQ_ID"`, `--create-release-if-missing`, `--environment uat`. Registered in `cli/src/update/ci-templates.ts` `CI_TEMPLATES` array as `'feature-e2e.yml.template'`. Block tokens are substituted by `substituteBlocks` and `services:` is stripped by `stripServicesBlock` when no `database_service` is configured — same rendering pipeline as `ci.yml.template`.
- **Preconditions / inputs:** PR to `develop` whose commit range (base..HEAD) carries at least one `Ref: REQ-XXX`/`[REQ-XXX]` trailer, OR (fallback) a branch name containing `REQ-XXX`; E2E specs tagged `@requirement REQ-XXX`; `DEVAUDIT_API_KEY` secret + base URL (from `sdlc-config.json` or `DEVAUDIT_BASE_URL` var); `sdlc-config.json` with `database_service`, `e2e_start_command`, `e2e_setup_command` (optional), `e2e_env` (optional) for infrastructure rendering.
- **Given** a PR to develop whose commits carry exactly one distinct `Ref: REQ-123` trailer (regardless of branch name) **When** E2E specs tagged `@requirement REQ-123` exist **Then** the workflow starts the database service container, runs E2E setup (if configured), starts the dev server, waits for it through an outer 150-second process deadline plus `wait-on`'s 120-second diagnostic timeout, computes `E2E_NEW_SPECS`, runs only the tagged specs (`--grep`), zips the Playwright report, and uploads it as `test_report` with `sdlcStage=2` and `origin=feature` metadata. **Given** no commit in range carries a trailer **When** the branch name matches `REQ-[0-9]+` **Then** that REQ is used as a fallback. **Given** neither source yields a REQ, or the commit range carries multiple distinct REQ trailers the branch name can't disambiguate **Then** `req_id=none`, `has_tests=false`, the E2E job is skipped, AND a visible `::warning::` is emitted naming the reason (no silent skip, #580) — distinct wording for "no REQ found" vs. "multiple distinct REQs, ambiguous." **Given** DevAudit is not configured (no base URL or API key) **Then** a `::warning::` is emitted and the upload is skipped (exit 0, not a failure). **Given** no `database_service` in config **Then** `stripServicesBlock` removes the `services:` block and `{{DATABASE_*}}` tokens render empty (DevAudit-Installer#186).
- **Error paths:** Upload failure → `::warning::feature E2E report upload failed` (soft, does not fail the job); missing `playwright-report/` dir → upload skipped; missing `e2e-results.json` → evidence-completeness gate in `ci.yml` (CIYML-011) will flag the REQ; no REQ resolved from either trailer scan or branch name → visible `::warning::`, job skipped (soft, does not fail the workflow — this is the #580 fix: previously silent).
- **Transport-layer REQs (#1067):** when the upload step finds no `evidenceShot` screenshots it runs `scripts/is-transport-layer-req.sh <REQ>`; if at least one spec is tagged `@requirement <REQ>` and none of the tagged specs uses the `page` fixture it logs a `::notice::` and continues (the evidence is the JSON report and `test-execution-summary.md`), otherwise it fails with `No evidenceShot screenshots were captured` as before. Tested by `sdlc/files/_common/scripts/is-transport-layer-req.test.sh` and `cli/test/test-tiers.test.ts` "feature-e2e.yml screenshot gate".
- **Fixtures/env:** Rendered consumer with a `Ref: REQ-123` trailer on an off-convention branch name (e.g. `fix/603-post-merge-fixes`) + tagged E2E specs + `database_service: mongodb` — asserts trailer resolution overrides the branch-name miss; a branch with no trailer anywhere but a matching `REQ-XXX` name (fallback path); a PR with commits carrying two distinct REQ trailers and an ambiguous branch name (multi-REQ warning + skip); a PR with neither trailer nor branch match (no-REQ warning + skip); a config without `database_service` to assert `stripServicesBlock`.

#### REQ-FRAMEWORK-E2EREGRESSION-001 — `e2e-regression.yml` is an opt-in three-tier (smoke/critical/regression) E2E gating template (#821)

- **Release gate (#1059):** the tier that runs on the PR into the release branch, the post-deploy run and an optional schedule are configurable (REQ-FRAMEWORK-RELGATE-001..003); with the keys absent the triggers, selector and metadata are unchanged.
- **Priority:** Could — a full-regression safety net most consumers don't need (a ~55-minute job); genuinely reusable for the ones that do. Templates the fix already validated on `example-app`'s hand-rolled equivalent (`#793`/PR #803) rather than the "obvious" but disproven `npm run build && npm run start` fix (that silently enables Next.js production-only `<Link>` prefetching, breaking any `waitForLoadState('networkidle')` call with reproducible timeouts) — the template encodes the corrected warm-up-step fix from the start.
- **Source:** `sdlc/files/ci/e2e-regression.yml.template`; `cli/src/update/ci-templates.ts` (`e2e_regression_enabled` config field, the `CI_TEMPLATES` array entry, the conditional-skip in the render loop, the disabled-cleanup sweep before the per-target loop, `buildE2eRegressionServerStep`, `buildE2eRegressionJobEnv`).
- **Preconditions / inputs:** `sdlc-config.json.e2e_regression_enabled === true` — settable without hand-editing via `devaudit update --enable-e2e-regression` / `--disable-e2e-regression` (REQ-CLI-UPDATE-024, #876); the same flag also keeps/strips `compliance-evidence.yml`'s E2E Regression listener (REQ-FRAMEWORK-EVIDENCE-001, #869). When introduced, this was the first whole-file-conditional template (every other `CI_TEMPLATES` entry was unconditionally generated; `reconcile-deployment.yml` has since become the second, keyed on host — REQ-FRAMEWORK-CIYML-022) — confirmed via reading the sync loop that no prior entry has this shape, only conditionally-stripped *blocks* within an always-generated file (e.g. `!cfg.database_service → stripServicesBlock`).
- **Given** `e2e_regression_enabled` is unset/false **When** `syncCiTemplates` runs **Then** `e2e-regression.yml.template` is skipped entirely (`if (tmpl === 'e2e-regression.yml.template' && !cfg.e2e_regression_enabled) continue`) and any previously-generated `e2e-regression.yml` (or a multi-target-namespaced `e2e-regression-<target>.yml`) already in `.github/workflows/` is removed via `removeManaged` (`/^e2e-regression(-.+)?\.yml$/` sweep) — **manifest-driven since devaudit-installer#930**: deleted only if unmodified since the last sync; a hand-edited stale copy is kept and reported as a conflict instead of silently deleted or silently left behind (REQ-CLI-UPDATE-030). **Given** it is `true` **Then** the file is generated with `{{DATABASE_SERVICE}}`/`{{DATABASE_IMAGE}}`/`{{DATABASE_PORT}}` (reused, not a new mechanism), a job-level `env:` block combining `database_env` + `app_env` + `e2e_env` (own-header-if-content pattern, same shape as `QUALITY_GATES_ENV`; `app_env` added devaudit-installer#922 — this workflow starts the same dev server `ci.yml.template`/`feature-e2e.yml.template` do, and both of those already thread `app_env` job-wide because the server needs its own runtime config, e.g. a Next.js app's `NEXT_PUBLIC_*` vars and session secret, to boot at all, distinct from `e2e_env`'s test-only credentials/flags — this template simply never had it wired in from #821), `{{CHECKOUT_CLEAN}}`, `{{E2E_PORT}}`, `{{E2E_SETUP_STEP}}` (reused from `e2e_setup_command`), and a dedicated background-start-with-pid-capture "Start dev server" step (`buildE2eRegressionServerStep` — distinct from `{{E2E_DEV_SERVER_STEP}}`'s blocking-foreground shape, since this workflow needs an explicit "Stop dev server" step regardless of test outcome).
- **Env-key collision handling (devaudit-installer#928):** `buildE2eRegressionJobEnv` combines the three sources via `mergeEnvSources(cfg.database_env, cfg.app_env, cfg.e2e_env)` (`Object.assign({}, ...)`, later sources winning), not string concatenation — a key set in more than one source (e.g. `MONGODB_DB_NAME`, needed by both the app to boot and the E2E seed to reach the same database) previously produced a job-level `env:` block with a duplicate YAML key (invalid YAML, rejected at parse time); it now renders once, with `e2e_env`'s value winning over `app_env`'s, which wins over `database_env`'s.
- **Given** the rendered workflow runs **Then** it implements three tiers: `pull_request` (to `{{RELEASE_BRANCH}}`) selects the `critical` Playwright project (falling back to `smoke` with a `::warning::` if `critical` isn't defined in `playwright.config.ts` yet), a successful `deployment_status` (environment `production`/`prod`/ending `/ production`) selects `regression` and, on failure, auto-files a `bug, priority:high` GitHub issue naming the failing specs, and `workflow_dispatch` runs `regression` with an optional `specs` input (space-separated paths or `--grep` pattern) for scoped fix-and-verify iterations. A "Warm up dev-compiled routes" step (post-`wait-on`, pre-test-selection) pre-compiles every route the suite visits, mined via `grep -ohrE "page\.goto\('/[^']*'\)" e2e/` — assumes specs consistently write literal `page.goto('/path')` calls; a spec building paths dynamically just contributes no route (loop tolerates zero matches), not a hard failure.
- **Extension point: `e2e/ci-reliability/regression-run.sh` (devaudit-installer#928).** The "E2E Regression Tests" step checks for this fixed, undeclared path (no `sdlc-config.json` field controls it — devaudit never creates, overwrites, or deletes it) before running its default command. **Given** the file exists at that path **When** the step runs **Then** `bash e2e/ci-reliability/regression-run.sh` runs instead of the default `npx playwright test` invocation, with the step's own `env:` threading `PROJECT`/`SPECS` (the "Determine E2E project + spec selector" step's outputs) and `E2E_PORT`, plus everything in the job-level env (the merged `database_env`/`app_env`/`e2e_env` above) inherited as ordinary process env; the script's own exit code becomes `$STATUS`, mapped to the metadata `outcome` (`0`→`passed`, `124`→`timed_out`, anything else→`failed`) the same way the default path's exit code is. **Given** the file does not exist **Then** the default command runs exactly as before this REQ. The script is expected to merge any sharded outputs into the unsuffixed `e2e-regression-results.json` before exiting, since `compliance-evidence.yml`'s incident-triage step reads that exact filename, not a glob.
- **Widened artifact-upload globs (devaudit-installer#928):** the `e2e-regression-report` artifact's `path:` block uses `e2e-regression-results*.json`, `playwright-report*/`, `test-results*/`, `e2e-server*.log` — supersets of the pre-#928 fixed names, so a hook script's shard-numbered outputs (e.g. `playwright-report-shard-1/`) are captured without any further CI-workflow change, and the default (no-hook) path's fixed-name outputs still match.
- **`e2e_regression_timeout_minutes` config key (devaudit-installer#928):** the job's `timeout-minutes` (default 55) is rendered from this optional `sdlc-config.json` number field via the `{{E2E_REGRESSION_TIMEOUT_MINUTES}}` token, rather than hardcoded — a GitHub Actions job-level timeout is evaluated before any step (including a hook script) runs, so a script cannot raise it at runtime; this is deliberately a config key, not sharding-specific tuning, and applies identically whether or not a hook script is present. The "Record E2E execution context" step's `e2e-regression-metadata.json.timeout_minutes` field reflects this config value when a hook script is present (its budget is the meaningful one to record, since the script manages its own internal timing) or the hardcoded `40` (the default path's Playwright inner timeout) otherwise.
- **`e2e_concurrency_group` / `e2e_concurrency_cancel_in_progress` config keys (devaudit-installer#969):** the workflow's `concurrency:` body is rendered from the `{{E2E_REGRESSION_CONCURRENCY}}` block (`buildE2eRegressionConcurrency`). **Given** `e2e_concurrency_group` is unset/empty **Then** the output is byte-for-byte the original `group: ${{ github.workflow }}-${{ github.ref }}` / `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. **Given** it is set **Then** that string is the fixed group for every trigger (PR, `workflow_dispatch`, post-deploy; quoted if not a plain YAML scalar) and `cancel-in-progress` is `false` unless `e2e_concurrency_cancel_in_progress: true`. GitHub keeps one running and one pending run per group, so a newer queued run replaces an older queued one (documented in `docs/e2e-test-tiers.md`). The proposed `devaudit doctor` non-disposable-backend warning is not implemented (doctor checks are pass/fail only; a heuristic would risk false failures). Covered by `cli/test/e2e-concurrency.test.ts`.
- **Error paths:** Missing `playwright.config.ts` `critical` project on the PR-to-main path → falls back to `smoke`, warns, does not fail. `E2E Regression Tests` exceeding its execution budget (the default path's hardcoded 40-minute inner `timeout`, or a hook script's own budget) → `timed_out` outcome recorded in `e2e-regression-metadata.json`, non-zero exit. `Stop dev server`, artifact upload, and the hotfix-issue step all run with `if: always()`/`continue-on-error` so a mid-suite failure doesn't lose evidence.
- **Fixtures/env:** Real end-to-end sync test (`cli/test/update.test.ts`) — disabled by default (workflow count matches the pre-#821 baseline), enabled renders the file with every token correctly substituted (no literal `{{...}}` remaining except legitimate `${{ github.* }}` GitHub Actions expressions) and passes `expectAllWorkflowsValidYaml`, then disabling after a prior enabled sync removes the file. `cli/test/release-lifecycle-workflows.test.ts` — source-assertion tests confirming the warm-up pattern (not `npm run build`) and the conditional-generation code path. The `describe('e2e-ci-reliability hook: e2e/ci-reliability/regression-run.sh (#928)')` block covers: no-hook output unchanged in shape/behaviour; `PROJECT`/`SPECS`/`E2E_PORT`/job-level-env threading; exit-code-to-outcome mapping shared by both branches; `e2e_regression_timeout_minutes` honored at both the job-level `timeout-minutes:` and the hook-path metadata budget; and one test that extracts the rendered step's actual `run:` script and executes it in bash against a real (fake) hook script on disk, proving the hook is genuinely invoked and its exit code genuinely propagates — not just present in the rendered text. A separate `it('dedupes an overlapping key ...')` set (one per affected template: `e2e-regression.yml`, node `ci.yml`, `feature-e2e.yml`, Python `ci.yml`) covers the collision-handling REQ above, plus one disjoint-keys test confirming unaffected configs render identically.

---

#### REQ-FRAMEWORK-E2EREGRESSION-002 — e2e-regression.yml concurrency group is configurable via e2e_concurrency_group / e2e_concurrency_cancel_in_progress (#969)

- **Priority:** Could — only consumers whose E2E runs share mutable data (one database, one shared environment) need to serialise runs across triggers.
- **Source:** `sdlc/files/ci/e2e-regression.yml.template` (`{{E2E_REGRESSION_CONCURRENCY}}`); `cli/src/update/ci-templates.ts` (`buildE2eRegressionConcurrency`); `cli/src/lib/sdlc-config.ts` (`e2e_concurrency_group`, `e2e_concurrency_cancel_in_progress`).
- **Preconditions / inputs:** `e2e_regression_enabled` (REQ-FRAMEWORK-E2EREGRESSION-001).
- **Given** no `e2e_concurrency_group` (or a blank one) **Then** the rendered `concurrency:` block is the original `group: ${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`, byte for byte as before #969.
- **Given** a non-blank group **Then** `group:` is that value (quoted via `JSON.stringify` unless it matches `[A-Za-z0-9_./-]+`), shared by every trigger (PR, dispatch, post-deploy), and `cancel-in-progress` is `true` only when `e2e_concurrency_cancel_in_progress` is exactly `true`, otherwise `false`, so a run is never killed mid-mutation of shared data.
- GitHub keeps one running and one pending run per group: a newer queued run replaces an older queued one.
- **Error paths:** None; `e2e_concurrency_cancel_in_progress` without a group is ignored.
- **Fixtures/env:** `cli/test/e2e-concurrency.test.ts`.

#### REQ-FRAMEWORK-RENDER-001 — Scalar token substitution populates runner, slug, versions, gate params

- **Priority:** Must — every workflow's correctness depends on tokens being substituted; an unsubstituted `{{TOKEN}}` is a broken workflow.
- **Source:** `cli/src/lib/templates.ts:substituteTokens` (plain `split/join` per `{{KEY}}`); `cli/src/update/ci-templates.ts` token map: `PROJECT_SLUG`, `PRODUCTION_URL_SECRET`, `NODE_VERSION`, `PYTHON_VERSION`, `WORKING_DIRECTORY`, `WORKING_DIR_PREFIX`, `RUNNER`, `SOURCE_DIRS`, `SAST_BASELINE`, `ACCEPTED_DEP_RISKS`, `DATABASE_SERVICE/IMAGE/PORT`, `E2E_PROJECT`, `E2E_START_COMMAND`, `E2E_REGRESSION_TIMEOUT_MINUTES` (devaudit-installer#928, default `55`).
- **Preconditions / inputs:** `sdlc-config.json` with the listed keys (defaults from `sdlc/files/stacks/<stack>/adapter.json` `config_keys.defaults`).
- **Given** a consumer config (e.g. `runner: ubuntu-latest`, `project_slug: foo`) **When** `syncCiTemplates` renders a template **Then** every `{{RUNNER}}`→`ubuntu-latest`, `{{PROJECT_SLUG}}`→`foo`, `{{SAST_BASELINE}}`→config value, etc.; the rendered file contains no residual `{{…}}` scalar tokens.
- **Given** `runner: self-hosted` (the default for newly-onboarded projects — REQ-CLI-INSTALL-008) **When** CI workflows are rendered **Then** `resolveRunner()` (`cli/src/update/ci-templates.ts:236-240`) emits a dynamic expression selecting, in order, `workflow_dispatch.runner_label`, then repository/organization variable `CI_RUNNER_LABEL`, then the system default `github-ci` — which is itself mapped to `ubuntu-latest` (safe fallback so an unconfigured project never hangs waiting for a nonexistent `self-hosted` runner), with any other resolved value (e.g. `ostendo-workhorse-ci`) passed through as a literal label; workflows supporting manual dispatch expose the optional override without changing automatic-event routing.
- **Given** `sdlc-config.json` has no `runner` key **Then** it is treated as `self-hosted` (the `install` default) and renders the same dynamic expression; before devaudit-installer#984 it rendered `runs-on: ,`, invalid YAML in every workflow.
- **Error paths:** Other missing keys render to empty string (`?? ''`).
- **Fixtures/env:** Sample `sdlc-config.json`; assert rendered file substring matches.

#### REQ-FRAMEWORK-RENDER-002 — Block substitution renders/omits services, env, E2E, and paths blocks

- **Priority:** Must — block tokens carry whole YAML sections; an empty block must drop its line (else invalid YAML).
- **Source:** `cli/src/lib/templates.ts:substituteBlocks` (a line containing `{{KEY}}` is replaced wholesale; empty replacement drops the line — prevents stray newlines in `env:` blocks, a consumer v0.1.34); block map in `ci-templates.ts`: `PATHS_IGNORE`, `DATABASE_AND_APP_ENV`, `BUILD_ENV`, `DATABASE_URI_STEP`, `E2E_SETUP_STEP`, `E2E_DEV_SERVER_STEP`, `E2E_TEST_STEP`, `E2E_FEATURE_TEST_STEP`, `E2E_AUTHENTICATED_STEP`.
- **Preconditions / inputs:** `database_env`/`app_env`/`build_env`/`paths_ignore`/`e2e_*` config keys (any may be absent).
- **Given** a config without `app_env`/`build_env` **When** rendered **Then** the `{{DATABASE_AND_APP_ENV}}`/`{{BUILD_ENV}}` lines are dropped entirely (no blank line). **Given** `e2e_env` present **When** rendered **Then** `E2E_TEST_STEP`/dev-server/setup steps carry the env block at indent 10. **Given** `e2e_setup_command` absent **Then** no setup step is rendered (existing projects regenerate identical ci.yml).
- **`{{DATABASE_ENV}}`/`{{APP_ENV}}` collapsed into one token, deduped (devaudit-installer#928):** previously two separate block tokens, each independently populated by `cfg.database_env ? indentEnvBlock(...) : ''` / `cfg.app_env ? indentEnvBlock(...) : ''` and concatenated by template line order — a key set in both sources produced a duplicate YAML key. Now a single `{{DATABASE_AND_APP_ENV}}` token (in `ci.yml.template` and `feature-e2e.yml.template`) is populated by `renderEnvBareBlock(mergeEnvSources(cfg.database_env, cfg.app_env))`, deduping with `app_env` winning a collision. Renaming the token doesn't affect any consumer `.devaudit-patches`, since patches apply to rendered output, not templates.
- **Error paths:** Empty block string → line dropped; non-empty → block inserted.
- **Fixtures/env:** Configs with/without each block key; assert presence/absence of the section. `cli/test/update.test.ts`'s "#928" describe block covers the collision/dedup behavior specifically.

#### REQ-FRAMEWORK-RENDER-003 — services block stripped when no database_service configured

- **Priority:** Must — a `services:` block referencing an empty service name is invalid; node consumers without a DB must omit it.
- **Source:** `cli/src/lib/templates.ts:stripServicesBlock` (removes `^ {4}services:` through the next blank line); applied in `ci-templates.ts` `if (!cfg.database_service) content = stripServicesBlock(content)`. Default config (`write-config.ts`) sets `database_service:''`; railway adapter lists `database_*` as optional.
- **Preconditions / inputs:** `database_service` empty (default) vs set (e.g. `mongodb`).
- **Given** `database_service:''` **When** `ci.yml`/python `ci.yml` is rendered **Then** the entire `services:` block is removed from the output. **Given** `database_service:'mongodb'` + `database_port` **Then** the `services:` block remains with substituted `{{DATABASE_SERVICE/IMAGE/PORT}}` and the `DATABASE_URI_STEP` block renders the dynamic-port URI step (`buildDbUriStep` emits a step only when `database_service==='mongodb'`), exporting `mongodb://localhost:<dynamic port>` to every `*_URI` key in `database_env`, `build_env`, `app_env` or `e2e_env` whose value is a `mongodb://localhost` URI, else to `MONGODB_URI` (`mongoUriEnvNames`, #1042; it previously hardcoded one consumer's variable name for every consumer). Fixtures: `cli/test/ci-templates-mongo-uri.test.ts`.
- **Given** `database_service:'postgres'` (devaudit-installer#963) **Then** every `services:` block (`ci.yml`, python `ci.yml`, `feature-e2e.yml`, `e2e-regression.yml`) carries `env:` = `database_env` inside the service (job-level copy retained), `ports: ["<host>:5432"]` (bare `database_port` paired with the image default container port; a value containing `:` passes through), and `options: >- --health-cmd pg_isready ...`. `mongodb` output is unchanged. Covered by `cli/test/database-service.test.ts`.
- **Error paths:** Empty service but block not stripped would yield invalid YAML — the strip prevents this.
- **Fixtures/env:** Config with and without `database_service`; assert `services:` present/absent.

#### REQ-FRAMEWORK-RENDER-004 — Python stack renders the stack-specific ci.yml with python gates

- **Priority:** Should — node vs python is the primary stack divergence and must be observable in the rendered gates.
- **Source:** `cli/src/update/ci-templates.ts` template resolution (`sdlc/files/ci/<stack>/<name>` preferred over default); `sdlc/files/ci/python/ci.yml.template` (the only stack-specific override) with gates `ruff check` / `ruff format --check` / `mypy` / `semgrep` / `pip-audit` / `pytest --junit-xml` / `python -m build`; `defaults.run.working-directory: {{WORKING_DIRECTORY}}`; artifacts prefixed `{{WORKING_DIR_PREFIX}}`; uploads junit.xml as `e2e_result`. `sdlc/files/stacks/python/adapter.json` config defaults (`python_version:'3.11'`, `source_dirs:'src/'`).
- **Preconditions / inputs:** `ctx.stack === 'python'` (from `detect-stack.ts`, pyproject.toml detected); `python_version`, `working_directory` keys.
- **Given** a python consumer **When** CI templates are synced **Then** the rendered `ci.yml` uses `setup-python@v5`, runs ruff/mypy/semgrep/pip-audit/pytest/build as the gates (not tsc/npm/playwright), sets the job `working-directory`, and prefixes artifact paths with `WORKING_DIR_PREFIX`. **Given** a node consumer **Then** the default `sdlc/files/ci/ci.yml.template` (tsc + Playwright E2E) is used. All other templates (compliance-evidence, approval, post-deploy, etc.) have no python override and render from the shared default.
- **Error paths:** No stack-specific file → falls back to default template.
- **Fixtures/env:** Node and python `sdlc-config.json` fixtures; assert which gate steps appear.

#### REQ-FRAMEWORK-RENDER-005 — Railway host wiring: push-to-main deploy, prod URL from secret, no deploy step

- **Priority:** Should — host adapter dictates the deploy/verify shape observable in post-deploy-prod.yml.
- **Source:** `sdlc/files/hosts/railway/adapter.json` (`deploy_trigger: push_to_main`, `production_url_from: secret`, `production_url_secret_key: production_url_secret`, `wait_for_deploy` = the curl-poll loop, `required_secrets:[DEVAUDIT_API_KEY]`); matches `sdlc/files/ci/post-deploy-prod.yml.template` (`on: push: branches:[main]`, `PROD_URL: secrets.{{PRODUCTION_URL_SECRET}}`, the 30×10s wait loop). `detect-stack.ts` hardcodes `host:'railway'`.
- **Preconditions / inputs:** Host railway (current sole host); `production_url_secret` config key naming the repo secret.
- **Given** a railway consumer **When** post-deploy-prod.yml is rendered **Then** it triggers on push to main (Railway auto-deploys; no explicit CI deploy step), reads `PROD_URL` from the secret named by `{{PRODUCTION_URL_SECRET}}`, and waits for prod via the curl-until-2xx/3xx loop that matches the adapter's `wait_for_deploy`.
- **Error paths:** A non-railway host would supply a different deploy contract (out of scope until added).
- **Fixtures/env:** railway-config fixture; assert prod-URL secret reference + wait loop.

#### REQ-FRAMEWORK-RENDER-006 — Sync removes superseded workflows and writes all CI_TEMPLATES present

- **Priority:** Should — stale renamed workflows must be cleaned up; the full set must be regenerated each update.
- **Source:** `cli/src/update/ci-templates.ts`: `OLD_WORKFLOWS_TO_REMOVE = ['test-on-pr.yml','check-uat-approval.yml']` deleted if present; `CI_TEMPLATES` list of 11 templates iterated (including `feature-e2e.yml.template`), each rendered to `<name>.yml` in `.github/workflows/`; sync skipped if no `sdlc-config.json` or no `.github/workflows/` dir.
- **Preconditions / inputs:** Consumer has `sdlc-config.json` + `.github/workflows/`.
- **Given** an `update` run **When** `syncCiTemplates` executes **Then** `test-on-pr.yml` + `check-uat-approval.yml` are removed via `removeManaged` if present, and each available CI template is (re)written via `writeManaged` stripped of its `.template` suffix; **When** `sdlc-config.json` or `.github/workflows/` is absent **Then** the section is skipped (filesSynced 0). Three further removal sweeps run in the same section, undocumented before #931's audit: (1) **e2e-regression removal** (#821) — when `e2e_regression_enabled` is falsy, any `e2e-regression.yml` or multi-target-namespaced `e2e-regression-<target>.yml` already on disk is removed, so disabling the flag doesn't leave a stale workflow behind; (2) **reconcile-deployment removal** (#841) — when `ctx.host !== 'railway'`, any `reconcile-deployment.yml`/`reconcile-deployment-<target>.yml` is removed, since that workflow hardcodes the Railway CLI; (3) **multi-target stale-unsuffixed-file removal** — when a repo has more than one target (`resolveTargets(cfg).length > 1`), the unsuffixed output of every `CI_TEMPLATES` entry (e.g. a lone `ci.yml` left from before a second target was added) is removed, since every output this generator writes for a multi-target repo is now target-suffixed and an unsuffixed leftover would otherwise keep running as an extra, unscoped duplicate pipeline. **Corrected 2026-09-30 (devaudit-installer#930):** all four removals (the two old-workflow names plus these three sweeps) previously deleted unconditionally via `fs.rm` — every one now goes through `removeManaged`: deleted only if the on-disk content still matches what devaudit last recorded for that path; a hand-edited stale file is kept in place and reported as a conflict instead (REQ-CLI-UPDATE-030), never silently deleted and never silently left as a duplicate pipeline either.
- **Error paths:** A template with neither stack nor default file present is silently skipped (`continue`).
- **Fixtures/env:** Consumer with the old workflows present; assert removal + full regeneration count. `cli/test/update.test.ts` also covers the e2e-regression, reconcile-deployment, and multi-target stale-file removal sweeps (rewritten for #930 to record each stale file's hash in a manifest first, since an untracked pre-existing file is now correctly a conflict, not a silent delete). `cli/test/sync-manifest.test.ts` covers the modified-stale-file-kept-as-conflict path directly.

#### REQ-FRAMEWORK-RENDER-007 — `mergeEnvSources` dedupes overlapping env keys across combined sources, later source wins (#928)

- **Priority:** Must — before this, every site combining more than one env-key source did so by string concatenation with no dedup; a key set in more than one source produced a YAML `env:` block with a duplicate key, which is invalid YAML and fails to parse at all. Live on a real consumer: `MONGODB_DB_NAME` set in both `app_env` (the app needs it to boot) and `e2e_env` (the E2E seed needs the same database).
- **Source:** `cli/src/update/ci-templates.ts` (`mergeEnvSources`, `renderEnvHeaderBlock`, `renderEnvBareBlock`)
- **Preconditions / inputs:** Any combination of `database_env`/`app_env`/`e2e_env` (any may be absent).
- **Given** any two or more of these sources define the same key **When** a template is rendered **Then** `mergeEnvSources(...sources)` (`Object.assign({}, ...sources.filter(Boolean))`) produces one merged object with the later-listed source's value winning; every call site passes sources in a fixed precedence order: `database_env` < `app_env` < `e2e_env`. Three call sites use this: `buildE2eRegressionJobEnv` (`database_env`, `app_env`, `e2e_env` — REQ-FRAMEWORK-E2EREGRESSION-001), the Python `QUALITY_GATES_ENV` block (`database_env`, `app_env`), and the collapsed `{{DATABASE_AND_APP_ENV}}` token (`database_env`, `app_env` — REQ-FRAMEWORK-RENDER-002). `renderEnvHeaderBlock` supplies its own `    env:\n` header when the merged object is non-empty (used where the call site owns the whole `env:` key); `renderEnvBareBlock` renders bare indented entries with no header (used where the template already hardcodes the `env:` key above the token).
- **Given** all sources are absent or empty **When** rendered **Then** both wrappers return `''`, identical to pre-#928 behaviour for a config that sets none of these keys — this REQ changes collision handling only, not the empty-config or disjoint-keys output.
- **Error paths:** N/A — a pure function; the caller decides whether to render a header or bare block.
- **Fixtures/env:** `cli/test/update.test.ts`'s `#928`-tagged tests (one per affected rendered file: `e2e-regression.yml`, node `ci.yml`, `feature-e2e.yml`, Python `ci.yml`) assert a deliberately shared key across sources renders exactly once in the output, with the highest-precedence source's value, and that `expectAllWorkflowsValidYaml` (which already throws on a YAML duplicate-key parse error via `js-yaml`'s `load()`) passes; a disjoint-keys fixture asserts unaffected configs render identically to before.

---

#### Cross-area dependencies

- CIYML-006 (register-release) → APPROVAL-002: the approval gate's `releases/resolve` can only succeed if `register-release` (or a compliance-evidence.yml upload) created the release first; the 6×10s retry in APPROVAL-002 exists precisely to cover this race.
- CIYML-008 / EVIDENCE-003 share the **same release identity** via `scripts/derive-release-version.sh` (DevAudit #310): both must converge on one release record. APPROVAL-002 and POSTDEPLOY-002 reuse the same derivation for resolve/promote (#81).
- EVIDENCE-001 (workflow_run on `E2E Regression`) depends on a consumer-owned `E2E Regression` workflow that is NOT in this CI template set (3-tier gating model, v0.1.53) — an external producer.
- POSTDEPLOY-002 advances status set up by APPROVAL-002 (`uat_approved`→`prod_review`/`released`); the status enum is shared portal state.
- All EVIDENCE/APPROVAL/POSTDEPLOY base-URL resolution depends on `sdlc-config.json devaudit.base_url` (preferred) — a shared config contract; RENDER requirements ensure the slug/secret tokens that those API calls embed are substituted.
- All uploads route through `scripts/upload-evidence.sh` and `scripts/derive-release-version.sh` — consumer-side scripts shipped by the same installer (separate SRS area), so these CI requirements assume those scripts' contracts.
- SDLCSTAGE-001 (`--sdlc-stage` flag) is consumed by CIYML-008/009 (stage 2), EVIDENCE-003 (stage 3), EVIDENCE-006 (event-derived 2/5), FEATUREE2E-001 (stage 2), and POSTDEPLOY-002 (stage 5) — all depend on the uploader forwarding `sdlcStage` correctly.
- FEATUREE2E-001 depends on RENDER-006: the `feature-e2e.yml.template` must be registered in `CI_TEMPLATES` to be rendered on install/update.
- CIYML-011 (evidence-completeness gate) ← E2E-011 (Phase 5½ evidence wiring validation): the skill-side gate is the root-cause fix; the CI-side gate is the safety net. E2E-011 prevents specs from reaching CI without `evidenceShot()`/`@requirement` wiring; CIYML-011 catches any that slip through by checking the Playwright JSON for tagged tests.
- FEATUREE2E-001 depends on RENDER-002/RENDER-003: the `feature-e2e.yml.template` uses the same block tokens (`DATABASE_AND_APP_ENV`, `E2E_SETUP_STEP`, `E2E_DEV_SERVER_STEP`, `E2E_FEATURE_TEST_STEP`) and `stripServicesBlock` as `ci.yml.template` — the rendering pipeline must substitute and strip correctly for the workflow to be valid (DevAudit-Installer#186).

#### Notable findings

- **Failed gates still upload evidence** (CIYML-008, `if: always() && !cancelled()`, gateStatus=failed) — counter-intuitive but deliberate (#96/#132): `status=failed` IS the audit trail; suppressing it let broken releases ship.
- **Two distinct "missing-evidence fails the job" mechanisms** via `UPLOAD_FAILURES` (CIYML-008 gate+screenshot loop; EVIDENCE-006 E2E loop) — a portal 400 (e.g. mis-named screenshot) turns the release PR red rather than silently warning.
- **Node ci.yml resolves `sdlc-config.json` `devaudit.base_url` first and falls back to the deprecated repository variable `DEVAUDIT_BASE_URL`.** Registration and evidence upload skip with a visible warning only when neither source is configured.
- **Python ci.yml uploads SAST/dep as `audit_log`** (not the precise `sast_report`/`dependency_audit` types the node ci.yml uses post-#370) — the python template predates that refinement, so the portal's SAST vs Dependency panels may show identical content for python consumers (the exact bug #387 fixed for node).
- **Bootstrap fail-closed cross-check** (APPROVAL-003): a projects-endpoint 404 that releases/resolve contradicts (2xx) FAILS the gate rather than bootstrapping — explicitly preferring a hard stop over silently bypassing four-eyes (#74/#75).
- **Python register-release uses a different version-derivation** (bare-date + `nextSequenceVersion` from the portal) than node's `derive-release-version.sh` (REQ-tag), so python consumers' release identity is date-sequence-based, not REQ-based.
- **SDLC-stage dimension is shell-only.** The `--sdlc-stage` flag and `sdlcStage` multipart field exist only in `scripts/upload-evidence.sh`; the CLI `push` command (`ci-upload.ts`) does NOT send `sdlcStage`. CI templates all use the shell script (not the CLI), so stage stamping works in CI but not via `devaudit push`.
- **Feature-E2E evidence is display-only.** `feature-e2e.yml` uploads with `origin=feature` metadata; the portal must NOT count this as release/UAT evidence (pre-merge guard, issue #174). This is a portal-side contract — the installer only sets the metadata.
- **Feature-E2E template now mirrors ci.yml infrastructure.** `feature-e2e.yml.template` uses the same block tokens (`DATABASE_AND_APP_ENV`, `E2E_SETUP_STEP`, `E2E_DEV_SERVER_STEP`, `E2E_FEATURE_TEST_STEP`) and `stripServicesBlock` as `ci.yml.template` — without these, any consumer with a database, seeding, or auth env vars would see the workflow fail before tests execute (DevAudit-Installer#186).
- **Two-layer evidence completeness: skill + CI.** E2E-011 (Phase 5½) prevents specs from reaching CI without `evidenceShot()`/`@requirement` wiring; CIYML-011 catches any that slip through by checking the Playwright JSON for tagged tests when screenshots are zero. The skill gate is the root-cause fix; the CI gate is the safety net (DevAudit-Installer#169, #170).
- **Scope-expansion halt generalised to all phases.** IMPLEMENTER-019 extends the change-request loop's scope-expansion halt (change-request-loop.md) to fire on any user work request while a REQ is active, not just during Phase 5's `uat_changes_requested` state. Without this, scope-expanding requests during Phase 2–4 were silently implemented (DevAudit-Installer#171).

#### Assumptions — CI Templates

- The behaviour of `scripts/upload-evidence.sh`, `scripts/derive-release-version.sh`, `scripts/validate-compliance-artifacts.sh`, `scripts/validate-commits.sh`, `scripts/close-out-release.sh`, and the housekeeping/security-summary generators is treated as an external contract (separate SRS area); these requirements assert only that the workflows invoke them with the documented arguments/flags.
- The `E2E Regression` workflow consumed by EVIDENCE-006 is assumed to be a consumer-owned workflow outside this template set (referenced by name only); its artifact name `e2e-regression-report` and file layout are assumed stable.
- The CIYML-008 vs EVIDENCE-002 base-URL gating divergence (repo Variable `vars.DEVAUDIT_BASE_URL` vs `sdlc-config.json devaudit.base_url`) appears to be an in-progress migration rather than intended permanent behaviour; flagged as a possible defect, not encoded as a required behaviour.
- Only `railway` host and `node`/`python` stacks exist today; RENDER-005's host requirement is written against railway as the sole concrete host. The substitution engine itself is host-agnostic, so additional hosts would add adapter.json contracts without changing the substitution requirements.
- The `{{PATHS_IGNORE}}` token in `ci.yml` (`paths-ignore`) and `ci-status-fallback.yml` (`paths`) is rendered from the same `paths_ignore` array, making them exact inverses; this is assumed intentional (mixed commits trigger both with the same `Quality Gates` status name).

### Stack/Host Adapters, Governance Starters & AI Rule Files

This section specifies the black-box, observable contract of the DevAudit-Installer framework for three concerns that the `devaudit install` and `devaudit update` (and the standalone `devaudit bootstrap-governance`) commands render into a consuming repository: (1) **stack and host adapters** — how the installer picks node-vs-python and railway, and what quality-gate commands, hook frameworks, dev-deps, hooks and deploy bits each adapter substitutes; (2) the six **governance starter templates** — their required frontmatter, the "STARTER TEMPLATE — REPLACE BEFORE COMMITTING" banner, declared evidence type and framework clauses, and their opt-in / skip-if-exists semantics; and (3) the **single-source-of-truth AI rule files** synced per agent (CLAUDE.md, .cursorrules, .windsurfrules, GEMINI.md, INSTRUCTIONS.md) — the discovery contract that lets each agent find the SDLC. It also covers the verbatim sync of the stage docs (`0-project-setup.md` … `5-deploy-main.md`) and Tier-1 docs, and what `devaudit status` checks for their presence.

The observable contract is derived entirely from source: adapter manifests under `sdlc/files/stacks/` and `sdlc/files/hosts/`, the loader/resolver in `cli/src/lib/adapter.ts` and `cli/src/update/`, the install detector in `cli/src/install/detect-stack.ts`, the governance templates under `sdlc/files/_common/governance/`, and the rule-file writer `cli/src/update/ai-rules.ts`. Both `install` and `update` share the same render path: `cli/src/install/sync-templates.ts` calls `syncProject()` from `cli/src/update/index.ts`, so every requirement below applies identically on install and on update unless stated otherwise.

---

#### REQ-FRAMEWORK-ADAPTER-001 — Stack adapter resolved from sdlc-config.json, defaulting to node

- **Priority:** Must — the stack selection drives every downstream gate command, hook set and dev-dep list; a wrong stack renders the wrong contract.
- **Source:** `cli/src/update/resolve-adapters.ts` (`resolveAdapters`)
- **Preconditions / inputs:** A consumer project path; an optional `sdlc-config.json` at the project root carrying a `stack` key.
- **Given** a consumer with `sdlc-config.json` containing `"stack": "python"` **When** `update` (or `install`, via `syncProject`) runs **Then** `resolveAdapters` reads `cfg.stack` and resolves the manifest at `sdlc/files/stacks/python/adapter.json`; **Given** the `stack` key is absent or `sdlc-config.json` is missing entirely **Then** `stack` defaults to `'node'` and `deprecatedDefaults` is set true (logged as `DEPRECATED: stack/host keys missing … defaulted to node+railway` in `cli/src/update/index.ts`).
- **Error paths:** If the resolved `sdlc/files/stacks/<stack>/adapter.json` does not exist, `resolveAdapters` throws `stack adapter not found: stacks/<stack>/adapter.json. Available: <list>` where the list comes from `listStacks` (directories under `sdlc/files/stacks/` not starting with `_`).
- **Fixtures/env:** node fixture repo (no `stack` key → defaults to node), python fixture repo (`stack: python`), a fixture with an unknown `stack: go` to exercise the not-found throw.

#### REQ-FRAMEWORK-ADAPTER-002 — Host adapter resolved from sdlc-config.json, defaulting to railway

- **Priority:** Must — the host adapter governs deploy trigger, production-URL resolution and required secrets that downstream CI templates consume.
- **Source:** `cli/src/update/resolve-adapters.ts` (`resolveAdapters`); `cli/src/lib/adapter.ts` (`loadHostAdapter`, `listHosts`)
- **Preconditions / inputs:** Consumer project path; optional `host` key in `sdlc-config.json`.
- **Given** `sdlc-config.json` with `"host": "railway"` (or no `host` key) **When** `update`/`install` runs **Then** `host` resolves to `railway` and `sdlc/files/hosts/railway/adapter.json` is confirmed to exist; **Given** the `host` key is absent **Then** `host` defaults to `'railway'` and `deprecatedDefaults` is set true.
- **Error paths:** Missing `sdlc/files/hosts/<host>/adapter.json` throws `host adapter not found: hosts/<host>/adapter.json. Available: <list>` (list from `listHosts`).
- **Fixtures/env:** railway fixture (host present and host absent both → railway); fixture with `host: vercel` to exercise the not-found throw (only `railway` ships).

#### REQ-FRAMEWORK-ADAPTER-003 — Install-time stack auto-detection by manifest file (pyproject precedence over package.json)

- **Priority:** Must — `install` must derive the correct stack from filesystem signals before any `sdlc-config.json` exists.
- **Source:** `cli/src/install/detect-stack.ts` (`detectStack`, `findPyproject`)
- **Preconditions / inputs:** A fresh consumer checkout (no `sdlc-config.json` yet); a manifest file somewhere within 3 directory levels.
- **Given** a `pyproject.toml` at the project root **When** `install` runs detection **Then** the result is `stack=python`, `working_directory='.'`; **Given** no root `pyproject.toml` but one nested within `MAX_DEPTH`=3 levels (skipping `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`) **Then** `stack=python` with `working_directory` = the relative dir of the found pyproject; **Given** no pyproject anywhere but a root `package.json` **Then** `stack=node`, `working_directory='.'`. Python is checked before node, so a repo with both manifests detects as python. The detection result message always appends `host=railway`.
- **Error paths:** No `pyproject.toml` or `package.json` within 3 levels → throws `Could not detect stack — no pyproject.toml or package.json found within 3 directory levels.`
- **Fixtures/env:** node fixture (root `package.json` only), python fixture (root `pyproject.toml`), nested-python fixture (pyproject under `service/`), both-manifests fixture (expect python), empty fixture (expect throw).

#### REQ-FRAMEWORK-ADAPTER-004 — Node adapter substitutes the node/npm/TypeScript gate command set

- **Priority:** Must — the node adapter is the canonical substitution surface; wrong commands break CI gates.
- **Source:** `sdlc/files/stacks/node/adapter.json`
- **Preconditions / inputs:** Resolved `stack=node`.
- **Given** the node adapter is loaded **Then** it declares: `manifest_file=package.json`; `install="npm ci"`; `type_check="npx tsc --noEmit"`; `sast="npx semgrep scan --config auto --json"`; `dep_audit="npm audit --json --audit-level=high"`; `test="npm test"`; `build="npm run build"`; `runtime_setup.action="actions/setup-node@v6"` with `node-version={{NODE_VERSION}}`, `cache=npm`; `evidence_paths.sast="ci-evidence/sast-results.json"`, `dep_audit="ci-evidence/dependency-audit.json"`, `test="ci-evidence/e2e-results.json"`; and `config_keys.required` = `node_version, source_dirs, sast_baseline, accepted_dep_risks, e2e_project, e2e_start_command` with defaults `node_version=20, source_dirs="app/ lib/", e2e_project="chromium", e2e_start_command="npm run dev"`. The legacy `accepted_dep_risks` config value is preserved for config compatibility but does not permit Node advisory exceptions; Node decisions use `compliance/security/accepted-vulnerabilities.json`.
- **Error paths:** N/A (static manifest); malformed JSON would fail at `JSON.parse` in `loadStackAdapter` — see ADAPTER-013.
- **Fixtures/env:** node fixture repo; assert rendered CI/config carries these exact tokens (cross-ref FRAMEWORK-CI for the render).

#### REQ-FRAMEWORK-ADAPTER-005 — Python adapter substitutes the python/pip/pytest gate command set

- **Priority:** Must — python is the second shipped stack; its substitutions must differ observably from node.
- **Source:** `sdlc/files/stacks/python/adapter.json`
- **Preconditions / inputs:** Resolved `stack=python`.
- **Given** the python adapter is loaded **Then** it declares: `manifest_file=pyproject.toml`; `install="pip install -e \".[dev]\""`; `type_check="mypy src/"`; `sast="semgrep scan --config auto --json"` (no `npx`); `dep_audit="pip-audit --format=json --strict"`; `test="pytest --junit-xml=ci-evidence/junit.xml"`; `build="python -m build"`; `runtime_setup.action="actions/setup-python@v5"` with `python-version={{PYTHON_VERSION}}`, `cache=pip`; `evidence_paths.test="ci-evidence/junit.xml"` (node uses `e2e-results.json`); and `config_keys.required` = `python_version, source_dirs, sast_baseline, accepted_dep_risks` (no e2e keys) with defaults `python_version="3.11", source_dirs="src/"`.
- **Error paths:** See ADAPTER-013.
- **Fixtures/env:** python fixture repo; diff against node fixture to assert the node-vs-python observable delta (install cmd, type_check tool, dep_audit tool, test runner, evidence test path, runtime action, e2e keys present-vs-absent).

#### REQ-FRAMEWORK-ADAPTER-006 — Hook framework per stack: husky (node) vs pre-commit (python)

- **Priority:** Must — the hook framework choice changes which hook files land and where.
- **Source:** `sdlc/files/stacks/node/adapter.json`, `sdlc/files/stacks/python/adapter.json`; `cli/src/update/stack-hooks.ts` (`syncStackHooks`)
- **Preconditions / inputs:** Resolved stack; the consumer has bootstrapped the hook framework (the install dir exists).
- **Given** `stack=node` **Then** the adapter declares `hook_framework="husky"`, `hook_install_dir=".husky"`, `hooks=["commit-msg","pre-commit","pre-push"]`, `hook_config_files=["commitlint.config.mjs","lint-staged.config.mjs",".prettierrc.json"]`; **Given** `stack=python` **Then** `hook_framework="pre-commit"`, `hook_install_dir=".git/hooks"`, `hooks=[]` (empty — pre-commit manages its own hook installation), `hook_config_files=[".pre-commit-config.yaml"]`. **When** `syncStackHooks` runs **Then** each name in `hooks` is copied from `sdlc/files/stacks/<stack>/hooks/<name>` to `<hook_install_dir>/<name>` with mode `0o755`, and each `hook_config_files` entry is copied to the consumer repo root.
- **Error paths:** If `<hook_install_dir>/` does not exist in the consumer (`isDir` false), the section is SKIPPED with message `<dir>/ not found — bootstrap hook framework first` (0 files). If the stack has no `hooks/` directory, SKIPPED `stack has no hooks/`. Individual `hooks`/`hook_config_files` entries that don't exist on the source side are silently passed over (guarded by `exists`).
- **Fixtures/env:** node fixture with `.husky/` present (expect 3 hooks + 3 config files synced), node fixture without `.husky/` (expect SKIPPED), python fixture with `.git/hooks/` present (expect 0 hooks + `.pre-commit-config.yaml` only).

#### REQ-FRAMEWORK-ADAPTER-007 — Node hook config files have required content

- **Priority:** Should — the rendered husky configs are part of the observable contract; their content enforces conventional commits and lint-staged.
- **Source:** `sdlc/files/stacks/node/hooks/{pre-commit,pre-push,commit-msg,commitlint.config.mjs,lint-staged.config.mjs,.prettierrc.json}`
- **Preconditions / inputs:** `stack=node`, `.husky/` exists.
- **Given** the node hooks are synced **Then** `.husky/pre-commit` runs `npx lint-staged`; `commit-msg` invokes commitlint; `commitlint.config.mjs`, `lint-staged.config.mjs` and `.prettierrc.json` are placed at repo root verbatim. (Exact body asserted by file-equality, not paraphrase.)
- **Error paths:** N/A — verbatim copy.
- **Fixtures/env:** node fixture with `.husky/`; assert copied file bytes equal source bytes.

#### REQ-FRAMEWORK-ADAPTER-008 — Python pre-commit config has required hook content

- **Priority:** Should — the rendered `.pre-commit-config.yaml` is the python equivalent of the husky stack and must carry ruff/mypy/conventional-commit/pytest hooks.
- **Source:** `sdlc/files/stacks/python/hooks/.pre-commit-config.yaml`
- **Preconditions / inputs:** `stack=python`.
- **Given** the python config is synced **Then** `.pre-commit-config.yaml` declares ruff (lint+format) and `ruff-format`, mirrors-mypy with `--strict`, `conventional-pre-commit` at the `commit-msg` stage, the standard pre-commit-hooks set (trailing-whitespace, end-of-file-fixer, check-yaml/toml, check-added-large-files `--maxkb=500`, check-merge-conflict, detect-private-key), and a local `pytest-fast` hook at the `pre-push` stage. Verbatim copy.
- **Error paths:** N/A.
- **Fixtures/env:** python fixture with `.git/hooks/`; assert file-equality.

#### REQ-FRAMEWORK-ADAPTER-009 — Node stack scripts copied; python declares none

- **Priority:** Should — `stack_scripts` is a per-stack helper-script surface; node ships one, python ships none, and that difference is observable.
- **Source:** node `adapter.json` (`stack_scripts: ["check-requirement-jsdoc.sh"]`), python `adapter.json` (`stack_scripts: []`); `sdlc/files/stacks/node/scripts/check-requirement-jsdoc.sh`; the script-sync section (`cli/src/update/scripts.ts`).
- **Preconditions / inputs:** Resolved stack.
- **Given** `stack=node` **Then** `check-requirement-jsdoc.sh` is available from `sdlc/files/stacks/node/scripts/` for placement into the consumer's `scripts/`; **Given** `stack=python` **Then** `stack_scripts` is empty and no per-stack script is rendered.
- **Error paths:** Missing source script is guarded (skip-if-not-exists pattern).
- **Fixtures/env:** node fixture (expect `scripts/check-requirement-jsdoc.sh`), python fixture (expect absent). Note: `cli/src/update/scripts.ts` was not read in full for this section — see Assumptions.

#### REQ-FRAMEWORK-ADAPTER-010 — Node dev-dependencies auto-installed when missing (node only)

- **Priority:** Should — the adapter's `required_dev_dependencies` are auto-installed for node so the gate commands have their tooling.
- **Source:** `cli/src/update/stack-deps.ts` (`syncStackDeps`); node `adapter.json` `required_dev_dependencies`
- **Preconditions / inputs:** `stack=node`; `package.json` present; some declared dev-deps missing from `devDependencies`.
- **Given** `stack=node` and `package.json` is missing one or more of `husky, @commitlint/cli, @commitlint/config-conventional, lint-staged, prettier, eslint, typescript, @playwright/test` **When** `syncStackDeps` runs **Then** it runs `npm install --save-dev <missing…>` in the project; if that exits non-zero it retries with `--legacy-peer-deps`; the section reports the installed list. **Given** all are present **Then** message `all present`, 0 files. **Given** `stack=python` **Then** the section is SKIPPED entirely (`if (ctx.stack !== 'node')`), even though the python adapter declares `required_dev_dependencies` (`pytest, ruff, mypy, pip-audit, pre-commit`) — those are installed via `pip install -e ".[dev]"`, not by this section.
- **Error paths:** Both `npm install` attempts failing → throws `Failed to install <stack> deps. Fix manually: cd <path> && npm install --save-dev <missing…>` (aborts the sync). Missing `package.json` → SKIPPED `no package.json`.
- **Fixtures/env:** node fixture missing `prettier` (expect install attempt), node fixture with all deps present (expect `all present`), python fixture (expect SKIPPED). Network/npm must be available or stubbed.

#### REQ-FRAMEWORK-ADAPTER-011 — Railway host adapter substitutes deploy trigger, production-URL secret resolution and wait-for-deploy

- **Priority:** Must — host substitution is what makes the deploy/verify portion of the rendered CI host-correct.
- **Source:** `sdlc/files/hosts/railway/adapter.json`
- **Preconditions / inputs:** Resolved `host=railway`.
- **Given** the railway adapter is loaded **Then** it declares: `deploy_trigger="push_to_main"` (Railway auto-deploys on push to main — no explicit deploy CI step); `production_url_from="secret"` with `production_url_secret_key="production_url_secret"` (the sdlc-config key naming the GitHub Secret that holds the URL); a `wait_for_deploy` shell snippet that curls `${PROD_URL}/` up to 30 times (10s apart) until HTTP is 2xx/3xx; `required_secrets=["DEVAUDIT_API_KEY", "RAILWAY_TOKEN"]` (`RAILWAY_TOKEN` added in #883 — read through the optional `HostAdapter.required_secrets?: readonly string[]` field in `cli/src/lib/adapter.ts` and folded into `doctor`'s `secrets` check, REQ-CLI-DOCTOR-005); `config_keys.required=[production_url_secret, runner]` with `config_keys.optional=[database_service, database_image, database_port, database_env]` and a documented-but-unread default `runner="ubuntu-latest"` (`config_keys.defaults` is manifest metadata only — no code path in `cli/src` consumes it; the operative new-scaffold default is `write-config.ts`'s `defaultedIfNew.runner = 'self-hosted'`, per REQ-CLI-INSTALL-008). Its `notes` additionally state (#883): `RAILWAY_TOKEN` is **advisory, not needed for normal CI** — it is only consumed by `reconcile-deployment.yml` (the manual recovery workflow for when Railway's `deployment_status` webhook fails to reach GitHub) and should be set before that path is ever needed; and `reconcile-deployment.yml` requires the `railway` CLI on `PATH` for whichever account runs self-hosted-runner jobs (checked by `doctor`'s `railway-cli` check). `reconcile-deployment.yml` itself is only generated for this host (REQ-FRAMEWORK-CIYML-022).
- **Error paths:** Per the host schema (`sdlc/files/hosts/_schema/adapter.schema.json`), `production_url_from="secret"` requires `production_url_secret_key` (enforced via `allOf`/`if-then` at authoring time only, not at runtime — see ADAPTER-013).
- **Fixtures/env:** railway fixture; assert the host adapter values feed the deploy/verify render (cross-ref FRAMEWORK-CI — `post-deploy-prod.yml.template` / `ci.yml` consume `production_url_secret` and the wait snippet).

#### REQ-FRAMEWORK-ADAPTER-012 — Host adapter is loaded as a validated manifest; ci-templates consume the substituted deploy bits

- **Priority:** Should — establishes the boundary: this area resolves+loads the host adapter; the actual deploy-step rendering is owned by FRAMEWORK-CI.
- **Source:** `cli/src/lib/adapter.ts` (`loadHostAdapter`); `cli/src/update/ci-templates.ts` (reads `production_url_secret`, `runner`, database\_\* from `sdlc-config.json`)
- **Preconditions / inputs:** Resolved host; `sdlc-config.json` carrying the host's required config keys.
- **Given** `host=railway` **Then** the loaded `HostAdapter` object is the validated manifest for that host (including any optional `runtime_contract` metadata), while the deploy-trigger, production-URL and wait-for-deploy snippets are consumed downstream when CI templates are rendered using `sdlc-config.json` values (`production_url_secret`, `runner`, `database_service`/`database_image`/`database_port`/`database_env`). The observable with-vs-without-railway difference (deploy step, prod-URL secret reference, DB service container) lands in the rendered `.github/workflows/*.yml`.
- **Error paths:** N/A in this area.
- **Fixtures/env:** railway fixture with full `sdlc-config.json`; cross-ref FRAMEWORK-CI for the rendered-workflow assertions.

#### REQ-FRAMEWORK-ADAPTER-013 — Malformed adapter manifest aborts the sync at parse time or schema validation

- **Priority:** Should — adapters are first-party and rarely malformed, but runtime schema validation catches contributor errors early (DevAudit-Installer#158).
- **Source:** `cli/src/lib/adapter.ts` (`loadStackAdapter`, `loadHostAdapter` — `JSON.parse` + Ajv validation against `adapter.schema.json`); `cli/src/update/resolve-adapters.ts` (existence checks); `sdlc/files/stacks/_schema/adapter.schema.json`, `sdlc/files/hosts/_schema/adapter.schema.json` (enforced at runtime via Ajv).
- **Preconditions / inputs:** A resolved stack/host whose `adapter.json` is syntactically invalid, schema-invalid, or absent.
- **Given** `sdlc/files/stacks/<stack>/adapter.json` contains invalid JSON **When** `loadStackAdapter`/`loadHostAdapter` runs **Then** `JSON.parse` throws and the sync aborts; **Given** the file is absent **Then** `resolveAdapters` throws the `… adapter not found … Available: …` error before load. **Given** the file is parseable but schema-invalid (e.g. missing `required` properties, bad `runtime_setup.action` pattern) **Then** Ajv validation fails and the sync aborts with a clear error listing all schema violations.
- **Error paths:** This requirement is itself the error path.
- **Fixtures/env:** fixture installer-root with a stack `adapter.json` containing a syntax error (expect abort); a fixture with a parseable-but-schema-invalid adapter (expect abort with schema error); a fixture with a valid adapter (expect success).

#### REQ-FRAMEWORK-ADAPTER-014 — Railway host adapter carries a schema-validated lean-runtime contract

- **Priority:** Should — this is the installer-side upstream contract for Railway memory hygiene (issue #331).
- **Source:** `sdlc/files/hosts/railway/adapter.json` (`runtime_contract`), `sdlc/files/hosts/_schema/adapter.schema.json`.
- **Preconditions / inputs:** Resolved `host=railway`.
- **Given** the railway host adapter is loaded **Then** it carries a `runtime_contract` object declaring: `preferred_web_runtime="compiled JavaScript or framework standalone output"`, `forbid_typescript_runtime=true`, `prefer_standalone_output=true`, and a non-empty `scheduler_placement` rule instructing operators to keep scheduled/background jobs out of the long-lived web process. This contract is advisory prose for consumers today, but it is schema-validated and versioned in the adapter manifest so it cannot silently drift.
- **Error paths:** A malformed `runtime_contract` (wrong types, missing keys, empty required strings) fails schema validation at adapter-load time per ADAPTER-013.
- **Fixtures/env:** adapter-validator test asserting the bundled Railway adapter passes and a malformed `runtime_contract` fails with a schema error.

#### REQ-FRAMEWORK-ADAPTER-015 — commitlint accepts `style:` and exempts the Sentinel trailer from line-length rules (#813, #814)

- **Priority:** Must — a `style:` commit (standard Conventional Commits type: formatting/whitespace, no behaviour change) previously passed local hooks (this file's `type-enum` predates `#813` and omitted it) inconsistently with `validate-commits.sh` (`REQ-FRAMEWORK-VALIDATE-004`) — see that REQ for the release-PR-time failure this caused. Separately, `sdlc-implementer` Phase 2 step 7 requires copying a `Sdlc-Implementer-Sentinel: <json>` line (a phase-history array that grows every phase, routinely several hundred characters) into every commit trailer so CI-uploaded evidence can prove skill provenance (`devaudit#775`) — `@commitlint/config-conventional`'s default `body-max-line-length`/`footer-max-line-length` (100 chars) rejected it, and the skill forbids `--no-verify`.
- **Source:** `sdlc/files/stacks/node/hooks/commitlint.config.mjs` (`type-enum` array; `body-max-line-length`/`footer-max-line-length` set to `[0]` and replaced by `body-max-line-length-except-sentinel`/`footer-max-line-length-except-sentinel`, backed by the shared `maxLineLengthExceptSentinel` rule function).
- **Preconditions / inputs:** A commit message being linted by `@commitlint/cli` with this config.
- **Given** a `style: ...` commit **When** linted **Then** `type-enum` accepts it, and `requirement-ref-for-impl` treats it as REQ-exempt housekeeping (not in `IMPLEMENTATION_TYPES`), matching `feat`/`fix`/`refactor`/`perf`'s stricter path being the only gated one.
- **Given** a commit body/footer contains a line starting with `Sdlc-Implementer-Sentinel:` longer than 100 characters **When** linted **Then** it passes — the custom rule functions filter out lines starting with that exact prefix before applying the 100-char check to what remains. **Given** any other body/footer line exceeds 100 characters **Then** it still fails, unchanged from `config-conventional`'s default — verified empirically (a real `@commitlint/cli`/`config-conventional` install, not just static config inspection) that this parser classifies the Sentinel trailer paragraph as `body`, not `footer` as the original bug report assumed, so **both** rules are overridden defensively.
- **Error paths:** A non-Sentinel line over 100 chars in either body or footer still triggers `body-max-line-length-except-sentinel`/`footer-max-line-length-except-sentinel` with the same message shape as the rule it replaces (noting the Sentinel exemption).
- **Fixtures/env:** Verified against a real `@commitlint/cli@19`/`@commitlint/config-conventional@19` install in a scratch dir before committing (not source-string assertions alone): a 300-char Sentinel trailer passes; a genuinely-too-long non-Sentinel body line still correctly fails; `style:` commits pass; `feat:` without a REQ ref still correctly fails.

---

#### REQ-FRAMEWORK-GOVERNANCE-001 — Governance starters are opt-in (NOT auto-seeded on install since v0.1.36)

- **Priority:** Should — placeholder governance docs must never be auto-seeded as if they were real evidence; they ship only on explicit request.
- **Source:** `cli/src/install/index.ts` (comment: `bootstrapGovernanceDocs` is no longer called from the default install flow); `cli/src/install/bootstrap-governance.ts` (`bootstrapGovernanceDocs`); `cli/src/commands/bootstrap-governance.ts` (`devaudit bootstrap-governance`)
- **Preconditions / inputs:** A consumer running `install`, `update`, or the standalone `bootstrap-governance` command.
- **Given** a consumer runs `devaudit install` **Then** the six governance starters are NOT copied (the default install flow no longer calls `bootstrapGovernanceDocs`); **Given** a consumer runs `devaudit update` **Then** they are NOT copied (governance is not one of the `SECTION_RUNNERS` in `cli/src/update/index.ts`); **Given** a consumer runs `devaudit bootstrap-governance [path]` **Then** the starters are copied (see GOVERNANCE-002). The command is owned by another SRS section; this requirement only asserts the opt-in boundary.
- **Error paths:** N/A.
- **Fixtures/env:** node/python fixture — run `install`, assert `compliance/governance/` is NOT created; run `bootstrap-governance`, assert it IS.

#### REQ-FRAMEWORK-GOVERNANCE-002 — bootstrap-governance copies the six starters, dropping `.template`, skip-if-exists

- **Priority:** Should — the opt-in render must be idempotent and must never overwrite operator-edited governance docs.
- **Source:** `cli/src/install/bootstrap-governance.ts` (`bootstrapGovernanceDocs`)
- **Preconditions / inputs:** `installerRoot` with `sdlc/files/_common/governance/*.md.template`; consumer project path; optional `--dry-run`.
- **Given** `devaudit bootstrap-governance <path>` on a project with no `compliance/governance/` **Then** all six `*.md.template` files (read from `sdlc/files/_common/governance`, sorted) are copied to `compliance/governance/` with the `.template` suffix dropped (e.g. `ropa.md.template` → `compliance/governance/ropa.md`); **Given** a target file already exists on disk (`isFile` true) **Then** it is skipped (added to `skipped[]`, never overwritten) and the result message reports `<n> copied, <m> kept (already on disk)`. **Given** `--dry-run` **Then** status `planned` with `would copy <n> starter(s) … (skip-if-exists)` and no writes.
- **Error paths:** Source dir not found → status `warn` `source directory not found: <dir>`. Zero `.md.template` files → status `warn` `no .md.template files in <dir>`.
- **Fixtures/env:** clean fixture (expect 6 copied), fixture with pre-existing `compliance/governance/ropa.md` (expect ropa skipped, 5 copied), `--dry-run` fixture (expect no writes).

#### REQ-FRAMEWORK-GOVERNANCE-003 — Each starter carries required frontmatter + the REPLACE banner

- **Priority:** Should — the banner and frontmatter make the placeholder status unambiguous on disk and in the portal's rendered evidence view; auditors reject unedited stubs.
- **Source:** `sdlc/files/_common/governance/{ai-disclosure,dpia,incident-report,periodic-review,risk-register,ropa}.md.template`
- **Preconditions / inputs:** Starters copied via GOVERNANCE-002.
- **Given** each copied starter **Then** it begins with a YAML frontmatter block and an immediately-following blockquote banner containing `⚠️ **STARTER TEMPLATE — REPLACE BEFORE COMMITTING.`. Per-file required frontmatter keys:
  - `ai-disclosure.md`: `title, provider, intended_purpose, last_reviewed_at, review_cadence_days (180), risk_class`.
  - `dpia.md`: `title, processing_activity, controller, last_reviewed_at, review_cadence_days (365), risk_level`.
  - `incident-report.md`: `title, incident_id, incident_kind, source_release, release_scope, source_issue, semantic_id, severity, detected_at, resolved_at, involves_personal_data, reported_to_supervisory_authority, notification_window_72h, last_reviewed_at`.
  - `periodic-review.md`: `title, period_start, period_end, reviewer, last_reviewed_at, review_cadence_days (90)`.
  - `risk-register.md`: `title, project, maintained_by, scoring_matrix, last_reviewed_at, review_cadence_days (90)`.
  - `ropa.md`: `title, controller, controller_contact, last_reviewed_at, review_cadence_days (365), processing_activities ([])`.
- **Error paths:** N/A — verbatim copy; absence of banner/frontmatter would be a source-template defect.
- **Fixtures/env:** post-bootstrap fixture; assert each file's first non-empty lines match the frontmatter keys and the banner string.

#### REQ-FRAMEWORK-GOVERNANCE-004 — Each starter declares its evidence type and framework-clause coverage

- **Priority:** Should — the declared evidence type + clauses are the contract that maps each governance doc to the compliance matrix it closes.
- **Source:** `sdlc/files/_common/governance/*.md.template`; `cli/src/install/bootstrap-governance.ts` (docstring mapping)
- **Preconditions / inputs:** Starters copied.
- **Given** each starter **Then** its body declares **Framework coverage** and (where applicable) **Evidence type**:
  - `ai-disclosure.md` → evidence type `ai_disclosure`; clause `EUAIA.Art-13`; cadence 180 days.
  - `dpia.md` → evidence type `dpia`; clause `GDPR.Art-35`; cadence 365 days.
  - `ropa.md` → evidence type `ropa`; clause `GDPR.Art-30`; cadence 365 days.
  - `incident-report.md` → clauses `ISO29119.3.5.4`, `SOC2.CC7.2`, `GDPR.Art-33`, `GDPR.Art-34` (per the bootstrap docstring); one incident per file.
  - `periodic-review.md` → clauses `SOC2.CC4.1`, `ISO27001.A.12.1`; auto-regenerated quarterly by `.github/workflows/periodic-review.yml` (human attestation still required).
  - `risk-register.md` → clauses `SOC2.CC3.2`, `SOC2.CC3.4`, `ISO27001.A.5.1`, `ISO27001.A.6.2`, `GDPR.Art-32`; maintained by the `risk-register-keeper` skill.
- **Error paths:** N/A.
- **Fixtures/env:** post-bootstrap fixture; grep each file for its evidence-type token and clause IDs.

#### REQ-FRAMEWORK-GOVERNANCE-005 — Governance starters are operator-uploaded, not CI-auto-uploaded

- **Priority:** Could — the templates state CI does NOT upload them (since v0.1.39); a placeholder must not flip a matrix clause to COVERED automatically.
- **Source:** `sdlc/files/_common/governance/ropa.md.template`, `dpia.md.template`, `ai-disclosure.md.template` ("kept in-repo for review; CI does NOT upload it" / "Tier-2 governance docs are operator-uploaded only since DevAudit-Installer v0.1.39")
- **Preconditions / inputs:** Starters present in `compliance/governance/`.
- **Given** a governance starter on disk **Then** the template's "Uploading this artefact" section states the file is kept in-repo for review and is uploaded only manually via the portal Upload Evidence form (per evidence type), not by CI. This is documentary contract content within the rendered file, not CLI behaviour.
- **Error paths:** N/A.
- **Fixtures/env:** post-bootstrap fixture; assert the "CI does NOT upload" wording is present in ropa/dpia/ai-disclosure.

---

#### REQ-FRAMEWORK-RULES-001 — Six AI rule-file targets written so every supported agent discovers the SDLC

- **Priority:** Must — the rule-file discovery contract is the entry point that makes any agent enforce the SDLC; missing or wrong paths break discovery.
- **Source:** `cli/src/update/ai-rules.ts` (`syncAiRules`)
- **Preconditions / inputs:** `installerRoot` with `sdlc/ai-rules/INSTRUCTIONS-SDLC.md` present; a consumer project path. Runs on both `install` and `update` (section `2b` in `cli/src/update/index.ts`).
- **Given** `INSTRUCTIONS-SDLC.md` exists **When** `syncAiRules` runs **Then** exactly six targets are written at the consumer root: `.cursorrules` (Cursor), `.windsurfrules` (Windsurf), `GEMINI.md` (Gemini CLI), `AGENTS.md` (any agent honoring the emerging `AGENTS.md` convention), `CLAUDE.md` (Claude Code), and `INSTRUCTIONS.md` (canonical, consumed by any LLM agent); the section reports `filesSynced: 6`. **Corrected 2026-09-30 (#931 docs audit):** this REQ previously said "five targets"/`filesSynced: 5` — `AGENTS.md` was added as a fourth pointer file since and the REQ text was never updated (see REQ-CLI-UPDATE-004).
- **Error paths:** If `sdlc/ai-rules/INSTRUCTIONS-SDLC.md` is absent, the section is SKIPPED with `INSTRUCTIONS-SDLC.md not found` and 0 files.
- **Fixtures/env:** node/python fixture; assert all six files exist at the project root after `update`.

#### REQ-FRAMEWORK-RULES-002 — Cursor/Windsurf/Gemini/AGENTS.md rule files are pointer files that reference INSTRUCTIONS.md

- **Priority:** Must — the pointer pattern keeps a single source of truth; each agent's file must point to the canonical doc.
- **Source:** `cli/src/update/ai-rules.ts` (`CURSOR_POINTER`, `WINDSURF_POINTER`, `GEMINI_POINTER`, `AGENTS_POINTER`); `cli/src/update/write-managed.ts` (`writeManaged`)
- **Preconditions / inputs:** `syncAiRules` running.
- **Given** the sync runs and the pointer file is unmodified since the last sync **Then** `.cursorrules` is overwritten with the `# Cursor Rules` pointer naming `INSTRUCTIONS.md` as the **Single Source of Truth**; `.windsurfrules` with the equivalent `# Windsurf Rules` pointer; `GEMINI.md` with the `# GEMINI.md` pointer (guidance to Gemini CLI + `See ./INSTRUCTIONS.md`); `AGENTS.md` with the equivalent `# AGENTS.md` pointer. All four are fully overwritten on every such run (idempotent — same bytes each time). **Given** a pointer file has been hand-edited since the last sync (or, on a fresh onboarding, already existed with different content) **Then** it is left byte-for-byte untouched and the fresh pointer content is written to `<path>.devaudit-new` instead, reported as a conflict (devaudit-installer#930). **Corrected 2026-09-30 (#931 docs audit, then #930):** this REQ previously covered only three pointer files (fixed by #931 — `AGENTS.md` was added since) and previously said every pointer file is unconditionally overwritten (fixed by #930 — a hand-edit is now detected and preserved instead).
- **Error paths:** N/A.
- **Fixtures/env:** fixture with an unmodified pre-existing `.cursorrules` (expect it overwritten to the canonical pointer); fixture with a hand-edited `.cursorrules` (expect it preserved, `.cursorrules.devaudit-new` written); assert each pointer contains the literal `INSTRUCTIONS.md` link.

#### REQ-FRAMEWORK-RULES-003 — CLAUDE.md preserves project header, appends pointer, strips prior SDLC section

- **Priority:** Must — Claude Code's CLAUDE.md often carries project-specific content that must survive re-sync while still gaining the pointer.
- **Source:** `cli/src/update/ai-rules.ts` (`updateClaudeFile`, `CLAUDE_NEW`, `CLAUDE_POINTER_TAIL`, `SDLC_HEADER`)
- **Preconditions / inputs:** Optional pre-existing `CLAUDE.md`.
- **Given** no `CLAUDE.md` exists **Then** it is created from `CLAUDE_NEW` (a `# CLAUDE.md` header + the `## Project Standards` pointer tail naming `INSTRUCTIONS.md`); **Given** a `CLAUDE.md` already exists **Then** any content from the legacy `## SDLC Compliance Process (MANDATORY)` header (`SDLC_HEADER`) onward is stripped, and if the body does not already mention `INSTRUCTIONS.md` the `CLAUDE_POINTER_TAIL` is appended. Project-specific content above the SDLC header is preserved. **Not manifest-tracked (devaudit-installer#930):** unlike every other section-2b output, `CLAUDE.md` is deliberately excluded from `writeManaged`'s conflict detection — its own merge logic already handles preserving a consumer's content safely, so it needs no additional conflict machinery.
- **Error paths:** N/A.
- **Fixtures/env:** fixture with a `CLAUDE.md` containing a project header + an old inlined SDLC section (expect: project header kept, old SDLC section removed, pointer tail present, no duplicate pointer on a second run).

#### REQ-FRAMEWORK-RULES-004 — INSTRUCTIONS.md is canonical; holds the real SDLC content from INSTRUCTIONS-SDLC.md

- **Priority:** Must — INSTRUCTIONS.md is the single source the four other files point to; it must contain the actual SDLC process content.
- **Source:** `cli/src/update/ai-rules.ts` (`updateInstructionsFile`); source content `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`
- **Preconditions / inputs:** `sdlcContent` = the bytes of `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`; optional pre-existing `INSTRUCTIONS.md`.
- **Given** no `INSTRUCTIONS.md` exists **Then** it is created with the `# Project Instructions & Standards (Single Source of Truth)` header followed by the full `INSTRUCTIONS-SDLC.md` content (which begins with `## SDLC Compliance Process (MANDATORY)` and lists the `SDLC/0-…`…`SDLC/5-…` workflow files plus the `sdlc-implementer` skill entry point); **Given** an `INSTRUCTIONS.md` already exists **Then** content from the `SDLC_HEADER` onward is truncated and the fresh `sdlcContent` is re-appended (so project-specific content above the SDLC section is preserved and the SDLC section is replaced, not duplicated).
- **Error paths:** Covered by RULES-001's skip when the source file is missing.
- **Fixtures/env:** fixture with no INSTRUCTIONS.md (expect canonical content), fixture with a project-prefaced INSTRUCTIONS.md + an old SDLC section (expect SDLC section replaced once, project preface kept). NOTE: the source is `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`, NOT the DevAudit-Installer repo's own root `INSTRUCTIONS.md` nor `sdlc/files/_common/implementing-an-sdlc-issue.md` — those two are the installer's own docs, not the per-agent rule source. See Assumptions. **Not manifest-tracked**, same reasoning as `CLAUDE.md` in REQ-FRAMEWORK-RULES-003.

#### REQ-FRAMEWORK-RULES-005 — AI rule-file sync is idempotent on update re-run

- **Priority:** Must — re-running `update` must not duplicate pointers or drift the canonical content.
- **Source:** `cli/src/update/ai-rules.ts` (`updateClaudeFile` `body.includes('INSTRUCTIONS.md')` guard; `updateInstructionsFile` truncate-then-append)
- **Preconditions / inputs:** A project already synced once.
- **Given** `update` is run a second time with nothing hand-edited **Then** the four pointer files (`.cursorrules`, `.windsurfrules`, `GEMINI.md`, `AGENTS.md`) are rewritten to identical bytes; `CLAUDE.md` gains no duplicate pointer tail (guarded by the `INSTRUCTIONS.md` substring check); `INSTRUCTIONS.md`'s SDLC section is truncated and re-appended so the file content is stable across runs. **Corrected 2026-09-30 (#931 docs audit, then #930):** this REQ previously said "three pointer files"/"all five files" (fixed by #931 — `AGENTS.md` was added since, bringing the pointer-file count to four and the section 2b total to six) and implicitly assumed unconditional overwrite (fixed by #930 — a pointer file hand-edited between the two runs instead reads as an unresolved conflict on both runs, per REQ-FRAMEWORK-RULES-002).
- **Error paths:** N/A.
- **Fixtures/env:** any synced fixture; run `update` twice, assert byte-identical results for all six files.

---

#### REQ-FRAMEWORK-STAGE-001 — Stage docs and Tier-1 docs synced verbatim into the consumer's SDLC/

- **Priority:** Should — the Tier-1 policy docs land verbatim in `SDLC/` for the operator to read directly. The six stage docs also sync verbatim, but as of the v0.2.0 CLI-engine architecture their *content* is a short AI-agent redirect stub, not the full procedure — see REQ-FRAMEWORK-STAGE-004. This requirement covers the sync mechanism (byte-identical copy); it does not assert what the stage docs' content says.
- **Source:** `cli/src/update/stage-docs.ts` (`syncStageDocs`); source dir `sdlc/files/_common/`
- **Preconditions / inputs:** Consumer project path. Runs on both `install` and `update` (section `2a`).
- **Given** `update`/`install` runs and none of these files has been hand-edited since the last sync **Then** `SDLC/` is created (`ensureDir`) and every `*.md` file under `sdlc/files/_common/` is written verbatim into `SDLC/<basename>` — including the six stage docs `0-project-setup.md` … `5-deploy-main.md`, the Tier-1 docs `Test_Policy.md`, `Test_Strategy.md`, `Test_Architecture.md`, `Periodic_Security_Review_Schedule.md`, and templates (`Test_Plan_TEMPLATE.md`, `README_TEMPLATE.md`, `Implementation_Plan_TEMPLATE.md`, `implementing-an-sdlc-issue.md`, `joining-an-existing-project.md`). The count of files synced equals the number of `*.md` files in `_common/`, minus any currently in conflict. **Given** one of these files has been hand-edited since the last sync **Then** it's left untouched and reported as a conflict (devaudit-installer#930), not silently overwritten — this REQ previously asserted unconditional verbatim overwrite.
- **Error paths:** N/A — verbatim copy; the source is first-party.
- **Fixtures/env:** node/python fixture; assert `SDLC/0-project-setup.md` … `SDLC/5-deploy-main.md` and the four Tier-1 docs exist and equal source bytes.

#### REQ-FRAMEWORK-STAGE-002 — Post-sync validation warns on missing Tier-1 docs in SDLC/

- **Priority:** Should — the operator should be warned (non-fatally) if the Tier-1 trio failed to land before committing.
- **Source:** `cli/src/update/validation.ts` (`runValidation`, `TIER_1_DOCS`)
- **Preconditions / inputs:** Post-sync; an `SDLC/` directory in the consumer.
- **Given** `SDLC/` exists but is missing any of `Test_Policy.md`, `Test_Strategy.md`, `Test_Architecture.md` **Then** `runValidation` adds a warning `Missing Tier 1 doc: SDLC/<doc>` (the warning is surfaced, the sync is not failed). NOTE: validation checks only the three Test\_\* Tier-1 docs, not `Periodic_Security_Review_Schedule.md`.
- **Error paths:** This requirement is a warning path, not a hard error.
- **Fixtures/env:** fixture where one Tier-1 doc is deleted post-sync (expect the matching warning); clean fixture (expect `All validation checks passed`).

#### REQ-FRAMEWORK-STAGE-003 — `devaudit status` reports presence of the framework files including stage docs and rule files

- **Priority:** Should — `status` is the consumer-facing health check confirming the rendered contract is in place.
- **Source:** `cli/src/commands/status.ts` (`runStatus`, `FRAMEWORK_FILES`, `checkFrameworkFiles`)
- **Preconditions / inputs:** A consumer with `sdlc-config.json`.
- **Given** `devaudit status [path]` on an onboarded project **Then** it reports present/missing for the fixed `FRAMEWORK_FILES` list: `INSTRUCTIONS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `GEMINI.md`, `SDLC/0-project-setup.md`, `SDLC/5-deploy-main.md`, `scripts/upload-evidence.sh`, `compliance/RTM.md`, `.github/workflows/ci.yml`. If any are missing it prints `<n> framework file(s) missing. Re-sync with \`devaudit update <version> <path>\``. **Given** no `sdlc-config.json`**Then** it warns`not onboarded` and exits with code 7.
- **Error paths:** Missing `sdlc-config.json` → exit 7; missing framework files → non-fatal warning, but the per-file ✓/✗ list is the observable assertion surface. NOTE: `status` checks only two of the six stage docs (`0-project-setup.md`, `5-deploy-main.md`) and all five AI rule files; it does NOT check Tier-1 docs (that's validation's job, STAGE-002).
- **Fixtures/env:** fully-synced fixture (expect all ✓), fixture with `GEMINI.md` removed (expect ✗ + missing-count warning), fixture without `sdlc-config.json` (expect exit 7).

#### REQ-FRAMEWORK-STAGE-004 — Synced stage docs are AI-agent redirect stubs, not the full procedure; full text lives in blueprints

- **Priority:** Should — this is a significant, easy-to-miss behavioural change from the pre-v0.2.0 framework (where the synced stage doc *was* the full procedure) — a reader (human or agent) opening `SDLC/1-plan-requirement.md` cold needs to know where the real content is.
- **Source:** `sdlc/files/_common/*.md` (the stub source, synced verbatim per REQ-FRAMEWORK-STAGE-001), `sdlc/src/blueprints/*.raw.md` (the full-text source), `SDLC/bin/devaudit-sdlc.cjs` (`--phase=N`, `--phase=N --view`) — commits `04e716405` (v0.2.0 CLI-engine architecture, #235), `f7405c4a` (#231).
- **Preconditions / inputs:** A consumer that has run `install`/`update` against a post-v0.2.0 framework version.
- **Given** a human or agent opens a synced stage doc (e.g. `SDLC/1-plan-requirement.md`) **When** they read it **Then** they find an ~18-line "🛑 SDLC STEP GATE" stub instructing them to run `node SDLC/bin/devaudit-sdlc.cjs --phase=<N>` rather than execute the stage manually — not the stage procedure itself. **Given** an operator runs `node SDLC/bin/devaudit-sdlc.cjs --phase=<N> --view` **Then** the full original procedure (the corresponding `sdlc/src/blueprints/<N>-*.raw.md`, which itself still carries the same stub-style banner at its top followed by the complete Given/When/Then-equivalent stage documentation) is printed to the terminal.
- **Error paths:** N/A — this documents intentional content, not an error condition.
- **Fixtures/env:** A synced `SDLC/1-plan-requirement.md` fixture; assert its content matches the stub pattern, not the blueprint's full length.

---

#### REQ-FRAMEWORK-HOOK-001 — Pre-push hook checks for E2E evidence before allowing pushes with UI-facing file changes (#226)

- **Priority:** Should — a UI change pushed with no E2E run is the failure the E2E gate exists to stop; the CI gate is the backstop, this is the early local one.
- **Source:** `sdlc/files/stacks/node/hooks/pre-push` (section 2, "E2E evidence check"); written by `e2e-test-engineer` (`.e2e-gate-passed`, REQ-FRAMEWORK-SKILL-004).
- **Preconditions / inputs:** A push whose `remote_ref` ends in `refs/heads/<integration_branch>` (from `sdlc-config.json`, default `develop`). The commit range is `compute_range` (remote..local; for a new ref, merge-base against `origin/<integration_branch>`, then `origin/HEAD`, then the bare SHA, #741/#743).
- **Given** the range changes a file matching `app/**/*.tsx`, `src/**/*.tsx`, `pages/**/*.tsx` or the `.jsx` equivalents **When** the hook runs **Then** it requires either a `.e2e-gate-passed` sentinel or a `playwright-report/` directory with a file newer than `.git/HEAD`. **Given** neither exists **Then** exit 1 with `ERROR: E2E gate was not run before pushing.`, the changed UI files, and the `--no-verify` bypass note.
- **Given** the gate ran **Then** the REQ-scoped check of REQ-FRAMEWORK-HOOK-005 (#578) also applies before `Pre-push: E2E evidence check passed.` is printed.
- **Given** no UI-facing file changed, or the push targets another branch **Then** the check is skipped entirely.
- **Error paths:** Missing evidence → exit 1; `--no-verify` bypasses (last resort; CI re-checks).
- **Fixtures/env:** A push with a changed `app/page.tsx` and no sentinel or report (blocked); the same with `.e2e-gate-passed` (passes); a push of `lib/util.ts` only (skipped).

#### REQ-FRAMEWORK-HOOK-002 — Pre-push hook checks for the sdlc-implementer-invoked sentinel on feat/fix/refactor/perf commits (#226)

- **Priority:** Should — stops a tracked change from reaching the remote without the SDLC skill flow; `validate-commits.sh` (REQ-FRAMEWORK-VALIDATE-001) enforces the same thing in CI.
- **Source:** `sdlc/files/stacks/node/hooks/pre-push` (section 3, and 3b phase progression, #278); `.sdlc-implementer-invoked` written by `node SDLC/bin/devaudit-sdlc.cjs --phase=<N>` (REQ-FRAMEWORK-SKILL-001).
- **Preconditions / inputs:** Any push (not only to the integration branch, #278). A commit subject matching `^(feat|fix|refactor|perf)(\(.+\))?!?:` marks the push as tracked. `docs`, `chore`, `ci`, `build`, `test` and `revert` are exempt.
- **Given** a tracked commit in the pushed range and no `.sdlc-implementer-invoked` file **Then** exit 1 with `ERROR: sdlc-implementer skill was not invoked.` **Given** the sentinel exists **Then** `Pre-push: skill-invocation sentinel check passed.`
- **Given** the sentinel exists and the range touches `compliance/evidence/REQ-*/` **Then** it must contain a phase `3` record; touching `compliance/approved-releases/` or adding an RTM line carrying `RELEASED` requires a phase `5` record (a new `DRAFT` RTM row is not a Phase-5 signal, #744). A missing record → exit 1 naming the phase.
- **Error paths:** exit 1 as above; `--no-verify` bypasses.
- **Fixtures/env:** A `feat:` commit without the sentinel (blocked); a `chore:` commit without it (passes); evidence files with a phase-2-only sentinel (blocked).

#### REQ-FRAMEWORK-HOOK-003 — Pre-push hook checks for .e2e-evidence-wired sentinel when e2e spec files changed (#226)

- **Priority:** Should — prevents pushing E2E spec files without evidence wiring validation (Phase 5½).
- **Source:** `sdlc/files/stacks/node/hooks/pre-push` (section 2, after the E2E gate check): `git diff --name-only "$RANGE" -- 'e2e/**/*.spec.ts'` detects E2E spec changes; if any are found and `.e2e-evidence-wired` sentinel file is missing, the hook exits 1 with an actionable error message.
- **Preconditions / inputs:** Push to the integration branch; `e2e/**/*.spec.ts` files in the diff range.
- **Given** a push containing changes to `e2e/**/*.spec.ts` files **When** the pre-push hook runs **Then** it checks for `.e2e-evidence-wired` sentinel (written by `e2e-test-engineer` Phase 5½). **Given** the sentinel is missing **Then** the hook exits 1 with "Evidence wiring validation (Phase 5½) was not run" and lists the changed spec files. **Given** the sentinel exists **Then** the hook prints "E2E evidence wiring check passed" and continues. **Given** no E2E spec files changed **Then** the check is skipped entirely.
- **Error paths:** Missing `.e2e-evidence-wired` → exit 1; bypass with `--no-verify` (last resort).
- **Fixtures/env:** A push with e2e spec changes and no sentinel (blocked); a push with e2e spec changes and sentinel present (passes); a push with no e2e spec changes (check skipped).

#### REQ-FRAMEWORK-HOOK-004 — Pre-push hook runs validate-compliance-artifacts.sh for tracked commits (#226)

- **Priority:** Must — the local mirror of the CI compliance gate; catches missing `test-scope.md`, `test-plan.md` and `implementation-plan.md` before a push rather than after a red run.
- **Source:** `sdlc/files/stacks/node/hooks/pre-push` (section 4, reusing `HAS_TRACKED` from REQ-FRAMEWORK-HOOK-002); `sdlc/files/_common/scripts/validate-compliance-artifacts.sh`.
- **Preconditions / inputs:** The pushed range contains a `feat`/`fix`/`refactor`/`perf` commit.
- **Given** a tracked push and `scripts/validate-compliance-artifacts.sh` present **When** the hook runs **Then** it runs `bash scripts/validate-compliance-artifacts.sh origin/<integration_branch>` and, on a non-zero exit, prints `ERROR: Compliance artifact validation failed.` and exits 1; on success `Pre-push: compliance artifact validation passed.`
- **Given** the script is not present **Then** `Pre-push: compliance artifact validation skipped (script not found).` and the push continues.
- **Given** no tracked commit **Then** the section does not run.
- **Error paths:** Validator failure → exit 1; `--no-verify` bypasses.
- **Fixtures/env:** A tracked push with an evidence folder missing `test-plan.md` (blocked); the same with all three files (passes); a docs-only push (skipped).

#### REQ-FRAMEWORK-HOOK-005 — Pre-push E2E gate is REQ-scoped, not just run-recency

- **Priority:** Should — closes the gap where a stale/unrelated Playwright run satisfied the gate for a REQ that shipped with zero actual coverage (observed concretely on example-app REQ-095) — devaudit-installer#578.
- **Source:** `sdlc/files/stacks/node/hooks/pre-push` (E2E-gate section, after the existing HOOK-001 freshness check) — commit `a0de8a1`.
- **Preconditions / inputs:** Push contains UI-facing file changes (triggers the existing E2E-evidence check per HOOK-001) and at least one in-scope REQ resolved from `git log <range> --format='%B'` via the same `Ref: REQ-XXX` / `[REQ-XXX]` trailer lookup used elsewhere in the hook.
- **Given** the E2E gate already passed (fresh `playwright-report/` or an `.e2e-gate-passed` sentinel present) **When** the hook resolves the push's in-scope REQ IDs **Then** for each REQ it requires (a) at least one spec file under `e2e/` tagged `@requirement REQ-XXX`, AND (b) if `.e2e-gate-passed` carries a REQ-ID list (lines after the status line, per REQ-FRAMEWORK-SKILL-004), that list must include the REQ. **Given** either check fails for any in-scope REQ **Then** the hook exits 1 listing each failing REQ annotated `(no tagged spec)` or `(not in .e2e-gate-passed run)`, and does not accept a fresh-but-unrelated run as satisfying the gate. **Given** `.e2e-gate-passed` is old-format (status line only, no REQ list) **Then** the REQ-list cross-check degrades gracefully (skipped for that sentinel) and only the tagged-spec check applies.
- **Error paths:** Any in-scope REQ failing either check → exit 1 with the itemised `MISSING_REQS` list; bypass with `--no-verify` (last resort, logged as a habit smell, not silently allowed).
- **Fixtures/env:** A push referencing a REQ with a tagged spec and sentinel coverage (passes); a REQ with a tagged spec but absent from the sentinel's REQ list (blocked, "not in .e2e-gate-passed run"); a REQ with no tagged spec at all (blocked, "no tagged spec"); an old-format sentinel (REQ-list check skipped, tagged-spec check still enforced).

#### REQ-FRAMEWORK-SKILL-001 — sdlc-implementer writes the .sdlc-implementer-invoked sentinel at Phase 0 on the tracked route (#226)

- **Priority:** Must — the sentinel is what the pre-push hook (REQ-FRAMEWORK-HOOK-002) and, indirectly, `validate-commits.sh` use to tell a skill-driven change from a manual one.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 0, "tracked" route); the CLI engine `SDLC/bin/devaudit-sdlc.cjs` (`--phase=<N>`).
- **Preconditions / inputs:** Phase 0 classified the change as tracked (feature, bug fix, refactor, perf).
- **Given** the tracked route **When** Phase 0 completes **Then** the skill runs `node SDLC/bin/devaudit-sdlc.cjs --phase=issue`, which appends a JSON phase record to `.sdlc-implementer-invoked` (gitignored, local only; REQ-CLI-UPDATE-020). Each later phase transition (1 to 5) runs `--phase=<N>` to append its own record.
- **Given** the lightweight (housekeeping) route **Then** no sentinel is written and none is required (`docs`/`chore`/... commits are exempt from the hook).
- **Error paths:** A missing engine binary means the sentinel is not written and the pre-push hook refuses the push; fix by `devaudit update` (REQ-CLI-UPDATE-025).
- **Fixtures/env:** A fresh tracked run followed by `cat .sdlc-implementer-invoked`: one record per phase entered.

#### REQ-FRAMEWORK-SKILL-002 — sdlc-implementer Phase 2 step 5b halts if the E2E gate was not run for UI-facing changes (#226)

- **Priority:** Must — the skill-level enforcement behind the pre-push hook (REQ-FRAMEWORK-HOOK-001/-003/-005), so the gap is caught before the commit instead of at the push.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 2 step 5b); `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`.
- **Preconditions / inputs:** Phase 2 gates ran (step 5) and the next step is the commit (step 7).
- **Given** the diff against the integration branch touches UI-facing files (`app/`, `src/`, `pages/` `*.tsx`/`*.jsx`) **Then** the skill requires `.e2e-gate-passed` or a recent `playwright-report/` and otherwise **halts** with `E2E gate was not run...`, telling the agent to run `npx playwright test` or invoke `e2e-test-engineer` (CI is not a substitute, #238).
- **Given** changed `e2e/**/*.spec.ts` **Then** the `.e2e-evidence-wired` sentinel must also exist, or the skill halts (REQ-FRAMEWORK-HOOK-003).
- **Given** no UI-facing files **Then** the check is skipped, the commit body notes `E2E gate skipped`, and the skill writes the `e2e-scope-decision.md` record itself (REQ-FRAMEWORK-EVIDENCE-015, #737).
- **Given** `e2e-test-engineer` found no UI surface **Then** it wrote a `NOT_NEEDED` sentinel, the check passes and the body records the exemption.
- **Also in step 5b:** the plan to test-scope AC consistency check, and a halt when the plan names Playwright coverage but no spec tags the REQ.
- **Error paths:** Each halt returns control to the user; nothing is committed.
- **Fixtures/env:** A change to `app/page.tsx` without the sentinel (halt); an API-only change (skipped, decision persisted).

#### REQ-FRAMEWORK-SKILL-003 — sdlc-implementer Phase 1 step 9 stamps the RTM row with sdlc-implementer@version provenance (#226)

- **Priority:** Must — `validate-commits.sh` (REQ-FRAMEWORK-VALIDATE-001) fails commits citing a REQ whose RTM row lacks the stamp; this is what writes it.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 1 step 9).
- **Preconditions / inputs:** Phase 1 produced the implementation plan and the REQ is being added to `compliance/RTM.md`.
- **Given** a new RTM entry **Then** the skill writes REQ-XXX, title, risk class, linked issue, linked test cases (placeholder) and a final-column provenance marker `sdlc-implementer@<version>`. If the RTM table has no provenance column the skill adds one with the header `Provenance`; literal pipe characters in a cell are escaped.
- **Error paths:** A row without the marker makes `validate-commits.sh` fail with `no sdlc-implementer provenance in RTM.md`; the fix is to re-invoke the skill or add the marker with operator sign-off.
- **Fixtures/env:** An RTM row written by the skill (ends in `sdlc-implementer@<version>`).

#### REQ-FRAMEWORK-SKILL-004 — e2e-test-engineer writes the .e2e-gate-passed sentinel (status line plus covered REQ IDs, since #578) after a successful E2E run or NOT_NEEDED (#226)

- **Priority:** Must — the pre-push hook and `sdlc-implementer` Phase 2 step 5b read this file to decide whether the E2E gate ran for this push.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` ("Write the E2E gate sentinel"); consumed by `sdlc/files/stacks/node/hooks/pre-push` (REQ-FRAMEWORK-HOOK-001/-005).
- **Preconditions / inputs:** The full regression run (Phase 6 step 2) succeeded, or e2e was assessed as not needed.
- **Given** a successful run **Then** the skill writes `.e2e-gate-passed` in the repo root: line 1 `PASSED <UTC timestamp> <run id>`, then one `REQ-NNN` line per REQ the run covered. **Given** e2e is not needed **Then** line 1 is `NOT_NEEDED <UTC timestamp> <reason>` and the REQ line(s) still follow, so the hook can tell a deliberate skip from an unaccounted REQ.
- **Given** an old-format sentinel (status line only) **Then** the hook accepts it and skips the per-REQ sentinel cross-check (REQ-FRAMEWORK-HOOK-005).
- The file is gitignored and never committed (REQ-CLI-UPDATE-020); the durable record is `e2e-scope-decision.md` (REQ-FRAMEWORK-EVIDENCE-015).
- **Error paths:** Deferring the run to CI does not write it; the hook then blocks the push (#238).
- **Fixtures/env:** `printf` of the two sentinel shapes; the hook with a REQ missing from the list.

#### REQ-FRAMEWORK-SKILL-005 — e2e-test-engineer Phase 6 pre-flight browser check + anti-deferral instruction (#238)

- **Priority:** Must — prevents the agent from deferring E2E execution to CI by claiming browsers are not installed.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 6 — Execute and report): pre-flight check `npx playwright install --dry-run 2>&1 | grep -q "is already installed" || npx playwright install`; explicit anti-deferral instruction: "Do not defer E2E execution to CI because browsers are not installed. Installing browsers takes ~30 seconds; deferring breaks the evidence trail."
- **Preconditions / inputs:** Playwright installed in the consumer repo; E2E suite about to run.
- **Given** the skill reaches Phase 6 **When** the pre-flight check runs **Then** it verifies browser availability and installs if missing. **Given** browsers are not installed **Then** the skill installs them (`npx playwright install` or `npx playwright install --with-deps` with operator approval for sudo). **Given** the install fails **Then** the skill asks the operator for help, not defers to CI. **Given** the agent attempts to write "Deferred to CI" **Then** the gate state vocabulary instruction (#240) and `validate-test-summary.sh` reject it.
- **Error paths:** Browser install failure → ask operator; missing system deps → `--with-deps` (requires sudo, ask operator).
- **Fixtures/env:** A repo with browsers already installed (pre-flight passes); a repo without browsers (pre-flight installs); a repo with missing system deps (asks operator).

#### REQ-FRAMEWORK-SKILL-006 — e2e-test-engineer Phase 5½ writes .e2e-evidence-wired sentinel after validating wiring (#226)

- **Priority:** Must — provides the machine-enforced signal that evidence wiring was validated, backing the pre-push hook (HOOK-003) and sdlc-implementer step 5b check.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 5½ — Write the evidence-wiring sentinel): after all checks pass, writes `.e2e-evidence-wired` in repo root with `echo "WIRED $(date -u +%Y-%m-%dT%H:%M:%SZ) REQ-XXX" > .e2e-evidence-wired`. If an AC was explicitly skipped, notes it in the sentinel content. The file is gitignored (GITIGNORE-001) and never committed.
- **Preconditions / inputs:** All Phase 5½ checks pass (or explicit exemptions recorded).
- **Given** all Phase 5½ checks pass **When** the skill writes the sentinel **Then** `.e2e-evidence-wired` exists in the repo root with a timestamp and REQ ID. **Given** an AC was explicitly skipped (e.g. API-only) **Then** the sentinel notes the skip: `WIRED <timestamp> REQ-XXX (AC3 skipped — API-only)`. **Given** the sentinel is missing **Then** the pre-push hook (HOOK-003) blocks the push and sdlc-implementer step 5b halts.
- **Error paths:** Phase 5½ checks fail → sentinel not written → downstream enforcement blocks.
- **Fixtures/env:** All checks pass (sentinel written); one AC skipped with exemption (sentinel notes skip); checks fail (no sentinel, downstream blocks).

#### REQ-FRAMEWORK-SKILL-007 — sdlc-implementer Phase 2 step 4b reconciles test-plan.md file paths with actual files (#241)

- **Priority:** Should — catches test-plan drift early so `validate-compliance-artifacts.sh` doesn't fail at PR time.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 2 step 4b): after writing/updating tests, diff actual test file paths against `compliance/evidence/REQ-XXX/test-plan.md`. For each path: if file exists → OK; if missing but equivalent test covering same AC found → update test-plan.md; if missing and no equivalent → HALT. Commit updated test-plan.md alongside test code. This is file-path reconciliation only — the step 5b AC consistency check handles AC drift separately.
- **Preconditions / inputs:** `test-plan.md` authored during Stage 1 with predicted file paths; tests written/updated during Phase 2 step 3-4.
- **Given** test-plan.md references `e2e/foo.spec.ts` and the file exists **Then** no action needed. **Given** test-plan.md references `e2e/foo.spec.ts` but the test was added to `e2e/bar.spec.ts` covering the same AC **Then** update test-plan.md to reference `e2e/bar.spec.ts`. **Given** test-plan.md references `e2e/foo.spec.ts` but no test file exists and no equivalent test covering the same AC was found **Then** HALT with actionable error. **Given** test-plan.md is already accurate **Then** no changes needed.
- **Error paths:** Unreconcilable mismatch (no equivalent test) → HALT; operator must create the file, update test-plan.md, or remove the entry.
- **Fixtures/env:** A test-plan with accurate paths (passes); a test-plan with drifted paths but equivalent tests found (updated); a test-plan with no equivalent test (halts).

#### REQ-FRAMEWORK-SKILL-008 — sdlc-implementer Phase 3 step 5b validates test-execution-summary.md gate states via validate-test-summary.sh (#240)

- **Priority:** Must — prevents invalid gate states from reaching the portal by running the validator before evidence upload.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 3 step 5b): runs `bash scripts/validate-test-summary.sh origin/main` before uploading evidence. If the validator fails, fixes the summary before proceeding. E2E gate results must be PASS, FAIL, NOT_NEEDED (with reason), or SKIPPED (with rationale). The word "deferred" must never appear in test-execution-summary.md.
- **Preconditions / inputs:** `compliance/evidence/REQ-XXX/test-execution-summary.md` exists; `scripts/validate-test-summary.sh` synced to consumer.
- **Given** the skill reaches Phase 3 step 5b **When** it runs the validator **Then** invalid gate states ('deferred', 'browsers not installed', SKIPPED/NOT_NEEDED without rationale) are caught and the skill fixes them before proceeding. **Given** the validator passes **Then** the skill proceeds to evidence upload. **Given** the validator fails **Then** the skill fixes the summary and re-runs the validator.
- **Error paths:** Validator fails → fix and re-run; validator script missing → skill should note the gap (CI will catch it on PR).
- **Fixtures/env:** A summary with valid gate states (passes); a summary with 'deferred' (fails, skill fixes); a summary with SKIPPED but no rationale (fails, skill fixes).

#### REQ-FRAMEWORK-VALIDATE-001 — validate-commits.sh checks the RTM provenance stamp for REQ-XXX in feat/fix/refactor/perf commits (#226)

- **Priority:** Must — the CI backstop to the local sentinel: a tracked commit whose REQ was never created by the skill is rejected even when `--no-verify` skipped the hook.
- **Source:** `sdlc/files/_common/scripts/validate-commits.sh` ("RTM provenance check").
- **Preconditions / inputs:** A commit of type `feat`, `fix`, `refactor` or `perf`; `compliance/RTM.md` exists. The REQ comes from a `[REQ-NNN]` tag in the subject, else the last `Ref: REQ-NNN` line in the body.
- **Given** the REQ has an RTM row (`^| REQ-NNN `) without `sdlc-implementer@` **Then** the commit is counted as failed (`ERROR [<sha>]: REQ-NNN in commit message has no sdlc-implementer provenance in RTM.md.`) and the script exits non-zero.
- **Given** the row carries the stamp, has no row yet, or the commit cites no REQ **Then** this check passes (a missing REQ is handled by the separate traceability check, including the single-active-release warning of #315).
- **Error paths:** Exit 1 with the remediation text: invoke `sdlc-implementer`, or add the marker manually with operator sign-off.
- **Fixtures/env:** An RTM with and without the stamp, and commits citing it.

#### REQ-FRAMEWORK-VALIDATE-002 — validate-test-summary.sh rejects invalid gate states in test-execution-summary.md (#240)

- **Priority:** Must — the CI-side enforcement that backs the skill-side prohibition on invalid gate states.
- **Source:** `sdlc/files/_common/scripts/validate-test-summary.sh`: extracts REQ-XXX from commit messages, finds `compliance/evidence/REQ-XXX/test-execution-summary.md`, checks for: (1) 'deferred' on any line (case-insensitive), except the SDLC's own vocabulary `@e2e-deferred`, `@risk-deferred` and `deferred-to-next`, which is removed from a line before it is tested (#1081), (2) 'browsers not installed', (3) 'Deferred to CI', (4) E2E gate table rows with 'defer' in result column, (5) SKIPPED/NOT_NEEDED without rationale. Exits 1 if any check fails.
- **Preconditions / inputs:** PR with REQ-XXX in commit messages; `test-execution-summary.md` exists for the REQ.
- **Given** a summary containing 'deferred' on a line that is not only the exempt vocabulary **Then** the validator exits 1. **Given** a summary whose only 'deferred' is `@e2e-deferred`, `@risk-deferred` or `deferred-to-next` **Then** that does not fail it, and an exempt tag on one line never hides a bare 'deferred' on another (#1081). **Given** a summary containing 'browsers not installed' **Then** the validator exits 1. **Given** a summary with E2E gate result SKIPPED but no rationale in the Details column **Then** the validator exits 1. **Given** a summary with E2E gate result NOT_NEEDED but no rationale **Then** the validator exits 1. **Given** a summary with all valid gate states and rationales **Then** the validator exits 0. **Given** no REQ-XXX in commit messages **Then** the validator skips (exit 0). **Given** no test-execution-summary.md for the REQ **Then** the validator skips that REQ (exit 0).
- **Error paths:** Any invalid gate state → exit 1; missing file → skip (validate-compliance-artifacts.sh checks existence).
- **Fixtures/env:** 11 test cases in `validate-test-summary.test.sh`: clean PASS, deferred, Deferred to CI, browsers not installed, NOT_NEEDED with rationale, SKIPPED with rationale, SKIPPED without rationale, no REQ references, no summary file, e2e deferred in assessment, NOT_NEEDED without rationale.

#### REQ-FRAMEWORK-VALIDATE-003 — validate-test-summary.sh rejects stale Stage-3 pre-PR draft language surviving into the release PR (#607)

- **Priority:** Must — `test-execution-summary.md` is authored once, locally, at Stage 3 ("Compile Evidence"), before the integration PR even opens (per `3-compile-evidence.raw.md` Step 1a's own template — "CI Run: [run ID or local]"). Nothing in the framework ever revisits the file after the real CI run completes, so the evidence uploaded to the portal as the REQ's ISO 29119-3 test completion report can permanently claim a release is still blocked and pending CI — even after it shipped to production. Confirmed on example-app's most recent releases before this fix.
- **Source:** `sdlc/files/_common/scripts/validate-test-summary.sh` (Check 8, added alongside the existing checks 1–7 from VALIDATE-002) — commit `63a5308`, #607. This script only ever runs on PRs to `main` (the final release gate); by the time a release PR exists, real CI has necessarily already run on `develop`.
- **Preconditions / inputs:** A release PR to `main`; `compliance/evidence/REQ-XXX/test-execution-summary.md` still containing Stage-3 draft placeholder text.
- **Given** a summary containing the case-insensitive phrase `"not yet a CI run"` **Then** the validator exits 1 with "this evidence pack was never refreshed after the integration PR's real CI run completed," listing the offending lines. **Given** a summary matching `"CI run.*not yet available"` **Then** the validator exits 1 with the equivalent message. **Given** a summary containing `"Production promotion remains blocked"` **Then** the validator exits 1, noting this is Stage-3 draft boilerplate that cannot still be true once a release PR exists for the REQ. **Given** none of the three phrases are present **Then** this check passes (existing checks 1–7 still apply independently).
- **Error paths:** Any of the three stale-language patterns found → exit 1, offending lines echoed; operator must replace the placeholder with the actual CI workflow run link/ID (or update the Final assessment) before the release PR merges.
- **Fixtures/env:** Cases 16–18 in `validate-test-summary.test.sh` — `"not yet a CI run"` surviving into the release PR, `"CI run: not yet available"` surviving, and `"Production promotion remains blocked"` surviving — each asserted to fail (exit 1).

#### REQ-FRAMEWORK-VALIDATE-004 — validate-commits.sh accepts `style:`, REQ-exempt like other housekeeping types (#813)

- **Priority:** Must — `style` is a standard Conventional Commits type (formatting/whitespace, no behaviour change) that was missing from `CC_REGEX`'s type list and the REQ-exempt housekeeping `case` branch. A `style:` commit passed local hooks and PR-to-integration CI, then failed this same regex on the release PR to `main` — by which point the commit is on a protected branch, so the only ways out were rewriting shared history or bypassing the gate. Seen live on `metasession-dev/EXAMPLE-BACKEND-SERVICE` (two formatting-only `style:` commits blocked a release PR).
- **Source:** `sdlc/files/_common/scripts/validate-commits.sh` (`CC_REGEX`; the `docs|style|chore|ci|build|test|revert|compliance` housekeeping-exempt `case` branch).
- **Preconditions / inputs:** A commit subject in the PR's commit range being checked against `CC_REGEX`.
- **Given** a subject of the form `style: <description>` (optionally with a leading `[REQ-XXX]` tag or `(<scope>)`) **When** checked **Then** it matches `CC_REGEX` (accepted as Conventional Commits format) and, when the type-dispatch `case` runs, falls into the housekeeping-exempt branch — subject to the same `#768` diff-shape warning (flagged if it touches a configured `source_dirs` path) as `docs`/`chore`/`ci`/etc., never the hard REQ-citation requirement `feat`/`fix`/`refactor`/`perf` commits get.
- **Error paths:** N/A — this REQ only widens the accepted type set; all other `CC_REGEX`/housekeeping behavior (malformed REQ prefixes rejected, ambiguous-release-context handling, `#768` diff-shape warning) is unchanged.
- **Fixtures/env:** `sdlc/files/_common/scripts/validate-commits.test.sh` Case 9 — a `style:` commit exits 0, with neither the "Not Conventional Commits format" nor the "implementation commit but cites no requirement" error. 23/23 cases in this file pass, confirming no regression to the other 8 cases.

#### REQ-FRAMEWORK-GITIGNORE-001 — gitignore.ts syncs .e2e-evidence-wired sentinel entry to consumer .gitignore (#226)

- **Priority:** Must — ensures the evidence-wiring sentinel is never committed to consumer repos.
- **Source:** `cli/src/update/gitignore.ts` (`SENTINEL_ENTRIES` array includes `.e2e-evidence-wired` alongside `.e2e-gate-passed` and `.sdlc-implementer-invoked`); `syncGitignore` function adds missing entries under the `# DevAudit sentinel files` marker.
- **Preconditions / inputs:** Consumer repo with a `.gitignore` file (or none — created if needed).
- **Given** `devaudit update` runs on a consumer repo **When** `syncGitignore` executes **Then** `.e2e-evidence-wired` is added to `.gitignore` if not already present. **Given** the entry already exists **Then** no duplicate is added (idempotent). **Given** no `.gitignore` exists **Then** one is created with the sentinel entries.
- **Error paths:** File system errors → sync fails gracefully.
- **Fixtures/env:** A consumer repo without `.gitignore` (created); a repo with `.gitignore` but missing the entry (added); a repo with the entry already present (no-op).

---

#### Assumptions — Adapters/Governance/Rules

- **Runtime JSON-Schema validation of adapters** is enforced via Ajv in `cli/src/lib/adapter.ts` (DevAudit-Installer#158). Both `loadStackAdapter` and `loadHostAdapter` compile the appropriate `adapter.schema.json` and validate the parsed adapter before returning it. Schema-invalid adapters are rejected with a clear error listing all violations.
- **`cli/src/update/scripts.ts` not fully read.** ADAPTER-009 infers that `stack_scripts` (node's `check-requirement-jsdoc.sh`) is rendered into the consumer's `scripts/` by the `2d` section runner (`syncScripts`); the exact target path and skip semantics were taken from the adapter manifest + schema description (`copied to the consumer's scripts/ directory`), not from reading `scripts.ts` line-by-line.
- **Host-adapter deploy substitution rendering is owned by FRAMEWORK-CI.** This area resolves and loads the host adapter (by name) and documents the substituted fields; the actual placement of `deploy_trigger`/`production_url`/`wait_for_deploy` into `.github/workflows/*.yml` happens in `cli/src/update/ci-templates.ts` (section `2f`), which is scoped to the CI SRS section. ADAPTER-011/012 assert the contract values and the cross-area boundary, not the rendered-YAML bytes.
- **`bootstrap-governance` command surface owned by another section.** GOVERNANCE-001/002 reference `cli/src/commands/bootstrap-governance.ts` only to establish the opt-in boundary and idempotent copy behaviour of `bootstrapGovernanceDocs`; the command's CLI flags/output formatting are owned elsewhere.
- **`incident-report` GDPR.Art-34 clause** is taken from the `bootstrap-governance.ts` docstring; the template's own visible "Framework coverage" list shown in source begins with `ISO29119.3.5.4`, `SOC2.CC7.2`, `GDPR.Art-33` (the head of the list was read; Art-34 is asserted from the docstring mapping).
- **Version provenance (v0.1.36 opt-in, v0.1.39 operator-upload, etc.)** is taken from the template banners and `bootstrap-governance.ts` comments as documentary fact, not independently verified against a changelog.

---

## Appendix A — Assumptions & Ambiguities

Behaviours below are **implicit, possibly unintended, or divergent from stated intent / the issue brief**. They are flagged for a human decision; tests should assert _current_ behaviour (as captured in §4) and link here. Each §4 subsection also carries its own `Assumptions — <area>` block.

### A.1 Likely bugs / divergences (verify before relying on intent)

- **~~`update --dry-run` is a no-op.~~ Resolved** in `3e5d8bc` (#154): `update --dry-run` now previews without mutation — see REQ-CLI-UPDATE-018 (corrected 2026-09-29).
- **CLI `push` ≠ `scripts/upload-evidence.sh`.** The major historical parity gaps are now closed: the CLI implements the drift-warning probe, recursive directory upload, starter-stub skip, metadata/release fields, and default retry budget. The remaining meaningful difference is that CI still uses the shell as the authoritative stage-stamping path (`--sdlc-stage` / `sdlcStage`) and the shell documents lower-level transport knobs (`curl -L`, `--max-redirs`) that the CLI leaves to platform `fetch` defaults.
- **Base URL compatibility.** Generated workflows prefer the reviewed `sdlc-config.json` `devaudit.base_url` and retain `DEVAUDIT_BASE_URL` only as a deprecated fallback. Missing both sources produces a visible skip/warning rather than an unlabelled destination.
- **Python `ci.yml` mislabels security evidence.** It uploads SAST + dep-audit results as `audit_log` rather than the precise `sast_report` / `dependency_audit` types, so the portal's two panels can show identical content (devaudit#387 — unfixed for python). Python also derives a bare-date release version rather than the REQ-tag.
- **Adapter-schema validation is now runtime-enforced.** `cli/src/lib/adapter.ts` compiles the host/stack schemas with Ajv and rejects parseable-but-schema-invalid manifests at load time.
- **~~`doctor` description overstates behaviour.~~ Resolved** — the description now matches (tools + close-out drift + onboarding invariants + `--json`); `doctor` still performs no token or full config-schema validation (REQ-CLI-DOCTOR-004).
- **~~Deferred tickets are not filtered out of production promotion (#956).~~ Resolved in phase 3b** — `post-deploy-prod.yml` and the other pending-ticket loops now skip deferred tickets (REQ-FRAMEWORK-DEFERRAL-005). Still unverified: whether the portal accepts evidence uploads to a `deferred` release; the CI loops simply no longer attempt them.
- **Python stack dev-deps are declared but never auto-installed** — `syncStackDeps` early-returns for any non-node stack; python deps come via `pip install -e ".[dev]"` (operator-run), not the CLI.

### A.2 Divergences from the issue brief (the brief assumed these; the code differs)

- **`upgrade` is not a self-updater** — in v0.1.54 it is a `makeStub` command (prints "not implemented" + tracking issue → exit 1). Marked `Won't`.
- **The AI-rule source is `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`**, not the repo's own root `INSTRUCTIONS.md` or `implementing-an-sdlc-issue.md` (those are the installer's own docs).
- **`install` and `update` share one render path** (`install/sync-templates.ts` → `syncProject()`), so every template/sync requirement applies to both.
- **The drift warning the brief attributes to `devaudit push`** is now real CLI behaviour too: `runPush` calls `probeBaseUrlDrift()` before upload and logs a warning on cross-host redirects.
- **No true CLI-E2E layer is encoded in this repo** — the real install/update-against-consumer coverage (example-app; EXAMPLE-JOBS-APP reverted per `docs/consuming-projects.md`) is manual/external.

### A.3 Exit-code & flow quirks (load-bearing — assert exactly)

- **Distinct exit codes** carry meaning and are asserted in the existing suite: `join` not-onboarded → **7**; `status` not-onboarded → **7**; `doctor` missing-tool → **6** (but `doctor --fleet` exits **0** after a completed sweep regardless of findings, **3** on not-logged-in / portal-rejected token, **1** on other portal errors); `update` usage errors (no paths, both e2e-regression flags) → **2**, un-onboarded path with an e2e-regression flag → **1**; `push`/`auth` missing-key / rejected token / not-logged-in → **3**; upload failure → **4**; plugin `npm install` failure → **5**; git clone → **6**; manifest validation → **9**; generic errors → **1**.
- **Dev-mode auto-routing is a strict three-bit AND** (config file + portal project + live `Onboarding-issued` key — the former fourth bit, a `DEVAUDIT_USER_TOKEN` repo secret, was removed in #912 along with `install` writing that secret); any miss or any portal error **falls back to operator** (safe default). `--dry-run` forces **operator** mode so the preview shows the maximal step set. The destructive steps skipped in dev mode are exactly **4, 6, 7, 9, 10** (plus 6b); steps **8 (hooks) and 11 (sync)** run in both modes.
- **`install` has no dirty-tree check**, and **"not a git repo" yields `provider: null` → GitHub steps 7/9 are reported `skipped`, not a non-zero exit.**
- **`--org <slug>` is registered but inert** across the CLI (workstream B unbuilt). Marked `Won't`.
- **`doctor --fix` exit codes (#956 phase 3b).** Plain `doctor` stays read-only with unchanged exit codes (new checks never set `allOk=false`). `doctor --fix` exits **8** when proposals remain unapplied (no TTY, declined confirmation, `CI` set without `--yes` for tier A, a tier B proposal without an interactive terminal, failed portal call), `0` otherwise and for `--dry-run`; exit 6 (missing tool) still wins; `--fleet --fix` and `--reason` without `--fix` exit 2. Tier C guidance does not count as unapplied (assumption: it is never actionable by the tool).
- **Two portal auth header schemes:** evidence upload uses `Authorization: Bearer`; PAT validation (`devaudit-api.ts`) uses `x-devaudit-token`. Only interactive `auth login` enforces the `mctok_` prefix; `--api-key`/env keys are unchecked.

### A.4 Skill-contract subtleties

- **The `e2e-test-engineer` delegation contract is double-gated** (devaudit#132): a verbatim pre-edit transcript line (`Delegating e2e test work to e2e-test-engineer.`) **plus** a post-hoc per-spec self-audit over the git diff — both directly assertable, the strongest black-box hook in the skill set.
- **`evidenceShot` is fully observable** from the shipped `references/evidence.ts`: output `compliance/evidence/REQ-XXX/screenshots/REQ-XXX-AC<n>-<slug>.png` + a sidecar `.meta.json`; slug constrained to `[a-z0-9-]+`; `feature`/`regression` origin auto-detected from `E2E_NEW_SPECS`.
- **The three SoT skills defer framework-clause closure** to META-COMPLY's `framework-registry-auditor` and may ship "orphan-by-design" artefacts — so requirements assert the `evidence_type` tag + upload path, **not** clause closure.
- **`sdlc-implementer` has exactly three named pause points** (Phase 1 step 11 HIGH/CRITICAL plan approval; Phase 4 step 5 release-PR hard stop; Phase 5 separate `resume`). Everything else is silent continuation (opt-in-to-pause).
- **The governance starter banner** reads "STARTER TEMPLATE — REPLACE BEFORE COMMITTING" on disk; a `bootstrap-governance.ts` docstring quotes the older "REPLACE BEFORE GOING TO PRODUCTION" — assert the on-disk text.
- **The synced stage docs' "🛑 SYSTEM OVERRIDE: STOP IMMEDIATELY" banner (REQ-FRAMEWORK-STAGE-004) reads like a prompt-injection artifact on first encounter — it is intentional CLI-gating, not a bug or an actual injection attempt.** It's first-party content the installer itself ships, directing an AI agent to invoke `node SDLC/bin/devaudit-sdlc.cjs --phase=N` (the orchestrator) rather than hand-executing the stage procedure. The same banner appears at the top of the full-text `sdlc/src/blueprints/*.raw.md` sources, followed by the complete stage documentation — a human operator can always read the real content via `--phase=N --view` or by opening the `.raw.md` file directly.

### A.5 Operational notes

- **Failed CI gates still upload evidence** (`if: always() && !cancelled()`, `gateStatus=failed`) — deliberate (devaudit#96/#132); `status=failed` is the audit trail.
- **`check-release-approval` is fail-closed:** a projects-404 contradicted by a `releases/resolve` 2xx **fails** the gate rather than bootstrapping — preferring a hard stop over bypassing four-eyes.
- **Release deferral is a three-layer state (#956, ADR-002).** The ticket's `Release intent` field is the sole declaration; RTM `DEFERRED` is the repo-side status; the portal `deferred` state is portal-owned and admin-only (session or personal access token; deployed with devaudit#895). The portal does not write back into the ticket, so a mismatch is possible and is diagnosed by `doctor` (D1-D8) and repaired by `doctor --fix`. Deferred tickets stay in `pending-releases/`; there is no `deferred-releases/` directory. Declared bundles remain Node-template only.
- **`status` and `compliance-validation` check different doc subsets** — `status` inspects 2 of 6 stage docs + all 5 rule files (not Tier-1); `validation` warns on the three `Test_*` Tier-1 docs only.

---

## Appendix B — E2E Test Environment

### B.1 External dependencies — stand up / stub

| Dependency               | Mode for tests | How                                                                                                                                   |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| DevAudit portal HTTP API | stub           | **msw** `setupServer` (unit) with `onUnhandledRequest:'error'`, CLI pointed via `DEVAUDIT_BASE_URL`; or a local HTTP stub for CLI-E2E |
| `gh` CLI                 | mock / shim    | `vi.mock('execa')` recording calls + an injected fake provider (unit); an on-disk `gh` shim prepended to `PATH` (CLI-E2E)             |
| `git`                    | real / mock    | real `git init` temp repo, or execa mock                                                                                              |
| `npm`                    | sandbox / mock | allow inside the throwaway fixture, or mock `syncStackDeps` / `plugin update`                                                         |
| `sdlc/files/` templates  | real snapshot  | set `DEVAUDIT_INSTALLER_ROOT` → repo root (skips `bundle:templates`), or run `npm run bundle:templates` first                         |
| PAT / auth cache         | temp HOME      | point `XDG_CONFIG_HOME` / HOME at an `fs.mkdtemp` dir so `~/.config/devaudit/{auth.json,plugins/}` is sandboxed                       |

### B.2 Core fixtures

- **A node consumer repo** (`package.json`, `git init`) and **a python consumer repo** (`pyproject.toml`/`requirements.txt`) — to exercise stack detection + node-vs-python rendered deltas.
- **A clean (un-onboarded) consumer** and **an already-onboarded consumer** (with `sdlc-config.json`, a portal project, and an `Onboarding-issued` key marker — no repo-secret marker is needed since #912 removed the `DEVAUDIT_USER_TOKEN` detection bit) — to exercise operator vs developer-mode auto-routing and `join`.
- **A portal stub** serving: PAT validation (`GET /api/projects`), project create, CI-key issuance, evidence upload (`POST /api/evidence/upload`, incl. a 429-then-200 sequence to test retry), and `GET /api/ci/releases/resolve`.
- **Deferral fixtures (#956):** a portal stub for the defer/resume routes (`POST /api/releases/[id]/defer`, `/resume`) that accepts a session/PAT credential and rejects CI/API/viewer keys, plus `GET /api/ci/releases/resolve` returning `deferredAt`/`deferredReason`/`deferredUntil`/`deferredToVersion` for a `deferred` release; a viewer-key fixture (`DEVAUDIT_VIEWER_API_KEY`, with the `DEVAUDIT_API_KEY` fallback) for the read-only doctor checks; a PAT fixture (`DEVAUDIT_USER_TOKEN`) for the admin path. Phase 3b tests (`doctor-fix.test.ts`, `release-deferral-api.test.ts`) drive defer/resume against such a stub with fake tokens only; none calls a real portal.
- **A `gh` shim / fake provider** asserting secret-set + branch-protection calls without touching GitHub.
- **Plugin fixtures:** a local git repo as a plugin source (install), and a seeded `~/.config/devaudit/plugins/` (list/remove/update).
- **Auth fixtures:** a valid and an invalid PAT (only interactive login enforces the `mctok_` prefix).

### B.3 Suggested mocking strategy & test layering

- **Unit (present):** import the action function (`runInstall`, `syncProject`, `runDoctor`, …); msw for the portal, `vi.mock('execa')` / fake provider for `gh`/`git`, temp fixture repos, `DEVAUDIT_INSTALLER_ROOT` for templates. Assert the returned report + the fixture filesystem.
- **CLI integration (recommended):** `execa('node', [bin/devaudit.js, …], { reject:false })` against a throwaway `git init` fixture, with a local HTTP portal stub + an on-disk `gh` shim on `PATH` (the cross-process replacement for `vi.mock`). Assert **exit code + stdout/stderr + filesystem deltas**. Requires a prior `npm run build` (the bin loads `dist/`) and `bundle:templates`-or-`DEVAUDIT_INSTALLER_ROOT`.
- **Full E2E (recommended, scheduled or dispatched by the consumer — not the PR gate):** a real `install`/`update` against a dedicated _tracer consumer_ repo, asserting the rendered CI workflows + rule files + a real portal (or a high-fidelity stub). Keep off the PR critical path.
- **Template-render tests:** render each CI template + adapter combo (node/python × railway) and assert the rendered file content (tokens substituted, services block stripped where applicable) — these are pure-function tests needing no network.

## Appendix C — Release lineage integrity requirements (#405)

| ID              | Requirement                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SRS-LIN-405-001 | Bundle manifest schema v2 shall include original member titles, explicit evidence/execution inheritance policy, strict generator provenance, and a portal-verifiable canonical hash. |
| SRS-LIN-405-002 | Generated workflows shall start test-execution records before governed execution and complete them from the authoritative execution result, independently of evidence upload.        |
| SRS-LIN-405-003 | Quality gates shall use the CI environment; production deployment and production smoke shall be distinct stage-5 test executions.                                                    |
| SRS-LIN-405-004 | Every terminal execution state, including failure without artifacts, cancellation, timeout, skipped, and action-required, shall remain visible.                                      |
| SRS-LIN-405-005 | Evidence upload completeness shall be reported as a separate required check and shall not overwrite the execution outcome.                                                           |
| SRS-LIN-405-006 | Consumer rollout shall deploy the tolerant portal contract before installer schema-v2 strict emission.                                                                               |

## Appendix D — Release pipeline quality requirements (#85, #86, #87)

| ID | Requirement |
| --- | --- |
| SRS-PIPE-085-001 | Installer CI shall reject synced shell helpers whose final `[ ... ] && command` or `[ ... ] \|\| command` can leak a nonzero status under `set -e`; fixtures shall prove the rejection and explicit-success form. |
| SRS-PIPE-086-001 | RTM readers and writers shall use one context-aware Markdown-table helper that requires the key and target headers in the containing table and preserves escaped pipes. |
| SRS-PIPE-086-002 | Release close-out and compliance validation shall resolve RTM status/risk from the requirements table, never from a similarly named legend or unrelated table. |
| SRS-PIPE-087-001 | A repository fixture backed by a mock portal shall prove one exact release identifier is retained through derivation, execution start/completion, portal resolution, RTM mutation, ticket movement, and close-out. |
| SRS-PATCH-084-001 | `devaudit update` shall apply committed `.devaudit-patches/*.patch` files after canonical template sync and before validation, in lexical order. The sync manifest (devaudit-installer#930) is written even later — after formatting (2l) — so it records each patched file's **final, post-patch, post-format** content, not the pre-patch template output `writeManaged` saw when it first rendered the file. |
| SRS-PATCH-084-002 | Clean patches apply atomically; already-upstream patches are reported as obsolete; a patch that no longer applies cleanly against the freshly synced upstream template is skipped (that file keeps the fresh, unpatched template content) and reported as a warning naming the patch and its linked upstream issue — it does **not** abort the sync (devaudit-installer#921/#923; before #923 this failed the whole sync nonzero, which meant one stale patch silently skipped every later section including the version stamp). Since devaudit-installer#1023 the skipped patch is also persisted in `.devaudit/sync-manifest.json` (`patches.<name>`: `conflict`, `detected_at` — the first sync that saw it, kept while it stays in conflict — and the companion `.patch.json`'s `upstream_issue`/`reason`) and surfaced by the non-gating `devaudit doctor` `patch-conflicts` check (REQ-CLI-DOCTOR-014); the record is rebuilt every sync, so it clears once the patch applies, becomes obsolete, or is removed. Patches that conflict when combined with each other (rather than with upstream) remain a hard failure — a different, harder-to-safely-partial-apply scenario, deliberately left unchanged. Either way (patch applied, skipped, or absent), the resulting on-disk content is what the manifest records as "unmodified" going forward — a successfully patched file therefore reads as clean, not as a conflict, on the next sync (closing the gap this note used to leave open before devaudit-installer#930). |
| SRS-PATCH-084-003 | The patch directory is consumer-owned, remains untouched by sync, uses repository-relative paths, and is documented as a temporary exception requiring an upstream issue and later removal. |
