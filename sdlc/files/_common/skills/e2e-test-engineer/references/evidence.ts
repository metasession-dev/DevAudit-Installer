import fs from 'fs';
import path from 'path';
import { test, type Page } from '@playwright/test';
import {
  autoDetectEvidenceShotOrigin,
  composeScreenshotFilename,
  shouldSuppressEvidenceShot,
  validateEvidenceShotInputs,
  type EvidenceShotOrigin,
  type EvidenceShotSidecar,
  type EvidenceShotTier,
} from './evidence-shot-core';

export type { EvidenceShotOrigin, EvidenceShotTier };

export interface EvidenceShotOptions {
  /** Capture the full page rather than the viewport. Default: true. */
  readonly fullPage?: boolean;
  /**
   * Override the auto-detected origin. By default the helper consults
   * `process.env.E2E_NEW_SPECS` — set by the consumer's Playwright
   * `globalSetup` step in CI — and tags the screenshot `feature` if
   * the calling spec's file appears in that list, else `regression`.
   */
  readonly origin?: EvidenceShotOrigin;
  /**
   * Capture density tier. Default: `'always'`. Set to `'feature'` for
   * intermediate-state screenshots that should only fire while the
   * spec is on a feature branch — they auto-suppress once the spec
   * graduates into the regression pack. See the SKILL.md "Screenshot
   * density per spec role" section for the density policy.
   */
  readonly tier?: EvidenceShotTier;
}

/**
 * Write a per-AC behavioural-proof screenshot into the requirement's
 * evidence pack.
 *
 * Call this AT the assertion that proves the AC, before any further
 * interaction or navigation. The PNG is committed as part of the
 * evidence pack and used by reviewers to corroborate the test-plan
 * AC mapping.
 *
 * Filename: `REQ-XXX-AC<n>-<slug>.png`
 * Output path: `compliance/evidence/<reqId>/screenshots/<filename>`
 *
 * The helper also writes a sidecar `<filename>.meta.json` containing
 * `{ origin, reqId, ac, slug, specFile, capturedAt }`. The consumer's
 * CI upload step reads the sidecar and passes `origin` as evidence
 * metadata to the portal so the release-detail page can tell feature
 * captures apart from regression-pack reruns.
 *
 * @example
 *   await expect(dialog.locator('#name')).toHaveValue(item.name);
 *   await evidenceShot(page, 'REQ-037', 1, 'edit-dialog-prefilled');
 *
 * @param page Playwright Page
 * @param reqId `REQ-` prefixed requirement id (e.g. `REQ-037`)
 * @param ac AC number — mandatory; every screenshot proves one AC
 * @param slug kebab-case descriptive slug (no `AC<n>-` prefix; the
 *             helper composes it from `ac`)
 */
export async function evidenceShot(
  page: Page,
  reqId: string,
  ac: number,
  slug: string,
  opts: EvidenceShotOptions = {},
): Promise<void> {
  validateEvidenceShotInputs(reqId, ac, slug);
  const tier: EvidenceShotTier = opts.tier ?? 'always';
  const specFile = resolveSpecFile();
  const origin = opts.origin ?? autoDetectEvidenceShotOrigin(specFile, process.env.E2E_NEW_SPECS);
  if (shouldSuppressEvidenceShot(tier, origin)) return;
  const fileName = composeScreenshotFilename(reqId, ac, slug);
  const dir = path.join(process.cwd(), 'compliance/evidence', reqId, 'screenshots');
  const pngPath = path.join(dir, fileName);
  const sidecarPath = `${pngPath}.meta.json`;
  await page.screenshot({ path: pngPath, fullPage: opts.fullPage ?? true });
  const sidecar: EvidenceShotSidecar = {
    origin,
    reqId,
    ac,
    slug,
    specFile,
    capturedAt: new Date().toISOString(),
  };
  await fs.promises.writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
}

/**
 * Test-info gives us the absolute spec path. Make it repo-relative so
 * it survives serialisation into the sidecar JSON + the CI's git diff
 * comparison list.
 */
function resolveSpecFile(): string {
  try {
    const info = test.info();
    return path.relative(process.cwd(), info.file);
  } catch {
    return 'unknown';
  }
}
