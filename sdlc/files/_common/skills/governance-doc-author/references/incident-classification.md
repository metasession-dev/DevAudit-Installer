# Incident Classification — framework attribution decision tree

Used by both `e2e-test-engineer` (when filing defects) and `governance-doc-author` (when authoring the project-level incident-report template). Single source of truth so the two skills don't drift.

## Decision tree

Every `incident_report` evidence row closes `ISO29119.3.5.4` (baseline). Additional clauses depend on the incident's scope.

| Defect / incident characteristic | Frameworks/clauses attributed |
|---|---|
| **Any test failure / defect** (baseline — always) | `ISO29119.3.5.4` Test incident report |
| **Ops impact** (downtime, persistent errors, perf regression, data corruption) | + `SOC2.CC7.2` System monitoring and incident response |
| **Security vulnerability** (auth bypass, injection, data exposure beyond GDPR scope) | + `SOC2.CC7.2` + relevant ISO 27001 controls |
| **Personal data exposed / lost / mishandled** | + `GDPR.Art-33` (always — supervisory authority within 72h) + `GDPR.Art-34` (when data subjects need notification per Art. 34(1)) |
| **AI/ML failure** (model hallucination, biased output, oversight bypass, transparency failure) | + relevant EU AI Act articles (`Art-9` risk, `Art-14` human oversight, `Art-15` accuracy/robustness) |

## Baseline rule

The first row is **mandatory**: every incident_report attributes to `ISO29119.3.5.4` no matter what else applies. The "no specific framework impact" case (a regular bug with no PII, no security, no ops impact) still produces a valid incident_report closing the baseline — never a silently-dropped report.

## Conditional rules

The remaining rows are conditional. Tick the matching characteristic; ensure the corresponding section of the incident-report template is non-stub before commit.

### Ops impact

Signals: production downtime, sustained error-rate elevation, perf regression measured in p95 or SLO breaches, data corruption.

If yes:
- §1 Summary must name the affected systems + duration
- §3 Affected scope must include user-count estimate
- §6 Containment must name what was done to mitigate

### Security vulnerability

Signals: auth bypass, injection (SQL / NoSQL / template / OS), broken access control, secrets in logs / git, dependency CVE exploit path.

If yes:
- §5 Root cause must name the vulnerability class (OWASP / CWE id where applicable)
- §7 Follow-up actions must include the regression test that prevents recurrence
- Security lead listed in §8 Sign-off

### Personal data exposed / lost / mishandled (GDPR)

Signals: any unauthorised disclosure of personal data, data loss without backup, data sent to unintended recipients, retention exceeded, lawful-basis collapse.

If yes:
- §4 GDPR triage **must** be fully filled: data subject count, data categories, special-category-data Y/N
- Art. 33: notification to supervisory authority within 72h of awareness → document timestamp + sent-to in §2 Timeline
- Art. 34: notification to data subjects when likely to result in HIGH risk → document the decision (with rationale) in §4
- DPO listed in §8 Sign-off

### AI/ML failure (EU AI Act)

Signals: model produced incorrect / biased / harmful output that reached a user; oversight gate bypassed; accuracy / robustness regression in production.

If yes:
- §5 Root cause must name the model + invocation path + what guardrail failed
- §7 Follow-up actions must include the change to the AI oversight path (Art. 14)
- Cross-link to `compliance/governance/ai-disclosure.md` from §1 Summary

## Worked examples

### Example 1 — Non-PII, non-security defect

A unit-conversion bug in a public-facing page rounds metric prices incorrectly. Discovered via failing e2e. No data exposure, no ops impact beyond cosmetic, no AI involved.

**Attribution:** `ISO29119.3.5.4` only.

The incident-report is still valid and load-bearing — without it the test incident clause stays MISSING. Don't pad with false GDPR / security ticks.

### Example 2 — PII exposure via misconfigured RLS policy

A Supabase RLS policy was deployed with a typo causing users to see other users' application details (name, email, application status). Found by an e2e regression test. No financial impact, no service downtime — but ~3,000 users were affected over a 6-hour window.

**Attribution:** `ISO29119.3.5.4` + `SOC2.CC7.2` (incident response invoked) + `GDPR.Art-33` (supervisory authority notified within 72h) + `GDPR.Art-34` (data subjects notified — risk threshold met).

§4 GDPR triage filled: 3,000 affected, categories = name + email + application metadata, no special-category data, Art-34 notification sent within 72h via in-app banner + email.

## Cross-references

- `e2e-test-engineer/SKILL.md` Phase 6 (Filing defects) — uses this table when filing a defect that meets incident criteria.
- `governance-doc-author/SKILL.md` Phase 6 — uses this table when authoring the project-level `incident-report.md` template.
- `compliance/governance/incident-report.md.template` — Framework attribution section embeds the same conditional checklist.
