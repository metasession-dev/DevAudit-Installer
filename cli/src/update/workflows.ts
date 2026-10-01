import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { ensureDir, isDir, listFiles, fileBasename } from '../lib/fs-utils.js';
import { writeManaged } from './write-managed.js';
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
  // Devin reads .devin/workflows/ from the repo root. See #689 follow-up.
  const dst = join(ctx.repoRoot, '.devin', 'workflows');
  if (!ctx.dryRun) await ensureDir(dst);
  const files = await listFiles(src, (n) => n.endsWith('.md'));
  const filePaths: string[] = [];
  let count = 0;
  for (const file of files) {
    const out = join(dst, fileBasename(file));
    const content = await fs.readFile(file);
    const outcome = await writeManaged(ctx.managed!, out, content, { section: '2i' });
    filePaths.push(out);
    if (outcome !== 'conflict') count += 1;
  }
  return {
    name: 'Workflows',
    filesSynced: count,
    message: files.length > 0 ? `synced to .devin/workflows/` : 'no workflow files found',
    filePaths,
  };
}
