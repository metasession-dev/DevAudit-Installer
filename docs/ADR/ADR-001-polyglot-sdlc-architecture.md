# ADR-001: Polyglot SDLC framework via stack + host adapters

| Field    | Value                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Status   | Accepted                                                                                                 |
| Date     | 2026-05-15                                                                                               |
| Decision | Split SDLC templates into `_common/` + `ci/<stack>/` + `stacks/<name>/` + `hosts/<name>/` adapter layers |
| Tracked  | [#287](https://github.com/metasession-dev/devaudit/issues/287) (v1.23.0)                                 |
| Author   | DevAudit Engineering                                                                                     |

## Context

DevAudit ships an SDLC framework — a set of stage docs, CI templates, hooks, and validation scripts — that consuming projects sync into their repos via `scripts/sync-sdlc.sh`. Up to v1.22.x, every consumer was Node + Railway:

- `wawagardenbar-app` (Next.js food-ordering app, Railway-hosted)
- DevAudit itself (Next.js portal, Railway-hosted)
- META-ATS (paused, but Next.js + Railway when it resumes)

Each template hardcoded Node-isms (`npm ci`, `npx tsc --noEmit`, `npx playwright test`) and Railway-isms (`push to main → auto-deploy`, smoke-test by curling the production URL). The framework worked, but it implicitly assumed every consumer was Node-on-Railway.

[META-AGENT](https://github.com/metasession-dev/META-AGENT) (FastAPI / pytest / mypy / ruff on Railway) was the first non-Node consumer. Adopting v1.22.x for META-AGENT meant either:

1. **Fork the templates.** Copy `sdlc/files/ci/ci.yml.template`, Python-ify the gate commands, maintain in parallel. Tractable for one Python project. Breaks down at project #3 if it's Go, and is intractable by project #5 if it's Ruby-on-Fly.

2. **Make the templates polyglot.** One framework, many backends.

Future expansion is real: Metasession's roadmap includes Go services and Rust agents. Sticking with option 1 quietly accumulated technical debt that would compound. Option 2 was load-bearing for the next 12 months of onboardings.

## Decision

Restructure `sdlc/files/` into three independently-varying layers:

```
sdlc/files/
├── _common/                     # universal — stage docs, RTM, validators, issue templates
├── ci/                          # CI workflow shells
│   ├── ci.yml.template          # default (Node, for backwards compat)
│   ├── python/                  # stack-specific override
│   │   └── ci.yml.template      # Python-flavoured quality-gates job
│   ├── compliance-validation.yml.template     # stack-agnostic
│   ├── check-release-approval.yml.template    # stack-agnostic
│   ├── compliance-evidence.yml.template       # stack-agnostic
│   ├── post-deploy-prod.yml.template          # stack-agnostic
│   └── ci-status-fallback.yml.template        # stack-agnostic
├── stacks/                      # per-language adapter
│   ├── _schema/adapter.schema.json
│   ├── node/                    # husky + commitlint + eslint + Playwright
│   │   ├── adapter.json
│   │   ├── hooks/
│   │   └── scripts/
│   └── python/                  # pre-commit + ruff + mypy + pytest
│       ├── adapter.json
│       └── hooks/.pre-commit-config.yaml
└── hosts/                       # per-platform adapter
    ├── _schema/adapter.schema.json
    └── railway/
        └── adapter.json
```

### Three-layer separation

| Layer   | What it is                                                                           | Varies by              |
| ------- | ------------------------------------------------------------------------------------ | ---------------------- |
| Process | Stage 0–5 docs, RTM, release ticket, four-eyes approval, branching strategy          | Nothing                |
| Stack   | Type-check / SAST / dep-audit / test / build commands, hook framework, runtime setup | Language / package mgr |
| Host    | Production URL resolution, deploy trigger, post-deploy wait/smoke                    | Hosting platform       |

A new stack = author one `stacks/<name>/adapter.json` + (optionally) a `ci/<name>/ci.yml.template` override. A new host = author one `hosts/<name>/adapter.json`. They compose: `Python on Fly.io` = `stacks/python/` + `hosts/fly/`, no combinatorial explosion.

### Adapter contract

Each adapter is a single manifest file (`adapter.json`) validated against a JSON Schema:

- [STACK_ADAPTER.md](../../sdlc/STACK_ADAPTER.md) + [sdlc/files/stacks/\_schema/adapter.schema.json](../../sdlc/files/stacks/_schema/adapter.schema.json) — stack contract
- [HOST_ADAPTER.md](../../sdlc/HOST_ADAPTER.md) + [sdlc/files/hosts/\_schema/adapter.schema.json](../../sdlc/files/hosts/_schema/adapter.schema.json) — host contract
- `scripts/validate-adapter.cjs` — CLI validator. CI runs `node scripts/validate-adapter.cjs --all` on every push to develop.

### Per-stack CI template override

Stack-agnostic workflows (compliance-validation, check-release-approval, post-deploy-prod, compliance-evidence, ci-status-fallback) live at `ci/<template>` and serve every stack. The quality-gates workflow (`ci.yml`) is fundamentally stack-shaped — gate commands, runtime setup, artifact paths all differ — so each stack provides its own `ci/<stack>/ci.yml.template`. Sync looks in `ci/<stack>/` first, falls back to `ci/`.

This was a deliberate choice over a single mega-template with `{{stack.install}}` / `{{stack.test}}` substitution placeholders. See "Considered alternatives" below.

### Consumer config (`sdlc-config.json`)

Two new required keys for every consumer:

- `stack` — `"node"` / `"python"` / (future: `"go"` / `"rust"`).
- `host` — `"railway"` / (future: `"fly"` / `"kubernetes"`).

Sync refuses with a helpful error if either references an adapter that doesn't exist. Legacy configs without these keys default to `node + railway` with a deprecation warning (transitional behaviour, to be tightened to a hard refusal in v1.24).

Additional optional config (when applicable):

- `working_directory` — for monorepo / subdir projects where the dependency manifest lives in a subdirectory (e.g. META-AGENT's `mission-control-api/pyproject.toml`). Honoured by the Python ci.yml template.
- `python_version` / `node_version` — stack-specific runtime versions.

## Consequences

### Positive

- **Polyglot onboarding is now a configuration exercise**, not a fork. Adding META-AGENT took two PRs (one to author the Python adapter, one to update its sdlc-config.json). Adding a Go consumer would be ~1 day of work to author the Go adapter + Go ci.yml template, plus the consumer's sync.

- **The contract is explicit and validated**. A future contributor adding a stack reads STACK_ADAPTER.md, copies an existing adapter, runs `validate-adapter.cjs --all`, and gets actionable errors if they got the shape wrong. No reverse-engineering of templates.

- **No combinatorial explosion**. Python-on-Fly = Python stack adapter + Fly host adapter. Composition is freebie.

- **Stack-agnostic workflows stay shared**. compliance-validation, check-release-approval, post-deploy-prod, compliance-evidence, ci-status-fallback are written once. Changes propagate to every consumer regardless of stack.

- **Backwards compatible**. Phase 1 verified bit-for-bit equivalent output for the existing Node consumer (wawagardenbar-app). v1.22.x → v1.23.x is a deprecation-warning rename, not a breaking change.

- **Onboarding is fully automated within compliance limits**. Post-Phase 6, `scripts/sdlc-onboard.sh` collapses the previously-manual 9-step onboarding (wizard config, project create, API key issue, secrets/variables set, hook framework install, branch protection config, first sync) into 2 operator actions: issue a PAT once, run the script. PAT auth is now wired on `/api/projects` and `/api/projects/[id]/api-keys` (extending the #141 pattern). See [docs/onboarding.md](../onboarding.md). The remaining manual steps (release approval clicks, PR reviews, requirement authoring) are compliance controls by design, not gaps.

### Negative

- **Duplicated effort across per-stack ci.yml templates.** When the quality-gates job shape changes (e.g. a new mandatory gate, a security scanner replaced), every stack's template needs the same edit. Mitigated by: stack-agnostic workflows hold most of the cross-cutting concerns; per-stack files are just the gate-command list.

- **More directory navigation.** A contributor touching the framework needs to know which layer their change belongs in. Mitigated by: STACK_ADAPTER.md and HOST_ADAPTER.md document the layering explicitly; `validate-adapter.cjs --all` runs on every PR.

- **Bootstrap chicken-and-eggs surface.** Some workflows (notably Release Approval Gate) want to enforce against a DevAudit-side project state that doesn't exist until the first compliance-evidence.yml run. Addressed in [#301](https://github.com/metasession-dev/devaudit/issues/301) (bootstrap-safe gate). Future workflows added at the framework level need to consider the same case.

### Neutral

- **Phase 1 was invisible to existing consumers.** The restructure produced bit-for-bit equivalent output for Node-on-Railway. The value only materialised in Phase 4 (Python adapter) and Phase 5 (META-AGENT onboarding). This is the right shape for foundational refactors, but worth noting that "the PR with the biggest scope produces no behaviour change today" is a hard sell without the follow-on phases in flight.

## Considered alternatives

### Alternative A: Single mega-template with `{{stack.install}}` placeholders

Have one `ci/ci.yml.template` that substitutes every gate command from the stack adapter (`{{stack.install}}` → `npm ci` / `pip install -e ".[dev]"` etc.). Tempting because it forces every stack to share gate ordering.

**Rejected** because per-stack workflows are _legitimately_ different beyond just the commands:

- Node's quality-gates job has Playwright dev-server lifecycle (kill stale, start, wait-on, run tests). Python has none of that — pytest doesn't need a dev server.
- Node uses `actions/setup-node@v4` with `cache: 'npm'`; Python uses `actions/setup-python@v5` with `cache: 'pip'`. Forcing the runtime-setup block into a placeholder makes the template harder to read for every contributor.
- Cache strategies differ — Node template has lockfile-hash-based skip; Python uses pip's cache.
- Output paths differ: Node's Playwright JSON, Python's JUnit XML.

The cost of the abstraction (template legibility, debugging across substitution) outweighed the benefit (gate order enforcement). Gate ordering is documented in STACK_ADAPTER.md and enforced by review.

### Alternative B: Fork the templates per stack

Copy the Node templates wholesale into `ci/python/*.template`, edit each one. Initial velocity is high — no abstraction work.

**Rejected** because every change to a cross-cutting workflow (compliance-evidence.yml's evidence upload paths, check-release-approval.yml's polling logic) would need to propagate across every per-stack copy. Drift becomes inevitable.

The chosen design splits the difference: cross-cutting workflows are shared (one copy in `ci/`); the stack-shaped workflow has per-stack overrides (`ci/<stack>/ci.yml.template`).

### Alternative C: External orchestration (Terragrunt / Helm chart)

Treat the SDLC framework as a templated module rendered by an external tool (Helm, Cookiecutter, etc.). Decoupling could let stacks own their own template trees.

**Rejected** as over-engineering for the current scale. The sync script is ~500 lines of bash; an external orchestrator would add a dependency for every consumer to bootstrap. Worth revisiting if the framework grows to 5+ stacks and 3+ hosts.

## Roadmap

This ADR captures the v1.23.0 design plus the v1.24 onboarding-automation follow-up (`sdlc-onboard.sh`, shipped post-Phase 6). Future work:

- **v1.24 — deprecation tightening.** Convert the legacy-defaults deprecation warning (legacy configs missing `stack` / `host` keys default to `node + railway`) into a hard refusal. Backend enum rename `uat_approved → release_approved` ([#284](https://github.com/metasession-dev/devaudit/issues/284)).
- **First non-Railway host adapter** — Fly.io most likely (a sketched example already lives in HOST_ADAPTER.md). Validates the host-adapter contract against a real consumer the same way Phase 4 validated the stack contract against META-AGENT.
- **`gh sdlc` extension (rather than `scripts/sdlc-onboard.sh`).** The bash script does the job today; promoting it to a proper `gh` extension would give it auto-update via `gh extension upgrade` and a per-repo invocation idiom. Pure operator ergonomics — the underlying workflow is unchanged.
- **OAuth device flow for first-PAT issuance.** Eliminates the one remaining manual portal click before running `sdlc-onboard.sh`. Larger scope (DevAudit-side auth surface), so not blocking.

## References

- [#287](https://github.com/metasession-dev/devaudit/issues/287) — SDLC v1.23.0 umbrella issue.
- [#252](https://github.com/metasession-dev/devaudit/issues/252) — META-AGENT onboarding (closed by [META-AGENT#19](https://github.com/metasession-dev/META-AGENT/pull/19)).
- [STACK_ADAPTER.md](../../sdlc/STACK_ADAPTER.md) and [HOST_ADAPTER.md](../../sdlc/HOST_ADAPTER.md) — the contracts.
- [docs/adding-a-stack.md](../adding-a-stack.md) — walkthrough for the next stack.
- [docs/adding-a-host.md](../adding-a-host.md) — walkthrough for the next host.
