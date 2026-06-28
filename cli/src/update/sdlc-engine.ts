import { join } from 'node:path';
import { copyFile, copyDir, exists, ensureDir, isDir } from '../lib/fs-utils.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2h: SDLC CLI engine (devaudit-sdlc binary + blueprints).
 *
 * Copies the standalone CLI binary and its blueprint files from
 * sdlc/src/bin/ and sdlc/src/blueprints/ into the consumer's
 * SDLC/bin/ and SDLC/blueprints/ so `node SDLC/bin/devaudit-sdlc.js --phase=X`
 * works without an npm install. This is the local-resilience fallback
 * for when `npx @metasession.co/devaudit-sdlc` can't reach the registry.
 */
export async function syncSdlcEngine(ctx: SyncContext): Promise<SectionResult> {
  const binSrc = join(ctx.installerRoot, 'sdlc', 'src', 'bin', 'devaudit-sdlc.js');
  const blueprintsSrc = join(ctx.installerRoot, 'sdlc', 'src', 'blueprints');

  if (!(await exists(binSrc))) {
    return { name: 'SDLC CLI engine', filesSynced: 0, skipped: true, message: 'devaudit-sdlc.js not found in installer' };
  }

  const binDst = join(ctx.projectPath, 'SDLC', 'bin');
  const blueprintsDst = join(ctx.projectPath, 'SDLC', 'blueprints');
  await ensureDir(binDst);

  let count = 0;
  await copyFile(binSrc, join(binDst, 'devaudit-sdlc.js'), 0o755);
  count += 1;

  if (await isDir(blueprintsSrc)) {
    count += await copyDir(blueprintsSrc, blueprintsDst, true);
  }

  return { name: 'SDLC CLI engine', filesSynced: count, message: 'synced to SDLC/bin/ + SDLC/blueprints/' };
}
