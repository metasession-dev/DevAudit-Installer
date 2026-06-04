/**
 * Pure helpers backing `evidenceShot`. Kept Playwright-free so they
 * can be unit-tested without pulling `@playwright/test` into the
 * installer repo. The thin wrapper in `evidence.ts` does the Page
 * screenshot + fs writes around these.
 */

export type EvidenceShotOrigin = 'feature' | 'regression';

/**
 * Capture density tier. Lets spec authors mark intermediate-state
 * screenshots that only matter while the spec is being authored on a
 * feature branch — once the spec joins the regression pack, those
 * become noise and inflate CI artefact storage.
 *
 * - `'always'` (default) — capture on every run. Use for the canonical
 *   "this still works" anchor per AC; the artefact reviewers rely on
 *   to corroborate the test-plan mapping across every release.
 * - `'feature'` — capture only when the spec's origin is `feature`
 *   (i.e. the spec was added on the current branch per
 *   `E2E_NEW_SPECS`). Auto-suppressed once the spec graduates into
 *   the regression pack. Use for stage screenshots covering meaningful
 *   intermediate transitions reviewers want during the feature cycle.
 */
export type EvidenceShotTier = 'always' | 'feature';

export interface EvidenceShotSidecar {
  readonly origin: EvidenceShotOrigin;
  readonly reqId: string;
  readonly ac: number;
  readonly slug: string;
  readonly specFile: string;
  readonly capturedAt: string;
}

/**
 * Pure decision: should the capture be suppressed?
 *
 * The only suppression case is `tier='feature'` × `origin='regression'`
 * — a stage screenshot whose spec has graduated into the regression
 * pack. Every other (tier, origin) combination captures.
 */
export function shouldSuppressEvidenceShot(
  tier: EvidenceShotTier,
  origin: EvidenceShotOrigin,
): boolean {
  return tier === 'feature' && origin === 'regression';
}

const REQ_ID_RE = /^REQ-[A-Z0-9-]+$/;
const SLUG_RE = /^[a-z0-9-]+$/;

export function validateEvidenceShotInputs(reqId: string, ac: number, slug: string): void {
  if (!REQ_ID_RE.test(reqId)) {
    throw new Error(`evidenceShot: invalid reqId "${reqId}" (must match ${REQ_ID_RE})`);
  }
  if (!Number.isInteger(ac) || ac <= 0) {
    throw new Error(`evidenceShot: invalid ac "${ac}" (must be a positive integer)`);
  }
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `evidenceShot: invalid slug "${slug}" (must match ${SLUG_RE} — kebab-case, no AC prefix)`,
    );
  }
}

export function composeScreenshotFilename(reqId: string, ac: number, slug: string): string {
  return `${reqId}-AC${ac}-${slug}.png`;
}

/**
 * Auto-detect origin from `process.env.E2E_NEW_SPECS` — the consumer
 * globalSetup writes the newline-delimited list of spec files added
 * on the current branch (`git diff --diff-filter=A`). If the calling
 * spec appears in that list, it's `feature`; otherwise `regression`.
 *
 * Empty / missing env (typical for post-merge develop runs) → every
 * capture is `regression`, which is the correct semantic outcome.
 */
export function autoDetectEvidenceShotOrigin(
  specFile: string,
  newSpecsEnv: string | undefined,
): EvidenceShotOrigin {
  const list = (newSpecsEnv ?? '').trim();
  if (list.length === 0) return 'regression';
  const newSpecs = new Set(
    list
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return newSpecs.has(specFile) ? 'feature' : 'regression';
}
