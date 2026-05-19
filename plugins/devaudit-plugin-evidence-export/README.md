# devaudit-plugin-evidence-export

First-party DevAudit plugin: bulk export of evidence files from the portal into a local directory tree — primarily for handing artefacts to external auditors.

## What it adds

### Commands

- `devaudit evidence-export list <project-slug>` — lists requirements + evidence counts for the project.
- `devaudit evidence-export bundle <project-slug> --output <dir>` — downloads every evidence file into `<dir>/<requirementId>/<filename>` and writes a `manifest.json` summarising what was bundled. Per-file failures are isolated (the bundle continues) and recorded in the manifest with an `error` field.

The plugin writes a **directory tree**, not a `.zip`. If you want an archive, `zip -r bundle.zip <dir>` after the bundle completes.

### Lifecycle hooks

- `onDoctor` — confirms `DEVAUDIT_USER_TOKEN` is set (or warns if not), so `devaudit doctor` flags the misconfiguration before someone tries to bundle.

## Auth

The plugin reads `DEVAUDIT_USER_TOKEN` from the environment. It deliberately does **not** read `~/.config/devaudit/auth.json` directly — that file is the CLI's domain. To use this plugin from a fresh shell:

```sh
export DEVAUDIT_USER_TOKEN=$(jq -r '.token' ~/.config/devaudit/auth.json)
```

(Future enhancement: surface a helper from the SDK so plugins don't need to know about auth.json file layout.)

## Manifest format (v0)

```jsonc
{
  "project_slug": "wawagardenbar-app",
  "base_url": "https://devaudit.metasession.co",
  "generated_at": "2026-05-19T08:19:00.123Z",
  "total_files": 42,
  "successful": 42,
  "failed": 0,
  "entries": [
    {
      "requirement_id": "REQ-001",
      "file_path": "wawagardenbar-app/REQ-001/2026-05-19_smoke.html",
      "file_name": "2026-05-19_smoke.html",
      "file_size_bytes": 12345,
      "bundled_to": "/tmp/wgb-evidence/REQ-001/2026-05-19_smoke.html"
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
