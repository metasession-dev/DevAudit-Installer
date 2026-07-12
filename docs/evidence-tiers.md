# Evidence Tiers

DevAudit separates evidence by both storage medium and purpose. The goal is simple: keep Git reviewable, keep CI evidence durable, and keep the portal as the release-shaped audit surface.

## The three tiers

| Tier | Typical content | Lives where | Why |
| --- | --- | --- | --- |
| Tier 1 | Universal SDLC policy and framework docs | Framework repo and synced consumer docs | Shared rules and baseline process; not release-specific |
| Tier 2 | Persistent project source-of-truth docs | Consumer repo (`docs/`, `compliance/`, `SDLC/`) | Human-reviewable, versioned, and maintained over time |
| Tier 3 | Release- or requirement-scoped evidence | Consumer repo for markdown, portal for large/binary artifacts | The per-change proof that a release actually satisfied the SDLC |

## Storage rule

The practical storage rule is:

- markdown and other small reviewable artifacts stay in git
- binary and large machine-produced artifacts go to the portal through CI or upload scripts

Examples from a tracked release:

| Artifact | Tier | Storage |
| --- | --- | --- |
| `docs/SRS.md` | 2 | Git |
| `docs/ADR/ADR-NNN-*.md` | 2 | Git |
| `compliance/risk-register.md` | 2 | Git |
| `compliance/evidence/REQ-XXX/test-plan.md` | 3 | Git |
| `compliance/evidence/REQ-XXX/test-execution-summary.md` | 3 | Git |
| `compliance/evidence/REQ-XXX/srs-alignment.md` | 3 | Git |
| `compliance/evidence/REQ-XXX/architecture-decision.md` | 3 | Git |
| `compliance/evidence/REQ-XXX/risk-assessment.md` | 3 | Git |
| SAST JSON, dependency-audit JSON, E2E JSON, HTML reports, screenshots | 3 | Portal |

## Two upload paths

There are two normal upload paths into the portal:

| Upload path | Producer | Typical evidence |
| --- | --- | --- |
| CI-uploaded | GitHub Actions workflows | Gate outputs, machine-generated reports, production smoke, release registration context |
| Operator/repo-uploaded | committed markdown or explicit uploads | Test plans, release tickets, governance docs, scoped release evidence |

This is why the same release can show both:

- CI-origin evidence proving what the pipeline ran
- repo-authored markdown proving the human planning and review trail

## Why the split exists

- Git stays readable and code-reviewable.
- Large JSON, screenshots, archives, and reports do not bloat repo history.
- Reviewers can inspect a release from one portal page instead of pulling artifacts from multiple systems.
- Auditors get a scoped release record rather than a generic artifact bucket.

## Release shapes and tiers

### Tracked release

Tracked `REQ-XXX` releases use all three tiers:

- Tier 1 framework rules govern the process
- Tier 2 SoT docs stay current
- Tier 3 evidence proves that specific requirement's release

### Housekeeping release

Housekeeping releases skip the per-REQ Tier 3 pack, but still require release-scoped Tier 3 evidence such as:

- `RELEASE-TICKET-<version>.md`
- `security-summary-<version>.md`
- CI gate evidence

## See also

- [`docs/compliance-gates.md`](./compliance-gates.md)
- [`docs/change-workflows.md`](./change-workflows.md)
- [`sdlc/src/blueprints/3-compile-evidence.raw.md`](../sdlc/src/blueprints/3-compile-evidence.raw.md)
