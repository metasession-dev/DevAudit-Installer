import type { Command } from 'commander';
import { resolve } from 'node:path';
import { logger } from '../logger.js';
import { buildPluginContext } from './context.js';
import type { LoadedPlugin } from './types.js';

export function registerPluginCommands(program: Command, plugins: readonly LoadedPlugin[]): void {
  for (const p of plugins) {
    const namespace = pluginNamespace(p.packageName);
    const manifestCommands = p.manifest.commands ?? [];
    if (manifestCommands.length === 0) continue;
    const group = program.command(namespace).description(p.manifest.displayName ?? p.packageName);
    for (const c of manifestCommands) {
      const impl = p.plugin.commands?.[c.name];
      if (!impl) continue;
      group
        .command(`${c.name} [args...]`)
        .description(c.description)
        .action(async (args: string[]) => {
          const log = logger();
          const projectPath = resolve(process.cwd());
          const ctx = await buildPluginContext({ projectPath });
          try {
            await impl(ctx, args);
          } catch (err) {
            log.error(`Plugin '${p.packageName}' command '${c.name}' failed: ${(err as Error).message}`);
            process.exit(1);
          }
        });
    }
  }
}

function pluginNamespace(packageName: string): string {
  return packageName.replace(/^@[^/]+\//, '').replace(/^devaudit-plugin-/, '');
}
