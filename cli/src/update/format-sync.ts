import { join } from 'node:path';
import { execa } from 'execa';
import { exists } from '../lib/fs-utils.js';
import type { SyncContext, SectionResult } from './types.js';

// Matches the prettier-only bucket of the canonical lint-staged config synced
// into node-stack consumers (sdlc/files/stacks/node/hooks/lint-staged.config.mjs):
// '*.{json,css,md,yml,yaml}'. Deliberately excludes ts/tsx/js/jsx — those also
// run through eslint --fix in that config, which is riskier to run unattended
// here (project-specific lint rules can fail outright, not just reformat).
const PRETTIER_EXTENSIONS = new Set(['.json', '.css', '.md', '.yml', '.yaml']);

function hasPrettierExtension(path: string): boolean {
  const idx = path.lastIndexOf('.');
  if (idx === -1) return false;
  return PRETTIER_EXTENSIONS.has(path.slice(idx).toLowerCase());
}

/**
 * Final sync step (DevAudit-Installer#663): re-run the consumer's own
 * Prettier over every file this sync just wrote, so the diff that lands in
 * git already matches whatever the consumer's pre-commit hook would produce
 * anyway. Without this, a consumer's lint-staged/husky chain reformats a
 * synced file at commit time; if that reformat happens to reproduce the
 * pre-sync byte content exactly, git sees no diff and the file silently
 * drops out of the commit even though `devaudit update` reported it synced.
 *
 * Scoped to stack: node with a resolvable `prettier` binary in the consumer
 * project — the only case this can currently normalize against. `prettier`
 * is a required_dev_dependency for the node stack adapter and is installed
 * by section 2c-ii (syncStackDeps) before this step runs, so resolution
 * should succeed whenever a project actually went through the full
 * node-stack pipeline. Best-effort: a failure here warns rather than
 * aborting the sync, since the alternative (files as originally synced) is
 * no worse than the status quo before this fix.
 */
export async function formatSyncedFiles(
  ctx: SyncContext,
  filePaths: readonly string[],
): Promise<SectionResult> {
  if (ctx.stack !== 'node') {
    return { name: 'Formatter normalization', filesSynced: 0, skipped: true };
  }
  const targets = [...new Set(filePaths)].filter(hasPrettierExtension);
  if (targets.length === 0) {
    return {
      name: 'Formatter normalization',
      filesSynced: 0,
      skipped: true,
      message: 'no formattable files synced',
    };
  }
  const localBin = join(ctx.projectPath, 'node_modules', '.bin', 'prettier');
  const useLocalBin = await exists(localBin);
  const [cmd, args] = useLocalBin
    ? [localBin, ['--write', ...targets]]
    : ['npx', ['--no-install', 'prettier', '--write', ...targets]];
  const result = await execa(cmd, args, { cwd: ctx.projectPath, reject: false });
  if (result.exitCode !== 0) {
    return {
      name: 'Formatter normalization',
      filesSynced: 0,
      warning: `prettier --write failed on synced files — a consumer formatter hook may silently revert some of them at commit time (${(result.stderr || result.stdout || 'unknown error').trim()})`,
    };
  }
  return {
    name: 'Formatter normalization',
    filesSynced: targets.length,
    message: `ran prettier --write on ${targets.length} synced file(s) so the commit already matches consumer style`,
  };
}
