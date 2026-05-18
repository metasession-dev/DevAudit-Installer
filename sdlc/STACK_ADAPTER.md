# Stack adapter contract

A stack adapter teaches the Metasession SDLC how to run quality gates and place hooks for one language / package-manager combination — `node`, `python`, `go`, `rust`, etc. Each adapter is a single directory under `sdlc/files/stacks/` containing:

```
sdlc/files/stacks/<name>/
├── adapter.json          ← the manifest (validated against the schema)
├── hooks/                ← git-hook files placed in consumers
└── scripts/              ← stack-specific helper scripts
```

The manifest is the contract. The directory contents are referenced from the manifest by filename.

The schema lives at [`sdlc/files/stacks/_schema/adapter.schema.json`](./files/stacks/_schema/adapter.schema.json) (JSON Schema draft-07). The validator is `scripts/validate-adapter.cjs`; CI runs `node scripts/validate-adapter.cjs --all` on every push to `develop`.

## Required fields

### Identity

| Field           | Type                               | Purpose                                                                                             |
| --------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `name`          | string (`[a-z0-9][a-z0-9-]{0,31}`) | Identifier matching the parent directory and the `stack` key in consumer `sdlc-config.json`.        |
| `description`   | string                             | One-line human summary.                                                                             |
| `manifest_file` | string                             | The dependency manifest the consuming project carries — `package.json`, `pyproject.toml`, `go.mod`. |

### Quality-gate commands

Every adapter declares six commands. Each must be runnable from the consumer's repo root. Exit-code semantics are part of the contract — downstream evaluation code (CI workflow templates, evidence-upload script) relies on them.

