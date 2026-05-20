<!--
SDLC-aware PR template for the DevAudit-Installer repo (CLI, plugin SDK,
first-party plugins, SDLC framework templates).

For chore PRs (Task issues), delete the REQ / Risk / Evidence sections and
keep only Summary + Test plan + the gate-discipline checklist.
-->

## Summary

<!-- 1–3 sentences. What changes, and why. -->

## Linked issue (REQUIRED)

Closes #

## Which surface

<!-- Tick all that apply. -->

- [ ] CLI (`cli/`)
- [ ] Plugin SDK (`plugin-sdk/`)
- [ ] First-party plugin (`plugins/devaudit-plugin-*/`)
- [ ] Framework templates (`sdlc/files/`)
- [ ] Stack/host adapter
- [ ] Installer bash scripts (`scripts/`)
- [ ] Docs only
- [ ] CI workflows / release pipeline

## Semver impact

<!-- Required when the change touches CLI, plugin SDK, or plugin packages. "n/a" for docs / template-only PRs. -->

- [ ] No public API change — patch only
- [ ] Additive API change — minor bump
- [ ] Breaking API change — major bump + migration note
- [ ] n/a (docs / templates)

## Test plan

<!-- Bulleted checklist. CI runs the matrix automatically; this is the narrative the human reviewer follows. -->

- [ ]
- [ ]
- [ ]

## SDLC checklist

<!-- All required boxes must be checked before the reviewer hits Approve. -->

- [ ] `npm test` passes in every affected package (cli / plugin-sdk / plugins/*)
- [ ] `npx tsc --noEmit` clean
- [ ] Lockfiles committed (the `file:` rewrite happens in CI; local dev keeps `file:` refs)
- [ ] For new SDLC artefacts (skills, adapters, templates): `node scripts/validate-adapter.cjs --all` clean
- [ ] CHANGELOG entry per affected package (Requirement PRs)
- [ ] Conventional Commit format on every commit; `Co-Authored-By:` trailer where an AI tool contributed substantively
- [ ] No bypass-the-gate patterns: no `--no-verify`, no `eslint-disable`, no `@ts-expect-error`, no `xfail`

## Notes for reviewer

<!-- Known weirdness, deferred follow-ups, intentional non-decisions to flag. -->
