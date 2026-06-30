import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { exists } from '../lib/fs-utils.js';
import { loadStackAdapter } from '../lib/adapter.js';
import { logger } from '../lib/logger.js';
import type { SyncContext, SectionResult } from './types.js';

interface PartialPackageJson {
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Record<string, string>;
}

const PLAYWRIGHT_POSTINSTALL = 'playwright install chromium';
const PLAYWRIGHT_DEP = '@playwright/test';

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
    const added = await ensurePostinstallScript(pkgPath, required);
    return { name: `${ctx.stack} deps`, filesSynced: 0, message: added ? 'all present, added postinstall' : 'all present' };
  }
  const args = ['install', '--save-dev', ...missing];
  const first = await execa('npm', args, { cwd: ctx.projectPath, reject: false, stdio: 'inherit' });
  if (first.exitCode === 0) {
    const added = await ensurePostinstallScript(pkgPath, required);
    return { name: `${ctx.stack} deps`, filesSynced: missing.length, message: `installed ${missing.join(' ')}${added ? ', added postinstall' : ''}` };
  }
  const legacyArgs = ['install', '--save-dev', '--legacy-peer-deps', ...missing];
  const second = await execa('npm', legacyArgs, { cwd: ctx.projectPath, reject: false, stdio: 'inherit' });
  if (second.exitCode === 0) {
    const added = await ensurePostinstallScript(pkgPath, required);
    return {
      name: `${ctx.stack} deps`,
      filesSynced: missing.length,
      message: `installed ${missing.join(' ')} (with --legacy-peer-deps)${added ? ', added postinstall' : ''}`,
    };
  }
  throw new Error(
    `Failed to install ${ctx.stack} deps. Fix manually: cd ${ctx.projectPath} && npm install --save-dev ${missing.join(' ')}`,
  );
}

/**
 * Ensure the consumer's package.json has a `postinstall` script that
 * installs Playwright browsers, but only if `@playwright/test` is in the
 * adapter's `required_dev_dependencies`. Idempotent: does not overwrite
 * an existing postinstall unless it's a bare match.
 *
 * DevAudit-Installer#245.
 */
export async function ensurePostinstallScript(
  pkgPath: string,
  requiredDeps: readonly string[],
): Promise<boolean> {
  if (!requiredDeps.includes(PLAYWRIGHT_DEP)) {
    return false;
  }
  const raw = await fs.readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw) as PartialPackageJson & { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};
  const existing = scripts['postinstall'];

  if (existing === PLAYWRIGHT_POSTINSTALL) {
    return false;
  }
  if (existing && !existing.includes('playwright install')) {
    logger().warn(
      `  postinstall script already exists ("${existing}") — not overwriting. Add "playwright install chromium" manually if needed.`,
    );
    return false;
  }

  scripts['postinstall'] = PLAYWRIGHT_POSTINSTALL;
  pkg.scripts = scripts;
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  return true;
}
