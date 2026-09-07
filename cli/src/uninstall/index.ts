import { resolve } from 'node:path';
import * as clack from '@clack/prompts';
import { resolveToken } from '../lib/auth.js';
import { resolveRepoRoot } from '../lib/git-root.js';
import { logger } from '../lib/logger.js';
import { getGitProvider, type GitProvider } from '../lib/git-provider/index.js';
import { DevAuditClient, DevAuditApiError } from '../lib/devaudit-api.js';
import { readSdlcConfig, resolveTargets, type Target } from '../lib/sdlc-config.js';
import { removeSdlcConfigTarget } from '../install/write-config.js';
import type { StepResult } from '../install/types.js';

export interface RunUninstallOptions {
  readonly path?: string;
  readonly token?: string;
  readonly baseUrl?: string;
  /** Which target to disconnect, when sdlc-config.json configures more than one (#689 polyglot monorepo). */
  readonly target?: string;
  readonly dryRun?: boolean;
  readonly nonInteractive?: boolean;
  readonly provider?: GitProvider;
}

export interface UninstallReport {
  readonly targetName: string;
  readonly projectSlug: string;
  readonly dryRun: boolean;
  readonly steps: readonly StepResult[];
}

/**
 * `devaudit uninstall` — the counterpart to `devaudit install`. Disconnects
 * this repo from a DevAudit project:
 *   1. Revokes the project's active API key(s) via the portal (a no-op,
 *      not an error, if the portal project itself was already hard-deleted
 *      — its keys are gone too, via cascade).
 *   2. Deletes the GitHub secrets/variables `install` wrote for this target.
 *   3. Removes the target from `sdlc-config.json` (deleting the file
 *      entirely if it was the only target).
 *
 * Deliberately leaves branch protection and synced CI/SDLC files in place —
 * reverting those automatically risks clobbering changes made since install
 * by someone else. The done-summary tells the operator what's left.
 */
export async function runUninstall(options: RunUninstallOptions): Promise<UninstallReport> {
  const log = logger();
  const projectPath = resolve(options.path ?? process.cwd());
  const repoRoot = await resolveRepoRoot(projectPath);

  const config = await readSdlcConfig(repoRoot);
  if (!config) {
    throw new Error(`No sdlc-config.json found at ${repoRoot} — nothing to uninstall.`);
  }
  const targets = resolveTargets(config);
  const target = selectTarget(targets, options.target);
  const projectSlug = target.devaudit?.project_slug;
  if (!projectSlug) {
    throw new Error(
      `Target "${target.name}" has no devaudit.project_slug configured — nothing to disconnect.`,
    );
  }
  const baseUrl = options.baseUrl ?? target.devaudit?.base_url ?? 'https://devaudit.ai';

  banner(log, target, repoRoot, projectSlug, baseUrl, Boolean(options.dryRun));

  if (!options.dryRun && !options.nonInteractive) {
    const confirmed = await clack.confirm({
      message: `Disconnect "${target.name}" (project "${projectSlug}") from this repo? This revokes its API key(s), deletes the GitHub secrets/variables install wrote, and removes it from sdlc-config.json.`,
      initialValue: false,
    });
    if (clack.isCancel(confirmed) || confirmed !== true) {
      log.warn('Cancelled.');
      process.exit(0);
    }
  }

  const token = options.token ?? (await resolveToken())?.token;
  if (!token) {
    throw new Error(
      'No DevAudit token found. Set DEVAUDIT_USER_TOKEN, pass --token, or run `devaudit auth login` first.',
    );
  }

  const steps: StepResult[] = [];
  steps.push(
    await record(log, revokeApiKeyStep({ token, baseUrl }, projectSlug, Boolean(options.dryRun))),
  );

  const provider = options.provider ?? (await resolveProvider(projectPath));
  if (provider) {
    steps.push(
      await record(log, deleteSecretsStep(provider, projectPath, target, Boolean(options.dryRun))),
    );
  } else {
    const skipped: StepResult = {
      step: '2/3 Delete GitHub secrets and variables',
      status: 'skipped',
      message: 'no git provider available',
    };
    steps.push(skipped);
    log.warn(`[${skipped.step}] SKIPPED ${skipped.message}`);
  }

  steps.push(await record(log, removeConfigStep(repoRoot, target, Boolean(options.dryRun))));

  if (!options.dryRun) {
    log.log(doneSummary(target, projectSlug));
  }

  return { targetName: target.name, projectSlug, dryRun: Boolean(options.dryRun), steps };
}

function selectTarget(targets: readonly Target[], requested: string | undefined): Target {
  if (requested) {
    const match = targets.find(
      (t) => t.name === requested || t.devaudit?.project_slug === requested,
    );
    if (!match) {
      throw new Error(
        `No target named "${requested}" found in sdlc-config.json. Available: ${targets.map((t) => t.name).join(', ')}`,
      );
    }
    return match;
  }
  if (targets.length > 1) {
    throw new Error(
      `sdlc-config.json configures multiple targets (${targets.map((t) => t.name).join(', ')}) — pass --target <name> to pick one.`,
    );
  }
  const [only] = targets;
  if (!only) {
    throw new Error('sdlc-config.json has no targets configured.');
  }
  return only;
}

