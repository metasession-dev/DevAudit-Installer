# Adding a new host adapter

Walkthrough for adding a new hosting platform — Fly.io, Vercel, AWS ECS, Kubernetes, self-hosted Docker, etc. — to the DevAudit SDLC framework. Read with [HOST_ADAPTER.md](../sdlc/HOST_ADAPTER.md) (the contract) and [ADR-001](./ADR/ADR-001-polyglot-sdlc-architecture.md) (the rationale) open in adjacent tabs.

Host adapters are smaller than stack adapters — typically a single `adapter.json` per platform. They don't ship hooks or scripts of their own; the contribution is the deploy trigger, the production-URL resolution scheme, and the `wait_for_deploy` snippet that lands inside the post-deploy workflow template.

Shipped hosts are `railway`, `vercel` and `custom` (AWS, self-hosted or any deploy script; see [onboarding](./onboarding.md)). Fly.io is sketched out as an aspirational example in [HOST_ADAPTER.md](../sdlc/HOST_ADAPTER.md#worked-example-flyio) — the walkthrough below treats Fly.io as the second-host scenario.

## When to add a new host

Same rule as adding a stack: **wait for a real consumer**. Authoring against a hypothetical host produces fields the first real consumer overrides. Hold off until:

- A concrete project is moving from Railway (or wherever) to the new host.
- Their deploy mechanism is decided (push-to-main? CI step? operator click?).
- Their production-URL convention is known.

## Step 1 — Survey the real consumer

Before authoring, answer:

| Question                                                      | Example (Fly.io)                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| What triggers a production deploy?                            | CI runs `flyctl deploy --remote-only`                          |
| Where does the production URL come from?                      | Resolved via `flyctl status --json` (API lookup, not a secret) |
| What auth does the deploy / API use?                          | `FLY_API_TOKEN` GitHub Secret                                  |
| What env vars does the consumer set per app?                  | `APP_NAME` (the Fly app slug)                                  |
| How do you confirm a deploy is live?                          | Poll `flyctl status` until `Deployment.Status == "successful"` |
| Any post-deploy bookkeeping?                                  | Optional cache warmup, additional smoke tests                  |
| Does the platform expose a public-readable URL once deployed? | Yes — same curl-the-URL smoke test as Railway works            |
| What is the lean production runtime shape on this host?       | Compiled JS / framework standalone; no `tsx` in prod           |

Take notes — most of these answers go straight into the adapter manifest.

## Step 2 — Create the adapter directory

```
sdlc/files/hosts/<name>/
└── adapter.json
```

`<name>` must satisfy `^[a-z0-9][a-z0-9-]{0,31}$` — lowercase, kebab-cased, max 32 chars.

Typically only `adapter.json`. Unlike stack adapters, hosts don't bundle scripts or hooks.

## Step 3 — Author `adapter.json`

Start by copying `hosts/railway/adapter.json` and editing. The Fly.io example from HOST_ADAPTER.md:

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
  "runtime_contract": {
    "preferred_web_runtime": "compiled JavaScript or framework standalone output",
    "forbid_typescript_runtime": true,
    "prefer_standalone_output": true,
    "scheduler_placement": "scheduled jobs should run in a separate worker or platform cron, not in the web process"
  },
  "notes": [
    "Production URL is resolved at deploy time by flyctl — no GitHub Secret to maintain.",
    "Deploy step runs `flyctl deploy --remote-only` in the post-deploy workflow; FLY_API_TOKEN is the auth."
  ]
}
```

**Key decisions:**

### `deploy_trigger`

| Value          | When                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| `push_to_main` | Platform watches the repo (Railway default, Vercel default). No explicit deploy in CI. |
| `git_tag`      | Platform deploys on tag push.                                                          |
| `manual`       | Operator clicks "deploy" in the platform UI. CI doesn't trigger anything.              |
| `ci_step`      | The CI workflow runs an explicit deploy command.                                       |

If `ci_step`, the consumer's CI needs the deploy command in a workflow somewhere. That's NOT auto-generated by the SDLC sync today — it lives in the consumer's deploy workflow (e.g. existing `publish-images.yml` for EXAMPLE-PYTHON-SERVICE). The SDLC framework's `post-deploy-prod.yml` then runs AFTER the deploy lands.

### `production_url_from`

| Value        | Required additional field   | When                                                                                                                    |
| ------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `secret`     | `production_url_secret_key` | URL stored as a GitHub Secret per-consumer. Railway default.                                                            |
| `static`     | `production_url_static`     | URL hardcoded in the adapter (rare — only if every consumer on this host shares one URL).                               |
| `api_lookup` | none                        | Resolved by calling the host's API (e.g. `flyctl status`). Right when the URL is auto-generated and changes per deploy. |
| `env`        | none                        | Set as a workflow env var from elsewhere in the consumer's CI. Self-hosted scenarios that already know the URL.         |

The schema enforces the conditional `*_secret_key` / `*_static` requirements via `allOf` + `if/then`. Get the enum value right and the schema makes sure you provide the corresponding field.

### `wait_for_deploy`

Optional but recommended unless the deploy is genuinely synchronous (`push_to_main` on Railway typically completes within the CI run that triggered it; no wait needed).

The snippet runs in a `bash -e` step inside `post-deploy-prod.yml`. It can reference:

- `${PROD_URL}` — the resolved production URL.
- Any `required_env` values — `${APP_NAME}` for Fly.
- Standard GHA env (`${GITHUB_WORKSPACE}` etc.).

Keep it idempotent and bounded — Railway's is a 30 × 10s loop; Fly's the same. Don't poll forever.

### `required_secrets` and `required_env`

- `required_secrets`: GitHub Secrets the adapter assumes are set. CI workflows fail at runtime if missing. Sync may warn at sync time but can't enforce — secrets are in repo settings, not the repo.
- `required_env`: env vars the consumer must set (usually populated from sdlc-config.json fields). Non-sensitive identifiers like app names, region IDs.

### `runtime_contract`

This is a schema-validated, operator-facing contract for the expected runtime shape on the host. Use it to encode the lean default so consuming projects do not drift into expensive production patterns by accident.

For Railway, that means:

- prefer compiled JS or framework standalone output
- do not run `tsx` / `ts-node` in the long-lived production web process
- keep background schedulers out of the web process where the platform shape allows it

### `reconcile` (optional webhook-loss recovery, devaudit-installer#1022)

The post-deploy gate waits for the provider's GitHub `deployment_status` event. If the provider deployed but the event never reached GitHub, the gate waits forever. A host that can look its own deployments up declares how, and `devaudit update` then generates `reconcile-deployment.yml` for it (a host without `reconcile` gets none, and a previously generated one is removed):

```json
"reconcile": {
  "lookup_script": "lookup-deployment-fly.sh",
  "required_cli": "flyctl",
  "secrets": ["FLY_API_TOKEN"]
}
```

- `lookup_script` — a file you add under `sdlc/files/_common/scripts/` (it syncs to `scripts/`). Called with `--deployment-id= --project= --service= --environment=`; it prints **one JSON object** `{"id","status","sha","branch","repo"}` (`status`: `success|failed|building|canceled|unknown`) and exits non-zero when the deployment is not found. Everything after the lookup — terminal-success, the exact SHA from `main` of this repo, a health probe, the idempotent GitHub deployment-status POST, the provenance evidence — is the shared `reconcile-deployment.sh`; you write only the lookup. Examples: `lookup-deployment-railway.sh` (the `railway` CLI), `lookup-deployment-vercel.sh` (curl + jq against the REST API).
- `required_cli` — the CLI the lookup shells out to (`devaudit doctor`'s `reconcile-cli` check expects it on `PATH`), or `null`.
- `secrets` — repo secrets exposed to the lookup as environment variables. List the same ones in `required_secrets` so `doctor` flags them when missing (they are advisory: only the recovery path needs them).

## Which adapter fields are consumed today

| Field | Consumed by | Status |
| --- | --- | --- |
| `name`, `description` | adapter listing, `install --host`, schema validation | used |
| `required_secrets` | `devaudit doctor` `secrets` check | used |
| `reconcile` | `devaudit update` (whether and how to generate `reconcile-deployment.yml`), `doctor` `reconcile-cli` | used |
| `production_url_from` / `production_url_secret_key` | the `{{PRODUCTION_URL_SECRET}}` token, from `production_url_secret` in `sdlc-config.json` | only `secret` is implemented; `static`, `api_lookup` and `env` are accepted by the schema but do nothing yet |
| `deploy_trigger`, `wait_for_deploy`, `post_deploy_hook` | nothing yet: the generic post-deploy workflow reacts to the provider's GitHub `deployment_status`, whatever triggered the deploy | reserved (documentary) |
| `config_keys`, `required_env`, `runtime_contract`, `notes` | validated and shown to operators | documentary |

Do not rely on a reserved field changing behaviour; if your host's deploy does not post a GitHub deployment status, see the `custom` host in this repo's docs.

## Step 4 — Update `post-deploy-prod.yml.template`

The host's `wait_for_deploy` and `post_deploy_hook` snippets are not auto-substituted into the workflow (see the field table above): the template reacts to the provider's GitHub `deployment_status` and runs a host-neutral independent health probe. `reconcile-deployment.yml` is the one host-specific workflow, and it is generated from the adapter's `reconcile` data (devaudit-installer#1022).

Adding a new host today therefore has two paths:

1. **The new host's wait is identical to Railway's** (curl the URL, check 2xx/3xx). No template edit needed — Railway's wait works.
2. **The new host needs a different wait** (`flyctl status` polling, `kubectl rollout status`, etc.). Edit `sdlc/files/ci/post-deploy-prod.yml.template` to substitute `{{WAIT_FOR_DEPLOY}}` from the host adapter, and update the CLI CI-template sync (`cli/src/update/ci-templates.ts`) to read it.

Option 1 is the most likely path for the first non-Railway host. Option 2 is filed as a follow-up issue when needed; the contract field exists in HOST_ADAPTER.md so the wiring lands neatly when it does.

## Step 5 — Validate against the schema

```bash
node scripts/validate-adapter.cjs sdlc/files/hosts/<name>/adapter.json
```

Should print `OK   sdlc/files/hosts/<name>/adapter.json [host]`. Then run `--all` to confirm everything else still validates.

The host schema's conditional rules (`production_url_from = secret` requires `production_url_secret_key`, etc.) catch the most common mistakes. If you see an `additionalProperties` violation, you've added a field the schema doesn't know about — add it to `sdlc/files/hosts/_schema/adapter.schema.json` first, then to your adapter.

## Step 6 — Add unit tests

`tests/unit/scripts/validate-adapter.test.ts` has a `host adapters` describe block. If your host introduces a new enum value (e.g. a new `deploy_trigger` mode) or a new conditional rule, add tests:

- Confirms a minimal adapter for your host passes.
- Confirms an adapter with the new field missing fails with a clear message.

If you're only using existing fields, the existing tests cover it.

## Step 7 — Dry-run sync against the real consumer

```bash
devaudit update <path-to-consumer>
```

The consumer's `sdlc-config.json` should have `"host": "<name>"` plus any host-specific config keys you declared in `config_keys`.

Inspect:

- The generated `.github/workflows/post-deploy-prod.yml` — production URL resolution + wait logic make sense for the platform.
- Required env / secrets are documented somewhere the consumer's owner will find them.

## Step 8 — Open the upstream PR

DevAudit PR with: new `hosts/<name>/`, optional template substitution wiring, validator tests, updated HOST_ADAPTER.md if the host introduces patterns no prior host used.

## Step 9 — Open the consumer PR

After DevAudit merges, re-sync the consumer and open their onboarding PR (or a host-migration PR if they're moving from Railway).

## Common decisions and trade-offs

### Compose vs. invent

Most projects move _to_ a host that already has an adapter. Adding a new host is for net-new platforms. Before authoring a new host adapter, check whether the consumer's setup is actually meaningfully different from Railway or just superficially branded differently:

- "Render" or "Heroku" with auto-deploy on push? That's `deploy_trigger: push_to_main` + `production_url_from: secret`. Possibly indistinguishable from Railway at the SDLC level.
- "AWS App Runner" with `apprunner deploy`? That's `deploy_trigger: ci_step`, distinct.

If the new host fits an existing adapter's shape, **don't make a new adapter** — onboard against the existing one. The platform name in marketing doesn't drive whether a new adapter is needed; the deploy mechanism does.

### Production URL semantics

`api_lookup` is the most flexible but slowest. The consumer's CI has to do a (potentially slow) API call to discover the URL. Use `secret` when the URL is stable across deploys and known up front; use `api_lookup` only when the URL genuinely changes per deploy (Fly review apps, k8s with NodePort).

### Auth model

Hosts often require an auth token (`FLY_API_TOKEN`, `KUBE_CONFIG_DATA`, etc.). Declare these in `required_secrets`. The SDLC sync can't issue them — that's the consumer's onboarding responsibility — but the adapter manifest is the canonical place to list what's needed.

## See also

- [HOST_ADAPTER.md](../sdlc/HOST_ADAPTER.md) — the contract every host must satisfy.
- [ADR-001](./ADR/ADR-001-polyglot-sdlc-architecture.md) — why the framework is layered this way.
- [adding-a-stack.md](./adding-a-stack.md) — sibling walkthrough for stack adapters.
- [sdlc/files/hosts/railway/adapter.json](../sdlc/files/hosts/railway/adapter.json) — current worked example.

## The `custom` host: AWS, self-hosted, anything (devaudit-installer#1022)

Vercel and Railway post a GitHub `deployment_status` themselves, which is what the production gate (`post-deploy-prod.yml`) waits for. A deploy you run yourself does not, so use `devaudit install --host custom`. The synced `deploy-custom.yml` then does the bookkeeping around **your** command: it creates the GitHub deployment, runs `deploy_command`, verifies the new build is serving, posts `success` (or `failure`), and dispatches `post-deploy-prod.yml` with the deployed SHA (a status created with `GITHUB_TOKEN` does not trigger other workflows, so the dispatch is explicit). Every downstream gate is unchanged.

`sdlc-config.json` keys (all seeded empty by `install --host custom`):

| Key | Meaning |
| --- | --- |
| `deploy_command` | **Required.** Run with bash on the runner at the deployed commit. Receives `DEPLOY_SHA`, `DEPLOY_ENVIRONMENT`, `PROD_URL` and your `deploy_secrets`. Exit non-zero to fail the deployment. Missing = the workflow fails loudly. |
| `deploy_secrets` | Repo secret names exposed to the command as env vars (`AWS_ACCESS_KEY_ID`, an SSH key, ...). |
| `deployed_sha_url`, `deployed_sha_jq` | An endpoint that reports the running commit (and the jq path to it, e.g. `.version.sha`). With it, verification proves the **new** build is serving. Without it only a health check of `production_url_secret` runs, which an old build still answering also passes. |
| `deploy_trigger` | `push_to_main` (default, the release branch), `git_tag` (pushed `v*` tags) or `manual` (workflow_dispatch only). |
| `runner` | As for any host; use a self-hosted runner label when the deploy needs your network. |

Optional secret `DEVAUDIT_PROBE_HEADER` is sent with verification and the post-deploy probes for an access-gated origin.

### Example: AWS ECS

```json
"host": "custom",
"deploy_command": "aws ecs update-service --cluster prod --service web --force-new-deployment\naws ecs wait services-stable --cluster prod --services web",
"deploy_secrets": ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
"deployed_sha_url": "https://app.example.com/version",
"deployed_sha_jq": ".sha"
```

### Example: a self-hosted box over SSH

```json
"host": "custom",
"runner": "self-hosted",
"deploy_command": "ssh deploy@app01 'cd /srv/app && git fetch && git checkout \"$DEPLOY_SHA\" && docker compose up -d --build'",
"deploy_secrets": [],
"deployed_sha_url": "https://app.example.com/healthz"
```

The second example has no `deployed_sha_jq`: the response body must then contain the SHA. Have the app expose its commit (an env var baked in at build time) so verification is meaningful.
