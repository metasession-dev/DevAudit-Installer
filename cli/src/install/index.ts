import { basename, resolve } from 'node:path';
import { resolveToken } from '../lib/auth.js';
import { resolveInstallerRoot } from '../lib/installer-root.js';
import { isDir, isFile } from '../lib/fs-utils.js';
import { logger } from '../lib/logger.js';
import { getGitProvider, type GitProvider } from '../lib/git-provider/index.js';
import { DevAuditClient } from '../lib/devaudit-api.js';
import {
  discoverPlugins,
  buildPluginContext,
  runHook,
  type LoadedPlugin,
} from '../lib/plugin/index.js';
import { runAuthProbe } from './auth-probe.js';
import { detectStack } from './detect-stack.js';
import { collectPlan } from './prompts.js';
import { writeSdlcConfig } from './write-config.js';
import { findOrCreateProject } from './project.js';
import { issueApiKey } from './api-key.js';
import { setGithubSecrets } from './github.js';
import { bootstrapHooks } from './hooks-bootstrap.js';
import { configureBranchProtection } from './branch-protection.js';
import { syncTemplates } from './sync-templates.js';
// `bootstrapGovernanceDocs` is no longer called from the default install
// flow; consumers invoke `devaudit bootstrap-governance` on demand. Kept
// importable so the standalone command can still use it.
import { doneReport } from './done-report.js';
import type { InstallContext, InstallMode, InstallPlan, StepResult } from './types.js';

export interface RunInstallOptions {
  readonly path?: string;
  readonly token?: string;
  readonly baseUrl?: string;
  readonly dryRun?: boolean;
  readonly nonInteractive?: boolean;
  readonly provider?: GitProvider;
  readonly plugins?: readonly LoadedPlugin[];
  /**
   * Pin the install mode explicitly. `'auto'` (default) lets `detectInstallMode`
   * decide based on probes. `'developer'` is set by the `devaudit join`
   * subcommand to force the lighter flow.
   */
  readonly mode?: 'auto' | InstallMode;
  /**
   * Re-enables the destructive steps (write sdlc-config, issue API key, set
   * GH secrets, apply branch protection) even when dev-mode detection would
   * have skipped them. The operator's rotation lane.
   */
  readonly forceTeamConfig?: boolean;
}

export interface InstallReport {
  readonly project: string;
  readonly projectPath: string;
  readonly dryRun: boolean;
  readonly steps: readonly StepResult[];
}

