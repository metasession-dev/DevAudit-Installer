/**
 * @metasession.co/devaudit-core — the pure shared core.
 *
 * Everything under `src/` (outside `src/node/`) is pure: no `node:` imports and no terminal.
 * The CLI and the portal both consume it. Later work packages of DevAudit-Installer#1116 add
 * the gap model, presets, the question registry and the local scan here.
 */

/** Version of the core's public contract. Raised when an exported shape changes incompatibly. */
export const CORE_API_VERSION = '1' as const;

export {
  RepoPathError,
  baseName,
  isDirectory,
  isFile,
  joinRepoPath,
  listDirectoryNames,
  listFileNames,
  normalizeRepoPath,
  pathExists,
  readJson,
  readText,
  type RepoReader,
} from './repo-reader.js';

export {
  findingToGap,
  gapId,
  type ClauseState,
  type FindingInput,
  type FixTier,
  type Gap,
  type GapExplanation,
  type GapOption,
  type Remediation,
} from './gap.js';

export {
  CUSTOM_PRESET,
  MOMENTS,
  PRESETS,
  PRESET_CONFIG_KEYS,
  PRESET_IDS,
  SECOND_ADMIN_NOTE,
  SELF_APPROVAL_CLAUSES,
  SOLO_APPROVER_NOTE,
  offerPresets,
  suggestPreset,
  type ConfigValue,
  type OfferInput,
  type PortalApprovalPolicy,
  type Preset,
  type PresetId,
  type PresetOffer,
  type PresetOffers,
  type PresetSuggestion,
  type SoloApprover,
} from './presets.js';
export { renderPresetsMarkdown } from './presets-doc.js';
export {
  NOT_ASKED,
  QUESTIONS,
  askedConfigKeys,
  conditionHolds,
  questionById,
  questionsToAsk,
  type ConditionId,
  type ConditionState,
  type DefaultRule,
  type Question,
  type QuestionChoice,
  type QuestionDefault,
  type QuestionKind,
  type QuestionPart,
} from './registry.js';
export {
  SECRET_NAME_PATTERN,
  SLUG,
  VALIDATORS,
  VALIDATOR_IDS,
  isValidBranchName,
  validate,
  validateAll,
  type ValidationContext,
  type Validator,
  type ValidatorId,
} from './validators.js';

export * from './detect/index.js';
