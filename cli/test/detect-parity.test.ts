import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectStack } from '../src/install/detect-stack.js';
import { detectDeployHost, type GhRunner } from '../src/lib/deploy-detect.js';
import { detectTestRunners, playwrightProjectNames } from '../src/lib/test-runner-detect.js';
import type { InstallContext } from '../src/install/types.js';
import {
  legacyDetectDeployHost,
  legacyDetectStack,
  legacyDetectTestRunners,
  legacyPlaywrightProjectNames,
} from './helpers/legacy-detect.js';

// DevAudit-Installer#1116 WP3 — the detection moved to @metasession.co/devaudit-core. These tests run
// the same fixtures through the code as it was before the move (test/helpers/legacy-detect.ts, frozen)
// and through the functions the CLI uses now, and require identical answers.

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function repo(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-parity-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, rel)), { recursive: true });
    await fs.writeFile(join(dir, rel), content);
  }
  return dir;
}

const ctxFor = (projectPath: string, repoRoot = projectPath): InstallContext => ({ projectPath, repoRoot }) as unknown as InstallContext;

async function settled<T>(fn: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await fn() };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

describe('detectStack: the moved code answers as the original did', () => {
  const cases: Record<string, Record<string, string>> = {
    'nothing at all': { 'README.md': 'x' },
    'package.json only': { 'package.json': '{}' },
    'pyproject.toml at the root': { 'pyproject.toml': '' },
    'requirements.txt at the root': { 'requirements.txt': '' },
    'python and node at the root: python wins': { 'pyproject.toml': '', 'package.json': '{}' },
    'python one level down': { 'api/pyproject.toml': '' },
    'python two levels down (requirements.txt)': { 'services/api/requirements.txt': '' },
    'python three levels down is too deep': { 'a/b/c/pyproject.toml': '' },
    'too deep, with a root package.json: node': { 'a/b/c/pyproject.toml': '', 'package.json': '{}' },
    'python inside node_modules is skipped': { 'node_modules/x/pyproject.toml': '', 'package.json': '{}' },
    'python inside dist is skipped': { 'dist/pyproject.toml': '' },
    'a nested package.json alone is not a stack': { 'web/package.json': '{}' },
    'nested python beats a root package.json': { 'api/pyproject.toml': '', 'package.json': '{}' },
  };
  for (const [name, files] of Object.entries(cases)) {
    it(name, async () => {
      const dir = await repo(files);
      expect(await settled(() => detectStack(ctxFor(dir)))).toEqual(await settled(() => legacyDetectStack(ctxFor(dir))));
    });
  }

  it('a target in a subdirectory reports its working directory relative to the repository root', async () => {
    const dir = await repo({ 'apps/web/package.json': '{}', 'apps/svc/api/pyproject.toml': '' });
    for (const sub of ['apps/web', 'apps/svc']) {
      const ctx = ctxFor(join(dir, sub), dir);
      const now = await settled(() => detectStack(ctx));
      expect(now).toEqual(await settled(() => legacyDetectStack(ctx)));
      expect('ok' in now && now.ok.detected.workingDirectory).toBe(sub === 'apps/web' ? 'apps/web' : 'apps/svc/api');
    }
  });
});

