# `devaudit push`

Upload an evidence file to a DevAudit project/release. This is the CLI port of `scripts/upload-evidence.sh` — the same call CI's generated workflows make on every push, and what `sdlc-implementer` and the E2E skills invoke under the hood to record test executions, gate results, and other evidence. Most operators never call it directly; this reference is for anyone writing a custom CI step, debugging a generated workflow, or scripting evidence upload outside the standard templates.

## Usage

```bash
devaudit push <project-slug> <requirement-id> <evidence-type> <file> [options]
```

The four positional arguments are always required:

| Argument | Meaning |
| --- | --- |
| `project-slug` | The DevAudit project this evidence belongs to. |
| `requirement-id` | The `REQ-XXX` (or release version) this evidence is attributed to. |
| `evidence-type` | What kind of evidence this is (e.g. `test_report`, `screenshot`, `incident_report`, `sast_report` — see [`docs/evidence-tiers.md`](evidence-tiers.md) for the full model). |
| `file` | Path to the file being uploaded. |

## Options

### Release context

| Flag | What it does |
| --- | --- |
| `--release <version>` | Release version (e.g. `v1.0.0`) this evidence attaches to. |
| `--create-release-if-missing` | Auto-create the release as `draft` if it doesn't already exist on the portal. |
| `--environment <env>` | `uat` \| `production`. |
| `--branch <name>` | Git branch — sent as both `releaseBranch` and `metadata.branch`. |
| `--change-type <type>` | Conventional-commit prefix for the release row (`changeType`) — `feat`/`fix`/`chore`/etc. |
| `--release-title <text>` | Human title for the release row (`releaseTitle`). The portal never clobbers a title it already has. |
| `--release-summary <text>` | Reviewer-facing short description (`releaseSummary`). Same no-clobber behavior. |

### CI/gate metadata

| Flag | What it does |
| --- | --- |
| `--category <cat>` | One of `ci_pipeline` \| `local_dev` \| `planning` \| `test_report` \| `security_scan` \| `release_artifact`. |
| `--git-sha <sha>` | Attached to `metadata.gitSha`. |
| `--ci-run-id <id>` | Attached to `metadata.ciRunId`. |
| `--gate-status <status>` | `passed` \| `failed` \| `skipped` (`gateStatus`). |
| `--sdlc-stage <stage>` | SDLC stage `1`-`5` (`sdlcStage`) — which stage of the framework this evidence belongs to. |

### Test-execution linking

| Flag | What it does |
| --- | --- |
| `--test-execution <id>` | Test execution identifier — typically the CI run ID. Threads this upload into the [release-lineage test-execution model](release-lineage-and-test-execution-audit-model.md). |
| `--evidence-scope <scope>` | `release` \| `stage` \| `execution` \| `approval` (`evidenceScope`) — what level this evidence is scoped to. |
| `--test-execution-record-id <id>` | The first-class portal test-execution UUID. Requires `--evidence-scope execution`. |

### Free-form metadata

| Flag | What it does |
| --- | --- |
| `--meta-key <pair>` | Repeatable `key=value`, merged into the uploaded metadata JSON. Pass multiple times for multiple keys — `--meta-key origin=feature --meta-key attempt=2`. |

### Auth/connection overrides

| Flag | What it does |
| --- | --- |
| `--base-url <url>` | Override the portal URL. Defaults to `DEVAUDIT_BASE_URL` env or production. |
| `--api-key <key>` | Override the `DEVAUDIT_API_KEY` env var for this one call. |

## Example

```bash
devaudit push acme REQ-108 test_report ./playwright-report.zip \
  --release v2026.09.28 \
  --environment uat \
  --sdlc-stage 2 \
  --git-sha "$(git rev-parse HEAD)" \
  --ci-run-id "$GITHUB_RUN_ID" \
  --branch develop \
  --meta-key origin=feature
```

## See also

- [`docs/evidence-tiers.md`](evidence-tiers.md) — the Tier 1/2/3 evidence model and which `evidence-type` values exist.
- [`docs/release-lineage-and-test-execution-audit-model.md`](release-lineage-and-test-execution-audit-model.md) — the test-execution linking model `--test-execution`/`--evidence-scope`/`--test-execution-record-id` feed into.
- `scripts/upload-evidence.sh` — the shell equivalent this command ports; generated CI workflows call one or the other depending on template age.
