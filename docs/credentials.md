# Credentials: who holds what

Current reference for the four credentials DevAudit uses and where each one lives. If a historical article disagrees, this page wins.

| Credential | Held by | Stored | Used for |
| --- | --- | --- | --- |
| **Uploader key** `DEVAUDIT_API_KEY` | CI only. No person or agent holds it. | GitHub repo secret (`devaudit.api_key_secret`, default `DEVAUDIT_API_KEY`) | Every write in CI: release creation, evidence, test executions, checks, close-out. |
| **Viewer key** `DEVAUDIT_VIEWER_API_KEY` | Each person, their own **named** key. Never expires. | CLI config folder (`~/.config/devaudit/viewer-keys.json`), never the repo, never a repo secret | Reading portal state, by people and agents, through `devaudit` commands. |
| **Personal access token (PAT)** | Each person. **Agents never use it.** | `devaudit auth login` cache (`~/.config/devaudit/auth.json`) or `DEVAUDIT_USER_TOKEN` | Human-run CLI actions: `install` / `join`, issuing your own viewer key, defer / resume (`doctor --fix`), `doctor --fleet`. |
| **Portal login (session)** | People | Browser | Record UAT, submit for UAT review, approve / reject, Mark as Released, resolve a failed execution (project admins). |

The portal enforces the split: every `/api/ci/*` route accepts API keys only, and a PAT is accepted only on `/api/projects`, `/api/projects/{id}/api-keys` and `/api/releases/{id}/submit-review`. The other release actions are session-only today, and a PAT sent to one of them is redirected to the HTML sign-in page rather than answered with 401 (the CLI reports that as "this portal route does not accept a personal access token; use the portal UI").

## Keeping agent sessions away from the PAT (recommended)

The skill text, the interactive-only `doctor --fix` and the `doctor` warning are the first three layers. The fourth, recommended and not required, is a set of agent permission rules that refuse the PAT commands and reads of this credential folder even if a skill is ignored or a prompt is injected: [`agent-permissions.md`](./agent-permissions.md) has the copy-paste Claude Code rules (tested on a real agent), what the other agents document, and the limits. It is defence in depth, not a sandbox; `devaudit agent-permissions apply` adds them to your agent settings after a confirmation (user scope by default, with a backup), `install`, `join` and `update` offer it once, and `devaudit doctor` reports whether they are present and names that command.

## Who does what, step by step

Reproduced from Phase 0 of the `sdlc-implementer` skill, which holds the canonical copy.

