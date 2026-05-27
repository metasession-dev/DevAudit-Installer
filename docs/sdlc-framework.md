# SDLC Template Framework

The `sdlc/` directory contains the compliance-grade SDLC template system used by all Metasession projects. It implements a workflow-driven development pipeline satisfying ISO 29119, ISO 27001, GDPR, SOC 2, and EU AI Act requirements.

## Template Structure

Layout from sdlc-v1.23.0 onwards — process / stack / host adapter layering. See [ADR-001](ADR/ADR-001-polyglot-sdlc-architecture.md) for the rationale and [STACK_ADAPTER.md](../sdlc/STACK_ADAPTER.md) / [HOST_ADAPTER.md](../sdlc/HOST_ADAPTER.md) for the adapter contracts.

```
sdlc/
├── files/
│   ├── _common/                              # Universal — same content in every consumer
│   │   ├── 0-project-setup.md                # Tier 2 stage docs (consumer follows these)
│   │   ├── 1-plan-requirement.md
│   │   ├── 2-implement-and-test.md
│   │   ├── 3-compile-evidence.md
│   │   ├── 4-submit-for-review.md
│   │   ├── 5-deploy-main.md
│   │   ├── Test_Policy.md                    # Tier 1 — never project-specific
│   │   ├── Test_Strategy.md                  # Tier 1
│   │   ├── Test_Architecture.md              # Tier 1
│   │   ├── Periodic_Security_Review_Schedule.md  # Tier 1
│   │   ├── Test_Plan_TEMPLATE.md             # Project starter
│   │   ├── README_TEMPLATE.md                # Project starter
│   │   ├── github/                           # Stack-agnostic GitHub issue templates
│   │   └── scripts/                          # Universal compliance helpers
│   │       ├── validate-compliance-artifacts.sh
│   │       ├── validate-commits.sh
│   │       ├── submit-for-uat-review.sh
│   │       ├── derive-release-version.sh
│   │       └── close-out-release.sh          # Reconcile ticket on release (#60)
│   ├── ci/                                   # CI workflow templates
│   │   ├── ci.yml.template                   # Default (Node) — quality-gates workflow
│   │   ├── python/                           # Stack-specific override
│   │   │   └── ci.yml.template               # Python-flavoured quality-gates
│   │   ├── compliance-validation.yml.template # Stack-agnostic
│   │   ├── check-release-approval.yml.template
│   │   ├── compliance-evidence.yml.template
│   │   ├── post-deploy-prod.yml.template
│   │   ├── close-out-release.yml.template    # Auto-close ticket on release (#60)
│   │   └── ci-status-fallback.yml.template
│   ├── stacks/                               # Per-language adapter directories
│   │   ├── _schema/adapter.schema.json       # JSON Schema for stack adapter manifests
│   │   ├── node/                             # husky + commitlint + eslint + Playwright
│   │   │   ├── adapter.json
│   │   │   ├── hooks/                        # husky hooks placed under .husky/
│   │   │   └── scripts/                      # Node-stack-specific helpers
│   │   └── python/                           # pre-commit + ruff + mypy + pytest
│   │       ├── adapter.json
│   │       └── hooks/.pre-commit-config.yaml
│   ├── hosts/                                # Per-platform adapter directories
│   │   ├── _schema/adapter.schema.json       # JSON Schema for host adapter manifests
│   │   └── railway/
│   │       └── adapter.json
│   └── sdlc-config.example.json              # Example consumer configuration
├── ai-rules/                                 # Drop-in SDLC enforcement for AI tools
│   ├── README.md                             # Setup and configuration guide
│   ├── INSTRUCTIONS-SDLC.md                  # Canonical SDLC rules (synced to INSTRUCTIONS.md)
│   ├── SDLC_RULES.md                         # Full rules with detailed explanations
│   ├── claude/CLAUDE.md                      # Legacy Claude format (superseded by pointer pattern)
│   ├── windsurf/.windsurfrules               # Legacy Windsurf format
│   └── cursor/.cursorrules                   # Legacy Cursor format
├── STACK_ADAPTER.md                          # Stack-adapter contract
├── HOST_ADAPTER.md                           # Host-adapter contract
├── article.md                                # Long-form design explanation
└── CLAUDE.md                                 # Claude Code guidance for editing templates
```

