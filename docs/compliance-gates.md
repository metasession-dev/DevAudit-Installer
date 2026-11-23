# Compliance Gates

DevAudit uses multiple GitHub Actions workflows to prove that a release is ready for review and, later, production. This page is the concise map of which workflow owns which gate.

The process view lives in [`docs/change-workflows.md`](./change-workflows.md). The deeper artifact rules live in [`docs/evidence-tiers.md`](./evidence-tiers.md) and the stage docs under `sdlc/files/_common/`.

## The gate model

Tracked releases and standalone housekeeping releases both rely on the same core verification shape:

1. run quality gates on `develop`
2. register the release record
3. upload evidence tied to that release
4. block PR merge until UAT approval exists
5. run production smoke after merge to `main`

## Workflow-to-gate mapping

| Workflow | When it runs | What it owns | Evidence/gate outcome |
| --- | --- | --- | --- |
| `ci.yml` | Push to `develop` | Quality verification: typecheck, SAST, dependency audit, E2E, build; release registration | Produces the raw CI/gate evidence that a reviewer later sees on the release |
| `compliance-evidence.yml` | Compliance-doc pushes and release-ticket updates on `develop` | Uploads committed markdown evidence and release-scoped docs | Fills the release completeness checklist with planning, test, governance, and release artifacts |
| `compliance-validation.yml` | PRs to `main` | PR-time validation of artifact presence, commit rules, and release truthfulness | Blocks merge when the evidence pack or commit contract is incomplete |
| `check-release-approval.yml` | PRs to `main` and reruns after portal approval | Reads portal approval state | Links the PR to the release (so the portal shows `pr_url` while still draft), then enforces the UAT approval gate before merge (the approver is a different person under `approval.mode: dual_actor`; under `solo_with_gap` the author's approval is a recorded gap) |
| `post-deploy-prod.yml` | After merge to `main` | Production smoke, production evidence upload, incident creation on smoke failure | Advances the release into production review/released and records post-deploy proof |
| `devaudit-delivery.yml` | A `repository_dispatch` event of type `devaudit-delivery` from the portal; only while `delivery.enabled` is true | Runs a headless `sdlc-implementer` session on one issue, under the `delivery-agent` portal key and git author, up to "awaiting approval"; reports each phase to the portal | Produces no gate evidence of its own: the release it opens goes through every gate above, and a person approves it. See [`delivery-runs.md`](./delivery-runs.md) |

## What reviewers should expect

### On `develop`

- the quality gates should be green before evidence compilation is treated as truthful
- the release record should exist in the portal
- CI-origin evidence should already be attached to that release

### On the PR to `main`

- `Compliance Validation` should confirm the change matches the declared workflow shape. For each in-flight REQ in the range it also fails on two Stage 3 gaps (`validate-compliance-artifacts.sh`):
  - `ERROR: Operator sign-off pending` — an `## Operator sign-off` block in `compliance/evidence/REQ-XXX/` has an unanswered `- [ ]` box or a missing or placeholder Reviewer or Date. Clear it with the one-reply sign-off step of `sdlc-implementer` (Phase 3 step 5d), or by signing the files; `scripts/check-operator-signoffs.sh REQ-XXX` lists what is pending. A check that cannot run is also an error.
  - `ERROR: UAT pack incomplete` / `still has REPLACE markers` / `has no step or not-testable row for: ACn` — the human UAT pack is required by `uat.human_pack` (`risk`, the default: MEDIUM risk and above) and `uat-briefing.md` or `uat-test-procedure.md` is missing, unfinished, or leaves an AC out. Write it with `sdlc-implementer` Phase 3 step 3c, or set `devaudit configure set uat.human_pack never` if the project does not need it. With `risk` and no Risk value in the RTM, the validator warns instead.
  - `ERROR: uat-execution-record.md front matter execution_mode is "…"` / `is agent_executed but executed_by does not name the agent` / `names evidence files that are not in compliance/evidence/REQ-XXX/uat/` — the record's front matter (#1246) has an unknown mode, an agent-executed run without the agent named, or an evidence file the record names is not committed under `uat/`. A record with no front matter is read as manual, and `WARNING: uat.mode is …` flags an unknown setting (read as manual). A `REPLACE` inside an HTML comment, such as a template's header comment, is not a marker (#1251).
  - A REQ that is already released, superseded or abandoned (RTM status, or its ticket in `approved-releases/` or `superseded-releases/`) is not checked for either, so the close-out commit of an earlier release does not block the next one. `devaudit doctor` (`stage3-evidence`) reports both gaps before the release PR does.
- `Release Scope Integrity` should fail if a deferred REQ's commits are in the diff and it is not listed under `Absorbed predecessor releases` (`check-deferred-reqs-in-range.sh`)
- `Release Scope Integrity` should fail on the develop-to-main PR of a declared bundle when its pending `BUNDLED-CHANGES-<REQ>.json` omits commits in `origin/<release>..HEAD`, for example a chore merged after the manifest was generated (`generate-bundled-changes.sh --check`, #1288). The log names each missing commit and the command that regenerates the manifest. A commit that touches only bundle manifests is the manifest's own regeneration and is not counted
- `DevAudit Release Approval` should stay red until the portal release is approved for UAT (a portal `deferred` release gets a specific message and stays red)
- once UAT approval is granted, rerunning the approval workflow should turn the gate green

#### `DevAudit Release Approval` re-dispatch/check-run lifecycle (devaudit-installer#788)

The portal's `release-approved` `repository_dispatch` re-triggers `check-release-approval.yml`, but `repository_dispatch` events carry no native pull-request context. GitHub's Feb-2025 check-run API changes (DevAudit-Installer#351) also forbid this re-trigger from PATCHing the *original* `pull_request`-triggered failed check run directly — so the workflow instead **posts a fresh `success` check run** on the approved SHA, then explicitly **concludes every other `DevAudit Release Approval` check run on that same SHA as `conclusion: neutral`** ("Superseded by a later approval check…") rather than leaving the pre-approval failed/pending one dangling. Concluding the stale run is best-effort — if it can't be patched for some reason, a `::warning::` annotation is logged and the fresh check run (already posted) remains authoritative regardless.

**PR resolution when `client_payload` is incomplete:** the workflow resolves which PR/SHA to refresh from `client_payload.approved_sha`/`client_payload.release_pr` when present. If both are missing or unresolvable, it falls back to "the most-recently-updated open PR against `main`" — a heuristic that could target the wrong PR if two release PRs are open against `main` concurrently. This fallback now emits a visible `::error::` annotation on the workflow run when it's used, rather than guessing silently.

### After merge to `main`

- the post-deploy workflow should upload production smoke evidence
- the release should advance into production review or released, depending on project configuration

## Gate families by concern

| Concern | Gate owner |
| --- | --- |
| Static/code quality | `ci.yml` |
| Security and dependency posture | `ci.yml` |
| Test execution and CI traceability | `ci.yml` |
| Markdown/governance/release-ticket evidence | `compliance-evidence.yml` |
| PR truthfulness and artifact completeness | `compliance-validation.yml` |
| UAT approval (four-eyes under `dual_actor`) | `check-release-approval.yml` |
| Required-gate failure on the release PR (fix or documented exception, E2E first) | `sdlc-implementer` Phase 4 step 5a, `report-test-execution.sh resolve`, `validate-risk-acceptance-record.sh`, `validate-test-summary.sh` (see [e2e-test-tiers.md](e2e-test-tiers.md#when-a-tier-fails-fix-or-accept-devaudit-installer1016)) |
| Dependency-audit failure on the release PR (bump, or accept with an expiring documented risk) | `evaluate-npm-audit.sh` against `compliance/security/accepted-vulnerabilities.json` (`schemaVersion` 2 + `acceptanceRecord`), `validate-risk-acceptance-record.sh --kind dependency`, `sdlc-implementer` Phase 4 (see [Dependency-audit exceptions](#dependency-audit-exceptions-devaudit-installer1017)) |
| Deferred-REQ promotion gate (a deferred REQ's commits must not reach `main` unless listed under `Absorbed predecessor releases`) | `check-deferred-reqs-in-range.sh`, run by `check-release-pr-scope.sh` inside the existing Release Scope Integrity job (not a separate required check) |
| Production health and release close-out | `post-deploy-prod.yml` |

## See also

- [`docs/change-workflows.md`](./change-workflows.md)
- [`docs/evidence-tiers.md`](./evidence-tiers.md)
- [`docs/e2e-test-tiers.md`](./e2e-test-tiers.md)
- [`sdlc/src/blueprints/3-compile-evidence.raw.md`](../sdlc/src/blueprints/3-compile-evidence.raw.md)

## Dependency-audit exceptions (devaudit-installer#1017)

The `Quality Gates` dependency audit fails on any unaccepted `high`/`critical` advisory, including ones disclosed after the last push with no code change. A failing audit on a release PR is **fixed** (a dependency bump) or **accepted with a documented, expiring risk**; there is no silent allowlist.

`evaluate-npm-audit.sh` reads `compliance/security/accepted-vulnerabilities.json`. Each entry accepts one advisory at one dependency path and version (`advisoryId`, `package`, `vulnerableRange`, `vulnerableVersion`, `dependencyPath`, `introducedBy`, `approvedAt`, `expiresAt`, `approvedBy`, `reason`, `remediationIssue`, optional `compensatingControls`). It fails closed: a malformed file, an unmatched advisory, or an expired entry fails the gate again.

`"schemaVersion": 2` (new exceptions should use it) also requires `acceptanceRecord`: the repo-root-relative path of `compliance/security/risk-acceptances/<advisory>.md`, written from `.claude/skills/sdlc-implementer/references/dependency-risk-acceptance.md.template`. The helper runs `validate-risk-acceptance-record.sh --kind dependency` on it (advisories, reachability and exploitability, impact assessment, compensating controls, remediation, decision-maker, a future `review_by`, an exact `tracking_issue` URL), checks that it lists the advisory and that its `tracking_issue` equals `remediationIssue`, and records the path and SHA-256 in `dependency-risk-evaluation.json`. `schemaVersion` 1 entries still work and produce a warning.

The tracking issue carries the label `accepted-dependency-risk` and `Review by: YYYY-MM-DD` in its body. `devaudit doctor` (`accepted-exceptions`) flags exceptions expiring within 14 days or already expired, and labelled issues past their review date. Records upload as evidence type `accepted_dependency_risk`. The Python template's `pip-audit` step has no allowlist yet (parity is tracked with #995).

## Docs-only pull requests (#1290)

By default every pull request into the integration branch runs the full `Quality Gates`, including one that changes only evidence and docs (`paths_ignore`: `compliance/**`, `*.md`, ...). Evidence pull requests are frequent (every REQ opens several), so on a shared runner the cost repeats. `paths_ignore_pull_request: true` (`devaudit configure set paths_ignore_pull_request true`, then `devaudit update`) applies the same list to the `pull_request` trigger:

- `ci.yml` does not start for a pull request that changes only ignored paths (and `sdlc-config.json`). A pull request with any other file runs everything.
- `ci-status-fallback.yml` starts for a pull request that changes any ignored path, lists the pull request's files (read-only) and classifies them with the same glob rules as the release-PR provenance check. Its `Quality Gates` job is **named** from the answer: `Quality Gates` when every file is ignored, another name when any is not. A pull request with code therefore never carries a second check named `Quality Gates`, and cannot be satisfied by it before the real gates finish.
- If the file list cannot be read, the fallback fails and reports no status: the pull request waits, it never passes on a guess.
- The release PR into the release branch is unchanged: `quality-gates-provenance.yml` still requires a real `ci.yml` `Quality Gates` success on the latest code-bearing commit, and the fallback's status never counts for it (#971). The compliance validators run in `compliance-validation.yml`, not inside `Quality Gates`, so a docs-only pull request loses none of them.

It is off by default. The "Authenticated E2E (report-only)" step that runs on every pull request is not changed by this setting.

## Evidence upload limits and refusals (devaudit-installer#1271, #1275)

The portal takes a file by multipart POST up to 25 MB (26,214,400 bytes). A larger file goes through the presigned flow (`upload-url`, a PUT to storage, `upload-complete`). `scripts/upload-evidence.sh` and the CLI's uploader behave the same way:

- **No fallback above 25 MB.** If the portal answers a presign request without a URL for a file above 25 MB, the file fails with the first 500 characters of the answer and a hint to check that `DEVAUDIT_BASE_URL` answers JSON. A multipart POST of that file could only end in HTTP 413. Within 25 MB the multipart POST is still the fallback.
- **`file_too_large`.** The portal answers HTTP 413 `{ code: "file_too_large", maxBytes }` when the file is over its cap. The upload is not retried and does not fall back; the log says `report is <n> bytes, portal cap is <maxBytes> bytes`. Trim the Playwright report (the default zip already leaves out traces and videos, see `e2e_report_include_traces` in [configure.md](configure.md)) or split the file.
- **`presign_unavailable`.** The portal answers HTTP 501 `{ code: "presign_unavailable" }` when storage cannot presign. It is not retried. A file within 25 MB goes multipart instead; a larger file fails with the portal's reason.
- **429 and other 5xx** are still retried with backoff.
- **The Playwright HTML report is not a gate.** In the CI Pipeline evidence job, a failed upload of `playwright-report.zip` is a warning when `e2e-results.json` exists, because the results file is the evidence the gate reads. A failed upload of any other file still fails the job.

## Evidence attribution: documentation-only PRs (devaudit-installer#1019)

A PR that changes only documentation or compliance records is not the release's own work, so CI does not attach its test executions, head SHA or branch to the REQ named in its commits. The mechanism and the `Compliance-Record: REQ-XXX` trailer are described in [release-lineage-producer-contract.md](release-lineage-producer-contract.md#which-pull-requests-may-produce-a-release-scoped-execution-devaudit-installer1019).
