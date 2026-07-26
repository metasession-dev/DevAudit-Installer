import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { execa } from "execa";
import type { SectionResult, SyncContext } from "./types.js";

const PATCH_DIRECTORY = ".devaudit-patches";

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

  if (conflicts.length > 0) {
    const names = conflicts.map((path) => relative(patchRoot, path)).join(", ");
    throw new Error(
      `consumer patch conflict: ${names}. Upstream templates changed; re-roll or remove the patch before updating.`,
    );
  }

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

  const appliedNames = applicable.map((path) => relative(patchRoot, path));
  const obsoleteNames = obsolete.map((path) => relative(patchRoot, path));
  const details = [
    appliedNames.length > 0 ? `applied: ${appliedNames.join(", ")}` : "",
    obsoleteNames.length > 0
      ? `obsolete/already upstream: ${obsoleteNames.join(", ")} (remove after review)`
      : "",
  ].filter(Boolean);

  return {
    name: "consumer patches",
    filesSynced: applicable.length,
    message: details.join("; "),
    ...(obsoleteNames.length > 0
      ? { warning: `${obsoleteNames.length} obsolete consumer patch(es)` }
      : {}),
  };
}
