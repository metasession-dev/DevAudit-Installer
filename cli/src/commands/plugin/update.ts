import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { logger } from '../../lib/logger.js';
import { PLUGINS_DIR } from '../../lib/paths.js';
import { discoverPlugins } from '../../lib/plugin/index.js';

export interface PluginUpdateOptions {
  readonly root?: string;
}

type UpdateStatus = 'updated' | 'no-changes' | 'not-git' | 'failed';

interface UpdateResult {
  readonly plugin: string;
  readonly status: UpdateStatus;
  readonly detail?: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function updateOne(dir: string, packageName: string): Promise<UpdateResult> {
  if (!(await pathExists(join(dir, '.git')))) {
    return { plugin: packageName, status: 'not-git' };
  }
  const pull = await execa('git', ['pull', '--ff-only'], { cwd: dir, reject: false });
  if (pull.exitCode !== 0) {
    return { plugin: packageName, status: 'failed', detail: pull.stderr.split('\n')[0] };
  }
  const noChanges = /Already up to date/i.test(pull.stdout);
  if (await pathExists(join(dir, 'package.json'))) {
    const install = await execa('npm', ['install', '--legacy-peer-deps'], {
      cwd: dir,
      reject: false,
    });
    if (install.exitCode !== 0) {
      return { plugin: packageName, status: 'failed', detail: 'npm install failed after pull' };
    }
  }
  return { plugin: packageName, status: noChanges ? 'no-changes' : 'updated' };
}

export async function runPluginUpdate(opts: PluginUpdateOptions = {}): Promise<void> {
  const log = logger();
  const root = opts.root ?? PLUGINS_DIR;
  const discovery = await discoverPlugins(root);
  if (discovery.loaded.length === 0) {
    log.info('No plugins installed.');
    return;
  }
  log.info(`Updating ${discovery.loaded.length} plugin(s)...`);
  const results: UpdateResult[] = [];
  for (const p of discovery.loaded) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await updateOne(p.dir, p.packageName));
  }
  for (const r of results) {
    if (r.status === 'updated') log.success(`  ✓ ${r.plugin} — updated`);
    else if (r.status === 'no-changes') log.log(`  · ${r.plugin} — already up to date`);
    else if (r.status === 'not-git') log.warn(`  ⚠ ${r.plugin} — not a git checkout, skipped`);
    else log.error(`  ✗ ${r.plugin} — ${r.detail ?? 'failed'}`);
  }
}
