import {
  conditionHolds,
  CUSTOM_PRESET,
  PRESETS,
  PRESET_CONFIG_KEYS,
  PRESET_IDS,
  detectFacts,
  listDirectoryNames,
  offerPresets,
  suggestPreset,
  validateAll,
  questionById,
  questionsToAsk,
  type ConditionState,
  type DetectedFacts,
  type PortalApprovalPolicy,
  type PresetId,
  type RepoReader,
  type ValidationContext,
} from '@metasession.co/devaudit-core';
import { COMPLIANCE_FRAMEWORK_CODES } from '../lib/repo-config-keys.js';
import { soloApproverFrom, type PolicyRead, type StandardsRead } from '../lib/onboarding-portal.js';
import type { Asker } from './test-config.js';
import { InstallRefusal } from './refusal.js';
import { ONE_COLLABORATOR_WARNING } from '../lib/collaborators.js';

/**
 * DevAudit-Installer#1116 WP6 — the guided half of `devaudit install`.
 *
 * It detects what it can, suggests a preset, shows an express summary (one line per setting, generated
 * from the preset and the question registry in `@metasession.co/devaudit-core`, so the words are the
 * same everywhere), and lets the person accept it, change one thing, or answer every question. Nothing
 * is written here: the result is a plan the install steps carry out.
 */

export type PresetChoice = PresetId | 'custom';

export interface GuidedAsker extends Asker {
  multiselect(message: string, options: ReadonlyArray<{ value: string; label: string; hint?: string }>, initial: readonly string[]): Promise<string[]>;
}

/** What the person sees before the questions, and what the install steps need afterwards. */
export interface GuidedBasics {
  host: string;
  projectSlug: string;
  runtimeVersion: string;
  sourceDirs: string;
  workingDirectory: string;
  prodUrlSecretName: string;
  prodUrlValue: string;
}

export interface GuidedInput {
  readonly basics: GuidedBasics;
  readonly stack: 'node' | 'python';
  readonly existing: Record<string, unknown> | null;
  /** Config keys named by flags: they override preset values and are never asked. */
  readonly flagConfig: Readonly<Record<string, unknown>>;
  readonly hosts: readonly string[];
  /** `--host`: when set, the host is not asked. */
  readonly hostFlag?: string | undefined;
  /** `--preset`: when set, the preset is not asked. */
  readonly presetFlag?: PresetChoice | undefined;
  readonly reader: RepoReader;
  readonly policy: PolicyRead;
  readonly standards: StandardsRead;
  /** A preset suggested by a scan report (`--from-scan`); used only when it can be offered. */
  readonly scanPreset?: PresetChoice | undefined;
  readonly scanFrameworks?: readonly string[] | undefined;
  readonly ask: GuidedAsker;
  readonly say: (line: string) => void;
  /** How many people can push to the repository (null when unknown); used for the one-collaborator warning. */
  readonly collaborators?: (() => Promise<number | null>) | undefined;
}

export interface GuidedResult {
  readonly basics: GuidedBasics;
  /** Dotted config keys to write on top of the existing config. */
  readonly config: Record<string, unknown>;
  /** Dotted config keys of other presets to remove. */
  readonly removeKeys: string[];
  /** The preset recorded as `onboarding_preset`; null when none was chosen (the config was kept). */
  readonly preset: PresetChoice | null;
  /** The approval policy to set on the portal (tier B), when it differs from what the portal reports. */
  readonly policyToSet: PortalApprovalPolicy | null;
  readonly frameworks: string[];
  readonly runnerLabel?: string;
  readonly notes: string[];
}

interface State {
  basics: GuidedBasics;
  cfg: Record<string, unknown>;
  preset: PresetChoice | null;
  frameworks: string[];
  runnerLabel: string | undefined;
  runnerKind: 'github' | 'self-hosted';
  testsExist: boolean;
  dataIsolation: string | undefined;
  notes: string[];
}