| Step | Who does it |
| --- | --- |
| Create the portal release (Phase 1) | CI: the first feature-PR E2E run (`feature-e2e.yml`), or the first push to the integration branch (`ci.yml` register-release) |
| Upload evidence (Phase 3) | CI: `Compliance Evidence Upload` on the compliance commit |
| Read portal state; check readiness (Phases 3-5) | Agent, with the viewer key: `devaudit release status`, `devaudit release check` |
| Submit for UAT review; record UAT; approve or request changes (Phase 4) | A person, in the portal UI under their own login |
| Resolve a failed test execution (Phases 4-5) | A project admin, in the portal UI (pending metasession-dev/devaudit#918) |
| Report test executions; reconcile the deployment (Phase 5) | CI |
| Approve Production; Mark as Released (Phase 5) | A person, in the portal UI |
| Close-out PR (Phase 5) | CI opens it; reviewed and merged as Phase 5 says |
| Defer or resume a release | A person: `devaudit doctor --fix` (their PAT, at a terminal) or the portal UI. Never the agent |
| Install, join, issue a viewer key | A person, with their PAT |

## The viewer key

A viewer key is read-only and personal: one key per person, per project, per machine, named `viewer:<your email>:<hostname>` (the email is `git config user.email`). The portal records the creator.

- **Issued by default** by `devaudit install` and `devaudit join`, with your own PAT, and saved to `viewer-keys.json` (mode `0600`, written atomically). Opt out with `--no-viewer-key`. The value is printed only with `--print-viewer-key`. `--with-viewer-key` is a deprecated no-op.
- **Not a repo secret.** No CI workflow reads a viewer key, so `install` no longer writes one and no longer adds `viewer_api_key_secret` to `sdlc-config.json`. An existing value is read without error and `devaudit doctor` reports its repo secret as unused and removable.
- **If the portal refuses** to issue it, `join` prints the portal's own reason and carries on. Since metasession-dev/devaudit#921 any member may issue their own viewer key, so a 403 means the five-active-key cap (revoke one in the portal) or no access to the project; a portal without #921 refuses non-admins with 403. A 409 means a live key of that name already exists. An expired or revoked key of the same name does not block a new one.
- **Received another way?** `devaudit auth viewer-key set [--project <slug>]` saves it from a masked prompt.
- **Which keys are saved here:** `devaudit auth status` lists them per project, never the value.

### Lookup order

Everywhere the CLI reads the key (`doctor`, `release status`, `release check`):

1. `DEVAUDIT_VIEWER_API_KEY` in the environment
2. `~/.config/devaudit/viewer-keys.json`, for this base URL and project
3. the repo-root `.env` (legacy, read-only; the CLI never writes `.env`)

There is no fallback to `DEVAUDIT_API_KEY`: the uploader key is CI-only.

### Rotate, revoke, leave

- **Missing or invalid?** `devaudit doctor` reports it and `devaudit doctor --fix` repairs it: at a terminal it issues a new key under your own name with your PAT (typed reason and confirmation) and, if a live key of that name already exists, offers to revoke and replace it. A key left in `.env` is moved into `viewer-keys.json` and its `.env` line removed.
- **Rotate:** revoke your key in the portal's project key list, delete your entry (or run `devaudit uninstall`), then `devaudit join` or `devaudit doctor --fix`.
- **`devaudit uninstall`** revokes your own viewer key (found by the name saved with it) and removes it from `viewer-keys.json`, in addition to revoking the project's keys.
- **When someone leaves:** a project admin removes their project grant and revokes their viewer keys from the portal key list; they revoke their own PAT.

## Reading portal state: `devaudit release status`

```bash
devaudit release status [<REQ-or-version>] [--json]
```

Read-only, viewer key only (never the PAT or the uploader key). With no argument it uses the single non-deferred ticket in `compliance/pending-releases/`.

`--json` shape:

```json
{
  "ok": true,
  "project": "example-app",
  "version": "REQ-042",
  "releaseId": "rel_123",
  "status": "uat_review",
  "url": "https://<portal>/projects/example-app/releases/rel_123",
  "deferred": { "reason": "…", "until": "2026-12-01", "toVersion": null },
  "checks": [],
  "executions": []
}
```

`deferred` appears only for a deferred release. `checks` and `executions` are what the portal's read-back endpoints return, or `null` when they cannot be read; the status is reported either way. Failures print `{ "ok": false, "error": "…" }` and exit `2` (no project or ambiguous ticket), `3` (no viewer key), `4` (portal unreadable) or `5` (no portal release).

## Checking what a machine holds: `devaudit doctor`

The non-gating `credentials` check reports each credential's status and source, never a value. In `--json`, the `credentials` onboarding entry carries:

```json
{
  "uploaderKey": { "status": "ok | warn", "source": null, "project": "example-app", "expiresAt": null, "note": "…", "locations": [] },
  "viewerKey":   { "status": "ok | warn | absent | invalid | not-checked", "source": "env | file | .env | null", "project": "example-app", "expiresAt": null, "note": "…" },
  "pat":         { "status": "ok | absent | invalid | not-checked", "source": "env | file | null", "project": "example-app", "expiresAt": null, "note": "…" }
}
```

The PAT is only validated against the portal at an interactive terminal; a non-interactive run (an agent, CI) reports it as `not-checked` and never sends it. At an interactive terminal its expiry is read from `GET /api/auth/token` (metasession-dev/devaudit#922): within 14 days it is a warning with a "renew" fix (set `DEVAUDIT_PAT_EXPIRY_WARN_DAYS` to change the window); a token with no expiry is fine; a portal without that route reports "expiry: not available". See [`doctor.md`](./doctor.md).
