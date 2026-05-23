# Adding a new stack adapter

Walkthrough for adding a new language / package-manager combination — Go, Rust, Ruby, Java, etc. — to the DevAudit SDLC framework. Read this with [STACK_ADAPTER.md](../sdlc/STACK_ADAPTER.md) (the contract) and [ADR-001](./ADR/ADR-001-polyglot-sdlc-architecture.md) (the architectural rationale) open in adjacent tabs.

The Python adapter (added in #287 Phase 4, validated against META-AGENT in Phase 5) is the worked example throughout — it's the second adapter, so the lessons of "what the contract should require" are baked in.

## When to add a new stack

The trigger is **a real consumer**, not the prospect of one. Authoring a stack adapter against a hypothetical project leads to fields and conventions that the first real consumer ends up overriding. Wait until you have:

- A concrete project ready to onboard (production code, not a template).
- That project's dependency manifest, test framework, lint/type tooling decided.
- Read access to its CI requirements.

Then do the work in the order below.

## Step 1 — Survey the real consumer

Before writing a single line of adapter, answer these questions for the target consumer:

| Question                                | Example (META-AGENT)                        |
| --------------------------------------- | ------------------------------------------- |
| What's the dependency manifest?         | `mission-control-api/pyproject.toml`        |
| How do you install dev dependencies?    | `pip install -e ".[dev]"`                   |
| Type checker + invocation?              | `mypy src/` (strict via pyproject)          |
| SAST scanner?                           | `semgrep scan --config auto`                |
| Dependency vulnerability scan?          | `pip-audit --format=json --strict`          |
| Test command + machine-readable output? | `pytest --junit-xml=ci-evidence/junit.xml`  |
| Build / package command?                | `python -m build --sdist --wheel`           |
| Git-hook framework?                     | `pre-commit` (not husky)                    |
| GitHub Actions runtime-setup action?    | `actions/setup-python@v5` with `cache: pip` |
| Dependency manifest at repo root?       | **No** — at `mission-control-api/`          |

If the project's pyproject.toml / package.json / go.mod isn't at the repo root, you'll need `working_directory` in `sdlc-config.json` (currently supported by the Python ci.yml template; see [STACK_ADAPTER.md § Consumer config](../sdlc/STACK_ADAPTER.md#consumer-config-working_directory)).

## Step 2 — Create the adapter directory

```
sdlc/files/stacks/<name>/
├── adapter.json
├── hooks/           # framework-specific hook files (optional)
└── scripts/         # stack-specific helper scripts (optional)
```

`<name>` must satisfy `^[a-z0-9][a-z0-9-]{0,31}$` — lowercase, kebab-cased, max 32 chars.

## Step 3 — Author `adapter.json`

Start by copying `stacks/python/adapter.json` and editing field by field. Every required field in the schema must be present.

For the worked Python example:

```json
{
  "$schema": "../_schema/adapter.schema.json",
  "name": "python",
  "description": "Python stack (3.11+) with pre-commit hooks, ruff (lint + format), mypy --strict, pytest, pip-audit, semgrep.",
  "manifest_file": "pyproject.toml",
  "hook_framework": "pre-commit",
  "hook_install_dir": ".git/hooks",
  "hooks": [],
  "hook_config_files": [".pre-commit-config.yaml"],
  "stack_scripts": [],
  "required_dev_dependencies": ["pytest", "ruff", "mypy", "pip-audit", "pre-commit"],
  "install": "pip install -e \".[dev]\"",
  "type_check": "mypy src/",
  "sast": "semgrep scan --config auto --json",
  "dep_audit": "pip-audit --format=json --strict",
  "test": "pytest --junit-xml=ci-evidence/junit.xml",
  "build": "python -m build",
  "evidence_paths": {
    "sast": "ci-evidence/sast-results.json",
    "dep_audit": "ci-evidence/dependency-audit.json",
    "test": "ci-evidence/junit.xml"
  },
  "runtime_setup": {
    "action": "actions/setup-python@v5",
    "with": { "python-version": "{{PYTHON_VERSION}}", "cache": "pip" }
  },
  "config_keys": {
    "required": ["python_version", "source_dirs", "sast_baseline", "accepted_dep_risks"],
    "defaults": {
      "python_version": "3.11",
      "source_dirs": "src/",
      "sast_baseline": 0,
      "accepted_dep_risks": ""
    }
  }
}
```

**Gotchas to watch for:**

- **`evidence_paths`** are repo-relative paths the gate commands MUST write to. The compliance-evidence upload workflow reads these to know what to publish. Pick paths the gate commands naturally produce — don't redirect outputs unnaturally to match a chosen path.
- **`runtime_setup.action`** must satisfy `^[^@]+@v[0-9]+$` — pin to a major version, not a SHA or branch.
- **Hook framework choice constrains the hooks directory shape.** husky uses per-hook executable files in `.husky/`; pre-commit uses a single `.pre-commit-config.yaml` at the repo root + auto-generates hooks under `.git/hooks/`. For pre-commit, `hooks: []` is correct — the framework generates them from config — and `.pre-commit-config.yaml` goes in `hook_config_files`, not `hooks`.

## Step 4 — Add the hook files (or config file)

For husky-style frameworks: place `commit-msg`, `pre-commit`, `pre-push` (or whichever your adapter lists) under `sdlc/files/stacks/<name>/hooks/`. They'll be copied into the consumer's `<hook_install_dir>/`.

For pre-commit-style frameworks: place `.pre-commit-config.yaml` (or your framework's equivalent) under `sdlc/files/stacks/<name>/hooks/`. It gets copied to the consumer's repo root.

## Step 5 — Author the per-stack `ci.yml.template`

The default `ci/ci.yml.template` is Node-shaped. Your stack almost certainly needs its own override at `sdlc/files/ci/<name>/ci.yml.template`. Copy `ci/python/ci.yml.template` as a starting point.

What to change:

- `actions/setup-<runtime>` block — match your `runtime_setup` adapter field.
- **Install step** — your `install` command, plus any extras the gates need installed at the same time (e.g. Python installs `semgrep pip-audit build` alongside dev deps).
- **Six gate steps** — one per stack adapter command, in the framework order: install → type_check → SAST → dep_audit → test → build. Each gate writes to its `evidence_paths` location.
- **`upload-artifact` paths** — list the `evidence_paths` + any build outputs (`dist/`, `build/`, etc.). For subdir consumers, prefix with `{{WORKING_DIR_PREFIX}}` (see Python template).
- **`upload-evidence` job's file references** — should match the `upload-artifact` paths.

What stays the same:

- The three jobs (`quality-gates`, `register-release`, `upload-evidence`) and their dependencies.
- `actions/checkout@v4`, `concurrency`, `paths-ignore` block.
- `register-release` and `upload-evidence`'s DevAudit API calls — stack-agnostic.

## Step 6 — Validate against the schema

```bash
node scripts/validate-adapter.cjs sdlc/files/stacks/<name>/adapter.json
```

Should print `OK   sdlc/files/stacks/<name>/adapter.json [stack]`. If not, fix the errors before continuing — they're concrete (missing fields, regex mismatches, additional-properties violations).

Then run the full validation:

```bash
node scripts/validate-adapter.cjs --all
```

All stack + host adapters should pass.

## Step 7 — Add unit tests

`tests/unit/scripts/validate-adapter.test.ts` contains the validator test suite. If your stack introduces a new pattern that previous stacks didn't (e.g. a new `hook_framework` enum value), add a test that:

- Confirms a minimal adapter for your stack passes.
- Confirms an adapter with the new field missing fails with a clear message.

If your adapter only uses existing fields, the existing tests cover it.

## Step 8 — Dry-run sync against the real consumer

```bash
devaudit update v1.23.x <path-to-consumer>
```

The consumer must have `sdlc-config.json` with `"stack": "<name>"`. Inspect:

- `git status` in the consumer — every file the sync produced is listed.
- The generated `.github/workflows/ci.yml` — gates use your stack's commands, runtime setup is correct.
- The generated `.pre-commit-config.yaml` (or `.husky/*`) — hooks land where expected.
- `scripts/` — stack-specific helpers + universal validators are present.

Don't commit yet. Read the generated workflows top to bottom. The most common bugs at this stage are:

- Missing `{{TOKEN}}` substitutions (sync didn't know about a token your template references).
- Working-directory mismatches (gate writes output, upload-artifact looks elsewhere).
- Hardcoded paths in the template that should have come from `evidence_paths`.

## Step 9 — Open the upstream PR

Two commits in DevAudit:

1. `feat(sdlc): add <name> stack adapter` — the new `stacks/<name>/`, `ci/<name>/`, and updated validators. Validate-adapter tests pass.
2. `feat(sdlc): document <name> stack in STACK_ADAPTER.md` — add your stack to the worked-example list if it introduces patterns previous stacks lack.

PR body should answer: which consumer is this for, what was decided about the gate commands, what's deferred (if anything).

## Step 10 — Open the consumer PR

After the DevAudit PR merges, re-sync the consumer to pick up the new templates, and open the consumer-side onboarding PR. See [META-AGENT#19](https://github.com/metasession-dev/META-AGENT/pull/19) for the worked example — it's the consumer-side of adding Python.

## Common decisions and trade-offs

### Gate command exit-code semantics

Two patterns:

| Pattern   | Examples                      | Exit-0 means                                                                                              |
| --------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Hard gate | `type_check`, `test`, `build` | Every check / test / artifact succeeded                                                                   |
| Scanner   | `sast`, `dep_audit`           | The scanner ran cleanly; findings are evaluated separately against `sast_baseline` / `accepted_dep_risks` |

Don't conflate the two. If your SAST tool exits non-zero on any finding, wrap it with `|| true` and parse the output for the actual gate. Otherwise the CI gate fails before the workflow gets a chance to apply your baseline.

### Cache strategies

Each language ecosystem caches differently:

- Node: `actions/setup-node@v4` with `cache: 'npm'`, plus optional lockfile-hash skip on the install step.
- Python: `actions/setup-python@v5` with `cache: 'pip'`. Faster than nothing; doesn't skip install entirely.
- Go: `actions/setup-go@v5` with `cache: true` (caches the build cache + module cache).
- Rust: hand-rolled `actions/cache@v4` against `~/.cargo`.

Match the language's idiomatic CI pattern. Don't invent a custom strategy unless there's a measured win.

### Working-directory gotcha

If a future consumer has the dependency manifest in a subdirectory (monorepo / multi-service), they'll set `working_directory` in `sdlc-config.json`. The Python template (currently) supports this by adding `defaults.run.working-directory: {{WORKING_DIRECTORY}}` to the quality-gates job and `{{WORKING_DIR_PREFIX}}` to upload-artifact paths.

When authoring a new stack's `ci.yml.template`, plumb the same two tokens through. The Python template is the canonical pattern.

## See also

- [STACK_ADAPTER.md](../sdlc/STACK_ADAPTER.md) — the contract every adapter must satisfy.
- [ADR-001](./ADR/ADR-001-polyglot-sdlc-architecture.md) — why the framework is layered this way.
- [adding-a-host.md](./adding-a-host.md) — sibling walkthrough for host adapters.
- [sdlc/files/stacks/node/adapter.json](../sdlc/files/stacks/node/adapter.json) and [sdlc/files/stacks/python/adapter.json](../sdlc/files/stacks/python/adapter.json) — current worked examples.
