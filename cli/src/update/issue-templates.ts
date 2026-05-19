import { join } from 'node:path';
import { copyFile, ensureDir, isDir, listFiles, fileBasename } from '../lib/fs-utils.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2e (issue templates subset): GitHub issue templates.
 */
export async function syncIssueTemplates(ctx: SyncContext): Promise<SectionResult> {
  const src = join(ctx.installerRoot, 'sdlc', 'files', '_common', 'github', 'ISSUE_TEMPLATE');
  if (!(await isDir(src))) {
    return { name: 'Issue templates', filesSynced: 0, skipped: true };
  }
  const dst = join(ctx.projectPath, '.github', 'ISSUE_TEMPLATE');
  await ensureDir(dst);
  const files = await listFiles(src, (n) => n.endsWith('.yml'));
  for (const file of files) {
    await copyFile(file, join(dst, fileBasename(file)));
  }
  return { name: 'Issue templates', filesSynced: files.length, message: 'synced to .github/ISSUE_TEMPLATE/' };
}
