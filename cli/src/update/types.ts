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
  /**
   * Sync-manifest classification state for this run (devaudit-installer#930)
   * — every writing section routes through `writeManaged`/`removeManaged`
   * against this instead of writing directly, so a local edit is detected
   * and preserved rather than silently overwritten. Optional only so
   * existing unit tests that construct a bare `SyncContext` by hand don't
   * all need updating; `syncProject` always populates it.
   */
  readonly managed?: import('./write-managed.js').ManagedSyncState;
  /** Preview mode: classify and report, write nothing (devaudit-installer#930). */
  readonly dryRun?: boolean;
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
}

export interface SyncReport {
  readonly project: string;
  readonly stack: string;
  readonly host: string;
  readonly sections: readonly SectionResult[];
  readonly totalFilesSynced: number;
  readonly warnings: readonly string[];
}
