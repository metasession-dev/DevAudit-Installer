export interface SyncContext {
  readonly installerRoot: string;
  readonly projectPath: string;
  /**
   * The git repository's top-level directory — see the matching field on
   * `InstallContext` (`install/types.ts`) for why sections that write
   * `.github/`, `.husky`, `.pre-commit-config.yaml`, or `.devin/workflows`
   * must use this instead of `projectPath` (#689 follow-up).
   */
  readonly repoRoot: string;
  readonly projectName: string;
  readonly stack: string;
  readonly host: string;
}

export interface SectionResult {
  readonly name: string;
  readonly filesSynced: number;
  readonly message?: string;
  readonly skipped?: boolean;
  readonly warning?: string;
  /**
   * Absolute paths of files this section wrote into the consumer project.
   * Only populated by sections that write discrete, individually-trackable
   * files (not bulk directory copies). Consumed by the post-sync formatter
   * normalization step (DevAudit-Installer#663) to know what to re-format.
   */
  readonly filePaths?: readonly string[];
  /**
   * Files this section is about to overwrite, captured *before* the
   * overwrite, for the drift-warning check (DevAudit-Installer#758) to
   * re-evaluate *after* the formatter normalization step (#663) has run.
   * The drift check can't decide "real drift vs. cosmetic" at write time:
   * a previously-committed file is normally already prettier-formatted
   * (from the consumer's own commit-time hook, or a prior sync's own
   * formatter pass), while the content this section is about to write is
   * not yet formatted — comparing them directly flags formatting-only
   * differences as drift (DevAudit-Installer#766). Deferring the
   * comparison until after formatSyncedFiles has normalized the newly
   * written files fixes that false-positive class without needing the
   * drift check itself to know how to invoke the consumer's formatter.
   */
  readonly driftCandidates?: ReadonlyArray<{
    readonly outputPath: string;
    readonly oldContent: string;
  }>;
}

export interface SyncReport {
  readonly project: string;
  readonly stack: string;
  readonly host: string;
  readonly sections: readonly SectionResult[];
  readonly totalFilesSynced: number;
  readonly warnings: readonly string[];
}
