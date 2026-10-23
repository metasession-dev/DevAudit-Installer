import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { exists, isDir, listFiles, fileBasename } from '../lib/fs-utils.js';
import { loadStackAdapter } from '../lib/adapter.js';
import { writeManaged, removeManaged } from './write-managed.js';
import { toManifestKey } from './sync-manifest.js';
import type { SyncContext, SectionResult } from './types.js';

function isTestScript(name: string): boolean {
  return name.endsWith('.test.sh');
}

/**
 * Section 2d: Scripts. Two sources merged into the consumer's scripts/:
 *   - _common/scripts/*.sh (excluding *.test.sh), upload-evidence.sh included
 *   - stacks/<stack>/scripts/* (per adapter's stack_scripts list)
 *
 * devaudit-installer#1082 — upload-evidence.sh used to come from a second,
 * repo-root copy that "superseded" the _common one. Every fix since #775 went
 * into _common only, so consumers silently kept the stale copy. There is now
 * one copy, in _common/scripts/, tested where it lives.
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
    const candidates = await listFiles(commonScriptsSrc, (n) => n.endsWith('.sh') && !isTestScript(n));
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
  const removed = await removeStaleScripts(ctx, scriptsDst, new Set(filePaths));
  const message = removed > 0 ? `synced to scripts/; removed ${removed} stale script(s)` : 'synced to scripts/';
  return { name: 'scripts', filesSynced: count, message, filePaths };
}

/**
 * Remove a script a previous sync wrote that upstream no longer ships (e.g.
 * `reconcile-railway-deployment.sh`, replaced by `reconcile-deployment.sh` in
 * #1022). scripts/ is shared with the consumer's own scripts, so only a file
 * the manifest records under this section ('2d') is a candidate: entries
 * reconstructed by the first-sync bootstrap ('bootstrap') cover the whole
 * directory, consumer-owned files included, and are never swept. Removal is
 * `removeManaged`'s: deleted if unmodified, kept and reported if edited.
 */
async function removeStaleScripts(ctx: SyncContext, scriptsDst: string, keep: ReadonlySet<string>): Promise<number> {
  const state = ctx.managed!;
  let removed = 0;
  for (const entry of await fs.readdir(scriptsDst, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(scriptsDst, entry.name);
    if (keep.has(abs)) continue;
    if (state.known.get(toManifestKey(state.repoRoot, abs))?.section !== '2d') continue;
    if ((await removeManaged(state, abs, { section: '2d' })) === 'removed') removed += 1;
  }
  return removed;
}
