# Consuming Projects

DevAudit serves as the central compliance hub for all Metasession projects. Each consuming project integrates via CI workflows, evidence uploads, and the SDLC framework's stage docs.

## Active consumers

| Project       | Slug                | Stack  | Host    | Status                        | Last synced               |
| ------------- | ------------------- | ------ | ------- | ----------------------------- | ------------------------- |
| wawagardenbar | `wawagardenbar-app` | node   | railway | Integrated                    | 2026-05-14 (sdlc-v1.23.0) |
| META-AGENT    | `meta-agent`        | python | railway | Integrated                    | 2026-05-15 (sdlc-v1.23.x) |
| META-ATS      | --                  | node   | railway | Onboarding paused (resumable) | --                        |

DevAudit itself does **not** consume the SDLC framework — it would otherwise gate its own releases through itself. See `CLAUDE.md` in DevAudit's repo root for its lightweight development process.

## Integrating a new project

**One-shot via `scripts/sdlc-onboard.sh`.** Two operator actions:

1. Issue a Personal Access Token at `https://devaudit.metasession.co/settings/tokens`.
2. Run the onboarding script:

   ```bash
   export META_COMPLY_USER_TOKEN="mctok_..."
   ./scripts/sdlc-onboard.sh ../path/to/new-consumer
   ```

The script handles every previously-manual step: DevAudit project creation, API key issuance, GitHub repo secrets/variables (`META_COMPLY_API_KEY`, `META_COMPLY_USER_TOKEN`, the production-URL secret, `META_COMPLY_BASE_URL`), hook framework install (`pre-commit` for Python / `husky` for Node), branch protection on `main`, and the first template sync. ~30 seconds end-to-end.

**Full walkthrough**: see [docs/onboarding.md](onboarding.md).

For projects using new languages/hosts not yet supported by an adapter, see [docs/adding-a-stack.md](adding-a-stack.md) or [docs/adding-a-host.md](adding-a-host.md) — author the adapter first, then onboard the consumer against it.

## AI Agent Configuration (Single Source of Truth)

All Metasession projects adopting DevAudit use the **single source of truth** model for AI coding agent configuration. This ensures every AI tool (Claude Code, Cursor, Windsurf, Gemini) enforces the same SDLC rules from the same canonical file.

### The Model

```
your-project/
├── INSTRUCTIONS.md          ← Single source of truth
│                              Part 1: Project-specific standards (you maintain)
│                              Part 2: SDLC rules (sync script maintains)
├── .cursorrules             ← Pointer → INSTRUCTIONS.md (sync script generates)
├── .windsurfrules           ← Pointer → INSTRUCTIONS.md (sync script generates)
├── CLAUDE.md                ← Project header + pointer → INSTRUCTIONS.md (sync script generates)
└── GEMINI.md                ← Pointer → INSTRUCTIONS.md (sync script generates)
```

### How the Sync Script Manages It

The sync script (`scripts/sync-sdlc.sh`, invoked once by the onboarding script and re-runnable for ongoing updates) handles the AI config files as follows:

1. **Generates pointer files** for `.cursorrules`, `.windsurfrules`, and `GEMINI.md` — these are identical one-line redirects to `INSTRUCTIONS.md`, overwritten on every sync.
2. **Updates `CLAUDE.md`** — preserves the project-specific header (repo overview, build commands, key directories) and replaces or appends a pointer section directing to `INSTRUCTIONS.md`. If no `CLAUDE.md` exists, creates one with the pointer.
3. **Manages the SDLC section in `INSTRUCTIONS.md`** — appends or replaces the `## SDLC Compliance Process (MANDATORY)` section using the content from `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`. If no `INSTRUCTIONS.md` exists, creates one with a header and the SDLC rules.

The SDLC rules source lives in `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`. This is the single place to edit SDLC enforcement rules — changes propagate to all consuming projects on the next sync.

### What Consuming Projects Own vs What the Sync Script Owns

