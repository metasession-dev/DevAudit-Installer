# Changelog

All notable changes to `@metasession.co/devaudit-core` are documented here. The core follows semver and is versioned with the rest of the packages.

## [Unreleased]

### Added

- **New package** (DevAudit-Installer#1116, WP1): the pure shared core of the `devaudit` CLI and the portal, with a pure entry point (`.`) and a Node-only entry point (`./node`). It currently exports only its contract version; detection, the gap model, presets, the question registry and the local scan arrive in later work packages.
