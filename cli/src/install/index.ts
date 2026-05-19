import { basename, resolve } from 'node:path';
import { resolveToken } from '../lib/auth.js';
import { resolveInstallerRoot } from '../lib/installer-root.js';
import { isDir } from '../lib/fs-utils.js';
import { logger } from '../lib/logger.js';
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
import { doneReport } from './done-report.js';
import type { InstallContext, InstallPlan, StepResult } from './types.js';

export interface RunInstallOptions {
  readonly path?: string;
  readonly token?: string;
  readonly baseUrl?: string;
  readonly dryRun?: boolean;
  readonly nonInteractive?: boolean;
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
  const ctx: InstallContext = {
    projectPath,
    projectName,
    installerRoot,
    token: auth.token,
    baseUrl: auth.baseUrl,
    dryRun: Boolean(options.dryRun),
    nonInteractive: Boolean(options.nonInteractive),
  };
  banner(ctx);
  const steps: StepResult[] = [];
  steps.push(await record(log, runAuthProbe(ctx)));
  const { result: detectResult, detected } = await detectStack(ctx);
  steps.push(await record(log, Promise.resolve(detectResult)));
  const plan: InstallPlan = await collectPlan(ctx, detected);
  const planStep = planSummary(plan);
  steps.push(planStep);
  log.success(`[${planStep.step}] ${planStep.message ?? ''}`);
  steps.push(await record(log, writeSdlcConfig(ctx, plan)));
  steps.push(await record(log, findOrCreateProject(ctx, plan)));
  steps.push(await record(log, issueApiKey(ctx, plan)));
  steps.push(await record(log, setGithubSecrets(ctx, plan)));
  steps.push(await record(log, bootstrapHooks(ctx, plan)));
  steps.push(await record(log, configureBranchProtection(ctx)));
  steps.push(await record(log, syncTemplates(ctx)));
  const done = doneReport(ctx, plan);
  steps.push(done);
  log.success(`[${done.step}]`);
  log.log(done.message ?? '');
  return { project: projectName, projectPath, dryRun: ctx.dryRun, steps };
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
