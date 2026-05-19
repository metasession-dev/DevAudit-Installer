import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discoverPlugins,
  loadPluginFromDir,
  registerPluginCommands,
  runHook,
  buildPluginContext,
} from '../src/lib/plugin/index.js';

interface FixturePluginOptions {
  readonly hookFn?: string;
  readonly commandFn?: string;
  readonly hooks?: readonly string[];
  readonly commands?: readonly { readonly name: string; readonly description: string }[];
  readonly apiVersion?: string;
}

async function writeFixturePlugin(parent: string, name: string, opts: FixturePluginOptions = {}): Promise<string> {
  const dir = join(parent, name);
  await fs.mkdir(dir, { recursive: true });
  const pkg: Record<string, unknown> = {
    name,
    version: '0.0.1',
    type: 'module',
    main: './plugin.js',
    devaudit: {
      apiVersion: opts.apiVersion ?? '1',
      displayName: `${name} fixture`,
      hooks: opts.hooks ?? ['afterUpdate'],
      ...(opts.commands ? { commands: opts.commands } : {}),
    },
  };
  await fs.writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  const hookSrc = opts.hookFn ?? "async (ctx) => { ctx.emit({ type: 'fixture-hook-fired' }); }";
  const cmdSrc =
    opts.commandFn ?? "async (ctx, args) => { ctx.emit({ type: 'fixture-cmd-fired', payload: { args } }); }";
  const commandsMap = (opts.commands ?? []).map((c) => `'${c.name}': ${cmdSrc}`).join(',\n    ');
  const hookEntries = (opts.hooks ?? ['afterUpdate']).map((h) => `${h}: ${hookSrc}`).join(',\n    ');
  const src = `export default {
  name: '${name}',
  apiVersion: '1',
  hooks: {
    ${hookEntries}
  },
  commands: {
    ${commandsMap}
  },
};
`;
  await fs.writeFile(join(dir, 'plugin.js'), src);
  return dir;
}

async function buildPluginsRoot(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), 'cli-plugins-root-'));
}

let root = '';
beforeAll(async () => {
  root = await buildPluginsRoot();
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('discoverPlugins + loadPluginFromDir', () => {
  it('discovers a valid plugin', async () => {
    const dir = await buildPluginsRoot();
    try {
      await writeFixturePlugin(dir, 'devaudit-plugin-fixture-alpha');
      const result = await discoverPlugins(dir);
      expect(result.failures).toHaveLength(0);
      expect(result.loaded).toHaveLength(1);
      expect(result.loaded[0]?.packageName).toBe('devaudit-plugin-fixture-alpha');
      expect(result.loaded[0]?.plugin.hooks?.afterUpdate).toBeTypeOf('function');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns empty result when plugin dir does not exist', async () => {
    const result = await discoverPlugins(join(tmpdir(), 'definitely-does-not-exist-' + Date.now()));
    expect(result.loaded).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
  });

  it('reports failures for invalid manifests without crashing', async () => {
    const dir = await buildPluginsRoot();
    try {
      // Create a plugin dir with bad manifest (missing devaudit field)
      const badDir = join(dir, 'devaudit-plugin-bad');
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(
        join(badDir, 'package.json'),
        JSON.stringify({ name: 'devaudit-plugin-bad', version: '0.0.1', main: './x.js' }),
      );
      // And a valid sibling so we can confirm discovery continues
      await writeFixturePlugin(dir, 'devaudit-plugin-good');
      const result = await discoverPlugins(dir);
      expect(result.loaded).toHaveLength(1);
      expect(result.loaded[0]?.packageName).toBe('devaudit-plugin-good');
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.reason).toMatch(/devaudit/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a plugin whose runtime apiVersion does not match the manifest', async () => {
    const dir = await buildPluginsRoot();
    try {
      const pluginDir = await writeFixturePlugin(dir, 'devaudit-plugin-mismatch');
      // Overwrite plugin.js with runtime apiVersion=2
      await fs.writeFile(
        join(pluginDir, 'plugin.js'),
        "export default { name: 'devaudit-plugin-mismatch', apiVersion: '2', hooks: {}, commands: {} };\n",
      );
      await expect(loadPluginFromDir(pluginDir)).rejects.toThrow(/apiVersion '2' at runtime/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runHook (error isolation)', () => {
  it('runs hooks and isolates errors per plugin', async () => {
    const dir = await buildPluginsRoot();
    try {
      await writeFixturePlugin(dir, 'devaudit-plugin-ok', {
        hookFn: "async (ctx) => { ctx.emit({ type: 'ok' }); }",
      });
      await writeFixturePlugin(dir, 'devaudit-plugin-boom', {
        hookFn: "async () => { throw new Error('boom'); }",
      });
      const discovered = await discoverPlugins(dir);
      expect(discovered.loaded).toHaveLength(2);
      const events: unknown[] = [];
      const ctx = await buildPluginContext({ projectPath: dir, events: events as never });
      const results = await runHook(discovered.loaded, 'afterUpdate', ctx);
      const ok = results.find((r) => r.plugin === 'devaudit-plugin-ok');
      const boom = results.find((r) => r.plugin === 'devaudit-plugin-boom');
      expect(ok?.status).toBe('ok');
      expect(boom?.status).toBe('error');
      expect(boom?.message).toMatch(/boom/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('marks skipped when plugin does not declare the hook', async () => {
    const dir = await buildPluginsRoot();
    try {
      await writeFixturePlugin(dir, 'devaudit-plugin-no-onDoctor');
      const discovered = await discoverPlugins(dir);
      const ctx = await buildPluginContext({ projectPath: dir });
      const results = await runHook(discovered.loaded, 'onDoctor', ctx);
      expect(results[0]?.status).toBe('skipped');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('registerPluginCommands', () => {
  it('adds a plugin subcommand group with one command', async () => {
    const dir = await buildPluginsRoot();
    try {
      await writeFixturePlugin(dir, 'devaudit-plugin-cmd-host', {
        commands: [{ name: 'do-thing', description: 'Does a fixture thing' }],
      });
      const discovered = await discoverPlugins(dir);
      const program = new Command();
      program.exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });
      registerPluginCommands(program, discovered.loaded);
      const help = program.helpInformation();
      expect(help).toMatch(/cmd-host/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
