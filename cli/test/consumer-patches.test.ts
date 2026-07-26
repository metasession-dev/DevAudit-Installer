import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import { applyConsumerPatches } from "../src/update/consumer-patches.js";
import type { SyncContext } from "../src/update/types.js";

const workspaces: string[] = [];

async function readFixtureFile(ctx: SyncContext): Promise<string> {
  const content = await readFile(
    join(ctx.projectPath, "scripts", "example.sh"),
    "utf8",
  );
  return content.replace(/\r\n/g, "\n");
}

async function fixture(content = "upstream\n"): Promise<SyncContext> {
  const projectPath = await mkdtemp(join(tmpdir(), "consumer-patches-"));
  workspaces.push(projectPath);
  await execa("git", ["init", "-q"], { cwd: projectPath });
  await mkdir(join(projectPath, "scripts"), { recursive: true });
  await writeFile(join(projectPath, "scripts", "example.sh"), content);
  return {
    installerRoot: projectPath,
    projectPath,
    projectName: "fixture",
    stack: "node",
    host: "railway",
  };
}

async function writePatch(
  ctx: SyncContext,
  name = "example.patch",
  replacement = "consumer override",
): Promise<void> {
  const patchRoot = join(ctx.projectPath, ".devaudit-patches");
  await mkdir(patchRoot, { recursive: true });
  await writeFile(
    join(patchRoot, name),
    [
      "diff --git a/scripts/example.sh b/scripts/example.sh",
      "--- a/scripts/example.sh",
      "+++ b/scripts/example.sh",
      "@@ -1 +1 @@",
      "-upstream",
      `+${replacement}`,
      "",
    ].join("\n"),
  );
}

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("consumer patch layer (#84)", () => {
  it("skips when the consumer has no patch directory", async () => {
    const ctx = await fixture();
    await expect(applyConsumerPatches(ctx)).resolves.toMatchObject({
      skipped: true,
      filesSynced: 0,
    });
  });

  it("applies a clean patch after sync", async () => {
    const ctx = await fixture();
    await writePatch(ctx);
    const result = await applyConsumerPatches(ctx);
    expect(result).toMatchObject({ filesSynced: 1 });
    expect(result.message).toContain("applied: example.patch");
    await expect(readFixtureFile(ctx)).resolves.toBe("consumer override\n");
  });

  it("reports a patch that is already present upstream as obsolete", async () => {
    const ctx = await fixture("consumer override\n");
    await writePatch(ctx);
    const result = await applyConsumerPatches(ctx);
    expect(result.filesSynced).toBe(0);
    expect(result.warning).toContain("1 obsolete");
    expect(result.message).toContain(
      "obsolete/already upstream: example.patch",
    );
  });

  it("fails loudly without mutating a conflicting target", async () => {
    const ctx = await fixture("different upstream content\n");
    await writePatch(ctx);
    await expect(applyConsumerPatches(ctx)).rejects.toThrow(
      /consumer patch conflict: example\.patch/,
    );
    await expect(readFixtureFile(ctx)).resolves.toBe(
      "different upstream content\n",
    );
  });

  it("preflights the combined patch set before applying any file", async () => {
    const ctx = await fixture();
    await writePatch(ctx, "01-first.patch", "first override");
    await writePatch(ctx, "02-second.patch", "second override");
    await expect(applyConsumerPatches(ctx)).rejects.toThrow(
      /conflict when combined/,
    );
    await expect(readFixtureFile(ctx)).resolves.toBe("upstream\n");
  });
});