> **Note (v1.23.0 transitional state).** The six commands and `evidence_paths` are declared in every adapter manifest, but `sdlc/files/ci/*.template` still has the Node values hardcoded for back-compat. Substituting these fields into the templates is Phase 4 of [#287](https://github.com/metasession-dev/devaudit/issues/287); until then, changing the values in a Node adapter has no effect on generated workflows. A new (e.g. Python) adapter will land alongside the substitution refactor so the field becomes load-bearing the moment it's first different from Node.

| Field        | Exit-0 means                 | Exit non-0 means                                                                                                   |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `install`    | dependencies fetched         | fetch failed (network, registry auth)                                                                              |
| `type_check` | 0 type errors                | at least one type error                                                                                            |
| `sast`       | scanner ran successfully     | scanner crashed; **findings don't fail this command** — they are evaluated separately against `sast_baseline`      |
| `dep_audit`  | scanner ran successfully     | scanner crashed; **findings don't fail this command** — they are evaluated separately against `accepted_dep_risks` |
| `test`       | every test passed            | at least one test failed                                                                                           |
| `build`      | deployable artifact produced | build failed                                                                                                       |

The distinction between `sast` / `dep_audit` (scanner-ran-cleanly) and `type_check` / `test` / `build` (gate-passed) is deliberate: it lets the templates report richer status — "scanner crashed" vs. "findings above baseline" — without conflating the two.

### Evidence paths

| Field                      | Type   | Purpose                                                                                         |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `evidence_paths.sast`      | string | Repo-relative path the `sast` command writes its JSON output to.                                |
| `evidence_paths.dep_audit` | string | Repo-relative path the `dep_audit` command writes its JSON output to.                           |
| `evidence_paths.test`      | string | Repo-relative path the `test` command writes its results to (JUnit XML, Playwright JSON, etc.). |

The compliance-evidence upload workflow reads these to know what to publish to DevAudit. Adapters MUST write to these exact paths; consumers MUST NOT override them in `sdlc-config.json` (an override would break evidence visibility).

### Hooks

| Field               | Type                                                    | Purpose                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hook_framework`    | enum (`husky`, `pre-commit`, `lefthook`, `cargo-husky`) | Which git-hooks framework the consumer uses.                                                                                                                                       |
| `hook_install_dir`  | string                                                  | Directory the framework manages (`.husky`, `.git/hooks`). Sync only writes hooks if the directory already exists in the consumer — projects opt in by bootstrapping the framework. |
| `hooks`             | string[]                                                | Hook filenames placed under `hook_install_dir/`. Each must exist at `sdlc/files/stacks/<name>/hooks/<filename>`.                                                                   |
| `hook_config_files` | string[]                                                | Framework config files placed at the consumer's repo root — `commitlint.config.mjs` for husky+commitlint, `.pre-commit-config.yaml` for pre-commit.                                |

### Runtime setup

| Field                  | Type                           | Purpose                                                                                                                                                              |
| ---------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime_setup.action` | string (`<owner>/<repo>@v<N>`) | GitHub Actions reference that installs the language runtime — `actions/setup-node@v4`, `actions/setup-python@v5`.                                                    |
| `runtime_setup.with`   | object                         | `with:` inputs for the action. Token substitution applies — e.g. `{ "node-version": "{{NODE_VERSION}}" }` pulls `node_version` from `sdlc-config.json` at sync time. |

## Optional fields

| Field                       | Type     | Purpose                                                                                                                                 |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `stack_scripts`             | string[] | Stack-specific helpers copied to the consumer's `scripts/` directory. Each must exist at `sdlc/files/stacks/<name>/scripts/<filename>`. |
| `required_dev_dependencies` | string[] | Dev-time deps the adapter expects to be present. Sync may auto-install or warn.                                                         |
| `config_keys.required`      | string[] | `sdlc-config.json` keys this stack consumes. Sync refuses if a required key is missing.                                                 |
| `config_keys.defaults`      | object   | Fallback values for keys that may be omitted from `sdlc-config.json`.                                                                   |

## Consumer config: `working_directory`

For projects where the stack's dependency manifest (e.g. `pyproject.toml`, `package.json`) lives in a subdirectory rather than at the repo root, set `working_directory` in `sdlc-config.json`:

```json
{
  "stack": "python",
  "working_directory": "mission-control-api",
  "source_dirs": "src/ tests/",
  ...
}
```

Behaviour when set:

- The Python `ci.yml` template's `quality-gates` job applies `defaults.run.working-directory: <value>` so every `run:` step starts there. `pip install -e ".[dev]"`, `pytest`, `pip-audit`, `python -m build` all resolve correctly.
- `source_dirs` becomes relative to `working_directory` (e.g. `src/ tests/` resolves to `mission-control-api/src/ mission-control-api/tests/` on disk; ruff/mypy/semgrep see the right files).
- `actions/upload-artifact` paths are workspace-rooted by GHA design and are auto-prefixed with `working_directory/` so the uploaded paths match where the gate steps wrote them.
- The downstream `upload-evidence` job downloads with `path: .` (workspace root) so file paths round-trip identically.

Default: `"."` (repo root). Omitting the field is equivalent to setting `"."` — no behavioural change for projects with root-level manifests.

Currently honoured by: **Python `ci.yml` template** (Phase 4 onwards). The Node `ci.yml` template doesn't substitute these tokens yet — Node consumers don't typically need it. Symmetric Node support can be added when a Node monorepo first needs it.

## Adding a new stack

See the step-by-step walkthrough: **[docs/adding-a-stack.md](../docs/adding-a-stack.md)** — uses the Python adapter as the worked example. The high-level shape is:

1. **Create the directory** `sdlc/files/stacks/<name>/` (`<name>` must satisfy the regex above).
2. **Author `adapter.json`** with every required field. Use `stacks/node/adapter.json` or `stacks/python/adapter.json` as a worked example.
3. **Add hooks and scripts** referenced from the manifest. The validator does not check their existence yet; the sync script will fail at the consumer end if a referenced file is missing.
4. **Author the per-stack `ci.yml.template`** at `sdlc/files/ci/<name>/ci.yml.template`. Stack-agnostic workflows (compliance-validation, check-release-approval, post-deploy-prod, compliance-evidence, ci-status-fallback) are shared at `sdlc/files/ci/` — no per-stack override needed for those.
5. **Run the validator:** `node scripts/validate-adapter.cjs sdlc/files/stacks/<name>/adapter.json`. Fix any errors before opening a PR.
6. **First consumer**: validate the adapter against at least one real project before merging. The Python adapter (Phase 4 of #287) was validated against META-AGENT, not against a fresh skeleton.

## Evolution

This contract is not frozen. If a new stack discovers a missing field — say, a separate `lint` command — open a PR that:

1. Adds the field to the schema (`additionalProperties: false` means new fields must be schema-declared first).
2. Updates this document.
3. Adds the field to every existing adapter (default values where reasonable).
4. Updates the validator and its unit tests.

Backward-incompatible changes (renaming or removing a required field) need a v1.24.0-level version bump and a migration note for consumers.

## Why JSON Schema (not Zod, not a TypeScript interface)

- **Tooling.** Every IDE that speaks JSON Schema (which is every modern one) gets autocomplete and inline validation as you edit an adapter manifest.
- **Language-neutral.** A future Python-only consumer can validate the same schema with `jsonschema` without pulling in Node.
- **Stable artifact.** `adapter.schema.json` is a versioned file in the repo. A TypeScript type is implementation detail.

The validator currently uses `ajv` (already a transitive dep), but the schema would be re-usable from any JSON-Schema-aware tool.