async function revokeApiKeyStep(
  auth: { token: string; baseUrl: string },
  projectSlug: string,
  dryRun: boolean,
): Promise<StepResult> {
  const step = '1/3 Revoke project API key(s)';
  if (dryRun) {
    return {
      step,
      status: 'planned',
      message: `would revoke any active API key(s) for project '${projectSlug}'`,
    };
  }
  const client = new DevAuditClient({ token: auth.token, baseUrl: auth.baseUrl });
  let project;
  try {
    project = await client.getProjectBySlug(projectSlug);
  } catch (err) {
    if (err instanceof DevAuditApiError) {
      return {
        step,
        status: 'warn',
        message: `could not reach the portal to look up project '${projectSlug}' (HTTP ${err.status}) — skipping key revoke`,
      };
    }
    throw err;
  }
  if (!project) {
    return {
      step,
      status: 'ok',
      message: `project '${projectSlug}' no longer exists on the portal — its API key(s) are already revoked`,
    };
  }
  const keys = await client.listApiKeys(project.id);
  const live = keys.filter((k) => k.revoked_at === null);
  if (live.length === 0) {
    return { step, status: 'ok', message: 'no active API key found — nothing to revoke' };
  }
  for (const key of live) {
    // eslint-disable-next-line no-await-in-loop
    await client.revokeApiKey(project.id, key.id);
  }
  return { step, status: 'ok', message: `revoked ${live.length} active API key(s)` };
}

async function deleteSecretsStep(
  provider: GitProvider,
  projectPath: string,
  target: Target,
  dryRun: boolean,
): Promise<StepResult> {
  const step = '2/3 Delete GitHub secrets and variables';
  const secretNames = [
    target.devaudit?.api_key_secret ?? 'DEVAUDIT_API_KEY',
    'DEVAUDIT_USER_TOKEN',
    ...(target.production_url_secret ? [target.production_url_secret] : []),
  ];
  if (dryRun) {
    return {
      step,
      status: 'planned',
      message: `would delete secrets [${secretNames.join(', ')}] and variable DEVAUDIT_BASE_URL via ${provider.name} provider`,
    };
  }
  for (const name of secretNames) {
    // eslint-disable-next-line no-await-in-loop
    await provider.deleteSecret(projectPath, name);
  }
  await provider.deleteVariable(projectPath, 'DEVAUDIT_BASE_URL');
  return {
    step,
    status: 'ok',
    message: `deleted secrets [${secretNames.join(', ')}] and variable DEVAUDIT_BASE_URL`,
  };
}

async function removeConfigStep(
  repoRoot: string,
  target: Target,
  dryRun: boolean,
): Promise<StepResult> {
  const step = '3/3 Remove target from sdlc-config.json';
  if (dryRun) {
    return {
      step,
      status: 'planned',
      message: `would remove target '${target.name}' from sdlc-config.json (deleting the file if it was the only target)`,
    };
  }
  const result = await removeSdlcConfigTarget(repoRoot, target.name);
  if (!result.removed) {
    return {
      step,
      status: 'warn',
      message: `target '${target.name}' not found in sdlc-config.json (already removed?)`,
    };
  }
  if (result.deletedFile) {
    return { step, status: 'ok', message: 'removed the only target — deleted sdlc-config.json' };
  }
  return {
    step,
    status: 'ok',
    message: `removed target '${target.name}' — remaining: ${result.remainingTargetNames.join(', ')}`,
  };
}

async function resolveProvider(projectPath: string): Promise<GitProvider | null> {
  try {
    return await getGitProvider(projectPath);
  } catch {
    return null;
  }
}

async function record(log: ReturnType<typeof logger>, p: Promise<StepResult>): Promise<StepResult> {
  const result = await p;
  const tag = `[${result.step}]`;
  const msg = result.message ?? '';
  if (result.status === 'ok') log.success(`${tag} ${msg}`);
  else if (result.status === 'warn') log.warn(`${tag} ${msg}`);
  else if (result.status === 'skipped') log.info(`${tag} SKIPPED ${msg}`);
  else if (result.status === 'planned') log.info(`${tag} [dry-run] ${msg}`);
  else log.error(`${tag} ${msg}`);
  return result;
}

function banner(
  log: ReturnType<typeof logger>,
  target: Target,
  repoRoot: string,
  projectSlug: string,
  baseUrl: string,
  dryRun: boolean,
): void {
  log.log('');
  log.info('Metasession SDLC Offboarding');
  log.log(`  Target:    ${target.name}`);
  log.log(`  Path:      ${repoRoot}`);
  log.log(`  Project:   ${projectSlug}`);
  log.log(`  DevAudit:  ${baseUrl}`);
  if (dryRun) log.warn('  DRY RUN — no mutations will be performed');
  log.log('');
}

function doneSummary(target: Target, projectSlug: string): string {
  return [
    '',
    `Disconnected "${target.name}" (project '${projectSlug}') from this repo.`,
    '',
    'Left in place — clean up manually if you want these gone too:',
    '  - Branch protection rules on this repo',
    '  - Synced CI workflow files (.github/workflows/), SDLC/*.md, AGENTS.md, etc.',
    '',
    'These are now inert. CI steps that reference this project will fail until you',
    'either remove them or run `devaudit install` again to onboard a fresh project.',
  ].join('\n');
}
