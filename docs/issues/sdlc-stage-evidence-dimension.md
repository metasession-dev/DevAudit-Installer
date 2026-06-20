# Evidence by SDLC stage: stage-labelling, full Playwright report rendering, and amendments to #169 / #170 / #174

**Status:** Proposed / Ready for refinement
**Labels:** `enhancement`, `framework`, `ci`, `portal`
**Priority:** High
**Related:** #169, #170, #174, #147
**Implementation:** see `docs/issues/sdlc-stage-evidence-IMPLEMENTATION.md` (mechanical, exact-diff handover)

---

## Context

A proposal was raised to resolve part of the in-scope-evidence problem by **uploading the
Playwright reports (which already contain screenshots), labelling each upload with the SDLC
stage it belongs to (1 implement → 5 deploy-to-main), and having the portal render the report
and group evidence by stage** so that:

1. later-stage uploads do not visually collide with / obscure earlier-stage evidence, and
2. a reviewer can immediately see **which SDLC stage** any given artefact proves.

The requirement applies not just to E2E specs but to **all relevant Tier-3 per-release
artefacts** (`@docs/governance-templates.md:159` — RTM, test-plan, test-cases,
screenshots, SAST / dep-audit / e2e results, coverage, audit-log exports).

This document records (a) how E2E / Tier-3 evidence flows today, (b) the gap the proposal
addresses, (c) the precise modifications required across the **producer** (this repo) and the
**portal** (separate `meta-comply` / devaudit.ai repo), (d) the amendments required to #169,
#170, #174, and (e) the new gaps the proposal itself introduces.

> **Scope note.** This repository is the *producer*: CI templates, `scripts/upload-evidence.sh`,
> and the `evidenceShot` helper. The *consumer* that renders and groups evidence is the portal,
> a separate codebase reached via `DEVAUDIT_BASE_URL`. Items tagged **[portal]** below must be
> filed/confirmed against that repo.

---

## How E2E / Tier-3 evidence flows today

### Two workflows, two owners

- **`sdlc/files/ci/ci.yml.template`** (lines 528–644) — on push: uploads gate evidence and the
  per-AC `evidenceShot` PNGs from `compliance/evidence/<REQ>/screenshots/*.png`, scoped to
  in-scope REQs, `environment=uat`.
- **`sdlc/files/ci/compliance-evidence.yml.template`** (lines 577–650) — `workflow_run`-triggered:
  uploads committed compliance docs **and** the E2E regression report —
  `e2e-regression-results.json` (`evidenceType=e2e_result`) and
  `playwright-report/index.html` (`evidenceType=test_report`), with `--meta-key tier=critical|regression`.

### The upload contract (`/api/evidence/upload`, `scripts/upload-evidence.sh`)

Each artefact carries: `requirementId`, `evidenceType`, `evidenceCategory`
(`planning|test_report|security_scan|ci_pipeline|release_artifact|local_dev`), a `metadata`
JSON (`gitSha`, `ciRunId`, `branch`, plus repeatable `--meta-key` pairs — today only
`tier=` and `origin=`), `releaseVersion`, `releaseBranch`, `environment` (`uat|production`),
`releaseTitle`, `changeType`, `gateStatus`.

`evidenceShot` (`sdlc/files/_common/skills/e2e-test-engineer/references/evidence.ts`) writes the
PNG plus a sidecar `<png>.meta.json` carrying `origin` (feature|regression).

### Portal behaviour (inferred from producer comments — **[portal] confirm**)

- Renders `screenshot` evidence inline as `image/png`.
- Validates the screenshot filename shape `REQ-XXX-AC<n>-<slug>.png` and **rejects anything else
  with HTTP 400** (`ci.yml.template:586-588`).
- Groups under "Evidence by requirement"; can filter/group by `tier`; distinguishes `environment`.
- **Evidence is append-only — there is no upsert** (`ci.yml.template:636`).

---

## The gap

There is **no "SDLC stage" (1–5) dimension** in the evidence model. The nearest existing axes —
`evidenceCategory` (artefact type), `environment` (uat/production), `tier` (critical/regression),
`origin` (feature/regression) — none expresses *which SDLC stage produced this artefact*.

Because uploads are append-only and grouped by REQ, stage-2 (implement), stage-3 (compile), and
stage-5 (deploy) evidence **co-mingles under the same REQ with no stage label** — the exact
reviewer-ambiguity the proposal calls out.

### Critical caveat: rendering the Playwright report

`compliance-evidence.yml.template` uploads **only `playwright-report/index.html`**. A Playwright
HTML report is **not** a single self-contained file — `index.html` is a shell that loads its data
and screenshot/trace attachments from the sibling `data/` directory and `trace/*.zip`. Uploading
`index.html` alone means **the embedded screenshots will not render**. To "render the report with
its screenshots" the producer must upload the **entire `playwright-report/` directory** (or a
zipped bundle), and the portal must serve/render that bundle.

