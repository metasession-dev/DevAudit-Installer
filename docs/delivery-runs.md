# DevAudit Delivery runs

A **delivery run** is one GitHub issue implemented by an agent with no person in the loop, up to the point where a person must approve. The DevAudit portal starts it; the repository's own workflow runs it; the usual gates and a human approval decide whether it ships. This page is the installer's side of that contract: the workflow, the headless rules of the `sdlc-implementer` skill, the events the agent sends, and the identity it works under. The portal side (spec intake, run orchestration, the events route) is specified in `metasession-dev/devaudit`.

Delivery is an opt-in. A repository that does not run `devaudit install --delivery` (or `devaudit configure set delivery.enabled true`) has none of this: no workflow, no prompt file, no extra key, no extra doctor check.

## Setting a repository up

```bash
export DEVAUDIT_USER_TOKEN="mctok_…"
export DEVAUDIT_AGENT_API_KEY="…"      # what the headless Claude Code session authenticates with
devaudit install --yes --compliance regulated --delivery
```

`--compliance <none|light|regulated>` chooses the preset (A, B or C; see [`presets.md`](./presets.md#compliance-modes)). `--delivery`:

1. records `delivery.enabled: true`, `delivery.max_turns` (200) and `delivery.max_minutes` (90) in `sdlc-config.json`; change the limits with `devaudit configure set delivery.max_turns <10-1000>` and `delivery.max_minutes <10-360>`;
2. issues a **second** portal key named `delivery-agent` (role `uploader`, the lowest that can register a release and upload evidence), reusing a live one on a rerun;
3. stores the repository secrets `DEVAUDIT_AGENT_PORTAL_KEY` (that key) and `DEVAUDIT_AGENT_API_KEY` (from the environment), and `DEVAUDIT_AGENT_GITHUB_TOKEN` when the environment has one;
4. through the normal sync, generates `.github/workflows/devaudit-delivery.yml` and `.devaudit/delivery-prompt.md`.

A GitHub repository runs a `repository_dispatch` workflow from its **default branch**, so the generated workflow must be merged and released to `main` before the portal can start a run. A push or pull request made with the default `GITHUB_TOKEN` starts no workflow, so the release's own CI would not run; give the agent a token that can with `DEVAUDIT_AGENT_GITHUB_TOKEN` (a fine-grained token with Contents and Pull requests read/write). Without it the workflow falls back to the default token, and `devaudit doctor` does not know the difference.

`devaudit doctor` reports a `delivery-workflow` check while `delivery.enabled` is true: the workflow and prompt exist, both secrets are set, and the Claude Code version in the workflow is the one this CLI generates.

## The run

```text
portal ── repository_dispatch (devaudit-delivery, runId, issueNumber) ──► devaudit-delivery.yml
workflow: check payload and secrets → checkout develop → install pinned Claude Code and CLI
          → report running → claude -p (sdlc-implementer, headless rules) → report end of run
skill:    triage (tracked only) → plan → implement → evidence → push to develop (CI registers the release)
          → report running --release → release PR + UAT request → report awaiting_approval → exit 0
human:    approves the release in the portal (the approver is not the agent)
gates:    merge, deploy, post-deploy, finalisation (the existing workflows)
portal:   marks the run succeeded from the release finalisation
```

The workflow runs one delivery per repository at a time (`concurrency: delivery-<repository>`, never cancelling a run in progress); the portal enforces the organisation-wide cap. The job's `timeout-minutes` is `delivery.max_minutes`, and the session gets `--max-turns delivery.max_turns`. The agent session runs with `--dangerously-skip-permissions` on the ephemeral runner, because nobody can answer a permission prompt; what it must never do is written in the skill's headless rules, and the workflow's token has no administration rights.

## Events

`devaudit delivery report` posts one event with the agent's portal key (`DEVAUDIT_AGENT_PORTAL_KEY`, else `DEVAUDIT_API_KEY`):

```text
POST <portal>/api/ci/delivery-runs/<runId>/events
{ "phase": "running | awaiting_approval | succeeded | failed",
  "reason": "<text, with failed>",
  "releaseId": "<portal release id, with running>",
  "usage": { "inputTokens": 0, "outputTokens": 0, "ciSeconds": 0 } }
```

| Phase | Sent by | When |
| --- | --- | --- |
| `running` | the workflow, then the skill | the workflow when the job starts; the skill again, with `--release`, as soon as CI has registered the release |
| `awaiting_approval` | the skill; the workflow's closing step repeats it with the usage | the release PR is open and UAT is requested |
| `failed` | the skill, or the workflow's closing step | the issue is not tracked work, the spec is too large, or the session ended unsuccessfully |
| `succeeded` | the portal, from the release finalisation | never the agent |

The portal must accept a repeated phase (the closing step sends `awaiting_approval` or `failed` again with the usage) and never move a run backwards. On the agent's machine a run that already reported `failed` stays failed: a later `awaiting_approval` is sent as `failed` with the recorded reason, and a `failed` with no reason reuses it.

`--cost-file` takes the JSON the headless session wrote (`claude -p --output-format json`): `inputTokens` is `input_tokens` plus the cache creation and cache read tokens, `outputTokens` is `output_tokens`; a missing or unreadable file is a warning, never a failure. `--ci-seconds` is `$SECONDS` of the workflow job.

Exit codes of `devaudit delivery report`: `0` the portal accepted the event, `1` it did not (the answer is printed; a 429 or 5xx is retried three times first), `2` a usage error (a bad run id or phase, a bad number, no portal key).

## The headless rules

The `sdlc-implementer` skill applies its "Headless (delivery run) rules" when the prompt says `This is DevAudit delivery run <id>` or the issue body carries a `DevAudit-Run: <id>` line. In short: tracked work only (anything else reports `failed`, "not a tracked change"); a spec that needs splitting reports `failed`, "spec too large"; every question is answered by the issue body, else recorded under "Assumptions (headless)" in the implementation plan; the run stops at `awaiting_approval` and exits 0; it never force-pushes, edits branch protection, touches a secret, or approves or merges; it applies the issue's `Compliance mode:` with `devaudit configure --preset <X> --yes` as the first commit when that differs from `onboarding_preset`; every commit carries `Co-Authored-By:` and `DevAudit-Run: <id>`.

## Who did what

The agent works under its own portal key and git author (`DevAudit Agent <agent@devaudit.app>`; the address is to be confirmed by the product owner), so the release it registers names the agent as creator and submitter, and the client's admin who approves is independent of both. Under presets C and D that evidences `SOC2.CC8.1` and `ISO27001.A.8.32` without a second human developer in the organisation. The gates keep using `DEVAUDIT_API_KEY`; no other generated workflow reads `DEVAUDIT_AGENT_PORTAL_KEY`.
