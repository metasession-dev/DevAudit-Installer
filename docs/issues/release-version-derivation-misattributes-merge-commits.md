# `derive-release-version.sh` silently misattributes standard merge-commit CI runs to a bare-date housekeeping release instead of the tracked REQ release

## Background

`scripts/derive-release-version.sh` decides which `compliance_releases` row a
given CI run's evidence and required checks (including the aggregate `Quality
Gates` check covering SAST scan, dependency audit, TypeScript, and lint) get
attached to. It's called once per `ci.yml` `register-release` run and reads
only the **latest commit's** subject/body, in priority order:

1. `[REQ-XXX]` in the commit subject.
2. `Ref: REQ-XXX` on its own line in the body.
3. A bracketed `[REQ-XXX]` anywhere in the body (catches a "Merge pull
   request" commit whose body is the PR title).
4. Exactly one `compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md` on
   disk — **gated behind `DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK=1`, off by
   default**.
5. Exactly one `IN PROGRESS` row in `compliance/RTM.md` — **same env-var
   gate, off by default**.
6. Fallback: bare date (`v2026.07.27`), i.e. "this is just housekeeping."

Steps 4 and 5 exist specifically to rescue the case where steps 1-3 miss a
real, in-flight REQ. Both are opt-in.

## What happened

`wawagardenbar-app` REQ-095 (issue #603), follow-up PR #606. The merge
commit landed on `develop` as:

```
Merge pull request #606 from metasession-dev/fix/603-req095-post-merge-regression-fixes

fix(reports): resolve cutoff-attribution/export regressions REQ-095 missed; fix order-number race
```

- Step 1 fails: no bracketed tag in the subject.
- Step 2 fails: "REQ-095" appears in the body, but as unbracketed prose, not
  a `Ref:` line — by design, prose must not win over a real `Ref:`
  (correct behavior in isolation, see `e2e-gate-verifies-recency-not-relevance.md`
  precedent on trusting only structured signals).
- Step 3 fails: no brackets anywhere in the body either.
- Steps 4 and 5 would both have resolved this correctly — exactly one
  `RELEASE-TICKET-REQ-095.md` existed in `pending-releases/`, and exactly one
  RTM row was `IN PROGRESS` for REQ-095 — but `DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK`
  was never set anywhere in this repo's CI config, so neither ran.
- Step 6 fired: version resolved to the bare-date fallback `v2026.07.27`.

Result: the `Quality Gates` check for commit `14de0d3a` (GitHub Actions run
`30251621854`, `success` — SAST scan and dependency audit both genuinely
passed) was recorded against the auto-created `v2026.07.27`
`integration_housekeeping` release, not against the `REQ-095` `tracked`
release. When the operator submitted REQ-095 for UAT review, the portal
showed SAST scan and dependency audit as **missing**, even though they had
already run and passed on the exact commit under review — the evidence
existed, just filed under the wrong release id. This was only caught by
querying the `compliance_releases` / `compliance_release_checks` tables
directly and comparing the two sibling release rows for the same project on
the same day.

## Root cause

Same class of gap as `e2e-gate-verifies-recency-not-relevance.md`
(installer#578), `feature-e2e-branch-name-detection-silently-skippable.md`
(installer#580), and `stage2-independent-review-not-enforced.md`
(installer#579): a real, correctly-functioning mechanism that is silently
bypassable by an unremarkable, common case — here, GitHub's own default
"Merge pull request" commit shape — with no warning emitted, and with the
one purpose-built rescue mechanism switched off by default.

Additionally, standard GitHub merge commits (as opposed to squash-merges)
never carry the underlying commits' `Ref: REQ-XXX` trailers in the merge
commit body at all — only the PR title. Any repo using "Create a merge
commit" as its merge strategy (rather than "Squash and merge") will hit this
on every multi-commit PR whose title doesn't happen to include a bracketed
`[REQ-XXX]` tag.

## Proposed solutions

### Option A — Default the fallback on
Steps 4/5 already have a conservative "exactly one candidate, else fall
through" guard, so enabling them by default doesn't introduce ambiguity risk
beyond what's already handled. Flip `DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK`
to default `1`, opt-out instead of opt-in.

### Option B — Warn when falling through despite a live candidate
Independent of A: if step 6 is reached while a pending ticket or an
`IN PROGRESS` RTM row exists (i.e., the fallback *would* have matched had it
been enabled, or matched ambiguously with >1 candidate), emit a visible
`::warning::` naming the candidate(s) skipped, instead of a silent bare-date
resolution.

### Option C — Scan the merge-range, not just HEAD
Extend steps 1-3 to scan all commits in `origin/<base>...HEAD` (the same
range `compliance-evidence.yml`'s E2E-evidence step already scans for
exactly this reason) for a `Ref: REQ-XXX` trailer, not just the tip commit.
This would resolve standard merge commits correctly without depending on the
disk-based fallback at all, and is consistent with the fix recommended for
the sibling gap in installer#580.

## Recommended approach

**C, then B as defense-in-depth.** Range-scanning removes the dependency on
merge-commit shape entirely (the individual commits inside PR #606 all
correctly carried `Ref: REQ-095` trailers — commitlint enforced it). B
covers the remaining genuinely-ambiguous or off-convention case so it's
visible rather than silent. A is a reasonable interim mitigation if C isn't
ready, but doesn't fix repos using squash-merge-less commit ranges the same
way C does.

## Required changes

1. `scripts/derive-release-version.sh` — add range-scanning (Option C) ahead
   of the disk-based fallbacks.
2. Add the visible-warning step (Option B) when step 6 is reached despite a
   resolvable candidate existing.
3. Consider flipping `DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK`'s default
   (Option A) as an interim measure for repos not yet updated.
4. `sdlc/files/ci/ci.yml.template` — regenerate/propagate via `devaudit
   update`.

## Acceptance criteria

- [ ] A standard "Merge pull request" commit whose underlying commits carry
      `Ref: REQ-XXX` trailers (but whose own subject/body don't) resolves to
      `REQ-XXX`, not a bare-date fallback.
- [ ] When resolution still falls through to bare-date despite a pending
      ticket or `IN PROGRESS` RTM row existing, a visible warning is posted.
- [ ] Existing bracketed-tag and `Ref:` detection continue to work
      unchanged.
- [ ] Test: a merge commit shaped exactly like PR #606's, feeding commits
      with `Ref: REQ-095` trailers, resolves to `REQ-095`.

## References

- `wawagardenbar-app` REQ-095 / issue #603 / PR #606 — concrete incident:
  merge commit `14de0d3a`, CI run `30251621854` (`Quality Gates`, success)
  attached to housekeeping release `v2026.07.27` instead of tracked release
  `REQ-095`; discovered by direct `compliance_releases` /
  `compliance_release_checks` inspection after UAT submission showed SAST
  scan and dependency audit as missing.
- `scripts/derive-release-version.sh` — priority-ordered REQ resolution,
  steps 4/5 gated behind `DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK`.
- `.github/workflows/ci.yml` — `register-release` job, `Determine release
  version` step; `Complete primary quality-gate execution` step (the
  `Quality Gates` check dispatch that inherits the misattributed version).
- `docs/issues/feature-e2e-branch-name-detection-silently-skippable.md`
  (installer#580) — sibling gap, same incident's PR, same underlying lesson
  (branch/commit-shape-dependent REQ detection needs a structured,
  range-scanned source of truth, not a single-commit heuristic).
