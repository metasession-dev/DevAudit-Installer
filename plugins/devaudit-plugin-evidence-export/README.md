# devaudit-plugin-evidence-export

First-party DevAudit plugin: bulk export of evidence files from the portal into a local directory tree — primarily for handing artefacts to external auditors.

## What it adds

### Commands

- `devaudit evidence-export list <project-slug>` — lists requirements + evidence counts for the project.
- `devaudit evidence-export bundle <project-slug> --output <dir>` — downloads every evidence file into `<dir>/<requirementId>/<filename>` and writes a `manifest.json` summarising what was bundled. Per-file failures are isolated (the bundle continues) and recorded in the manifest with an `error` field.

The plugin writes a **directory tree**, not a `.zip`. If you want an archive, `zip -r bundle.zip <dir>` after the bundle completes.

### Lifecycle hooks

- `onDoctor` — confirms a personal access token is available to the plugin (from the CLI, or the legacy `DEVAUDIT_USER_TOKEN`) and warns if neither is, so `devaudit doctor` flags the misconfiguration before someone tries to bundle.

## Auth

The plugin gets your personal access token **from the CLI**: run `devaudit auth login` once and `list` / `bundle` just work. You do not export the token into your shell, which matters because every agent session started from that shell would inherit it (`devaudit doctor` warns when `DEVAUDIT_USER_TOKEN` is set).

Under the hood the plugin calls `ctx.getPersonalAuth()` from `@metasession.co/devaudit-plugin-sdk` (the CLI resolves it exactly like `devaudit auth status`: `DEVAUDIT_USER_TOKEN`, then the `auth login` cache). On a CLI too old to provide the accessor, the plugin falls back to `DEVAUDIT_USER_TOKEN`. The plugin never logs or writes the token.

## Manifest format (v0)

```jsonc
{
  "project_slug": "example-app",
  "base_url": "https://devaudit.ai",
  "generated_at": "2026-05-19T08:19:00.123Z",
  "total_files": 42,
  "successful": 42,
  "failed": 0,
  "entries": [
    {
      "requirement_id": "REQ-001",
      "file_path": "example-app/REQ-001/2026-05-19_smoke.html",
      "file_name": "2026-05-19_smoke.html",
      "file_size_bytes": 12345,
      "bundled_to": "/tmp/example-evidence/REQ-001/2026-05-19_smoke.html"
    }
  ]
}
```

The schema is informational at v0; expect it to stabilise + version when an auditor consumes it.

## Install

```sh
devaudit plugin install @metasession.co/devaudit-plugin-evidence-export
```

Published on npm. The CLI resolves the name against the registry and installs into `~/.config/devaudit/plugins/`.

Pre-release / from-source install (against a Git tag or commit) remains available:

```sh
devaudit plugin install https://github.com/metasession-dev/DevAudit-Installer.git#plugins/devaudit-plugin-evidence-export
```

## Compatibility

| | |
|---|---|
| SDK apiVersion | `1` |
| Node | `>=22` |
| Targets | Any DevAudit-onboarded project with evidence in the portal. |

## Tests

```sh
npm install --legacy-peer-deps   # plugin-sdk must be built first
npm run build
npm test
```

9 vitest cases use msw to mock the portal:

- `list` happy path, missing-slug, missing-token, HTTP 401
- `bundle` happy path, partial-failure isolation, missing --output
- `onDoctor` token-present + token-missing
