import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { exists } from '../lib/fs-utils.js';
import type { SyncContext, SectionResult } from './types.js';

const SENTINEL_ENTRIES = [
  '.e2e-gate-passed',
  '.e2e-evidence-wired',
  '.sdlc-implementer-invoked',
  '.sdlc-pr-watch.json',
  // devaudit-installer#930 — local conflict-resolution artifacts the sync
  // manifest's conflict policy writes next to a locally-modified managed
  // file (e.g. ci.yml.devaudit-new); never meant to be committed.
  '*.devaudit-new',
  // devaudit-installer#945 — `devaudit install --with-viewer-key` tells the
  // operator to persist the one-time-printed DEVAUDIT_VIEWER_API_KEY value
  // into .env; guarantee that instruction can never land in a commit, even
  // on a project with no pre-existing .env gitignore rule of its own.
  '.env',
  '.env.local',
];

const MARKER = '# DevAudit sentinel files (devaudit-installer#226)';

export async function syncGitignore(ctx: SyncContext): Promise<SectionResult> {
  if (ctx.dryRun) {
    return { name: 'gitignore', filesSynced: 0, skipped: true, message: 'skipped in --dry-run' };
  }
  const gitignorePath = join(ctx.projectPath, '.gitignore');
  let content = '';
  let count = 0;

  if (await exists(gitignorePath)) {
    content = await fs.readFile(gitignorePath, 'utf8');
  }

  const lines = content.split('\n');
  const existing = new Set(lines.map((l) => l.trim()));
  const toAdd: string[] = [];

  let hasMarker = lines.some((l) => l.trim() === MARKER);

  for (const entry of SENTINEL_ENTRIES) {
    if (!existing.has(entry)) {
      toAdd.push(entry);
    }
  }

  if (toAdd.length > 0) {
    if (!hasMarker) {
      toAdd.unshift('', MARKER);
      hasMarker = true;
    }
    lines.push(...toAdd);
    content = lines.join('\n');
    await fs.writeFile(gitignorePath, content, 'utf8');
    count = toAdd.filter((l) => !l.startsWith('#') && l.trim() !== '').length;
  }

  return {
    name: 'gitignore',
    filesSynced: count,
    message: count > 0 ? 'added sentinel entries' : 'sentinel entries already present',
  };
}
