import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

interface ExecaCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

const execaCalls: ExecaCall[] = [];

vi.mock('execa', () => ({
  execa: async (file: string, args: readonly string[] = [], opts: { cwd?: string } = {}) => {
    const entry: ExecaCall = { file, args, ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}) };
    execaCalls.push(entry);
    if (file === 'git' && args[0] === 'clone') {
      const dest = args[args.length - 1];
      if (typeof dest === 'string') {
        await fs.mkdir(dest, { recursive: true });
        await fs.mkdir(join(dest, '.git'), { recursive: true });
        await fs.writeFile(
          join(dest, 'package.json'),
          JSON.stringify({
            name: 'devaudit-plugin-clone-fixture',
            version: '0.0.2',
            type: 'module',
            main: './plugin.js',
            devaudit: { apiVersion: '1' },
          }),
        );
        await fs.writeFile(
          join(dest, 'plugin.js'),
          "export default { name: 'devaudit-plugin-clone-fixture', apiVersion: '1' };\n",
        );
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (file === 'git' && args[0] === 'pull') {
      return { exitCode: 0, stdout: 'Already up to date.', stderr: '' };
    }
    if (file === 'npm' && args[0] === 'install') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  },
}));

let root = '';

async function writePlugin(parent: string, name: string, opts: { gitDir?: boolean } = {}): Promise<void> {
  const dir = join(parent, name);
  await fs.mkdir(dir, { recursive: true });
  if (opts.gitDir) await fs.mkdir(join(dir, '.git'), { recursive: true });
  await fs.writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '0.0.1',
      type: 'module',
      main: './plugin.js',
      devaudit: { apiVersion: '1', commands: [{ name: 'noop', description: 'No-op' }] },
    }),
  );
  await fs.writeFile(
    join(dir, 'plugin.js'),
    `export default { name: '${name}', apiVersion: '1', commands: { noop: async () => {} } };\n`,
  );
}

beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'cli-plugin-cmds-'));
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
afterEach(() => {
  execaCalls.length = 0;
});

describe('plugin commands', () => {
  it('list returns no-plugins messaging when dir is empty', async () => {
    const { runPluginList } = await import('../src/commands/plugin/list.js');
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-plugin-empty-'));
    try {
      await runPluginList({ root: dir });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('list reports loaded plugins with hooks + commands', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-plugin-list-'));
    try {
      await writePlugin(dir, 'devaudit-plugin-listed');
      const { runPluginList } = await import('../src/commands/plugin/list.js');
      await runPluginList({ root: dir });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('install clones, npm-installs, and validates', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-plugin-install-'));
    try {
      const { runPluginInstall } = await import('../src/commands/plugin/install.js');
      await runPluginInstall({
        source: 'git@github.com:foo/devaudit-plugin-clone-fixture.git',
        root: dir,
      });
      const gitCall = execaCalls.find((c) => c.file === 'git' && c.args[0] === 'clone');
      const npmCall = execaCalls.find((c) => c.file === 'npm' && c.args[0] === 'install');
      expect(gitCall).toBeDefined();
      expect(npmCall).toBeDefined();
      // The clone fixture mock created a real plugin dir; verify it exists
      const target = join(dir, 'devaudit-plugin-clone-fixture');
      expect((await fs.stat(target)).isDirectory()).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('remove rm-rfs the plugin directory', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-plugin-remove-'));
    try {
      await writePlugin(dir, 'devaudit-plugin-toremove');
      const { runPluginRemove } = await import('../src/commands/plugin/remove.js');
      await runPluginRemove({ name: 'devaudit-plugin-toremove', root: dir });
      await expect(fs.access(join(dir, 'devaudit-plugin-toremove'))).rejects.toThrow();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('remove exits with code 2 when nothing matches', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-plugin-remove-miss-'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      const { runPluginRemove } = await import('../src/commands/plugin/remove.js');
      await runPluginRemove({ name: 'does-not-exist', root: dir });
      expect(exitSpy).toHaveBeenCalledWith(2);
    } finally {
      exitSpy.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('update calls git pull + npm install for git-backed plugins', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-plugin-update-'));
    try {
      await writePlugin(dir, 'devaudit-plugin-git', { gitDir: true });
      await writePlugin(dir, 'devaudit-plugin-nongit');
      const { runPluginUpdate } = await import('../src/commands/plugin/update.js');
      await runPluginUpdate({ root: dir });
      const pullCalls = execaCalls.filter((c) => c.file === 'git' && c.args[0] === 'pull');
      const npmCalls = execaCalls.filter((c) => c.file === 'npm' && c.args[0] === 'install');
      // Only the git-backed plugin should have been pull'd
      expect(pullCalls).toHaveLength(1);
      expect(npmCalls).toHaveLength(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
