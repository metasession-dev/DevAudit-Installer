import { join } from 'node:path';
import { copyFile, ensureDir, isDir, listFiles, fileBasename } from '../lib/fs-utils.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2i: Windsurf/Windsurf workflow files.
 *
 * Workflows live under sdlc/files/_common/workflows/*.md. Each is a
 * slash-command workflow (YAML frontmatter + markdown steps) that
 * consumers invoke from their IDE (e.g. /devaudit-update-install).
 * They sync to the consumer's .devin/workflows/.
 */
export async function syncWorkflows(ctx: SyncContext): Promise<SectionResult> {
  const src = join(ctx.installerRoot, 'sdlc', 'files', '_common', 'workflows');
  if (!(await isDir(src))) {
    return { name: 'Workflows', filesSynced: 0, skipped: true };
  }
  const dst = join(ctx.projectPath, '.devin', 'workflows');
  await ensureDir(dst);
  const files = await listFiles(src, (n) => n.endsWith('.md'));
  for (const file of files) {
    await copyFile(file, join(dst, fileBasename(file)));
  }
  return {
    name: 'Workflows',
    filesSynced: files.length,
    message: files.length > 0 ? `synced to .devin/workflows/` : 'no workflow files found',
  };
}
