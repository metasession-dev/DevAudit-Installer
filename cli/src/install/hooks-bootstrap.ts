import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { InstallContext, InstallPlan, StepResult } from './types.js';

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execa(process.platform === 'win32' ? 'where' : 'which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await fs.stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function bootstrapHooks(ctx: InstallContext, plan: InstallPlan): Promise<StepResult> {
  if (ctx.dryRun) {
    const action = plan.stack === 'python' ? 'pre-commit install' : 'npx husky init';
    return {
      step: '8/11 Bootstrap hook framework',
      status: 'planned',
      message: `would run \`${action}\` in ${ctx.projectPath}`,
    };
  }
  if (plan.stack === 'python') return bootstrapPython(ctx);
  return bootstrapNode(ctx);
}

async function bootstrapPython(ctx: InstallContext): Promise<StepResult> {
  if (!(await commandExists('pre-commit'))) {
    return {
      step: '8/11 Bootstrap hook framework',
      status: 'warn',
      message: 'pre-commit not on PATH — run `pip install pre-commit && pre-commit install` manually',
    };
  }
  await execa('pre-commit', ['install'], { cwd: ctx.projectPath, stdio: 'inherit' });
  await execa('pre-commit', ['install', '--hook-type', 'commit-msg'], { cwd: ctx.projectPath, stdio: 'inherit' });
  return { step: '8/11 Bootstrap hook framework', status: 'ok', message: 'pre-commit hooks installed' };
}

async function bootstrapNode(ctx: InstallContext): Promise<StepResult> {
  const huskyDir = join(ctx.projectPath, '.husky');
  if (await dirExists(huskyDir)) {
    return { step: '8/11 Bootstrap hook framework', status: 'ok', message: '.husky/ already exists' };
  }
  if (!(await commandExists('npx'))) {
    return {
      step: '8/11 Bootstrap hook framework',
      status: 'warn',
      message: 'npx not on PATH — run `npx husky init` manually',
    };
  }
  await execa('npx', ['husky', 'init'], { cwd: ctx.projectPath, stdio: 'inherit' });
  return { step: '8/11 Bootstrap hook framework', status: 'ok', message: '.husky/ bootstrapped' };
}
