import type { ClauseState, Gap } from '../gap.js';
import type { DetectedFacts } from '../detect/index.js';
import type { RepoReader } from '../repo-reader.js';

/**
 * The scan (DevAudit-Installer#1116 section 6): the shapes of a registry file (`contracts/frameworks/`),
 * what the local evaluation needs, and the report. Pure: no `node:` imports.
 */

// ---- the registry (see docs/framework-registry.md) ---------------------------------------------------------

export type Expectation =
  | { readonly kind: 'evidence_type_any'; readonly types: readonly string[]; readonly freshnessDays?: number; readonly description: string }
  | { readonly kind: 'evidence_filename_any'; readonly fileNames: readonly string[]; readonly freshnessDays?: number; readonly description: string }
  | { readonly kind: 'audit_event_any'; readonly eventTypes: readonly string[]; readonly description: string }
  | { readonly kind: 'requirement_meta'; readonly riskClass: string; readonly description: string }
  | { readonly kind: 'portal_invariant'; readonly description: string }
  | { readonly kind: 'any_of'; readonly expectations: readonly Expectation[]; readonly description: string }
  | { readonly kind: 'evidence_category_any'; readonly categories: readonly string[]; readonly description: string }
  | { readonly kind: 'requirement_any'; readonly ids: readonly string[]; readonly description: string }
  | { readonly kind: 'manual_attestation'; readonly description: string };

export interface ClauseDefinition {
  readonly id: string;
  readonly title: string;
  readonly idEdition?: string;
  readonly note?: string;
  readonly equivalents2022?: readonly string[];
  readonly expects: readonly Expectation[];
}

export interface FrameworkFile {
  readonly registryVersion: string;
  readonly code: string;
  readonly name: string;
  readonly longName: string;
  readonly edition: string;
  readonly clauses: readonly ClauseDefinition[];
}

// ---- evaluation -----------------------------------------------------------------------------------------------

export interface ScanContext {
  readonly reader: RepoReader;
  /** Evidence types the repository's workflows upload, with the workflow files that do. */
  readonly uploadedTypes: ReadonlyMap<string, readonly string[]>;
  /** The category of an evidence type (from `contracts/evidence-types.json`), for `evidence_category_any`. */
  readonly categoryOf?: (type: string) => string | undefined;
  /** The contents of the starter templates bundled for a file name; a file equal to one is an unmodified stub. */
  readonly starterTemplates?: (fileName: string) => Promise<readonly string[]>;
  readonly now?: Date;
}

export interface ExpectationResult {
  readonly state: ClauseState;
  readonly reason: string;
  readonly paths: string[];
}

export interface ClauseResult {
  readonly id: string;
  readonly state: ClauseState;
  readonly reason: string;
  readonly paths: string[];
}

export interface FrameworkResult {
  readonly code: string;
  readonly clauses: ClauseResult[];
}

// ---- the report (contracts/scan-report.schema.json) -----------------------------------------------------------

export interface ScanReport {
  readonly scanVersion: '1';
  readonly registryVersion: string;
  readonly facts: DetectedFacts;
  readonly frameworks: FrameworkResult[];
  readonly suggestedPreset: 'A' | 'B' | 'C' | 'custom';
  readonly suggestionReason: string;
  readonly gaps: Gap[];
}
