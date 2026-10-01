import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { exists, ensureDir, isDir } from '../lib/fs-utils.js';
import { writeManaged, syncDirManaged, removeManaged, removeStaleUnderManaged } from './write-managed.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2h: SDLC CLI engine (devaudit-sdlc binary + blueprints).
 *
 * Copies the standalone CLI binary and its blueprint files from
 * sdlc/src/bin/ and sdlc/src/blueprints/ into the consumer's
 * SDLC/bin/ and SDLC/blueprints/ so `node SDLC/bin/devaudit-sdlc.cjs --phase=X`
 * works without an npm install. This is the local-resilience fallback
 * for when `npx @metasession.co/devaudit-sdlc` can't reach the registry.
 *
 * The binary is a `.cjs` file, not `.js` (devaudit-installer#929): it's
 * genuine CommonJS (`require(...)`), but was previously synced as `.js`
 * with no isolating `package.json` in the consumer's `SDLC/bin/` — Node
 * resolves a plain `.js` file's module system from the *consumer's own*
 * nearest `package.json`, so any consumer with `"type": "module"` had this
 * file silently misinterpreted as ESM and crashing on every invocation
 * with `require is not defined`. `.cjs` forces CommonJS regardless of any
 * `package.json`'s `"type"` field.
 *
 * Manifest-driven (devaudit-installer#930): the binary and every blueprint
 * file route through `writeManaged`/`syncDirManaged`, and the stale-`.js`
 * removal (previously a one-off unconditional `fs.rm`) now goes through
 * `removeManaged` — deleted only if unmodified, kept and reported as a
 * conflict otherwise, and (since the bootstrap baseline reconstruction
 * runs the consumer's previously-recorded CLI version) this generalizes
 * cleanly to any consumer synced before #930, not just the specific #929
 * migration.
 */
export async function syncSdlcEngine(ctx: SyncContext): Promise<SectionResult> {
  const binSrc = join(ctx.installerRoot, 'sdlc', 'src', 'bin', 'devaudit-sdlc.cjs');
  const blueprintsSrc = join(ctx.installerRoot, 'sdlc', 'src', 'blueprints');

  if (!(await exists(binSrc))) {
    return { name: 'SDLC CLI engine', filesSynced: 0, skipped: true, message: 'devaudit-sdlc.cjs not found in installer' };
  }

  const binDst = join(ctx.projectPath, 'SDLC', 'bin');
  const blueprintsDst = join(ctx.projectPath, 'SDLC', 'blueprints');
  if (!ctx.dryRun) await ensureDir(binDst);

  let count = 0;
  const filePaths: string[] = [];
  const binDstPath = join(binDst, 'devaudit-sdlc.cjs');
  const binContent = await fs.readFile(binSrc);
  const binOutcome = await writeManaged(ctx.managed!, binDstPath, binContent, {
    section: '2h',
    mode: 0o755,
  });
  if (binOutcome !== 'conflict') {
    count += 1;
    filePaths.push(binDstPath);
  }

  // Every consumer synced before #929 has the broken .js copy sitting next
  // to (now) the .cjs one — remove it if unmodified so a stale, crashing
  // binary doesn't linger; keep + report it if the consumer somehow edited it.
  const staleJsPath = join(binDst, 'devaudit-sdlc.js');
  let removedStale = false;
  let keptStaleConflict = false;
  if (await exists(staleJsPath)) {
    const outcome = await removeManaged(ctx.managed!, staleJsPath, { section: '2h' });
    if (outcome === 'removed') removedStale = true;
    else if (outcome === 'kept-conflict') keptStaleConflict = true;
    else {
      // Untracked (no manifest/baseline entry) — devaudit can't prove this
      // is its own stale output, so leave it alone entirely rather than
      // guess. Surfaces as an ordinary leftover file, not a conflict.
    }
  }

  let removedStaleBlueprints = 0;
  if (await isDir(blueprintsSrc)) {
    const result = await syncDirManaged(ctx.managed!, blueprintsSrc, blueprintsDst, '2h');
    count += result.synced;
    filePaths.push(...result.filePaths);
    const keep = new Set(result.filePaths);
    const sweep = await removeStaleUnderManaged(ctx.managed!, blueprintsDst, keep, '2h');
    removedStaleBlueprints = sweep.removed;
  }

  const staleNote = removedStale
    ? '; removed stale SDLC/bin/devaudit-sdlc.js'
    : keptStaleConflict
      ? '; SDLC/bin/devaudit-sdlc.js is stale but locally modified — kept, reported as a conflict'
      : '';
  const blueprintNote = removedStaleBlueprints > 0 ? `; removed ${removedStaleBlueprints} stale blueprint file(s)` : '';
  const message = `synced to SDLC/bin/ + SDLC/blueprints/${staleNote}${blueprintNote}`;

  // devaudit-installer#930 follow-up: without filePaths, section 2l's
  // formatter normalization never sees the blueprint *.raw.md files,
  // permanently out of step with the baseline reconstruction's own
  // (correct) recursive listing — every blueprint file read as a
  // false-positive sync conflict on the very next sync.
  return { name: 'SDLC CLI engine', filesSynced: count, message, filePaths };
}
