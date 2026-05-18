import { join } from 'node:path';
import { copyFile, exists } from '../lib/fs-utils.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2e-iii: E2E evidence helper (node stack only).
 *
 * The e2e-test-engineer skill prescribes an evidenceShot() helper for
 * per-AC screenshot evidence. Emit the canonical helper from the skill's
 * references/ into the consumer's e2e/helpers/ so tests can import it
 * as `./helpers/evidence`. Python-stack projects don't use Playwright.
 */
export async function syncEvidenceHelper(ctx: SyncContext): Promise<SectionResult> {
  if (ctx.stack !== 'node') {
    return { name: 'E2E evidence helper', filesSynced: 0, skipped: true };
  }
  const src = join(
    ctx.installerRoot,
    'sdlc',
    'files',
    '_common',
    'skills',
    'e2e-test-engineer',
    'references',
    'evidence.ts',
  );
  if (!(await exists(src))) {
    return { name: 'E2E evidence helper', filesSynced: 0, skipped: true, message: 'source not found' };
  }
  const dst = join(ctx.projectPath, 'e2e', 'helpers', 'evidence.ts');
  await copyFile(src, dst);
  return { name: 'E2E evidence helper', filesSynced: 1, message: 'synced to e2e/helpers/evidence.ts' };
}