export async function runInstall(options: RunInstallOptions): Promise<InstallReport> {
  const log = logger();
  const projectPath = resolve(options.path ?? process.cwd());
  if (!(await isDir(projectPath))) {
    throw new Error(`Project path not found: ${projectPath}`);
  }
  const projectName = basename(projectPath);
  const auth = await resolveTokenForInstall(options);
  const installerRoot = await resolveInstallerRoot();

  // Pre-flight mode detection runs after step 3 (plan), because it needs the
  // project slug. We build a tentative ctx for steps 1–3 here with mode set to
  // 'operator' (safe default — those steps don't consult installMode anyway).
  const tentativeCtx: InstallContext = {
    projectPath,
    projectName,
    installerRoot,
    token: auth.token,
    baseUrl: auth.baseUrl,
    dryRun: Boolean(options.dryRun),
    nonInteractive: Boolean(options.nonInteractive),
    installMode: 'operator',
  };
  banner(tentativeCtx);
  const steps: StepResult[] = [];
  steps.push(await record(log, runAuthProbe(tentativeCtx)));
  const plugins = options.plugins ?? (await discoverPlugins()).loaded;
  if (plugins.length > 0 && !tentativeCtx.dryRun) {
    const pluginCtx = await buildPluginContext({ projectPath: tentativeCtx.projectPath });
    await runHook(plugins, 'beforeInstall', pluginCtx);
  }
  const { result: detectResult, detected } = await detectStack(tentativeCtx);
  steps.push(await record(log, Promise.resolve(detectResult)));
  const plan: InstallPlan = await collectPlan(tentativeCtx, detected);
  const planStep = planSummary(plan);
  steps.push(planStep);
  log.success(`[${planStep.step}] ${planStep.message ?? ''}`);

  const providerResolution = await resolveProvider(options, tentativeCtx);
  // Resolve install mode now that we have plan.projectSlug + (maybe) a
  // provider — see detectInstallMode for the four-bit decision rule.
  const detection = await detectInstallMode(tentativeCtx, plan, providerResolution.provider, options);
  if (detection.notice) log.info(detection.notice);
  const ctx: InstallContext = { ...tentativeCtx, installMode: detection.mode };

  steps.push(await record(log, writeSdlcConfig(ctx, plan)));
  steps.push(await record(log, findOrCreateProject(ctx, plan)));
  steps.push(await record(log, issueApiKey(ctx, plan)));
  if (providerResolution.provider) {
    steps.push(await record(log, setGithubSecrets(ctx, plan, providerResolution.provider)));
  } else {
    const skipped: StepResult = {
      step: '7/11 Set GitHub secrets and variables',
      status: 'skipped',
      message: providerResolution.reason ?? 'no git provider available',
    };
    steps.push(skipped);
    log.warn(`[${skipped.step}] SKIPPED ${skipped.message}`);
  }
  steps.push(await record(log, bootstrapHooks(ctx, plan)));
  if (providerResolution.provider) {
    steps.push(await record(log, configureBranchProtection(ctx, providerResolution.provider)));
  } else {
    const skipped: StepResult = {
      step: '9/11 Configure branch protection',
      status: 'skipped',
      message: providerResolution.reason ?? 'no git provider available',
    };
    steps.push(skipped);
    log.warn(`[${skipped.step}] SKIPPED ${skipped.message}`);
  }
  steps.push(await record(log, syncTemplates(ctx)));
  // Governance-doc auto-seed (v0.1.30 → v0.1.35) is now OPT-IN ONLY.
  // Operators ran `devaudit install` and the next CI push uploaded five
  // placeholder governance docs (ropa.md / dpia.md / etc.) as compliance
  // evidence on day one — the portal then read those starters as the
  // canonical answer, which they aren't. Run `devaudit bootstrap-governance`
  // explicitly when you actually want the starters on disk.
  const done = doneReport(ctx, plan);
  steps.push(done);
  log.success(`[${done.step}]`);
  log.log(done.message ?? '');
  if (plugins.length > 0 && !ctx.dryRun) {
    const pluginCtx = await buildPluginContext({ projectPath: ctx.projectPath });
    await runHook(plugins, 'afterInstall', pluginCtx);
  }
  return { project: projectName, projectPath, dryRun: ctx.dryRun, steps };
}

interface ModeDetection {
  readonly mode: InstallMode;
  readonly notice?: string;
  /** True iff all four detection bits resolved to "developer-mode". */
  readonly allBitsMatched: boolean;
}

/**
 * Decide whether this install is the operator setting up / rotating a project
 * (`'operator'`) or a developer joining an already-onboarded one (`'developer'`).
 *
 * Developer mode requires **all four** bits to hold (any failure → operator,
 * the safe default that matches today's behaviour); `RunInstallOptions.mode`
 * overrides the auto-detection (used by `devaudit join`); `forceTeamConfig`
 * pins back to operator (the operator's rotation lane).
 *
 *   1. `sdlc-config.json` exists at projectPath        — already-onboarded marker
 *   2. portal returns a project for `plan.projectSlug`  — project lives on the portal
 *   3. an `'Onboarding-issued'` API key already exists  — first install already ran
 *   4. the repo has a `DEVAUDIT_USER_TOKEN` secret      — CI is already wired up
 */
