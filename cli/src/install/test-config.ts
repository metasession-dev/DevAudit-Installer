import * as clack from '@clack/prompts';
import { validateConfigKeyValue } from '../lib/repo-config-keys.js';
import type { TestRunnerDetection } from '../lib/test-runner-detect.js';

/**
 * devaudit-installer#1059 / #1060 — the test tier and release gate part of
 * `devaudit install`: flags for non-interactive use, a proposal from the
 * detected test runner, and the prompts that ask the operator to confirm.
 *
 * Absent keys keep today's behaviour, so nothing here ever writes a default:
 * a key reaches `sdlc-config.json` only when a flag or an answer names it.
 */

export const TEST_OPTION_KEYS = [
  'release_gate_tier',
  'post_deploy_full_regression',
  'scheduled_full_regression',
  'test_runner',
  'test_tier_smoke',
  'test_tier_critical',
  'test_tier_full',
  'test_feature_command',
] as const;
export type TestOptionKey = (typeof TEST_OPTION_KEYS)[number];
/** Raw flag values by `sdlc-config.json` key. */
export type TestOptions = Partial<Record<TestOptionKey, string>>;

const GATE_KEYS: readonly string[] = ['release_gate_tier', 'post_deploy_full_regression', 'scheduled_full_regression'];

export const flagNameFor = (key: string): string => `--${key.replace(/_/g, '-')}`;

/** Validate flag values with the same rules as `devaudit configure set`. */
export function parseTestOptions(options: TestOptions): { config: Record<string, unknown>; errors: string[] } {
  const config: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const key of TEST_OPTION_KEYS) {
    const raw = options[key];
    if (raw === undefined) continue;
    const r = validateConfigKeyValue(key, raw);
    if (r.error !== undefined) errors.push(`${flagNameFor(key)}: ${r.error}`);
    else config[key] = r.value;
  }
  return { config, errors };
}

export interface TestTierProposal {
  readonly runner: 'playwright' | 'pytest' | 'jest' | 'vitest';
  readonly summary: string;
  /** Keys to write if the operator accepts; empty when the runner's defaults already apply. */
  readonly config: Readonly<Record<string, string>>;
}

/** What to suggest for the runner found in the repo, or null when none is found. */
export function proposeTestTiers(detection: TestRunnerDetection): TestTierProposal | null {
  if (detection.playwright) {
    return { runner: 'playwright', summary: 'Playwright detected: the tiers are the smoke / critical / regression projects in playwright.config', config: {} };
  }
  if (detection.pytest) {
    return {
      runner: 'pytest',
      summary: 'pytest detected: the tiers are the `smoke` and `critical` markers (register them in pyproject.toml)',
      config: { test_runner: 'pytest' },
    };
  }
  if (detection.vitest) {
    return {
      runner: 'vitest',
      summary: 'Vitest detected: proposed tier commands (edit them to match how you select tests)',
      config: {
        test_tier_smoke: 'npx vitest run smoke',
        test_tier_critical: 'npx vitest run smoke critical',
        test_tier_full: 'npx vitest run',
        test_feature_command: 'npx vitest run -t "{REQ}]"',
      },
    };
  }
  if (detection.jest) {
    return {
      runner: 'jest',
      summary: 'Jest detected: proposed tier commands (edit them to match how you select tests)',
      config: {
        test_tier_smoke: 'npx jest --testPathPattern smoke',
        test_tier_critical: 'npx jest --testPathPattern "smoke|critical"',
        test_tier_full: 'npx jest',
        test_feature_command: 'npx jest -t "{REQ}]"',
      },
    };
  }
  return null;
}

/** The prompt functions the flow needs; a test seam (the default uses clack). */
export interface Asker {
  select(message: string, options: ReadonlyArray<{ value: string; label: string; hint?: string }>, initial: string): Promise<string>;
  text(message: string, initial: string, validate?: (value: string) => string | undefined): Promise<string>;
  confirm(message: string, initial: boolean): Promise<boolean>;
}

function unwrap<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    process.stderr.write('Cancelled.\n');
    process.exit(0);
  }
  return value as T;
}

