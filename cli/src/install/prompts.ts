import { basename } from 'node:path';
import * as clack from '@clack/prompts';
import type { DetectedStack, InstallContext, InstallPlan } from './types.js';
import { readSdlcConfig } from '../lib/sdlc-config.js';

const NODE_DEFAULTS = { runtimeVersion: '20', sourceDirs: 'app/ lib/' };
const PYTHON_DEFAULTS = { runtimeVersion: '3.11', sourceDirs: 'src/ tests/' };

function defaultSlug(projectName: string): string {
  return projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function prodUrlSecretDefault(slug: string): string {
  return slug.toUpperCase().replace(/-/g, '_') + '_PROD_URL';
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
  const cfg = await readSdlcConfig(ctx.projectPath);
  if (!cfg && !ctx.dryRun) {
    throw new Error(
      '--yes requires an existing sdlc-config.json in the project directory. Run without --yes to create one interactively.',
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
    };
  }
  const slug = cfg?.project_slug ?? defaultSlug(ctx.projectName);
  const runtimeKey = detected.stack === 'node' ? cfg?.node_version : cfg?.python_version;
  const cfgRaw = cfg as Record<string, unknown> | null;
  const existingProdUrlSecret =
    typeof cfgRaw?.['production_url_secret'] === 'string'
      ? (cfgRaw['production_url_secret'] as string)
      : undefined;
  return {
    stack: detected.stack,
    host: 'railway',
    projectSlug: slug,
    runtimeVersion: String(runtimeKey ?? defaults.runtimeVersion),
    sourceDirs: cfg?.source_dirs ?? defaults.sourceDirs,
    workingDirectory: cfg?.working_directory ?? detected.workingDirectory,
    prodUrlSecretName: existingProdUrlSecret ?? prodUrlSecretDefault(slug),
    prodUrlValue: '',
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
  return {
    stack: detected.stack,
    host: 'railway',
    projectSlug,
    runtimeVersion: String(answers.runtimeVersion),
    sourceDirs: String(answers.sourceDirs),
    workingDirectory,
    prodUrlSecretName: String(answers.prodUrlSecretName),
    prodUrlValue: String(answers.prodUrlValue ?? ''),
  };
}
