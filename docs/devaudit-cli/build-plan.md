# `devaudit` CLI — build plan

> Engineering plan to deliver the enterprise CLI described in [README.md](./README.md). No intermediate phases exposed externally — the CLI ships as the enterprise product. This document captures the internal workstreams, their dependencies, and a realistic effort estimate.

## Honest scope assessment

The README describes an enterprise CLI: multi-stack, multi-provider, multi-org, plugin-extensible, single-binary distribution, browser-OAuth authentication. Building this end-state in one shipment is a **3–6 month effort for a small team** (1–2 engineers), or shorter with a larger team. The work spans the CLI itself (this repo), the DevAudit portal (`metasession-dev/META-COMPLY`), the framework's adapter library (this repo), and the plugin SDK (this repo).

This plan splits the work into four parallelisable workstreams. Sequencing acknowledges the dependencies between them — the CLI can't ship until its prerequisites in the portal and framework land.

## Settled decisions

These were open questions in earlier drafts; the recent repo split settled them:

| Decision | Resolution |
|---|---|
| CLI source location | Sub-package inside this repo at `DevAudit-Installer/cli/`. Co-located with the framework templates it bundles so a CLI release and a template release ship from the same commit. |
| npm package scope | `@metasession.co/devaudit-cli` (matches GitHub org). |
| Binary name | `devaudit`. |
| Bundling strategy | CLI embeds a snapshot of `sdlc/files/` at build time via `tsup`'s asset import. No cross-repo coordination for routine template changes. |
| User-token env var name | `DEVAUDIT_USER_TOKEN`. Renamed from `META_COMPLY_USER_TOKEN` during the repo split. |
| Project API key env var / GitHub secret name | `DEVAUDIT_API_KEY`. Renamed from `META_COMPLY_API_KEY`. CI workflow templates and `sdlc-onboard.sh` already use the new name. |
| Portal URL env var / GitHub variable name | `DEVAUDIT_BASE_URL`. Renamed from `META_COMPLY_BASE_URL`. |
| PAT HTTP header name | `X-DevAudit-Token`. Renamed from `X-Meta-Comply-Token`. The portal dual-accepts both during the migration window (`lib/auth/resolve-user-auth.ts` reads either, prefers the new name). The legacy header gets removed in a follow-up PR after the active consumer (WGB) has migrated. |
| Consumer migration | Per consumer, in order: rotate the GitHub secrets/variable to the new names → re-sync templates from this repo → merge → delete the old secrets. Detailed walkthrough lives in [consuming-projects.md](../consuming-projects.md). Today only WGB is an active consumer; META-AGENT, META-ATS, and META-JOBS onboarding attempts have been reverted. |

## Goal

Ship `devaudit` v1.0 as a single, polished, enterprise-ready binary that:

- Installs and maintains the Metasession SDLC across any consumer project on any supported stack.
- Speaks to GitHub, GitLab, Bitbucket, and self-hosted Git first-class.
- Authenticates via browser OAuth (PAT-paste fallback for headless).
- Surfaces org-level policy, RBAC, and centralised reporting.
- Distributes via brew, scoop, `curl | sh`, npm, and GitHub Releases.
- Supports plugins from a registry plus org-private sources.

## Workstreams

### A — CLI engine and command surface (this repo)

The Node/TS CLI itself: every command from the README's command surface section, plus the common flags, plus the build pipeline. Lives at `DevAudit-Installer/cli/` per the settled decision above.

**Directory layout**:

```
DevAudit-Installer/cli/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── README.md
├── bin/
│   └── devaudit.js                      # shebang + import('../dist/index.js')
├── src/
│   ├── index.ts                         # entry; registers commands
│   ├── commands/
│   │   ├── install.ts
│   │   ├── update.ts
│   │   ├── push.ts
│   │   ├── doctor.ts
│   │   ├── status.ts
│   │   ├── auth/{login,logout,status}.ts
│   │   ├── org/{list,switch,policy/{list,apply},report}.ts
│   │   ├── plugin/{list,install,remove,update}.ts
│   │   ├── config/{get,set,list}.ts
│   │   └── upgrade.ts
│   ├── lib/
│   │   ├── adapter.ts                   # loads stacks/* + hosts/*
│   │   ├── devaudit-api.ts              # REST client
│   │   ├── sdlc-config.ts               # consumer's sdlc-config.json
│   │   ├── auth.ts                      # token storage + OAuth flow
│   │   ├── git-provider/{github,gitlab,bitbucket,generic}.ts
│   │   ├── policy.ts                    # policy-as-code evaluator
│   │   ├── plugin.ts                    # plugin loader + registry client
│   │   ├── report.ts                    # HTML/JSON/CSV report generator
│   │   ├── prompts.ts                   # @clack/prompts wrappers
│   │   ├── logger.ts                    # consola + JSON mode
│   │   ├── paths.ts                     # env-paths cross-platform
│   │   └── stack-detect.ts
│   └── templates/                       # bundled snapshot of sdlc/files/ at build time
└── test/
    ├── fixtures/
    │   ├── empty-{node,python,go,rust,java,dotnet,php}/
    │   ├── existing-consumer/
    │   └── org-policies/
    └── commands/                        # one .test.ts per command
```

