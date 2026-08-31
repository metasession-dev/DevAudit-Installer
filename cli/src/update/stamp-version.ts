import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { readSdlcConfig } from '../lib/sdlc-config.js';
import { CLI_VERSION } from '../lib/version.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Record which CLI version last synced this project's templates, so
 * `sdlc-implementer` (or any other consumer) can tell whether a project is
 * current without re-diffing every synced file — see
 * devaudit-installer#736's freshness-check follow-on. Written last in the
 * sync pipeline so it only reflects a sync that actually completed.
 */
export async function stampVersion(ctx: SyncContext): Promise<SectionResult> {
  const configPath = join(ctx.repoRoot, 'sdlc-config.json');
  const existing = await readSdlcConfig(ctx.repoRoot);
  if (!existing) {
    return {
      name: 'version stamp',
      filesSynced: 0,
      skipped: true,
      message: 'sdlc-config.json not found — nothing to stamp',
    };
  }
  if (existing.devaudit_synced_version === CLI_VERSION) {
    return {
      name: 'version stamp',
      filesSynced: 0,
      message: `already stamped ${CLI_VERSION}`,
    };
  }
  const updated = { ...existing, devaudit_synced_version: CLI_VERSION };
  await fs.writeFile(configPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  return {
    name: 'version stamp',
    filesSynced: 1,
    message: `stamped devaudit_synced_version: ${CLI_VERSION}`,
    filePaths: [configPath],
  };
}
