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

## What stays the same

With **no** `e2e_setup_command` and **no** `e2e_env`, the generated Gate 4 is unchanged —
existing projects regenerate an identical `ci.yml`. This is purely additive and opt-in.

## See also

- [change workflows](./change-workflows.md) — which change produces which release.
- `sdlc-config.example.json` — the documented config (`_comment_e2e_setup` / `_comment_e2e_env`).
- The `e2e-test-engineer` skill — authoring the specs that this gate runs.
