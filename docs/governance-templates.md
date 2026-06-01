# Governance evidence templates

> ⚠️ **These templates are starting points, not defensible audit evidence.**
> `devaudit install` drops five stub markdown files into your `compliance/governance/` directory on first onboarding. Each one carries a prominent **STARTER TEMPLATE — REPLACE BEFORE GOING TO PRODUCTION** banner at the top. **Edit each file to reflect your project before your first audit.** Auditors will reject an unedited stub.

This doc lists every governance starter we ship, groups them by the compliance framework they support, and points at authoritative external references for replacing the stub content with content that fits your project.

## What gets installed

On first install, `devaudit install` (step 11/12, **Bootstrap governance docs**) copies five starter templates into your repo:

| File on disk | Evidence type uploaded | Refresh cadence |
|---|---|---|
| `compliance/governance/ropa.md` | `ropa` | 365 days |
| `compliance/governance/dpia.md` | `dpia` | 365 days |
| `compliance/governance/ai-disclosure.md` | `ai_disclosure` | 180 days |
| `compliance/governance/incident-report.md` | `incident_report` | per incident |
| `compliance/governance/periodic-review.md` | `periodic_review` | 90 days (portal flags `expired` after 365) |

**Key behaviour:**

- **First-install only.** `devaudit update` does **not** re-sync these files. Once you've edited a stub it's yours; we never overwrite.
- **Idempotent.** Re-running `devaudit install` on a project where the file already exists leaves it alone.
- **Upload path is already wired.** Every push to `develop` triggers `compliance-evidence.yml`, which calls `upload_governance` (added in v0.1.26). If a file exists at one of the expected paths (`compliance/<name>.md` or `compliance/governance/<name>.md`), it uploads with the precise evidence type listed above.

## Coverage by framework

Each section below quotes the framework clauses the starter helps satisfy, links to the canonical predicate in the portal's registry, and lists the external sources you should consult when replacing the stub content.

### GDPR — EU General Data Protection Regulation (2016/679)

Two governance starters target GDPR.

| Clause | Title | Starter | What you must replace |
|---|---|---|---|
| `GDPR.Art-30` | Records of processing activities (ROPA) | `compliance/governance/ropa.md` | Every processing activity your project performs, with lawful basis, categories of data subjects + personal data, recipients, retention, security measures. |
| `GDPR.Art-35` | Data protection impact assessment (DPIA) | `compliance/governance/dpia.md` | Your actual risk analysis for high-risk processing — necessity, proportionality, risks-to-rights table, mitigations, residual-risk decision. |
| `GDPR.Art-33` + `Art-34` | Breach notification (supervisory authority + data subjects) | `compliance/governance/incident-report.md` | Filled in when an incident actually occurs. The same incident report can satisfy both Articles depending on its scope. |

**Replacing the stubs — sources:**

