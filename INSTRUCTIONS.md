# DevAudit-Installer — working instructions

> Standards for editing the Metasession SDLC framework and the installer scripts. AI tools (Claude Code, Cursor, Windsurf, Gemini CLI) and human contributors must follow these conventions.

This document is for **maintainers of this repository** — people changing the framework templates, adapter manifests, or installer scripts. It is NOT the document that gets synced to consumer projects; that is `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`.

## Repository purpose

This repo is the single source of truth for:

- **SDLC framework templates** (`sdlc/files/`) — copied into every consumer project at onboard / sync time.
- **AI tool rule files** (`sdlc/ai-rules/`) — Claude / Cursor / Windsurf / Gemini configs that consumers receive.
- **Installer scripts** (`scripts/sdlc-onboard.sh`, `scripts/sync-sdlc.sh`) — the bash flow that bootstraps a consumer.
- **Documentation** (`docs/`) — operator walkthroughs and adapter-pattern guides.
- **Adapter contracts** (`sdlc/STACK_ADAPTER.md`, `sdlc/HOST_ADAPTER.md`, `sdlc/SKILLS.md`) — schemas every stack/host/skill manifest must satisfy.

This repo does **not** contain:

- The DevAudit web portal (Next.js application) — that's in [`metasession-dev/devaudit`](https://github.com/metasession-dev/devaudit) (formerly `META-COMPLY`).
- Any consumer project's compliance evidence — that lives in the consumer's own repo and the DevAudit portal.

## Tech stack of this repo

- Bash (installer scripts)
- Markdown (templates and docs)
- JSON / YAML (adapter manifests, CI workflow templates)
- Node.js (validate-adapter.cjs) — minimal, ad-hoc

No application code. No framework dependencies beyond `jq`, `curl`, `gh`, `git`, and Node ≥ 18 on the maintainer's machine.

## Conventions

### Branching

- `develop` for active work. `main` for the stable, tagged framework versions.
- Trunk-based with merge commits to preserve audit trail.
- Tag a release with `sdlc-vX.Y.Z` via `git tag` before announcing it to consumers.

### Commits

- Conventional Commits: `feat(sdlc):`, `fix(sdlc):`, `docs(sdlc):`, `chore(sdlc):`.
- Include `Co-Authored-By:` for AI-assisted commits.
- Reference issues / PRs in the body where relevant.

### Documentation

- Operator-facing walkthroughs in `docs/`.
- ADRs in `docs/ADR/` (one decision per file, numbered).
- Adapter contracts in `sdlc/` next to the schemas they describe.
- Keep `README.md` at the repo root current — it's the landing page.

## Adding new framework artefacts

| Artefact | Where it lives | Contract |
|---|---|---|
| New stack adapter (Go, Rust, etc.) | `sdlc/files/stacks/<name>/adapter.json` + `hooks/` | [STACK_ADAPTER.md](./sdlc/STACK_ADAPTER.md) and [adding-a-stack.md](./docs/adding-a-stack.md) |
| New host adapter (Vercel, Fly, etc.) | `sdlc/files/hosts/<name>/adapter.json` | [HOST_ADAPTER.md](./sdlc/HOST_ADAPTER.md) and [adding-a-host.md](./docs/adding-a-host.md) |
| Reusable Claude skill | `sdlc/files/_common/skills/<name>/` | [SKILLS.md](./sdlc/SKILLS.md) and [adding-a-skill.md](./docs/adding-a-skill.md) |
| New stage doc / template | `sdlc/files/_common/` | Match the existing 0-project-setup.md … 5-deploy-main.md numbering and structure |

Always validate after changes:

```bash
node scripts/validate-adapter.cjs --all
```

This checks every `adapter.json` and `SKILL.md` against the schemas in `sdlc/files/stacks/_schema/`, `sdlc/files/hosts/_schema/`, and `sdlc/files/_common/skills/_schema/`.

## Working on installer scripts

Two scripts live in `scripts/`:

- `sdlc-onboard.sh` — interactive 11-step onboarding. Read top-to-bottom to understand the flow.
- `sync-sdlc.sh` — per-project template sync. Reads the consumer's `sdlc-config.json` to resolve stack + host adapters.

Both are bash, both use `set -euo pipefail`, both are idempotent. When editing:

- Test against a throwaway fixture first (`/tmp/sync-test-*` is a fine convention).
- `bash -n` syntax-check after every change.
- Surface errors clearly. Silently-swallowing `npm install` failures was a real bug (portal repo issue #313, internal tracker) — don't reintroduce that pattern.

## Cross-repo impact

Changes to `sdlc/files/` propagate to **every consumer** on the next sync. Be deliberate:

- Validate against the active consumer (wawagardenbar-app) before tagging a release. The portal (`metasession-dev/devaudit`) is not a consumer per the self-release policy; META-AGENT / META-JOBS are active consumers and META-ATS is paused (see [consuming-projects.md](./docs/consuming-projects.md)).
- Use semver for the `sdlc-vX.Y.Z` tag — breaking changes bump major.
- Document breaking changes in the release notes / `CHANGELOG.md` (TODO if not yet present).

## Testing

The framework has limited automated testing today:

- `scripts/validate-adapter.cjs --all` — schema check for adapters and skills.
- Ad-hoc smoke runs against throwaway fixtures.

A proper test harness for `sync-sdlc.sh` is on the roadmap. Until then, every framework PR should be smoke-synced against at least one real consumer before merge.

## Security considerations

- Never embed credentials in templates. Tokens live in consumer env vars or GitHub secrets, not in shipped files.
- Adapter manifests are evaluated by `validate-adapter.cjs` — any change to schemas needs explicit review.
- The `sdlc-onboard.sh` script asks for `DEVAUDIT_USER_TOKEN` from env, never from a prompt that gets logged. Keep it that way.

## Related documents

- [`README.md`](./README.md) — repo landing page
- [`sdlc/ai-rules/INSTRUCTIONS-SDLC.md`](./sdlc/ai-rules/INSTRUCTIONS-SDLC.md) — the SDLC instructions that get **synced to consumers** (different audience from this file)
- [`docs/devaudit-cli/`](./docs/devaudit-cli/README.md) — design of the future polished CLI that replaces the bash installer
