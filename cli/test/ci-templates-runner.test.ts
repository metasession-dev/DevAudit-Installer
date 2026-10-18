import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// devaudit-installer#1044 — housekeeping workflows hardcoded `runs-on: ubuntu-latest`, so they
// ignored the configured runner and never started when GitHub-hosted minutes were unavailable.

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sdlc', 'files', 'ci');

describe('CI templates use the configured runner', () => {
  it('no template hardcodes a GitHub-hosted runner in runs-on', async () => {
    const offenders: string[] = [];
    for (const name of (await fs.readdir(CI_DIR)).filter((f) => f.endsWith('.template'))) {
      const lines = (await fs.readFile(join(CI_DIR, name), 'utf-8')).split('\n');
      lines.forEach((line, i) => {
        if (/^\s*runs-on:\s*(ubuntu|windows|macos)/.test(line)) offenders.push(`${name}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