/**
 * Q9's GitHub choice. The generated workflows use any `runner` other than `self-hosted` as a literal `runs-on:` label, so this
 * must be a label GitHub provides. (`github-ci` is a value of the `CI_RUNNER_LABEL` variable, not a label.)
 */
const GITHUB_RUNNER = 'ubuntu-latest';
const GITHUB_HOSTED_LABEL = /^(ubuntu|windows|macos)-/;

/** Whether an existing `runner` value means GitHub's machines: a GitHub-hosted label, or the logical name `github-ci`. `self-hosted` and any other label are our own machines. */
export function runnerMeansGithub(runner: unknown): boolean {
  return typeof runner === 'string' && (runner === 'github-ci' || GITHUB_HOSTED_LABEL.test(runner));
}
const SOLO_POLICY: PortalApprovalPolicy = 'self_allowed_with_gap';

const FRAMEWORK_LABELS: Readonly<Record<string, string>> = {
  'soc-2': 'SOC 2',
  'iso-27001': 'ISO 27001',
  'iso-29119': 'ISO 29119',
  gdpr: 'GDPR',
  'eu-ai-act': 'EU AI Act',
};

const CRON_LABEL = (cron: unknown): string => {
  if (typeof cron !== 'string' || cron === '') return 'off';
  const m = /^0 (\d{1,2}) \* \* \*$/.exec(cron);
  return m ? `${m[1]!.padStart(2, '0')}:00 UTC every night` : `${cron} (cron)`;
};

const TIER_LABEL: Readonly<Record<string, string>> = {
  none: 'no end-to-end gate on the release pull request',
  smoke: 'the smoke tests must pass',
  critical: 'the critical tests must pass',
  full: 'the full regression must pass',
};

/** The preset ids as the `--preset` flag spells them. */
export function parsePresetFlag(value: string): PresetChoice | null {
  const v = value.trim();
  if (v === 'custom') return 'custom';
  return (PRESET_IDS as readonly string[]).includes(v.toUpperCase()) && v.length === 1 ? (v.toUpperCase() as PresetId) : null;
}

/** The config a preset writes, with the values flags named laid over it. */
export function presetConfig(preset: PresetId, flagConfig: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { ...PRESETS[preset].config, ...flagConfig };
}

/** Keys another preset writes that this configuration does not: they are removed so a switch leaves no leftovers. */
export function leftoverPresetKeys(config: Readonly<Record<string, unknown>>, existing: Readonly<Record<string, unknown>> | null): string[] {
  return PRESET_CONFIG_KEYS.filter((k) => !(k in config) && hasPath(existing, k));
}

