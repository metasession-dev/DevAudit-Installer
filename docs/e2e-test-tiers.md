# E2E Test Tiers

DevAudit distinguishes between fast blocking E2E coverage and broader regression coverage. The point is to keep PR feedback fast without pretending that every end-to-end assertion belongs in the same gate.

## The tier model

| Tier | When it runs | Purpose | Typical scope |
| --- | --- | --- | --- |
| Smoke | Every push to `develop` via the main CI gate | Fast signal that the app starts and the main happy path still works | Health path, boot path, one or two core journeys |
| Critical | PR to `main` when configured | Pre-merge protection for must-not-break flows | High-value authenticated or business-critical journeys |
| Regression | Post-merge and scheduled runs when configured | Broad coverage and hotfix discovery | Full pack, lower-frequency but wider blast radius |

## How the tiers relate

- Smoke is the minimum blocking E2E gate.
- Critical is a pre-merge expansion of smoke for teams that need a stronger PR gate.
- Regression is the wide net. It is allowed to be slower because it does not have to run on every `develop` push.

## What DevAudit ships today

The generated framework requires the blocking E2E gate in `ci.yml`.

The broader three-tier pattern is documented and available as a reference workflow through the `e2e-test-engineer` skill materials:

- [`docs/e2e-local-db-ci.md`](./e2e-local-db-ci.md) for safe local/disposable backends in CI
- [`sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml`](../sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml) for the optional smoke/critical/regression split

## Screenshot density across tiers

DevAudit also distinguishes between feature-proof captures and regression-proof captures:

- feature runs can record denser screenshot evidence to prove a new flow
- regression runs should keep the canonical proof points and avoid re-capturing low-value intermediate noise

That distinction is carried through the `evidenceShot` helper and the `feature` vs `regression` origin metadata.

## Practical guidance

- Put the fastest, highest-signal journeys into smoke.
- Promote only genuinely business-critical paths into critical.
- Keep the full pack for regression, then use failures there to decide whether a spec should be promoted upward.
- Do not use regression-size suites as a per-push gate if the feedback cost becomes the dominant burden.

## See also

- [`docs/e2e-local-db-ci.md`](./e2e-local-db-ci.md)
- [`docs/compliance-gates.md`](./compliance-gates.md)
- [`sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`](../sdlc/files/_common/skills/e2e-test-engineer/SKILL.md)
