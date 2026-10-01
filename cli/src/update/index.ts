import { basename, resolve } from "node:path";
import { isDir } from "../lib/fs-utils.js";
import { resolveInstallerRoot } from "../lib/installer-root.js";
import { resolveRepoRoot } from "../lib/git-root.js";
import { resolveAdapters } from "./resolve-adapters.js";
import { syncStageDocs } from "./stage-docs.js";
import { syncAiRules } from "./ai-rules.js";
import { syncStackHooks } from "./stack-hooks.js";
import { syncStackDeps } from "./stack-deps.js";
import { syncScripts } from "./scripts.js";
import { syncIssueTemplates } from "./issue-templates.js";
import { syncSkills } from "./skills.js";
import { syncEvidenceHelper } from "./evidence-helper.js";
import { syncCiTemplates } from "./ci-templates.js";
import { syncGitignore } from "./gitignore.js";
import { syncSdlcEngine } from "./sdlc-engine.js";
import { syncWorkflows } from "./workflows.js";
import { verifyDefaultBranch } from "./default-branch.js";
import { verifyBranchProtection } from "./branch-protection.js";
import { runValidation } from "./validation.js";
import { applyConsumerPatches } from "./consumer-patches.js";
import { formatSyncedFiles } from "./format-sync.js";
import { stampVersion } from "./stamp-version.js";
import { readManifest, writeManifest } from "./sync-manifest.js";
import { buildBaseline } from "./manifest-bootstrap.js";
import { ManagedSyncState, formatConflictSummary, type KnownFiles } from "./write-managed.js";
import { CLI_VERSION } from "../lib/version.js";
import { logger } from "../lib/logger.js";
import type { SyncContext, SectionResult, SyncReport } from "./types.js";

const SECTION_RUNNERS: ReadonlyArray<{
  readonly key: string;
  readonly run: (ctx: SyncContext) => Promise<SectionResult>;
}> = [
  { key: "2a", run: syncStageDocs },
  { key: "2b", run: syncAiRules },
  { key: "2c", run: syncStackHooks },
  { key: "2c-ii", run: syncStackDeps },
  { key: "2d", run: syncScripts },
  { key: "2e", run: syncIssueTemplates },
  { key: "2e-ii", run: syncSkills },
  { key: "2e-iii", run: syncEvidenceHelper },
  { key: "2f", run: syncCiTemplates },
  { key: "2g", run: syncGitignore },
  { key: "2h", run: syncSdlcEngine },
  { key: "2i", run: syncWorkflows },
  { key: "2j", run: applyConsumerPatches },
  { key: "2j-i", run: verifyDefaultBranch },
  { key: "2k", run: verifyBranchProtection },
];

export interface SyncProjectOptions {
  /** Preview mode: classify and report writes/conflicts/removals, write nothing. */
  readonly dryRun?: boolean;
}

