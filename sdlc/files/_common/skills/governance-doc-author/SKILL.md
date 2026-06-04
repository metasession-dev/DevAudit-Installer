---
name: governance-doc-author
description: Author or refresh one of the project's governance documents — RoPA (GDPR Art. 30), DPIA (GDPR Art. 35), AI use disclosure (EU AI Act Art. 13), Periodic Security Review Schedule (ISO 27001 A.12.1 / SOC 2 CC4.1), or the project-level incident-report template. Drives source-data gathering, framework-clause attribution, content authoring against the existing starter template, and the commit + upload + portal-verification loop. Use when the user wants to "create / refresh the RoPA", "write a DPIA", "update the AI disclosure", "set up the periodic review schedule", or generally "I need to make our <governance doc> audit-ready". Use also when the framework-coverage matrix on the portal shows GDPR.Art-30 / GDPR.Art-35 / EUAIA.Art-13 / SOC2.CC4.1 / ISO27001.A.12.1 as MISSING and the operator asks how to close them. Do NOT use for incident response itself (that's the e2e-test-engineer + incident-export.yml pipeline), or for portal upload mechanics of evidence the CI already auto-uploads (test_report, e2e_result, sast_report, audit_log, screenshot).
---

# Governance Doc Author

Author or refresh a single governance document so it correctly closes the framework clauses it's meant to satisfy. Five document classes covered:

| Document | Tier | File | Upload path | Closes |
|---|---|---|---|---|
| **RoPA** | 2 | `compliance/governance/ropa.md` | **Portal Upload form** (type `ropa`) — CI does NOT auto-upload since v0.1.39 | `GDPR.Art-30` |
| **DPIA** | 2 | `compliance/governance/dpia.md` (or `dpia-<reqid>.md`) | **Portal Upload form** (type `dpia`) — CI does NOT auto-upload since v0.1.39 | `GDPR.Art-35` |
| **AI Use Disclosure** | 2 | `compliance/governance/ai-disclosure.md` | **Portal Upload form** (type `ai_disclosure`) — CI does NOT auto-upload since v0.1.39 | `EUAIA.Art-13` |
| **Periodic Security Review Schedule** | 2 | `SDLC/Periodic_Security_Review_Schedule.md` | **Portal Upload form** (type `compliance_document`) | `ISO27001.A.12.1` schedule expectation (quarterly runs close it via `periodic_review` evidence — see Phase 6) |
| **Incident Report (project-level template)** | 3 | `compliance/governance/incident-report.md` | **CI auto-upload** via `compliance-evidence.yml` | `ISO29119.3.5.4` baseline; conditionals via [[incident-classification]] |

Each doc has a starter template under `sdlc/files/_common/governance/*.md.template` (installed on demand via `devaudit bootstrap-governance` since v0.1.36). This skill does NOT regenerate the template — it walks the operator through *filling it in* against the project's actual state.

## Scope

**In scope**
- Authoring or refreshing one (or more) of the five governance docs above.
- Gathering source data from the codebase / CI runs / git history.
- Confirming framework attribution before commit.
- Driving the commit + push → portal upload (manual for Tier 1/2, CI auto for Tier 3) → portal verification loop.

**Out of scope**
- Incident response itself — that path is the `e2e-test-engineer` skill's defect-filing flow plus `incident-export.yml` on issue close.
- Test execution evidence — handled by `e2e-test-engineer`.
- Implementation plans for individual REQs — handled by the `sdlc-implementer` skill's Phase 1 against `Implementation_Plan_TEMPLATE.md`.
- Framework registry changes — clause definitions live in META-COMPLY (`lib/config/frameworks/`) and are not authored here.

## The workflow

Six phases. Phase 0 is a routing step; phases 1–5 are per-document.

### Phase 0 — Route

Determine which document the operator needs. Ask if ambiguous; otherwise infer from the trigger phrase.

- *"create / refresh the RoPA"* → Phase 1 with doc = ROPA
- *"write / update a DPIA"* → Phase 1 with doc = DPIA (ask: tied to a specific HIGH-risk REQ, or project-wide?)
- *"AI use disclosure"* / *"document our AI use"* → Phase 1 with doc = AI_DISCLOSURE
- *"periodic security review schedule"* / *"how often do we review"* → Phase 1 with doc = REVIEW_SCHEDULE
- *"incident-report template"* → Phase 1 with doc = INCIDENT_TEMPLATE (and remind the operator that per-incident reports come from `incident-export.yml`, not this skill)