| File                                  | Who maintains     | What happens on sync                                                    |
| ------------------------------------- | ----------------- | ----------------------------------------------------------------------- |
| `INSTRUCTIONS.md` (project standards) | Project developer | Untouched — everything before `## SDLC Compliance Process` is preserved |
| `INSTRUCTIONS.md` (SDLC section)      | Sync script       | Replaced from `INSTRUCTIONS-SDLC.md`                                    |
| `.cursorrules`                        | Sync script       | Overwritten with pointer                                                |
| `.windsurfrules`                      | Sync script       | Overwritten with pointer                                                |
| `GEMINI.md`                           | Sync script       | Overwritten with pointer                                                |
| `CLAUDE.md` (project header)          | Project developer | Preserved                                                               |
| `CLAUDE.md` (pointer section)         | Sync script       | Appended or replaced                                                    |

### After first sync

The onboarding script handles the first sync. To complete project-specific tailoring:

1. **Add project-specific standards** to `INSTRUCTIONS.md` above the SDLC section — tech stack details, architecture, code style, naming conventions, testing strategy beyond the framework defaults.
2. **Expand `CLAUDE.md`** — repo overview, build commands, key directories (the sync script creates a minimal header).
3. **Commit all generated files** as part of the onboarding PR.

On subsequent syncs, only the SDLC section and pointer files are updated. Project-specific content above the SDLC section is preserved.

## Ongoing sync strategy

The framework uses a **copy-and-customize** model. `_common/` docs define universal policy/strategy; stack and host adapters provide language- and platform-specific bits; `ci/` workflow templates wire it all together. Consumers periodically re-sync when the framework evolves.

### Re-syncing existing consumers

After framework changes land in DevAudit's `main`:

```bash
# Tags DevAudit, copies all templates, updates tag references in CI workflows
./scripts/sync-sdlc.sh v1.X.Y "../wawagardenbar app" ../META-AGENT

# Then in each consuming project:
cd "../wawagardenbar app"
git diff                    # Review changes
git checkout -b chore/sync-sdlc-vX.Y.Z
git add -A && git commit -m "chore: sync SDLC templates sdlc-v1.X.Y from DevAudit"
git push -u origin chore/sync-sdlc-vX.Y.Z
gh pr create --base main
```

The script syncs: `_common/` stage docs, AI agent pointer files, SDLC rules into `INSTRUCTIONS.md`, stack-specific hooks and scripts (`stacks/<name>/`), host-specific config (`hosts/<name>/`), and CI workflow templates (`ci/`).

### Versioning

The SDLC framework is versioned via git tags on DevAudit (e.g., `sdlc-v1.23.0`). The sync script creates and pushes tags automatically. Consuming projects pin to a tag for `upload-evidence.sh` downloads at runtime.

**Current version:** `sdlc-v1.23.x` (post-v1.24 onboarding-automation work merged into v1.23.x line; v1.24 cuts when the deprecation-warning tightening lands).

**Source tracking:** Every consumer's `sdlc-config.json` records the stack + host adapters it consumes. The sync script logs which templates were sourced (e.g. `CI workflow: generated ci.yml (from ci/python/)`).

### What must stay in sync

#### Critical (breaking if out of sync)

| Component                    | Source of Truth                                                                                      | How Consumers Use It                                                                              | Sync Method                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **`upload-evidence.sh`**     | `scripts/upload-evidence.sh` in DevAudit                                                             | Synced into consumer's `scripts/` by sync-sdlc.sh                                                 | Re-sync on every framework version                                                   |
| **CI job + status names**    | `Quality Gates`, `Compliance Validation`, `DevAudit Release Approval` (renamed in v1.22.0)           | GitHub branch protection references exact names                                                   | Must match — renaming requires updating consumer branch protection rules             |
| **Project slug**             | `sdlc-config.json` `project_slug`                                                                    | Used to create releases, upload evidence, check approval                                          | Must match `compliance_projects.slug` in DevAudit                                    |
| **GitHub vars/secrets**      | `META_COMPLY_BASE_URL` (variable), `META_COMPLY_API_KEY` (secret), `META_COMPLY_USER_TOKEN` (secret) | Consuming projects' CI workflows authenticate against DevAudit                                    | Set by `sdlc-onboard.sh`; refresh manually when API keys rotate                      |
| **Compliance doc filenames** | `RTM.md`, `test-plan.md`, `test-cases.md`, `test-summary-report.md`                                  | CI upload step looks for these exact filenames                                                    | Renaming requires updating all consumer CI workflows                                 |
| **Release status values**    | `draft`, `uat_review`, `uat_approved`, `uat_rejected`, `prod_review`, `prod_approved`, `released`    | `check-release-approval.yml` checks for specific statuses                                         | Changing status names requires updating all consumer release-approval gate workflows |
| **Risk tier column**         | `compliance_projects.risk_tier` (`low`, `medium`, `high`)                                            | Controls self-approval rules: LOW allows self-approval, MEDIUM/HIGH requires independent reviewer | Default `medium`; set per project in DevAudit portal                                 |

