import { join } from 'node:path';
import { copyFile, exists, isDir, listFiles, fileBasename } from '../lib/fs-utils.js';
import { loadStackAdapter } from '../lib/adapter.js';
import type { SyncContext, SectionResult } from './types.js';

function isTestScript(name: string): boolean {
  return name.endsWith('.test.sh');
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
  const scriptsDst = join(ctx.projectPath, 'scripts');
  if (!(await isDir(scriptsDst))) {
    return { name: 'scripts', filesSynced: 0, skipped: true, message: 'scripts/ not found' };
  }
  let count = 0;
  const commonScriptsSrc = join(ctx.installerRoot, 'sdlc', 'files', '_common', 'scripts');
  if (await isDir(commonScriptsSrc)) {
    const candidates = await listFiles(commonScriptsSrc, (n) => n.endsWith('.sh') && !isTestScript(n));
    for (const src of candidates) {
      await copyFile(src, join(scriptsDst, fileBasename(src)), 0o755);
      count += 1;
    }
  }
  const adapter = await loadStackAdapter(ctx.installerRoot, ctx.stack);
  const stackScriptsSrc = join(ctx.installerRoot, 'sdlc', 'files', 'stacks', ctx.stack, 'scripts');
  if ((await isDir(stackScriptsSrc)) && adapter.stack_scripts) {
    for (const scriptName of adapter.stack_scripts) {
      const src = join(stackScriptsSrc, scriptName);
      if (await exists(src)) {
        await copyFile(src, join(scriptsDst, scriptName), 0o755);
        count += 1;
      }
    }
  }
  const uploadEvidence = join(ctx.installerRoot, 'scripts', 'upload-evidence.sh');
  if (await exists(uploadEvidence)) {
    await copyFile(uploadEvidence, join(scriptsDst, 'upload-evidence.sh'), 0o755);
    count += 1;
  }
  return { name: 'scripts', filesSynced: count, message: 'synced to scripts/' };
}
