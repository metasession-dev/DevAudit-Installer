# Host adapter contract

A host adapter teaches the Metasession SDLC how to deploy and verify on one platform — `railway`, `vercel`, `fly`, `kubernetes`, `self-hosted-docker`, etc. Each adapter is a single directory under `sdlc/files/hosts/` containing:

```
sdlc/files/hosts/<name>/
└── adapter.json          ← the manifest (validated against the schema)
```

Hosts don't usually bring their own hooks or scripts the way stacks do — the host's contribution is the deploy trigger, the URL-resolution scheme, and the wait/verify snippet that lands inside the post-deploy workflow template. So most host adapters are just a manifest.

The schema lives at [`sdlc/files/hosts/_schema/adapter.schema.json`](./files/hosts/_schema/adapter.schema.json) (JSON Schema draft-07). The validator is `scripts/validate-adapter.cjs`; CI runs `node scripts/validate-adapter.cjs --all` on every push to `develop` and validates both stack and host adapters at once.

## Required fields

### Identity

| Field         | Type                               | Purpose                                                                                     |
| ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `name`        | string (`[a-z0-9][a-z0-9-]{0,31}`) | Identifier matching the parent directory and the `host` key in consumer `sdlc-config.json`. |
| `description` | string                             | One-line human summary of the platform and how it deploys.                                  |

### Deploy trigger

| Field            | Type                                                  | Purpose                             |
| ---------------- | ----------------------------------------------------- | ----------------------------------- |
| `deploy_trigger` | enum (`push_to_main`, `git_tag`, `manual`, `ci_step`) | What kicks off a production deploy. |

- `push_to_main` — Railway, Vercel default. The platform watches the repo and deploys whenever `main` changes. No explicit deploy step in CI.
- `git_tag` — Some setups deploy on tag push, not on every commit to main.
- `manual` — Operator clicks "deploy" in the platform's UI. CI doesn't trigger anything.
- `ci_step` — The CI workflow runs an explicit deploy command (`flyctl deploy`, `kubectl rollout`, `docker compose up`).

### Production URL resolution

The post-deploy workflow needs to know **the URL** of the just-deployed production service so it can run smoke tests and record evidence.

| Field                       | Type                                           | Purpose                                                                                                            |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `production_url_from`       | enum (`secret`, `static`, `api_lookup`, `env`) | Where the URL comes from.                                                                                          |
| `production_url_secret_key` | string (when `production_url_from = secret`)   | The `sdlc-config.json` key whose value names the GitHub Secret holding the URL. Typically `production_url_secret`. |
| `production_url_static`     | string (when `production_url_from = static`)   | The literal URL (or template).                                                                                     |

- `secret` — URL stored as a GitHub Secret per-consumer. Most flexible; right when each project deploys to a different URL.
- `static` — URL hardcoded in the adapter. Right when all consumers on this host share a fixed URL pattern (rare).
- `api_lookup` — Adapter ships a snippet that resolves the URL by calling the host's API (e.g. `flyctl status --json`). Right when the URL is auto-generated and changes per deploy.
- `env` — URL is set as a workflow env var from elsewhere in the consumer's CI. Right for self-hosted setups that already know the URL out-of-band.

The schema enforces that `production_url_secret_key` is present iff `production_url_from = secret`, and same for `static`.

## Optional fields

### Wait and post-deploy

| Field              | Type                   | Purpose                                                                                                                                              |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wait_for_deploy`  | string (shell snippet) | Blocks until the deploy is live and healthy. Embedded into `post-deploy-prod.yml.template` at sync time. Omit for hosts where deploy is synchronous. |
| `post_deploy_hook` | string (shell snippet) | Runs after a successful deploy — cache warmup, host-specific bookkeeping, additional smoke tests.                                                    |

Both snippets run in a `bash -e` step; they can reference `${PROD_URL}` and any `required_env` values.

### Required secrets and env

| Field              | Type     | Purpose                                                                                                                |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `required_secrets` | string[] | GitHub Secrets the adapter expects to be set on the consumer repo. CI workflows fail at runtime if these are missing.  |
| `required_env`     | string[] | Non-sensitive identifiers (app names, region IDs) the consumer must set — typically populated from `sdlc-config.json`. |

Sync may warn if these are absent; it's a soft check (the CI workflow is the hard check, since the script can't authenticate to the host on the dev's behalf).

### sdlc-config.json keys

| Field                  | Type     | Purpose                                                        |
| ---------------------- | -------- | -------------------------------------------------------------- |
| `config_keys.required` | string[] | Keys consumers must define.                                    |
| `config_keys.optional` | string[] | Keys consumers may define (e.g. an optional database service). |
| `config_keys.defaults` | object   | Fallback values when a key is absent.                          |

### Notes

| Field   | Type     | Purpose                                                                                                                         |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `notes` | string[] | Free-form notes about the host's quirks. Backed up here so future maintainers don't rediscover them. Not consumed by templates. |

## Adding a new host

See the step-by-step walkthrough: **[docs/adding-a-host.md](../docs/adding-a-host.md)** — uses Fly.io as the worked example. The high-level shape is:

1. **Create the directory** `sdlc/files/hosts/<name>/`.
2. **Author `adapter.json`** with every required field. Use `hosts/railway/adapter.json` as a worked example.
3. **Run the validator:** `node scripts/validate-adapter.cjs sdlc/files/hosts/<name>/adapter.json`. Fix any errors.
4. **Validate against a real consumer** before merging — at least one project on this host should sync cleanly and reach `released` end-to-end. A host adapter validated only against `examples/` isn't load-bearing.

## Worked example: Fly.io

```json
{
  "$schema": "../_schema/adapter.schema.json",
  "name": "fly",
  "description": "Fly.io-hosted services. CI runs `flyctl deploy` explicitly; production URL discovered via the Fly API.",
  "deploy_trigger": "ci_step",
  "production_url_from": "api_lookup",
  "wait_for_deploy": "for i in $(seq 1 30); do flyctl status --app \"${APP_NAME}\" --json | jq -e '.Deployment.Status == \"successful\"' && break; sleep 10; done",
  "required_secrets": ["FLY_API_TOKEN", "DEVAUDIT_API_KEY"],
  "required_env": ["APP_NAME"],
  "notes": [
    "Production URL is resolved at deploy time by flyctl — no GitHub Secret to maintain.",
    "Deploy step runs `flyctl deploy --remote-only` in the post-deploy workflow; FLY_API_TOKEN is the auth."
  ]
}
```

This adapter isn't shipped yet — listed here as a sketch of what a non-Railway host adapter looks like.

## Why JSON Schema

Same reasons as [STACK_ADAPTER.md](./STACK_ADAPTER.md#why-json-schema-not-zod-not-a-typescript-interface): IDE tooling, language-neutrality, stable versioned artifact. The validator script is the same one stacks use — auto-detects the type from path and applies the matching schema.

## Evolution

Backward-compatible additions (new optional fields) need:

1. Schema update.
2. This doc updated.
3. Existing adapters can stay as they are.

Backward-incompatible changes (renaming or removing required fields, narrowing an enum) need a v1.24.0-level version bump and a migration note for consumers.
