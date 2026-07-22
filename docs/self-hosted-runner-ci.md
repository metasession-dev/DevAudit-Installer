# Self-Hosted Runner CI Prerequisites

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

## Runner selection

The generated workflows preserve the consumer's configured runner. If a project
uses self-hosted runners, the selected machine must satisfy this prerequisite
before accepting CI jobs.

Do not weaken E2E coverage, disable Turbopack checks, or mock the web server to
avoid this failure. Repair the host and rerun CI.
