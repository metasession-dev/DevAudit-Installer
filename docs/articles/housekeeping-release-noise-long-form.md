# When Your CI Creates More Releases Than Your Developers

> **Historical case study.** This article documents the pre-#409 housekeeping workflow. Today, normal no-REQ work is integration history and only an explicitly declared standalone exception enters the release approval path.

> **Primary persona:** CTO + Lead Developer
> **Funnel stage:** MOFU — Consideration
> **Format:** Technical deep-dive (~2000 words)
> **Cross-links:** [/sdlc](https://devaudit.ai/sdlc) · [docs/release-playbooks/housekeeping-release.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/release-playbooks/housekeeping-release.md) · [docs/change-workflows.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/change-workflows.md)

---

You open your compliance portal on a Monday morning and find three new release records waiting for sign-off. You didn't ship a feature over the weekend. Nobody on your team opened a PR. What happened?

DevAudit's `devaudit update` ran a template sync on Saturday. Dependabot bumped a dependency on Sunday. A docs commit landed on Friday evening. Each one pushed to `develop`, each one triggered CI, and each one created a housekeeping release on the portal — complete with auto-generated release tickets, security summaries, and a sign-off PR.

The releases are real. The evidence is valid. The gates ran. But the portal is filling up with release records for changes nobody authored — machine-generated template refreshes and dependency bumps that don't represent operator intent. Your release queue's signal-to-noise ratio is degrading, and your reviewers are spending time signing off on changes that should have been absorbed into the next feature release.

This is the housekeeping release noise problem, and it's a direct consequence of a design decision that was correct for human-authored commits but didn't account for automated tooling.

## How we got here

DevAudit defines two release shapes. A **tracked release** (`REQ-XXX`) carries the full ceremony — risk classification, implementation plan, test scope, per-AC evidence, four-eyes approval. A **housekeeping release** (`vYYYY.MM.DD`) is the lightweight path for ticketless work: docs tweaks, dependency bumps, CI configuration changes. No requirement, no Stage 1, no per-REQ evidence. CI auto-generates the release artefacts and hands them to you as a sign-off PR.

The housekeeping path was designed for **operator-authored** changes — a developer pushing `chore: bump eslint to 9.x` or `docs: update API reference`. These are deliberate human decisions that warrant a release record and a review trail. The bare-date version (`v2026.06.25`) collapses all same-day housekeeping pushes into one release, which is elegant.

The problem is that the system doesn't distinguish between a human pushing `chore: bump eslint` and `devaudit update` pushing `chore: sync DevAudit templates from v0.1.69 to v0.1.70`. Both are `chore:` commits. Both lack a `[REQ-XXX]` tag. Both trigger the same version derivation logic, which falls through five resolution steps and hits the bare-date fallback:

1. `[REQ-XXX]` in commit subject? No.
2. `Ref: REQ-XXX` in commit body? No.
3. `[REQ-XXX]` in commit body? No.
4. Exactly one pending `RELEASE-TICKET-REQ-*.md` on disk? No.
5. Exactly one `IN PROGRESS` row in `RTM.md`? No.
6. **Fallback: `v$(date -u +%Y.%m.%d)`** ← this fires.

The `register-release` job then calls `upload-evidence.sh` with `--create-release-if-missing`, and the portal creates a new release record. The `compliance-evidence.yml` workflow detects the bare-date version and auto-generates a stub release ticket and security summary, opening a sign-off PR.

Every step is correct in isolation. The chain is the problem.

## A real example

On the wawagardenbar-app project, CI run 28156639541 triggered on a push to `develop` with the commit message `chore: sync DevAudit templates from v0.1.69 to v0.1.70`. The commit touched workflow templates and scripts — files outside the `paths-ignore` list — so `ci.yml` fired. The version deriver hit the bare-date fallback and returned `v2026.06.25`. The portal created a housekeeping release. The compliance workflow auto-generated `RELEASE-TICKET-v2026.06.25.md` and `security-summary-v2026.06.25.md`, then opened `chore/housekeeping-release-v2026.06.25` as a sign-off PR.

Nobody authored this release. An operator ran `devaudit update`, the CLI synced the templates and pushed, and the system did the rest. The release sits on the portal waiting for human sign-off — but there's nothing for the human to review that they didn't already review when they ran `devaudit update`.

## The options

We considered five approaches, from simplest to most sophisticated.

### Option 1: `[skip ci]` on automated sync commits

GitHub Actions natively respects `[skip ci]` in commit messages. If `devaudit update` appends `[skip ci]` to its auto-commit, the workflows don't fire. No CI, no release registration, no portal record.

The trade-off: no gates run on the sync. A broken template wouldn't be caught until the next real push triggers CI. But the next push *does* run the full gate suite against the complete state of `develop` — including the synced files. The gates test the code, not the commit message.

### Option 2: Batch housekeeping into a periodic release

Instead of each sync creating a release, accumulate changes and ship them weekly. DevAudit's bare-date versioning already collapses same-day pushes. A weekly batch would reduce portal noise to ~1 release per week.

This reduces the problem but doesn't solve it. You still get housekeeping releases for tooling syncs, just fewer. And it requires either operator discipline or a batching mechanism that doesn't exist yet.

### Option 3: Release on explicit trigger only (semantic-release pattern)

Only create release records for `feat`/`fix`/`refactor` commit types. Skip `chore`/`docs`/`ci`/`build` entirely in the `register-release` job.

This is how semantic-release and release-please work. It's clean, but it loses the audit trail for dependency bumps and config changes. ISO 27001 A.8.32 (change management) wants changes authorised, tested, and documented. Absorbing a dependency bump silently into the next REQ release is a weaker audit position — the change is traceable in git history, but it's not on the portal.

### Option 4: Two-tier selective skip

Low-risk syncs (`devaudit update`, docs, formatting) → `[skip ci]`. Dependency bumps and config changes → CI runs, but `register-release` skips `--create-release-if-missing` for `chore`/`build` commit types.

This preserves gate coverage for anything that could break the build while eliminating portal noise. But it still loses the audit trail for dependency bumps — they run through CI but don't get a release record. And it adds complexity: two different skip mechanisms in the same workflow.

### Option 5: `[skip ci]` for tooling syncs + bundled changes on the next REQ release

This is the approach we selected. Two parts:

1. **`devaudit update` syncs** include `[skip ci]` in the commit message. No CI fires. No release is created. The synced files sit on `develop` and are tested when the next REQ-tagged commit triggers the full gate suite.

2. **The next REQ release explicitly documents what it absorbed.** A new `generate-bundled-changes.sh` script scans commits since the last release tag, identifies housekeeping commits (`chore`/`docs`/`ci`/`build`/`test`/`revert`), and generates a markdown summary. This summary is uploaded as `bundled_changes` evidence against the REQ release.

The portal shows:

```
Release: REQ-042 — Add booking widget
├── Gate evidence: SAST ✓  Dep-audit ✓  E2E ✓  Build ✓
├── Release ticket: operator-authored (references bundled changes)
├── Bundled changes (auto-generated):
│   ├── chore: sync DevAudit templates v0.1.69 → v0.1.70
│   ├── chore: bump eslint 9.0.5 → 9.0.6
│   └── docs: update API reference for /bookings endpoint
└── Security summary: covers full develop state at CI time
```

## Why this is the right approach for our SDLC

### The housekeeping path was for humans, not machines

The housekeeping release playbook says: "A housekeeping release for ticketless work — docs, dependency bumps, CI tweaks, formatting, reverts. No requirement, no Stage 1, no per-REQ evidence authoring." This was written for an operator who decides to bump a dependency and push it. The operator reviews the auto-generated stub, fills in the sign-off block, and merges.

A `devaudit update` sync is not an operator decision. It's a machine refreshing templates. Creating a housekeeping release for it asks a human to sign off on a change they didn't author — the review is theatre. The `[skip ci]` approach removes this theatre while preserving the housekeeping path for genuine operator-authored changes.

### The audit trail gets stronger, not weaker

The obvious concern: if we skip CI for sync commits, are we creating an audit blind spot? No — we're making the trail more explicit.

Today, each sync creates a separate housekeeping release that may or may not be properly signed off. An auditor reviewing the portal sees a scatter of `vYYYY.MM.DD` releases with varying levels of review. The connection between "sync templates" and "the feature that shipped after" is implicit.

With bundled changes, the connection is explicit. When an auditor asks "what changed between REQ-042 and REQ-043?", the answer is on the portal — REQ-043's release record includes an auto-generated list of every housekeeping commit it absorbed. The auditor doesn't need to cross-reference git log with the portal. The information is consolidated in one place, attributed to one release, covered by one set of gate evidence.

### Gate evidence already covers the full state

When REQ-042 triggers CI, the gates (SAST, dep-audit, E2E, build) test the **full state of `develop`** — not just the REQ-042 commit. The synced templates, the dependency bumps, the docs changes are all present in the working tree. If a template sync broke something, the gates catch it. If a dependency bump introduced a vulnerability, the SAST and dep-audit gates catch it.

The gate evidence is attributed to REQ-042 and covers everything. There is no testing gap — the gates test the code state, not the commit that triggered them.

### It aligns with how high-performing teams already work

Teams using semantic-release handle `chore`/`docs` commits the same way: they don't create releases, but they're tested when the next `feat`/`fix` lands. The bundled changes summary adds the audit trail that semantic-release doesn't provide — making this approach **stronger** than the industry baseline for compliance-aware teams.

## What about the gap between REQs?

If no feature work lands for a week, housekeeping changes sit untested on `develop`. This is the same risk as Option 1, and it's real. Two mitigations:

1. **Manual trigger:** An operator can run the CI workflow via `workflow_dispatch` at any time to test the current state of `develop` — no commit required.
2. **Scheduled E2E regression:** The `E2E Regression` workflow already runs on a schedule against `main`. If `develop` has accumulated untested changes, the next regression run (or a manually triggered one) will catch issues before they reach a release PR.

For teams shipping features regularly (the common case), the gap is hours, not days. For teams with long feature cycles, the manual trigger is the escape hatch.

## What changes

The implementation is minimal:

1. **`devaudit update`** appends `[skip ci]` to its auto-commit message. One line change in the CLI.

2. **New script: `generate-bundled-changes.sh`** — scans commits since the last release tag, filters for housekeeping commit types, outputs a markdown summary. Lives in `sdlc/files/_common/scripts/` alongside the existing `generate-housekeeping-release-ticket.sh` and `generate-security-summary.sh`.

3. **New CI step in `ci.yml`** — after version derivation in the `register-release` job, if the version is a REQ (not bare-date), run the bundled changes script and upload the output as evidence.

4. **Housekeeping release playbook updated** — documents that `devaudit update` syncs no longer create housekeeping releases, and that housekeeping changes are bundled into the next REQ release.

Human-authored `chore`/`docs` commits (without `[skip ci]`) still create housekeeping releases exactly as before. The housekeeping path is preserved for its intended use case — operator-authored ticketless work.

## The broader lesson

This problem is a microcosm of a larger tension in compliance automation: the system was designed to capture *every* change as a release, but not every change is a release. A template sync is infrastructure maintenance. A dependency bump is hygiene. A docs update is housekeeping in the literal sense. These are not releases — they're the environment in which releases happen.

The bundled changes approach resolves this tension cleanly. Releases are operator-authored units of intent. Everything else is context — tested by the gates, documented in the bundled changes summary, and absorbed into the next release where it belongs.

The portal stays clean. The audit trail stays complete. The gates still run. Compliance as a byproduct, not a project.

---

*Read the housekeeping release playbook → [docs/release-playbooks/housekeeping-release.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/release-playbooks/housekeeping-release.md)*

*See the full SDLC → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)*

*Track the implementation issue → [docs/issues/housekeeping-release-noise-from-automated-syncs.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/issues/housekeeping-release-noise-from-automated-syncs.md)*