describe('detectTestRunners: the moved code answers as the original did', () => {
  const cases: Record<string, Record<string, string>> = {
    none: {},
    'playwright.config.ts': { 'playwright.config.ts': '' },
    'playwright.config.mjs': { 'playwright.config.mjs': '' },
    'pytest.ini': { 'pytest.ini': '' },
    'pyproject [tool.pytest]': { 'pyproject.toml': '[tool.pytest.ini_options]\n' },
    'pyproject without pytest': { 'pyproject.toml': '[project]\nname = "x"\n' },
    'setup.cfg [tool:pytest]': { 'setup.cfg': '[tool:pytest]\n' },
    'tox.ini [pytest]': { 'tox.ini': '[pytest]\n' },
    'conftest.py at the root': { 'conftest.py': '' },
    'tests/conftest.py': { 'tests/conftest.py': '' },
    'jest config': { 'jest.config.js': '' },
    'jest key in package.json': { 'package.json': '{"jest":{}}' },
    'jest dependency': { 'package.json': '{"devDependencies":{"jest":"1"}}' },
    'vitest dependency': { 'package.json': '{"dependencies":{"vitest":"1"}}' },
    'vitest config': { 'vitest.config.mts': '' },
    'an unreadable package.json': { 'package.json': '{ not json' },
    everything: { 'playwright.config.cjs': '', 'pytest.ini': '', 'jest.config.json': '', 'vitest.config.ts': '' },
  };
  for (const [name, files] of Object.entries(cases)) {
    it(name, async () => {
      const dir = await repo(files);
      expect(await detectTestRunners(dir)).toEqual(await legacyDetectTestRunners(dir));
    });
  }

  it('reads Playwright project names the same way', () => {
    for (const text of [
      '',
      "projects: [{ name: 'smoke' }, { name: \"critical\" }, { name: 'regression', use: {} }]",
      "name: 'a'\nname:\"b\"\nname:  'c'",
      'name: someVariable',
    ]) {
      expect(playwrightProjectNames(text)).toEqual(legacyPlaywrightProjectNames(text));
    }
  });
});

describe('detectDeployHost: the moved code answers as the original did', () => {
  const noGh: GhRunner = async () => ({ exitCode: 1, stdout: '' });
  const deployments = (creator: string, count: number, url?: string): GhRunner => async (args) => {
    const key = args.join(' ');
    if (key.startsWith('api repos/{owner}/{repo}/deployments?')) {
      return {
        exitCode: 0,
        stdout: JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: 100 - i, environment: 'Production', creator: { login: creator } }))),
      };
    }
    if (key.includes('/statuses')) {
      return { exitCode: 0, stdout: JSON.stringify(url ? [{ state: 'success', environment_url: url }] : []) };
    }
    return { exitCode: 1, stdout: '' };
  };

  const fileCases: Record<string, Record<string, string>> = {
    'no evidence': {},
    'vercel.json': { 'vercel.json': '{}' },
    '.vercel/project.json': { '.vercel/project.json': '{}' },
    'railway.toml': { 'railway.toml': '' },
    'railway.json and railway.toml': { 'railway.json': '{}', 'railway.toml': '' },
    'fly.toml': { 'fly.toml': '' },
    'serverless.yml plus a terraform directory': { 'serverless.yml': '', 'terraform/main.tf': '' },
    'k8s and helm directories': { 'k8s/deploy.yaml': '', 'helm/Chart.yaml': '' },
    'a terraform FILE rather than a directory': { terraform: '' },
    'conflicting hosts (close scores)': { 'vercel.json': '{}', 'fly.toml': '' },
    'vercel clearly ahead': { 'vercel.json': '{}', '.vercel/project.json': '{}', 'helm/Chart.yaml': '' },
  };
  for (const [name, files] of Object.entries(fileCases)) {
    it(`files only, ${name}`, async () => {
      const dir = await repo(files);
      expect(await detectDeployHost(dir, 'railway', { gh: noGh })).toEqual(await legacyDetectDeployHost(dir, 'railway', { gh: noGh }));
    });
  }

  for (const [name, gh, files] of [
    ['Vercel deployments', deployments('vercel[bot]', 3, 'https://example-app.example.test'), {}],
    ['Railway deployments with a vercel.json', deployments('railway-app[bot]', 2), { 'vercel.json': '{}' }],
    ['workflow deployments', deployments('github-actions[bot]', 4), { 'fly.toml': '' }],
    ['unknown creators', deployments('someone-else', 5), { 'railway.toml': '' }],
  ] as const) {
    it(`deployments plus files, ${name}`, async () => {
      const dir = await repo(files as Record<string, string>);
      expect(await detectDeployHost(dir, 'railway', { gh })).toEqual(await legacyDetectDeployHost(dir, 'railway', { gh }));
    });
  }
});
