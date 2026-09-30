import { join, relative } from 'node:path';
import { promises as fs } from 'node:fs';
import { isDir, ensureDir } from '../lib/fs-utils.js';
import { syncDirManaged, removeStaleUnderManaged } from './write-managed.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2e-ii: Claude Code skills.
 *
 * Skills live under sdlc/files/_common/skills/<name>/ (universal) and
 * sdlc/files/stacks/<stack>/skills/<name>/ (stack-specific). Each is a
 * directory with SKILL.md + optional references/ assets/ scripts/.
 * They sync to the consumer's .claude/skills/<name>/.
 *
 * Manifest-driven (devaudit-installer#930): each upstream file is written
 * through `writeManaged` (a consumer's hand-edit inside a skill file is
 * detected and preserved as a conflict, not silently clobbered), and a
 * stale file upstream no longer ships is removed only if it's unmodified —
 * replacing the previous `copyDir(clean=true)` (`rm -rf` then recopy),
 * which deleted any consumer-added file inside a managed skill directory
 * on every single sync.
 */
export async function syncSkills(ctx: SyncContext): Promise<SectionResult> {
  const skillDst = join(ctx.projectPath, '.claude', 'skills');
  const commonSkills = join(ctx.installerRoot, 'sdlc', 'files', '_common', 'skills');
  const stackSkills = join(ctx.installerRoot, 'sdlc', 'files', 'stacks', ctx.stack, 'skills');
  if (!ctx.dryRun) await ensureDir(skillDst);
  let count = 0;
  const keepPaths = new Set<string>();
  const skillDirNames: string[] = [];
  for (const src of [commonSkills, stackSkills]) {
    if (!(await isDir(src))) continue;
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_')) continue;
      const skillSrc = join(src, entry.name);
      const skillDstDir = join(skillDst, entry.name);
      skillDirNames.push(entry.name);
      const result = await syncDirManaged(ctx.managed!, skillSrc, skillDstDir, '2e-ii');
      count += result.synced;
      for (const p of result.filePaths) keepPaths.add(p);
    }
  }
  if (count === 0 && skillDirNames.length === 0) {
    return { name: 'Claude Code skills', filesSynced: 0, skipped: true };
  }
  // Also keep every file already present under a skill dir this sync
  // didn't touch (a skill upstream stopped shipping is left alone by this
  // sweep — it only removes stale files WITHIN skill dirs still being
  // synced this run, matching pre-#930 scope: whole-skill removal was
  // never this section's job).
  let removedStale = 0;
  for (const name of skillDirNames) {
    const dir = join(skillDst, name);
    const upstreamKeep = new Set(await listAllUnder(dir, keepPaths));
    const sweep = await removeStaleUnderManaged(ctx.managed!, dir, upstreamKeep, '2e-ii');
    removedStale += sweep.removed;
  }
  const message =
    removedStale > 0 ? `${count} synced to .claude/skills/; removed ${removedStale} stale file(s)` : `${count} synced to .claude/skills/`;
  return { name: 'Claude Code skills', filesSynced: count, message };
}

function listAllUnder(dir: string, keepPaths: ReadonlySet<string>): readonly string[] {
  return [...keepPaths].filter((p) => {
    const rel = relative(dir, p);
    return rel === '' || (!rel.startsWith('..') && rel !== p);
  });
}