When the trigger is *"GDPR.Art-30 is MISSING on the matrix, what do I upload?"* and similar — route to the matching doc above.

### Phase 1 — Confirm the starter exists

1. Check whether the starter template is on disk at the expected path. If yes, skip to Phase 2.
2. If absent, tell the operator the v0.1.36+ install no longer auto-seeds these — the `devaudit bootstrap-governance` command copies them on demand. Offer to run it (with operator confirmation per the **Confirm before destructive or public actions** principle).
3. Re-check the path. If still missing, halt with a clear error pointing at the starter file in the installer.

### Phase 2 — Gather source data

Each doc class has different inputs. Read what's needed; don't ask the operator for what you can derive from the codebase.

- **ROPA**
  - Read `app/`, `lib/`, `prisma/schema.prisma` (or equivalent) to enumerate processing activities.
  - For each, infer: data categories, recipients (third-party SDKs / services), retention (DB triggers, env vars naming retention windows), lawful basis where reasonable.
  - Read `.env.example` for third-party service names.
  - Ask the operator to confirm purposes (you can guess the technical surface; the *purpose* is a business decision).

- **DPIA**
  - Project-wide DPIA → same source data as RoPA, plus a risk identification pass against Art. 35(3) triggers (large-scale special category, systematic monitoring, automated decisions with legal effect).
  - Per-REQ DPIA → read `compliance/plans/REQ-XXX/implementation-plan.md` §4 (data protection) for the specific REQ being assessed.

- **AI_DISCLOSURE**
  - Grep `git log --grep "Co-Authored-By: Claude\|Co-Authored-By: GPT"` for model usage signals.
  - Grep the codebase for AI SDK imports (`@anthropic-ai/sdk`, `openai`, etc.) and prompt strings.
  - Cross-reference each per-REQ implementation plan's §5 (AI / model considerations).
  - Ask the operator about human-oversight paths if not documented in the implementation plans.

- **REVIEW_SCHEDULE**
  - Read `sdlc-config.json` for `risk_tier` — drives the cadence (low = annual + ad-hoc; medium = quarterly; high = monthly).
  - Read `.github/workflows/periodic-review.yml` to confirm the cron is wired (or note it as a follow-up if not).
  - Ask the operator which control areas to schedule (default: access control / secure SDLC / SAST / dep-audit / E2E / change management / monitoring).

- **INCIDENT_TEMPLATE**
  - No source-data gathering — the project-level template is the form per-incident reports inherit. Ensure the latest [[incident-classification]] reference is up to date.

### Phase 3 — Author against the starter

1. Open the starter at the path Phase 1 confirmed.
2. Replace every `REPLACE — …` marker with project-specific content. Use the Phase 2 source data; don't invent values.
3. Tick the **Framework checklist** items in the starter as you go. If you can't tick one honestly, leave it unticked and surface the gap in the Phase 5 report — never tick falsely.
4. Update the frontmatter (`last_reviewed_at`, `controller`, etc.) to today's date and the project's actual values.

### Phase 4 — Verify framework attribution

For each clause the doc closes, confirm the corresponding section of the doc is non-stub:

| Doc | Clause | Section that must be non-stub |
|---|---|---|
| ROPA | GDPR.Art-30 | §Controller + ≥1 §Processing activities row with all fields filled |
| DPIA | GDPR.Art-35 | All six sections (description / necessity / risks / measures / consultation / sign-off) |
| AI_DISCLOSURE | EUAIA.Art-13 | All six checklist items in the template's Framework checklist |
| REVIEW_SCHEDULE | ISO27001.A.12.1 | A schedule entry per control area + a named reviewer per cadence |
| INCIDENT_TEMPLATE | ISO29119.3.5.4 baseline | §1–§8 of the template are skeletal but coherent (per-incident files inherit the shape) |

If any required section is still stub, **do not commit**. Surface the gap in the Phase 5 report, ask the operator for the missing input.

### Phase 5 — Commit + verify

Tier 1/2 docs (RoPA, DPIA, AI Disclosure, Periodic Security Review Schedule) and Tier 3 per-event docs (Incident Report template) take different upload paths since DevAudit-Installer v0.1.39. The skill must drive the right one based on which doc Phase 0 routed to.

