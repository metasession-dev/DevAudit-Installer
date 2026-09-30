import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { exists } from '../lib/fs-utils.js';

/** One tracked file's last-known-synced state (devaudit-installer#930). */
export interface ManifestEntry {
  /**
   * sha256 of the content devaudit last wrote (or, while `conflict` is
   * true, the content devaudit wrote *before* the conflict was detected —
   * deliberately not updated to the current on-disk hash, so the file
   * keeps reading as locally modified on every subsequent sync until the
   * conflict is actually resolved).
   */
  readonly sha256: string;
  /** Which section wrote this path (e.g. "2a", "2f"), for diagnostics. */
  readonly section: string;
  /** True when the on-disk content diverged from what devaudit last wrote. */
  readonly conflict?: boolean;
  /**
   * The hash of the upstream content devaudit tried to write during the
   * sync that first (or most recently) detected the conflict — written to
   * `<path>.devaudit-new` rather than the tracked path itself. Null once
   * resolved / when not in conflict.
   */
  readonly pending_upstream_sha256?: string | null;
}

export interface SyncManifest {
  readonly version: 1;
  readonly cli_version: string;
  readonly files: Readonly<Record<string, ManifestEntry>>;
}

export const MANIFEST_RELATIVE_PATH = join('.devaudit', 'sync-manifest.json');

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Repo-relative, forward-slash path — the manifest's on-disk key shape. */
export function toManifestKey(repoRoot: string, absPath: string): string {
  return relative(repoRoot, absPath).split(sep).join('/');
}

export function fromManifestKey(repoRoot: string, key: string): string {
  return join(repoRoot, ...key.split('/'));
}

export async function readManifest(repoRoot: string): Promise<SyncManifest | undefined> {
  const manifestPath = join(repoRoot, MANIFEST_RELATIVE_PATH);
  if (!(await exists(manifestPath))) return undefined;
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as SyncManifest;
    if (!parsed || typeof parsed !== 'object' || !parsed.files) return undefined;
    return parsed;
  } catch {
    // A corrupt/unreadable manifest is treated the same as "none exists" —
    // the bootstrap path takes over and reconstructs conservatively rather
    // than throwing and aborting the whole sync over a manifest problem.
    return undefined;
  }
}

export async function writeManifest(repoRoot: string, manifest: SyncManifest): Promise<void> {
  const manifestPath = join(repoRoot, MANIFEST_RELATIVE_PATH);
  await fs.mkdir(join(repoRoot, '.devaudit'), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}
