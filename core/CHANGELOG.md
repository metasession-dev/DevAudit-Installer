# Changelog

All notable changes to `@metasession.co/devaudit-core` are documented here. The core follows semver and is versioned with the rest of the packages.

## [Unreleased]

### Added

- **The gap model** (DevAudit-Installer#1116, WP4): `Gap`, `GapOption`, `FixTier`, `ClauseState`, `Remediation` (moved here from the CLI) and `findingToGap(check, finding, explanation?)`, which turns a check's finding into a gap with a reason and at least one option. Shared by `devaudit doctor`, `devaudit scan` and the portal.
- **Detection** (DevAudit-Installer#1116, WP3): `detectFacts(reader)` and its parts (`detectStack`, `detectTestRunners`, `hostEvidenceFromFiles` / `rankHostEvidence`, `detectBranches`, `detectRunner`, `detectGovernanceFiles`, `detectTestGroups`, `detectTestData`), ported from the CLI and extended with the facts the onboarding questions need. Everything reads through a `RepoReader` (`list`, `read`, optional `lastCommitDate`); a path that is absolute or has a `..` segment is refused with `RepoPathError`. `@metasession.co/devaudit-core/node` exports `fsRepoReader(root)`, which also treats a symlink that leaves the root as absent. A Playwright config is read as text and never executed.

- **New package** (DevAudit-Installer#1116, WP1): the pure shared core of the `devaudit` CLI and the portal, with a pure entry point (`.`) and a Node-only entry point (`./node`). It currently exports only its contract version; detection, the gap model, presets, the question registry and the local scan arrive in later work packages.
