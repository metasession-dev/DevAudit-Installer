import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { logger } from '../../lib/logger.js';
import { PLUGINS_DIR } from '../../lib/paths.js';
import { loadPluginFromDir } from '../../lib/plugin/index.js';

export interface PluginInstallOptions {
  readonly source: string;
  readonly root?: string;
}

function deriveDirName(source: string): string {
  const last = source.split('/').pop() ?? source;
  return last.replace(/\.git$/, '');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runPluginInstall(opts: PluginInstallOptions): Promise<void> {
  const log = logger();
  const root = opts.root ?? PLUGINS_DIR;
  const dirName = deriveDirName(opts.source);
  if (!dirName) {
    log.error(`Could not derive a directory name from source: ${opts.source}`);
    process.exit(2);
  }
  await fs.mkdir(root, { recursive: true });
  const target = join(root, dirName);
  if (await pathExists(target)) {
    log.error(`Plugin directory already exists: ${target}. Run \`devaudit plugin remove ${dirName}\` first.`);
    process.exit(2);
  }
  log.info(`Cloning ${opts.source} → ${target}`);
  try {
    await execa('git', ['clone', '--depth', '1', opts.source, target], { stdio: 'inherit' });
  } catch (err) {
    log.error(`git clone failed: ${(err as Error).message}`);
    process.exit(6);
  }
  if (await pathExists(join(target, 'package.json'))) {
    log.info('Installing plugin dependencies...');
    const install = await execa('npm', ['install', '--legacy-peer-deps'], {
      cwd: target,
      stdio: 'inherit',
      reject: false,
    });
    if (install.exitCode !== 0) {
      log.error('npm install failed — leaving the plugin dir in place for inspection.');
      process.exit(5);
    }
  }
  log.info('Validating plugin manifest...');
  try {
    const loaded = await loadPluginFromDir(target);
    log.success(`Installed: ${loaded.packageName}@${loaded.packageVersion} at ${target}`);
  } catch (err) {
    log.error(`Plugin validation failed: ${(err as Error).message}`);
    log.warn(`Removing ${target}`);
    await fs.rm(target, { recursive: true, force: true });
    process.exit(9);
  }
}