1. Show the operator the diff. Confirm before committing (per the **Confirm before destructive or public actions** principle).
2. Commit with a conventional-commit message: `compliance(governance): refresh <doc> for <reason>` — e.g. `compliance(governance): refresh ropa.md — annual review 2026-Q2`.
3. Push to the current working branch.
4. Drive upload based on doc class:
   - **Tier 1/2 (RoPA, DPIA, AI Disclosure, Periodic Security Review Schedule)** — CI does NOT upload these. Direct the operator to the portal Upload Evidence form at `/projects/<slug>/upload`. Surface the exact evidence type to select (`ropa` / `dpia` / `ai_disclosure` / `compliance_document` respectively) and remind them: "the matrix MISSING row for the corresponding clause renders an `Upload <filename> →` deep-link that pre-fills the form."
   - **Tier 3 (Incident Report template, plus per-event `periodic-review.md` and `incident-report-<n>.md`)** — CI auto-uploads via `compliance-evidence.yml`. Surface: "next `git push` to `develop` → `compliance-evidence.yml` auto-uploads as `<evidence_type>`, closing `<framework_clause>` within ~2 minutes."
5. Suggest the operator open `/projects/<slug>/compliance` on the portal post-upload to verify the clause flipped MISSING → COVERED. For docs with freshness windows (365d for RoPA / DPIA / Test_Policy / Test_Strategy / AGENT / INSTRUCTIONS; 180d for AI Disclosure) the matrix renders an inline `Expires YYYY-MM-DD` label — confirm it reads the expected date for the upload.

### Phase 6 — Special case: the Periodic Review Schedule vs the quarterly review itself

These are **two different artefacts** and the skill must not conflate them:

| Artefact | What | Closes | Cadence | Skill responsibility |
|---|---|---|---|---|
| **Periodic_Security_Review_Schedule.md** | The *plan* — which controls get reviewed, how often, by whom | `ISO27001.A.12.1` (the schedule presence) | Once, refresh annually | **In scope.** Author / refresh via this skill. |
| **periodic-review.md** | The *execution evidence* — this quarter's actual review | `ISO27001.A.12.1` + `SOC2.CC4.1` (effectiveness evidence) | Quarterly | **Out of scope.** Auto-generated by `periodic-review.yml`; the operator fills in the 60% operator-fill section per the PR body's checklist. |

If the operator asks for "the periodic review", clarify which they mean. If they want the quarterly execution, point them at the open auto-PR (or, if cron hasn't fired yet, suggest `gh workflow run periodic-review.yml`).

## Filing follow-ups + handoff

When Phase 5 commits successfully, append a short narrator update in the final report:

- Doc(s) authored, paths committed, framework clauses closed.
- Any framework checklist items left unticked → file each as a follow-up issue (with operator confirmation) OR list as known gaps in the final report.
- For DPIA tied to a HIGH-risk REQ: cross-link back to the REQ's `implementation-plan.md` §4.

## Principles

**One doc per invocation.** Don't try to refresh RoPA + DPIA + AI disclosure in one run. They have different cadences and different source data; batching them produces sloppy output.

**Don't invent.** If you can't derive a value from the codebase / CI / git, ask the operator. Never guess at lawful basis, retention windows, controller contacts, or AI provider names.

**Framework checklist is load-bearing.** The portal's matrix uses the *presence* of the doc to flip COVERED; auditors use the *content* to decide if that's defensible. Tick boxes only when they're actually true.

**Confirm before destructive or public actions.** Same as the e2e-test-engineer principle. Diff, confirm, commit. The operator approves the doc going to GitHub before push.

**Ambiguity is a question, not a guess.** Same as e2e-test-engineer.

## References

- `references/incident-classification.md` — the conditional-attribution decision tree for incident_report evidence (mirrors the table in `e2e-test-engineer` Phase 6 Filing Defects).
- Starter templates: `sdlc/files/_common/governance/{ropa,dpia,ai-disclosure,periodic-review,incident-report}.md.template`.
- Framework registries (META-COMPLY): `lib/config/frameworks/{gdpr,eu-ai-act,iso-27001,soc-2,iso-29119}.ts`.
- Related skills: `sdlc-implementer` (per-REQ implementation plans), `e2e-test-engineer` (incident reports from defects).
