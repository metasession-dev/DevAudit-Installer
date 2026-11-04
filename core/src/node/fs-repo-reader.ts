import { promises as fs } from 'node:fs';
import { join, sep } from 'node:path';
import { normalizeRepoPath, type RepoReader } from '../repo-reader.js';

/**
 * A {@link RepoReader} over a local directory. It never reads outside `root`: a path with a `..`
 * segment or an absolute path is refused with a `RepoPathError`, and a symlink that points outside the
 * root reads as if it were not there. It never runs anything.
 */
export function fsRepoReader(root: string): RepoReader {
  let realRoot: Promise<string> | undefined;
  const rootReal = (): Promise<string> => (realRoot ??= fs.realpath(root));

  /** The real path of `relative`, or null when it is missing or resolves outside the root. */
  async function resolveInside(relative: string): Promise<string | null> {
    const base = await rootReal();
    let real: string;
    try {
      real = await fs.realpath(join(root, relative));
    } catch {
      return null;
    }
    return real === base || real.startsWith(base + sep) ? real : null;
  }

  return {
    async list(dir) {
      const rel = normalizeRepoPath(dir);
      const real = await resolveInside(rel);
      if (real === null) return [];
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(real, { withFileTypes: true });
      } catch {
        return [];
      }
      const out: string[] = [];
      for (const entry of entries) {
        const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
        let isDir = entry.isDirectory();
        if (entry.isSymbolicLink()) {
          const target = await resolveInside(path);
          if (target === null) continue;
          isDir = (await fs.stat(target)).isDirectory();
        }
        out.push(isDir ? `${path}/` : path);
      }
      return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    },

    async read(path, maxBytes) {
      const rel = normalizeRepoPath(path);
      if (rel === '') return null;
      const real = await resolveInside(rel);
      if (real === null) return null;
      let handle: import('node:fs/promises').FileHandle | undefined;
      try {
        handle = await fs.open(real, 'r');
        if (!(await handle.stat()).isFile()) return null;
        const buffer = Buffer.alloc(Math.max(0, maxBytes));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead).toString('utf-8');
      } catch {
        return null;
      } finally {
        await handle?.close();
      }
    },
  };
}
