/**
 * How the pure core reads a repository (DevAudit-Installer#1116 section 7).
 *
 * The CLI reads the local file system (`fsRepoReader` in `@metasession.co/devaudit-core/node`); the
 * portal reads GitHub. The core never touches a file system, never runs anything from the repository
 * and never reads outside the repository root, so every path it asks for is validated here.
 *
 * Paths are relative to the repository root and use `/`. The root itself is `''` or `'.'`.
 */
export interface RepoReader {
  /**
   * The entries of a directory as paths relative to the repository root, sorted, with `/`
   * separators. **A directory entry ends with `/`**; a file entry does not. A missing directory is an
   * empty list.
   */
  list(dir: string): Promise<string[]>;
  /**
   * The file's text (UTF-8), cut at `maxBytes`, or null when the path is not a readable file (missing,
   * a directory, or outside the repository).
   */
  read(path: string, maxBytes: number): Promise<string | null>;
  /** When the file last changed in git history, or null when unknown. Optional: only the local reader has git. */
  lastCommitDate?(path: string): Promise<Date | null>;
}

/** A path that is absolute, climbs out of the repository (`..`), or holds a NUL byte. */
export class RepoPathError extends Error {
  constructor(path: string) {
    super(`refusing repository path ${JSON.stringify(path)}: it must be relative and stay inside the repository`);
    this.name = 'RepoPathError';
  }
}

/**
 * The canonical form of a repository path: `/` separators, no `.` segments, no empty segments, no
 * trailing `/`. The root is `''`. Throws {@link RepoPathError} for an absolute path (a leading `/` or
 * `\`, or a drive letter), a `..` segment, or a NUL byte, so no reader can be talked out of the root.
 */
export function normalizeRepoPath(path: string): string {
  if (path.includes('\0')) throw new RepoPathError(path);
  const unified = path.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified)) throw new RepoPathError(path);
  const segments: string[] = [];
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') throw new RepoPathError(path);
    segments.push(segment);
  }
  return segments.join('/');
}

/** Join repository path parts into one canonical path. */
export function joinRepoPath(...parts: readonly string[]): string {
  return normalizeRepoPath(parts.filter((p) => p !== '').join('/'));
}

/** The last segment of a repository path, without a trailing `/`. */
export function baseName(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/** True when the path is a readable file. */
export async function isFile(reader: RepoReader, path: string): Promise<boolean> {
  return (await reader.read(path, 1)) !== null;
}

/** True when the path is a directory that has a listing entry in its parent. */
export async function isDirectory(reader: RepoReader, path: string): Promise<boolean> {
  const normalized = normalizeRepoPath(path);
  if (normalized === '') return true;
  const cut = normalized.lastIndexOf('/');
  const parent = cut === -1 ? '' : normalized.slice(0, cut);
  return (await reader.list(parent)).includes(`${normalized}/`);
}

/** True when the path is a file or a directory. */
export async function pathExists(reader: RepoReader, path: string): Promise<boolean> {
  return (await isFile(reader, path)) || (await isDirectory(reader, path));
}

/** The text of a file, or '' when it cannot be read. */
export async function readText(reader: RepoReader, path: string, maxBytes = 1_000_000): Promise<string> {
  return (await reader.read(path, maxBytes)) ?? '';
}

/** A JSON file parsed, or null when it is missing or not valid JSON. */
export async function readJson(reader: RepoReader, path: string, maxBytes = 1_000_000): Promise<unknown> {
  const text = await reader.read(path, maxBytes);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The names (not paths) of the files directly inside a directory, in listing order. */
export async function listFileNames(reader: RepoReader, dir: string): Promise<string[]> {
  return (await reader.list(dir)).filter((entry) => !entry.endsWith('/')).map(baseName);
}

/** The names (not paths) of the directories directly inside a directory, in listing order. */
export async function listDirectoryNames(reader: RepoReader, dir: string): Promise<string[]> {
  return (await reader.list(dir)).filter((entry) => entry.endsWith('/')).map(baseName);
}
