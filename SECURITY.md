# Security Policy

## Reporting a vulnerability

**Please do not open public GitHub issues for security reports.** Issues are visible to anyone watching the repo and would let bad actors see the problem before there's a fix.

Use one of these channels instead:

1. **GitHub Security Advisories** — preferred. Go to the [Security tab](https://github.com/metasession-dev/DevAudit-Installer/security/advisories/new) of this repository and open a private advisory. We'll see it directly.
2. **Email** — `security@metasession.co`. We respond within two business days.

When reporting, please include:

- A description of the vulnerability and the impact you've observed (or believe is possible).
- Steps to reproduce. A minimal repro repo or commit pointer is ideal.
- The affected component: `cli`, `plugin-sdk`, a specific plugin under `plugins/`, or the SDLC templates under `sdlc/`.
- Whether you've shared details elsewhere, and any timeline you have in mind for public disclosure.

## What is in scope

- The `devaudit` CLI (`cli/`)
- The plugin SDK (`plugin-sdk/`)
- First-party plugins under `plugins/`
- SDLC framework templates and installer scripts (`sdlc/`, `scripts/`)
- CI workflows under `.github/workflows/`

## What is not in scope (here)

- The DevAudit web portal lives in a separate private repository (`metasession-dev/META-COMPLY`). Vulnerabilities affecting the running service at `devaudit.metasession.co` belong there. Use the same email above; the security team handles both repos.
- Vulnerabilities in upstream dependencies (npm packages, GitHub Actions, etc.) — please report those to the upstream projects. We track them via Dependabot and patch on our side as updates ship.
- Issues with consumer projects that have onboarded the SDLC. Those go to the consumer's own security contact.

## Supported versions

This project is pre-1.0 and not yet published to a package registry. Today there is one supported channel: the `main` branch. Once the CLI publishes a v1.x line we'll list which majors receive security fixes here.

## Disclosure

We aim to acknowledge a report within two business days, assess severity within five business days, and ship a fix as soon as we have one validated. We coordinate disclosure with reporters: typically a 90-day window from acknowledgement, shortened if a fix is already in users' hands and lengthened if more time is genuinely needed.
