# Playbook: housekeeping release

Use this path only for `docs`, `chore`, `ci`, `build`, `test`, `compliance`, or
`revert` work with no material runtime, user-visible, authentication, data,
deployment-risk, or product behavior change. If it has any of those effects,
reclassify it as a tracked `REQ-XXX` change or, where production is impaired,
a real hotfix.

## Default: lightweight integration work

The default housekeeping path is deliberately lightweight:

```text
housekeeping feature branch -> PR to integration -> terminal-green CI + review
-> merge to integration -> wait for the next tracked release
```

There is no REQ, RTM row, tracked evidence pack, portal UAT/production approval,
or standalone close-out. The merge is complete after review and terminal-green
checks on the current PR head SHA.

A push may create a bare-date row such as `vYYYY.MM.DD`. This is integration
CI/history, not an active full release or pending reviewer task. The next
tracked release absorbs the work and must describe it using the bundled-release
contract in [README](./README.md): the bundle markdown and JSON, submitted
manifest, and context in the ticket, test-execution summary, security summary,
and AI-use note where applicable.

`devaudit update` template refreshes use `[skip ci]` where configured. They do
not create a portal release; their change is still included in the next tracked
release's bundled context and validated by that release's gate evidence.

### Agent path

Run:

```text
Implement issue #N under the SDLC.
```

`sdlc-implementer` must announce the Lightweight path, create a housekeeping
branch from the integration branch, run applicable local gates, open a PR to
integration, and stop only after review and terminal-green CI permit merge. It
must halt and reclassify if the diff reveals material behavior.

### Manual path

```bash
git switch "$INTEGRATION_BRANCH"
git pull --ff-only origin "$INTEGRATION_BRANCH"
git switch -c chore/short-description

# Make the one-purpose change and run applicable local gates.
git add <files>
git commit -m "chore: short description"
git push -u origin HEAD
gh pr create --base "$INTEGRATION_BRANCH" --fill
gh pr checks <PR> --watch
```

Merge only after the reviewer approves and all required checks are terminal
green for the current PR head SHA. Never use a direct push to integration.

## Exception: standalone housekeeping promotion

Promote housekeeping work independently only when it cannot reasonably wait for
the next tracked release, for example a CI/deploy repair, dependency or
security maintenance, launch/content/config correction, or another operational
fix that remains genuinely housekeeping.

The release PR must explicitly declare `Standalone housekeeping promotion` and
include why it cannot wait. It still follows:

```text
feature branch -> PR to integration -> green + review -> merge
integration -> standalone PR to release -> terminal-green + review -> merge
```

Default policy is PR review and green CI only; portal UAT and production
approval are not required unless the project explicitly opts in. The standalone
record must be labelled as standalone housekeeping in the portal and closed as
an approved housekeeping record, so it cannot later be bundled by mistake. If
the current installed workflow cannot implement that declaration and policy,
do not promote it: use the normal wait-for-REQ path until the workflow template
has been updated.

Before opening the release PR, add the reviewed declaration at:

`compliance/standalone-housekeeping/STANDALONE-HOUSEKEEPING-vYYYY.MM.DD.json`

```json
{
  "schemaVersion": 1,
  "version": "vYYYY.MM.DD",
  "releaseMode": "standalone_housekeeping",
  "reason": "Explain why this production-safe housekeeping change cannot wait for the next tracked REQ release."
}
```

The release-scope check requires both the declaration and the literal PR marker.
After host deployment and production smoke pass, the post-deploy workflow uploads
this declaration as release-ticket evidence, sets the portal release mode to
`standalone_housekeeping`, and marks it released without placing it in the normal
UAT/production approval queue.

## Hotfixes and reversions

Only production-impacting urgency uses `hotfix/*` from the release branch. Open
a reviewed PR to the release branch, wait for terminal-green checks, merge, then
open and merge the mandatory `backmerge/*` PR into integration. A production
revert is the same controlled hotfix path, not a direct push to `main`.

## Reviewer and auditor view

Reviewers should see ordinary housekeeping only as historical/integration
context. In the later tracked release, they should see exactly what was absorbed
and which source executions cover it. Auditors should be able to follow the linked
predecessor, source evidence, and final approval envelope without interpreting
the historical row as abandoned work.
