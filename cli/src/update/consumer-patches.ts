import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { execa } from "execa";
import type { SectionResult, SyncContext } from "./types.js";

const PATCH_DIRECTORY = ".devaudit-patches";

/**
 * DevAudit-Installer#761 — every patch is meant to be temporary scaffolding
 * tied to a specific upstream issue (docs/consuming-projects.md's "Deciding:
 * config key vs. patch" procedure), not a permanent per-project mechanism.
 * That's only true as long as the link survives -- a patch with no recorded
 * reason is indistinguishable, at every future sync, from one nobody
 * remembers the reason for. Require a companion `<name>.patch.json` (same
 * basename as the `.patch` file) declaring it:
 *
 *   { "upstream_issue": "https://github.com/.../issues/759", "reason": "..." }
 */
interface PatchMetadata {
  readonly upstream_issue: string;
  readonly reason?: string;
}

async function readPatchMetadata(patchPath: string): Promise<PatchMetadata | undefined> {
  const metaPath = `${patchPath}.json`;
  let raw: string;
  try {
    raw = await readFile(metaPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<PatchMetadata>;
  if (!parsed.upstream_issue) return undefined;
  return { upstream_issue: parsed.upstream_issue, reason: parsed.reason };
}

async function gitApplyCheck(
  projectPath: string,
  patchPath: string,
  reverse = false,
): Promise<boolean> {
  const args = ["apply", "--check", "--whitespace=nowarn"];
  if (reverse) args.push("--reverse");
  args.push(patchPath);
  const result = await execa("git", args, { cwd: projectPath, reject: false });
  return result.exitCode === 0;
}

export async function applyConsumerPatches(
  ctx: SyncContext,
): Promise<SectionResult> {
  if (ctx.dryRun) {
    return { name: "consumer patches", filesSynced: 0, skipped: true, message: "skipped in --dry-run (would run git apply)" };
  }
  const patchRoot = join(ctx.projectPath, PATCH_DIRECTORY);
  let entries;
  try {
    entries = await readdir(patchRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        name: "consumer patches",
        filesSynced: 0,
        skipped: true,
        message: `${PATCH_DIRECTORY}/ not present`,
      };
    }
    throw error;
  }

  const patchPaths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".patch"))
    .map((entry) => join(patchRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));

  if (patchPaths.length === 0) {
    return {
      name: "consumer patches",
      filesSynced: 0,
      skipped: true,
      message: `no *.patch files in ${PATCH_DIRECTORY}/`,
    };
  }

  // DevAudit-Installer#761 — surface every patch's linked upstream issue
  // (or flag its absence) regardless of apply outcome, so an outstanding
  // patch and its reason stay visible at every sync rather than only being
  // discoverable by reading the file.
  const metadataByPath = new Map<string, PatchMetadata | undefined>();
  for (const patchPath of patchPaths) {
    metadataByPath.set(patchPath, await readPatchMetadata(patchPath));
  }
  const missingMetadata = patchPaths.filter((p) => !metadataByPath.get(p));

  const applicable: string[] = [];
  const obsolete: string[] = [];
  const conflicts: string[] = [];
  for (const patchPath of patchPaths) {
    if (await gitApplyCheck(ctx.projectPath, patchPath)) {
      applicable.push(patchPath);
    } else if (await gitApplyCheck(ctx.projectPath, patchPath, true)) {
      obsolete.push(patchPath);
    } else {
      conflicts.push(patchPath);
    }
  }

  // DevAudit-Installer#921 — a patch that no longer applies cleanly against
  // the freshly synced upstream template used to abort the ENTIRE sync
  // (throwing here, before formatSyncedFiles/stampVersion ever ran), even
  // though every other section had already written its files successfully.
  // That meant one stale patch could silently leave a consumer's
  // devaudit_synced_version un-bumped and dozens of unrelated fixes
  // unformatted, with no way to tell short of reading the crash. A
  // conflicting patch is now skipped (that file keeps the fresh upstream
  // template content, not the stale patched content) and reported as a
  // loud warning instead — the rest of the sync completes normally. See
  // docs/consuming-projects.md#re-rolling-a-conflicting-patch for the
  // recovery procedure this warning points at.
  const conflictNames = conflicts.map((path) => relative(patchRoot, path));

  if (applicable.length > 0) {
    const check = await execa(
      "git",
      ["apply", "--check", "--whitespace=nowarn", ...applicable],
      { cwd: ctx.projectPath, reject: false },
    );
    if (check.exitCode !== 0) {
      throw new Error(
        `consumer patches conflict when combined: ${check.stderr || check.stdout || "git apply --check failed"}`,
      );
    }
    const applied: string[] = [];
    for (const patchPath of applicable) {
      const apply = await execa(
        "git",
        ["apply", "--whitespace=nowarn", patchPath],
        {
          cwd: ctx.projectPath,
          reject: false,
        },
      );
      if (apply.exitCode === 0) {
        applied.push(patchPath);
        continue;
      }

      const rollbackErrors: string[] = [];
      for (const appliedPath of applied.reverse()) {
        const rollback = await execa(
          "git",
          ["apply", "--reverse", "--whitespace=nowarn", appliedPath],
          { cwd: ctx.projectPath, reject: false },
        );
        if (rollback.exitCode !== 0) {
          rollbackErrors.push(relative(patchRoot, appliedPath));
        }
      }
      const rollbackMessage =
        rollbackErrors.length > 0
          ? ` Rollback failed for: ${rollbackErrors.join(", ")}; restore these files before retrying.`
          : "";
      throw new Error(
        `consumer patches conflict when combined: ${apply.stderr || apply.stdout || "git apply failed"}.${rollbackMessage}`,
      );
    }
  }

  // DevAudit-Installer#761 — name each patch alongside its linked issue
  // (when it has one) so the sync output itself is the audit trail, not
  // just the file on disk.
  const withIssue = (path: string): string => {
    const name = relative(patchRoot, path);
    const meta = metadataByPath.get(path);
    return meta ? `${name} (see ${meta.upstream_issue})` : name;
  };
  const appliedNames = applicable.map(withIssue);
  const obsoleteNames = obsolete.map(withIssue);
  const conflictDisplayNames = conflictNames.map((name) => {
    const path = join(patchRoot, name);
    const meta = metadataByPath.get(path);
    return meta ? `${name} (see ${meta.upstream_issue})` : name;
  });
  const details = [
    appliedNames.length > 0 ? `applied: ${appliedNames.join(", ")}` : "",
    obsoleteNames.length > 0
      ? `obsolete/already upstream: ${obsoleteNames.join(", ")} (remove after review)`
      : "",
    conflictDisplayNames.length > 0
      ? `SKIPPED (conflict, template regenerated without it): ${conflictDisplayNames.join(", ")}`
      : "",
  ].filter(Boolean);

  const warnings = [
    conflictDisplayNames.length > 0
      ? `${conflictDisplayNames.length} consumer patch(es) no longer apply cleanly and were skipped this sync — the affected file(s) now carry the fresh upstream template UNPATCHED: ${conflictDisplayNames.join(", ")}. Re-roll or remove the patch: see docs/consuming-projects.md#re-rolling-a-conflicting-patch.`
      : "",
    obsoleteNames.length > 0 ? `${obsoleteNames.length} obsolete consumer patch(es)` : "",
    missingMetadata.length > 0
      ? `${missingMetadata.length} patch(es) missing a companion <name>.patch.json with an upstream_issue link: ${missingMetadata
          .map((p) => relative(patchRoot, p))
          .join(", ")} — every patch needs one (see docs/consuming-projects.md#deciding-config-key-vs-patch)`
      : "",
  ].filter(Boolean);

  return {
    name: "consumer patches",
    filesSynced: applicable.length,
    message: details.join("; "),
    ...(warnings.length > 0 ? { warning: warnings.join("; ") } : {}),
  };
}
