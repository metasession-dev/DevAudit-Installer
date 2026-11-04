import { describe, expect, it } from 'vitest';
import {
  dependentProjectsFromConfig,
  detectBranches,
  detectFacts,
  detectGovernanceFiles,
  detectRunner,
  detectSeedScripts,
  detectStack,
  detectTestData,
  detectTestGroups,
  detectTestRunners,
  hostEvidenceFromFiles,
  playwrightProjectNames,
  rankHostEvidence,
} from '../src/index.js';
import { memoryReader } from './memory-reader.js';

describe('detectStack', () => {
  it('returns null when nothing marks a stack', async () => {
    expect(await detectStack(memoryReader({ 'README.md': 'x' }))).toBeNull();
  });

  it('finds Node from a root package.json', async () => {
    expect(await detectStack(memoryReader({ 'package.json': '{}' }))).toEqual({ stack: 'node', workingDirectory: '.' });
  });

  it('prefers Python at the root, and Python anywhere within three levels, over Node', async () => {
    expect(await detectStack(memoryReader({ 'pyproject.toml': '', 'package.json': '{}' }))).toEqual({ stack: 'python', workingDirectory: '.' });
    expect(await detectStack(memoryReader({ 'requirements.txt': '' }))).toEqual({ stack: 'python', workingDirectory: '.' });
    expect(await detectStack(memoryReader({ 'api/pyproject.toml': '', 'package.json': '{}' }))).toEqual({ stack: 'python', workingDirectory: 'api' });
    expect(await detectStack(memoryReader({ 'services/api/requirements.txt': '' }))).toEqual({ stack: 'python', workingDirectory: 'services/api' });
  });

  it('does not search deeper than two levels below the root, or inside skipped folders', async () => {
    expect(await detectStack(memoryReader({ 'a/b/c/pyproject.toml': '' }))).toBeNull();
    expect(await detectStack(memoryReader({ 'node_modules/x/pyproject.toml': '', 'package.json': '{}' }))).toEqual({ stack: 'node', workingDirectory: '.' });
    for (const skipped of ['.git', 'dist', 'build', '.next', '.turbo']) {
      expect(await detectStack(memoryReader({ [`${skipped}/pyproject.toml`]: '' })), skipped).toBeNull();
    }
  });

  it('picks the first nested Python project in sorted order, so the answer does not depend on the file system', async () => {
    expect(await detectStack(memoryReader({ 'b/pyproject.toml': '', 'a/pyproject.toml': '' }))).toEqual({ stack: 'python', workingDirectory: 'a' });
  });
});

describe('detectTestRunners', () => {
  it('detects each runner from its files, in the directory asked for', async () => {
    const reader = memoryReader({
      'playwright.config.ts': '',
      'pytest.ini': '',
      'app/jest.config.js': '',
      'app/vitest.config.ts': '',
      'app/package.json': '{}',
    });
    expect(await detectTestRunners(reader)).toEqual({ playwright: true, pytest: true, jest: false, vitest: false, playwrightConfig: 'playwright.config.ts' });
    expect(await detectTestRunners(reader, 'app')).toEqual({ playwright: false, pytest: false, jest: true, vitest: true });
  });

  it('reads pytest markers and package.json dependencies', async () => {
    expect((await detectTestRunners(memoryReader({ 'pyproject.toml': '[tool.pytest.ini_options]\n' }))).pytest).toBe(true);
    expect((await detectTestRunners(memoryReader({ 'pyproject.toml': '[project]\n' }))).pytest).toBe(false);
    expect((await detectTestRunners(memoryReader({ 'package.json': '{"devDependencies":{"vitest":"1"}}' }))).vitest).toBe(true);
    expect((await detectTestRunners(memoryReader({ 'package.json': '{"jest":{}}' }))).jest).toBe(true);
    expect((await detectTestRunners(memoryReader({ 'package.json': '{ broken' }))).jest).toBe(false);
  });

  it('reads Playwright project names', () => {
    expect(playwrightProjectNames("projects: [{ name: 'smoke' }, { name: \"critical\" }]")).toEqual(['smoke', 'critical']);
    expect(playwrightProjectNames('')).toEqual([]);
  });
});

