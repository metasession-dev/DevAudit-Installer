import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { copyFile, copyDir, exists, ensureDir, isDir } from '../lib/fs-utils.js';
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
 */
export async function syncSdlcEngine(ctx: SyncContext): Promise<SectionResult> {
  const binSrc = join(ctx.installerRoot, 'sdlc', 'src', 'bin', 'devaudit-sdlc.cjs');
  const blueprintsSrc = join(ctx.installerRoot, 'sdlc', 'src', 'blueprints');

  if (!(await exists(binSrc))) {
    return { name: 'SDLC CLI engine', filesSynced: 0, skipped: true, message: 'devaudit-sdlc.cjs not found in installer' };
  }

  const binDst = join(ctx.projectPath, 'SDLC', 'bin');
  const blueprintsDst = join(ctx.projectPath, 'SDLC', 'blueprints');
  await ensureDir(binDst);

  let count = 0;
  await copyFile(binSrc, join(binDst, 'devaudit-sdlc.cjs'), 0o755);
  count += 1;

  // Every consumer synced before #929 has the broken .js copy sitting next
  // to (now) the .cjs one — remove it so a stale, crashing binary doesn't
  // linger, and report it so the removal isn't silent.
  const staleJsPath = join(binDst, 'devaudit-sdlc.js');
  let removedStale = false;
  if (await exists(staleJsPath)) {
    await fs.rm(staleJsPath);
    removedStale = true;
  }

  if (await isDir(blueprintsSrc)) {
    count += await copyDir(blueprintsSrc, blueprintsDst, true);
  }

  const message = removedStale
    ? 'synced to SDLC/bin/ + SDLC/blueprints/; removed stale SDLC/bin/devaudit-sdlc.js'
    : 'synced to SDLC/bin/ + SDLC/blueprints/';

  return { name: 'SDLC CLI engine', filesSynced: count, message };
}
