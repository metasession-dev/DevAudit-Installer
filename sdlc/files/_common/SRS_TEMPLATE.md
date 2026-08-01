# Software Requirements Specification — [PROJECT NAME]

**Document Type:** Software Requirements Specification (Project-Specific) | **Version:** 1.0 | **Effective Date:** [DATE]

**Project:** [PROJECT NAME] | **Repository:** `[org/repo-name]`

**Parent Documents:** Test Policy, Test Strategy (both Tier 1/2, in `devaudit/sdlc/files/`)

---

## Purpose

This is [PROJECT NAME]'s Software Requirements Specification — the single source of truth for what the system does, phrased as testable, prioritised requirements. It is the document `e2e-test-engineer` derives tests from and `requirements-aligner` checks every new requirement against, once seeded.

This file exists at `docs/SRS.md` in your repository (not under `compliance/` — it's a living engineering document, not a per-release artefact).

**How this file gets created.** Nothing in the framework authors an SRS from scratch on your behalf — `requirements-aligner` explicitly refuses to ("Do NOT use for SRS authoring from scratch"), by design: requirements are a judgement call only a human can make correctly. This template is the starting skeleton. Fill in the sections below (delete the worked examples once you've replaced them with your own), commit the result as `docs/SRS.md`, and from your next requirement onward `requirements-aligner` takes over incremental maintenance — proposing new `REQ-AREA-NNN` stubs and flagging drift automatically at Stage 1 (advisory) and Stage 3 (blocking) of every requirement cycle. See `requirements-aligner/SKILL.md` for the full mechanism.

---

## Conventions

- **Requirement IDs:** `REQ-<AREA>-NNN` (e.g. `REQ-AUTH-001`, `REQ-BILLING-014`). Pick short, stable area codes for this project's main domains up front — IDs are permanent once assigned; never renumber, only append.
- **Acceptance criteria:** Given / When / Then, phrased against observable behaviour (what a user, an API caller, or a test sees — not internal implementation detail).
- **Priority — MoSCoW:**
  - **Must** — the system is broken or unshippable without this. Goes in the smoke/critical test suite.
  - **Should** — important, expected functionality; not launch-blocking on its own. Goes in the regression suite.
  - **Could** — nice-to-have, edge-case, or polish. Lowest test priority.
  - **Won't** (this cycle) — explicitly out of scope for now, recorded so it doesn't get silently re-litigated later. Not the same as "never" — revisit next planning cycle.
- **Source:** cite the file(s)/function(s) each requirement is implemented by. This is where to look when a test fails — not part of the contract itself, and it's fine for this to say "not yet implemented" for a requirement you're specifying ahead of the code.

---

## Worked examples (delete once you've written your own)

#### REQ-AUTH-001 — A registered user can sign in with email + password

- **Priority:** Must — no other feature is reachable without authentication.
- **Source:** *(fill in once implemented, e.g. `app/api/auth/login/route.ts`)*
- **Given** a user with a valid, verified account **When** they submit correct email + password to the sign-in form **Then** they receive a valid session and are redirected to the dashboard.
- **Error paths:** Wrong password → generic "invalid credentials" (never reveal which field was wrong); unverified account → prompt to re-verify; unknown email → same generic message as wrong password (no user-enumeration).
- **Fixtures/env:** A verified test user with a known password; an unverified test user.

#### REQ-BILLING-001 — A workspace owner can upgrade from Free to a paid plan

- **Priority:** Should — core to the product's business model but the app functions on the Free tier without it.
- **Source:** *(fill in once implemented)*
- **Given** a workspace on the Free plan **When** its owner completes the upgrade checkout flow **Then** the workspace's plan updates and previously-gated features unlock immediately.
- **Error paths:** Payment declined → workspace stays on Free, user sees the decline reason; upgrade attempted by a non-owner → 403.
- **Fixtures/env:** A test workspace on Free; a test payment method that reliably declines (per your payment provider's test-mode docs).

---

## Your requirements

Group by area. Add a new `###` heading per area (e.g. `### Authentication`, `### Billing`, `### Core domain — [your main feature]`) and list each `REQ-AREA-NNN` underneath in the same format as the worked examples above. Start small — even 3–5 Must-priority requirements covering your riskiest surfaces is a real starting point; `requirements-aligner` will help it grow from here.

*(start writing here)*

---

## Appendix A — Assumptions & Ambiguities

Record anything you're specifying as intent rather than observed behaviour (this file may be written before the corresponding code exists), and any known-current-but-suspect behaviour you don't want silently smoothed over. Empty is fine for a brand-new project.

---

## Document Control

| Version | Date | Author | Changes |
| --- | --- | --- | --- |
| 1.0 | [DATE] | [AUTHOR] | Initial SRS, bootstrapped from SRS_TEMPLATE.md |

**Parent Documents:** Test Policy, Test Strategy (in `devaudit/sdlc/files/`)
