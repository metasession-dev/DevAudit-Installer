# Your CI Is Creating Releases Nobody Asked For

**Long-form parent:** When Your CI Creates More Releases Than Your Developers
**Platform:** LinkedIn, Dev.to
**Read time:** ~2 minutes

---

You open your compliance portal on Monday morning. Three new release records are waiting for sign-off. Nobody on your team shipped a feature over the weekend.

What happened? `devaudit update` synced templates on Saturday. Dependabot bumped a dependency on Sunday. A docs commit landed Friday evening. Each pushed to `develop`, each triggered CI, and each created a housekeeping release — complete with auto-generated release tickets, security summaries, and a sign-off PR.

The releases are real. The evidence is valid. The gates ran. But your reviewers are now signing off on changes that a machine generated, not changes a human decided to ship.

## The root cause

DevAudit's version deriver tries five strategies to attribute a commit to a release — REQ tag in the subject, `Ref:` line, bracketed tag, pending release ticket, RTM in-progress row. When all five fail (which they do for every `chore:` commit), it falls back to a bare date: `v2026.06.25`. The `register-release` job then calls `--create-release-if-missing`, and the portal creates a release record.

This was designed for human-authored housekeeping — a developer pushing `chore: bump eslint`. It was not designed for `devaudit update` pushing `chore: sync DevAudit templates from v0.1.69 to v0.1.70`. The system can't tell the difference.

## The fix

Two changes:

1. **`devaudit update` syncs include `[skip ci]`** — GitHub Actions skips the workflow, no release is created. The synced files are tested when the next feature commit triggers the full gate suite (the gates test the complete `develop` state, not just the triggering commit).

2. **The next REQ release explicitly documents what it absorbed** — a new `generate-bundled-changes.sh` script scans commits since the last release, identifies housekeeping commits, and uploads a summary as evidence against the REQ release.

The portal shows one clean release for REQ-042 with a "Bundled Changes" section listing the template sync, dependency bump, and docs update it absorbed. No scatter of housekeeping releases. No sign-off theatre on machine-generated changes. The audit trail is **stronger** — an auditor sees exactly what rode along with each feature release, consolidated in one place.

Human-authored `chore`/`docs` commits still create housekeeping releases as before. The housekeeping path is preserved for its intended purpose: operator-authored ticketless work.

## Why this matters

Not every push to `develop` is a release. Template syncs are infrastructure maintenance. Dependency bumps are hygiene. Docs updates are housekeeping in the literal sense. These are the environment in which releases happen — not releases themselves.

Compliance automation should capture operator intent, not machine activity. When your portal has more releases from `devaudit update` than from your developers, the signal-to-noise ratio is broken. The bundled changes approach fixes it: releases are human decisions, everything else is context.

---

*Read the full article → devaudit.ai/blog/housekeeping-release-noise*

*See the SDLC → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)*
