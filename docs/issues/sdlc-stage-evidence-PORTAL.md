# Portal-side: SDLC stage labelling, Playwright bundle rendering, and stage-grouped evidence

**Status:** Proposed / ready for implementation
**Labels:** `enhancement`, `portal`
**Priority:** High
**Related:** DevAudit-Installer #169, #170, #174, #175
**Implementation:** see `docs/issues/sdlc-stage-evidence-PORTAL-IMPLEMENTATION.md` (mechanical, exact-diff handover)
**Companion:** `docs/issues/sdlc-stage-evidence-IMPLEMENTATION.md` (producer-side, DevAudit-Installer repo)

---

## Problem

The portal (`metasession-dev/devaudit`) currently:

1. **Has no SDLC-stage dimension.** Every evidence row is flat — the reviewer cannot tell whether a screenshot was captured during implementation (stage 2), evidence compilation (stage 3), or post-deploy verification (stage 5). This co-mingles pre-merge and post-deploy proof under the same REQ.

2. **Cannot render full Playwright reports.** The `PlaywrightRenderer` component fetches a single JSON blob from the evidence's `signedUrl` and parses it with `parsePlaywrightReport()`. But the producer uploads `playwright-report/index.html` (a bare HTML file) or `playwright-report.zip` (a ZIP bundle). Neither is the raw JSON the renderer expects. The renderer falls back to `JestRenderer` → `JsonRenderer` → `FallbackRenderer`, so the user sees raw text or a download link instead of the interactive spec tree.

3. **Groups evidence only by requirement.** `ReleaseEvidenceList` builds `evidenceByReq` — a `Map<requirementId, EvidenceWithUrl[]>`. There is no secondary grouping by SDLC stage, so a reviewer scanning a release sees all evidence for a REQ in one flat list regardless of when in the SDLC it was produced.

4. **Applies the screenshot filename validator to all uploads.** `isValidScreenshotFilename()` enforces `REQ-XXX-AC<n>-<slug>.png` for `evidenceType === 'screenshot'` only. This is correct. But the new `playwright_report_bundle` evidence type (a ZIP) must NOT be subject to this rule — and currently the upload route only exempts non-screenshot types, so this is already safe. The gap is that the new type doesn't exist in the registry yet.

5. **Completeness matrix is stage-unaware.** `getReleaseDashboardData()` computes `completenessPercent` from the release-requirement matrix (`resolved / total * 100`). There is no notion of "stage 2 evidence present, stage 3 evidence present, stage 5 evidence missing" — the matrix is binary per REQ.

---

## Proposed solution

### P1 — Accept `sdlcStage` on upload (additive, tolerant-read)

Add `sdlcStage` as an optional field on the evidence upload API and store it in a new column on `compliance_evidence`. The field is:

- **Optional.** Missing → stored as `null` (displayed as "unspecified").
- **Validated against an allow-list** (`1`, `2`, `3`, `4`, `5`). Invalid values are silently dropped (same pattern as `changeType` in `upload/route.ts`).
- **Not required for existing uploads.** No breaking change to any producer.

### P2 — Add `playwright_report_bundle` evidence type

Register a new evidence type in `EVIDENCE_TYPE_REGISTRY` so the portal recognises Playwright ZIP bundles as a distinct type from the existing `e2e_result` JSON.

### P3 — Render Playwright report bundles

The current `PlaywrightRenderer` fetches `signedUrl` and expects raw JSON. For ZIP bundles, the portal needs a new flow:

1. **Server-side extraction endpoint** — a new API route that accepts an evidence ID, downloads the ZIP from storage, extracts `report.json` (or the Playwright JSON reporter output), and returns it as JSON. This avoids shipping the entire ZIP to the client.
2. **Renderer update** — `PlaywrightRenderer` detects `evidence_type === 'playwright_report_bundle'` and fetches from the extraction endpoint instead of the raw `signedUrl`.

### P4 — Group evidence by SDLC stage in the UI

Add a stage grouping layer to `ReleaseEvidenceList`:

1. **Stage badges** — each evidence row gets a coloured badge (1=blue, 2=green, 3=amber, 4=purple, 5=red, unspecified=grey).
2. **Stage-grouped view** — a toggle/section that groups evidence under stage headers instead of (or in addition to) the per-REQ grouping.
3. **Stage-aware completeness** — the dashboard shows per-stage completeness indicators: which stages have evidence, which are empty, and which are not yet expected (gated on `release.status`).

### P5 — Stage-aware completeness matrix

Redefine completeness per stage, gated on `release.status`:

| Release status | Stages expected | Stages not yet expected |
|---|---|---|
| `draft` | 1, 2, 3 | 4, 5 (render grey) |
| `uat_review` | 1, 2, 3, 4 | 5 (render grey) |
| `released` | 1, 2, 3, 4, 5 | — |

Unreached stages render grey, never block. This prevents false-incomplete signals from stages that haven't happened yet.