> **Note:** `ci.yml.template` (lines 498-505) *already* zips and uploads the whole
> `playwright-report/` as `playwright-report.zip`. Only `compliance-evidence.yml.template`
> still uploads the bare `index.html` — so the producer fix is to align it to the same zip
> pattern (done in implementation task T4c). The remaining work to actually *render* the
> bundle is portal-side.

---

## Why this does NOT replace #169 / #170 (it is complementary)

| Issue | What it fixes | Does stage-labelling solve it? |
|-------|---------------|--------------------------------|
| **#169** | CI proceeds to UAT with **zero REQ-tagged tests + zero per-AC screenshots** for an in-scope REQ | **No.** A stage-labelled report with zero REQ-tagged tests still contains zero traceable AC evidence. The CI gate is the real fix. Stage-labelling only changes *display*. |
| **#170** | The `e2e-test-engineer` skill does not enforce `evidenceShot()` / `[REQ-XXX][ACn]` annotations before Phase 6 | **No.** Uploading a report cannot retro-fit missing annotations. The skill-level static gate is still required. |
| **#174** | Feature-specific (regression-tier) E2E never *runs* on the feature branch, so bugs surface only at the release gate | **Partially.** #174 is about *execution timing*, not display. Stage-labelling is the natural way to file the feature-branch run as **stage-2 / origin=feature** so it lands distinctly from the stage-3/5 regression run. |

**Bottom line:** keep #169 and #170 as the root-cause fixes; layer stage-labelling on top as a
new, complementary capability (the new umbrella issue below). The risk of *not* being explicit
is that teams treat "a report was uploaded" as "evidence is complete."

---

## NEW ISSUE — `feat(evidence): add SDLC-stage dimension + full Playwright report rendering, grouped by stage`

**Labels:** `enhancement`, `framework`, `ci`, `portal` · **Priority:** High

### Problem
Tier-3 per-release evidence has no SDLC-stage axis, so stage 2/3/5 artefacts co-mingle under a
REQ and reviewers cannot tell which stage an artefact proves. The Playwright report is uploaded
as a bare `index.html`, so its screenshots do not render in the portal.

### Proposed solution

**Producer (this repo)**
1. **First-class stage field in `scripts/upload-evidence.sh`.** Add `--sdlc-stage <1..5>` that
   forwards an `sdlcStage` form field (preferred over a bare `--meta-key stage=`, so the portal
   can index/filter it). Validate the value is `1`–`5`.
2. **Stamp the stage in both CI templates:**
   - `ci.yml.template` per-AC screenshots + gate evidence → `--sdlc-stage 2` (implement/test) for
     evidenceShot captures; committed-doc gate evidence → `--sdlc-stage 3`.
   - `compliance-evidence.yml.template` committed compliance docs → `--sdlc-stage 3`; E2E report
     bundle → stage derived from the triggering event (PR-to-develop = 2, push-to-main = 5).
   - `post-deploy-prod` / `environment=production` uploads → `--sdlc-stage 5`.
3. **Upload the full Playwright report bundle**, not just `index.html`: upload the whole
   `playwright-report/` directory (or a single `playwright-report.zip`) under a new
   `evidenceType=test_report_bundle` so the portal can serve it intact.

**Portal (separate repo) [portal]**
4. Add an `sdlc_stage` column to the evidence model; accept `sdlcStage` on `/api/evidence/upload`;
   default missing values to `unspecified` (legacy/older consumers).
5. **Group the release-detail evidence view by stage (1–5)** within each REQ, not only by category.
6. **Render uploaded report bundles** (serve the static `playwright-report/` or unpack the zip),
   so screenshots/traces display.
