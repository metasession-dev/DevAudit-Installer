export const RELEASE_LINEAGE_CONTRACT_VERSION = '1.0.0' as const;
export const RELEASE_LINEAGE_SCHEMA_VERSION = 1 as const;

export const SDLC_STAGES = [1, 2, 3, 4, 5] as const;
export const EXECUTION_ENVIRONMENTS = ['ci', 'uat', 'production'] as const;
export const SUITE_KINDS = [
  'quality_gate',
  'e2e',
  'security',
  'evidence_compile',
  'uat',
  'deployment',
  'smoke',
] as const;
export const EXECUTION_PROVIDERS = ['github_actions', 'manual', 'manual_uat'] as const;
export const EXECUTION_OUTCOMES = [
  'running',
  'passed',
  'failed',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'unknown',
] as const;
export const TERMINAL_EXECUTION_OUTCOMES = [
  'passed',
  'failed',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'unknown',
] as const;
export const EVIDENCE_SCOPES = ['release', 'stage', 'execution', 'approval'] as const;

export type SdlcStageCode = (typeof SDLC_STAGES)[number];
export type ExecutionEnvironment = (typeof EXECUTION_ENVIRONMENTS)[number];
export type SuiteKind = (typeof SUITE_KINDS)[number];
export type ExecutionProvider = (typeof EXECUTION_PROVIDERS)[number];
export type ExecutionOutcome = (typeof EXECUTION_OUTCOMES)[number];
export type TerminalExecutionOutcome = (typeof TERMINAL_EXECUTION_OUTCOMES)[number];
export type EvidenceScope = (typeof EVIDENCE_SCOPES)[number];

export const RELEASE_LINEAGE_IDEMPOTENCY_KEY_PATTERN =
  /^(github|manual):[A-Za-z0-9._/-]+:[A-Za-z0-9._/-]+:[A-Za-z0-9._:-]+:[A-Za-z0-9._:-]+:[A-Za-z0-9._:-]+:[A-Za-z0-9._-]+$/;

export interface TestExecutionBasePayload {
  readonly schemaVersion: typeof RELEASE_LINEAGE_SCHEMA_VERSION;
  readonly idempotencyKey: string;
  readonly sourceRelease: string;
  readonly sdlcStage: SdlcStageCode;
  readonly environment: ExecutionEnvironment;
  readonly suiteKind: SuiteKind;
  readonly iterationKey?: string | null;
  readonly iterationOrdinal?: number | null;
  readonly provider: ExecutionProvider;
  readonly externalRunId?: string | null;
  readonly externalRunAttempt?: number | null;
  readonly externalJobId?: string | null;
  readonly commitSha?: string | null;
  readonly branch?: string | null;
  readonly startedAt: string;
  readonly workflowName?: string | null;
  readonly workflowUrl?: string | null;
  readonly incidentReference?: string | null;
}

export interface TestExecutionStartedPayload extends TestExecutionBasePayload {
  readonly outcome: 'running';
}

export interface TestExecutionTerminalPayload extends TestExecutionBasePayload {
  readonly completedAt: string;
  readonly outcome: TerminalExecutionOutcome;
  readonly outcomeReason?: string | null;
}

export interface EvidenceLineageFields {
  readonly evidenceScope?: EvidenceScope;
  readonly testExecutionRecordId?: string;
  readonly testExecutionId?: string;
}

export interface LineagePortalCapabilities {
  readonly supportsFirstClassTestExecutionApi: boolean;
}

export function isValidReleaseLineageIdempotencyKey(value: string): boolean {
  return RELEASE_LINEAGE_IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function renderEvidenceLineageFields(
  input: EvidenceLineageFields,
  _capabilities: LineagePortalCapabilities,
): EvidenceLineageFields {
  if (input.testExecutionRecordId && input.evidenceScope !== 'execution') {
    throw new Error('testExecutionRecordId requires execution evidenceScope');
  }

  return {
    ...(input.evidenceScope ? { evidenceScope: input.evidenceScope } : {}),
    ...(input.testExecutionRecordId ? { testExecutionRecordId: input.testExecutionRecordId } : {}),
    ...(input.testExecutionId ? { testExecutionId: input.testExecutionId } : {}),
  };
}

export function isExecutionScopedEvidenceScope(scope: EvidenceScope | undefined): boolean {
  return scope === 'execution';
}