**Library choices**:

| Concern              | Pick                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| CLI framework        | `commander`                                                                 |
| Prompts              | `@clack/prompts`                                                            |
| HTTP                 | native `fetch` (Node 22+)                                                   |
| Shell-out            | `execa`                                                                     |
| Logging              | `consola`                                                                   |
| Token storage paths  | `env-paths`                                                                 |
| OAuth local listener | native `http.createServer`                                                  |
| Plugin loader        | dynamic `import()` from a sandboxed namespace                               |
| Policy evaluator     | `ajv` for JSON-Schema policies, `yaml` for YAML loading                     |
| Report generator     | `react` + `react-dom/server` for HTML, native JSON, `csv-stringify` for CSV |
| Testing              | `vitest` + `msw`                                                            |
| Build                | `tsup` (ESM) + Node SEA pipeline for binaries                               |

**Effort**: 4–6 weeks for one engineer.

### B — DevAudit portal prerequisites (lives in `metasession-dev/META-COMPLY`)

Portal-side work that must land before the CLI's enterprise features work end-to-end. **All items here are changes to a different repo** — the DevAudit portal codebase. Cross-repo coordination required; whoever takes this workstream needs commit access on `metasession-dev/META-COMPLY` too.

| Status | Item | Effort | Why |
| --- | --- | --- | --- |
| ✓ done | `X-DevAudit-Token` PAT header dual-accept | shipped | CLI can authenticate against the portal via PAT today; landed in [`devaudit#318`](https://github.com/metasession-dev/devaudit/pull/318) |
| pending | `/cli-auth` OAuth callback endpoint | 1 week | CLI's browser auth flow depends on it (PAT-paste fallback works today via the dual-accepted header) |
| pending | Org-level `org-config.json` storage + API | 2 weeks | Shared configuration across an org's projects |
| pending | Policy engine (CRUD policies, evaluation results storage) | 3 weeks | `devaudit org policy apply` writes results here |
| pending | RBAC enforcement at portal API layer | 2 weeks | CLI commands respect role boundaries |
| pending | Plugin registry backend (`/plugins` listing + per-plugin metadata) | 2 weeks | `devaudit plugin install` reads from here |
| pending | Org-wide reporting endpoints | 1 week | `devaudit org report` aggregates from these |
| follow-up | Remove `PAT_HEADER_LEGACY` (`x-meta-comply-token`) constant from `lib/auth/resolve-user-auth.ts` | 0.5 days | Tracked in build-plan Open Questions; safe to do once WGB has rotated its secrets and re-synced |

**Remaining effort**: ~11 weeks total for pending items. Some items parallelisable across portal subsystems.

### C — Framework prerequisites (this repo)

Adapter and abstraction work in this repo (`sdlc/files/stacks/*`, `sdlc/files/hosts/*`, `sdlc/files/_common/lib/`) that the CLI consumes.

| Item                                                                                        | Effort    | Why                                                                                 |
| ------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------- |
| Authoring 5 new stack adapters (Go, Rust, Java, .NET, PHP) — adapter.json + hooks/ for each | 5–7 weeks | CLI shipping with these stacks day-one means each adapter exists                    |
| Authoring 4 new host adapters (Vercel, Fly, Kubernetes, AWS ECS)                            | 4 weeks   | Hosts are simpler than stacks; mostly deploy-wait logic + URL resolution            |
| `GitProvider` interface in `sdlc/files/_common/lib/` + GitHub-impl extraction               | 1 week    | Replaces the inline `gh` calls in `sdlc-onboard.sh`; the CLI consumes the interface |
| GitLab provider implementation                                                              | 1.5 weeks | Uses `glab` CLI when available, REST otherwise                                      |
| Bitbucket provider implementation                                                           | 2 weeks   | No first-party CLI as of 2026; REST only                                            |
| Self-hosted provider implementation (generic, prompts for everything)                       | 0.5 weeks | Mostly UX — punt API automation, prompt the user                                    |

**Effort**: ~14–16 weeks. Adapter authoring dominates; each new stack needs validation against a real consumer.

### D — Plugin SDK + first-party plugins

Plugin extensibility surface.

| Item                                                                                                                  | Effort    | Why                                                       |
| --------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------- |
| Plugin SDK package (`@metasession.co/devaudit-plugin-sdk`) — contract types, plugin manifest schema, lifecycle hooks | 2 weeks   | Plugins compile against this; defines what plugins can do |
| Plugin loader inside the CLI (dynamic import, sandboxing, error isolation)                                            | 2 weeks   | Workstream A depends on this for the `plugin` commands    |
| First-party plugin: `devaudit-plugin-prisma`                                                                          | 1 week    | Prisma migration deploy hooks for node consumers          |
| First-party plugin: `devaudit-plugin-supabase`                                                                        | 1.5 weeks | RLS policy linting + project metadata sync                |
| First-party plugin: `devaudit-plugin-evidence-export`                                                                 | 1 week    | Bulk evidence bundle export for external auditors         |
| Plugin documentation: SDK usage, publishing flow, security model                                                      | 1 week    | How third-party plugins should be built                   |

**Effort**: ~8.5 weeks.

## Dependency graph

```
                              ┌─────────────────────────┐
                              │ A — CLI engine          │
                              │ commands, libs, build   │
                              └────────────┬────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
              ▼                            ▼                            ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ B — Portal prerequisites│  │ C — Framework prereqs   │  │ D — Plugin SDK + plugins│
│ /cli-auth, RBAC,        │  │ stack adapters,         │  │ SDK package, loader,    │
│ policy engine, plugin   │  │ provider abstraction,   │  │ first-party plugins     │
│ registry backend, org   │  │ host adapters           │  │                         │
│ reporting               │  │                         │  │                         │
└────────────┬────────────┘  └────────────┬────────────┘  └────────────┬────────────┘
             │                            │                            │
             └────────────────────────────┼────────────────────────────┘
                                          │
                                          ▼
                              ┌─────────────────────────┐
                              │  Integration + release  │
                              │  smoke tests against    │
                              │  WGB (only active       │
                              │  consumer as of         │
                              │  2026-05-19)            │
                              └─────────────────────────┘
```

**A** can start in parallel with **B**, **C**, **D** but can't _complete_ until they all land. Specifically:

- `devaudit auth login` needs **B**'s `/cli-auth` endpoint.
- `devaudit install --stack go` needs **C**'s Go adapter.
- `devaudit plugin install` needs **B**'s plugin registry and **D**'s SDK + at least one plugin.
- `devaudit org policy apply` needs **B**'s policy engine.

## Sequencing for a small team

Assuming 2 engineers in parallel, here's a sensible internal sequence (not exposed externally — externally there's a single release):

