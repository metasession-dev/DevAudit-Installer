export type StepStatus = 'ok' | 'warn' | 'skipped' | 'fail' | 'planned';

export interface StepResult {
  readonly step: string;
  readonly status: StepStatus;
  readonly message?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface InstallContext {
  readonly projectPath: string;
  readonly projectName: string;
  readonly installerRoot: string;
  readonly token: string;
  readonly baseUrl: string;
  readonly dryRun: boolean;
  readonly nonInteractive: boolean;
}

export interface InstallPlan {
  stack: 'node' | 'python';
  host: 'railway';
  projectSlug: string;
  runtimeVersion: string;
  sourceDirs: string;
  workingDirectory: string;
  prodUrlSecretName: string;
  prodUrlValue: string;
  projectId?: string;
  apiKey?: string;
}

export interface DetectedStack {
  readonly stack: 'node' | 'python';
  readonly workingDirectory: string;
}
