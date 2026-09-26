# `devaudit doctor`

The single-repo health check for a DevAudit consumer. Run it locally, in CI, or swept across every project your account can see with `--fleet`.

```bash
devaudit doctor          # human-readable
devaudit doctor --json   # machine-readable — suitable for CI
devaudit doctor --fleet  # sweep every project you have access to, checked out locally as siblings
```

Implementation: [`cli/src/commands/doctor.ts`](../cli/src/commands/doctor.ts) (single-repo), [`cli/src/commands/fleet.ts`](../cli/src/commands/fleet.ts) (`--fleet`).

## Exit codes

- **`0`** — all required tools present.
- **`6`** — one or more required tools missing.

Onboarding-checklist gaps and release-closeout drift are reported but **do not** affect the exit code — they're warnings, not tool-preflight failures. A CI step that wants to gate on them should parse `--json` output itself rather than relying on the process exit code.

## What it checks

### 1. Required tools on PATH (gating)

`node` (>=22), `git`, `gh`, `jq`, `curl`. This is the only group that sets exit code `6` on failure.

### 2. Onboarding-checklist invariants (non-gating, consumer projects only)

Skipped entirely (reported as `ok` with a "skipped" detail) when not run inside a consumer project (no `sdlc-config.json` at the repo root).

| Check | What it verifies |
| --- | --- |
| `srs` | `docs/SRS.md` exists — the one manual bootstrap step nothing in the framework authors on a consumer's behalf. |
| `rtm` | `compliance/RTM.md` has at least one real `REQ-XXX` row, not just the generated skeleton. |
| `semgrep` | Informational only — local semgrep availability. CI installs its own copy independently, so this only affects local pre-commit SAST runs. |
| `e2e-regression` | `e2e_regression_enabled` in `sdlc-config.json` agrees with whether `playwright.config.ts` actually defines `critical`/`regression` projects — catches either side drifting from the other. |
| `secrets` | Required GitHub repo secrets are present (`gh secret list`): the configured `api_key_secret` name (default `DEVAUDIT_API_KEY`), `DEVAUDIT_USER_TOKEN`, and the viewer-key secret if configured. Presence only — `gh secret list` never returns values. |
| `pre-push-hook` | `.husky/pre-push` or `.git/hooks/pre-push` exists — this is what enforces the `sdlc-implementer` sentinel. |

### 3. Release closeout drift (non-gating)

`checkReleaseCloseoutDrift` — a reconciliation safety net. Flags any release ticket still sitting in `compliance/pending-releases/` whose portal release is already `released` (i.e. a close-out that was missed, e.g. a dropped dispatch). Calls the DevAudit portal API using `sdlc-config.json`'s `devaudit.project_slug`/`devaudit.base_url` plus `DEVAUDIT_API_KEY`; skips gracefully if any of those aren't available.

## `suspectedOrigin` tagging

Every onboarding-checklist and closeout-drift result carries a first-pass `suspectedOrigin: 'framework' | 'consumer-drift' | 'unknown'` (devaudit-installer#867):

- **`consumer-drift`** — the check reflects this consumer's own repo state (e.g. a missing file, a missing secret).
- **`unknown`** — the check depends on the operator's local machine/auth state rather than either repo (e.g. `secrets`/`pre-push-hook` when `gh` isn't authenticated).
- **`framework`** — reserved for cases that point at the framework/portal itself rather than anything a consumer could have done.

Tool-preflight checks (`node`/`git`/`gh`/`jq`/`curl`) are untagged — they describe the operator's own machine, not either repo. This is a *first-pass* signal: [`fleet-doctor`](./fleet-doctor.md) re-evaluates it with cross-consumer evidence (the same anomaly across every consumer is strong evidence for `framework`; one consumer diverging from every sibling is strong evidence for `consumer-drift`) rather than trusting the single-repo tag as final.

## Plugin extension point: `onDoctor`

Plugins can extend `doctor` via the `onDoctor` lifecycle hook (`plugin-sdk/src/lifecycle.ts`), invoked at the end of `runDoctor` via `discoverPlugins`/`runHook`, after the built-in checks have run. Two example implementations:

- [`plugins/devaudit-plugin-prisma/src/hooks/on-doctor.ts`](../plugins/devaudit-plugin-prisma/src/hooks/on-doctor.ts) — checks Prisma schema/migrations layout.
- [`plugins/devaudit-plugin-evidence-export/src/hooks/on-doctor.ts`](../plugins/devaudit-plugin-evidence-export/src/hooks/on-doctor.ts).

See `sdlc/CLAUDE.md` / the plugin-sdk docs for the general plugin-authoring contract; `onDoctor` follows the same `LoadedPlugin`/context shape as the other lifecycle hooks (`beforeSync`, `afterSync`, etc.).

## `--fleet`: sweeping every project you can see

`devaudit doctor --fleet` (devaudit-installer#861) is a self-service, multi-tenant fleet sweep — any DevAudit account can run it, not just Metasession's own operator tooling:

1. Calls `GET /api/projects` on the portal with your `DEVAUDIT_USER_TOKEN` to list every project your account can see (org membership or an explicit access grant — enforced portal-side by the same authz every other API call goes through). This is the actual tenant-isolation boundary: it is structurally impossible to see, let alone sweep, a project outside your own access, because the portal never returns it.
2. For each project with a `repo_url`, looks for a local checkout as a sibling of the current directory (`../<repo-name>`, matching the naming convention `fleet-doctor`'s Discover phase already used) — not found locally is a skip, not a failure.
3. As defense-in-depth (`repo_url` is an unverified string on the portal, not a proven ownership link — see devaudit-installer#861's design notes), confirms the local checkout's own `git remote get-url origin` actually matches `repo_url` before running anything against it; a mismatch is skipped.
4. Runs `devaudit doctor --json` against each matched local checkout and reports the aggregate — `--json` for machine consumption, human-readable otherwise.

**`--fleet` is read-only.** It never files issues, opens branches, or otherwise acts on your behalf — it only reports. Automated write actions (filing upstream issues, driving hotfixes, invoking `sdlc-implementer`) are a separate, deliberate choice layered on top — see [`docs/fleet-doctor.md`](./fleet-doctor.md) for how Metasession's own operator automation does this for its own fleet using `--fleet` as its discovery+collection step.

## See also

- [`docs/fleet-doctor.md`](./fleet-doctor.md) — Metasession's own automated fleet sweep, built on top of `devaudit doctor --fleet`, adding org-boundary enforcement and automated write actions for its own consumers.
- [`docs/onboarding.md`](./onboarding.md) — run `devaudit doctor` after `devaudit install` to confirm onboarding actually landed.
- [`docs/sdlc-framework.md`](./sdlc-framework.md) — how `doctor` fits into verifying the SDLC process is implemented and healthy, not just described.
