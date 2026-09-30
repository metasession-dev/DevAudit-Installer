import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { exists, isDir, isFile, listFiles } from '../lib/fs-utils.js';
import { readSdlcConfig } from '../lib/sdlc-config.js';
import { applyConsumerPatches } from './consumer-patches.js';
import { formatSyncedFiles } from './format-sync.js';
import { sha256, toManifestKey } from './sync-manifest.js';
import type { KnownFiles } from './write-managed.js';
import type { SyncContext } from './types.js';

/**
 * Every path a sync section can write to, as directory prefixes ("dir/")
 * or exact file names — the "synced surface" the manifest and its bootstrap
 * reconstruction track. Kept in one place because both the bootstrap
 * baseline builder (this file) and the removal sweeps need the identical
 * list: a path outside it is never devaudit's to manage either way.
 */
export const MANAGED_PATH_PREFIXES: readonly string[] = [
  'SDLC/',
  '.husky/',
  'scripts/',
  '.github/workflows/',
  '.github/ISSUE_TEMPLATE/',
  '.claude/skills/',
  '.devin/workflows/',
  'e2e/helpers/',
  '.cursorrules',
  '.windsurfrules',
  'GEMINI.md',
  'AGENTS.md',
  '.prettierrc.json',
  'commitlint.config.mjs',
  'lint-staged.config.mjs',
];

function isManagedPath(relPosixPath: string): boolean {
  return MANAGED_PATH_PREFIXES.some((p) => (p.endsWith('/') ? relPosixPath.startsWith(p) : relPosixPath === p));
}

async function hashManagedTree(root: string): Promise<KnownFiles> {
  const known = new Map<string, { sha256: string; section: string }>();
  async function walk(dir: string): Promise<void> {
    if (!(await isDir(dir))) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const rel = toManifestKey(root, abs);
        if (!isManagedPath(rel)) continue;
        known.set(rel, { sha256: sha256(await fs.readFile(abs)), section: 'bootstrap' });
      }
    }
  }
  for (const prefix of MANAGED_PATH_PREFIXES) {
    if (prefix.endsWith('/')) {
      await walk(join(root, ...prefix.split('/').filter(Boolean)));
    } else if (await isFile(join(root, prefix))) {
      known.set(prefix, { sha256: sha256(await fs.readFile(join(root, prefix))), section: 'bootstrap' });
    }
  }
  return known;
}

export interface BaselineRunner {
  (opts: { readonly worktreeDir: string; readonly version: string }): Promise<void>;
}

/** Default runner: `npx --yes @metasession.co/devaudit-cli@<version> update <dir>`. */
export const defaultBaselineRunner: BaselineRunner = async ({ worktreeDir, version }) => {
  await execa('npx', ['--yes', `@metasession.co/devaudit-cli@${version}`, 'update', worktreeDir], {
    reject: false,
    timeout: 5 * 60 * 1000,
  });
};

export interface BaselineResult {
  readonly known: KnownFiles;
  readonly fellBack: boolean;
  readonly warning?: string;
}

const EMPTY: KnownFiles = new Map();

/**
 * Reconstruct "what devaudit last wrote" when no `.devaudit/sync-manifest.json`
 * exists yet — the very first sync after this shipped for an already-onboarded
 * consumer (devaudit-installer#930). Runs the consumer's previously-synced CLI
 * version into a scratch git worktree, re-applies the current version's
 * consumer patches and formatter over it, then hashes every file under the
 * managed-path allowlist as the baseline.
 *
 * Falls back to an empty baseline (every existing file becomes a conflict,
 * nothing is deleted) whenever reconstruction can't be trusted: no recorded
 * `devaudit_synced_version`, no git repository, or the worktree/npx steps
 * fail. This is deliberately the *safe* direction to fail in — an empty
 * baseline never causes a wrong overwrite or a wrong deletion, only a
 * conflict where a silent overwrite would previously have happened.
 */
export async function buildBaseline(ctx: SyncContext, runner: BaselineRunner = defaultBaselineRunner): Promise<BaselineResult> {
  const config = await readSdlcConfig(ctx.repoRoot);
  const version = config?.devaudit_synced_version;
  if (!version) {
    return { known: EMPTY, fellBack: true, warning: 'no devaudit_synced_version recorded — bootstrap baseline unavailable, falling back to conservative mode (existing files differing from upstream will be treated as conflicts; nothing will be deleted)' };
  }
  const gitCheck = await execa('git', ['-C', ctx.repoRoot, 'rev-parse', '--is-inside-work-tree'], { reject: false });
  if (gitCheck.exitCode !== 0) {
    return { known: EMPTY, fellBack: true, warning: 'not a git repository — bootstrap baseline unavailable, falling back to conservative mode' };
  }

  const worktreeDir = await fs.mkdtemp(join(tmpdir(), 'devaudit-baseline-'));
  try {
    const add = await execa('git', ['-C', ctx.repoRoot, 'worktree', 'add', '--detach', worktreeDir, 'HEAD'], {
      reject: false,
    });
    if (add.exitCode !== 0) {
      return {
        known: EMPTY,
        fellBack: true,
        warning: `could not create a scratch git worktree to reconstruct the sync baseline (${(add.stderr || add.stdout || '').trim() || 'unknown error'}) — falling back to conservative mode`,
      };
    }

    await runner({ worktreeDir, version });

    // Re-apply the CURRENT version's consumer patches + formatter over the
    // reconstructed baseline, so a patch-carrying or formatter-normalized
    // file compares correctly against this sync's own patched/formatted
    // output rather than reading as spuriously modified.
    const baselineCtx: SyncContext = { ...ctx, projectPath: worktreeDir, repoRoot: worktreeDir };
    await applyConsumerPatches(baselineCtx).catch(() => undefined);
    const managedFiles = await listManagedFiles(worktreeDir);
    await formatSyncedFiles(baselineCtx, managedFiles).catch(() => undefined);

    const known = await hashManagedTree(worktreeDir);
    return { known, fellBack: false };
  } catch (error) {
    return {
      known: EMPTY,
      fellBack: true,
      warning: `sync baseline reconstruction failed (${(error as Error).message}) — falling back to conservative mode`,
    };
  } finally {
    await execa('git', ['-C', ctx.repoRoot, 'worktree', 'remove', '--force', worktreeDir], { reject: false });
    await fs.rm(worktreeDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function listManagedFiles(root: string): Promise<readonly string[]> {
  const out: string[] = [];
  for (const prefix of MANAGED_PATH_PREFIXES) {
    if (prefix.endsWith('/')) {
      const dir = join(root, ...prefix.split('/').filter(Boolean));
      out.push(...(await listFiles(dir)));
    } else if (await exists(join(root, prefix))) {
      out.push(join(root, prefix));
    }
  }
  return out;
}