7. Make the **release-completeness matrix stage-aware** (see gap #3 below) so a per-REQ stage with
   no artefacts reads as *not-yet-reached* rather than *missing*.

### Acceptance criteria
- AC1: `upload-evidence.sh --sdlc-stage N` forwards `sdlcStage=N`; invalid N fails fast.
- AC2: Both CI templates stamp the correct stage on every Tier-3 upload.
- AC3: The full Playwright report (incl. screenshots) renders in the portal from a single bundle upload.
- AC4: The release-detail view segments evidence by stage 1–5 within each REQ.
- AC5: Uploads from pre-`sdlcStage` consumers still ingest and display as `unspecified` (no regression).

---

## Amendment — #169 (CI gate for zero in-scope evidence)

**Keep as the root-cause fix.** Add the following clarifications so it is not conflated with the
stage-labelling work:

- **Add a non-goal:** "Uploading the Playwright report (stage-labelled or not) does **not** satisfy
  this gate — AC1 requires at least one REQ-*tagged* test or per-AC screenshot. A report with zero
  REQ-tagged tests is still an evidence gap."
- **Cross-reference** the new issue: the gate should *also* record `--sdlc-stage` on the gate-status
  evidence it emits, so a failed/blocked gate is itself filed under the correct stage.
- Acceptance criteria unchanged (AC1–AC4); transport-only opt-out unchanged.

## Amendment — #170 (skill enforces evidenceShot / REQ annotations)

**Keep as the root-cause fix.** Additions:

- The Phase 5½ validation table should additionally **record the SDLC stage** the wiring belongs to,
  so the eventual upload (per the new issue) is stamped consistently.
- **Add a non-goal:** stage-labelling at upload time is downstream of, and cannot substitute for,
  authoring-time enforcement of `evidenceShot()` + `[REQ-XXX][ACn]`.

## Amendment — #174 (feature-branch in-scope E2E execution)

**Direct beneficiary of the new dimension.** Additions:

- In `feature-e2e.yml`, after the in-scope run, **upload the report bundle stamped
  `--sdlc-stage 2 --meta-key origin=feature`** so the feature-branch run lands distinctly from the
  stage-3/5 regression runs and does not co-mingle under the REQ.
- **Add a guard / non-goal:** feature-branch uploads are *pre-merge context*; the portal must **not**
  treat a stage-2 feature-branch report as release/UAT-gate evidence. **[portal]** the UAT
  completeness check must only count stage-3+ artefacts on the release branch.
- `e2e-test-engineer` Phase 3b execution-classification note should also emit the stage label.

---

## New gaps the proposal itself introduces (watch-outs)

1. **Two-repo coordination & version skew.** The producer adds a field the portal must understand.
   Older consumers won't send `sdlcStage`; the portal must default gracefully to `unspecified`.
2. **Stage is not 1:1 with a CI trigger.** A single push can carry artefacts from several stages.
   A deterministic mapping is required (evidenceShot = stage 2; committed compliance docs = stage 3;
   `environment=uat` review context = stage 4; `environment=production` = stage 5). Mis-mapping
   produces *confidently wrong* stage labels — worse than none.
3. **Append-only + stage = more rows, not fewer overwrites.** "Not overwritten" is already true
   (append-only). The real fix is **display segmentation**; but the completeness matrix must be
   redefined *per stage* or it will read false-incomplete for stages a REQ hasn't reached yet.
4. **Storage / binary bloat.** Uploading full report bundles re-introduces the binary-bloat problem
   DevAudit deliberately keeps out of Git. Need a zip-bundle + retention policy on the portal.
5. **Filename validator.** Report-bundle assets won't match `REQ-XXX-AC<n>-<slug>.png`; the portal's
   400-on-bad-filename rule must exempt the new `test_report_bundle` evidenceType. **[portal]**
6. **Display ≠ traceability.** Stage-labelling can create false confidence that "evidence exists"
   when the report still has zero REQ-tagged tests — reinforcing why #169/#170 stay independent.

---

## Mitigations (how each new gap is closed)

1. **Skew →** `sdlcStage` is an additive, optional field; unknown values are dropped server-side
   (same as `changeType`/`gateStatus` today). Deploy order: **portal tolerant-read first, producer
   second.** Missing → `unspecified`.
2. **Non-1:1 stage ↔ trigger →** stage is a property of the *upload call*, set literally per
   template invocation (see the stage-mapping table in the implementation guide). The only
   event-derived case (E2E report: PR=2, push=5) reuses the existing `TIER` event switch.
3. **Append-only / false-incomplete →** completeness is redefined per stage, gated on
   `release.status` (draft→1-3, uat_review→1-4, released→1-5); unreached stages render grey, never
   block. [portal]
4. **Binary bloat →** upload one `playwright-report.zip` (not loose files); keep small canonical
   artefacts (evidenceShot PNGs + `e2e_result` JSON) permanently, time-bound the heavy bundle; lean
   the regression pack via Playwright `trace: on-first-retry` / `screenshot: only-on-failure` and
   the existing `tier: 'feature'` suppression. [portal retention]
5. **Filename validator →** branch validation on `evidenceType`: `REQ-XXX-AC<n>-<slug>.png` rule
   applies only to `screenshot`; bundles validate by extension. [portal]
6. **Display ≠ traceability →** portal classifies evidence as **AC-proof** vs **run-context**; only
   AC-proof counts toward completeness; bundles are run-context. #169/#170 remain the hard gates. [portal]

---

## Implementation note

Templates exist in **two** locations — `sdlc/files/...` (source of truth) and `cli/sdlc/files/...`.
**Edit only the source.** The `cli/sdlc/` and `cli/scripts/upload-evidence.sh` copies are
git-ignored snapshots regenerated automatically by `cli/tools/bundle-templates.mjs` on `prepack`
(`npm pack`/`publish`) — do not edit them by hand.
