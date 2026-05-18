import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { exists } from '../lib/fs-utils.js';
import { loadStackAdapter } from '../lib/adapter.js';
import type { SyncContext, SectionResult } from './types.js';

interface PartialPackageJson {
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/**
 * Section 2c-ii: Install missing stack devDependencies (node only for now).
 *
 * Preserves the fix from META-COMPLY #313 / #314: surface npm install
 * failures (no `2>/dev/null`) and retry with `--legacy-peer-deps` if the
 * first attempt fails. Abort the sync if both attempts fail.
 */
export async function syncStackDeps(ctx: SyncContext): Promise<SectionResult> {
  if (ctx.stack !== 'node') {
    return { name: `${ctx.stack} deps`, filesSynced: 0, skipped: true };
  }
  const pkgPath = join(ctx.projectPath, 'package.json');
  if (!(await exists(pkgPath))) {
    return { name: `${ctx.stack} deps`, filesSynced: 0, skipped: true, message: 'no package.json' };
  }
  const adapter = await loadStackAdapter(ctx.installerRoot, ctx.stack);
  const required = adapter.required_dev_dependencies ?? [];
  if (required.length === 0) {
    return { name: `${ctx.stack} deps`, filesSynced: 0, message: 'no required_dev_dependencies declared' };
  }
  const raw = await fs.readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw) as PartialPackageJson;
  const installed = new Set(Object.keys(pkg.devDependencies ?? {}));
  const missing = required.filter((dep) => !installed.has(dep));
  if (missing.length === 0) {
    return { name: `${ctx.stack} deps`, filesSynced: 0, message: 'all present' };
  }
  const args = ['install', '--save-dev', ...missing];
  const first = await execa('npm', args, { cwd: ctx.projectPath, reject: false, stdio: 'inherit' });
  if (first.exitCode === 0) {
    return { name: `${ctx.stack} deps`, filesSynced: missing.length, message: `installed ${missing.join(' ')}` };
  }
  const legacyArgs = ['install', '--save-dev', '--legacy-peer-deps', ...missing];
  const second = await execa('npm', legacyArgs, { cwd: ctx.projectPath, reject: false, stdio: 'inherit' });
  if (second.exitCode === 0) {
    return {
      name: `${ctx.stack} deps`,
      filesSynced: missing.length,
      message: `installed ${missing.join(' ')} (with --legacy-peer-deps)`,
    };
  }
  throw new Error(
    `Failed to install ${ctx.stack} deps. Fix manually: cd ${ctx.projectPath} && npm install --save-dev ${missing.join(' ')}`,
  );
}
