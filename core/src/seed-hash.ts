/**
 * The seed files hash (DevAudit-Installer#1116 WP15): one definition shared by the regression lifecycle
 * (`sdlc/files/_common/scripts/e2e-data-lifecycle.sh hash`) and the doctor's live-drift finding.
 *
 * List the git-tracked files under `e2e_seed_paths`, sort the paths bytewise (the UTF-8 bytes of the
 * path), build one line `<sha256 hex of the file>  <path>` (two spaces, `\n`) per file, and take the
 * sha256 of the concatenated lines. A parity test hashes the same fixture folder with both
 * implementations. Pure: the caller lists and reads the files.
 */

export interface SeedFile {
  /** Repository path with `/` separators, as `git ls-files` prints it. */
  readonly path: string;
  readonly content: Uint8Array;
}

interface SubtleLike {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

function subtle(): SubtleLike {
  const c = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto;
  if (!c?.subtle) throw new Error('no Web Crypto available to hash the seed files');
  return c.subtle;
}

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const encoder = new TextEncoder();

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/** The hash of the given seed files (empty string for none). */
export async function seedFilesHash(files: readonly SeedFile[]): Promise<string> {
  if (files.length === 0) return '';
  const sorted = files.map((f) => ({ f, key: encoder.encode(f.path) })).sort((a, b) => compareBytes(a.key, b.key));
  let lines = '';
  for (const { f } of sorted) lines += `${hex(await subtle().digest('SHA-256', f.content))}  ${f.path}\n`;
  return hex(await subtle().digest('SHA-256', encoder.encode(lines)));
}