1. **Weeks 1–4** — Both engineers on CLI skeleton (A) + portal `/cli-auth` (B). At end of week 4, `devaudit auth login` works against the portal.
2. **Weeks 5–10** — Engineer 1: CLI commands + framework adapter abstraction (A + C provider interface). Engineer 2: portal org-config + RBAC + policy engine (B).
3. **Weeks 11–16** — Engineer 1: stack adapters for Go, Rust, Java (C). Engineer 2: plugin SDK + plugin loader + first-party plugins (D).
4. **Weeks 17–22** — Engineer 1: .NET + PHP adapters + host adapters (C). Engineer 2: portal plugin registry + org reporting endpoints + report generator (B + A).
5. **Weeks 23–26** — Integration testing, smoke against all consumers, single-binary builds (Node SEA), brew/scoop/install.sh distribution, docs, npm publish, GitHub release.

**Total**: ~26 weeks (6 months) calendar time for a 2-engineer team. ~52 weeks for a single engineer.

## Smoke + verification

Before declaring the CLI shipped:

1. **End-to-end onboarding** against the active consumer (`wawagardenbar-app`, the only live SDLC consumer as of 2026-05-18) and against fresh fixtures for each shipped stack adapter (node, python, plus any added during Workstream C). The DevAudit portal itself (`metasession-dev/META-COMPLY`) is *not* a consumer — per the self-release policy, the portal doesn't gate releases through itself. META-AGENT, META-ATS, and META-JOBS onboarding attempts have been reverted; if any of them returns as a live consumer before CLI release, add them to the smoke list at that time.
2. **Policy round-trip**: define a policy on the portal, run `devaudit org policy apply` against a violating project, fix the violation, verify it passes.
3. **OAuth flow** on Linux + macOS + Windows. Headless PAT fallback works on each.
4. **Plugin install** from registry + from private Git URL. Plugin commands appear under `devaudit <plugin> <cmd>`.
5. **Single binary** runs on a machine with no Node installed (Linux + macOS + Windows).
6. **`devaudit doctor`** correctly identifies a deliberately-broken install.
7. **CI integration**: `DEVAUDIT_USER_TOKEN` env-var auth works in unattended CI.

