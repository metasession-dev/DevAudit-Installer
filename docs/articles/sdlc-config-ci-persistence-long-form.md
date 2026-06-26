# The Config Is the Source of Truth: How sdlc-config.json Survives Template Syncs

> **Primary persona:** CTO + Lead Developer
> **Funnel stage:** MOFU — Consideration
> **Format:** Technical deep-dive (~2000 words)
> **Cross-links:** [/sdlc](https://devaudit.ai/sdlc) · [sdlc/files/sdlc-config.example.json](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/sdlc-config.example.json) · [cli/src/update/ci-templates.ts](https://github.com/metasession-dev/DevAudit-Installer/blob/main/cli/src/update/ci-templates.ts)

---

You add three environment variables to your CI workflow. E2E needs a local Supabase URL, a service role key, and a dummy email key so tests never touch production. You edit `.github/workflows/ci.yml`, add the vars to the `E2E Tests` step's `env:` block, push, and the E2E gate passes. Green CI. Done.

Two weeks later you run `devaudit update` to pull the latest template improvements — new compliance checks, a security summary generator, an updated Playwright reporter config. The CLI regenerates `ci.yml` from its template. Your three env vars are gone. E2E fails. The gate is red.

You re-add them. Another update, another wipe. You stop running `devaudit update`. Now you're frozen on an old template version, missing security improvements and compliance features, because the update mechanism keeps destroying your CI configuration.

This is the generated-file-overwrite problem, and it's entirely avoidable.

## How the template sync works

DevAudit's `devaudit update` command synchronises CI workflows, scripts, hooks, and skill files from the installed framework into your project. The CI workflow sync is the most complex part, and it's where the overwrite problem lives.

### The pipeline

```
sdlc-config.json (user-owned, persists)
        ↓
cli/src/update/ci-templates.ts
        ↓
sdlc/files/ci/*.yml.template (framework-owned, overwritten on update)
        ↓
.github/workflows/*.yml (generated output, overwritten on every sync)
```

The CLI reads `sdlc-config.json`, reads the template files, performs token substitution and block injection, and writes the generated workflows to `.github/workflows/`. The generated files are **output artifacts** — they are regenerated from scratch on every `devaudit update`.

### Token substitution

Templates contain `{{TOKEN}}` placeholders that get replaced with scalar values from the config:

```yaml
# ci.yml.template (excerpt)
runs-on: {{RUNNER}}
    steps:
      - name: Setup Node
        with:
          node-version: {{NODE_VERSION}}
```

The `substituteTokens()` function in `cli/src/lib/templates.ts` performs simple string replacement: `{{RUNNER}}` → `self-hosted`, `{{NODE_VERSION}}` → `20`. No regex, no escaping — just split and join.

### Block injection

Multi-line sections use `{{BLOCK_TOKEN}}` placeholders that get replaced with generated content:

```yaml
# ci.yml.template (excerpt)
      - name: Start dev server
{{E2E_DEV_SERVER_STEP}}
      - name: E2E Tests
{{E2E_TEST_STEP}}
```

The `substituteBlocks()` function replaces entire lines containing the token with the generated block content. If the block is empty (e.g. no `e2e_env` configured), the line is dropped entirely — no stray newline, no broken YAML.

### What gets generated

The `syncCiTemplates()` function in `ci-templates.ts` processes eight workflow templates:

- `ci.yml` — the main quality gate pipeline
- `compliance-evidence.yml` — compliance document upload
- `compliance-validation.yml` — artifact validation on PRs to main
- `check-release-approval.yml` — release approval enforcement
- `post-deploy-prod.yml` — post-deploy production smoke test
- `feature-e2e.yml` — per-feature E2E gate
- `close-out-release.yml` — release close-out automation
- `periodic-review.yml` — quarterly compliance review

Each template has its own set of tokens and blocks. The generated output is deterministic: same config + same templates = same output. This is by design — it makes syncs reproducible and auditable.

## Where env vars live in the config

`sdlc-config.json` has four env blocks, each scoped to a different CI step:

### `database_env` — database service container

```json
"database_env": {
  "MONGODB_URI": "mongodb://localhost:27017",
  "MONGODB_DB_NAME": "your_test_db"
}
```

Injected into the GitHub Actions `services:` block. The database container sees these vars at startup.

### `app_env` — application-level env

```json
"app_env": {
  "NODE_ENV": "test",
  "NEXT_PUBLIC_APP_URL": "http://localhost:3000"
}
```

Injected at the job level so every step in the job inherits them. Use for vars the application needs regardless of which step is running.

### `build_env` — build step env

```json
"build_env": {
  "MONGODB_URI": "mongodb://localhost:27017",
  "MONGODB_DB_NAME": "placeholder"
}
```

Injected into the build step only. Use for vars that only matter during compilation (e.g. feature flags that control build-time code paths).

### `e2e_env` — E2E step env (the one you want)

```json
"e2e_env": {
  "E2E_LOCAL": "1",
  "NEXT_PUBLIC_SUPABASE_URL": "http://127.0.0.1:54321",
  "SUPABASE_SERVICE_ROLE_KEY": "your-local-service-key",
  "RESEND_API_KEY": "re_e2e_local_dummy_key"
}
```

Injected into **four** E2E-related steps via generated code in `ci-templates.ts`:

1. **E2E setup step** (`buildE2eSetupStep`) — the pre-E2E foreground command (e.g. `supabase start` + schema load)
2. **Dev server step** (`buildE2eDevServerStep`) — the blocking dev server start
3. **E2E test step** (`buildE2eTestStep`) — the blocking Playwright run
4. **Authenticated E2E step** (`buildAuthenticatedE2eStep`) — the report-only authenticated Playwright run

The `e2e_env` block overrides job-level secrets at the step level. This is critical for E2E isolation: your job-level `SUPABASE_URL` might point at a remote staging instance, but `e2e_env` overrides it to `http://127.0.0.1:54321` so tests hit the disposable local stack. Step-level env wins over job-level secrets in GitHub Actions — this is the platform's native precedence rule, and the generated YAML relies on it.

### GitHub secrets references

Values in any env block can reference GitHub repo secrets:

```json
"e2e_env": {
  "E2E_ADMIN_USERNAME": "${{ secrets.E2E_ADMIN_USERNAME }}",
  "E2E_ADMIN_PASSWORD": "${{ secrets.E2E_ADMIN_PASSWORD }}"
}
```

The CLI's `indentEnvBlock()` function outputs values verbatim — no escaping, no interpolation. The `${{ secrets.* }}` syntax is resolved by GitHub Actions at runtime, not by the CLI. This means:

- The value in `sdlc-config.json` is a **reference**, not the secret itself
- The secret never appears in git history
- The generated `ci.yml` contains the reference, which GitHub Actions resolves at job execution time
- PR reviewers can see which secrets a step uses (the reference is visible in the workflow file)

This is the correct pattern for secrets in generated workflows: the config holds the reference, the template holds the structure, GitHub Actions holds the secret.

## The generated-file trap

The overwrite problem is not a bug — it's the intended behaviour of a code generator. `devaudit update` regenerates workflows from templates. If you edit the generated output, the next regeneration overwrites your changes.

This is the same principle as editing generated code from a schema compiler, an OpenAPI codegen, or a protobuf compiler. The source of truth is the schema (or proto file), not the generated output. Editing the output is a known anti-pattern.

### What gets overwritten

| File | Owner | Overwritten on update? |
|---|---|---|
| `sdlc-config.json` | User | **No** — user-owned, persists |
| `.github/workflows/ci.yml` | Framework | Yes — regenerated from template |
| `.github/workflows/compliance-evidence.yml` | Framework | Yes — regenerated from template |
| `.github/workflows/*.yml` (all others) | Framework | Yes — regenerated from template |
| `scripts/*.sh` | Framework | Yes — overwritten from `sdlc/files/_common/scripts/` |
| `.husky/pre-push` | Framework | Yes — overwritten from `sdlc/files/stacks/node/hooks/` |
| `sdlc-config.json` | User | **No** — never touched by update |
| `compliance/` | User | **No** — user-authored evidence |

The pattern is clear: `sdlc-config.json` and `compliance/` are user-owned. Everything else is framework-owned and gets overwritten.

### The escape hatch problem

Issue #84 proposes a `.devaudit-patches/` directory that would let consumers persist local patches to generated files. The idea: the CLI applies patches after regeneration, so local customisations survive syncs. This is the same concept as Docker's `apt-get` layer — you can modify the base image, but your modifications are tracked separately and reapplied on rebuild.

This doesn't exist yet. Until it does, the only durable customisation path is `sdlc-config.json`.

## When the config can't help

Not every problem can be solved by adding values to `sdlc-config.json`. The config controls **values** — env vars, project slug, runner type, node version. It does not control **template structure** — YAML syntax, step ordering, block scalar indentation, shell script logic.

### Template bugs require upstream fixes

Issue #228 is a structural YAML bug in `compliance-evidence.yml.template`. Multi-line shell string assignments containing `**` markdown bold syntax (e.g. `**Test name:**`) inside `run: |` block scalars are misparsed by YAML parsers — `**` is interpreted as a YAML alias reference (`*alias`), which doesn't exist, causing a parse error.

This bug lives in the template's structure, not in any config value. Adding env vars or changing the project slug in `sdlc-config.json` cannot fix it. The template itself needs to be patched — either by switching to heredoc syntax for the multi-line strings, or by indenting continuation lines deeper than the block scalar's base indentation.

The distinction matters:

- **Config values** (env vars, project slug, runner type, database settings) → fix in `sdlc-config.json`, durable across syncs
- **Template structure** (YAML syntax, step logic, block scalar formatting) → fix upstream in `sdlc/files/ci/*.yml.template`, requires a framework release

### How to tell which one you're hitting

If the problem is "my env vars disappeared after update" → you edited the generated file. Fix: move the vars to `sdlc-config.json`.

If the problem is "the generated workflow is invalid YAML" → the template has a structural bug. Fix: file an issue, patch the template upstream, and manually fix the generated file until the next framework release.

If the problem is "I need a step that doesn't exist in the template" → the template doesn't support your use case. Fix: file a feature request, or use the `.devaudit-patches/` escape hatch when it ships (#84).

## The design principle

The separation between config and templates follows a deliberate design principle: **the config is the source of truth for project-specific values; the templates are the source of truth for workflow structure.** The generated workflows are the intersection — structure from templates, values from config.

This separation has three benefits:

1. **Reproducibility** — same config + same templates = same output. No drift between what you reviewed and what's running in CI.

2. **Upgrade safety** — `devaudit update` can ship template improvements (new compliance checks, better error messages, fixed YAML bugs) without touching your project-specific configuration. Your env vars, project slug, and database settings survive the sync.

3. **Audit clarity** — an reviewer can see exactly what's project-specific (in `sdlc-config.json`, visible in PRs) vs. what's framework-standard (in the templates, versioned and changelogged). No guessing whether a CI step was added by the team or by the framework.

The cost is the generated-file trap: if you don't know which file is the source of truth, you'll edit the wrong one and lose your changes on the next sync. The fix is simple — if it's a value, put it in the config. If it's structure, file an issue upstream.

## Practical guidance

### Adding E2E env vars

1. Edit `sdlc-config.json` → add vars to `e2e_env`
2. Run `devaudit update`
3. Verify `.github/workflows/ci.yml` contains the vars in the E2E steps
4. Commit both `sdlc-config.json` and the regenerated `ci.yml`

### Adding a GitHub secret reference

1. Add the secret in GitHub repo settings (Settings → Secrets and variables → Actions)
2. Edit `sdlc-config.json` → add `"VAR_NAME": "${{ secrets.VAR_NAME }}"` to the appropriate env block
3. Run `devaudit update`
4. The generated workflow now references the secret — GitHub Actions resolves it at runtime

### Changing the runner

1. Edit `sdlc-config.json` → change `"runner": "self-hosted"` to `"runner": "ubuntu-latest"`
2. Run `devaudit update`
3. All generated workflows now use the new runner

### What never to do

- Don't edit `.github/workflows/ci.yml` directly — it will be overwritten
- Don't edit `scripts/*.sh` directly — they will be overwritten
- Don't edit `.husky/pre-push` directly — it will be overwritten
- Don't put secrets directly in `sdlc-config.json` — use `${{ secrets.* }}` references

## The broader lesson

Generated files are build outputs. Editing them directly is like editing a compiled binary instead of the source code. It works until the next build. `sdlc-config.json` is the source. The generated workflows are the artifacts. Treat them accordingly.

This pattern — config as source of truth, templates as structure, generated files as output — is how well-designed code generators work. OpenAPI codegen, protobuf compilers, Terraform modules, Helm charts: all follow the same principle. The config (OpenAPI spec, .proto file, variables.tf, values.yaml) is user-owned. The templates (code templates, service definitions, module source, chart templates) are framework-owned. The output (generated code, .tfstate, rendered manifests) is disposable.

DevAudit's CI template system follows this pattern deliberately. The pain of losing env vars on update is the pain of editing the wrong layer. Once you know which layer owns what, the pain goes away — and the update mechanism becomes what it was designed to be: a safe, reproducible way to ship framework improvements without losing project-specific configuration.

Compliance as a byproduct, not a project — but the byproduct needs the right source of truth.

---

*See the config reference → [sdlc/files/sdlc-config.example.json](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/sdlc-config.example.json)*

*See the template engine → [cli/src/update/ci-templates.ts](https://github.com/metasession-dev/DevAudit-Installer/blob/main/cli/src/update/ci-templates.ts)*

*See the SDLC → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)*
