# Incident export: Path A vs. Path B

What happens when a GitHub issue labelled `incident` gets closed, why some produce a quiet commit and others open a PR demanding GDPR sign-off, and what to actually do when that PR shows up.

## What triggers an export

Any issue labelled `incident` that gets **closed** triggers `.github/workflows/incident-export.yml`. This applies to defects filed manually (by an operator or a skill like `e2e-test-engineer`) and to defects filed automatically by CI's own regression-detection step in `compliance-evidence.yml.template`.

The issue body must contain a `### Framework attribution` section — a checklist of which compliance clauses this incident's evidence report should attribute to:

```markdown
### Framework attribution

- [x] `ISO29119.3.5.4` (baseline — every incident_report)
- [ ] `SOC2.CC7.2` — ops impact
- [ ] `GDPR.Art-33` — personal data scope
- [ ] `GDPR.Art-34` — data-subject notification required
- [ ] `EUAIA.Art-9 / Art-14 / Art-15` — AI failure
```

`ISO29119.3.5.4` (test incident report) is mandatory and always ticked — even a defect with no other framework impact still produces a valid incident record. The other four ticks reflect what actually happened, not what the bug touches or could theoretically have caused.

## Path A vs. Path B

Routing depends entirely on which boxes are ticked when the issue closes:

- **Path A (baseline-only)** — only `ISO29119.3.5.4` is ticked. The workflow direct-commits `compliance/governance/incident-report-<N>.md` straight to `develop`. No PR, no review required. GDPR triage is pre-filled as N/A. The next `compliance-evidence.yml` run uploads it as `incident_report` evidence.
- **Path B (anything else ticked)** — any of `SOC2.CC7.2`, `GDPR.Art-33`, `GDPR.Art-34`, or an `EUAIA.*` clause is ticked (or the `### Framework attribution` section is missing entirely, which defaults conservatively to Path B). The workflow opens a PR with `REPLACE` markers in the GDPR-triage and sign-off sections, and **that PR is deliberately not auto-mergeable** — a personal-data or ops-impact determination is load-bearing, and an auto-generated answer isn't defensible to an auditor. A human has to actually look at it.

Path B existing is correct and intentional. The problem this doc exists to explain is what happens when Path B triggers for things that don't need it.

## Why you might see more Path B PRs than expected

If `SOC2.CC7.2` (or worse, nothing) gets ticked on every single defect regardless of what actually happened, every defect goes through Path B — and if nobody's reviewing them, they pile up. This is exactly what happened in practice: CI's own automated regression-detection step (`compliance-evidence.yml.template`) used to hardcode `[x] SOC2.CC7.2` on every auto-filed incident, with the rationale "a regression in production-adjacent code is an ops concern." That reads broadly enough to cover almost any e2e failure — including ones caught pre-merge in CI that never reached production, never triggered real monitoring, and were never a live incident. The result was dozens of unreviewed Path B PRs sitting open (see [devaudit-installer#899](https://github.com/metasession-dev/DevAudit-Installer/issues/899)).

That template no longer hardcodes the tick — auto-filed incidents now default to Path A (baseline-only), and a human confirms `SOC2.CC7.2` only if the regression actually reached production. The same standard applies whether an issue was filed by CI or by a person: **tick `SOC2.CC7.2` for an observed production/live-system event you can point to, not because the code path matters or the bug would have been bad if it shipped.** See `e2e-test-engineer/SKILL.md`'s incident-classification table for the full guidance and worked examples used when filing manually.

## What to do when a Path B PR appears

1. Open the PR. It contains the exported `compliance/governance/incident-report-<N>.md` with `REPLACE` markers.
2. Re-check the attribution ticks first, before anything else — if `SOC2.CC7.2` (or a GDPR/EUAIA clause) was ticked but this was actually a routine, contained CI-caught regression, untick it and edit the file's frontmatter/body to match, rather than filling in a GDPR triage table for an incident that never needed one. If a genuine production/PII event *is* involved, keep it ticked and proceed to step 3.
3. Fill in the `REPLACE` markers: the GDPR-triage table (personal data Y/N, affected data subjects, notification decisions), the frontmatter `severity`, and the sign-off table (Incident Commander, Engineering lead, DPO if personal data is involved, Security lead).
4. Merge. The next `compliance-evidence.yml` run picks up the committed file and uploads it as `incident_report` evidence.

## See also

- [`docs/governance-templates.md`](governance-templates.md) — the governance starter templates this evidence model feeds into.
- `e2e-test-engineer/SKILL.md`'s incident-classification table — the canonical classification guidance for manually-filed defects, including worked examples.
- [devaudit-installer#899](https://github.com/metasession-dev/DevAudit-Installer/issues/899) — the over-attribution bug and fix this doc explains.
