import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// devaudit-installer#1099: `install` and `join` save the person's viewer key to the CLI config
// folder. Point every test worker at its own throwaway file so no test reads or writes the real one.
// (Set before any module imports `src/lib/paths.ts`.)
if (!process.env['DEVAUDIT_VIEWER_KEYS_FILE']) {
  process.env['DEVAUDIT_VIEWER_KEYS_FILE'] = join(mkdtempSync(join(tmpdir(), 'devaudit-test-viewer-keys-')), 'viewer-keys.json');
}
