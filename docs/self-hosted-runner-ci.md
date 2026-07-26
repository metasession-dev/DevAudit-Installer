# Self-Hosted Runner Fleet

DevAudit-generated CI can run on GitHub-hosted runners or trusted self-hosted
runners. Self-hosted runners are persistent machines, so they need a small
host-level bootstrap before they are allowed to run Next.js/Turbopack and
Playwright E2E jobs.

## Linux inotify capacity

Next.js/Turbopack can exhaust the default Linux file-watch limits before
Playwright executes. That is runner infrastructure failure, not product test
evidence.

Minimum supported values:

```text
fs.inotify.max_user_watches=524288
fs.inotify.max_user_instances=512
```

Apply the durable setting on each Linux self-hosted runner:

```bash
sudo bash scripts/check-self-hosted-runner.sh --apply
sudo sysctl --system
```

This writes:

```text
/etc/sysctl.d/99-metasession-ci-inotify.conf
```

The generated `ci.yml` runs `scripts/check-self-hosted-runner.sh` before the
quality gates continue. On GitHub-hosted runners it no-ops. On Linux
self-hosted runners it fails fast with the remediation command when limits are
too low.

## Fleet contract

Register each trusted machine once at organization scope in the
`metasession-dev` organization and place it in the `metasession-ci` runner
group. Restrict that group to approved organization repositories. Do not expose
trusted runners to fork pull requests.

Each machine has exactly one unique routing label:

```text
metasession-ci-ostendo-laptop2
metasession-ci-remote-01
```

Each repository sets `CI_RUNNER_LABEL` as a repository or environment variable.
All substantive CI and production deployment jobs for that repository use the
selected label. A `workflow_dispatch.runner_label` input may override it for one
manual run. Maintainers with repository-settings access may change the variable.
For self-hosted projects, generated workflows resolve the runner in this order:

```text
workflow_dispatch.runner_label
CI_RUNNER_LABEL
self-hosted
```

The final value preserves compatibility while a repository is migrated. Remove
that generic fallback only after every supported host has a unique label and
the repository variable is configured.

The online admission preflight calls:

```bash
ORG_RUNNER_READ_TOKEN=... \
  scripts/runner-host/resolve-online-runner.sh \
  metasession-dev "$CI_RUNNER_LABEL"
```

The preflight checks existence, uniqueness, and `online` state only. A busy
online runner may queue. An offline or missing runner fails immediately with
instructions to change `CI_RUNNER_LABEL` or use the manual override. The token
must be a narrowly scoped GitHub App or organization token that can read
organization runner inventory. Until that token and the organization runner
group are configured, run this resolver before dispatch and do not describe
queued work as started or green. Wiring the resolver as an automatic hosted
admission dependency is the final migration step; the substantive job still
runs only on the selected self-hosted machine.

## Provision a Linux host

Review the plan first:

```bash
sudo env \
  GITHUB_ORG=metasession-dev \
  RUNNER_GROUP=metasession-ci \
  RUNNER_LABEL=metasession-ci-remote-01 \
  RUNNER_USER=metasession-ci \
  CAPABILITIES=cap-node,cap-playwright,cap-railway \
  bash scripts/runner-host/bootstrap-linux.sh --plan
```

Then rerun with `--apply`. The command installs baseline packages, applies
inotify settings, downloads the current GitHub runner, registers it at
organization scope, writes `/opt/metasession-ci/state/capabilities.json`, and
installs the runner as a persistent service. The GitHub CLI identity executing
the command must be authorized to create organization registration tokens.

Use the same logical labels and capability file on future macOS or Windows
hosts, but follow GitHub's OS-native runner service installation until matching
bootstrap scripts are added. Do not label a host with a capability it has not
passed.

## Readiness and capabilities

Run after provisioning, upgrades, or host recovery:

```bash
sudo -u metasession-ci \
  bash scripts/runner-host/verify-runner-host.sh
```

The check verifies required commands, Python venv support, writable cache
storage, a valid capability declaration, and Linux inotify capacity. Native
MongoDB, PostgreSQL, Redis, Docker, Railway, and Playwright support are explicit
capabilities rather than hidden machine assumptions.

## Per-machine, per-repository caches

Each machine owns independent caches. Nothing requires another laptop or server
to be online:

```text
/opt/metasession-ci/cache/<owner>/<repository>/
  npm/
  node_modules/
  playwright/
  build/
```

At job start, run:

```bash
bash scripts/runner-host/prepare-repository-cache.sh
```

The helper validates the host capability file, creates the repository-isolated
cache, exports `npm_config_cache`, `PLAYWRIGHT_BROWSERS_PATH`, and
`DEVAUDIT_REPO_CACHE` through `GITHUB_ENV`, and removes known untracked build
outputs. It does not use `git reset --hard` or broad `git clean`, and it does not
delete approved caches. Dependency reuse must include lockfile, Node, npm, OS,
and architecture in its fingerprint and validate the installed tree before
reuse.

## Outage and replacement runbook

1. Run the online resolver for the repository's configured label.
2. If offline, inspect the host service with `svc.sh status` and its service
   logs; restart it and rerun readiness.
3. If the host will remain offline, change repository variable
   `CI_RUNNER_LABEL` to another ready machine, or manually dispatch with
   `runner_label`.
4. Rerun the cancelled/failed workflow. Do not alter the code SHA or report
   queued work as green.
5. To replace a host, remove its organization runner registration, run
   `bootstrap-linux.sh --apply` on the replacement with a new unique label,
   verify readiness, update the repository variable, and run a smoke workflow.
6. Test failover and cache reuse with two consecutive runs on every enrolled
   host. Record runner name, label, workflow URL, and cache hit/miss in the
   infrastructure change issue.

At least one runner should normally remain online. Additional machines may be
offline without affecting repositories pinned to an online machine.

Do not weaken E2E coverage, disable Turbopack checks, or mock the web server to
avoid this failure. Repair the host and rerun CI.
