import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { exists, isDir, listFiles, fileBasename } from '../lib/fs-utils.js';
import { loadStackAdapter } from '../lib/adapter.js';
import { writeManaged } from './write-managed.js';
import type { SyncContext, SectionResult } from './types.js';

function isTestScript(name: string): boolean {
  return name.endsWith('.test.sh');
}

// The top-level scripts/upload-evidence.sh (this repo's own root, copied
// separately below) is the canonical source and always wins — a stale
// _common/scripts/ copy of the same filename exists too (historical
// duplication) and would otherwise be written to the same destination
// path twice in one sync, immediately before its own canonical overwrite.
// That's harmless for a plain overwrite, but breaks manifest classification
// (devaudit-installer#930): the second `writeManaged` call would see the
// *first* call's just-written bytes as if they were a foreign local edit
// and falsely report a conflict, every single sync.
function isSuperseded(name: string): boolean {
  return name === 'upload-evidence.sh';
}

/**
 * Section 2d: Scripts. Three sources merged into the consumer's scripts/:
 *   - _common/scripts/*.sh (excluding *.test.sh)
 *   - stacks/<stack>/scripts/* (per adapter's stack_scripts list)
 *   - the top-level scripts/upload-evidence.sh from this repo
 *
 * Skipped if the consumer has no scripts/ directory.
 */
export async function syncScripts(ctx: SyncContext): Promise<SectionResult> {
  // ci.yml.template (both stacks) calls scripts/upload-evidence.sh,
  // scripts/derive-release-version.sh, etc. from the register-release /
  // upload-evidence jobs, which run at the actual git checkout root (no
  // per-target `defaults: working-directory`) — so this must land at the
  // repo root too, not a target's own subdirectory. #689 follow-up.
  const scriptsDst = join(ctx.repoRoot, 'scripts');
  if (!(await isDir(scriptsDst))) {
    return { name: 'scripts', filesSynced: 0, skipped: true, message: 'scripts/ not found' };
  }
  let count = 0;
  const filePaths: string[] = [];
  const commonScriptsSrc = join(ctx.installerRoot, 'sdlc', 'files', '_common', 'scripts');
  if (await isDir(commonScriptsSrc)) {
    const candidates = await listFiles(commonScriptsSrc, (n) => n.endsWith('.sh') && !isTestScript(n) && !isSuperseded(n));
    for (const src of candidates) {
      const dst = join(scriptsDst, fileBasename(src));
      const content = await fs.readFile(src);
      const outcome = await writeManaged(ctx.managed!, dst, content, { section: '2d', mode: 0o755 });
      filePaths.push(dst);
      if (outcome !== 'conflict') count += 1;
    }
  }
  const adapter = await loadStackAdapter(ctx.installerRoot, ctx.stack);
  const stackScriptsSrc = join(ctx.installerRoot, 'sdlc', 'files', 'stacks', ctx.stack, 'scripts');
  if ((await isDir(stackScriptsSrc)) && adapter.stack_scripts) {
    for (const scriptName of adapter.stack_scripts) {
      const src = join(stackScriptsSrc, scriptName);
      if (await exists(src)) {
        const dst = join(scriptsDst, scriptName);
        const content = await fs.readFile(src);
        const outcome = await writeManaged(ctx.managed!, dst, content, { section: '2d', mode: 0o755 });
        filePaths.push(dst);
        if (outcome !== 'conflict') count += 1;
      }
    }
  }
  const uploadEvidence = join(ctx.installerRoot, 'scripts', 'upload-evidence.sh');
  if (await exists(uploadEvidence)) {
    const dst = join(scriptsDst, 'upload-evidence.sh');
    const content = await fs.readFile(uploadEvidence);
    const outcome = await writeManaged(ctx.managed!, dst, content, { section: '2d', mode: 0o755 });
    filePaths.push(dst);
    if (outcome !== 'conflict') count += 1;
  }
  return { name: 'scripts', filesSynced: count, message: 'synced to scripts/', filePaths };
}
