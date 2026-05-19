import type { LifecycleHookName, PluginContext } from '@metasession-dev/devaudit-plugin-sdk';
import { logger } from '../logger.js';
import type { LoadedPlugin } from './types.js';

export interface HookRunResult {
  readonly plugin: string;
  readonly hook: LifecycleHookName;
  readonly status: 'ok' | 'error' | 'skipped';
  readonly message?: string;
}

export async function runHook(
  plugins: readonly LoadedPlugin[],
  hook: LifecycleHookName,
  ctx: PluginContext,
): Promise<readonly HookRunResult[]> {
  const log = logger();
  const results: HookRunResult[] = [];
  for (const p of plugins) {
    const fn = p.plugin.hooks?.[hook];
    if (!fn) {
      results.push({ plugin: p.packageName, hook, status: 'skipped' });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await fn(ctx);
      results.push({ plugin: p.packageName, hook, status: 'ok' });
    } catch (err) {
      const message = (err as Error).message;
      log.warn(`Plugin '${p.packageName}' hook '${hook}' threw: ${message}`);
      results.push({ plugin: p.packageName, hook, status: 'error', message });
    }
  }
  return results;
}
