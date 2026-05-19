import { promises as fs } from 'node:fs';
import { basename } from 'node:path';
import { logger } from '../../lib/logger.js';
import { PLUGINS_DIR } from '../../lib/paths.js';
import { discoverPlugins } from '../../lib/plugin/index.js';

export interface PluginRemoveOptions {
  readonly name: string;
  readonly root?: string;
}

export async function runPluginRemove(opts: PluginRemoveOptions): Promise<void> {
  const log = logger();
  const root = opts.root ?? PLUGINS_DIR;
  const discovery = await discoverPlugins(root);
  const candidates = [
    ...discovery.loaded.map((p) => ({ packageName: p.packageName, dir: p.dir })),
    ...discovery.failures.map((f) => ({ packageName: basename(f.dir), dir: f.dir })),
  ];
  const match = candidates.find((c) => c.packageName === opts.name || basename(c.dir) === opts.name);
  if (!match) {
    log.error(`No plugin found matching '${opts.name}'.`);
    log.info('Run `devaudit plugin list` to see installed plugins.');
    process.exit(2);
    return;
  }
  await fs.rm(match.dir, { recursive: true, force: true });
  log.success(`Removed plugin at ${match.dir}`);
}
