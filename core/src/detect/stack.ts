import { isFile, joinRepoPath, listDirectoryNames, listFileNames, type RepoReader } from '../repo-reader.js';

/**
 * The stack of a repository and where its app lives, from marker files. Ported from the CLI's
 * `detect-stack.ts` (DevAudit-Installer#1116 WP3).
 */

export interface DetectedStack {
  readonly stack: 'node' | 'python';
  /** The directory that holds the app, relative to the reader's root; `.` for the root itself. */
  readonly workingDirectory: string;
}

/**
 * `pyproject.toml` is preferred (the Python packaging standard), but a repo managed with a plain
 * `requirements.txt` (no `pyproject.toml` at all) is a real convention, for example an unpackaged
 * FastAPI service, and must still be detectable.
 */
export const PYTHON_MARKERS = ['pyproject.toml', 'requirements.txt'] as const;

/** Directories that are never searched for a nested project. */
export const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo']);

/** The root and two levels below it are searched for a Python marker. */
const MAX_DEPTH = 3;

async function findPythonMarkerDir(reader: RepoReader, dir: string, depth: number): Promise<string | null> {
  if (depth > MAX_DEPTH) return null;
  const files = await listFileNames(reader, dir);
  for (const marker of PYTHON_MARKERS) {
    if (files.includes(marker)) return dir;
  }
  for (const name of await listDirectoryNames(reader, dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const found = await findPythonMarkerDir(reader, joinRepoPath(dir, name), depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Python wins over Node when both marker sets exist (a Python marker at the root, then a Python
 * marker up to two levels down, then `package.json` at the root). Returns null when nothing is found.
 */
export async function detectStack(reader: RepoReader): Promise<DetectedStack | null> {
  for (const marker of PYTHON_MARKERS) {
    if (await isFile(reader, marker)) return { stack: 'python', workingDirectory: '.' };
  }
  const nested = await findPythonMarkerDir(reader, '', 1);
  if (nested !== null) return { stack: 'python', workingDirectory: nested === '' ? '.' : nested };
  if (await isFile(reader, 'package.json')) return { stack: 'node', workingDirectory: '.' };
  return null;
}
