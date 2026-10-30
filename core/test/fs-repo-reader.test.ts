import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RepoPathError, detectFacts } from '../src/index.js';
import { fsRepoReader } from '../src/node/index.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function tmp(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'core-fsreader-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(join(dir, rel, '..'), { recursive: true });
    await fs.writeFile(join(dir, rel), content);
  }
  return dir;
}

describe('fsRepoReader', () => {
  it('lists sorted entries as repository paths, with a trailing slash on directories', async () => {
    const root = await tmp({ 'b.txt': '1', 'a.txt': '2', 'sub/c.txt': '3', 'sub/deep/d.txt': '4' });
    const reader = fsRepoReader(root);
    expect(await reader.list('')).toEqual(['a.txt', 'b.txt', 'sub/']);
    expect(await reader.list('.')).toEqual(['a.txt', 'b.txt', 'sub/']);
    expect(await reader.list('sub')).toEqual(['sub/c.txt', 'sub/deep/']);
    expect(await reader.list('sub/')).toEqual(['sub/c.txt', 'sub/deep/']);
    expect(await reader.list('nope')).toEqual([]);
    expect(await reader.list('a.txt')).toEqual([]); // a file is not a directory
  });

  it('reads a file, cuts it at maxBytes, and returns null for a directory or a missing file', async () => {
    const root = await tmp({ 'f.txt': 'hello world', 'sub/g.txt': 'x' });
    const reader = fsRepoReader(root);
    expect(await reader.read('f.txt', 1000)).toBe('hello world');
    expect(await reader.read('f.txt', 5)).toBe('hello');
    expect(await reader.read('f.txt', 0)).toBe('');
    expect(await reader.read('sub', 100)).toBeNull();
    expect(await reader.read('nope.txt', 100)).toBeNull();
    expect(await reader.read('', 100)).toBeNull();
    expect(await reader.read('sub/g.txt', 100)).toBe('x');
  });

  it('refuses a path that climbs out of the root, an absolute path and a NUL byte', async () => {
    const root = await tmp({ 'f.txt': 'x' });
    const reader = fsRepoReader(root);
    for (const bad of ['..', '../etc/passwd', 'sub/../../x', root, '/etc/passwd', 'a\0b']) {
      await expect(reader.read(bad, 10), `read ${bad}`).rejects.toBeInstanceOf(RepoPathError);
      await expect(reader.list(bad), `list ${bad}`).rejects.toBeInstanceOf(RepoPathError);
    }
  });

  it.skipIf(process.platform === 'win32')('does not follow a symlink that points outside the root', async () => {
    const outside = await tmp({ 'secret.txt': 'top secret', 'dir/inner.txt': 'inner' });
    const root = await tmp({ 'ok.txt': 'fine' });
    await fs.symlink(join(outside, 'secret.txt'), join(root, 'link.txt'));
    await fs.symlink(join(outside, 'dir'), join(root, 'linkdir'));
    const reader = fsRepoReader(root);
    expect(await reader.read('link.txt', 100)).toBeNull();
    expect(await reader.list('linkdir')).toEqual([]);
    expect(await reader.list('')).toEqual(['ok.txt']); // the escaping links are not listed
    expect(await reader.read('linkdir/inner.txt', 100)).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('follows a symlink that stays inside the root', async () => {
    const root = await tmp({ 'real/a.txt': 'inside' });
    await fs.symlink(join(root, 'real'), join(root, 'alias'));
    const reader = fsRepoReader(root);
    expect(await reader.list('')).toEqual(['alias/', 'real/']);
    expect(await reader.read('alias/a.txt', 100)).toBe('inside');
  });

  it('works with detectFacts on a real directory', async () => {
    const root = await tmp({
      'package.json': '{"scripts":{"db:seed":"x"}}',
      'playwright.config.ts': "projects: [{ name: 'smoke' }]",
      'railway.toml': '',
    });
    const facts = await detectFacts(fsRepoReader(root));
    expect(facts.stack).toBe('node');
    expect(facts.host).toBe('railway');
    expect(facts.testRunner).toBe('playwright');
    expect(facts.testGroups.smoke).toBe(true);
    expect(facts.testData.seedScripts).toEqual(['npm run db:seed']);
  });
});
