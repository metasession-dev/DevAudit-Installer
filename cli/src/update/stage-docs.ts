import { join } from 'node:path';
import { copyFile, ensureDir, listFiles, fileBasename } from '../lib/fs-utils.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2a: Sync _common/*.md stage docs into the consumer's SDLC/.
 */
export async function syncStageDocs(ctx: SyncContext): Promise<SectionResult> {
  const sdlcTarget = join(ctx.projectPath, 'SDLC');
  await ensureDir(sdlcTarget);
  const commonDir = join(ctx.installerRoot, 'sdlc', 'files', '_common');
  const mdFiles = await listFiles(commonDir, (n) => n.endsWith('.md'));
  const filePaths: string[] = [];
  for (const src of mdFiles) {
    const dst = join(sdlcTarget, fileBasename(src));
    await copyFile(src, dst);
    filePaths.push(dst);
  }
  return {
    name: '_common docs',
    filesSynced: mdFiles.length,
    message: 'synced to SDLC/',
    filePaths,
  };
}