export const clackAsker: Asker = {
  select: async (message, options, initial) =>
    unwrap(await clack.select({ message, initialValue: initial, options: options.map((o) => ({ value: o.value, label: o.label, hint: o.hint ?? '' })) })) as string,
  text: async (message, initial, validate) =>
    unwrap(await clack.text({ message, initialValue: initial, ...(validate ? { validate: (v: string | undefined) => validate(v ?? '') } : {}) })) as string,
  confirm: async (message, initial) => unwrap(await clack.confirm({ message, initialValue: initial })) as boolean,
};

export interface TestConfigResult {
  /** Keys to write on top of the existing config. */
  readonly config: Record<string, unknown>;
  /** Things the operator should know (printed in the install summary). */
  readonly notes: readonly string[];
}

const GATE_CHOICES = [
  { value: 'critical', label: 'critical', hint: "today's default: must-not-break journeys on the release PR, full regression after the deploy" },
  { value: 'smoke', label: 'smoke', hint: 'only the fast smoke tier before merge' },
  { value: 'full', label: 'full', hint: 'test the release candidate fully before it ships (slowest; a large pack can take about an hour)' },
  { value: 'none', label: 'none', hint: 'no E2E gate on the release PR' },
] as const;

function validatorFor(key: string): (value: string) => string | undefined {
  return (value) => {
    if (value.trim() === '') return undefined; // blank = skip
    return validateConfigKeyValue(key, value).error;
  };
}

/**
 * Decide the test keys for this install. Flags win and are never asked about;
 * keys already in `sdlc-config.json` are left alone; the rest is proposed from
 * the detected runner and confirmed. Non-interactive runs only apply flags.
 */
export async function resolveTestConfig(args: {
  readonly options: TestOptions;
  readonly existing: Record<string, unknown> | null;
  readonly detection: TestRunnerDetection;
  readonly interactive: boolean;
  readonly ask?: Asker;
}): Promise<TestConfigResult> {
  const { options, existing, detection, interactive } = args;
  const ask = args.ask ?? clackAsker;
  const parsed = parseTestOptions(options);
  if (parsed.errors.length > 0) throw new Error(parsed.errors.join('\n'));
  const config: Record<string, unknown> = { ...parsed.config };
  const notes: string[] = [];
  const has = (key: string): boolean => key in config || (existing !== null && existing[key] !== undefined);
  const regressionEnabled = existing?.['e2e_regression_enabled'] === true;

  if (GATE_KEYS.some((k) => k in config) && !regressionEnabled) {
    notes.push('The release gate keys are set, but e2e_regression_enabled is not true, so they take effect once you enable it: devaudit update --enable-e2e-regression <path>.');
  }

  if (!interactive) return { config, notes };

  // 1. Test tiers, proposed from the detected runner.
  const proposal = proposeTestTiers(detection);
  const proposalKeys = proposal ? Object.keys(proposal.config) : [];
  if (proposal && proposalKeys.length > 0 && !proposalKeys.some(has)) {
    if (proposal.runner === 'pytest') {
      if (await ask.confirm(`${proposal.summary}. Use the pytest tier workflows?`, true)) {
        config['test_runner'] = 'pytest';
      }
    } else if (await ask.confirm(`${proposal.summary}. Set tier commands now?`, true)) {
      for (const [key, proposed] of Object.entries(proposal.config)) {
        const answer = (await ask.text(`${key} (blank to skip)`, proposed, validatorFor(key))).trim();
        if (answer !== '') config[key] = validateConfigKeyValue(key, answer).value;
      }
    }
  } else if (proposal && proposalKeys.length === 0) {
    notes.push(proposal.summary + '.');
  }

  // 2. The release gate, only where it can take effect.
  if (regressionEnabled && !GATE_KEYS.some(has)) {
    const gate = await ask.select(
      'Which E2E tier must pass on the PR into the release branch? (run `devaudit doctor` later for a recommendation from your run times)',
      GATE_CHOICES,
      'critical',
    );
    if (gate !== 'critical') config['release_gate_tier'] = gate;
    if (gate === 'full') {
      const alsoPostDeploy = await ask.confirm('Also run the full regression after the production deploy? (it would test the same commit twice)', false);
      if (!alsoPostDeploy) config['post_deploy_full_regression'] = false;
    }
    const cron = (await ask.text('Cron expression for a scheduled full regression, e.g. 0 3 * * * (blank for none)', '', validatorFor('scheduled_full_regression'))).trim();
    if (cron !== '') config['scheduled_full_regression'] = cron;
  }
  return { config, notes };
}