export async function syncProject(projectPath: string, options: SyncProjectOptions = {}): Promise<SyncReport> {
  const absPath = resolve(projectPath);
  if (!(await isDir(absPath))) {
    throw new Error(`Project path not found: ${absPath}`);
  }
  const installerRoot = await resolveInstallerRoot();
  const repoRoot = await resolveRepoRoot(absPath);
  const log = logger();
  const projectName = basename(absPath);
  const dryRun = options.dryRun ?? false;
  log.info(`--- Syncing to: ${projectName} (${absPath}) ---`);
  // sdlc-config.json lives at the repo root (#689 follow-up), not this
  // target's own directory — see write-config.ts for why.
  const { stack, host, deprecatedDefaults } = await resolveAdapters(
    repoRoot,
    installerRoot,
  );
  log.info(`  Stack: ${stack} | Host: ${host}`);
  if (deprecatedDefaults) {
    log.warn(
      `  DEPRECATED: stack/host keys missing from sdlc-config.json — defaulted to ${stack}+${host}.`,
    );
  }
  const baseCtx: SyncContext = {
    installerRoot,
    projectPath: absPath,
    repoRoot,
    projectName,
    stack,
    host,
    dryRun,
  };

  // Sync-manifest classification state (devaudit-installer#930): read the
  // previous manifest if one exists; otherwise reconstruct a baseline of
  // "what devaudit last wrote" via a scratch git worktree running the
  // consumer's previously-recorded CLI version, falling back to an empty
  // (maximally conservative) baseline if that reconstruction isn't
  // possible. Either way, every writing section below classifies against
  // the resulting `known` map instead of overwriting unconditionally.
  const previousManifest = await readManifest(repoRoot);
  let known: KnownFiles | undefined = previousManifest?.files
    ? new Map(Object.entries(previousManifest.files).map(([k, v]) => [k, { sha256: v.sha256, section: v.section }]))
    : undefined;
  if (!known) {
    const baseline = await buildBaseline(baseCtx);
    known = baseline.known;
    if (baseline.warning) log.warn(`  ${baseline.warning}`);
  }
  const managed = new ManagedSyncState(repoRoot, known, dryRun);
  const ctx: SyncContext = { ...baseCtx, managed };

  const sections: SectionResult[] = [];
  const sectionWarnings: string[] = [];
  let total = 0;
  for (const { key, run } of SECTION_RUNNERS) {
    const result = await run(ctx);
    sections.push(result);
    total += result.filesSynced;
    if (result.skipped) {
      log.log(
        `  [${key}] ${result.name}: SKIPPED${result.message ? ` (${result.message})` : ""}`,
      );
    } else {
      log.log(
        `  [${key}] ${result.name}: ${result.filesSynced} file(s)${result.message ? ` — ${result.message}` : ""}`,
      );
    }
    if (result.warning) {
      sectionWarnings.push(result.warning);
      log.warn(`  [${key}] ${result.warning}`);
    }
  }
  // Last step, deliberately outside the loop above and not counted into
  // `total`: it re-formats files the sections just wrote rather than
  // syncing new ones (DevAudit-Installer#663).
  const syncedFilePaths = sections.flatMap((s) => s.filePaths ?? []);
  const formatResult = await formatSyncedFiles(ctx, syncedFilePaths);
  sections.push(formatResult);
  if (formatResult.skipped) {
    log.log(
      `  [2l] ${formatResult.name}: SKIPPED${formatResult.message ? ` (${formatResult.message})` : ""}`,
    );
  } else {
    log.log(
      `  [2l] ${formatResult.name}: ${formatResult.filesSynced} file(s)${formatResult.message ? ` — ${formatResult.message}` : ""}`,
    );
  }
  if (formatResult.warning) {
    sectionWarnings.push(formatResult.warning);
    log.warn(`  [2l] ${formatResult.warning}`);
  }
  // Stamp last, deliberately after every other section: it should only
  // reflect a sync that actually ran to completion.
  const stampResult = await stampVersion(ctx);
  sections.push(stampResult);
  if (stampResult.skipped) {
    log.log(`  [2m] ${stampResult.name}: SKIPPED${stampResult.message ? ` (${stampResult.message})` : ""}`);
  } else {
    log.log(`  [2m] ${stampResult.name}: ${stampResult.message ?? ""}`);
  }

  // Sync manifest (devaudit-installer#930), deliberately last of all —
  // after consumer patches (2j) and formatting (2l) have both run, so it
  // hashes the *final* on-disk content a patch-carrying or reformatted
  // file actually has, not a pre-patch/pre-format snapshot that would read
  // as spuriously drifted on the next sync (closing the gap SRS-PATCH-084-
  // 001/002 flagged).
  if (!dryRun) {
    const nextManifest = await managed.finalize(CLI_VERSION, previousManifest);
    await writeManifest(repoRoot, nextManifest);
  }
  log.log(`  [2n] sync manifest: ${dryRun ? "SKIPPED (dry-run)" : "written to .devaudit/sync-manifest.json"}`);

  const conflictSummary = formatConflictSummary(managed.conflicts);
  if (conflictSummary) {
    sectionWarnings.push(conflictSummary);
  }

  log.log("");
  log.info(`  Total: ${total} files synced`);
  log.log("");
  log.log("  --- Validation ---");
  const validationWarnings = await runValidation(absPath);
  const warnings = [...sectionWarnings, ...validationWarnings];
  if (warnings.length === 0) {
    log.success("  All validation checks passed");
  } else {
    for (const w of warnings) log.warn(`  ${w}`);
  }
  log.log("");
  return {
    project: projectName,
    stack,
    host,
    sections,
    totalFilesSynced: total,
    warnings,
  };
}

export async function syncAll(
  projectPaths: readonly string[],
  options: SyncProjectOptions = {},
): Promise<readonly SyncReport[]> {
  const reports: SyncReport[] = [];
  for (const p of projectPaths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      reports.push(await syncProject(p, options));
    } catch (err) {
      const log = logger();
      log.error(
        `ERROR syncing ${p}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
  return reports;
}