#### Important (consistency, not immediately breaking)

| Component                  | Source of Truth                                                     | Sync Frequency                   | Notes                                                                                                |
| -------------------------- | ------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **`_common/` stage docs**  | `sdlc/files/_common/*.md`                                           | Per release or on process change | Universal; same content across every consumer                                                        |
| **Stack adapter manifest** | `sdlc/files/stacks/<name>/adapter.json`                             | On adapter change                | Per-consumer effect via `stack` key in sdlc-config.json                                              |
| **Host adapter manifest**  | `sdlc/files/hosts/<name>/adapter.json`                              | On adapter change                | Per-consumer effect via `host` key in sdlc-config.json                                               |
| **CI workflow templates**  | `sdlc/files/ci/*.template`, `sdlc/files/ci/<stack>/ci.yml.template` | Per release                      | Stack-agnostic templates apply to every consumer; stack-specific override applies only to that stack |
| **AI rules**               | `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`                                | On change                        | Single source of truth; propagates via INSTRUCTIONS.md SDLC section                                  |
| **Risk classification**    | `Test_Policy.md` + `Test_Strategy.md`                               | On policy change                 | Affects test scope across all projects                                                               |

### Do NOT Change Without Coordination

These are hard dependencies across all consumers:

1. **`upload-evidence.sh` flag signature** — adding/removing flags breaks consumer CI.
2. **Job + status check names** — branch protection rules reference exact strings (`Quality Gates`, `Compliance Validation`, `DevAudit Release Approval`).
3. **Project slug format** — referenced from `sdlc-config.json`, the DevAudit DB, and the consumer's CI workflow tokens.
4. **Compliance directory structure** — `compliance/evidence/REQ-XXX/`, `compliance/pending-releases/`, `compliance/approved-releases/`.
5. **Release status lifecycle** — `check-release-approval.yml` depends on exact status values.
6. **Stack + host adapter schemas** — `sdlc/files/stacks/_schema/adapter.schema.json`, `sdlc/files/hosts/_schema/adapter.schema.json`. Adding required fields breaks every existing adapter.

### Sync Checklist

After making changes to the SDLC framework in DevAudit:

- [ ] Validate adapters: `node scripts/validate-adapter.cjs --all`
- [ ] Run the sync script for each consumer: `./scripts/sync-sdlc.sh vX.Y.Z ../project-1 ../project-2`
- [ ] For each consuming project:
  - [ ] Review the diff (`git diff`) — check for overwritten project-specific customizations.
  - [ ] Re-apply any project-specific customizations if overwritten.
  - [ ] Commit and push on a sync branch; open a chore PR.
  - [ ] Verify the chore PR's `Compliance Validation` + `Quality Gates` checks pass before merging.
- [ ] Update the "Active consumers" table above with the new sync date and version.

## See also

- [docs/onboarding.md](onboarding.md) — full onboarding walkthrough.
- [docs/adding-a-stack.md](adding-a-stack.md) — for new languages.
- [docs/adding-a-host.md](adding-a-host.md) — for new hosting platforms.
- [docs/ADR/ADR-001-polyglot-sdlc-architecture.md](ADR/ADR-001-polyglot-sdlc-architecture.md) — architectural rationale for the layered design.
- [sdlc/STACK_ADAPTER.md](../sdlc/STACK_ADAPTER.md) / [sdlc/HOST_ADAPTER.md](../sdlc/HOST_ADAPTER.md) — adapter contracts.
