import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { copyDir, isDir, ensureDir } from '../lib/fs-utils.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2e-ii: Claude Code skills.
 *
 * Skills live under sdlc/files/_common/skills/<name>/ (universal) and
 * sdlc/files/stacks/<stack>/skills/<name>/ (stack-specific). Each is a
 * directory with SKILL.md + optional references/ assets/ scripts/.
 * They sync to the consumer's .claude/skills/<name>/.
 *
 * Behaviour: replace each skill destination dir wholesale (matches bash
 * rsync --delete) so stale skill artifacts don't accumulate.
 */
export async function syncSkills(ctx: SyncContext): Promise<SectionResult> {
  const skillDst = join(ctx.projectPath, '.claude', 'skills');
  const commonSkills = join(ctx.installerRoot, 'sdlc', 'files', '_common', 'skills');
  const stackSkills = join(ctx.installerRoot, 'sdlc', 'files', 'stacks', ctx.stack, 'skills');
  await ensureDir(skillDst);
  let count = 0;
  for (const src of [commonSkills, stackSkills]) {
    if (!(await isDir(src))) continue;
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_')) continue;
      const skillSrc = join(src, entry.name);
      const skillDstDir = join(skillDst, entry.name);
      await copyDir(skillSrc, skillDstDir, true);
      count += 1;
    }
  }
  if (count === 0) {
    return { name: 'Claude Code skills', filesSynced: 0, skipped: true };
  }
  return { name: 'Claude Code skills', filesSynced: count, message: `${count} synced to .claude/skills/` };
}
