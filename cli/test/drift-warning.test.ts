import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';
import { captureBeforeOverwrite, evaluateDrift, formatDriftWarning } from '../src/update/drift-warning.js';

describe('drift-warning', () => {
  it('captureBeforeOverwrite returns undefined for a file that does not exist yet', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'drift-capture-'));
    try {
      const result = await captureBeforeOverwrite(join(dir, 'nope.yml'));
      expect(result).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('captureBeforeOverwrite reads the existing content when the file is present', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'drift-capture-'));
    try {
      const p = join(dir, 'ci.yml');
      await fs.writeFile(p, 'original content\n');
      const result = await captureBeforeOverwrite(p);
      expect(result).toBe('original content\n');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // DevAudit-Installer#766 — the whole point of splitting capture from
  // evaluation: a formatter (prettier or otherwise) can run *between* the
  // two calls and normalize the just-written content back to what was
  // captured before the overwrite. evaluateDrift must compare against
  // whatever is on disk *at evaluation time*, not what was written at
  // capture time, or every formatting-only difference reads as drift.
  it('reports no drift when a formatter runs between capture and evaluation and restores the captured content (#766)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'drift-eval-'));
    try {
      const p = join(dir, '.github', 'workflows', 'ci.yml');
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      const formatted = "steps:\n  - uses: actions/checkout@v6\n";
      await fs.writeFile(p, formatted);

      // Capture happens before the sync overwrites the file.
      const oldContent = await captureBeforeOverwrite(p);
      expect(oldContent).toBe(formatted);

      // The sync writes new, not-yet-formatted content (different quote
      // style — exactly the class of difference prettier normalizes away).
      const unformatted = 'steps:\n  - uses: "actions/checkout@v6"\n';
      await fs.writeFile(p, unformatted);

      // A formatter pass (simulated here — this test doesn't depend on a
      // real prettier install) runs afterward and normalizes the file
      // back to the same shape as the pre-sync content.
      await fs.writeFile(p, formatted);

      // Evaluating drift *after* the formatter ran must see no real
      // difference — this is the #766 fix.
      const drifted = await evaluateDrift(dir, p, oldContent!);
      expect(drifted).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('still reports real drift when the formatted content genuinely differs and no patch covers it (#766)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'drift-eval-real-'));
    try {
      const p = join(dir, '.github', 'workflows', 'ci.yml');
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await fs.writeFile(p, 'steps:\n  - uses: actions/checkout@v6\n');
      const oldContent = await captureBeforeOverwrite(p);

      // A genuine content change (not just formatting) survives to
      // post-format evaluation.
      await fs.writeFile(p, 'steps:\n  - uses: actions/checkout@v6\n  - run: echo hand-added\n');

      const drifted = await evaluateDrift(dir, p, oldContent!);
      expect(drifted).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not report drift when a covering .devaudit-patches/*.patch exists, even post-format', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'drift-eval-patched-'));
    try {
      await execa('git', ['init', '-q'], { cwd: dir });
      const p = join(dir, '.github', 'workflows', 'ci.yml');
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await fs.writeFile(p, 'steps:\n  - uses: actions/checkout@v6\n');
      const oldContent = await captureBeforeOverwrite(p);

      await fs.writeFile(p, 'steps:\n  - uses: actions/checkout@v6\n  - run: echo hand-added\n');
      await fs.mkdir(join(dir, '.devaudit-patches'), { recursive: true });
      await fs.writeFile(
        join(dir, '.devaudit-patches', 'ci.yml.patch'),
        '--- a/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n',
      );

      const drifted = await evaluateDrift(dir, p, oldContent!);
      expect(drifted).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('formatDriftWarning renders a summary message naming every drifted file', () => {
    const msg = formatDriftWarning(['.github/workflows/ci.yml', 'scripts/foo.sh']);
    expect(msg).toContain('.github/workflows/ci.yml');
    expect(msg).toContain('scripts/foo.sh');
    expect(msg).toContain('.devaudit-patches');
  });
});
