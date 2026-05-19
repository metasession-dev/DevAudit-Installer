import { discoverPlugins } from '../../lib/plugin/index.js';
import { logger } from '../../lib/logger.js';
import { PLUGINS_DIR } from '../../lib/paths.js';

export interface PluginListOptions {
  readonly root?: string;
}

export async function runPluginList(opts: PluginListOptions = {}): Promise<void> {
  const log = logger();
  const root = opts.root ?? PLUGINS_DIR;
  const result = await discoverPlugins(root);
  log.info(`Plugin directory: ${root}`);
  if (result.loaded.length === 0 && result.failures.length === 0) {
    log.log('  (no plugins installed)');
    return;
  }
  if (result.loaded.length > 0) {
    log.log('');
    log.log('Loaded:');
    for (const p of result.loaded) {
      const hooks = Object.keys(p.plugin.hooks ?? {});
      const commands = Object.keys(p.plugin.commands ?? {});
      const detail = [
        `${p.packageName}@${p.packageVersion}`,
        hooks.length > 0 ? `hooks=[${hooks.join(',')}]` : 'hooks=[]',
        commands.length > 0 ? `commands=[${commands.join(',')}]` : 'commands=[]',
      ].join(' ');
      log.log(`  ✓ ${detail}`);
    }
  }
  if (result.failures.length > 0) {
    log.log('');
    log.warn('Failed to load:');
    for (const f of result.failures) {
      log.log(`  ✗ ${f.dir} — ${f.reason}`);
    }
  }
}
