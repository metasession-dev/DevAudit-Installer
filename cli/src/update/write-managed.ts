import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { ensureDir, exists, isDir } from '../lib/fs-utils.js';
import { sha256, toManifestKey, type ManifestEntry, type SyncManifest } from './sync-manifest.js';

/**
 * A known-good file state to classify writes/removals against — either the
 * previous sync's manifest (the common case) or a reconstructed baseline
 * from `manifest-bootstrap.ts` (the very first sync after this shipped, or
 * a manifest that failed to read). See devaudit-installer#930.
 *
 * Deliberately just a plain map: bootstrap and "read the real manifest"
 * both reduce to the same shape, and an empty map (bootstrap fell back to
 * conservative mode, or this is a fresh `install`) needs no special-casing
 * anywhere else — every path is simply "unknown" to classify against.
 */
export type KnownFiles = ReadonlyMap<string, { readonly sha256: string; readonly section: string }>;

interface PendingEntry {
  readonly section: string;
  readonly conflict: boolean;
  /** Only set when `conflict` is true — the frozen (not-updated) hash. */
  readonly frozenSha256?: string;
  readonly pendingUpstreamSha256?: string | null;
}

export type WriteOutcome = 'new' | 'written' | 'identical' | 'conflict';
export type RemoveOutcome = 'removed' | 'kept-conflict' | 'not-tracked';

export interface ConflictNote {
  readonly relPath: string;
  readonly kind: 'write' | 'stale-modified';
}

/**
 * Per-sync mutable state threaded through every section via `SyncContext`.
 * One instance per `syncProject()` call.
 */
export class ManagedSyncState {
  readonly repoRoot: string;
  readonly known: KnownFiles;
  readonly dryRun: boolean;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly removedKeys = new Set<string>();
  readonly conflicts: ConflictNote[] = [];

  constructor(repoRoot: string, known: KnownFiles, dryRun: boolean) {
    this.repoRoot = repoRoot;
    this.known = known;
    this.dryRun = dryRun;
  }

  /** Record a non-conflict touch (final hash computed later, post-format). */
  markTouched(relPath: string, section: string): void {
    this.pending.set(relPath, { section, conflict: false });
  }

  markConflict(relPath: string, section: string, frozenSha256: string, pendingUpstreamSha256: string | null): void {
    this.pending.set(relPath, { section, conflict: true, frozenSha256, pendingUpstreamSha256 });
    this.conflicts.push({ relPath, kind: 'write' });
  }

  markStaleModified(relPath: string, section: string): void {
    const existing = this.known.get(relPath);
    this.pending.set(relPath, {
      section,
      conflict: true,
      frozenSha256: existing?.sha256 ?? '',
      pendingUpstreamSha256: null,
    });
    this.conflicts.push({ relPath, kind: 'stale-modified' });
  }

  markRemoved(relPath: string): void {
    this.pending.delete(relPath);
    this.removedKeys.add(relPath);
  }

  /**
   * Build the final manifest, hashing each non-conflict touched path's
   * *current* on-disk content (post consumer-patches/2j, post formatting/2l
   * — called from `syncProject` after both have run) rather than the
   * content passed to `writeManaged` at write time, so a patch-carrying or
   * reformatted file is recorded by what's actually on disk, not a
   * pre-patch/pre-format snapshot that would falsely read as drifted next
   * sync (devaudit-installer#930, closing the gap SRS-PATCH-084-001/002
   * flagged).
   */
  async finalize(cliVersion: string, previous: SyncManifest | undefined): Promise<SyncManifest> {
    const files: Record<string, ManifestEntry> = {};
    // Carry forward every previously-tracked path this sync didn't touch
    // and didn't remove — e.g. a section that's skipped this run (disabled
    // e2e-regression, a stack with no hooks/) must not silently drop its
    // manifest history.
    if (previous) {
      for (const [key, entry] of Object.entries(previous.files)) {
        if (this.pending.has(key) || this.removedKeys.has(key)) continue;
        files[key] = entry;
      }
    }
    for (const [relPath, entry] of this.pending) {
      if (entry.conflict) {
        files[relPath] = {
          sha256: entry.frozenSha256 ?? '',
          section: entry.section,
          conflict: true,
          pending_upstream_sha256: entry.pendingUpstreamSha256 ?? null,
        };
        continue;
      }
      const absPath = join(this.repoRoot, ...relPath.split('/'));
      let hash = '';
      if (await exists(absPath)) {
        hash = sha256(await fs.readFile(absPath));
      }
      files[relPath] = { sha256: hash, section: entry.section };
    }
    return { version: 1, cli_version: cliVersion, files };
  }
}

