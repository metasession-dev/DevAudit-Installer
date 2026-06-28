import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { exists } from '../lib/fs-utils.js';
import type { SyncContext, SectionResult } from './types.js';

const SENTINEL_ENTRIES = [
  '.e2e-gate-passed',
  '.e2e-evidence-wired',
  '.sdlc-implementer-invoked',
];

const MARKER = '# DevAudit sentinel files (devaudit-installer#226)';

export async function syncGitignore(ctx: SyncContext): Promise<SectionResult> {
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
