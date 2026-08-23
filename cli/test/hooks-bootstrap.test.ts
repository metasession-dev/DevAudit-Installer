import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

interface ExecaCall {
  readonly file: string;
  readonly args: readonly string[];
}

const execaCalls: ExecaCall[] = [];

vi.mock('execa', () => ({
  execa: async (file: string, args: readonly string[] = [], opts: { cwd?: string } = {}) => {
    execaCalls.push({ file, args });
    if (file === 'which' || file === 'where') {
      return { exitCode: 0, stdout: `/usr/bin/${args[0]}`, stderr: '' };
    }
    if (file === 'npx' && args[0] === 'husky' && args[1] === 'init' && opts.cwd) {
      // Mimic real `npx husky init`'s effect so the post-init delegate-append
      // step (which reads .husky/pre-commit off disk) has something real to
      // operate on — execa itself is mocked and has no real side effects.
      await fs.mkdir(join(opts.cwd, '.husky'), { recursive: true });
      await fs.writeFile(join(opts.cwd, '.husky', 'pre-commit'), 'npm test\n');
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  },
}));

function baseCtx(projectPath: string, repoRoot: string = projectPath) {
  return {
    projectPath,
    repoRoot,
    projectName: 'fixture',
    installerRoot: '/dev/null',
    token: 'tok',
    baseUrl: 'https://devaudit.test',
    dryRun: false,
    nonInteractive: true,
    addTarget: false,
    installMode: 'operator' as const,
  };
}

function basePlan(stack: 'node' | 'python') {
  return {
    stack,
    host: 'railway' as const,
    projectSlug: 'fixture',
    runtimeVersion: stack === 'node' ? '20' : '3.11',
    sourceDirs: 'src/',
    workingDirectory: '.',
    prodUrlSecretName: 'FIXTURE_PROD_URL',
    prodUrlValue: '',
    apiKeySecretName: 'DEVAUDIT_API_KEY',
  };
}

async function mkdtemp(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), 'hooks-bootstrap-'));
}

afterEach(() => {
  execaCalls.length = 0;
});

