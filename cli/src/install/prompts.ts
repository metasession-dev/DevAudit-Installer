import { basename } from 'node:path';
import * as clack from '@clack/prompts';
import type { DetectedStack, InstallContext, InstallPlan } from './types.js';
import { readSdlcConfig, resolveTargets, type SdlcConfig } from '../lib/sdlc-config.js';

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

export async function collectPlan(
  ctx: InstallContext,
  detected: DetectedStack,
): Promise<InstallPlan> {
  const defaults = detected.stack === 'node' ? NODE_DEFAULTS : PYTHON_DEFAULTS;
  if (ctx.nonInteractive) {
    return planFromConfig(ctx, detected, defaults);
  }
  return planFromPrompts(ctx, detected, defaults);
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
      host: 'railway',
      projectSlug: slug,
      runtimeVersion: defaults.runtimeVersion,
      sourceDirs: defaults.sourceDirs,
      workingDirectory: detected.workingDirectory,
      prodUrlSecretName: prodUrlSecretDefault(slug),
      prodUrlValue: '',
      apiKeySecretName: apiKeySecretNameFor(slug, existingApiKeySecretNames(cfg)),
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
    host: 'railway',
    projectSlug: slug,
    runtimeVersion: String(runtimeKey ?? defaults.runtimeVersion),
    sourceDirs: cfg?.source_dirs ?? defaults.sourceDirs,
    workingDirectory: (stackMatchesConfig ? cfg?.working_directory : undefined) ?? detected.workingDirectory,
    prodUrlSecretName: existingProdUrlSecret ?? prodUrlSecretDefault(slug),
    prodUrlValue: '',
    apiKeySecretName: existingApiKeySecret ?? DEFAULT_API_KEY_SECRET,
  };
}

async function planFromPrompts(
  ctx: InstallContext,
  detected: DetectedStack,
  defaults: { runtimeVersion: string; sourceDirs: string },
): Promise<InstallPlan> {
  const slugDefault = defaultSlug(ctx.projectName);
  const wdInitialDefault = detected.workingDirectory;
  const answers = await clack.group(
    {
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
  return {
    stack: detected.stack,
    host: 'railway',
    projectSlug,
    runtimeVersion: String(answers.runtimeVersion),
    sourceDirs: String(answers.sourceDirs),
    workingDirectory,
    prodUrlSecretName: String(answers.prodUrlSecretName),
    prodUrlValue: String(answers.prodUrlValue ?? ''),
    apiKeySecretName,
  };
}
