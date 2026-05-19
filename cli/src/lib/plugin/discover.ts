import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PLUGINS_DIR } from '../paths.js';
import { loadPluginFromDir } from './load.js';
import type { DiscoveryResult, LoadedPlugin, PluginLoadFailure } from './types.js';

async function listSubdirs(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function discoverPlugins(root: string = PLUGINS_DIR): Promise<DiscoveryResult> {
  const dirs = await listSubdirs(root);
  const loaded: LoadedPlugin[] = [];
  const failures: PluginLoadFailure[] = [];
  for (const dir of dirs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      loaded.push(await loadPluginFromDir(dir));
    } catch (err) {
      failures.push({ dir, reason: (err as Error).message });
    }
  }
  return { loaded, failures };
}
