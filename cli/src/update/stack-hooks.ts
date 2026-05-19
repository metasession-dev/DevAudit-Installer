import { join } from 'node:path';
import { copyFile, exists, isDir } from '../lib/fs-utils.js';
import { loadStackAdapter } from '../lib/adapter.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2c: Stack hooks (e.g. husky for node).
 *
 * Copies hooks listed in the adapter's `hooks` array into the consumer's
 * `<hook_install_dir>/` (e.g. .husky/). Also copies `hook_config_files`
 * (e.g. commitlint.config.mjs, lint-staged.config.mjs, .prettierrc.json)
 * to the consumer's repo root.
 *
 * Skipped if the consumer hasn't bootstrapped the hook framework yet
 * (the install dir doesn't exist).
 */
export async function syncStackHooks(ctx: SyncContext): Promise<SectionResult> {
  const adapter = await loadStackAdapter(ctx.installerRoot, ctx.stack);
  const hookInstallDir = adapter.hook_install_dir ?? '';
  if (!hookInstallDir) {
    return { name: `${ctx.stack} hooks`, filesSynced: 0, skipped: true, message: 'no hook_install_dir declared' };
  }
  const targetDir = join(ctx.projectPath, hookInstallDir);
  if (!(await isDir(targetDir))) {
    return {
      name: `${ctx.stack} hooks`,
      filesSynced: 0,
      skipped: true,
      message: `${hookInstallDir}/ not found — bootstrap hook framework first`,
    };
  }
  const stackHooksDir = join(ctx.installerRoot, 'sdlc', 'files', 'stacks', ctx.stack, 'hooks');
  if (!(await isDir(stackHooksDir))) {
    return { name: `${ctx.stack} hooks`, filesSynced: 0, skipped: true, message: 'stack has no hooks/' };
  }
  let count = 0;
  for (const hook of adapter.hooks ?? []) {
    const src = join(stackHooksDir, hook);
    if (await exists(src)) {
      const dst = join(targetDir, hook);
      await copyFile(src, dst, 0o755);
      count += 1;
    }
  }
  for (const cfg of adapter.hook_config_files ?? []) {
    const src = join(stackHooksDir, cfg);
    if (await exists(src)) {
      const dst = join(ctx.projectPath, cfg);
      await copyFile(src, dst);
      count += 1;
    }
  }
  return { name: `${ctx.stack} hooks`, filesSynced: count, message: `synced to ${hookInstallDir}/` };
}
