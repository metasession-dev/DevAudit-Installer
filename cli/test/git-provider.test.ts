import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { classifyRemoteUrl } from '../src/lib/git-provider/detect.js';

interface ExecaCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly input?: string;
}

const execaCalls: ExecaCall[] = [];

let ghAvailable = true;
let ghRepoViewStdout = JSON.stringify({ owner: 'foo', name: 'bar', defaultBranch: 'main' });

vi.mock('execa', () => ({
  execa: async (file: string, args: readonly string[] = [], opts: { input?: string } = {}) => {
    execaCalls.push({ file, args, ...(opts.input !== undefined ? { input: opts.input } : {}) });
    if (file === 'gh' && args[0] === '--version') {
      if (!ghAvailable) throw new Error('gh not on PATH');
      return { exitCode: 0, stdout: 'gh version 2.0.0', stderr: '' };
    }
    if (file === 'gh' && args[0] === 'repo' && args[1] === 'view') {
      return { exitCode: 0, stdout: ghRepoViewStdout, stderr: '' };
    }
    if (file === 'gh' && args[0] === 'secret' && args[1] === 'set') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (file === 'gh' && args[0] === 'variable' && args[1] === 'set') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (file === 'gh' && args[0] === 'api') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (file === 'git' && args[0] === 'remote' && args[1] === 'get-url') {
      return { exitCode: 0, stdout: 'git@github.com:foo/bar.git', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  },
}));

const restServer = setupServer(
  http.get('https://api.github.com/repos/foo/bar', () =>
    HttpResponse.json({ default_branch: 'main', name: 'bar' }),
  ),
  http.put('https://api.github.com/repos/foo/bar/branches/main/protection', () =>
    HttpResponse.json({ enabled: true }),
  ),
  http.post('https://api.github.com/repos/foo/bar/actions/variables', () =>
    HttpResponse.json({ name: 'X', value: 'y' }, { status: 201 }),
  ),
);

beforeAll(() => restServer.listen({ onUnhandledRequest: 'error' }));
afterAll(() => restServer.close());

afterEach(async () => {
  execaCalls.length = 0;
  ghAvailable = true;
  ghRepoViewStdout = JSON.stringify({ owner: 'foo', name: 'bar', defaultBranch: 'main' });
  const mod = await import('../src/lib/git-provider/github.js');
  mod.resetGhAvailabilityCache();
});

describe('classifyRemoteUrl', () => {
  it('detects github SSH and HTTPS', () => {
    expect(classifyRemoteUrl('git@github.com:foo/bar.git').provider).toBe('github');
    expect(classifyRemoteUrl('https://github.com/foo/bar.git').provider).toBe('github');
  });
  it('detects gitlab + bitbucket + self-hosted', () => {
    expect(classifyRemoteUrl('git@gitlab.com:x/y.git').provider).toBe('gitlab');
    expect(classifyRemoteUrl('https://bitbucket.org/x/y').provider).toBe('bitbucket');
    expect(classifyRemoteUrl('git@code.example.com:x/y.git').provider).toBe('self-hosted');
    expect(classifyRemoteUrl('git@code.example.com:x/y.git').host).toBe('code.example.com');
  });
});

describe('GitHubProvider (gh-CLI-preferred path)', () => {
  it('getRepoMeta uses gh repo view', async () => {
    const { GitHubProvider } = await import('../src/lib/git-provider/github.js');
    const p = new GitHubProvider();
    const meta = await p.getRepoMeta('/tmp/x');
    expect(meta.owner).toBe('foo');
    expect(meta.name).toBe('bar');
    expect(meta.defaultBranch).toBe('main');
    expect(execaCalls.find((c) => c.file === 'gh' && c.args[1] === 'view')).toBeDefined();
  });
  it('setSecret pipes value via stdin', async () => {
    const { GitHubProvider } = await import('../src/lib/git-provider/github.js');
    const p = new GitHubProvider();
    await p.setSecret('/tmp/x', 'DEVAUDIT_API_KEY', 'dak_test');
    const call = execaCalls.find((c) => c.file === 'gh' && c.args[0] === 'secret');
    expect(call?.args).toEqual(['secret', 'set', 'DEVAUDIT_API_KEY']);
    expect(call?.input).toBe('dak_test');
  });
  it('applyBranchProtection PUTs via gh api', async () => {
    const { GitHubProvider } = await import('../src/lib/git-provider/github.js');
    const p = new GitHubProvider();
    const result = await p.applyBranchProtection('/tmp/x', 'main', ['Check 1', 'Check 2']);
    expect(result.applied).toBe(true);
    const call = execaCalls.find((c) => c.file === 'gh' && c.args[0] === 'api');
    expect(call?.args).toContain('/repos/foo/bar/branches/main/protection');
  });
});

describe('GitHubProvider (REST fallback when gh is missing)', () => {
  it('getRepoMeta falls back to api.github.com', async () => {
    ghAvailable = false;
    const { GitHubProvider } = await import('../src/lib/git-provider/github.js');
    const p = new GitHubProvider({ token: 'gho_test' });
    const meta = await p.getRepoMeta('/tmp/x');
    expect(meta.defaultBranch).toBe('main');
  });
  it('setSecret fails clearly without gh CLI', async () => {
    ghAvailable = false;
    const { GitHubProvider } = await import('../src/lib/git-provider/github.js');
    const p = new GitHubProvider({ token: 'gho_test' });
    await expect(p.setSecret('/tmp/x', 'X', 'y')).rejects.toThrow(/sodium encryption/);
  });
});
