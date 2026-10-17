import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNC_COMMIT_MESSAGE } from '../src/commands/update.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// devaudit-installer#1020: a skip-CI tag in the sync commit makes GitHub run no
// workflows for it, so the sync PR's required `Quality Gates` check never
// reports and the PR is BLOCKED forever.
describe('suggested sync commit message (#1020)', () => {
  it('never contains a skip-CI tag', () => {
    expect(SYNC_COMMIT_MESSAGE).not.toMatch(/\[(skip ci|ci skip|skip actions|actions skip)\]/i);
    expect(SYNC_COMMIT_MESSAGE).toBe('chore: sync SDLC templates from DevAudit');
  });

  it('is what `devaudit update` prints, and update.ts has no literal skip-CI tag', async () => {
    const source = await fs.readFile(resolve(HERE, '..', 'src', 'commands', 'update.ts'), 'utf-8');
    expect(source).toContain('${SYNC_COMMIT_MESSAGE}');
    expect(source).not.toMatch(/\[skip ci\]/i);
  });
});
