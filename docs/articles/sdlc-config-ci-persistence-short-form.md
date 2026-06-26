# Your CI Variables Keep Getting Wiped on Every Update

**Long-form parent:** The Config Is the Source of Truth: How sdlc-config.json Survives Template Syncs
**Platform:** LinkedIn, Dev.to
**Read time:** ~2 minutes

---

You add three environment variables to your CI workflow. E2E needs a local Supabase URL, a service role key, and a dummy email key. You edit `.github/workflows/ci.yml`, push, and the E2E gate passes. Green CI. Done.

Two weeks later you run `devaudit update` to pull the latest template improvements. The CLI regenerates `ci.yml` from its template. Your three env vars are gone. E2E fails. The gate is red.

What happened? You edited the generated file, not the source of truth.

## The root cause

DevAudit's `devaudit update` command regenerates CI workflows from templates (`ci.yml.template`, `compliance-evidence.yml.template`, etc.). The templates contain `{{TOKEN}}` placeholders that get substituted with values from `sdlc-config.json`. The generated files are **output artifacts** — they get overwritten on every sync.

`sdlc-config.json` is **user-owned**. It persists across syncs. The CLI reads it, not the generated workflow files. Any CI variable that lives only in the generated `ci.yml` is one `devaudit update` away from disappearing.

## The fix

Put your env vars in `sdlc-config.json`, not in `ci.yml`:

```json
{
  "e2e_env": {
    "E2E_LOCAL": "1",
    "NEXT_PUBLIC_SUPABASE_URL": "http://127.0.0.1:54321",
    "SUPABASE_SERVICE_ROLE_KEY": "your-local-service-key",
    "RESEND_API_KEY": "re_e2e_local_dummy_key"
  }
}
```

The CLI's `ci-templates.ts` reads `e2e_env` and threads it into every E2E-related step: the setup command, the dev server start, the blocking E2E test run, and the report-only authenticated E2E run. The next `devaudit update` regenerates `ci.yml` with those vars included — because they came from the config, not the output.

### GitHub secrets references work too

Values in `e2e_env` can reference repo secrets directly:

```json
{
  "e2e_env": {
    "E2E_ADMIN_USERNAME": "${{ secrets.E2E_ADMIN_USERNAME }}"
  }
}
```

The CLI's `indentEnvBlock()` function outputs values as-is. GitHub Actions resolves the `${{ secrets.* }}` syntax at runtime. No escaping, no special handling — it just works.

## When the config can't help

Some bugs live in the **template itself**, not the config. A structural YAML issue in `compliance-evidence.yml.template` — where `**` markdown bold in shell string continuations gets misparsed as YAML alias references — can't be fixed by adding values to `sdlc-config.json`. The template needs upstream patching. (See issue #228.)

The distinction: **config values** (env vars, project slug, runner type) are user-owned and durable. **Template structure** (YAML syntax, step ordering, block scalar indentation) is framework-owned and requires an upstream fix.

## Why this matters

Generated files are build outputs. Editing them directly is like editing a compiled binary instead of the source code. It works until the next build. `sdlc-config.json` is the source. The generated workflows are the artifacts. Treat them accordingly.

---

*Read the full article → devaudit.ai/blog/sdlc-config-ci-persistence*

*See the SDLC → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)*
