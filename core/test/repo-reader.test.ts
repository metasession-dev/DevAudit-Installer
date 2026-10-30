import { describe, expect, it } from 'vitest';
import {
  RepoPathError,
  baseName,
  isDirectory,
  isFile,
  joinRepoPath,
  listDirectoryNames,
  listFileNames,
  normalizeRepoPath,
  pathExists,
  readJson,
  readText,
} from '../src/repo-reader.js';
import { memoryReader } from './memory-reader.js';

describe('normalizeRepoPath', () => {
  it('canonicalises a relative path', () => {
    expect(normalizeRepoPath('')).toBe('');
    expect(normalizeRepoPath('.')).toBe('');
    expect(normalizeRepoPath('./a//b/./c/')).toBe('a/b/c');
    expect(normalizeRepoPath('a\\b\\c.txt')).toBe('a/b/c.txt');
    expect(normalizeRepoPath('.github/workflows')).toBe('.github/workflows');
    expect(normalizeRepoPath('..hidden/a..b')).toBe('..hidden/a..b');
  });

  it('refuses a path that climbs out of the repository', () => {
    for (const bad of ['..', '../x', 'a/../..', 'a/../../b', '../', 'a\\..\\..\\b', './a/../../x']) {
      expect(() => normalizeRepoPath(bad), bad).toThrow(RepoPathError);
    }
  });

  it('refuses even a `..` that stays inside (a reader must not be talked around)', () => {
    expect(() => normalizeRepoPath('a/../b')).toThrow(RepoPathError);
  });

  it('refuses an absolute path, a drive letter and a NUL byte', () => {
    for (const bad of ['/etc/passwd', '\\windows\\system32', 'C:\\x', 'c:/x', 'a\0b']) {
      expect(() => normalizeRepoPath(bad), bad).toThrow(RepoPathError);
    }
  });

  it('the error names the path and says why', () => {
    expect(() => normalizeRepoPath('../x')).toThrow(/relative and stay inside the repository/);
  });
});

describe('path helpers', () => {
  it('joinRepoPath skips empty parts and canonicalises', () => {
    expect(joinRepoPath('', 'package.json')).toBe('package.json');
    expect(joinRepoPath('apps/web', 'package.json')).toBe('apps/web/package.json');
    expect(joinRepoPath('apps/web/', './x')).toBe('apps/web/x');
    expect(() => joinRepoPath('a', '../b')).toThrow(RepoPathError);
  });

  it('baseName takes the last segment, with or without a trailing slash', () => {
    expect(baseName('a/b/c.txt')).toBe('c.txt');
    expect(baseName('a/b/')).toBe('b');
    expect(baseName('x')).toBe('x');
  });
});

describe('reading through a RepoReader', () => {
  const reader = memoryReader({
    'package.json': '{"name":"x","scripts":{"seed":"node s.js"}}',
    'bad.json': '{ nope',
    'src/a.ts': 'a',
    'src/lib/b.ts': 'b',
    'empty.txt': '',
  });

  it('tells files, directories and missing paths apart', async () => {
    expect(await isFile(reader, 'package.json')).toBe(true);
    expect(await isFile(reader, 'empty.txt')).toBe(true); // an empty file is still a file
    expect(await isFile(reader, 'src')).toBe(false);
    expect(await isFile(reader, 'nope')).toBe(false);
    expect(await isDirectory(reader, 'src')).toBe(true);
    expect(await isDirectory(reader, 'src/lib')).toBe(true);
    expect(await isDirectory(reader, 'package.json')).toBe(false);
    expect(await isDirectory(reader, '')).toBe(true);
    expect(await pathExists(reader, 'src')).toBe(true);
    expect(await pathExists(reader, 'package.json')).toBe(true);
    expect(await pathExists(reader, 'missing')).toBe(false);
  });

  it('lists names of files and of directories separately', async () => {
    expect(await listFileNames(reader, '')).toEqual(['bad.json', 'empty.txt', 'package.json']);
    expect(await listDirectoryNames(reader, '')).toEqual(['src']);
    expect(await listFileNames(reader, 'src')).toEqual(['a.ts']);
    expect(await listDirectoryNames(reader, 'src')).toEqual(['lib']);
    expect(await listFileNames(reader, 'nope')).toEqual([]);
  });

  it('reads text and JSON, and treats an unreadable file as empty or null', async () => {
    expect(await readText(reader, 'src/a.ts')).toBe('a');
    expect(await readText(reader, 'nope')).toBe('');
    expect(await readJson(reader, 'package.json')).toEqual({ name: 'x', scripts: { seed: 'node s.js' } });
    expect(await readJson(reader, 'bad.json')).toBeNull();
    expect(await readJson(reader, 'nope')).toBeNull();
  });

  it('a path that climbs out is refused by every helper', async () => {
    await expect(isFile(reader, '../x')).rejects.toBeInstanceOf(RepoPathError);
    await expect(readText(reader, '../x')).rejects.toBeInstanceOf(RepoPathError);
    await expect(reader.list('../x')).rejects.toBeInstanceOf(RepoPathError);
  });
});