describe('bootstrapHooks — husky/pre-commit coexistence (#689/#697)', () => {
  it('Node target: no pre-commit config present — bootstraps husky as before, no delegate line', async () => {
    const { bootstrapHooks } = await import('../src/install/hooks-bootstrap.js');
    const dir = await mkdtemp();
    try {
      const result = await bootstrapHooks(baseCtx(dir), basePlan('node'));
      expect(result.status).toBe('ok');
      expect(result.message).toBe('.husky/ bootstrapped');
      const huskyCall = execaCalls.find((c) => c.file === 'npx' && c.args[0] === 'husky');
      expect(huskyCall).toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('Node target bootstrapping after Python: delegates pre-commit into the freshly-bootstrapped .husky/pre-commit', async () => {
    const { bootstrapHooks } = await import('../src/install/hooks-bootstrap.js');
    const dir = await mkdtemp();
    try {
      await fs.writeFile(join(dir, '.pre-commit-config.yaml'), 'repos: []\n');
      const result = await bootstrapHooks(baseCtx(dir), basePlan('node'));
      expect(result.status).toBe('ok');
      expect(result.message).toContain('delegated pre-commit');
      const huskyCall = execaCalls.find((c) => c.file === 'npx' && c.args[0] === 'husky');
      expect(huskyCall).toBeDefined();
      const hookContent = await fs.readFile(join(dir, '.husky', 'pre-commit'), 'utf-8');
      expect(hookContent).toContain('npm test');
      expect(hookContent).toContain('pre-commit run --hook-stage commit "$@"');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('Python target: husky not present — installs pre-commit natively as before', async () => {
    const { bootstrapHooks } = await import('../src/install/hooks-bootstrap.js');
    const dir = await mkdtemp();
    try {
      const result = await bootstrapHooks(baseCtx(dir), basePlan('python'));
      expect(result.status).toBe('ok');
      expect(result.message).toBe('pre-commit hooks installed');
      const installCall = execaCalls.find((c) => c.file === 'pre-commit' && c.args[0] === 'install' && c.args.length === 1);
      expect(installCall).toBeDefined();
      const commitMsgCall = execaCalls.find((c) => c.file === 'pre-commit' && c.args.includes('commit-msg'));
      expect(commitMsgCall).toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('Python target bootstrapping after Node: delegates into .husky/pre-commit instead of clobbering it, still installs commit-msg natively', async () => {
    const { bootstrapHooks } = await import('../src/install/hooks-bootstrap.js');
    const dir = await mkdtemp();
    try {
      await fs.mkdir(join(dir, '.husky'), { recursive: true });
      await fs.writeFile(join(dir, '.husky', 'pre-commit'), 'npm test\n');
      const result = await bootstrapHooks(baseCtx(dir), basePlan('python'));
      expect(result.status).toBe('ok');
      expect(result.message).toContain('delegated pre-commit');
      const hookContent = await fs.readFile(join(dir, '.husky', 'pre-commit'), 'utf-8');
      expect(hookContent).toContain('npm test');
      expect(hookContent).toContain('pre-commit run --hook-stage commit "$@"');
      // The native `pre-commit install` (no --hook-type) call — which would
      // have overwritten husky's shim under the shared hooksPath — must NOT
      // have been made.
      const plainInstallCall = execaCalls.find(
        (c) => c.file === 'pre-commit' && c.args[0] === 'install' && c.args.length === 1,
      );
      expect(plainInstallCall).toBeUndefined();
      const commitMsgCall = execaCalls.find((c) => c.file === 'pre-commit' && c.args.includes('commit-msg'));
      expect(commitMsgCall).toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('delegate append is idempotent — running twice does not duplicate the line', async () => {
    const { bootstrapHooks } = await import('../src/install/hooks-bootstrap.js');
    const dir = await mkdtemp();
    try {
      await fs.mkdir(join(dir, '.husky'), { recursive: true });
      await fs.writeFile(join(dir, '.husky', 'pre-commit'), 'npm test\n');
      await bootstrapHooks(baseCtx(dir), basePlan('python'));
      await bootstrapHooks(baseCtx(dir), basePlan('python'));
      const hookContent = await fs.readFile(join(dir, '.husky', 'pre-commit'), 'utf-8');
      const occurrences = hookContent.split('pre-commit run --hook-stage commit "$@"').length - 1;
      expect(occurrences).toBe(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // #689 follow-up: `npx husky init` needs package.json in its cwd (the
  // target's own subdirectory in a polyglot monorepo) but git only honors
  // core.hooksPath relative to the actual repo root — bootstrapHooks must
  // relocate the result there rather than leaving .husky/ stranded in the
  // target's subdirectory where git never looks for it.
  it('Node target in a monorepo subdirectory: relocates .husky/ to the repo root and sets core.hooksPath there', async () => {
    const { bootstrapHooks } = await import('../src/install/hooks-bootstrap.js');
    const repoRoot = await mkdtemp();
    const projectPath = join(repoRoot, 'mission-control');
    await fs.mkdir(projectPath, { recursive: true });
    try {
      const result = await bootstrapHooks(baseCtx(projectPath, repoRoot), basePlan('node'));
      expect(result.status).toBe('ok');

      const rootHook = await fs
        .readFile(join(repoRoot, '.husky', 'pre-commit'), 'utf-8')
        .catch(() => null);
      expect(rootHook).not.toBeNull();

      const targetHuskyExists = await fs
        .stat(join(projectPath, '.husky'))
        .then(() => true)
        .catch(() => false);
      expect(targetHuskyExists).toBe(false);

      const hooksPathCall = execaCalls.find(
        (c) => c.file === 'git' && c.args[0] === 'config' && c.args[1] === 'core.hooksPath',
      );
      expect(hooksPathCall).toBeDefined();
      expect(hooksPathCall?.args[2]).toBe('.husky/_');
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});
