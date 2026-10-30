import type { TestGroups } from './detect/facts.js';

/**
 * The onboarding presets as data (DevAudit-Installer#1116 section 4). `devaudit install`, `devaudit
 * configure`, `devaudit scan` and the portal all read this one table, and `docs/presets.md` is generated
 * from it, so the four never disagree.
 */

export type PresetId = 'A' | 'B' | 'C' | 'D';

/** The portal's project approval policy (`metasession-dev/devaudit#931`). */
export type PortalApprovalPolicy = 'independent' | 'self_allowed_with_gap';

/** Whether the portal allows a solo approver: yes, no, or unknown (a scan makes no portal call). */
export type SoloApprover = 'yes' | 'no' | 'unknown';

export type ConfigValue = string | number | boolean;

/** The five moments of a change's life that every table describes (section 3). */
export const MOMENTS = [
  { n: 1, name: 'Feature pull request opened', workflows: 'ci.yml Quality Gates (smoke is Gate 4); feature-e2e.yml' },
  { n: 2, name: 'Merged to the integration branch', workflows: 'ci.yml (push): the gates again, registers the release, uploads evidence' },
  { n: 3, name: 'Release pull request opened', workflows: 'check-release-approval.yml, compliance-validation.yml, e2e-regression.yml (pull_request)' },
  { n: 4, name: 'After approval and deploy', workflows: 'post-deploy-prod.yml; e2e-regression.yml (deployment_status); production review in the portal' },
  { n: 5, name: 'On a timer', workflows: 'e2e-regression.yml (schedule); periodic-review.yml (quarterly, always)' },
] as const;

export interface Preset {
  readonly id: PresetId;
  readonly name: string;
  /** Who it is for, in one sentence. */
  readonly summary: string;
  /** The configuration it writes, by dotted key. A key another preset writes but this one does not is removed on a switch. */
  readonly config: Readonly<Record<string, ConfigValue>>;
  readonly portalPolicy: PortalApprovalPolicy;
  /** What runs at each of the five moments. */
  readonly moments: readonly [string, string, string, string, string];
  /** The evidence it produces. */
  readonly evidence: string;
  /** The gap it carries. */
  readonly gap: string;
  /** The sentence the CLI shows for the gap. */
  readonly gapText: string;
  /** Registry clause IDs that show as not covered under this preset (a self-approval cannot satisfy them). */
  readonly controls: readonly string[];
  /** What it needs before it is offered. */
  readonly requires: { readonly soloApprover: boolean; readonly smokeTests: boolean; readonly fullPack: boolean };
  /** Shown next to the preset when it is offered. */
  readonly notes: readonly string[];
}

export const SOLO_APPROVER_NOTE = 'needs portal support for a solo approver';
export const SECOND_ADMIN_NOTE = 'needs a second portal admin';

const SELF_APPROVAL_GAP_TEXT =
  'You approve your own releases. DevAudit records this as a control gap for SOC 2 CC8.1 and ISO 27001 A.8.32; an auditor will ask for a compensating control.';

/** The clauses whose expectation a self-approval cannot satisfy (M2). */
export const SELF_APPROVAL_CLAUSES = ['SOC2.CC8.1', 'ISO27001.A.8.32'] as const;

