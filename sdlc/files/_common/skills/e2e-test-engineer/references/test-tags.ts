/**
 * Per-REQ / per-AC test annotation helper (devaudit-installer#196).
 *
 * The DevAudit portal's Playwright parser (`playwright-parser.ts`) looks
 * for REQ-XXX / AC<n> tokens in three places, in priority order:
 *
 * 1. `test.info().annotations` — `{ type: 'req', description: 'REQ-083 AC1' }`
 * 2. Bracket tags in test title / suite path — `[REQ-083][AC2] …`
 * 3. Bare regex match — `REQ-XXX` anywhere in title + suite
 *
 * Without annotations the per-REQ approval card shows "no tests in report
 * tagged with this REQ" even though the test ran and passed. This helper
 * makes source 1 trivial — one call at the top of the test body.
 *
 * @example
 *   import { tagTest } from './helpers/test-tags';
 *
 *   test('verification code submit', async ({ page }) => {
 *     tagTest('REQ-083', 1);
 *     // ... test body
 *   });
 *
 * For tests covering multiple ACs, pass an array:
 *
 *   tagTest('REQ-083', [1, 2]);
 *
 * For transport-layer specs (no page object) the helper works identically
 * — it only touches `test.info()`, no Playwright `page` required.
 */
import { test } from '@playwright/test';

const REQ_ID_RE = /^REQ-[A-Z0-9-]+$/;

/**
 * Tag the current test with its REQ ID and AC number(s) so the portal
 * can join test results with screenshots by acceptance criteria.
 *
 * Must be called inside a `test(...)` body (uses `test.info()`).
 *
 * @param reqId  `REQ-` prefixed requirement id (e.g. `REQ-083`)
 * @param ac     AC number (positive integer) or array of AC numbers
 */
export function tagTest(reqId: string, ac: number | readonly number[]): void {
  if (!REQ_ID_RE.test(reqId)) {
    throw new Error(`tagTest: invalid reqId "${reqId}" (must match ${REQ_ID_RE})`);
  }
  const acs = Array.isArray(ac) ? ac : [ac];
  const info = test.info();
  for (const n of acs) {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`tagTest: invalid ac "${n}" (must be a positive integer)`);
    }
    info.annotations.push({ type: 'req', description: `${reqId} AC${n}` });
  }
}
