import { basename } from 'node:path';
import * as clack from '@clack/prompts';
import type { DetectedStack, InstallContext, InstallPlan, OnboardingPlan } from './types.js';
import { readSdlcConfig, resolveTargets, type SdlcConfig } from '../lib/sdlc-config.js';
import { listHosts } from '../lib/adapter.js';
import { HOST_HINTS, resolveHost } from './hosts.js';
import { clackAsker, parseTestOptions, resolveTestConfig, type TestOptions } from './test-config.js';
import { detectTestRunners } from '../lib/test-runner-detect.js';
import { COMPLIANCE_FRAMEWORK_CODES } from '../lib/repo-config-keys.js';
import { logger } from '../lib/logger.js';
import { resolveViewerKey } from '../lib/viewer-keys.js';
import {
  readApprovalPolicy,
  readClaimedStandards,
  soloApproverFrom,
  type FetchLike,
  type PolicyRead,
  type StandardsRead,
} from '../lib/onboarding-portal.js';
import { PRESETS, detectFacts, offerPresets } from '@metasession.co/devaudit-core';
import { fsRepoReader } from '@metasession.co/devaudit-core/node';
import { InstallRefusal } from './refusal.js';
import {
  effectivePreset,
  leftoverPresetKeys,
  parsePresetFlag,
  presetConfig,
  runGuided,
  type GuidedAsker,
  type GuidedBasics,
  type PresetChoice,
} from './guided.js';

const NODE_DEFAULTS = { runtimeVersion: '20', sourceDirs: 'app/ lib/' };
const PYTHON_DEFAULTS = { runtimeVersion: '3.11', sourceDirs: 'src/ tests/' };

const DEFAULT_API_KEY_SECRET = 'DEVAUDIT_API_KEY';

