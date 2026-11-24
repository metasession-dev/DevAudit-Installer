# Changelog

All notable changes to `@metasession.co/devaudit-core` are documented here. The core follows semver and is versioned with the rest of the packages.

## [Unreleased]

### Added

- **`NOT_ASKED` lists `ai_use_note`** (DevAudit-Installer#1301): whether a missing `ai-use-note.md` for an AI-authored REQ is a warning (the default), an error or ignored is set with `configure set`, not asked.

- **`NOT_ASKED` lists `reuse_pull_request_gates`** (DevAudit-Installer#1298): reusing the pull request run's gate result on a merge is on by default; it is turned off with `configure set`, not asked.
- **The five-moments text of the presets** (DevAudit-Installer#1298): the merge moment says the gates are not run again when the pull request run tested the same tree.

- **`NOT_ASKED` lists `report_only_e2e_enabled` and `report_only_e2e_projects`** (DevAudit-Installer#1297): they are set with `configure set`, not asked.

- **`NOT_ASKED` lists `paths_ignore_pull_request`** (DevAudit-Installer#1290): applying `paths_ignore` to pull requests is an opt-in set with `configure set`, not asked.
- **`NOT_ASKED` lists `delivery.github_token_source` and `delivery.agent_git_name`** (DevAudit-Installer#1286): where a delivery run gets its GitHub token, and the name of its git author, are set with `install --delivery` or `configure set`, not asked.
- **`presetForComplianceMode`, `COMPLIANCE_MODES`, `isComplianceMode`** (DevAudit-Installer#1272): the compliance mode of a headless install names a preset (`none` A, `light` B, `regulated` C); when it cannot be offered the next one down is used, with a one-line note, and D is never chosen. `docs/presets.md` (generated) gains a "Compliance modes" section and a delivery-run paragraph.
- **`NOT_ASKED` lists `delivery.enabled`, `delivery.max_turns` and `delivery.max_minutes`** (DevAudit-Installer#1272): a DevAudit Delivery run is a deliberate opt-in set with `install --delivery` or `configure set`, not asked.
- **`NOT_ASKED` lists `e2e_report_include_traces`** (DevAudit-Installer#1275): keeping traces and videos in the Playwright report zip is set with `configure set`, not asked.

- **`NOT_ASKED` lists `uat.mode`** (DevAudit-Installer#1246): the new setting for who executes the UAT procedure (manual or auto) is set with `configure set`, not asked during onboarding.

- **`NOT_ASKED` lists `uat.human_pack`** (DevAudit-Installer#1215): the new setting for when the human UAT pack is required is set with `configure set`, not asked during onboarding.

- **Presets, the question registry and the validators** (DevAudit-Installer#1116, WP5): `PRESETS` (A, B, C, D: configuration, what runs at the five moments, evidence, gap, clauses with a recorded gap, requirements), `offerPresets` and `suggestPreset` (one rule for scan, install and doctor; never suggests D), `QUESTIONS` Q0a to Q21 with `questionsToAsk` and `conditionHolds`, `NOT_ASKED`, the eleven validators (`validate`, `validateAll`) and `renderPresetsMarkdown` (the source of `docs/presets.md`).
- **The gap model** (DevAudit-Installer#1116, WP4): `Gap`, `GapOption`, `FixTier`, `ClauseState`, `Remediation` (moved here from the CLI) and `findingToGap(check, finding, explanation?)`, which turns a check's finding into a gap with a reason and at least one option. Shared by `devaudit doctor`, `devaudit scan` and the portal.
- **Detection** (DevAudit-Installer#1116, WP3): `detectFacts(reader)` and its parts (`detectStack`, `detectTestRunners`, `hostEvidenceFromFiles` / `rankHostEvidence`, `detectBranches`, `detectRunner`, `detectGovernanceFiles`, `detectTestGroups`, `detectTestData`), ported from the CLI and extended with the facts the onboarding questions need. Everything reads through a `RepoReader` (`list`, `read`, optional `lastCommitDate`); a path that is absolute or has a `..` segment is refused with `RepoPathError`. `@metasession.co/devaudit-core/node` exports `fsRepoReader(root)`, which also treats a symlink that leaves the root as absent. A Playwright config is read as text and never executed.

- **New package** (DevAudit-Installer#1116, WP1): the pure shared core of the `devaudit` CLI and the portal, with a pure entry point (`.`) and a Node-only entry point (`./node`). It currently exports only its contract version; detection, the gap model, presets, the question registry and the local scan arrive in later work packages.
