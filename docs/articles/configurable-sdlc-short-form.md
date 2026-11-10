# One Process, Many Shapes: An SDLC That Fits Your Team

**Long-form parent:** One Process, Many Shapes: How DevAudit's SDLC Bends to Your Team, and What It Refuses to Bend
**Platform:** LinkedIn, Dev.to
**Read time:** ~2 minutes

---

A solo developer and a team with a compliance lead should not follow the same SDLC. Give them one and the solo dev skips it, or the team fails its audit.

In [DevAudit](https://devaudit.ai) the process is a set of settings in a file in your repo.

**What you can change**
- Who approves a release: the author (gap recorded) or a different person
- What blocks it: smoke, critical or the full test pack
- Where it runs: Railway, Vercel or your own deploy command
- Which standards you evidence: SOC 2, ISO 27001, ISO 29119, GDPR, EU AI Act
- Whether a human UAT pack is written: by risk, always or never

Start from one of four presets, or `custom`. Change one setting with `devaudit configure set`; it validates the value and shows what the next update will regenerate.

```
devaudit configure set approval.mode dual_actor
devaudit configure set release_gate_tier full
```

**What does not change**
- The approval gate on the release PR is always on
- The evidence format and the clause mapping are the same for every project
- A weaker choice records itself. Self-approval is logged as a gap against SOC 2 CC8.1 and ISO 27001 A.8.32 instead of hidden

**How it is checked**
- Eleven validators refuse values that cannot work
- `devaudit doctor` flags a project that drifted from its preset, or whose standards don't fit its approval setting
- Each release is run against clean fixtures and read-only clones of real consumer repos. The 1.13.0 run caught a diagnostic report cut off at 64 KiB before it shipped

A local edit is never overwritten: it is kept, and the new version is written beside it for review.

Read the full article → devaudit.ai/blog/configurable-sdlc

#SDLC #DevOps #Compliance