- [ICO ROPA template (UK)](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/documentation/records-of-processing/)
- [EDPB Guidelines on Article 30](https://edpb.europa.eu/our-work-tools/our-documents/guidelines/)
- [EDPB DPIA guidelines (WP248 rev.01)](https://edpb.europa.eu/our-work-tools/our-documents/guidelines/)
- [CNIL PIA software](https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment)
- [ICO breach reporting guidance](https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/)
- Portal registry: `META-COMPLY/lib/config/frameworks/gdpr.ts`

### EU AI Act — Regulation 2024/1689

| Clause | Title | Starter | What you must replace |
|---|---|---|---|
| `EUAIA.Art-13` | Transparency and provision of information to deployers | `compliance/governance/ai-disclosure.md` | Every AI tool / model / API your project incorporates, its intended purpose, capabilities, limitations, human oversight path, logging behaviour. |
| `EUAIA.Art-12` | Record-keeping (automatic logging) | (auto — covered by W2 audit-log snapshot in CI; see issue [#98](https://github.com/metasession-dev/DevAudit-Installer/issues/98)) | Not a governance doc — closed by the audit-log export evidence type. |
| `EUAIA.Art-14` | Human oversight | (auto — covered by `release.approved` audit events from the portal's four-eyes flow) | Not a governance doc — closed when releases are approved. |

**Replacing the stub — sources:**

- [EU AI Act (Regulation 2024/1689)](https://eur-lex.europa.eu/eli/reg/2024/1689/oj) — especially Title III (high-risk) and Title IV (transparency)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- Portal registry: `META-COMPLY/lib/config/frameworks/eu-ai-act.ts`

### SOC 2 — Trust Services Criteria

| Clause | Title | Starter | What you must replace |
|---|---|---|---|
| `SOC2.CC4.1` | Monitoring of internal controls | `compliance/governance/periodic-review.md` | Per-quarter control-effectiveness review with reviewer + approver sign-off and concrete findings. Auto-generated metrics will fill in when W3 ships (DevAudit-Installer [#98](https://github.com/metasession-dev/DevAudit-Installer/issues/98)); the human attestation is yours either way. |
| `SOC2.CC7.2` | System monitoring and incident response | `compliance/governance/incident-report.md` | Same file as GDPR breach notification — one report per incident, covering containment, root cause, lessons learned. |

**Replacing the stubs — sources:**

- [AICPA Trust Services Criteria](https://www.aicpa-cima.com/topic/audit-assurance/trust-services-criteria)
- Your own observability tooling output (GlitchTip, etc.) for the incident timeline
- Portal registry: `META-COMPLY/lib/config/frameworks/soc-2.ts`

### ISO/IEC 27001:2022 — Information Security Management

| Clause | Title | Starter | What you must replace |
|---|---|---|---|
| `ISO27001.A.12.1` | Operational procedures and responsibilities | `compliance/governance/periodic-review.md` | Same file as SOC 2 CC4.1 — one quarterly review covers both. Cross-reference your `Periodic_Security_Review_Schedule.md` items completed in the period. |

**Replacing the stub — sources:**

- [ISO/IEC 27001:2022](https://www.iso.org/standard/82875.html) — Annex A controls 5.1–8.34
- Your project's `Periodic_Security_Review_Schedule.md` (auto-synced into every consumer)
- Portal registry: `META-COMPLY/lib/config/frameworks/iso-27001.ts`

### ISO/IEC 29119 — Software Testing

| Clause | Title | Starter | What you must replace |
|---|---|---|---|
| `ISO29119.3.5.4` | Test incident report | `compliance/governance/incident-report.md` | Same file as the SOC 2 / GDPR incident report — for a *test* incident (a defect found during execution that warrants a recorded outcome), one report per incident. |

The other ISO 29119 clauses (Test Policy, Test Strategy, Test Plan, Test execution log, Test completion / summary report) are **already covered** by the SDLC framework — `Test_Policy.md`, `Test_Strategy.md`, per-REQ `test-plan.md`, CI-generated `e2e-results.json` / `playwright-report.zip`, and `compliance/test-summary-report.md`. No new starter needed.

**Replacing the stub — sources:**

- [ISO/IEC/IEEE 29119](https://www.iso.org/standard/45142.html)
- Portal registry: `META-COMPLY/lib/config/frameworks/iso-29119.ts`

## Workflow

```
First onboarding
   │
   ▼
devaudit install ─── step 11/12 ──▶ copies 5 starters into compliance/governance/
   │                                  (idempotent — does not overwrite)
   ▼
Operator reads docs/governance-templates.md  ◀── you are here
   │
   ▼
Operator edits each .md file to reflect their project
   │
   ▼
git add compliance/governance/ && git commit && push to develop
   │
   ▼
compliance-evidence.yml runs ──▶ upload_governance ──▶ portal receives evidence
                                                       with precise evidence_type
   │
   ▼
Framework coverage panel flips clauses to COVERED on the next release detail
```

## What about the `audit_log` and other auto-generated evidence?

Issue [#98](https://github.com/metasession-dev/DevAudit-Installer/issues/98) tracks four workstreams. This doc covers Workstream 1 (governance templates). The other three:

- **W2 — Audit log snapshot in CI** (closes `ISO27001.A.8.16`, `EUAIA.Art-12`, `GDPR.Art-32`): A new CI step exports the portal audit log for the release window and uploads as `audit_log`. **Auto-generated, no template needed.**
- **W3 — Periodic-review scheduled workflow** (closes `SOC2.CC4.1`, `ISO27001.A.12.1`): A quarterly cron auto-regenerates `compliance/governance/periodic-review.md` with portal metrics. The human attestation section is still yours.
- **W4 — Incident-report close-out hook** (closes the automated arm of `ISO29119.3.5.4`, `SOC2.CC7.2`, `GDPR.Art-33`, `GDPR.Art-34`): When you close a GitHub issue labelled `incident`, a workflow exports its body to `compliance/governance/incident-report-<id>.md`. Operator-authored arm (W1) remains the recommended default for high-severity incidents.

## See also

- [`docs/sdlc-framework.md`](./sdlc-framework.md) — the wider SDLC framework, with the per-REQ evidence model
- [`docs/onboarding.md`](./onboarding.md) — the onboarding checklist that points operators back here
- [`SDLC/joining-an-existing-project.md`](../sdlc/files/_common/joining-an-existing-project.md) — for second developers (templates are never overwritten by `devaudit update`)
- [`compliance-evidence.yml.template`](../sdlc/files/ci/compliance-evidence.yml.template) — the workflow that picks up edits and uploads them
