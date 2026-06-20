# Portal-side implementation guide: SDLC stage labelling, Playwright bundle rendering, stage-grouped evidence

**Target repo:** `metasession-dev/devaudit` (the portal — NOT DevAudit-Installer)
**Companion:** `docs/issues/sdlc-stage-evidence-PORTAL.md` (the issue spec)
**Producer-side guide:** `docs/issues/sdlc-stage-evidence-IMPLEMENTATION.md` (DevAudit-Installer repo)

This guide is mechanical. Each task gives the exact file path, the exact text to find, and the exact replacement. Execute tasks in order. Do not skip. Do not improvise.

---

## Conventions

- **Find** blocks show enough surrounding context to be unique.
- **Replace** blocks show the final state of the marked region.
- Run `npx prisma format` after editing `schema.prisma`.
- Run `npx prisma generate` after schema changes so the TypeScript types update.
- Run `npm test` after all tasks to verify.

---

## Task P1 — Add `sdlc_stage` column to the database schema

### P1a — Prisma schema

**File:** `prisma/schema.prisma`

**Find** the `compliance_evidence` model, specifically the `evidence_category` field and the archive comment that follows it:

```
  evidence_category    String?
  /// #410 — soft-archive (supersede). Append-only invariant preserved:
```

**Replace** with:

```
  evidence_category    String?
  /// SDLC stage label (DevAudit-Installer #175). NULL = unspecified.
  /// Valid values: 1 (plan), 2 (implement/test), 3 (compile-evidence),
  /// 4 (submit-for-review), 5 (deploy). Additive — older rows have NULL.
  sdlc_stage           Int?
  /// #410 — soft-archive (supersede). Append-only invariant preserved:
```

### P1b — Migration SQL

**File:** `prisma/migrations/20_sdlc_stage/migration.sql` (NEW FILE)

Create with this exact content:

```sql
-- Additive column: SDLC stage label for evidence rows.
-- NULL = unspecified (backward-compatible with all existing rows).
ALTER TABLE "compliance_evidence" ADD COLUMN "sdlc_stage" Integer;
```

### P1c — Generate Prisma client

After editing the schema, run:

```bash
npx prisma format
npx prisma generate
```

This updates the generated TypeScript types so `compliance_evidence` rows include `sdlc_stage`.

---

## Task P2 — Add `SdlcStage` type and update `ComplianceEvidence` interface

### P2a — Type definition

**File:** `lib/types.ts`

**Find** the `EvidenceCategory` type definition (a union of string literals like `'ci_pipeline' | 'local_dev' | ...`).

**Add immediately after the closing `;` of that type:**

```typescript

export type SdlcStage = 1 | 2 | 3 | 4 | 5;
```

### P2b — Add `sdlc_stage` to `ComplianceEvidence` interface

**File:** `lib/types.ts`

**Find** in the `ComplianceEvidence` interface:

```
  evidence_category: EvidenceCategory | null;
  /** #410 — soft-archive (supersede). NULL when the row is active. */
  archived_at: string | null;
```

**Replace** with:

```
  evidence_category: EvidenceCategory | null;
  /** SDLC stage label (DevAudit-Installer #175). NULL = unspecified. */
  sdlc_stage: SdlcStage | null;
  /** #410 — soft-archive (supersede). NULL when the row is active. */
  archived_at: string | null;
```

---

## Task P3 — Add `playwright_report_bundle` evidence type

**File:** `lib/config/evidence-types.ts`

**Find** the `e2e_result` entry in the `EVIDENCE_TYPE_REGISTRY` array:

```
  {
    value: 'e2e_result',
    label: 'E2E test result (JSON)',
    defaultScope: 'requirement',
    group: 'tests',
    whenToUse: 'Playwright / Cypress JSON reporter output. One per release per environment.',
  },
```

**Add immediately after it** (before the `sast_report` entry):

