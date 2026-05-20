<!--
SDLC-compliant PR template. Fields marked (REQUIRED) are mandatory for Requirement/Bug PRs.
For chores using the trivial-change escape hatch (TASK issues), delete the REQ / Risk /
Evidence / Four-eyes / Rollback sections and keep only the Summary + Test plan.

Reference: https://github.com/metasession-dev/devaudit/blob/main/docs/implementing-an-sdlc-issue.md
-->

## Summary

<!-- 1–3 sentences. What changes, and why. -->

## Linked issue (REQUIRED)

Closes #

## REQ (REQUIRED for Requirement and high-risk Bug PRs; "n/a" for trivial Task PRs)

REQ-

## Risk class (REQUIRED for Requirement and Bug PRs)

<!-- LOW | MEDIUM | HIGH | CRITICAL — per the implementation plan -->

Risk:

## Evidence link (REQUIRED for Requirement and Bug PRs)

<!-- https://devaudit.metasession.co/projects/<slug>/requirements/REQ-XXX -->

Evidence:

## Four-eyes attestation (REQUIRED for HIGH and CRITICAL risk only)

<!-- @username — second reviewer who has signed off on the implementation plan. -->

Reviewer:

## Rollback plan (REQUIRED for HIGH and CRITICAL risk only)

<!-- One paragraph. What reverts the change if production smoke fails or an incident is declared.
     Reference: compliance/plans/REQ-XXX/implementation-plan.md §Rollback -->

## Test plan

<!--
Bulleted checklist of tests / verifications. CI runs the gates automatically; this is the
narrative the human reviewer follows to confirm the change does what the issue asked.
-->

- [ ]
- [ ]
- [ ]

## SDLC checklist (REQUIRED)

<!-- All required boxes must be checked before the reviewer hits Approve. -->

- [ ] All quality gates pass locally (per the consumer project's stack adapter: type-check, lint, unit + e2e tests, SAST, dep audit)
- [ ] `compliance/RTM.md` updated (Requirement / Bug PRs)
- [ ] Evidence uploaded to the portal under REQ-XXX (Requirement / Bug PRs)
- [ ] Conventional Commit format with `Ref: REQ-XXX` trailer in every commit (Requirement / Bug PRs)
- [ ] `Co-Authored-By: …` trailer present on commits where an AI tool contributed substantively
- [ ] No bypass-the-gate patterns: no `--no-verify`, no `eslint-disable`, no `@ts-expect-error`, no `xfail`

## Notes for reviewer

<!-- Anything that helps the review go faster — known weirdness, deferred follow-ups,
     intentional non-decisions to flag. -->
