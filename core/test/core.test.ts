import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_API_VERSION } from '../src/index.js';
import { CORE_NODE_ENTRY } from '../src/node/index.js';

const srcDir = resolve(import.meta.dirname, '../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('@metasession.co/devaudit-core', () => {
  it('exports its API version from the pure entry point', () => {
    expect(CORE_API_VERSION).toBe('1');
  });

  it('exports the Node entry point', () => {
    expect(CORE_NODE_ENTRY).toBe(true);
  });

  it('keeps src/ pure: only src/node/ may import node: modules', () => {
    const offenders = sourceFiles(srcDir)
      .filter((file) => !relative(srcDir, file).split(sep).includes('node'))
      .filter((file) => /from\s+['"]node:|require\(\s*['"]node:/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(srcDir, file));
    expect(offenders).toEqual([]);
  });
});
