import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { exists } from '../lib/fs-utils.js';
import { writeManaged } from './write-managed.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2e-iii: E2E evidence helper (node stack only).
 *
 * The e2e-test-engineer skill prescribes an evidenceShot() helper for
 * per-AC screenshot evidence. Emit the canonical helper from the skill's
 * references/ into the consumer's e2e/helpers/ so tests can import it
 * as `./helpers/evidence`. Python-stack projects don't use Playwright.
 *
 * v0.1.35: also syncs `evidence-shot-core.ts` — the helper imports the
 * pure validation + filename composition + origin auto-detect from
 * that sibling file. Pre-0.1.35 sync omitted it and broke tsc on the
 * consumer side.
 */
const HELPER_FILES = ['evidence.ts', 'evidence-shot-core.ts', 'test-tags.ts'] as const;

export async function syncEvidenceHelper(ctx: SyncContext): Promise<SectionResult> {
  if (ctx.stack !== 'node') {
    return { name: 'E2E evidence helper', filesSynced: 0, skipped: true };
  }
  const srcDir = join(
    ctx.installerRoot,
    'sdlc',
    'files',
    '_common',
    'skills',
    'e2e-test-engineer',
    'references',
  );
  let copied = 0;
  const missing: string[] = [];
  const filePaths: string[] = [];
  for (const fname of HELPER_FILES) {
    const src = join(srcDir, fname);
    if (!(await exists(src))) {
      missing.push(fname);
      continue;
    }
    const dst = join(ctx.projectPath, 'e2e', 'helpers', fname);
    const content = await fs.readFile(src);
    const outcome = await writeManaged(ctx.managed!, dst, content, { section: '2e-iii' });
    filePaths.push(dst);
    if (outcome !== 'conflict') copied += 1;
  }
  if (copied === 0 && missing.length === HELPER_FILES.length) {
    return { name: 'E2E evidence helper', filesSynced: 0, skipped: true, message: 'no sources found' };
  }
  const message =
    missing.length > 0
      ? `synced ${copied} to e2e/helpers/ (missing: ${missing.join(', ')})`
      : `synced to e2e/helpers/ (${HELPER_FILES.join(' + ')})`;
  return { name: 'E2E evidence helper', filesSynced: copied, message, filePaths };
}