function defaultSlug(projectName: string): string {
  return projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function prodUrlSecretDefault(slug: string): string {
  return slug.toUpperCase().replace(/-/g, '_') + '_PROD_URL';
}

/**
 * GitHub repo secrets are repo-scoped, not per-directory — a second target
 * reusing the literal `DEVAUDIT_API_KEY` name would silently overwrite the
 * first target's key on the next `install`/`--add-target` run. Derive a
 * collision-free name from the new target's slug, disambiguating with a
 * numeric suffix in the (unlikely) case that's also taken. See #694.
 */
function apiKeySecretNameFor(slug: string, takenNames: ReadonlySet<string>): string {
  const base = slug.toUpperCase().replace(/-/g, '_') + '_API_KEY';
  if (!takenNames.has(base)) return base;
  let n = 2;
  while (takenNames.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

function existingApiKeySecretNames(cfg: SdlcConfig | null): Set<string> {
  if (!cfg) return new Set();
  return new Set(
    resolveTargets(cfg)
      .map((t) => t.devaudit?.api_key_secret)
      .filter((name): name is string => Boolean(name)),
  );
}

/**
 * A viewer-key repo secret name already in `sdlc-config.json` is carried
 * through so a rewrite does not drop it; none is ever created (#1099: the
 * viewer key is per person and lives in the CLI config folder).
 */
function resolveViewerApiKeySecretName(
  _ctx: InstallContext,
  _slug: string,
  _existing: SdlcConfig | null,
  existingSingleTargetSecret?: string,
): string | undefined {
  return existingSingleTargetSecret;
}

export interface CollectDeps {
  readonly ask?: GuidedAsker;
  readonly fetchImpl?: FetchLike;
  readonly say?: (line: string) => void;
  /** The viewer key to read the portal with; looked up from the usual places when undefined. */
  readonly viewerKey?: string | null;
}

export const clackGuidedAsker: GuidedAsker = {
  ...clackAsker,
  multiselect: async (message, options, initial) => {
    const value = await clack.multiselect({
      message,
      initialValues: [...initial],
      required: false,
      options: options.map((o) => ({ value: o.value, label: o.label, hint: o.hint ?? '' })),
    });
    if (clack.isCancel(value)) {
      process.stderr.write('Cancelled.\n');
      process.exit(0);
    }
    return value as string[];
  },
};

export async function collectPlan(
  ctx: InstallContext,
  detected: DetectedStack,
  deps: CollectDeps = {},
): Promise<InstallPlan> {
  const defaults = detected.stack === 'node' ? NODE_DEFAULTS : PYTHON_DEFAULTS;
  // A polyglot target (--add-target) shares the repo-level config: no test tiers, no preset.
  if (ctx.addTarget) {
    return ctx.nonInteractive ? planFromConfig(ctx, detected, defaults) : planFromPrompts(ctx, detected, defaults);
  }
  // `devaudit join` asks nothing and writes no policy or preset (devaudit-installer#1116 WP6).
  if (ctx.joining) return planFromConfig(ctx, detected, defaults);

  const existing = (await readSdlcConfig(ctx.repoRoot)) as unknown as Record<string, unknown> | null;
  const presetFlag = ctx.preset === undefined ? undefined : parsePresetFlag(ctx.preset);
  if (presetFlag === null) throw new InstallRefusal(`Unknown preset "${ctx.preset}". Use A, B, C, D or custom.`);
  const flags = parseTestOptions((ctx.testOptions ?? {}) as TestOptions);
  if (flags.errors.length > 0) throw new Error(flags.errors.join('\n'));
  const detection = await detectTestRunners(ctx.repoRoot);

  // ---- non-interactive (--yes) ----------------------------------------------------------------------------
  if (ctx.nonInteractive) {
    const plan = await planFromConfig(ctx, detected, defaults);
    const applied = presetFlag === undefined ? undefined : await presetWithoutQuestions(ctx, plan, presetFlag, flags.config, existing, deps);
    const test = await resolveTestConfig({
      options: (ctx.testOptions ?? {}) as TestOptions,
      existing,
      detection,
      interactive: false,
    });
    return withTestConfig(plan, { config: test.config, notes: [...(applied?.notes ?? []), ...test.notes] }, applied?.onboarding);
  }

  // ---- interactive: the guided flow -----------------------------------------------------------------------
  const basics = await defaultBasics(ctx, detected, defaults, existing);
  const portal = await readPortal(ctx, basics.projectSlug, deps);
  const say = deps.say ?? ((line: string) => logger().log(line));
  const guided = await runGuided({
    basics,
    stack: detected.stack,
    existing,
    flagConfig: flags.config,
    hosts: await listHosts(ctx.installerRoot),
    hostFlag: ctx.host,
    presetFlag,
    reader: fsRepoReader(ctx.repoRoot),
    policy: portal.policy,
    standards: portal.standards,
    scanPreset: ctx.scanHints?.preset,
    scanFrameworks: ctx.scanHints?.frameworks?.filter((f) => COMPLIANCE_FRAMEWORK_CODES.includes(f)),
    ask: deps.ask ?? clackGuidedAsker,
    say,
  });
  const apiKeySecretName = existing?.['devaudit'] !== undefined ? ((existing['devaudit'] as { api_key_secret?: string }).api_key_secret ?? DEFAULT_API_KEY_SECRET) : DEFAULT_API_KEY_SECRET;
  const viewerApiKeySecretName = resolveViewerApiKeySecretName(ctx, guided.basics.projectSlug, existing as SdlcConfig | null, (existing as SdlcConfig | null)?.devaudit?.viewer_api_key_secret);
  const plan: InstallPlan = {
    stack: detected.stack,
    ...guided.basics,
    apiKeySecretName,
    viewerApiKeySecretName,
  };
  const onboarding: OnboardingPlan = {
    preset: guided.preset,
    config: guided.config,
    removeKeys: guided.removeKeys,
    policyToSet: guided.policyToSet,
    frameworks: guided.frameworks,
    portalStandards: portal.standards.status === 'ok' ? portal.standards.codes : null,
    ...(guided.runnerLabel !== undefined ? { runnerLabel: guided.runnerLabel } : {}),
    ...(await noTestsHints(ctx, portal.policy)),
  };
  const test = await resolveTestConfig({
    options: (ctx.testOptions ?? {}) as TestOptions,
    existing: { ...(existing ?? {}), ...guided.config },
    detection,
    interactive: true,
    ask: deps.ask ?? clackGuidedAsker,
  });
  return withTestConfig(plan, { config: test.config, notes: [...guided.notes, ...test.notes] }, onboarding);
}

/** Whether the closing lines should describe the way from no tests to a gated release (and whether preset A was offered). */
async function noTestsHints(ctx: InstallContext, policy: PolicyRead): Promise<{ noSmokeTests?: boolean; presetAOffered?: boolean }> {
  const facts = await detectFacts(fsRepoReader(ctx.repoRoot));
  if (facts.testGroups.smoke) return {};
  const offers = offerPresets({ testGroups: facts.testGroups, soloApprover: soloApproverFrom(policy) });
  return { noSmokeTests: true, presetAOffered: offers.A.offered };
}

function withTestConfig(
  plan: InstallPlan,
  test: { readonly config: Record<string, unknown>; readonly notes: readonly string[] },
  onboarding: OnboardingPlan | undefined,
): InstallPlan {
  return {
    ...plan,
    ...(Object.keys(test.config).length > 0 ? { testConfig: test.config } : {}),
    ...(test.notes.length > 0 ? { testNotes: test.notes } : {}),
    ...(onboarding !== undefined ? { onboarding } : {}),
  };
}

async function readPortal(ctx: InstallContext, slug: string, deps: CollectDeps): Promise<{ policy: PolicyRead; standards: StandardsRead }> {
  const viewerKey = deps.viewerKey !== undefined ? deps.viewerKey : ((await resolveViewerKey({ repoRoot: ctx.repoRoot, baseUrl: ctx.baseUrl, slug }))?.key ?? null);
  const opts = { baseUrl: ctx.baseUrl, slug, viewerKey, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) };
  return { policy: await readApprovalPolicy(opts), standards: await readClaimedStandards(opts) };
}

/**
 * `--preset` with `--yes`: the preset's values are applied without a question. A and B need the project's
 * approval policy to allow self-approval with a recorded gap, which is read with the viewer key and never
 * changed without a person confirming it, so a policy that does not allow it refuses (exit 2).
 */
async function presetWithoutQuestions(
  ctx: InstallContext,
  plan: InstallPlan,
  preset: PresetChoice,
  flagConfig: Readonly<Record<string, unknown>>,
  existing: Record<string, unknown> | null,
  deps: CollectDeps,
): Promise<{ onboarding: OnboardingPlan; notes: string[] }> {
  const notes: string[] = [];
  if (preset === 'custom') {
    return { onboarding: { preset: 'custom', config: { onboarding_preset: 'custom', ...flagConfig }, removeKeys: [], policyToSet: null, frameworks: [], portalStandards: null }, notes };
  }
  const portal = await readPortal(ctx, plan.projectSlug, deps);
  const facts = await detectFacts(fsRepoReader(ctx.repoRoot));
  const solo = PRESETS[preset].portalPolicy === 'self_allowed_with_gap';
  if (solo && !(portal.policy.status === 'ok' && portal.policy.policy === 'self_allowed_with_gap')) {
    throw new InstallRefusal(
      `Preset ${preset} needs the project's approval policy to allow self-approval with a recorded gap. Run \`devaudit install\` in a terminal (it asks to set it), or set it in the portal's project settings, then run this again.`,
    );
  }
  const offer = offerPresets({ testGroups: facts.testGroups, soloApprover: 'yes' })[preset];
  if (!offer.offered) throw new InstallRefusal(`Preset ${preset} cannot be used here: ${offer.reason}.`);
  if (!solo && portal.policy.status === 'ok' && portal.policy.policy === 'self_allowed_with_gap') {
    notes.push('The portal still allows self-approval for this project; set its approval policy to independent in the portal so it matches preset ' + preset + '.');
  }
  const config = presetConfig(preset, flagConfig);
  const recorded = effectivePreset(preset, config);
  return {
    onboarding: {
      preset: recorded,
      config: recorded === preset ? config : { ...config, onboarding_preset: 'custom' },
      removeKeys: leftoverPresetKeys(config, existing),
      policyToSet: null,
      frameworks: [],
      portalStandards: null,
    },
    notes,
  };
}

/** The values the guided flow starts from: the existing config where there is one, else detection and defaults. */
async function defaultBasics(
  ctx: InstallContext,
  detected: DetectedStack,
  defaults: { runtimeVersion: string; sourceDirs: string },
  existing: Record<string, unknown> | null,
): Promise<GuidedBasics> {
  const cfg = existing as SdlcConfig | null;
  const slug = cfg?.project_slug ?? defaultSlug(ctx.projectName);
  const runtimeKey = detected.stack === 'node' ? cfg?.node_version : cfg?.python_version;
  const existingProdUrlSecret = typeof existing?.['production_url_secret'] === 'string' ? (existing['production_url_secret'] as string) : undefined;
  const stackMatchesConfig = cfg?.stack === detected.stack;
  return {
    host: await resolveHost({ installerRoot: ctx.installerRoot, requested: ctx.host, existing: cfg?.host }),
    projectSlug: slug,
    runtimeVersion: String(runtimeKey ?? defaults.runtimeVersion),
    sourceDirs: cfg?.source_dirs ?? defaults.sourceDirs,
    workingDirectory: (stackMatchesConfig ? cfg?.working_directory : undefined) ?? detected.workingDirectory,
    prodUrlSecretName: existingProdUrlSecret ?? prodUrlSecretDefault(slug),
    prodUrlValue: '',
  };
}

async function planFromConfig(
  ctx: InstallContext,
  detected: DetectedStack,
  defaults: { runtimeVersion: string; sourceDirs: string },
): Promise<InstallPlan> {
  // sdlc-config.json lives at the repo root (#689 follow-up), not this
  // target's own directory — see write-config.ts for why.
  const cfg = await readSdlcConfig(ctx.repoRoot);
  if (!cfg && !ctx.dryRun) {
    throw new Error(
      '--yes requires an existing sdlc-config.json at the repository root. Run without --yes to create one interactively.',
    );
  }
  // --add-target (#689/#691): the existing config (if any) describes a
  // *different* target — inheriting its slug/working_directory/runtime/
  // prod-url-secret here would plan an install indistinguishable from that
  // other target instead of a new one. Use fresh detection + stack defaults,
  // deriving the new target's slug from the directory being installed into
  // (the caller can still get an interactive, fully-custom slug by omitting
  // --yes).
  if (ctx.addTarget) {
    const slug = defaultSlug(
      detected.workingDirectory === '.' ? ctx.projectName : basename(detected.workingDirectory),
    );
    return {
      stack: detected.stack,
      host: await resolveHost({ installerRoot: ctx.installerRoot, requested: ctx.host, existing: cfg?.host }),
      projectSlug: slug,
      runtimeVersion: defaults.runtimeVersion,
      sourceDirs: defaults.sourceDirs,
      workingDirectory: detected.workingDirectory,
      prodUrlSecretName: prodUrlSecretDefault(slug),
      prodUrlValue: '',
      apiKeySecretName: apiKeySecretNameFor(slug, existingApiKeySecretNames(cfg)),
      viewerApiKeySecretName: resolveViewerApiKeySecretName(ctx, slug, cfg),
    };
  }
  const slug = cfg?.project_slug ?? defaultSlug(ctx.projectName);
  const runtimeKey = detected.stack === 'node' ? cfg?.node_version : cfg?.python_version;
  const cfgRaw = cfg as Record<string, unknown> | null;
  const existingProdUrlSecret =
    typeof cfgRaw?.['production_url_secret'] === 'string'
      ? (cfgRaw['production_url_secret'] as string)
      : undefined;
  const existingApiKeySecret = cfg?.devaudit?.api_key_secret;
  // Only trust the config's working_directory when the freshly-detected stack
  // still matches it — i.e. we're plausibly looking at the *same* target this
  // config describes. If detection landed on a different stack, we've walked
  // into a different (as yet unconfigured) target's directory instead, and
  // must use where it was actually detected so write-config's target-identity
  // check (#689/#691) can tell the two apart rather than silently blending
  // this run's plan into the existing target's fields.
  const stackMatchesConfig = cfg?.stack === detected.stack;
  return {
    stack: detected.stack,
    host: await resolveHost({ installerRoot: ctx.installerRoot, requested: ctx.host, existing: cfg?.host }),
    projectSlug: slug,
    runtimeVersion: String(runtimeKey ?? defaults.runtimeVersion),
    sourceDirs: cfg?.source_dirs ?? defaults.sourceDirs,
    workingDirectory: (stackMatchesConfig ? cfg?.working_directory : undefined) ?? detected.workingDirectory,
    prodUrlSecretName: existingProdUrlSecret ?? prodUrlSecretDefault(slug),
    prodUrlValue: '',
    apiKeySecretName: existingApiKeySecret ?? DEFAULT_API_KEY_SECRET,
    viewerApiKeySecretName: resolveViewerApiKeySecretName(
      ctx,
      slug,
      cfg,
      cfg?.devaudit?.viewer_api_key_secret,
    ),
  };
}

async function planFromPrompts(
  ctx: InstallContext,
  detected: DetectedStack,
  defaults: { runtimeVersion: string; sourceDirs: string },
): Promise<InstallPlan> {
  const slugDefault = defaultSlug(ctx.projectName);
  const wdInitialDefault = detected.workingDirectory;
  const existingForHost = await readSdlcConfig(ctx.repoRoot);
  const hostDefault = await resolveHost({
    installerRoot: ctx.installerRoot,
    requested: ctx.host,
    existing: existingForHost?.host,
  });
  // devaudit-installer#1022 — ask only when nothing already decides the host:
  // no --host, and no host recorded in an existing sdlc-config.json.
  const askHost = ctx.host === undefined && existingForHost?.host === undefined;
  const hostChoices = askHost ? [...(await listHosts(ctx.installerRoot))].sort() : [];
  const answers = await clack.group(
    {
      ...(askHost
        ? {
            host: () =>
              clack.select({
                message: 'Where does production deploy?',
                initialValue: hostDefault,
                options: hostChoices.map((name) => ({ value: name, label: name, hint: HOST_HINTS[name] ?? '' })),
              }),
          }
        : {}),
      projectSlug: () => clack.text({ message: 'Project slug', initialValue: slugDefault }),
      runtimeVersion: () =>
        clack.text({
          message: detected.stack === 'node' ? 'Node version' : 'Python version',
          initialValue: defaults.runtimeVersion,
        }),
      sourceDirs: () => clack.text({ message: 'Source dirs (space-sep)', initialValue: defaults.sourceDirs }),
      workingDirectory: () =>
        clack.text({
          message: wdInitialDefault === '.' ? 'Working directory (blank = root)' : 'Working directory',
          initialValue: wdInitialDefault,
        }),
      prodUrlSecretName: ({ results }) =>
        clack.text({
          message: 'Production URL secret name',
          initialValue: prodUrlSecretDefault(String(results.projectSlug ?? slugDefault)),
        }),
      prodUrlValue: () =>
        clack.text({ message: 'Production URL (https://...) — blank to set later', initialValue: '' }),
    },
    {
      onCancel: () => {
        process.stderr.write('Cancelled.\n');
        process.exit(0);
      },
    },
  );
  const projectSlug = String(answers.projectSlug);
  const workingDirectory = String(answers.workingDirectory) || '.';
  const existing = await readSdlcConfig(ctx.repoRoot);
  const apiKeySecretName = ctx.addTarget
    ? apiKeySecretNameFor(projectSlug, existingApiKeySecretNames(existing))
    : (existing?.devaudit?.api_key_secret ?? DEFAULT_API_KEY_SECRET);
  const viewerApiKeySecretName = resolveViewerApiKeySecretName(
    ctx,
    projectSlug,
    existing,
    existing?.devaudit?.viewer_api_key_secret,
  );
  return {
    stack: detected.stack,
    host: askHost ? String((answers as Record<string, unknown>)['host'] ?? hostDefault) : hostDefault,
    projectSlug,
    runtimeVersion: String(answers.runtimeVersion),
    sourceDirs: String(answers.sourceDirs),
    workingDirectory,
    prodUrlSecretName: String(answers.prodUrlSecretName),
    prodUrlValue: String(answers.prodUrlValue ?? ''),
    apiKeySecretName,
    viewerApiKeySecretName,
  };
}