### P6 — AC-proof vs run-context classification

Classify each evidence row as either:

- **AC-proof** — directly proves an acceptance criterion (screenshots with `REQ-XXX-AC<n>` filenames, `e2e_result` JSON with REQ-tagged tests).
- **Run-context** — provides context about a test run but does not directly prove an AC (Playwright report bundles, SAST reports, dependency audits, coverage reports).

Only AC-proof evidence counts toward the completeness matrix. Run-context evidence is displayed but does not flip a REQ to "covered." This keeps #169/#170 (the hard gates) independent from the new stage dimension.

---

## Acceptance criteria

1. **AC-1:** `POST /api/evidence/upload` accepts an optional `sdlcStage` form field. Valid values `1`–`5` are stored; invalid values are silently dropped; missing values store `null`.

2. **AC-2:** A new `playwright_report_bundle` evidence type appears in the upload-page artefact guide and is accepted by the upload API.

3. **AC-3:** When a user clicks a `playwright_report_bundle` evidence item in the release dashboard, the `PlaywrightRenderer` renders the interactive spec tree (pass/fail status, suite grouping, duration) by fetching the extracted JSON from a server-side endpoint — not by downloading the ZIP.

4. **AC-4:** The release dashboard shows a stage badge on every evidence row. The badge colour maps to the SDLC stage (1=blue, 2=green, 3=amber, 4=purple, 5=red, unspecified=grey).

5. **AC-5:** The release dashboard offers a "Group by stage" view that organises evidence under stage headers (Stage 1: Plan, Stage 2: Implement/Test, Stage 3: Compile Evidence, Stage 4: Submit for Review, Stage 5: Deploy).

6. **AC-6:** The completeness matrix shows per-stage indicators. Stages not yet expected for the release's current status render grey. Only AC-proof evidence counts toward completeness.

7. **AC-7:** Existing uploads without `sdlcStage` continue to render correctly (badge = "unspecified", no regression in grouping or completeness).

8. **AC-8:** The screenshot filename validator (`isValidScreenshotFilename`) is NOT applied to `playwright_report_bundle` uploads (only to `evidenceType === 'screenshot'`).

9. **AC-9:** Unit tests cover: `sdlcStage` validation (valid/invalid/missing), `playwright_report_bundle` type registration, stage-grouping logic, stage-aware completeness calculation, AC-proof vs run-context classification.

---

## Files touched (summary)

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `sdlc_stage Int?` column to `compliance_evidence` |
| `prisma/migrations/20_sdlc_stage/migration.sql` | New migration |
| `lib/types.ts` | Add `SdlcStage` type; add `sdlc_stage` to `ComplianceEvidence` |
| `lib/config/evidence-types.ts` | Add `playwright_report_bundle` to `EVIDENCE_TYPE_REGISTRY` |
| `app/api/evidence/upload/route.ts` | Parse + validate `sdlcStage` form field; pass to service |
| `lib/services/evidence-service.ts` | Accept + forward `sdlcStage` in `UploadEvidenceInput` |
| `lib/repositories/evidence-repository.ts` | Include `sdlc_stage` in `create()` and `toEvidence()` |
| `lib/interfaces/repositories.ts` | No change needed (create uses `Omit<ComplianceEvidence, ...>`) |
| `lib/validators/evidence-validator.ts` | Add `sdlcStageSchema` (optional, 1–5) |
| `lib/validators/screenshot-filename.ts` | No change (already gated on `evidenceType === 'screenshot'`) |
| `app/api/evidence/[id]/playwright-json/route.ts` | New route: extract JSON from ZIP bundle |
| `components/evidence-viewer/playwright-renderer.tsx` | Fetch from extraction endpoint for bundle type |
| `components/dashboard/release-evidence-list.tsx` | Add stage badges + "Group by stage" toggle |
| `components/dashboard/release-dashboard.tsx` | Wire stage-grouping prop |
| `lib/services/release-service.ts` | Add stage-aware completeness to `getReleaseDashboardData` |
| `lib/dashboard/stage-classifier.ts` | New: AC-proof vs run-context classification |
| `lib/dashboard/stage-completeness.ts` | New: per-stage completeness calculation |
| `components/dashboard/stage-badge.tsx` | New: coloured badge component |
| `tests/unit/...` | New + updated tests |

---

## Deploy order

**Portal first, producer second.** The portal must tolerate-read `sdlcStage` before the producer starts sending it. Since the field is additive and optional, there is no breaking change — the portal simply starts seeing `null` for `sdlc_stage` until the producer (DevAudit-Installer #175 implementation) ships.

---

## Relationship to DevAudit-Installer #175

This issue is the **portal-side complement** to DevAudit-Installer #175. The producer-side changes (adding `--sdlc-stage` to `upload-evidence.sh`, stamping CI templates, creating `feature-e2e.yml.template`) are in the DevAudit-Installer repo. This issue covers only the portal-side work: database schema, API acceptance, rendering, and UI grouping.