describe('host evidence', () => {
  it('reads host files, including a directory such as terraform/', async () => {
    const evidence = await hostEvidenceFromFiles(memoryReader({ 'vercel.json': '{}', 'terraform/main.tf': '' }));
    expect(evidence.map((e) => [e.host, e.weight])).toEqual([
      ['vercel', 2],
      ['custom', 1],
    ]);
    expect(await hostEvidenceFromFiles(memoryReader({}))).toEqual([]);
  });

  it('ranks the evidence: none, medium from files, low when close, high with deployments behind it', () => {
    expect(rankHostEvidence([])).toEqual({ detected: null, confidence: 'none' });
    const file = (host: 'vercel' | 'railway' | 'custom', weight: number) => ({ host, source: 'file' as const, detail: 'f', weight });
    expect(rankHostEvidence([file('vercel', 2)])).toEqual({ detected: 'vercel', confidence: 'medium' });
    expect(rankHostEvidence([file('vercel', 2), file('custom', 2)])).toEqual({ detected: 'vercel', confidence: 'low' });
    expect(rankHostEvidence([file('vercel', 2), { host: 'vercel', source: 'deployments', detail: 'd', weight: 5 }, file('custom', 1)])).toEqual({
      detected: 'vercel',
      confidence: 'high',
    });
  });
});

describe('detectBranches', () => {
  it('uses the project configuration first', async () => {
    expect(await detectBranches(memoryReader({}), { integration_branch: 'staging', release_branch: 'production' })).toEqual({
      integration: 'staging',
      release: 'production',
    });
  });

  it('falls back to the branches git has, locally or on origin, including packed refs', async () => {
    const heads = memoryReader({ '.git/refs/heads/main': 'x', '.git/refs/heads/develop': 'x' });
    expect(await detectBranches(heads, null)).toEqual({ integration: 'develop', release: 'main' });
    const remote = memoryReader({ '.git/refs/remotes/origin/master': 'x' });
    expect(await detectBranches(remote, null)).toEqual({ integration: null, release: 'master' });
    const packed = memoryReader({ '.git/packed-refs': `# pack-refs\n${'a'.repeat(40)} refs/heads/main\n${'b'.repeat(40)} refs/remotes/origin/develop\n` });
    expect(await detectBranches(packed, null)).toEqual({ integration: 'develop', release: 'main' });
  });

  it('fills only the half the configuration leaves out, and finds nothing in a repository without git data', async () => {
    const reader = memoryReader({ '.git/refs/heads/main': 'x', '.git/refs/heads/develop': 'x' });
    expect(await detectBranches(reader, { release_branch: 'production' })).toEqual({ integration: 'develop', release: 'production' });
    expect(await detectBranches(memoryReader({}), null)).toEqual({ integration: null, release: null });
  });
});

describe('detectRunner', () => {
  it('reads the runner key', async () => {
    expect(await detectRunner(memoryReader({}), { runner: 'self-hosted' })).toBe('self-hosted');
    expect(await detectRunner(memoryReader({}), { runner: 'ubuntu-latest' })).toBe('github');
  });

  it('otherwise reads runs-on from the workflows', async () => {
    const github = memoryReader({ '.github/workflows/ci.yml': 'jobs:\n  t:\n    runs-on: ubuntu-latest\n' });
    expect(await detectRunner(github, null)).toBe('github');
    const own = memoryReader({
      '.github/workflows/ci.yml': 'jobs:\n  t:\n    runs-on: ubuntu-latest\n',
      '.github/workflows/e2e.yaml': 'jobs:\n  t:\n    runs-on: [self-hosted, linux]\n',
    });
    expect(await detectRunner(own, null)).toBe('self-hosted');
    expect(await detectRunner(memoryReader({}), null)).toBeNull();
    expect(await detectRunner(memoryReader({ '.github/workflows/ci.yml': 'name: x\n' }), null)).toBeNull();
  });
});

