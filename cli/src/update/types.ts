export interface SyncContext {
  readonly installerRoot: string;
  readonly projectPath: string;
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
}

export interface SyncReport {
  readonly project: string;
  readonly stack: string;
  readonly host: string;
  readonly sections: readonly SectionResult[];
  readonly totalFilesSynced: number;
  readonly warnings: readonly string[];
}
