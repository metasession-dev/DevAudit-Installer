# Local-database E2E in CI

How to make the generated E2E gate (`ci.yml` Gate 4) run against a **disposable local
database** instead of a remote/production one — so the suite can exercise mutation, email,
and delete paths without ever touching real data.

## When you need this

The generated dev server inherits the workflow's **job-level env** — i.e. the
secret-configured **remote** database + any live third-party keys (e.g. a real email API
key). For a project whose backend has **no separate test instance**, running E2E that way
is unsafe (it mutates prod and sends real mail) and usually fails too (the suite expects
local-only seed, a local test user, local-only functions, etc.).

The rule: **never test against prod.** If your backend has no dedicated test instance,
stand up a throwaway local stack in CI and point the E2E gate at it.

The framework stays **stack-agnostic** — it doesn't know about Supabase, Postgres, or any
specific tool. You supply the bring-up command; the framework orchestrates it and threads
the right env onto the dev server and the test runner.

## The two knobs

Both live in `sdlc-config.json`. After editing, run `devaudit update` to regenerate
`ci.yml`.

| Field | Type | What it does |
| --- | --- | --- |
| `e2e_setup_command` | string (multi-line allowed) | A **foreground, blocking** step run **before** the dev server starts. Use it to stand up the local DB: install the CLI, start it, load schema, seed fixtures. Emitted as a `run: \|` block when multi-line. |
| `e2e_env` | map | Env applied to the setup step, the (blocking) **dev-server** step, **and** the blocking + report-only **E2E test** steps. Step-level env **overrides** the job-level remote secrets, so this is how you sever production. |

> **Override every remote key.** `e2e_env` only severs prod for the keys you set. List
> *all* of the database + third-party keys your app reads (URL, anon/public key, service
> key, email key, …) — any key you omit falls through to the remote/prod value from the
> job env.

## Example — local Supabase

```jsonc
{
  // … other fields …
  "e2e_project": "chromium",
  "e2e_start_command": "next dev -p 3000",

  "e2e_setup_command": "supabase start\npsql \"$DATABASE_URL\" -f supabase/schema-local.sql",

  "e2e_env": {
    "E2E_LOCAL": "1",
    "PLAYWRIGHT_NO_WEBSERVER": "1",
    "PLAYWRIGHT_PORT": "3000",
    "NEXT_PUBLIC_SUPABASE_URL": "http://127.0.0.1:54321",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "<well-known-local-anon-key>",
    "SUPABASE_SERVICE_ROLE_KEY": "<well-known-local-service-key>",
    "NEXT_PUBLIC_SUPABASE_PROJECT_ID": "local",
    "RESEND_API_KEY": "re_e2e_local_dummy_key"
  }
}
```

This regenerates a Gate 4 that: runs `supabase start` + loads the local schema (foreground),
starts `next dev` with the **local** Supabase coords + a dummy email key, waits for it, then
runs Playwright with the same local env. No remote project, no real email.

Generated readiness probes use both `wait-on`'s two-minute diagnostic timeout and
an outer 150-second process deadline. A server that never becomes ready therefore
fails the job promptly instead of consuming the full quality-gate timeout.

Notes for this stack:

- The local Supabase anon/service keys are the **well-known local-dev defaults** printed by
  `supabase status` — not secrets — so they can live in `sdlc-config.json`. Real remote keys
  must stay in repo secrets.
- A **dummy** email key makes server-side sends fail harmlessly; apps that treat send
  failures as non-fatal (writing verification codes to the DB) keep working, and any mail is
  caught by the local Inbucket rather than going out.
- `PLAYWRIGHT_NO_WEBSERVER=1` tells `playwright.config.ts` to use the framework-started dev
  server rather than launching its own; align `PLAYWRIGHT_PORT` with `e2e_start_command`'s
  port.
- **Seed determinism:** if specs reference fixed rows (a known job/user id), seed them in
  `e2e_setup_command` (or in the loaded schema file) — `supabase start` gives you empty
  tables. A test auth user can be created at runtime via the admin API from a test helper.

## Per-AC screenshot evidence

When your specs call `evidenceShot(page, '<REQ>', 'ACn-…')` (the `e2e-test-engineer`
pattern — assert the acceptance criterion, then capture the page at that moment), the
generated gate **uploads those per-AC PNGs to the portal** as `screenshot` evidence,
scoped to each in-scope requirement (the REQs with a `compliance/pending-releases/
RELEASE-TICKET-REQ-XXX.md`). They render under **Evidence by requirement** on the
release, named `<srs-req>-<slug>.png` so a reviewer sees which AC each image proves.

These are the **per-AC proof** images — distinct from the Playwright HTML report
(`test_report`), which only captures on failure. Upload is best-effort (a screenshot
failure warns, never blocks the gate) and only runs when a release ticket defines the
in-scope REQ(s), so ordinary dev pushes don't spam evidence. Capture at the proving
moment, not the end of the test.

## Alternative: a real container-service database

`e2e_setup_command` above starts the database yourself (a CLI tool, a binary). If your backend just needs an ordinary containerized database, `sdlc-config.json` has a separate, simpler pair of knobs that render a GitHub Actions `services:` block instead:

| Field | Type | What it does |
| --- | --- | --- |
| `database_service` | string | The service name in the generated `services:` block (e.g. `mongodb`, `postgres`). Empty (the default) strips the block entirely — no service container at all. |
| `database_image` | string | The container image for that service (e.g. `mongo:7`). |
| `database_port` | string | The container port to expose; combined with `database_service: mongodb` this also renders a dynamic-port `DATABASE_URI_STEP` so the app connects to whatever port the runner actually assigned. |
| `database_env` | map | Env applied to the database service container itself (distinct from `e2e_env`, which applies to the app/test steps). |

Use this when a stock database image is enough; use `e2e_setup_command`/`e2e_env` above when you need a CLI-managed local instance (schema loading, a specific startup sequence) that a plain service container can't do alone.

## Authenticated E2E: a report-only tier for logged-in flows

Two more knobs add a **non-blocking**, report-only step after the main blocking smoke gate — for specs that need a real authenticated session and shouldn't hold up every push if they're still flaky:

| Field | Type | What it does |
| --- | --- | --- |
| `e2e_seed_command` | string | A foreground step, run before the authenticated E2E step, that seeds whatever an authenticated session needs (a test user, a session token). |
| `e2e_projects` | string | The Playwright project name(s) to run in this report-only pass (e.g. an `authenticated` project defined in `playwright.config.ts`). |

When either is set, `ci.yml` gains a `continue-on-error: true` seed + authenticated-E2E step pair after the blocking smoke gate, writing `e2e-auth-results.json` — failures here are visible but never block the push. Leaving both unset renders `ci.yml` exactly as if they didn't exist (this is additive and opt-in, same as `e2e_setup_command`/`e2e_env`).

## What stays the same

With **no** `e2e_setup_command` and **no** `e2e_env`, the generated Gate 4 is unchanged —
existing projects regenerate an identical `ci.yml`. This is purely additive and opt-in.

## See also

- [change workflows](./change-workflows.md) — which change produces which release.
- [self-hosted runner CI prerequisites](./self-hosted-runner-ci.md) — durable
  Linux inotify settings required before Turbopack/Playwright E2E on
  self-hosted runners.
- `sdlc-config.example.json` — the documented config (`_comment_e2e_setup` / `_comment_e2e_env`).
- The `e2e-test-engineer` skill — authoring the specs that this gate runs.
