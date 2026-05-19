import { promises as fs } from 'node:fs';
import { dirname, join, basename } from 'node:path';

export async function ensureDir(dir: string, mode = 0o755): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode });
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function isDir(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function copyFile(src: string, dst: string, mode?: number): Promise<void> {
  await ensureDir(dirname(dst));
  await fs.copyFile(src, dst);
  if (mode !== undefined) await fs.chmod(dst, mode);
}

/**
 * Recursive copy preserving directory structure. Roughly equivalent to
 * `cp -r src/. dst/`. If `clean` is true the destination is removed first
 * (rsync-style --delete semantics).
 */
export async function copyDir(src: string, dst: string, clean = false): Promise<number> {
  if (clean && (await exists(dst))) {
    await fs.rm(dst, { recursive: true, force: true });
  }
  await ensureDir(dst);
  let count = 0;
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      count += await copyDir(srcPath, dstPath, false);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, dstPath);
      count += 1;
    }
  }
  return count;
}

export async function listFiles(dir: string, predicate?: (name: string) => boolean): Promise<readonly string[]> {
  if (!(await isDir(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => (predicate ? predicate(name) : true))
    .map((name) => join(dir, name));
}

export function fileBasename(path: string): string {
  return basename(path);
}
