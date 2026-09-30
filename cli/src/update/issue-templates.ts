import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, isDir, listFiles, fileBasename } from '../lib/fs-utils.js';
import { writeManaged } from './write-managed.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2e (issue templates subset): GitHub issue templates.
 */
export async function syncIssueTemplates(ctx: SyncContext): Promise<SectionResult> {
  const src = join(ctx.installerRoot, 'sdlc', 'files', '_common', 'github', 'ISSUE_TEMPLATE');
  if (!(await isDir(src))) {
    return { name: 'Issue templates', filesSynced: 0, skipped: true };
  }
  // GitHub only reads .github/ISSUE_TEMPLATE/ from the repo root. See #689 follow-up.
  const dst = join(ctx.repoRoot, '.github', 'ISSUE_TEMPLATE');
  if (!ctx.dryRun) await ensureDir(dst);
  const files = await listFiles(src, (n) => n.endsWith('.yml'));
  const filePaths: string[] = [];
  let count = 0;
  for (const file of files) {
    const out = join(dst, fileBasename(file));
    const content = await fs.readFile(file);
    const outcome = await writeManaged(ctx.managed!, out, content, { section: '2e' });
    filePaths.push(out);
    if (outcome !== 'conflict') count += 1;
  }
  return { name: 'Issue templates', filesSynced: count, message: 'synced to .github/ISSUE_TEMPLATE/', filePaths };
}