async function detectInstallMode(
  ctx: InstallContext,
  plan: InstallPlan,
  provider: GitProvider | null,
  options: RunInstallOptions,
): Promise<ModeDetection> {
  if (options.forceTeamConfig) {
    return {
      mode: 'operator',
      allBitsMatched: false,
      notice: '--force-team-config: running operator-mode (will rewrite repo secrets + branch protection).',
    };
  }
  if (options.mode === 'developer') {
    return {
      mode: 'developer',
      allBitsMatched: true,
      notice:
        "mode=developer (pinned): destructive steps will skip — use `devaudit install --force-team-config` from the project's onboarding operator if you need to rotate team secrets.",
    };
  }
  if (options.mode === 'operator') {
    return { mode: 'operator', allBitsMatched: false };
  }
  // auto-detect ('auto' or undefined)
  if (ctx.dryRun) {
    // In dry-run we don't probe; default to operator semantics so the report
    // shows the maximum possible step set. (The new --force-team-config and
    // mode=developer cases above still take effect in dry-run.)
    return { mode: 'operator', allBitsMatched: false };
  }
  const sdlcConfigExisted = await isFile(`${ctx.projectPath}/sdlc-config.json`);
  if (!sdlcConfigExisted) return { mode: 'operator', allBitsMatched: false };
  let projectExists = false;
  let keyExists = false;
  try {
    const client = new DevAuditClient({ token: ctx.token, baseUrl: ctx.baseUrl });
    const existing = await client.getProjectBySlug(plan.projectSlug);
    if (existing) {
      projectExists = true;
      const keys = await client.listApiKeys(existing.id);
      keyExists = keys.some((k) => k.name === 'Onboarding-issued' && k.revoked_at === null);
    }
  } catch {
    // Any portal error → fall back to operator (safe default).
    return { mode: 'operator', allBitsMatched: false };
  }
  if (!projectExists || !keyExists) return { mode: 'operator', allBitsMatched: false };
  let hasUserTokenSecret = false;
  if (provider) {
    try {
      hasUserTokenSecret = await provider.hasSecret(ctx.projectPath, 'DEVAUDIT_USER_TOKEN');
    } catch {
      hasUserTokenSecret = false;
    }
  }
  if (!hasUserTokenSecret) return { mode: 'operator', allBitsMatched: false };
  return {
    mode: 'developer',
    allBitsMatched: true,
    notice:
      'developer mode auto-detected (project + Onboarding-issued key + DEVAUDIT_USER_TOKEN secret all present): destructive steps (4, 6, 7, 9) will skip. Use --force-team-config to rotate team secrets.',
  };
}

async function resolveProvider(
  options: RunInstallOptions,
  ctx: InstallContext,
): Promise<{ provider: GitProvider | null; reason?: string }> {
  if (options.provider) return { provider: options.provider };
  try {
    return { provider: await getGitProvider(ctx.projectPath) };
  } catch (err) {
    return { provider: null, reason: (err as Error).message };
  }
}

async function resolveTokenForInstall(options: RunInstallOptions): Promise<{ token: string; baseUrl: string }> {
  if (options.token) {
    return { token: options.token, baseUrl: options.baseUrl ?? 'https://devaudit.metasession.co' };
  }
  const resolved = await resolveToken();
  if (!resolved) {
    throw new Error(
      'No DevAudit token found. Set DEVAUDIT_USER_TOKEN, pass --token, or run `devaudit auth login` first.',
    );
  }
  return { token: resolved.token, baseUrl: options.baseUrl ?? resolved.baseUrl };
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

function planSummary(plan: InstallPlan): StepResult {
  return {
    step: '3/11 Configure',
    status: 'ok',
    message: `slug=${plan.projectSlug} runtime=${plan.runtimeVersion}`,
    data: { ...plan },
  };
}

function banner(ctx: InstallContext): void {
  const log = logger();
  log.log('');
  log.info(`Metasession SDLC Onboarding`);
  log.log(`  Consumer:  ${ctx.projectName}`);
  log.log(`  Path:      ${ctx.projectPath}`);
  log.log(`  DevAudit:  ${ctx.baseUrl}`);
  if (ctx.dryRun) log.warn('  DRY RUN — no mutations will be performed');
  log.log('');
}