## Development Model: Developer + AI Partner

Metasession projects follow a **single owner-developer partnered with AI coding agents** model:

- Each project has an **owner-developer** who provides direction, judgment, and approval
- An **AI agent** (Claude Code, Windsurf, or Cursor) acts as implementation partner, compliance enforcer, and reviewer
- **Branching is trunk-based** with a permanent `develop` branch -- no feature branches, no parallel developer streams
- **The `sdlc-implementer` skill is the default entry point** for any issue — it **triages at pickup** (Phase 0: classify → announce → confirm → route), then drives the chosen path to completion. A tracked change runs Stages 1–5 (delegating e2e work to `e2e-test-engineer`, pausing at the portal's UAT gate for a human); a trivial / housekeeping / doc-only change is driven down a lightweight path (branch → gates → PR → merge) with no tracked ceremony. See [change-workflows.md](./change-workflows.md) for which workflow applies to which change type (and the pickup-time triage decision), and [`implementing-an-sdlc-issue.md`](../sdlc/files/_common/implementing-an-sdlc-issue.md) for the stage-by-stage walkthrough.
- **SDLC compliance is AI-enforced** via drop-in rules in `sdlc/ai-rules/` -- the AI asks which GitHub Issue a change is for, blocks implementation until planning is complete, runs compliance gates, and guides evidence to the right destination. Implementation commits (`feat`/`fix`/`refactor`/`perf`) must cite a `[REQ-XXX]` — enforced by commitlint and `validate-commits.sh`, not merely advised
- **PR reviews** are owner-reviewed with AI-assisted verification; CI provides independent, tamper-resistant evidence
- **Risk-tiered approval** -- LOW risk changes can be self-merged after CI passes; MEDIUM and HIGH risk changes require a second independent human reviewer before merge

## Template Tiers

- **Tier 1 (universal):** `Test_Policy.md`, `Test_Strategy.md`, `Test_Architecture.md`, `Periodic_Security_Review_Schedule.md` -- never project-specific
- **Tier 2 (project-specific):** Workflows `0-project-setup.md` through `5-deploy-main.md`, `Test_Plan_TEMPLATE.md`, `README_TEMPLATE.md` -- copied and customised per project

## Workflow Pipeline

```
0. Project Setup    -- repo, branches, CI, compliance directories (run once)
1. Plan Requirement -- identify GitHub Issue, assign REQ-XXX, classify risk, create implementation plan (MEDIUM/HIGH), generate test scope derived from plan
2. Implement & Test -- code on develop, all local gates green every commit
3. Compile Evidence -- gather artifacts, create release ticket, verify on UAT, upload to META-COMPLY
4. Submit for Review -- PR triggers independent CI verification + risk-tiered human approval
5. Deploy to Prod   -- merge, verify production deployment, finalize compliance artifacts
```

## SDLC Schematic

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              METASESSION SDLC PROCESS                                   │
│                                                                                         │
│   Developer + AI Partner Model                                                          │
│   Trunk-based: develop (work) → main (production)                                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌─ STAGE 1: PLAN ─────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│  GitHub Issue ──→ REQ-XXX (RTM) ──→ Risk Classification ──→ test-scope.md               │
│       │                                  │                       │                      │
│       │                          LOW / MEDIUM / HIGH       ⏸ WAIT: Developer            │
│       │                                  │                   confirms scope              │
│       │                          AI involvement                                         │
│       │                          raises risk +1                                         │
│       │                                                                                 │
│  If MEDIUM/HIGH: ──→ implementation-plan.md ──→ ⏸ WAIT: Developer approves plan         │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─ STAGE 2: IMPLEMENT ────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐    │
│  │ ENFORCEMENT LAYER 1: Local Git Hooks                                             │    │
│  │                                                                                  │    │
│  │  pre-commit ──→ lint-staged (ESLint + Prettier)                                  │    │
│  │  commit-msg ──→ commitlint (Conventional Commits; [REQ-XXX]/Ref REQUIRED         │
│                 on feat/fix/refactor/perf — housekeeping exempt)                 │    │
│  │  pre-push  ──→ tsc --noEmit (TypeScript check)                                   │    │
│  └──────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                         │
│  Code ──→ @requirement JSDoc ──→ Tests ──→ Commit ──→ Local Gates ──→ Push              │
│                                                           │                             │
│                                                    ┌──────┴──────┐                      │
│                                                    │ TypeScript  │                      │
│                                                    │ SAST        │                      │
│                                                    │ Dep Audit   │                      │
│                                                    │ E2E Tests   │                      │
│                                                    └─────────────┘                      │
│                                                                                         │
│  Push to develop ──→ ⏸ WAIT: Confirm CI green                                          │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─ CI PIPELINE (GitHub Actions) ──────────────────────────────────────────────────────────┐
│                                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐    │
│  │ ENFORCEMENT LAYER 3: CI Hard Gates (independent, tamper-resistant)                │    │
│  │                                                                                  │    │
│  │  TypeScript ──→ SAST ──→ Dependency Audit ──→ E2E Tests ──→ Build                │    │
│  │       │           │            │                  │            │                  │    │
│  │  Compliance Validation: artifact checks + commit convention checks               │    │
│  └──────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                         │
│  Register Release (parallel with gates) ──→ META-COMPLY                                 │
│       │                  │                                                              │
│       │            Auto-create release (v2026.03.28)                                    │
│       │            Sync known_requirements from RTM.md                                  │
│       │                                                                                 │
│  Evidence Upload (after gates pass) ──→ META-COMPLY                                     │
│       │                  │                                                              │
│       │            Link evidence to release (environment=uat)                           │
│       │            Upsert requirement matrix rows as 'covered'                          │
│       │                                                                                 │
│  Artifacts: sast-results.json, dependency-audit.json, e2e-results.json,                 │
│             playwright-report.zip, coverage-summary.json                                │
│             Tagged with: git SHA, CI run ID, branch                                     │
│                                                                                         │
│  Compliance-only pushes: compliance-evidence.yml uploads docs without gates             │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─ STAGE 3: COMPILE EVIDENCE ─────────────────────────────────────────────────────────────┐
│                                                                                         │
│  Verify gates ──→ Upload evidence ──→ security-summary.md ──→ Update RTM                │
│                                                                  │                      │
│  Create release ticket ──→ compliance/pending-releases/          │                      │
│                                                           TESTED - PENDING              │
│  Commit locally (do NOT push yet — batch with UAT)          SIGN-OFF                    │
│                                                                                         │
│  ⏸ WAIT: Confirm CI + deployment complete                                              │
│       │                                                                                 │
│  UAT Verification ──→ Health check ──→ Smoke test ──→ Feature test                      │
│       │                                                                                 │
│  Record results ──→ Commit locally ──→ Push all (single push)                           │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─ META-COMPLY PORTAL ────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│  Release Dashboard (v2026.03.28)                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────────┐         │
│  │ Completeness Checklist    │ Compliance Gates      │ Approval Panel         │         │
│  │ ✓ All gates present (5/5) │ ✓ TypeScript (2 arts) │                        │         │
│  │ ✓ Evidence uploaded       │ ✓ SAST (1 art)        │ [Approve] [Reject]     │         │
│  │ ✓ CI traceability         │ ✓ Dependencies (1)    │                        │         │
│  │ ✓ test-scope.md           │ ✓ E2E Tests (1)       │ Approval triggers      │         │
│  │ ✓ impl-plan.md            │ ✓ Test Reports (1)    │ GitHub workflow        │         │
│  │ ✓ security-summary.md    │                        │ dispatch on consuming  │         │
│  │ ✓ release ticket          │ SHA: abc1234           │ project                │         │
│  │                            │ Branch: develop        │                        │         │
│  └─────────────────────────────────────────────────────────────────────────────┘         │
│                                                                                         │
│  Evidence Viewer: Markdown → HTML, JSON → highlighted (large files truncated             │
│                   with download link), PDF → inline, HTML → sandboxed iframe             │
│                                                                                         │
│  Production dashboard inherits UAT evidence automatically                               │
│  (production-specific evidence overrides by file name)                                  │
│                                                                                         │
│  Reviewer approves ──→ status: uat_approved ──→ auto-triggers CI check                  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─ STAGE 4: SUBMIT FOR REVIEW ────────────────────────────────────────────────────────────┐
│                                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐    │
│  │ ENFORCEMENT LAYER 2: AI WAIT Checkpoints                                         │    │
│  │                                                                                  │    │
│  │  Pre-flight checklist — ALL must pass before PR creation:                        │    │
│  │  ✓ All development complete    ✓ UAT verified                                    │    │
│  │  ✓ CI green on develop         ✓ META-COMPLY approval granted                    │    │
│  │  ✓ Working tree clean          ✓ Evidence uploaded + linked                      │    │
│  └──────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                         │
│  Do NOT create PR until ready to merge (prevents duplicate CI runs)                     │
│                                                                                         │
│  Create PR (develop → main) ──→ CI checks pass (commit SHA status)                      │
│       │                              │                                                  │
│       │                       check-uat-approval.yml ──→ ✓ uat_approved                 │
│       │                                                                                 │
│       ├── LOW risk ──→ Self-merge permitted                                             │
│       └── MEDIUM/HIGH risk ──→ Second human reviewer required                           │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─ STAGE 5: DEPLOY TO PRODUCTION ─────────────────────────────────────────────────────────┐
│                                                                                         │
│  Merge PR (merge commit) ──→ Auto-deploy main → Production                              │
│       │                                                                                 │
│  post-deploy-prod.yml:                                                                  │
│       │                                                                                 │
│       ├── Production smoke tests (health, key endpoints)                                │
│       ├── Upload production evidence (environment=production)                           │
│       └── Mark release as "released" in META-COMPLY                                     │
│                                                                                         │
│  Finalize: move release ticket to approved-releases/                                    │
│            RTM status → APPROVED - DEPLOYED                                             │
│            Close GitHub Issue                                                           │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌─ THREE ENFORCEMENT LAYERS ──────────────────────────────────────────────────────────────┐
│                                                                                         │
│  Layer 1: LOCAL HOOKS          Layer 2: AI WAIT           Layer 3: CI HARD GATES        │
│  ─────────────────────         ──────────────────         ────────────────────────       │
│  Runs automatically            Enforces sequencing        Independent verification      │
│  at commit/push time           throughout workflow         on every push to develop      │
│                                                                                         │
│  • commitlint                  • Test scope review         • TypeScript                  │
│  • lint-staged                 • Impl plan review          • SAST (Semgrep)              │
│  • tsc --noEmit                • Post-push CI check        • Dependency audit            │
│                                • Pre-UAT deployment        • E2E tests                   │
│  Bypassable: --no-verify       • Pre-flight checklist      • Compliance validation       │
│  (SDLC rule: NEVER do this)                                                             │
│                                                            Non-bypassable (branch        │
│                                                            protection required checks)   │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Enforcing the SDLC via AI Assistants

Drop-in instruction files in `sdlc/ai-rules/` make AI coding assistants (Claude Code, Windsurf, Cursor) enforce the SDLC process on every code change. When added to a project, the AI will:

- Ask **"which GitHub Issue is this for?"** before writing any code
- Block implementation until requirement planning is complete (RTM entry, test scope, evidence directory)
- Enforce commit conventions (`Ref: REQ-XXX`, `Co-Authored-By` tags)
- Run all four compliance gates before allowing a push
- Guide evidence compilation after implementation

All agent config files use a **single source of truth** pattern: `.cursorrules`, `.windsurfrules`, `CLAUDE.md`, and `GEMINI.md` are pointer files that reference `INSTRUCTIONS.md`. The SDLC rules are maintained in `INSTRUCTIONS.md` as the canonical source, synced by the sync script from `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`.

Setup is automatic via the sync script:

```bash
devaudit update v1.5.0 ../your-project
```

This generates pointer files and appends/replaces the SDLC section in `INSTRUCTIONS.md`. See `sdlc/ai-rules/README.md` for full details.

## Example Prompts

Once the AI rules are installed, every change begins with a GitHub Issue:

**Starting from an existing issue:**

```
Work on issue #42
```

**Describing new work (AI will create the issue for you):**

```
Add a CSV export button to the evidence browsing page
```

**Referencing an issue with extra context:**

```
Pick up #15 — the client wants the share link expiry default changed to 30 days
```

**Asking what's available to work on:**

```
What open issues do we have?
```

In each case the AI will fetch (or create) the GitHub Issue, assign the next `REQ-XXX`, classify risk using issue labels, add the RTM entry with the issue reference, and scaffold the evidence directory -- all before any code is written.
