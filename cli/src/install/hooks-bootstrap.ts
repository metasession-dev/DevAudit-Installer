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

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await fs.stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * `npx husky init` needs to run with `package.json` in its cwd (it hard-fails
 * with ENOENT reading `package.json` otherwise, to set the `prepare` script)
 * — but for a target living in a polyglot-monorepo subdirectory (#689),
 * `package.json` is at `ctx.projectPath`, not `ctx.repoRoot`. husky itself
 * needs to run at the actual git root to set `core.hooksPath` (when it can't
 * find `.git` at cwd — which is exactly the polyglot-target case — it warns
 * "`.git` can't be found" and silently skips setting `core.hooksPath`
 * *and* skips creating the `.husky/_` runtime helper dir entirely, leaving
 * `.husky/pre-commit` on disk but non-functional).
 *
 * So: run `husky init` at `ctx.projectPath` (where it can find `package.json`),
 * then relocate the resulting `.husky/` to `ctx.repoRoot` and set
 * `core.hooksPath` there ourselves — matches exactly what a normal
 * repo-root `husky init` produces.
 */
async function relocateHuskyToRepoRoot(ctx: InstallContext): Promise<void> {
  if (ctx.repoRoot === ctx.projectPath) return;
  const from = join(ctx.projectPath, '.husky');
  const to = join(ctx.repoRoot, '.husky');
  if (!(await dirExists(from))) return;
  await fs.rename(from, to);
  await execa('git', ['config', 'core.hooksPath', '.husky/_'], { cwd: ctx.repoRoot });
}

/**
 * Marker line appended to `.husky/pre-commit` so pre-commit's checks still
 * run when husky owns `core.hooksPath` (#689/#697 — see module docstring
 * below for the full coexistence problem). Idempotency-checked by exact
 * substring match before appending.
 */
const PRE_COMMIT_DELEGATE_LINE = 'pre-commit run --hook-stage commit "$@"';

/**
 * Whether a `.pre-commit-config.yaml` exists at the repo root — the signal
 * that a Python target's hooks are configured (installed or not).
 */
async function preCommitConfigured(projectPath: string): Promise<boolean> {
  return fileExists(join(projectPath, '.pre-commit-config.yaml'));
}

/**
 * Append the pre-commit delegate line to `.husky/pre-commit` if it isn't
 * there already. No-op if the file is missing (husky not yet bootstrapped —
 * caller is responsible for ordering).
 */
async function ensurePreCommitDelegated(projectPath: string): Promise<boolean> {
  const huskyHook = join(projectPath, '.husky', 'pre-commit');
  let content: string;
  try {
    content = await fs.readFile(huskyHook, 'utf-8');
  } catch {
    return false;
  }
  if (content.includes(PRE_COMMIT_DELEGATE_LINE)) return false;
  const updated = content.trimEnd() + `\n${PRE_COMMIT_DELEGATE_LINE}\n`;
  await fs.writeFile(huskyHook, updated, 'utf-8');
  return true;
}

/**
 * Bootstraps a target's git-hook framework: husky for a Node target,
 * pre-commit for a Python target.
 *
 * Polyglot-monorepo coexistence (#689/#697): git only honors ONE hook file
 * per hook type (e.g. `pre-commit`), resolved via a single repo-wide
 * `core.hooksPath`. `npx husky init` unconditionally repoints
 * `core.hooksPath` at `.husky/_` — if a Python target's `pre-commit install`
 * had already written the native git hook (under `.git/hooks` or whatever
 * `core.hooksPath` pointed at before), that hook silently stops firing the
 * moment husky repoints it, with no error. The reverse is worse: running
 * `pre-commit install` while `core.hooksPath` already points at `.husky/_`
 * overwrites husky's own hook shim at that path outright.
 *
 * Fix: whichever framework bootstraps second doesn't fight over the hook
 * file — it delegates. If pre-commit is configured (`.pre-commit-config.yaml`
 * exists) when husky bootstraps, `.husky/pre-commit` gets a trailing
 * `pre-commit run --hook-stage commit "$@"` line appended so pre-commit's
 * checks still execute through husky's now-active hook. If husky already
 * owns `core.hooksPath` when pre-commit bootstraps, its native
 * `pre-commit install` for the `pre-commit` hook type is skipped (it would
 * clobber husky's shim) and the same delegate line is appended instead;
 * `commit-msg` is a distinct hook file so pre-commit's `--hook-type
 * commit-msg` install still runs natively without conflict either way.
 */
export async function bootstrapHooks(ctx: InstallContext, plan: InstallPlan): Promise<StepResult> {
  if (ctx.dryRun) {
    const action = plan.stack === 'python' ? 'pre-commit install' : 'npx husky init';
    return {
      step: '8/12 Bootstrap hook framework',
      status: 'planned',
      message: `would run \`${action}\` in ${ctx.repoRoot}`,
    };
  }
  if (plan.stack === 'python') return bootstrapPython(ctx);
  return bootstrapNode(ctx);
}

async function bootstrapPython(ctx: InstallContext): Promise<StepResult> {
  if (!(await commandExists('pre-commit'))) {
    return {
      step: '8/12 Bootstrap hook framework',
      status: 'warn',
      message: 'pre-commit not on PATH — run `pip install pre-commit && pre-commit install` manually',
    };
  }
  const huskyOwnsHooks = await dirExists(join(ctx.repoRoot, '.husky'));
  if (huskyOwnsHooks) {
    // Coexistence (#697): husky already owns core.hooksPath. Installing
    // pre-commit's own `pre-commit` hook natively would overwrite husky's
    // shim at that path — delegate into husky's hook instead. `commit-msg`
    // is a separate hook file husky doesn't create, so it installs natively.
    const delegated = await ensurePreCommitDelegated(ctx.repoRoot);
    await execa('pre-commit', ['install', '--hook-type', 'commit-msg'], { cwd: ctx.repoRoot, stdio: 'inherit' });
    return {
      step: '8/12 Bootstrap hook framework',
      status: 'ok',
      message: delegated
        ? 'husky already owns hooks — delegated pre-commit into .husky/pre-commit, installed commit-msg hook natively'
        : 'husky already owns hooks — pre-commit already delegated in .husky/pre-commit, installed commit-msg hook natively',
    };
  }
  await execa('pre-commit', ['install'], { cwd: ctx.repoRoot, stdio: 'inherit' });
  await execa('pre-commit', ['install', '--hook-type', 'commit-msg'], { cwd: ctx.repoRoot, stdio: 'inherit' });
  return { step: '8/12 Bootstrap hook framework', status: 'ok', message: 'pre-commit hooks installed' };
}

async function bootstrapNode(ctx: InstallContext): Promise<StepResult> {
  const huskyDir = join(ctx.repoRoot, '.husky');
  if (await dirExists(huskyDir)) {
    // Coexistence (#697): husky's already bootstrapped (this run or a prior
    // target's), but pre-commit may have been configured for a Python
    // target since then without husky's hook re-running — make sure the
    // delegate line is present either way.
    const delegated = (await preCommitConfigured(ctx.repoRoot)) && (await ensurePreCommitDelegated(ctx.repoRoot));
    return {
      step: '8/12 Bootstrap hook framework',
      status: 'ok',
      message: delegated ? '.husky/ already exists — delegated pre-commit into .husky/pre-commit' : '.husky/ already exists',
    };
  }
  if (!(await commandExists('npx'))) {
    return {
      step: '8/12 Bootstrap hook framework',
      status: 'warn',
      message: 'npx not on PATH — run `npx husky init` manually',
    };
  }
  await execa('npx', ['husky', 'init'], { cwd: ctx.projectPath, stdio: 'inherit' });
  await relocateHuskyToRepoRoot(ctx);
  // Coexistence (#697): a Python target's pre-commit may already be
  // configured (installed before this Node target's husky bootstrap ran,
  // in this same repo) — delegate into the fresh husky hook so its checks
  // keep firing now that husky owns core.hooksPath.
  const delegated = (await preCommitConfigured(ctx.repoRoot)) && (await ensurePreCommitDelegated(ctx.repoRoot));
  return {
    step: '8/12 Bootstrap hook framework',
    status: 'ok',
    message: delegated ? '.husky/ bootstrapped — delegated pre-commit into .husky/pre-commit' : '.husky/ bootstrapped',
  };
}
