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
}

export interface SyncReport {
  readonly project: string;
  readonly stack: string;
  readonly host: string;
  readonly sections: readonly SectionResult[];
  readonly totalFilesSynced: number;
  readonly warnings: readonly string[];
}
