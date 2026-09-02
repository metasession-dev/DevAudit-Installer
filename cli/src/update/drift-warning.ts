import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { exists } from '../lib/fs-utils.js';

/**
 * DevAudit-Installer#758 — before a generated file is overwritten, detect
 * whether its current (pre-sync) content differs from what's about to
 * replace it AND isn't covered by any `.devaudit-patches/*.patch`. If so,
 * the sync is about to silently discard content that may have been
 * committed intentionally (a customization with no config-key equivalent
 * yet) with no signal to the operator that anything happened.
 *
 * This is a best-effort textual check, not a real patch-target parser: a
 * patch is treated as "covering" a file if any `.patch` file's content
 * contains the file's repo-relative path — which is how `git diff`/`git
 * apply`-style unified diffs name the file in their `--- a/<path>` /
 * `+++ b/<path>` headers, the format `docs/consuming-projects.md` documents
 * for authoring these patches. Good enough to catch the common case (one
 * patch per file) without needing a full diff parser.
 *
 * Returns false (no warning) when the file doesn't exist yet (first sync,
 * nothing to drift from), when the content is actually unchanged, or when
 * a covering patch was found. Returns true only when there's real,
 * currently-unprotected drift.
 */
export async function isDriftUnpatched(
  repoRoot: string,
  outputPath: string,
  newContent: string,
): Promise<boolean> {
  if (!(await exists(outputPath))) return false;
  const current = await fs.readFile(outputPath, 'utf-8');
  if (current === newContent) return false;

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