describe('detection does not take quadratic time on hostile input', () => {
  it('a workflow line and a Playwright property padded with whitespace', async () => {
    const pad = ' '.repeat(200_000);
    const started = Date.now();
    expect(await detectRunner(memoryReader({ '.github/workflows/ci.yml': `runs-on:${pad}x${pad}\n` }), null)).toBeNull();
    expect(dependentProjectsFromConfig(`projects: [{ name: 'a', dependencies:${pad}['setup']${pad} }]`)).toEqual(['a']);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('detectGovernanceFiles', () => {
  it('lists the markdown files in compliance/governance', async () => {
    const reader = memoryReader({
      'compliance/governance/ropa.md': '',
      'compliance/governance/dpia.md': '',
      'compliance/governance/notes.txt': '',
      'compliance/RTM.md': '',
    });
    expect(await detectGovernanceFiles(reader)).toEqual(['compliance/governance/dpia.md', 'compliance/governance/ropa.md']);
    expect(await detectGovernanceFiles(memoryReader({}))).toEqual([]);
  });
});

describe('detectTestGroups', () => {
  const config = `export default defineConfig({ projects: [{ name: 'chromium' }, { name: 'critical' }, { name: 'regression' }] });`;

  it('reads groups from the Playwright projects and from e2e_project', async () => {
    const reader = memoryReader({ 'playwright.config.ts': config });
    expect(await detectTestGroups(reader, null, '.')).toEqual({ smoke: false, critical: true, full: true });
    expect(await detectTestGroups(reader, { e2e_project: 'chromium' }, '.')).toEqual({ smoke: true, critical: true, full: true });
    expect(await detectTestGroups(reader, { e2e_project: 'webkit' }, '.')).toEqual({ smoke: false, critical: true, full: true });
    const smokeOnly = memoryReader({ 'playwright.config.ts': "projects: [{ name: 'smoke' }]" });
    expect(await detectTestGroups(smokeOnly, null, '.')).toEqual({ smoke: true, critical: false, full: false });
  });

  it('adds groups a collect-only run found, and never removes one', async () => {
    const reader = memoryReader({ 'playwright.config.ts': config });
    expect(await detectTestGroups(reader, null, '.', { collected: { smoke: true } })).toEqual({ smoke: true, critical: true, full: true });
    expect(await detectTestGroups(reader, null, '.', { collected: { critical: false } })).toEqual({ smoke: false, critical: true, full: true });
    expect(await detectTestGroups(memoryReader({}), null, null, { collected: { full: true } })).toEqual({ smoke: false, critical: false, full: true });
  });

  it('looks in the working directory as well as the root', async () => {
    const reader = memoryReader({ 'apps/web/playwright.config.ts': "projects: [{ name: 'smoke' }]" });
    expect(await detectTestGroups(reader, null, 'apps/web')).toEqual({ smoke: true, critical: false, full: false });
    expect(await detectTestGroups(reader, null, '.')).toEqual({ smoke: false, critical: false, full: false });
  });
});

describe('testData: seed scripts (Q19)', () => {
  it('finds package.json scripts with "seed" in the name, and scripts/seed* files', async () => {
    const reader = memoryReader({
      'package.json': JSON.stringify({ scripts: { test: 'vitest', 'db:seed': 'x', 'seed:e2e': 'y', Seed: 'z', build: 'tsc' } }),
      'scripts/seed-e2e-admins.ts': '',
      'scripts/Seed-menu.ts': '',
      'scripts/other.ts': '',
      'scripts/seeds/data.ts': '',
    });
    expect(await detectSeedScripts(reader)).toEqual([
      'npm run Seed',
      'npm run db:seed',
      'npm run seed:e2e',
      'scripts/Seed-menu.ts',
      'scripts/seed-e2e-admins.ts',
    ]);
  });

  it('finds nothing when there is no seed', async () => {
    expect(await detectSeedScripts(memoryReader({ 'package.json': '{"scripts":{"test":"vitest"}}', 'scripts/build.ts': '' }))).toEqual([]);
    expect(await detectSeedScripts(memoryReader({}))).toEqual([]);
    expect(await detectSeedScripts(memoryReader({ 'package.json': '{"scripts":"nope"}' }))).toEqual([]);
    expect(await detectSeedScripts(memoryReader({ 'package.json': '[1,2]' }))).toEqual([]);
  });

  it('reads the working directory when the app is not at the root', async () => {
    const reader = memoryReader({ 'apps/web/package.json': '{"scripts":{"seed":"x"}}', 'apps/web/scripts/seed.ts': '' });
    expect(await detectSeedScripts(reader, 'apps/web')).toEqual(['npm run seed', 'apps/web/scripts/seed.ts']);
    expect(await detectSeedScripts(reader)).toEqual([]);
  });
});

describe('testData: Playwright projects that depend on another (Q21)', () => {
  it('lists the projects that have a non-empty dependencies list', () => {
    const text = `
      import { defineConfig } from '@playwright/test';
      export default defineConfig({
        projects: [
          { name: 'setup', testMatch: /.*\\.setup\\.ts/ },
          { name: 'smoke' },
          { name: 'authenticated', use: { storageState: '.auth/user.json' }, dependencies: ['setup'] },
          { name: "admin", dependencies: [ "setup", 'other' ] },
          { name: 'noDeps', dependencies: [] },
        ],
      });`;
    expect(dependentProjectsFromConfig(text)).toEqual(['authenticated', 'admin']);
  });

  it('ignores comments, quoted brackets and a dependencies key that is not a list', () => {
    const text = `
      export default {
        // projects: [{ name: 'commented', dependencies: ['x'] }]
        projects: [
          /* { name: 'also-commented', dependencies: ['y'] }, */
          { name: 'a', use: { baseURL: 'http://x/]' }, dependencies: ['setup'] },
          { name: 'b', dependencies: someVariable },
          ...otherProjects,
          someProjectVariable,
        ],
      };`;
    expect(dependentProjectsFromConfig(text)).toEqual(['a']);
  });

  it('returns nothing when the projects list cannot be read simply', () => {
    expect(dependentProjectsFromConfig('')).toEqual([]);
    expect(dependentProjectsFromConfig('export default defineConfig({ testDir: "e2e" })')).toEqual([]);
    expect(dependentProjectsFromConfig("projects: [{ name: 'a', dependencies: ['x'] ")).toEqual([]); // unbalanced
    expect(dependentProjectsFromConfig("projects: buildProjects(),")).toEqual([]);
    expect(dependentProjectsFromConfig('projects: [ {{{ ]')).toEqual([]);
    expect(dependentProjectsFromConfig("projects: [{ name: someName, dependencies: ['x'] }]")).toEqual([]); // name is not a literal
  });

  it('reads the first Playwright config that exists, never runs it', async () => {
    const reader = memoryReader({
      'playwright.config.js': "projects: [{ name: 'a', dependencies: ['setup'] }]",
      'playwright.config.ts': "throw new Error('never executed'); projects: [{ name: 'b', dependencies: ['setup'] }]",
    });
    const facts = await detectTestData(reader);
    expect(facts.dependentProjects).toEqual(['b']); // .ts is checked before .js; neither is executed
    expect((await detectTestData(memoryReader({}))).dependentProjects).toEqual([]);
  });
});

describe('detectFacts', () => {
  it('assembles every fact for a Node project with Playwright, a seed and a login project', async () => {
    const reader = memoryReader({
      'package.json': JSON.stringify({ scripts: { seed: 'tsx scripts/seed.ts' } }),
      'playwright.config.ts': "projects: [{ name: 'setup' }, { name: 'smoke' }, { name: 'regression', dependencies: ['setup'] }]",
      'scripts/seed.ts': '',
      'vercel.json': '{}',
      'sdlc-config.json': JSON.stringify({ runner: 'self-hosted', e2e_project: 'smoke' }),
      '.git/refs/heads/main': 'x',
      '.git/refs/heads/develop': 'x',
      'compliance/governance/ropa.md': '',
    });
    expect(await detectFacts(reader)).toEqual({
      stack: 'node',
      workingDirectory: '.',
      host: 'vercel',
      testRunner: 'playwright',
      testGroups: { smoke: true, critical: false, full: true },
      branches: { integration: 'develop', release: 'main' },
      runner: 'self-hosted',
      governanceFiles: ['compliance/governance/ropa.md'],
      testData: { seedScripts: ['npm run seed', 'scripts/seed.ts'], dependentProjects: ['regression'] },
    });
  });

  it('reports nulls and empty lists for an empty repository', async () => {
    expect(await detectFacts(memoryReader({}))).toEqual({
      stack: null,
      workingDirectory: null,
      host: null,
      testRunner: null,
      testGroups: { smoke: false, critical: false, full: false },
      branches: { integration: null, release: null },
      runner: null,
      governanceFiles: [],
      testData: { seedScripts: [], dependentProjects: [] },
    });
  });

  it('detects pytest in a Python project below the root and reads its working directory', async () => {
    const reader = memoryReader({ 'services/api/pyproject.toml': '[tool.pytest.ini_options]\n', 'services/api/package.json': '{"scripts":{"seed":"x"}}' });
    const facts = await detectFacts(reader);
    expect(facts.stack).toBe('python');
    expect(facts.workingDirectory).toBe('services/api');
    expect(facts.testRunner).toBe('pytest');
    expect(facts.testData.seedScripts).toEqual(['npm run seed']);
  });

  it('passes the collect-only groups through', async () => {
    const facts = await detectFacts(memoryReader({ 'package.json': '{}' }), { collected: { smoke: true, full: true } });
    expect(facts.testGroups).toEqual({ smoke: true, critical: false, full: true });
  });

  it('never throws on a repository with unreadable JSON', async () => {
    const facts = await detectFacts(memoryReader({ 'package.json': '{ nope', 'sdlc-config.json': '[]' }));
    expect(facts.stack).toBe('node');
    expect(facts.branches).toEqual({ integration: null, release: null });
  });
});