async function writeWithMode(absPath: string, content: string | Buffer, mode: number | undefined): Promise<void> {
  await ensureDir(dirname(absPath));
  await fs.writeFile(absPath, content);
  if (mode !== undefined) await fs.chmod(absPath, mode);
}

/**
 * The one write path every regenerating sync section routes through
 * (devaudit-installer#930), replacing direct `copyFile`/`fs.writeFile`
 * calls. Classifies the destination against `state.known` (the previous
 * manifest, or a reconstructed bootstrap baseline) and acts:
 *
 * - **new** (no known entry, nothing on disk) → write normally.
 * - **known + missing on disk** (consumer deleted it) → nothing to
 *   preserve, write normally.
 * - **known + on-disk hash matches known hash** (unmodified) → write
 *   normally, even if the new content differs (that's the whole point of
 *   a sync).
 * - **on-disk hash already matches the new content** → nothing to do,
 *   resolves a previously-conflicting path once the operator has taken
 *   `.devaudit-new` or otherwise reconciled it by hand.
 * - **known + on-disk hash differs from both known and new content**, or
 *   **unknown + something already exists on disk** (a pre-existing file at
 *   onboarding) → **conflict**: the local file is left byte-for-byte
 *   untouched, the new content is written to `<path>.devaudit-new`
 *   instead, and the conflict is recorded for the manifest + doctor.
 */
export async function writeManaged(
  state: ManagedSyncState,
  absPath: string,
  content: string | Buffer,
  opts: { readonly section: string; readonly mode?: number },
): Promise<WriteOutcome> {
  const relPath = toManifestKey(state.repoRoot, absPath);
  const known = state.known.get(relPath);
  const onDisk = (await exists(absPath)) ? await fs.readFile(absPath) : undefined;
  const newHash = sha256(content);

  if (onDisk !== undefined) {
    const onDiskHash = sha256(onDisk);
    if (onDiskHash === newHash) {
      state.markTouched(relPath, opts.section);
      return 'identical';
    }
    if (known && onDiskHash === known.sha256) {
      if (!state.dryRun) await writeWithMode(absPath, content, opts.mode);
      state.markTouched(relPath, opts.section);
      return 'written';
    }
    // Locally modified (known but diverged) or unknown-but-present
    // (pre-existing file at onboarding) — both are a conflict.
    if (!state.dryRun) {
      await writeWithMode(`${absPath}.devaudit-new`, content, opts.mode);
    }
    state.markConflict(relPath, opts.section, known?.sha256 ?? onDiskHash, newHash);
    return 'conflict';
  }

  // Nothing on disk — safe to write regardless of manifest state (a
  // consumer-deleted-but-still-tracked path, or a genuinely new one).
  if (!state.dryRun) await writeWithMode(absPath, content, opts.mode);
  state.markTouched(relPath, opts.section);
  return 'new';
}

/**
 * Manifest-driven stale-file removal (devaudit-installer#930), replacing a
 * blind `fs.rm`/`copyDir(clean=true)`. Deletes only if the path is known
 * (in the manifest or bootstrap baseline) and unmodified; a modified stale
 * file is kept and reported as a conflict instead, with no `.devaudit-new`
 * written (there's no new upstream content to offer — the file is simply
 * no longer supposed to exist).
 */
