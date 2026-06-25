# First-class test cycles: portal-side acceptance + UI grouping

**Status:** Proposed
**Labels:** `enhancement`, `needs-triage`
**Priority:** Medium
**Related:** metasession-dev/DevAudit-Installer#209, #207 (evidence_type collisions)
**GitHub:** https://github.com/metasession-dev/devaudit/issues/535

---

## Context

Every CI run from the DevAudit-Installer producer stamps a `ciRunId` into the `metadata` JSON blob on each evidence record. The producer is adding a first-class `--test-cycle` flag that forwards `testCycleId` as a top-level form field on `/api/evidence/upload` (same pattern as `sdlcStage`). This issue tracks the portal-side changes needed to accept, store, and display that field.

**Deploy order: portal tolerant-read first, producer second.** This issue must be deployed before the producer-side changes are merged.

---

## What changes

### 1. Database: add `test_cycle_id` column to evidence table

Add a nullable `test_cycle_id` column (type: `text`). Same pattern as the `sdlc_stage` column addition.

```sql
ALTER TABLE compliance_evidence
  ADD COLUMN IF NOT EXISTS test_cycle_id TEXT;
```

Missing values default to `null` (legacy/older consumers). No migration of existing rows needed — `null` means "pre-test-cycle, ungrouped".

### 2. API: accept `testCycleId` on `/api/evidence/upload`

In `app/api/evidence/upload/route.ts`, parse `testCycleId` from the form data. Same tolerant-read pattern as `sdlcStage`:

```typescript
const testCycleIdRaw = formData.get('testCycleId');
const testCycleId = typeof testCycleIdRaw === 'string' && testCycleIdRaw.trim()
  ? testCycleIdRaw.trim()
  : null;
```

Pass to `evidenceService.uploadEvidence` in the input object.

### 3. Service: store `test_cycle_id` in evidence-service.ts

In `lib/services/evidence-service.ts`, add `test_cycle_id: input.testCycleId ?? null` to the evidence record creation (same pattern as `sdlc_stage`).

### 4. Types: add `test_cycle_id` to `ComplianceEvidence` type

In `lib/types.ts`, add `test_cycle_id: string | null` to the `ComplianceEvidence` interface.

### 5. UI: group evidence by `test_cycle_id` in release detail view

In the release detail page (where evidence is listed per REQ), add a "Test Cycles" collapsible section. Within each REQ's evidence list:

- Group evidence rows by `test_cycle_id` (non-null values only)
- Each cycle section is collapsible, showing:
  - **Cycle header:** `Cycle {testCycleId}` with a date/gate-status badge
  - **Gate outcomes** (evidence_type = `gate_outcome` in that cycle)
  - **E2E results** (evidence_type = `e2e_result` in that cycle)
  - **Screenshots** (evidence_type = `screenshot` in that cycle)
  - **Coverage** (evidence_type = `coverage_report` in that cycle)
  - **Playwright report** (evidence_type = `e2e_report` in that cycle)
- Evidence with `test_cycle_id = null` (legacy uploads) remains in the existing flat list, ungrouped

### 6. UI: Test Completion Report badge

Evidence with `evidence_type = test_report` (the per-REQ `test-execution-summary.md`) should display a badge or label indicating it is the **Test Completion Report** (ISO 29119-3 terminology), spanning all cycles. This is the encompassing artifact — not cycle-scoped.

---

## Acceptance criteria

- AC1: `test_cycle_id` column exists on the evidence table; nullable; no regression on existing rows.
- AC2: `/api/evidence/upload` accepts `testCycleId` form field; stores it; missing values → `null` (no error).
- AC3: `ComplianceEvidence` type includes `test_cycle_id: string | null`.
- AC4: Release detail view groups evidence by `test_cycle_id` within each REQ; each cycle is collapsible.
- AC5: Evidence with `test_cycle_id = null` (legacy uploads) still displays in the existing flat list — no regression.
- AC6: `evidence_type = test_report` artifacts are visually distinguished as the Test Completion Report (encompassing, not cycle-scoped).
- AC7: Uploads from pre-`testCycleId` producers still ingest and display without error.

---

## Out of scope

- A dedicated `test_cycles` database table — `testCycleId` is a grouping label on evidence, not an entity with its own lifecycle. A cycle exists because evidence exists for it.
- Per-cycle markdown report generation — the per-cycle data is already structured evidence (JSON, screenshots, HTML report). The portal renders it; no markdown duplication needed.
- Changes to evidence types or categories — `testCycleId` is orthogonal to `evidence_type` and `evidence_category`.
- Changes to the completeness matrix — cycle grouping is a display concern; the completeness matrix already tracks per-REQ, per-stage completeness.

---

## Implementation notes

- Follow the same deploy pattern used for `sdlc_stage`: portal tolerant-read first, producer second.
- The `testCycleId` value is typically a GitHub Actions `run_id` (a numeric string). No validation of format is needed — it is an opaque grouping key.
- The UI grouping should be additive to the existing per-REQ evidence list, not a replacement. The flat list remains for legacy evidence and for users who prefer the ungrouped view.