export const PRESETS: Readonly<Record<PresetId, Preset>> = {
  A: {
    id: 'A',
    name: 'Solo, fast feedback',
    summary: 'One developer who approves their own releases and wants quick feedback, with the gap recorded.',
    config: {
      onboarding_preset: 'A',
      e2e_regression_enabled: false,
      'approval.mode': 'solo_with_gap',
      release_branch_required_reviews: 0,
      'production_review.terminal_status': 'released',
    },
    portalPolicy: 'self_allowed_with_gap',
    moments: [
      'Smoke tests run and block the merge; the feature tests report.',
      'Smoke tests run and block.',
      'Approval only; no regression run.',
      'Production evidence is collected and the release completes automatically.',
      'The quarterly review.',
    ],
    evidence: 'An approval record per release; smoke and feature results per change; the quarterly review.',
    gap: 'No segregation of duties; no full-regression evidence; no human production confirmation.',
    gapText: SELF_APPROVAL_GAP_TEXT,
    controls: SELF_APPROVAL_CLAUSES,
    requires: { soloApprover: true, smokeTests: false, fullPack: false },
    notes: [],
  },
  B: {
    id: 'B',
    name: 'Safety net',
    summary: 'A solo developer or small team that wants the important journeys tested before every release and the full pack run after it.',
    config: {
      onboarding_preset: 'B',
      e2e_regression_enabled: true,
      release_gate_tier: 'critical',
      post_deploy_full_regression: true,
      scheduled_full_regression: '0 2 * * *',
      'approval.mode': 'solo_with_gap',
      release_branch_required_reviews: 0,
      'production_review.terminal_status': 'prod_review',
    },
    portalPolicy: 'self_allowed_with_gap',
    moments: [
      'Smoke tests run and block the merge; the feature tests report.',
      'Smoke tests run and block.',
      'The critical tests run and block (smoke if there are no critical tests, and the summary says so); approval by the author.',
      'Production evidence; the full regression runs once (recorded, does not block); a person confirms production.',
      'The full regression runs nightly at 02:00 UTC on the integration branch (never blocks, not release evidence); the quarterly review.',
    ],
    evidence:
      'Preset A plus the critical results before every release, the full results per deploy and per night, and a human production confirmation.',
    gap: 'No segregation of duties; the full regression detects problems after release rather than preventing them.',
    gapText: SELF_APPROVAL_GAP_TEXT,
    controls: SELF_APPROVAL_CLAUSES,
    requires: { soloApprover: true, smokeTests: true, fullPack: false },
    notes: [],
  },
  C: {
    id: 'C',
    name: 'Team with a compliance lead',
    summary: 'A team where someone other than the author approves every release and the whole test pack is a gate.',
    config: {
      onboarding_preset: 'C',
      e2e_regression_enabled: true,
      release_gate_tier: 'full',
      post_deploy_full_regression: true,
      scheduled_full_regression: '0 2 * * *',
      'approval.mode': 'dual_actor',
      release_branch_required_reviews: 1,
      'production_review.terminal_status': 'prod_review',
    },
    portalPolicy: 'independent',
    moments: [
      'Smoke tests run and block the merge; the feature tests report.',
      'Smoke tests run and block.',
      'The full regression runs and blocks; approval by a different person.',
      'Production evidence; the full regression runs once more (recorded, does not block); a person confirms production.',
      'The full regression runs nightly at 02:00 UTC on the integration branch (never blocks, not release evidence); the quarterly review.',
    ],
    evidence:
      'An approver who differs from the creator (enforced); a full green regression attached before approval; two human production events; a continuous history.',
    gap: 'How long evidence is kept is a portal setting; a passing test pack does not prove the right tests exist (acceptance-criteria coverage, the `test-tiers` check).',
    gapText:
      'A passing test pack does not prove the right tests exist (`devaudit doctor` reports acceptance-criteria coverage), and how long evidence is kept is a portal setting.',
    controls: [],
    requires: { soloApprover: false, smokeTests: false, fullPack: true },
    notes: [SECOND_ADMIN_NOTE],
  },
  D: {
    id: 'D',
    name: 'Full gate, tested once',
    summary: 'The same team as C, with the full pack run once, before merge, and not again after the deploy.',
    config: {
      onboarding_preset: 'D',
      e2e_regression_enabled: true,
      release_gate_tier: 'full',
      post_deploy_full_regression: false,
      scheduled_full_regression: '0 2 * * *',
      'approval.mode': 'dual_actor',
      release_branch_required_reviews: 1,
      'production_review.terminal_status': 'prod_review',
    },
    portalPolicy: 'independent',
    moments: [
      'Smoke tests run and block the merge; the feature tests report.',
      'Smoke tests run and block.',
      'The full regression runs and blocks; approval by a different person.',
      'Production evidence; a person confirms production. No full regression after deploy: the full pack already ran on this commit before the merge.',
      'The full regression runs nightly at 02:00 UTC on the integration branch (never blocks, not release evidence); the quarterly review.',
    ],
    evidence: 'As preset C, without the full regression recorded after the deploy.',
    gap: 'As preset C; and the full pack is not run again after the deploy, so a problem that appears only in the deployed environment is found by production evidence and the quarterly review, not by the full pack.',
    gapText:
      'The full regression runs once, before merge. DevAudit does not run it again after the deploy, so a problem that appears only in the deployed environment is found by production evidence and the quarterly review, not by the full pack.',
    controls: [],
    requires: { soloApprover: false, smokeTests: false, fullPack: true },
    notes: [SECOND_ADMIN_NOTE],
  },
};

export const PRESET_IDS: readonly PresetId[] = ['A', 'B', 'C', 'D'];

/** Every configuration key any preset writes. A key a preset does not write is removed when switching to it. */
export const PRESET_CONFIG_KEYS: readonly string[] = [...new Set(PRESET_IDS.flatMap((id) => Object.keys(PRESETS[id].config)))];

/** `custom`: no preset applied; the detailed questions. Always offered. */
export const CUSTOM_PRESET = {
  id: 'custom',
  name: 'Custom',
  summary: 'You choose each setting yourself. This is also the path when no preset can be offered.',
} as const;

// ---- which presets are offered ---------------------------------------------------------------------------

export interface PresetOffer {
  readonly offered: boolean;
  /** Why it is not offered (plain words); absent when it is. */
  readonly reason?: string;
  /** A note to show next to an offered preset. */
  readonly note?: string;
}