## Risks

| Risk                                                                                                                      | Likelihood | Mitigation                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Stack adapter explosion: each new adapter takes longer than budgeted because real consumer validation surfaces edge cases | High       | Don't ship a stack adapter without a real consumer to validate against. If no consumer for Java exists, deprioritise.             |
| Portal-side work blocks CLI development                                                                                   | Medium     | Workstream A starts with the bits that don't need portal prereqs (install, update, push, doctor, status, plugin loader skeleton). |
| Plugin sandboxing is hard to get right (security boundary)                                                                | Medium     | Initial version trusts plugins fully but documents the security model clearly; sandboxing arrives in a follow-up.                 |
| Token leak in `--verbose` HTTP logs                                                                                       | Low        | Redaction layer in `logger.ts` with unit tests; CI smoke verifies.                                                                |
| Cross-platform Windows native quirks (path handling, child process spawning)                                              | Medium     | CI matrix runs against Windows from day one; `cross-env` + `path.posix` everywhere user-facing paths cross OS boundaries.         |
| Multi-provider Git: testing without real Bitbucket/GitLab accounts                                                        | Medium     | Maintain test accounts on each provider; integration tests gated to CI with provider tokens.                                      |
| Single-binary size (Node SEA bundles full Node runtime)                                                                   | Low        | Acceptable trade-off; ~80MB binaries are normal for this distribution pattern (rg, fd, etc.).                                     |
| Org features ahead of org adoption on the portal                                                                          | Medium     | Keep org features behind a flag if portal-side maturity lags; ship core CLI without them in the worst case.                       |

## What this plan deliberately does not do

- **No incremental external releases.** The CLI ships once, as v1.0, with the enterprise feature set described in the README. No beta channels exposed to consumers, no MVP narrative.
- **No hard cutover on identifier renames.** The portal already dual-accepts the legacy `X-Meta-Comply-Token` header alongside the new `X-DevAudit-Token`. Consumer GitHub secret/variable rotation is a per-consumer migration window. The CLI itself ships with only the new names — but consumers running pre-rename CI keep working until they re-sync.
- **No falling back to bash scripts.** Once the CLI ships, `sdlc-onboard.sh` and `sync-sdlc.sh` (currently in `scripts/` of this repo) become deprecated; they remain here for one release cycle then move to `legacy/` or get removed.
- **No partial stack support.** If Go support isn't ready, Go consumers can't be onboarded with the CLI. We don't ship "Go support is coming soon."
- **No reliance on `pkg`.** It's deprecated as of 2024. Single binaries come from Node SEA (per [ADR-001](./ADR-001-language-and-distribution.md)) or Bun `--compile`.

## Open questions

The repo split settled several earlier questions (see "Settled decisions" above). What remains open:

| Question | Default if not decided |
|---|---|
| Telemetry vendor (opt-in only): PostHog, Plausible, custom? | PostHog (already in use elsewhere in the portfolio). |
| Plugin signing / verification model (security). | Defer to first follow-up; v1.0 ships unsigned plugins. |
| Minimum supported Node version for npm distribution. | Node 22 LTS (Node SEA support; covers builders + npm users). |
| When to remove the legacy `PAT_HEADER_LEGACY` (`x-meta-comply-token`) constant from `lib/auth/resolve-user-auth.ts` in `metasession-dev/META-COMPLY`. | After WGB completes its `DEVAUDIT_USER_TOKEN` / `DEVAUDIT_API_KEY` / `DEVAUDIT_BASE_URL` rotation and re-syncs. A follow-up PR drops the legacy constant + the `??` fallback in one commit; no CLI code change. |