```typescript
  {
    value: 'playwright_report_bundle',
    label: 'Playwright report bundle (ZIP)',
    defaultScope: 'requirement',
    group: 'tests',
    whenToUse:
      'Full Playwright HTML report zipped (playwright-report.zip). Contains index.html, data/, trace/*.zip, and screenshots. Uploaded as a single ZIP file; the portal extracts report.json server-side for inline rendering. One per release per environment.',
  },
```

> `isValidEvidenceType()` automatically picks up new entries because it maps over the array. No additional registration needed.

---

## Task P4 — Accept `sdlcStage` on upload

### P4a — Upload route: parse the form field

**File:** `app/api/evidence/upload/route.ts`

**Find** the `changeType` parsing block (the `ALLOWED_CHANGE_TYPES` set and the `const changeType =` line).

**Add immediately after the `const changeType = ...` line** (before `if (!file)`):

```typescript
    // SDLC stage (DevAudit-Installer #175): additive, optional.
    // Silently drop invalid values — same pattern as changeType above.
    const sdlcStageRaw = formData.get('sdlcStage') as string | null;
    const ALLOWED_SDLC_STAGES = new Set(['1', '2', '3', '4', '5']);
    const sdlcStage =
      sdlcStageRaw && ALLOWED_SDLC_STAGES.has(sdlcStageRaw)
        ? parseInt(sdlcStageRaw, 10)
        : null;
```

### P4b — Upload route: pass to service

**File:** `app/api/evidence/upload/route.ts`

**Find** the `service.uploadEvidence(...)` call and its object argument that ends with:

```
        evidenceCategory: evidenceCategory as EvidenceCategory | undefined,
      },
```

**Replace** that closing with:

```
        evidenceCategory: evidenceCategory as EvidenceCategory | undefined,
        sdlcStage: sdlcStage as SdlcStage | null,
      },
```

### P4c — Upload route: add import

**File:** `app/api/evidence/upload/route.ts`

**Find:**

```
import type { EvidenceType, ReleaseEnvironment, EvidenceCategory } from '@/lib/types';
```

**Replace** with:

```
import type { EvidenceType, ReleaseEnvironment, EvidenceCategory, SdlcStage } from '@/lib/types';
```

### P4d — Service: accept `sdlcStage` in input interface

**File:** `lib/services/evidence-service.ts`

**Find** the `UploadEvidenceInput` interface, specifically its last field:

```
  evidenceCategory?: EvidenceCategory;
}
```

**Replace** with:

```
  evidenceCategory?: EvidenceCategory;
  sdlcStage?: SdlcStage | null;
}
```

### P4e — Service: add import

**File:** `lib/services/evidence-service.ts`

**Find:**

```
import type {
  ComplianceEvidence,
  EvidenceType,
  ReleaseEnvironment,
  EvidenceCategory,
} from '@/lib/types';
```

**Replace** with:

```
import type {
  ComplianceEvidence,
  EvidenceType,
  ReleaseEnvironment,
  EvidenceCategory,
  SdlcStage,
} from '@/lib/types';
```

### P4f — Service: forward `sdlcStage` to repository

**File:** `lib/services/evidence-service.ts`

**Find** the `evidenceRepo.create({...})` call, specifically its last field:

```
      evidence_category: input.evidenceCategory ?? null,
    });
```

**Replace** with:

```
      evidence_category: input.evidenceCategory ?? null,
      sdlc_stage: input.sdlcStage ?? null,
    });
```

### P4g — Repository: include `sdlc_stage` in `toEvidence()`

**File:** `lib/repositories/evidence-repository.ts`

**Find** the `toEvidence` function, specifically:

```
    evidence_category: row.evidence_category as EvidenceCategory | null,
    archived_at: row.archived_at ? row.archived_at.toISOString() : null,
```

**Replace** with:

```
    evidence_category: row.evidence_category as EvidenceCategory | null,
    sdlc_stage: (row.sdlc_stage ?? null) as SdlcStage | null,
    archived_at: row.archived_at ? row.archived_at.toISOString() : null,
```

### P4h — Repository: add import

**File:** `lib/repositories/evidence-repository.ts`

**Find:**

