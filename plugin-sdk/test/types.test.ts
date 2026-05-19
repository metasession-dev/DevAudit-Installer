import { describe, it, expectTypeOf } from 'vitest';
import type { LifecycleHook, Plugin, PluginContext } from '../src/types.js';

describe('Plugin types', () => {
  it('compiles a minimal plugin shape', () => {
    const plugin: Plugin = {
      name: 'devaudit-plugin-fixture',
      apiVersion: '1',
    };
    expectTypeOf(plugin.name).toBeString();
  });

  it('compiles a plugin with hooks and commands', () => {
    const afterUpdate: LifecycleHook = async (ctx: PluginContext) => {
      ctx.logger.info(`updated at ${ctx.projectPath}`);
    };
    const plugin: Plugin = {
      name: 'devaudit-plugin-fixture',
      apiVersion: '1',
      hooks: { afterUpdate },
      commands: {
        'do-thing': async (ctx, args) => {
          ctx.logger.debug(`args=${args.join(',')}`);
        },
      },
    };
    expectTypeOf(plugin.hooks?.afterUpdate).toMatchTypeOf<LifecycleHook | undefined>();
  });
});
