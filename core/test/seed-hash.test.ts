import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { seedFilesHash } from '../src/index.js';

// DevAudit-Installer#1116 WP15: the seed files hash, checked against an independent implementation of the
// definition (the shell/TypeScript parity test lives in cli/test/doctor-testdata.test.ts).

const enc = new TextEncoder();
const sha = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

describe('seedFilesHash', () => {
  it('is the sha256 of one "<sha256 of file>  <path>" line per file, sorted bytewise by path', async () => {
    const files = [
      { path: 'seed/b.sql', content: enc.encode('second') },
      { path: 'seed/a.sql', content: enc.encode('first') },
      { path: 'seed/Z.sql', content: enc.encode('upper') },
    ];
    // bytewise: uppercase sorts before lowercase
    const lines = ['seed/Z.sql', 'seed/a.sql', 'seed/b.sql']
      .map((p) => `${sha(files.find((f) => f.path === p)!.content)}  ${p}\n`)
      .join('');
    expect(await seedFilesHash(files)).toBe(sha(lines));
  });

  it('is empty for no files, and the order given does not matter', async () => {
    expect(await seedFilesHash([])).toBe('');
    const a = { path: 'a', content: new Uint8Array([1]) };
    const b = { path: 'b', content: new Uint8Array([2]) };
    expect(await seedFilesHash([a, b])).toBe(await seedFilesHash([b, a]));
  });

  it('changes when a file changes or a path changes', async () => {
    const one = await seedFilesHash([{ path: 'a', content: enc.encode('x') }]);
    expect(await seedFilesHash([{ path: 'a', content: enc.encode('y') }])).not.toBe(one);
    expect(await seedFilesHash([{ path: 'b', content: enc.encode('x') }])).not.toBe(one);
  });
});