export type PresetOffers = Readonly<Record<PresetId, PresetOffer>>;

const NO_SOLO_REASON = 'this portal does not yet allow a solo approver; ask its operator to upgrade';

export interface OfferInput {
  readonly testGroups: TestGroups;
  readonly soloApprover: SoloApprover;
}

/**
 * Which presets can be offered: A needs a portal that allows a solo approver; B needs that and smoke
 * tests (critical tests are optional); C and D need a full test pack, and are shown with "needs a
 * second portal admin". With `soloApprover: 'unknown'` (a scan) A and B are offered with a note.
 */
export function offerPresets(input: OfferInput): PresetOffers {
  const solo = input.soloApprover;
  const soloNote = solo === 'unknown' ? SOLO_APPROVER_NOTE : undefined;
  const make = (offered: boolean, reason: string | undefined, note: string | undefined): PresetOffer => ({
    offered,
    ...(!offered && reason ? { reason } : {}),
    ...(offered && note ? { note } : {}),
  });
  const fullPack = input.testGroups.full;
  return {
    A: make(solo !== 'no', NO_SOLO_REASON, soloNote),
    B: make(
      solo !== 'no' && input.testGroups.smoke,
      solo === 'no' ? NO_SOLO_REASON : 'it needs smoke tests and none were found',
      soloNote,
    ),
    C: make(fullPack, 'it needs a full test pack and none was found', SECOND_ADMIN_NOTE),
    D: make(fullPack, 'it needs a full test pack and none was found', SECOND_ADMIN_NOTE),
  };
}

// ---- the suggestion rule ---------------------------------------------------------------------------------

export interface PresetSuggestion {
  /** A preset id, or `custom` when none can be offered. Never `D`: it is offered, not suggested. */
  readonly preset: PresetId | 'custom';
  /** One sentence naming the inputs of the rule. */
  readonly reason: string;
  /** A note to show with the suggestion (for example that a solo approver needs portal support). */
  readonly note?: string;
  readonly offers: PresetOffers;
}

const COMPLIANCE_TRIGGERS = ['soc-2', 'iso-27001'] as const;
const LADDER: readonly PresetId[] = ['C', 'B', 'A'];

/**
 * The preset to suggest, by the one rule that scan, install and doctor share. Only a preset that is
 * offered can be suggested: when the rule names one that is not, the next one down the ladder (C, B, A)
 * that is offered is suggested instead, and when none is, `custom`.
 */
export function suggestPreset(
  facts: { readonly testGroups: TestGroups },
  frameworks: readonly string[],
  soloApprover: SoloApprover,
): PresetSuggestion {
  const offers = offerPresets({ testGroups: facts.testGroups, soloApprover });
  const { smoke, critical, full } = facts.testGroups;
  const needsEvidence = frameworks.some((f) => (COMPLIANCE_TRIGGERS as readonly string[]).includes(f));

  let wanted: PresetId;
  let reason: string;
  if (!smoke) {
    wanted = 'A';
    reason = 'No smoke tests were found, so only preset A fits.';
  } else if (needsEvidence && full) {
    wanted = 'C';
    reason = 'You need evidence for SOC 2 or ISO 27001 and a full test pack exists, so preset C fits.';
  } else if (needsEvidence) {
    wanted = 'B';
    reason = 'You need evidence for SOC 2 or ISO 27001 but no full test pack exists (C needs a full test pack), so preset B fits.';
  } else if (critical || full) {
    wanted = 'B';
    reason = full ? 'A full test pack exists, so preset B fits.' : 'Critical tests exist, so preset B fits.';
  } else {
    wanted = 'A';
    reason = 'Only smoke tests were found, so preset A fits.';
  }

  const start = LADDER.indexOf(wanted);
  const chosen = LADDER.slice(start).find((id) => offers[id].offered);
  if (chosen === undefined) {
    const why = LADDER.slice(start).map((id) => offers[id].reason).find((r): r is string => r !== undefined) ?? NO_SOLO_REASON;
    return {
      preset: 'custom',
      reason: `${reason.replace(/ fits\.$/, ' would fit')}, but no preset can be offered: ${why}. Choose custom to set each setting yourself.`,
      offers,
    };
  }
  let finalReason = reason;
  if (chosen !== wanted) {
    finalReason = `${reason.replace(/ fits\.$/, ' would fit')}, but it cannot be offered (${offers[wanted].reason ?? NO_SOLO_REASON}), so preset ${chosen} is suggested instead.`;
  }
  if (chosen === 'C' && offers.D.offered) finalReason += ' D is the same without the full regression after deploy.';
  const note = offers[chosen].note;
  return { preset: chosen, reason: finalReason, ...(note ? { note } : {}), offers };
}
