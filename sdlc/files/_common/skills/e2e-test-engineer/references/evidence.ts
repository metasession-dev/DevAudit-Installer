import path from 'path';
import { type Page } from '@playwright/test';

const SLUG_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Write a per-assertion screenshot into the requirement's evidence pack.
 *
 * Call this AT the assertion that proves the AC, before any further
 * interaction or navigation. The PNG is committed as part of the
 * evidence pack and used by reviewers to corroborate the test-plan
 * AC mapping.
 *
 * Output path: `compliance/evidence/<reqId>/screenshots/<slug>.png`
 *
 * @example
 *   await expect(dialog.locator('#name')).toHaveValue(item.name);
 *   await evidenceShot(page, 'REQ-037', 'AC1-edit-dialog-prefilled');
 */
export async function evidenceShot(
  page: Page,
  reqId: string,
  slug: string,
  opts: { fullPage?: boolean } = {},
): Promise<void> {
  if (!SLUG_RE.test(reqId)) {
    throw new Error(`evidenceShot: invalid reqId "${reqId}" (must match ${SLUG_RE})`);
  }
  if (!SLUG_RE.test(slug)) {
    throw new Error(`evidenceShot: invalid slug "${slug}" (must match ${SLUG_RE})`);
  }
  const out = path.join(
    process.cwd(),
    'compliance/evidence',
    reqId,
    'screenshots',
    `${slug}.png`,
  );
  await page.screenshot({ path: out, fullPage: opts.fullPage ?? true });
}
