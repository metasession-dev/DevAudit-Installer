import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { exists } from '../lib/fs-utils.js';

/**
 * DevAudit-Installer#758 — before a generated file is overwritten, capture
 * its current (pre-sync) content so the drift check (below) can later
 * decide whether the sync is about to silently discard content that may
 * have been committed intentionally (a customization with no config-key
 * equivalent yet), with no signal to the operator that anything happened.
 *
 * Split from the actual comparison (DevAudit-Installer#766): capturing
 * happens at write time (this function), but the comparison must happen
 * *after* the formatter-normalization step has run over the newly written
 * files — see `evaluateDrift` below for why. Returns undefined when the
 * file doesn't exist yet (first sync, nothing to drift from).
 */
export async function captureBeforeOverwrite(outputPath: string): Promise<string | undefined> {
  if (!(await exists(outputPath))) return undefined;
  return fs.readFile(outputPath, 'utf-8');
}

/**
 * DevAudit-Installer#758 / #766 — decide whether a file's pre-sync content
 * (captured by `captureBeforeOverwrite` before the overwrite) represents
 * real, currently-unprotected drift from what's now on disk, AND isn't
 * covered by any `.devaudit-patches/*.patch`.
 *
 * Must be called *after* the formatter-normalization step (DevAudit-
 * Installer#663) has run, not right after the write. A previously-
 * committed generated file is normally already formatted — by the
 * consumer's own commit-time lint-staged/husky hook, or by a prior sync's
 * own formatter pass — while the content a section writes during its own
 * run is not yet formatted. Comparing pre-sync (formatted) content against
 * that not-yet-formatted content flags formatting-only differences (quote
 * style, trailing whitespace, etc.) as drift even when the two would be
 * byte-identical once the formatter runs (#766). Reading the *current*
 * on-disk content here — after formatSyncedFiles has already normalized
 * it — compares like with like.
 *
 * This is a best-effort textual check, not a real patch-target parser: a
 * patch is treated as "covering" a file if any `.patch` file's content
 * contains the file's repo-relative path — which is how `git diff`/`git
 * apply`-style unified diffs name the file in their `--- a/<path>` /
 * `+++ b/<path>` headers, the format `docs/consuming-projects.md` documents
 * for authoring these patches. Good enough to catch the common case (one
 * patch per file) without needing a full diff parser.
 *
 * Returns false (no warning) when the (now-current, post-format) content
 * matches the captured pre-sync content, or when a covering patch was
 * found. Returns true only when there's real, currently-unprotected drift.
 */
export async function evaluateDrift(
  repoRoot: string,
  outputPath: string,
  oldContent: string,
): Promise<boolean> {
  if (!(await exists(outputPath))) return false;
  const current = await fs.readFile(outputPath, 'utf-8');
  if (current === oldContent) return false;

  const relPath = relative(repoRoot, outputPath).split('\\').join('/');
  const patchDir = join(repoRoot, '.devaudit-patches');
  if (!(await exists(patchDir))) return true;

  const entries = await fs.readdir(patchDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.patch')) continue;
    const patchContent = await fs.readFile(join(patchDir, entry.name), 'utf-8');
    if (patchContent.includes(relPath)) return false;
  }
  return true;
}

/**
 * Render the warning message for one or more files with unpatched drift.
 * Kept as a pure function (no I/O) so callers can accumulate paths across
 * a loop and emit one warning per sync section, matching how every other
 * SectionResult.warning in this codebase is a single summary string.
 */
export function formatDriftWarning(relPaths: readonly string[]): string {
  const list = relPaths.join(', ');
  return `${relPaths.length} file(s) have local modifications not covered by any .devaudit-patches/*.patch and will be overwritten by this sync: ${list}. If this is intentional customization, capture it first: git diff -- <file> > .devaudit-patches/<file>.patch (see docs/consuming-projects.md).`;
}
