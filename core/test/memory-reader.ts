import { normalizeRepoPath, type RepoReader } from '../src/repo-reader.js';

/** A RepoReader over an in-memory map of repository paths to file text (for tests). */
export function memoryReader(files: Record<string, string>): RepoReader {
  const paths = Object.keys(files).map((p) => normalizeRepoPath(p));
  return {
    async list(dir) {
      const base = normalizeRepoPath(dir);
      const prefix = base === '' ? '' : `${base}/`;
      const entries = new Set<string>();
      for (const path of paths) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (rest === '') continue;
        const slash = rest.indexOf('/');
        entries.add(slash === -1 ? `${prefix}${rest}` : `${prefix}${rest.slice(0, slash)}/`);
      }
      return [...entries].sort();
    },
    async read(path, maxBytes) {
      const key = normalizeRepoPath(path);
      const text = files[key];
      return text === undefined ? null : Buffer.from(text).subarray(0, maxBytes).toString('utf-8');
    },
  };
}
