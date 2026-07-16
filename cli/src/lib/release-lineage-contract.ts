export const RELEASE_LINEAGE_CONTRACT_VERSION = '1.0.0' as const;
export const RELEASE_LINEAGE_SCHEMA_VERSION = 1 as const;

export const SDLC_STAGES = [1, 2, 3, 4, 5] as const;
export const CYCLE_ENVIRONMENTS = ['ci', 'uat', 'production'] as const;
export const CYCLE_KINDS = [
  'quality_gate',
  'e2e',
  'security',
  'evidence_compile',
  'uat',
  'deployment',
  'smoke',
] as const;
export const CYCLE_PROVIDERS = ['github_actions', 'manual'] as const;
export const CYCLE_OUTCOMES = [
  'running',
  'passed',
  'failed',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'unknown',
] as const;
export const TERMINAL_CYCLE_OUTCOMES = [
  'passed',
  'failed',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'unknown',
] as const;
export const EVIDENCE_SCOPES = ['release', 'stage', 'cycle', 'approval'] as const;

export type SdlcStageCode = (typeof SDLC_STAGES)[number];
export type CycleEnvironment = (typeof CYCLE_ENVIRONMENTS)[number];
export type CycleKind = (typeof CYCLE_KINDS)[number];
export type CycleProvider = (typeof CYCLE_PROVIDERS)[number];
export type CycleOutcome = (typeof CYCLE_OUTCOMES)[number];
export type TerminalCycleOutcome = (typeof TERMINAL_CYCLE_OUTCOMES)[number];
export type EvidenceScope = (typeof EVIDENCE_SCOPES)[number];

export const RELEASE_LINEAGE_IDEMPOTENCY_KEY_PATTERN =
  /^(github|manual):[A-Za-z0-9._/-]+:[A-Za-z0-9._/-]+:[A-Za-z0-9._:-]+:[A-Za-z0-9._:-]+:[A-Za-z0-9._:-]+:[A-Za-z0-9._-]+$/;

export interface TestCycleBasePayload {
  readonly schemaVersion: typeof RELEASE_LINEAGE_SCHEMA_VERSION;
  readonly idempotencyKey: string;
  readonly sourceRelease: string;
  readonly sdlcStage: SdlcStageCode;
  readonly environment: CycleEnvironment;
  readonly cycleKind: CycleKind;
  readonly provider: CycleProvider;
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

export interface TestCycleStartedPayload extends TestCycleBasePayload {
  readonly outcome: 'running';
}

export interface TestCycleTerminalPayload extends TestCycleBasePayload {
  readonly completedAt: string;
  readonly outcome: TerminalCycleOutcome;
  readonly outcomeReason?: string | null;
}

export interface EvidenceLineageFields {
  readonly evidenceScope?: EvidenceScope;
  readonly testCycleRecordId?: string;
  readonly testCycleId?: string;
}

export interface LineagePortalCapabilities {
  readonly supportsFirstClassCycleApi: boolean;
}

export function isValidReleaseLineageIdempotencyKey(value: string): boolean {
  return RELEASE_LINEAGE_IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function renderEvidenceLineageFields(
  input: EvidenceLineageFields,
  capabilities: LineagePortalCapabilities,
): EvidenceLineageFields {
  if (input.testCycleRecordId && input.evidenceScope !== 'cycle') {
    throw new Error('testCycleRecordId requires cycle evidenceScope');
  }
  if (!capabilities.supportsFirstClassCycleApi) {
    return input.testCycleId ? { testCycleId: input.testCycleId } : {};
  }

  return {
    ...(input.evidenceScope ? { evidenceScope: input.evidenceScope } : {}),
    ...(input.testCycleRecordId ? { testCycleRecordId: input.testCycleRecordId } : {}),
    ...(input.testCycleId ? { testCycleId: input.testCycleId } : {}),
  };
}

export function isCycleScopedEvidenceScope(scope: EvidenceScope | undefined): boolean {
  return scope === 'cycle';
}