```
import type {
  ComplianceEvidence,
  EvidenceCategory,
  EvidenceType,
  ReleaseEnvironment,
} from '@/lib/types';
```

**Replace** with:

```
import type {
  ComplianceEvidence,
  EvidenceCategory,
  EvidenceType,
  ReleaseEnvironment,
  SdlcStage,
} from '@/lib/types';
```

---

## Task P5 — Playwright report bundle extraction endpoint

### P5a — Install dependency

```bash
npm install adm-zip
npm install -D @types/adm-zip
```

### P5b — New API route

**File:** `app/api/evidence/[id]/playwright-json/route.ts` (NEW FILE)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createEvidenceService } from '@/lib/services/factories';
import { requireAuthenticatedUser } from '@/lib/auth/get-user';
import AdmZip from 'adm-zip';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAuthenticatedUser();
  const { id } = await params;

  const filePath = new URL(_request.url).searchParams.get('filePath');
  if (!filePath) {
    return NextResponse.json(
      { error: 'filePath query parameter is required' },
      { status: 400 },
    );
  }

  try {
    const service = await createEvidenceService();
    const signedUrl = await service.getSignedDownloadUrl(filePath);

    const response = await fetch(signedUrl);
    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to download bundle: ${response.status}` },
        { status: 502 },
      );
    }

    const zipBuffer = Buffer.from(await response.arrayBuffer());
    const zip = new AdmZip(zipBuffer);

    // Playwright JSON reporter output is at report.json or data/report.json
    const candidates = ['report.json', 'data/report.json'];
    for (const candidate of candidates) {
      const entry = zip.getEntry(candidate);
      if (entry) {
        try {
          const json = JSON.parse(entry.getData().toString('utf-8'));
          return NextResponse.json(json);
        } catch {
          // Not valid JSON — try next candidate
        }
      }
    }

    return NextResponse.json(
      { error: 'No valid Playwright JSON report found in bundle' },
      { status: 404 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Extraction failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

> **Simpler alternative:** If the implementing model finds server-side ZIP extraction problematic, skip P5a/P5b and use client-side extraction in P6 instead. Install `fflate` (`npm install fflate`) and have the renderer fetch the ZIP from `signedUrl`, decompress with `fflate.unzipSync`, and parse `report.json`. This trades server CPU for client bandwidth.

---

## Task P6 — Update PlaywrightRenderer to handle bundles

### P6a — Update `EvidenceArtifact` interface

**File:** `lib/interfaces/evidence-renderer.ts`

**Find** the `EvidenceArtifact` interface:

```
export interface EvidenceArtifact {
  signedUrl: string;
  fileName: string;
  mimeType: string;
}
```

**Replace** with:

```
export interface EvidenceArtifact {
  signedUrl: string;
  fileName: string;
  mimeType: string;
  id?: string;
  evidenceType?: string;
  filePath?: string;
}
```

> Fields are optional so existing callers that don't pass them still compile.

### P6b — Update renderer fetch logic

**File:** `components/evidence-viewer/playwright-renderer.tsx`

**Find** the `useEffect` block:

```
  useEffect(() => {
    let cancelled = false;
    fetch(artifact.signedUrl)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (isPlaywrightReport(data)) {
          const parsed = parsePlaywrightReport(data);
          if (parsed) setReport(parsed);
          else setFallback(true);
        } else {
          setFallback(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.signedUrl]);
```

**Replace** with:

```
  useEffect(() => {
    let cancelled = false;

    // For playwright_report_bundle (ZIP), fetch from the server-side
    // extraction endpoint. For raw JSON (e2e_result), fetch signedUrl directly.
    const isBundle = artifact.evidenceType === 'playwright_report_bundle';
    const fetchUrl = isBundle && artifact.id && artifact.filePath
      ? `/api/evidence/${artifact.id}/playwright-json?filePath=${encodeURIComponent(artifact.filePath)}`
      : artifact.signedUrl;

    fetch(fetchUrl)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (isPlaywrightReport(data)) {
          const parsed = parsePlaywrightReport(data);
          if (parsed) setReport(parsed);
          else setFallback(true);
        } else {
          setFallback(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.signedUrl, artifact.id, artifact.evidenceType, artifact.filePath]);
```

### P6c — Pass extra props from evidence list

**File:** `components/evidence/evidence-list.tsx`

Find where `EvidenceArtifact` objects are constructed (where `signedUrl`, `fileName`, `mimeType` are set from an evidence row). Add these fields to each object:

```typescript
id: e.id,
evidenceType: e.evidence_type,
filePath: e.file_path,
```

The exact code location depends on the file's current shape — look for where the artifact object is built and add the three fields.

---

## Task P7 — Stage badge component

**File:** `components/dashboard/stage-badge.tsx` (NEW FILE)

```tsx
import { cn } from '@/lib/utils';
import type { SdlcStage } from '@/lib/types';

const STAGE_CONFIG: Record<number, { label: string; colour: string }> = {
  1: { label: 'Stage 1: Plan', colour: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  2: { label: 'Stage 2: Implement/Test', colour: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  3: { label: 'Stage 3: Compile Evidence', colour: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  4: { label: 'Stage 4: Submit for Review', colour: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  5: { label: 'Stage 5: Deploy', colour: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

const UNSPECIFIED = {
  label: 'Unspecified',
  colour: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export function StageBadge({ stage }: { stage: SdlcStage | null }) {
  const config = stage ? STAGE_CONFIG[stage] ?? UNSPECIFIED : UNSPECIFIED;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
        config.colour,
      )}
    >
      {config.label}
    </span>
  );
}
```

---

## Task P8 — AC-proof vs run-context classifier

**File:** `lib/dashboard/stage-classifier.ts` (NEW FILE)

```typescript
import type { ComplianceEvidence } from '@/lib/types';

const AC_PROOF_TYPES = new Set(['screenshot', 'e2e_result']);

export type EvidenceClass = 'ac_proof' | 'run_context';

export function classifyEvidence(
  evidence: Pick<ComplianceEvidence, 'evidence_type'>,
): EvidenceClass {
  return AC_PROOF_TYPES.has(evidence.evidence_type) ? 'ac_proof' : 'run_context';
}

export function isAcProof(
  evidence: Pick<ComplianceEvidence, 'evidence_type'>,
): boolean {
  return classifyEvidence(evidence) === 'ac_proof';
}
```

---

## Task P9 — Stage-aware completeness calculator

**File:** `lib/dashboard/stage-completeness.ts` (NEW FILE)

```typescript
import type { ComplianceEvidence, SdlcStage } from '@/lib/types';
import { isAcProof } from './stage-classifier';

export type ReleaseStatus = 'draft' | 'uat_review' | 'prod_review' | 'released';

export interface StageCompleteness {
  stage: SdlcStage;
  hasEvidence: boolean;
  expected: boolean;
}

const STAGES_BY_STATUS: Record<ReleaseStatus, SdlcStage[]> = {
  draft: [1, 2, 3],
  uat_review: [1, 2, 3, 4],
  prod_review: [1, 2, 3, 4, 5],
  released: [1, 2, 3, 4, 5],
};

const ALL_STAGES: SdlcStage[] = [1, 2, 3, 4, 5];

export function computeStageCompleteness(
  evidence: readonly Pick<ComplianceEvidence, 'sdlc_stage' | 'evidence_type'>[],
  releaseStatus: ReleaseStatus,
): StageCompleteness[] {
  const expectedStages = new Set(STAGES_BY_STATUS[releaseStatus] ?? ALL_STAGES);

  const stagesWithAcProof = new Set<SdlcStage>();
  for (const e of evidence) {
    if (!isAcProof(e)) continue;
    if (e.sdlc_stage !== null) {
      stagesWithAcProof.add(e.sdlc_stage);
    }
  }

  return ALL_STAGES.map((stage) => ({
    stage,
    hasEvidence: stagesWithAcProof.has(stage),
    expected: expectedStages.has(stage),
  }));
}
```

---

## Task P10 — Add stage badges to the evidence list UI

### P10a — Import the badge

**File:** `components/dashboard/release-evidence-list.tsx`

Add to the import block at the top:

```
import { StageBadge } from '@/components/dashboard/stage-badge';
```

### P10b — Render the badge per evidence row

**File:** `components/evidence/evidence-list.tsx`

This component renders individual evidence rows. Find where each row is rendered (a `<div>` or `<li>` containing the file name). Add `<StageBadge stage={item.sdlc_stage} />` next to the file name. You will need to:

1. Ensure `sdlc_stage` is included in the item type this component accepts (it should already flow through since `ComplianceEvidence` now has the field).
2. Import `StageBadge` in this file too.
3. Render the badge inline with the file name.

The exact insertion point depends on the existing JSX structure. Look for where `item.file_name` or `e.file_name` is rendered and add the badge next to it.

---

## Task P11 — Add stage-aware completeness to the dashboard data

### P11a — Import the calculator

**File:** `lib/services/release-service.ts`

Add after existing imports:

```typescript
import { computeStageCompleteness, type StageCompleteness } from '@/lib/dashboard/stage-completeness';
```

### P11b — Compute and return stage completeness

**File:** `lib/services/release-service.ts`

**Find** the `getReleaseDashboardData` method. After the `completenessPercent` calculation and before the `return` statement, add:

```typescript
    // Stage-aware completeness (DevAudit-Installer #175)
    const stageCompleteness = computeStageCompleteness(
      evidence,
      (release.status as 'draft' | 'uat_review' | 'prod_review' | 'released') ?? 'draft',
    );
```

Then find the return object and add `stageCompleteness,` to it.

### P11c — Update the return type

**File:** `lib/services/release-service.ts`

**Find** the `ReleaseDashboardData` interface (or type). Add:

```
  stageCompleteness?: StageCompleteness[];
```

---

## Task P12 — Tests

### P12a — Evidence type registry test

**File:** `tests/unit/config/evidence-types.test.ts`

Add:

```typescript
it('includes playwright_report_bundle in the registry', () => {
  expect(VALID_EVIDENCE_TYPES).toContain('playwright_report_bundle');
  expect(isValidEvidenceType('playwright_report_bundle')).toBe(true);
});
```

### P12b — Stage classifier test

**File:** `tests/unit/dashboard/stage-classifier.test.ts` (NEW FILE)

```typescript
import { describe, it, expect } from 'vitest';
import { classifyEvidence, isAcProof } from '@/lib/dashboard/stage-classifier';

describe('stage-classifier', () => {
  it('classifies screenshots as ac_proof', () => {
    expect(classifyEvidence({ evidence_type: 'screenshot' })).toBe('ac_proof');
  });

  it('classifies e2e_result as ac_proof', () => {
    expect(classifyEvidence({ evidence_type: 'e2e_result' })).toBe('ac_proof');
  });

  it('classifies playwright_report_bundle as run_context', () => {
    expect(classifyEvidence({ evidence_type: 'playwright_report_bundle' })).toBe('run_context');
  });

  it('classifies sast_report as run_context', () => {
    expect(classifyEvidence({ evidence_type: 'sast_report' })).toBe('run_context');
  });

  it('isAcProof returns true for screenshots', () => {
    expect(isAcProof({ evidence_type: 'screenshot' })).toBe(true);
  });

  it('isAcProof returns false for bundles', () => {
    expect(isAcProof({ evidence_type: 'playwright_report_bundle' })).toBe(false);
  });
});
```

### P12c — Stage completeness test

**File:** `tests/unit/dashboard/stage-completeness.test.ts` (NEW FILE)

```typescript
import { describe, it, expect } from 'vitest';
import { computeStageCompleteness } from '@/lib/dashboard/stage-completeness';

describe('computeStageCompleteness', () => {
  it('marks all stages as not-hasEvidence when no AC-proof evidence exists', () => {
    const result = computeStageCompleteness([], 'draft');
    expect(result).toHaveLength(5);
    expect(result.every((s) => s.hasEvidence === false)).toBe(true);
  });

  it('marks stage 2 as hasEvidence when a stage-2 screenshot exists', () => {
    const result = computeStageCompleteness(
      [{ sdlc_stage: 2, evidence_type: 'screenshot' }],
      'draft',
    );
    const stage2 = result.find((s) => s.stage === 2);
    expect(stage2?.hasEvidence).toBe(true);
  });

  it('does not count run-context evidence toward hasEvidence', () => {
    const result = computeStageCompleteness(
      [{ sdlc_stage: 2, evidence_type: 'playwright_report_bundle' }],
      'draft',
    );
    const stage2 = result.find((s) => s.stage === 2);
    expect(stage2?.hasEvidence).toBe(false);
  });

  it('marks stages 4 and 5 as not-expected for draft status', () => {
    const result = computeStageCompleteness([], 'draft');
    const stage4 = result.find((s) => s.stage === 4);
    const stage5 = result.find((s) => s.stage === 5);
    expect(stage4?.expected).toBe(false);
    expect(stage5?.expected).toBe(false);
  });

  it('marks stage 5 as expected for released status', () => {
    const result = computeStageCompleteness([], 'released');
    const stage5 = result.find((s) => s.stage === 5);
    expect(stage5?.expected).toBe(true);
  });

  it('ignores evidence with null sdlc_stage', () => {
    const result = computeStageCompleteness(
      [{ sdlc_stage: null, evidence_type: 'screenshot' }],
      'draft',
    );
    expect(result.every((s) => s.hasEvidence === false)).toBe(true);
  });
});
```

### P12d — Upload route test (sdlcStage)

**File:** `tests/unit/services/evidence-service.test.ts`

Add a test that verifies `sdlc_stage` is forwarded to the repository `create()` call. Follow the existing pattern used for `evidenceCategory` or `environment` in that file — mock the repo, call `uploadEvidence` with `sdlcStage: 2`, and assert the mock `create` received `sdlc_stage: 2`.

---

## Verification

After completing all tasks, run:

```bash
# 1. Prisma schema is valid + client generated
npx prisma format
npx prisma generate

# 2. TypeScript compiles
npx tsc --noEmit

# 3. All tests pass
npm test

# 4. New evidence type is registered
node -e "const { VALID_EVIDENCE_TYPES } = require('./lib/config/evidence-types'); console.log(VALID_EVIDENCE_TYPES.includes('playwright_report_bundle') ? 'OK' : 'MISSING')"

# 5. Migration file exists
test -f prisma/migrations/20_sdlc_stage/migration.sql && echo "OK migration"
```

All must pass. If any fail, read the error, fix your edit, and re-run until green.

---

## Appendix A — Stage mapping reference

| SDLC Stage | Number | Label | Typical evidence |
|---|---|---|---|
| Plan | 1 | Stage 1: Plan | Implementation plans, test plans, test scope docs |
| Implement/Test | 2 | Stage 2: Implement/Test | Per-AC screenshots, feature-branch E2E reports |
| Compile Evidence | 3 | Stage 3: Compile Evidence | Compliance docs, SRS alignment, risk assessment, regression E2E |
| Submit for Review | 4 | Stage 4: Submit for Review | Release ticket, UAT review submission |
| Deploy | 5 | Stage 5: Deploy | Post-deploy smoke tests, production verification |

---

## Appendix B — What NOT to do

1. **Do NOT** modify the screenshot filename validator (`lib/validators/screenshot-filename.ts`). It is already gated on `evidenceType === 'screenshot'` and will not affect `playwright_report_bundle` uploads.
2. **Do NOT** make `sdlcStage` a required field. It must remain optional for backward compatibility.
3. **Do NOT** change the existing `PlaywrightRenderer` fallback chain (`JestRenderer` → `JsonRenderer` → `FallbackRenderer`). It must remain intact for non-bundle evidence.
4. **Do NOT** remove or rename any existing evidence types. The new `playwright_report_bundle` is additive.
5. **Do NOT** edit `supabase/migrations/` — the portal uses Prisma migrations now. Only create `prisma/migrations/20_sdlc_stage/`.
