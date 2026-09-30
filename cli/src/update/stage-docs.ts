import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, listFiles, fileBasename } from '../lib/fs-utils.js';
import { writeManaged } from './write-managed.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2a: Sync _common/*.md stage docs into the consumer's SDLC/.
 */
export async function syncStageDocs(ctx: SyncContext): Promise<SectionResult> {
  const sdlcTarget = join(ctx.projectPath, 'SDLC');
  if (!ctx.dryRun) await ensureDir(sdlcTarget);
  const commonDir = join(ctx.installerRoot, 'sdlc', 'files', '_common');
  const mdFiles = await listFiles(commonDir, (n) => n.endsWith('.md'));
  const filePaths: string[] = [];
  let count = 0;
  for (const src of mdFiles) {
    const dst = join(sdlcTarget, fileBasename(src));
    const content = await fs.readFile(src);
    const outcome = await writeManaged(ctx.managed!, dst, content, { section: '2a' });
    filePaths.push(dst);
    if (outcome !== 'conflict') count += 1;
  }
  return {
    name: '_common docs',
    filesSynced: count,
    message: 'synced to SDLC/',
    filePaths,
  };
}
