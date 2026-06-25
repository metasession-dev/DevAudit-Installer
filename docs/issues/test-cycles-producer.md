# First-class test cycles: producer-side `--test-cycle` flag

**Status:** Proposed
**Labels:** `enhancement`, `framework`, `github_actions`
**Priority:** Medium
**Related:** metasession-dev/devaudit#535, #207 (evidence_type collisions)
**GitHub:** https://github.com/metasession-dev/DevAudit-Installer/issues/209

---

## Context

Every CI run already produces a set of evidence artifacts stamped with `--ci-run-id ${{ github.run_id }}`. That `ciRunId` lives inside the `metadata` JSON blob on each evidence record. It is a de facto cycle identifier — it is just not first-class. This issue promotes it to a top-level field on the upload contract so the portal can group evidence by test cycle (ISO/IEC/IEEE 29119-3 terminology: per-cycle Test Execution Logs, Test Status Reports, and Test Outcomes).

The portal-side changes (accept `testCycleId`, group evidence by cycle in the release detail view) are tracked in a separate issue on metasession-dev/devaudit.

**Deploy order: portal tolerant-read first, producer second.** This issue must not be merged until the portal accepts `testCycleId` on `/api/evidence/upload`.

---

## What changes

### 1. `scripts/upload-evidence.sh` — add `--test-cycle` flag

Add a `TEST_CYCLE=""` variable and `--test-cycle` case to the arg parser, following the exact same pattern as `--sdlc-stage`:

```bash
# Variable declaration (near SDLC_STAGE="")
TEST_CYCLE=""

# Arg parser case (near --sdlc-stage)
--test-cycle) TEST_CYCLE="$2"; shift 2 ;;
```

Forward as a form field in the multipart upload (near the `sdlcStage` form field):

```bash
[ -n "$TEST_CYCLE" ] && CURL_ARGS+=(-F "testCycleId=${TEST_CYCLE}")
```

Also forward in the presigned URL JSON body (same pattern as `sdlcStage` there).

### 2. CLI `cli/src/commands/push.ts` — add `testCycle` to `PushOptions`

```typescript
readonly testCycle?: string;
```

Forward to `uploadEvidence` in the `runPush` call:

```typescript
...(options.testCycle !== undefined ? { testCycleId: options.testCycle } : {}),
```

### 3. CLI `cli/src/lib/ci-upload.ts` — add `testCycleId` to `UploadOptions`

```typescript
readonly testCycleId?: string;
```

In `buildUploadForm`:

```typescript
if (opts.testCycleId) form.set('testCycleId', opts.testCycleId);
```

### 4. CLI `cli/src/index.ts` — add `--test-cycle` option to the `push` command

```typescript
.option('--test-cycle <id>', 'test cycle identifier (typically the CI run ID)')
```

### 5. `sdlc/files/ci/ci.yml.template` — add `--test-cycle` to FLAGS

In the "Generate and upload gate evidence" step, add to the `FLAGS` variable (line ~412):

```bash
FLAGS="${FLAGS} --test-cycle ${{ github.run_id }}"
```

Also add to the `FANOUT_FLAGS` variable (line ~568):

```bash
FANOUT_FLAGS="${FANOUT_FLAGS} --test-cycle ${{ github.run_id }}"
```

### 6. `sdlc/files/ci/compliance-evidence.yml.template` — add `--test-cycle` to FLAGS

Same addition to the `FLAGS` variable in the compliance-evidence upload step.

### 7. `sdlc/files/_common/3-compile-evidence.md` — update `test-execution-summary.md` template

Add a "Test Cycles" section to the template (after the "Gate Results" section):

```markdown
## Test Cycles

| Cycle | CI Run | Gate Status | E2E Result | Coverage | Date |
|-------|--------|-------------|------------|----------|------|
| #1    | [run_id] | [PASS/FAIL] | [N/N]   | [N%]     | [YYYY-MM-DD] |

**Final assessment:** [All cycles passed / N cycles failed — see incidents]
```

This section is the ISO 29119-3 Test Completion Report's cycle summary — populated at Stage 3 after all cycles for a release are complete.

### 8. `sdlc/files/_common/3-compile-evidence.md` — add Step 4a: Query portal for test cycle data

Add a new step between the current Step 4 (re-run test pack) and Step 5 (organise artefacts) in the Stage 3 walkthrough:

```markdown
### Step 4a: Query portal for test cycle data

Before generating the Test Execution Summary, query the portal API for all
evidence records for this release, grouped by `testCycleId`. Populate the
Test Cycles table in `test-execution-summary.md` from the API response —
do not hand-assemble cycle data from memory or manual inspection.

If the portal does not yet support `testCycleId` grouping (pre-deployment
of devaudit#535), fall back to local CI run IDs from
`compliance/evidence/REQ-XXX/` artefact filenames and note the fallback
in the summary.
```

This keeps cycle aggregation within the guided SDLC flow — the operator
doesn't manually assemble cycle data outside the skill's control.

### 9. `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` — Phase 3 step 4a delegation

Add a new step 4a to Phase 3 (between the current step 4 "re-run the full
test pack" and step 5 "organise artefacts"):

```markdown
4a. **Query the portal for test cycle data and populate the Test Cycles
section of `test-execution-summary.md`.** Query the portal API for all
evidence records for this release, grouped by `testCycleId`. Populate the
Test Cycles table (CI Run, Gate Status, E2E Result, Coverage, Date) from
the API response. If the portal doesn't yet support `testCycleId`
grouping (pre-deployment of devaudit#535), fall back to local CI run IDs
from `compliance/evidence/REQ-XXX/` artefact filenames and note the
fallback. Do not hand-assemble cycle data — the skill queries, populates,
and uploads. This prevents the operator from going rogue and manually
assembling cycle data outside the guided SDLC flow.
```

---

## Acceptance criteria

- AC1: `upload-evidence.sh --test-cycle <id>` forwards `testCycleId=<id>` as a form field; missing `--test-cycle` omits the field (no regression).
- AC2: `devaudit push --test-cycle <id>` forwards `testCycleId` in the multipart form data.
- AC3: Both CI templates (`ci.yml.template`, `compliance-evidence.yml.template`) stamp `--test-cycle ${{ github.run_id }}` on every upload.
- AC4: The `test-execution-summary.md` template in `3-compile-evidence.md` includes a "Test Cycles" section.
- AC5: `3-compile-evidence.md` includes Step 4a (query portal for test cycle data) with fallback for pre-devaudit#535 portals.
- AC6: `sdlc-implementer/SKILL.md` Phase 3 includes step 4a delegation for cycle data population — the skill queries the portal, not the operator.
- AC7: `bash -n scripts/upload-evidence.sh` passes (syntax check).
- AC8: `npm --prefix cli run build` and `npm --prefix cli test` pass.
- AC9: Uploads from pre-`--test-cycle` producers still work (portal tolerant-read — `testCycleId` is additive/optional).

---

## Out of scope

- Portal-side changes (database column, API acceptance, UI grouping) — tracked separately on metasession-dev/devaudit.
- Per-cycle markdown report generation — the per-cycle data is already structured evidence in the portal (JSON, screenshots, HTML report). No per-cycle markdown is needed.
- New evidence types or categories — `testCycleId` is orthogonal to `evidence_type` and `evidence_category`.
- A dedicated `test_cycles` database table — `testCycleId` is a grouping label on evidence, not an entity with its own lifecycle.