function hasPath(obj: Readonly<Record<string, unknown>> | null, path: string): boolean {
  if (obj === null) return false;
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(part in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return true;
}

/** `custom` when the final configuration departs from the preset's own values. */
export function effectivePreset(preset: PresetChoice, cfg: Readonly<Record<string, unknown>>): PresetChoice {
  if (preset === 'custom') return 'custom';
  for (const [key, value] of Object.entries(PRESETS[preset].config)) {
    if (key === 'onboarding_preset') continue;
    if (cfg[key] !== value) return 'custom';
  }
  return preset;
}

/** The compliance line: recomputed from the approval mode and the standards after every change. */
export function complianceLine(cfg: Readonly<Record<string, unknown>>, frameworks: readonly string[]): string {
  const solo = cfg['approval.mode'] === 'solo_with_gap';
  const needsEvidence = frameworks.some((f) => f === 'soc-2' || f === 'iso-27001');
  if (!solo) return 'No control gap from these choices: the approver differs from the author. `devaudit doctor` checks the rest.';
  const names = 'SOC 2 CC8.1 and ISO 27001 A.8.32';
  return needsEvidence
    ? `You approve your own releases, and you need evidence for SOC 2 or ISO 27001: ${names} show as not covered, and an auditor will ask for a compensating control.`
    : `You approve your own releases. DevAudit records this as a control gap for ${names}; an auditor will ask for a compensating control.`;
}

function summaryLines(s: State, facts: DetectedFacts): Array<{ id: string; label: string; value: string }> {
  const cfg = s.cfg;
  const lines: Array<{ id: string; label: string; value: string }> = [];
  lines.push({ id: 'Q1', label: 'Production runs on', value: s.basics.host });
  lines.push({ id: 'Q2', label: 'Production address', value: s.basics.prodUrlValue === '' ? 'not yet (the post-deploy check is skipped until you set it)' : s.basics.prodUrlValue });
  const groups = ['smoke', 'critical', 'full'].filter((g) => facts.testGroups[g as 'smoke']);
  lines.push({ id: 'Q4', label: 'Tests', value: s.testsExist ? `${groups.length > 0 ? groups.join(', ') : 'found'} (${cfg['test_runner'] === 'pytest' ? 'pytest' : 'Playwright'})` : 'none yet' });
  if (s.testsExist) {
    const tier = typeof cfg['release_gate_tier'] === 'string' ? cfg['release_gate_tier'] : cfg['e2e_regression_enabled'] === true ? 'critical' : 'none';
    lines.push({ id: 'Q8', label: 'Before a release', value: TIER_LABEL[tier] ?? tier });
    lines.push({ id: 'Q8', label: 'After a deploy', value: cfg['e2e_regression_enabled'] === true && cfg['post_deploy_full_regression'] !== false ? 'the full regression runs once (recorded, never blocks)' : 'nothing runs' });
    lines.push({ id: 'Q8', label: 'Every night', value: CRON_LABEL(cfg['scheduled_full_regression']) });
  }
  lines.push({ id: 'Q9', label: 'Tests and builds run on', value: s.runnerKind === 'github' ? "GitHub's machines" : `our own machines (runner label ${s.runnerLabel ?? 'not set'})` });
  lines.push({ id: 'Q11', label: 'A release is approved by', value: cfg['approval.mode'] === 'solo_with_gap' ? 'you, with the gap recorded' : 'a different person' });
  lines.push({ id: 'Q12', label: 'After a deploy a person confirms production', value: cfg['production_review.terminal_status'] === 'released' ? 'no (automatic)' : 'yes (two recorded clicks)' });
  lines.push({ id: 'Q13', label: 'Standards', value: s.frameworks.length === 0 ? 'none yet' : s.frameworks.map((f) => FRAMEWORK_LABELS[f] ?? f).join(', ') });
  if (s.testsExist && s.dataIsolation !== undefined) lines.push({ id: 'Q18', label: 'Test data', value: s.dataIsolation });
  return lines;
}

function conditionState(s: State): ConditionState {
  return { testsExist: s.testsExist, dataIsolation: s.dataIsolation, preset: s.preset ?? undefined };
}

export async function runGuided(input: GuidedInput): Promise<GuidedResult> {
  const { ask, say } = input;
  const facts = await detectFacts(input.reader);
  const solo = soloApproverFrom(input.policy);
  const existingPreset = typeof input.existing?.['onboarding_preset'] === 'string' ? (input.existing['onboarding_preset'] as string) : null;
  const existingFrameworks = Array.isArray(input.existing?.['compliance_frameworks']) ? (input.existing!['compliance_frameworks'] as string[]) : null;
  const portalCodes = input.standards.status === 'ok' ? input.standards.codes : null;
  const dirs = (await listDirectoryNames(input.reader, '')).map((d) => d.replace(/\/$/, ''));
  const vctx: ValidationContext = { existingDirs: ['.', ...dirs], hosts: input.hosts, testGroups: facts.testGroups };

  const s: State = {
    basics: { ...input.basics },
    cfg: {},
    preset: null,
    frameworks: [...(input.scanFrameworks ?? existingFrameworks ?? portalCodes ?? [])],
    runnerLabel: undefined,
    runnerKind: input.existing?.['runner'] === undefined ? (facts.runner === 'self-hosted' ? 'self-hosted' : 'github') : runnerMeansGithub(input.existing['runner']) ? 'github' : 'self-hosted',
    testsExist: facts.testRunner !== null,
    dataIsolation: typeof input.existing?.['e2e_data_isolation'] === 'string' ? (input.existing['e2e_data_isolation'] as string) : undefined,
    notes: [],
  };
  if (facts.host !== null && input.existing?.['host'] === undefined && input.basics.host === 'railway') s.basics.host = facts.host;

  const chooseFreshPreset = async (): Promise<void> => {
    const suggestion = suggestPreset({ testGroups: s.testsExist ? facts.testGroups : { smoke: false, critical: false, full: false } }, s.frameworks, solo);
    const offers = offerPresets({ testGroups: s.testsExist ? facts.testGroups : { smoke: false, critical: false, full: false }, soloApprover: solo });
    let flagUsed = false;
    for (;;) {
      say('');
      say(`Suggested: ${suggestion.preset === 'custom' ? CUSTOM_PRESET.name : `preset ${suggestion.preset} (${PRESETS[suggestion.preset].name})`}. ${suggestion.reason}`);
      if (suggestion.note) say(`Note: ${suggestion.note}.`);
      const options: Array<{ value: string; label: string; hint?: string }> = [];
      if (input.existing !== null && existingPreset === null) {
        options.push({ value: 'keep', label: 'Keep my current settings', hint: 'applies no preset and changes no policy' });
      }
      for (const id of PRESET_IDS) {
        const offer = offers[id];
        if (!offer.offered) {
          say(`Preset ${id} (${PRESETS[id].name}) is not available: ${offer.reason}.`);
          continue;
        }
        const hint = id === 'D' ? 'the same as C, but the full pack is not run again after the deploy' : PRESETS[id].summary;
        options.push({ value: id, label: `${id} — ${PRESETS[id].name}`, hint: offer.note ? `${hint} (${offer.note})` : hint });
      }
      options.push({ value: 'custom', label: CUSTOM_PRESET.name, hint: CUSTOM_PRESET.summary });
      const current = existingPreset !== null && options.some((o) => o.value === existingPreset) ? existingPreset : null;
      const initial = input.existing !== null && existingPreset === null ? 'keep' : current !== null && current !== 'custom' ? current : input.scanPreset !== undefined && options.some((o) => o.value === input.scanPreset) ? input.scanPreset : suggestion.preset;
      let chosen: string;
      if (input.presetFlag !== undefined && !flagUsed) {
        flagUsed = true;
        chosen = input.presetFlag;
        if (chosen !== 'custom' && !offers[chosen as PresetId].offered) {
          throw new InstallRefusal(`Preset ${chosen} cannot be used here: ${offers[chosen as PresetId].reason}.`);
        }
      } else {
        chosen = await ask.select('Which preset fits?', options, initial);
      }
      if (chosen === 'keep') {
        s.preset = null;
        s.cfg = {};
        return;
      }
      if (chosen === 'custom') {
        s.preset = 'custom';
        s.cfg = { ...input.flagConfig };
        return;
      }
      const preset = chosen as PresetId;
      const wantsSolo = PRESETS[preset].portalPolicy === SOLO_POLICY;
      const currentPolicy = input.policy.status === 'ok' ? input.policy.policy : null;
      if (wantsSolo && currentPolicy !== SOLO_POLICY) {
        say(`Preset ${preset} means you approve your own releases. The portal must allow that for this project, so install will set the project's approval policy to "self-approval with a recorded gap". Setting it needs a project admin.`);
        if (!(await ask.confirm('Allow that?', true))) continue;
      }
      s.preset = preset;
      s.cfg = presetConfig(preset, input.flagConfig);
      return;
    }
  };

  await chooseFreshPreset();
  if (s.preset !== null) say(`Using preset ${s.preset === 'custom' ? 'custom' : `${s.preset} (${PRESETS[s.preset].name})`}.`);

  // ---- per-question handlers ------------------------------------------------------------------------------

  const text = async (_id: string, message: string, initial: string, validators: Parameters<typeof validateAll>[0], blankOk = false): Promise<string> => {
    const answer = (await ask.text(message, initial, (v) => (blankOk && v.trim() === '' ? undefined : validateAll(validators, v.trim(), vctx) ?? undefined))).trim();
    return answer;
  };

  const handlers: Record<string, () => Promise<void>> = {
    Q0a: async () => {
      s.basics.projectSlug = await text('Q0a', questionById('Q0a')!.prompt, s.basics.projectSlug, ['slug']);
    },
    Q0b: async () => {
      s.basics.runtimeVersion = await text('Q0b', input.stack === 'node' ? 'Node version' : 'Python version', s.basics.runtimeVersion, ['nonEmpty']);
    },
    Q0c: async () => {
      s.basics.workingDirectory = (await text('Q0c', 'Working directory (blank = root)', s.basics.workingDirectory, ['existingDir'], true)) || '.';
    },
    Q1: async () => {
      if (input.hostFlag !== undefined) return;
      const hosts = [...input.hosts].sort();
      s.basics.host = await ask.select(questionById('Q1')!.prompt, hosts.map((h) => ({ value: h, label: h })), hosts.includes(s.basics.host) ? s.basics.host : hosts[0]!);
    },
    Q2: async () => {
      s.basics.prodUrlValue = await text('Q2', `${questionById('Q2')!.prompt} (blank = not yet)`, s.basics.prodUrlValue, ['httpsUrl'], true);
    },
    Q3: async () => {
      s.basics.prodUrlSecretName = await text('Q3', questionById('Q3')!.prompt, s.basics.prodUrlSecretName, ['secretName']);
    },
    Q4: async () => {
      const answer = await ask.select(
        questionById('Q4')!.prompt,
        questionById('Q4')!.choices!.map((c) => ({ value: c.value, label: c.label, hint: c.consequence })),
        facts.testRunner ?? 'not-yet',
      );
      s.testsExist = answer !== 'not-yet';
      if (answer === 'pytest') s.cfg['test_runner'] = 'pytest';
      else delete s.cfg['test_runner'];
      if (!s.testsExist) {
        s.notes.push('No tests yet: the regression gates stay off until you add some (docs/onboarding.md, "Starting with no tests").');
        await chooseFreshPreset();
      }
    },
    Q5: async () => {
      const v = await text('Q5', questionById('Q5')!.prompt + ' (blank = keep the default)', typeof s.cfg['test_tier_smoke'] === 'string' ? s.cfg['test_tier_smoke'] : '', [], true);
      if (v !== '') s.cfg['test_tier_smoke'] = v;
    },
    Q6: async () => {
      const v = await text('Q6', questionById('Q6')!.prompt + ' (blank = use smoke)', typeof s.cfg['test_tier_critical'] === 'string' ? s.cfg['test_tier_critical'] : '', [], true);
      if (v !== '') s.cfg['test_tier_critical'] = v;
    },
    Q7: async () => {
      const v = await text('Q7', questionById('Q7')!.prompt + ' (blank = no)', typeof s.cfg['test_tier_full'] === 'string' ? s.cfg['test_tier_full'] : '', [], true);
      if (v !== '') s.cfg['test_tier_full'] = v;
    },
    Q8: async () => {
      const q = questionById('Q8')!;
      const [rel, after, night] = q.parts!;
      const tierOptions = rel!.choices!.filter((c) => validateAll(['tierHasTests'], c.value, vctx) === null).map((c) => ({ value: c.value, label: c.label, hint: c.consequence }));
      const currentTier = typeof s.cfg['release_gate_tier'] === 'string' && tierOptions.some((o) => o.value === s.cfg['release_gate_tier']) ? (s.cfg['release_gate_tier'] as string) : tierOptions[0]!.value;
      const tier = await ask.select(rel!.prompt, tierOptions, currentTier);
      const afterAnswer = await ask.select(after!.prompt, after!.choices!.map((c) => ({ value: c.value, label: c.label, hint: c.consequence })), s.cfg['post_deploy_full_regression'] === false ? 'nothing' : 'full');
      const nightChoices = night!.choices!.map((c) => ({ value: c.value, label: c.label, hint: c.consequence }));
      const currentNight = typeof s.cfg['scheduled_full_regression'] === 'string' ? (s.cfg['scheduled_full_regression'] as string) : 'off';
      let nightly = await ask.select(night!.prompt, nightChoices, nightChoices.some((c) => c.value === currentNight) ? currentNight : 'custom');
      if (nightly === 'custom') nightly = await text('Q8', 'Cron expression, five fields, e.g. 0 3 * * *', currentNight === 'off' ? '' : currentNight, ['cron5']);
      s.cfg['release_gate_tier'] = tier;
      s.cfg['post_deploy_full_regression'] = afterAnswer === 'full';
      if (nightly === 'off') delete s.cfg['scheduled_full_regression'];
      else s.cfg['scheduled_full_regression'] = nightly;
      s.cfg['e2e_regression_enabled'] = !(tier === 'none' && afterAnswer !== 'full' && nightly === 'off');
      // A tier that runs against shared data needs to know where the data lives (Q18).
      if (s.cfg['e2e_regression_enabled'] === true && s.dataIsolation === undefined && s.testsExist) await handlers['Q18']!();
    },
    Q9: async () => {
      const kind = await ask.select(
        questionById('Q9')!.prompt,
        questionById('Q9')!.choices!.map((c) => ({ value: c.value, label: c.label, hint: c.consequence })),
        s.runnerKind,
      );
      s.runnerKind = kind === 'self-hosted' ? 'self-hosted' : 'github';
      if (s.runnerKind === 'self-hosted') {
        s.runnerLabel = await text('Q9', questionById('Q9')!.parts![0]!.prompt, s.runnerLabel ?? '', ['nonEmpty']);
        s.cfg['runner'] = 'self-hosted';
      } else {
        s.runnerLabel = undefined;
        s.cfg['runner'] = GITHUB_RUNNER;
      }
    },
    Q10: async () => {
      const integration = await text('Q10', 'Integration branch (where changes land)', String(input.existing?.['integration_branch'] ?? facts.branches.integration ?? 'develop'), ['nonEmpty']);
      const release = await text('Q10', 'Release branch (production)', String(input.existing?.['release_branch'] ?? facts.branches.release ?? 'main'), ['nonEmpty']);
      const problem = validateAll(['branchesDiffer'], { integration, release }, vctx);
      if (problem !== null) {
        say(`Branches: ${problem}. Keeping develop and main.`);
        return;
      }
      s.cfg['integration_branch'] = integration;
      s.cfg['release_branch'] = release;
    },
    Q11: async () => {
      const choices = questionById('Q11')!.choices!.filter((c) => c.value !== 'solo' || solo !== 'no').map((c) => ({ value: c.value, label: c.label, hint: c.consequence }));
      const current = s.cfg['approval.mode'] === 'solo_with_gap' && choices.some((c) => c.value === 'solo') ? 'solo' : 'different-person';
      const answer = await ask.select(questionById('Q11')!.prompt, choices, current);
      if (answer === 'solo') {
        s.cfg['approval.mode'] = 'solo_with_gap';
        s.cfg['release_branch_required_reviews'] = 0;
      } else {
        s.cfg['approval.mode'] = 'dual_actor';
        s.cfg['release_branch_required_reviews'] = 1;
      }
    },
    Q12: async () => {
      const answer = await ask.select(
        questionById('Q12')!.prompt,
        questionById('Q12')!.choices!.map((c) => ({ value: c.value, label: c.label, hint: c.consequence })),
        s.cfg['production_review.terminal_status'] === 'released' ? 'no' : 'yes',
      );
      s.cfg['production_review.terminal_status'] = answer === 'no' ? 'released' : 'prod_review';
    },
    Q13: async () => {
      const options = COMPLIANCE_FRAMEWORK_CODES.map((c) => ({ value: c, label: FRAMEWORK_LABELS[c] ?? c }));
      s.frameworks = (await ask.multiselect(questionById('Q13')!.prompt + ' (none selected = none yet)', options, s.frameworks)).filter((f) => COMPLIANCE_FRAMEWORK_CODES.includes(f));
    },
    Q14: async () => {
      say('Each person who needs portal access reads it with their own viewer key: invite them in the portal, and they run `devaudit join` (docs/credentials.md).');
    },
    Q15: async () => {
      s.basics.sourceDirs = await text('Q15', 'Source dirs (space-sep)', s.basics.sourceDirs, ['existingDir']);
    },
    Q16: async () => {
      const answer = await ask.select(
        questionById('Q16')!.prompt,
        questionById('Q16')!.choices!.map((c) => ({ value: c.value, label: c.label, hint: c.consequence })),
        'clean',
      );
      if (answer === 'accept') {
        const n = await text('Q16', 'How many findings does the last scan report?', '0', ['positiveInt']);
        s.cfg['sast_baseline'] = Number(n);
      }
    },
    Q17: async () => {
      const cmd = await text('Q17', 'Command that starts the app (blank = skip)', String(input.existing?.['e2e_start_command'] ?? ''), [], true);
      if (cmd === '') return;
      s.cfg['e2e_start_command'] = cmd;
      const port = await text('Q17', 'Port the app listens on', String(input.existing?.['e2e_port'] ?? '3000'), ['positiveInt']);
      s.cfg['e2e_port'] = Number(port);
    },
    Q18: async () => {
      const q = questionById('Q18')!;
      const answer = await ask.select(q.prompt, q.choices!.map((c) => ({ value: c.value, label: c.label, hint: c.consequence })), s.dataIsolation ?? 'unknown');
      s.dataIsolation = answer;
      if (answer === 'unknown') {
        delete s.cfg['e2e_data_isolation'];
        return;
      }
      s.cfg['e2e_data_isolation'] = answer;
      if (answer === 'shared_serialised') s.cfg['e2e_concurrency_group'] = `${s.basics.projectSlug}-e2e-data`;
    },
    Q19: async () => {
      const found = facts.testData.seedScripts;
      const cmd = await text('Q19', 'Seed command (blank = there is none)', found.find((f) => f.startsWith('npm run ')) ?? '', [], true);
      if (cmd === '') return;
      s.cfg['e2e_seed_command'] = cmd;
      const paths = await text('Q19', 'Seed files or folders (blank = skip)', found.find((f) => !f.startsWith('npm run ')) ?? '', [], true);
      if (paths !== '') s.cfg['e2e_seed_paths'] = paths.split(/\s+/).filter((p) => p !== '');
    },
    Q20: async () => {
      const cmd = await text('Q20', 'Reset command (blank = tests clean up after themselves)', '', [], true);
      if (cmd !== '') s.cfg['e2e_reset_command'] = cmd;
    },
    Q21: async () => {
      const q = questionById('Q21')!;
      const yes = await ask.select(q.prompt, q.choices!.map((c) => ({ value: c.value, label: c.label, hint: c.consequence })), facts.testData.dependentProjects.length > 0 ? 'yes' : 'no');
      if (yes !== 'yes') return;
      const names = facts.testData.dependentProjects;
      const chosen = names.length > 0 ? await ask.multiselect(q.parts![0]!.prompt, names.map((n) => ({ value: n, label: n })), names) : [];
      if (chosen.length > 0) s.cfg['e2e_projects'] = chosen;
    },
  };

  if (conditionHolds('preset-needs-data', conditionState(s))) await handlers['Q18']!();

  // ---- the express summary loop ---------------------------------------------------------------------------

  const show = (): void => {
    say('');
    const head = s.preset === null ? 'Your current settings are kept.' : s.preset === 'custom' ? 'Custom settings.' : `Preset ${s.preset}: ${PRESETS[s.preset].name}. ${PRESETS[s.preset].summary}`;
    say(head);
    for (const line of summaryLines(s, facts)) say(`  ${line.label}: ${line.value}`);
    say(`  Compliance: ${complianceLine(s.cfg, s.frameworks)}`);
  };

  const askQuestions = async (ids: readonly string[]): Promise<void> => {
    for (const id of ids) {
      const h = handlers[id];
      if (h) await h();
    }
  };

  if (s.preset === 'custom' || s.preset === null) {
    // custom: the detailed questions; keep: ask nothing (the config stays as it is).
    if (s.preset === 'custom') await askQuestions(questionsToAsk(conditionState(s)).map((q) => q.id));
  } else {
    for (;;) {
      show();
      const action = await ask.select('Use these settings?', [
        { value: 'yes', label: 'Yes', hint: 'write them' },
        { value: 'change', label: 'Change one thing' },
        { value: 'detailed', label: 'Detailed questions', hint: 'every setting, with this as the default' },
      ], 'yes');
      if (action === 'yes') break;
      if (action === 'detailed') {
        await askQuestions(questionsToAsk(conditionState(s)).map((q) => q.id));
        continue;
      }
      const lines = summaryLines(s, facts);
      const seen = new Set<string>();
      const options = lines.filter((l) => !seen.has(l.id) && seen.add(l.id)).map((l) => ({ value: l.id, label: l.label, hint: l.value }));
      const which = await ask.select('Which one?', options, options[0]!.value);
      await handlers[which]?.();
    }
  }

  // ---- result ---------------------------------------------------------------------------------------------

  // Approval by a different person with one collaborator: a warning, not a refusal (section 5). Skipped when it cannot be told.
  if (s.cfg['approval.mode'] === 'dual_actor' && input.collaborators && (await input.collaborators().catch(() => null)) === 1) say(ONE_COLLABORATOR_WARNING);

  const preset = s.preset === null ? null : effectivePreset(s.preset, s.cfg);
  const config: Record<string, unknown> = { ...s.cfg };
  if (input.existing === null && config['runner'] === undefined) config['runner'] = s.runnerKind === 'github' ? GITHUB_RUNNER : 'self-hosted';
  if (preset !== null) config['onboarding_preset'] = preset;
  if (s.frameworks.length > 0) config['compliance_frameworks'] = s.frameworks;
  else if (s.preset !== null && existingFrameworks !== null) config['compliance_frameworks'] = [];
  for (const [k, v] of Object.entries(input.flagConfig)) config[k] = v;
  const removeKeys = s.preset !== null && s.preset !== 'custom' ? leftoverPresetKeys(config, input.existing) : [];
  const wanted = s.cfg['approval.mode'] === 'solo_with_gap' ? SOLO_POLICY : s.cfg['approval.mode'] === 'dual_actor' ? 'independent' : null;
  const currentPolicy = input.policy.status === 'ok' ? input.policy.policy : null;
  const policyToSet = wanted !== null && wanted !== currentPolicy && !(wanted === 'independent' && currentPolicy === null) ? wanted : null;
  return {
    basics: s.basics,
    config,
    removeKeys,
    preset,
    policyToSet,
    frameworks: s.frameworks,
    ...(s.runnerLabel !== undefined ? { runnerLabel: s.runnerLabel } : {}),
    notes: s.notes,
  };
}

/** What `devaudit join` shows: the project's preset with its one-line summary, or `custom`. Reads, never writes. */
export function describeProjectPreset(cfg: object | null): string {
  const id = cfg !== null ? (cfg as Record<string, unknown>)['onboarding_preset'] : undefined;
  if (typeof id === 'string' && (PRESET_IDS as readonly string[]).includes(id)) {
    const preset = PRESETS[id as PresetId];
    return `This project uses preset ${id}: ${preset.name}. ${preset.summary}`;
  }
  return 'This project uses custom settings (no preset is recorded). Run `devaudit doctor` to see how they fit.';
}