export async function removeManaged(
  state: ManagedSyncState,
  absPath: string,
  opts: { readonly section: string },
): Promise<RemoveOutcome> {
  const relPath = toManifestKey(state.repoRoot, absPath);
  const known = state.known.get(relPath);
  if (!known) return 'not-tracked';
  if (!(await exists(absPath))) {
    state.markRemoved(relPath);
    return 'removed';
  }
  const onDiskHash = sha256(await fs.readFile(absPath));
  if (onDiskHash === known.sha256) {
    if (!state.dryRun) await fs.rm(absPath);
    state.markRemoved(relPath);
    return 'removed';
  }
  state.markStaleModified(relPath, opts.section);
  return 'kept-conflict';
}

/**
 * Recursively sync every file under `srcDir` into `dstDir` through
 * `writeManaged`, preserving relative subdirectory structure. Used in place
 * of `copyDir(clean=true)` for directory-shaped sync targets (`.claude/skills/`,
 * `SDLC/blueprints/`) so a consumer-added file with no upstream counterpart
 * is never deleted just because it wasn't in the source tree (devaudit-
 * installer#930) — that's `removeStaleUnderManaged`'s job, and only for
 * files the manifest/baseline says devaudit itself put there.
 */
export async function syncDirManaged(
  state: ManagedSyncState,
  srcDir: string,
  dstDir: string,
  section: string,
): Promise<{ readonly synced: number; readonly filePaths: readonly string[] }> {
  const filePaths: string[] = [];
  let synced = 0;
  async function walk(src: string, dst: string): Promise<void> {
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const s = join(src, entry.name);
      const d = join(dst, entry.name);
      if (entry.isDirectory()) {
        await walk(s, d);
      } else if (entry.isFile()) {
        const content = await fs.readFile(s);
        const outcome = await writeManaged(state, d, content, { section });
        filePaths.push(d);
        if (outcome !== 'conflict') synced += 1;
      }
    }
  }
  await walk(srcDir, dstDir);
  return { synced, filePaths };
}

/**
 * Walk `dstDir` recursively and, for every file NOT in `keepAbsPaths` (the
 * current upstream file set), attempt manifest-driven removal via
 * `removeManaged`. A file devaudit never wrote (not in the manifest/baseline
 * at all) is left alone with no side effect; a devaudit-written-but-stale
 * file that's unmodified is deleted; one that's been locally modified is
 * kept and reported as a conflict. Replaces `copyDir(clean=true)`'s blind
 * `rm -rf` (devaudit-installer#930).
 */
export async function removeStaleUnderManaged(
  state: ManagedSyncState,
  dstDir: string,
  keepAbsPaths: ReadonlySet<string>,
  section: string,
): Promise<{ readonly removed: number; readonly kept: number }> {
  let removed = 0;
  let kept = 0;
  async function walk(dir: string): Promise<void> {
    if (!(await isDir(dir))) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
        continue;
      }
      if (!entry.isFile() || keepAbsPaths.has(p)) continue;
      const outcome = await removeManaged(state, p, { section });
      if (outcome === 'removed') removed += 1;
      else if (outcome === 'kept-conflict') kept += 1;
    }
  }
  await walk(dstDir);
  return { removed, kept };
}

export function formatConflictSummary(conflicts: readonly ConflictNote[]): string | undefined {
  if (conflicts.length === 0) return undefined;
  const writeConflicts = conflicts.filter((c) => c.kind === 'write');
  const staleConflicts = conflicts.filter((c) => c.kind === 'stale-modified');
  const lines: string[] = [`${conflicts.length} file(s) have local modifications devaudit will not overwrite:`];
  for (const c of writeConflicts) {
    lines.push(`  - ${c.relPath} (local kept — new upstream content written to ${c.relPath}.devaudit-new)`);
  }
  for (const c of staleConflicts) {
    lines.push(`  - ${c.relPath} (locally modified stale file kept, not removed)`);
  }
  lines.push(
    'Resolve each: take upstream with `mv <path>.devaudit-new <path>`, or keep your change permanently via a config key, .devaudit-patches, or a sanctioned hook, then restore upstream content and delete <path>.devaudit-new.',
    'Run `devaudit doctor` (the sync-conflicts check) any time to re-list unresolved conflicts.',
  );
  return lines.join('\n');
}
