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

**Critical and regression carry distinct portal check labels** — `E2E Critical (pre-merge)` and `E2E Regression (post-deploy production)` respectively (devaudit-installer#787). Before this, both tiers reported under the identical `E2E Regression` label/workflow/job name everywhere a human looked, so a reviewer looking at a develop→main PR — where a regression-tier check is structurally guaranteed absent because production doesn't exist yet — had no way to tell "this is fine, that tier just hasn't run yet" from "something is actually wrong." The workflow's own `name:` field and job name are unchanged (renaming those risks breaking a consumer's existing branch-protection required-check-name reference) — only the portal-facing check label built in `compliance-evidence.yml.template` is tier-aware. A consumer running an `e2e-regression.yml` copied before this fix needs to re-sync `compliance-evidence.yml` (`devaudit update`) to pick up the distinct labels.

## What DevAudit ships today

The generated framework requires the blocking E2E gate in `ci.yml`.

The broader three-tier pattern is documented and available as a reference workflow through the `e2e-test-engineer` skill materials:

- [`docs/e2e-local-db-ci.md`](./e2e-local-db-ci.md) for safe local/disposable backends in CI
- [`sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml`](../sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml) for the optional smoke/critical/regression split

## Opting into the 3-tier regression gate

Most projects don't need this — the blocking smoke gate above is mandatory and on by default. This is an opt-in stronger safety net (a full pack that runs at ~55 minutes), for projects that want pre-merge `critical` protection and/or a post-deploy `regression` sweep on top of smoke.

1. **Flip the config and regenerate CI in one step** (devaudit-installer#876): `devaudit update --enable-e2e-regression <path>`. This sets `e2e_regression_enabled: true` in `sdlc-config.json` and syncs, which generates `e2e-regression.yml` plus the matching `compliance-evidence.yml` listener (gated per #869) — no manual JSON edit needed.
2. **Add `critical`/`regression` named projects to your own `playwright.config.ts`.** The CLI step above only flips the config and regenerates CI — it does not, and cannot generically, scaffold the actual test projects; that's real test authorship, left to the operator/agent. Without this, the generated workflow has nothing to run.
3. **Run `devaudit doctor` to self-verify.** Its existing `e2e-regression` check (`checkE2eRegressionConsistency`) catches drift between the flag and the Playwright config in either direction — flag on with no matching Playwright projects, or Playwright projects present with the flag still off.
4. **Turn it back off** with `devaudit update --disable-e2e-regression <path>` — sets the flag back to `false` and removes the generated workflow cleanly (it does not linger as dead CI content).

A plain `devaudit update` with neither flag never touches `e2e_regression_enabled` — it's pure opt-in, not something a routine sync can silently flip.

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
