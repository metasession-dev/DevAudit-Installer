import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const BASE_URL = 'https://devaudit.test';

interface ExecaCall {
  readonly file: string;
  readonly args: readonly string[];
}

const execaCalls: ExecaCall[] = [];

interface ProviderCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

const providerCalls: ProviderCall[] = [];

function makeFakeProvider() {
  return {
    name: 'github' as const,
    async getRepoMeta(_cwd: string) {
      providerCalls.push({ method: 'getRepoMeta', args: [] });
      return { owner: 'metasession-dev', name: 'fixture-app', defaultBranch: 'main' };
    },
    async setSecret(_cwd: string, name: string, value: string) {
      providerCalls.push({ method: 'setSecret', args: [name, value.length] });
    },
    async setVariable(_cwd: string, name: string, value: string) {
      providerCalls.push({ method: 'setVariable', args: [name, value] });
    },
    async applyBranchProtection(_cwd: string, branch: string, checks: readonly string[]) {
      providerCalls.push({ method: 'applyBranchProtection', args: [branch, checks.length] });
      return { applied: true };
    },
    async createPullRequest() {
      providerCalls.push({ method: 'createPullRequest', args: [] });
      return { url: 'https://github.com/metasession-dev/fixture-app/pull/1' };
    },
  };
}

vi.mock('execa', () => ({
  execa: async (file: string, args: readonly string[] = [], _opts: unknown = {}) => {
    execaCalls.push({ file, args });
    if (file === 'which' || file === 'where') {
      return { exitCode: 0, stdout: `/usr/bin/${args[0]}`, stderr: '' };
    }
    if (file === 'gh' && args[0] === 'repo' && args[1] === 'view') {
      return { exitCode: 0, stdout: 'metasession-dev/fixture-app', stderr: '' };
    }
    if (file === 'gh' && args[0] === 'api') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (file === 'gh') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (file === 'pre-commit' || file === 'npx' || file === 'npm') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  },
}));

const handlers = [
  http.get(`${BASE_URL}/api/projects`, () => HttpResponse.json([])),
  http.post(`${BASE_URL}/api/projects`, async ({ request }) => {
    const body = (await request.json()) as { slug: string; name: string };
    return HttpResponse.json({ id: '11111111-aaaa-bbbb-cccc-222222222222', slug: body.slug, name: body.name }, { status: 201 });
  }),
  http.get(`${BASE_URL}/api/projects/:id/api-keys`, () => HttpResponse.json([])),
  http.post(`${BASE_URL}/api/projects/:id/api-keys`, () =>
    HttpResponse.json({ id: 'key-1', name: 'Onboarding-issued', plainTextKey: 'dak_test_plain' }, { status: 201 }),
  ),
];

const server = setupServer(...handlers);

async function buildNodeFixture(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-install-fixture-'));
  await fs.writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'fixture-app',
      version: '0.0.0',
      private: true,
      devDependencies: {
        husky: '*',
        '@commitlint/cli': '*',
        '@commitlint/config-conventional': '*',
        'lint-staged': '*',
        prettier: '*',
        eslint: '*',
        typescript: '*',
        '@playwright/test': '*',
      },
    }),
  );
  await fs.mkdir(join(dir, '.husky'), { recursive: true });
  await fs.mkdir(join(dir, 'scripts'), { recursive: true });
  await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  return dir;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
  process.env['DEVAUDIT_USER_TOKEN'] = 'mctok_test_fixture';
  process.env['DEVAUDIT_BASE_URL'] = BASE_URL;
});

afterAll(() => {
  server.close();
  delete process.env['DEVAUDIT_USER_TOKEN'];
  delete process.env['DEVAUDIT_BASE_URL'];
});

afterEach(() => {
  execaCalls.length = 0;
  providerCalls.length = 0;
  server.resetHandlers(...handlers);
});

describe('runInstall — native TS install against a node fixture', () => {
  it('dry-run produces a plan without mutating disk or calling execa', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    try {
      const report = await runInstall({
        path: dir,
        dryRun: true,
        nonInteractive: true,
        provider: makeFakeProvider(),
      });
      expect(report.dryRun).toBe(true);
      expect(report.steps.find((s) => s.step.startsWith('4/'))?.status).toBe('planned');
      expect(report.steps.find((s) => s.step.startsWith('5/'))?.status).toBe('planned');
      expect(report.steps.find((s) => s.step.startsWith('7/'))?.status).toBe('planned');
      // No write of sdlc-config.json in dry run
      await expect(fs.stat(join(dir, 'sdlc-config.json'))).rejects.toThrow();
      // dry-run never invokes provider mutating methods
      const mutating = providerCalls.filter((c) => c.method !== 'getRepoMeta');
      expect(mutating).toHaveLength(0);
      // and never invokes mutating execa commands
      const mutatingExeca = execaCalls.filter(
        (c) => c.file === 'pre-commit' || c.file === 'npx',
      );
      expect(mutatingExeca).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('full run writes sdlc-config.json, creates project, issues key, sets secrets, syncs', async () => {
    const { runInstall } = await import('../src/install/index.js');
    // --yes path requires an existing sdlc-config.json
    const dir = await buildNodeFixture();
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20' }),
    );
    try {
      const report = await runInstall({
        path: dir,
        dryRun: false,
        nonInteractive: true,
        provider: makeFakeProvider(),
      });
      expect(report.dryRun).toBe(false);
      const stepByStart = (s: string) => report.steps.find((x) => x.step.startsWith(s));
      expect(stepByStart('1/')?.status).toBe('ok');
      expect(stepByStart('2/')?.status).toBe('ok');
      expect(stepByStart('4/')?.status).toBe('ok');
      expect(stepByStart('5/')?.status).toBe('ok');
      expect(stepByStart('6/')?.status).toBe('ok');
      expect(stepByStart('7/')?.status).toBe('ok');
      expect(stepByStart('8/')?.status).toBe('ok');
      expect(stepByStart('9/')?.status).toBe('ok');
      expect(stepByStart('10/')?.status).toBe('ok');
      // sdlc-config.json was rewritten by step 4
      const written = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      expect(written.stack).toBe('node');
      expect(written.project_slug).toBe('fixture-app');
      // develop-first branch defaults (DevAudit-Installer#70)
      expect(written.integration_branch).toBe('develop');
      expect(written.release_branch).toBe('main');
      // provider was called for secrets + variable
      const secretCalls = providerCalls.filter((c) => c.method === 'setSecret');
      const secretNames = secretCalls.map((c) => c.args[0]);
      expect(secretNames).toContain('DEVAUDIT_API_KEY');
      expect(secretNames).toContain('DEVAUDIT_USER_TOKEN');
      const variableCall = providerCalls.find((c) => c.method === 'setVariable');
      expect(variableCall?.args[0]).toBe('DEVAUDIT_BASE_URL');
      // branch protection applied via provider
      expect(providerCalls.find((c) => c.method === 'applyBranchProtection')).toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('preserves rich sdlc-config fields when re-running --yes on an existing consumer', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    // Seed a richly customized config — mirrors WGB's shape (runner: self-hosted,
    // sast_baseline > 0, mongodb db service, custom build_env, custom prod-url secret)
    const seeded = {
      project_slug: 'fixture-app',
      stack: 'node',
      host: 'railway',
      node_version: 20,
      working_directory: '.',
      source_dirs: 'app/ lib/ services/',
      production_url_secret: 'CUSTOM_PROD_URL',
      runner: 'self-hosted',
      sast_baseline: 6,
      accepted_dep_risks: 'xlsx',
      database_service: 'mongodb',
      database_image: 'mongo:7',
      database_port: '27017',
      database_env: { MONGODB_DB_NAME: 'fixture_test' },
      app_env: { CUSTOM_APP_FLAG: 'on' },
      build_env: { CUSTOM_BUILD_FLAG: 'true' },
      e2e_project: 'chromium',
      e2e_start_command: 'npm run dev',
      paths_ignore: ['SDLC/**', 'compliance/**', 'custom/**'],
      devaudit: { base_url: BASE_URL, project_slug: 'fixture-app', api_key_secret: 'DEVAUDIT_API_KEY' },
      uat: { enabled: true, url: 'https://uat.example.com', required_risk_classes: ['payment'] },
      custom_field: { lives_here: true },
    };
    await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(seeded));
    try {
      await runInstall({
        path: dir,
        dryRun: false,
        nonInteractive: true,
        provider: makeFakeProvider(),
      });
      const after = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      // Wizard-owned fields still come from the plan
      expect(after.project_slug).toBe('fixture-app');
      expect(after.stack).toBe('node');
      expect(after.host).toBe('railway');
      // Customizations preserved
      expect(after.runner).toBe('self-hosted');
      expect(after.sast_baseline).toBe(6);
      expect(after.accepted_dep_risks).toBe('xlsx');
      expect(after.database_service).toBe('mongodb');
      expect(after.database_image).toBe('mongo:7');
      expect(after.database_env.MONGODB_DB_NAME).toBe('fixture_test');
      expect(after.app_env.CUSTOM_APP_FLAG).toBe('on');
      expect(after.build_env.CUSTOM_BUILD_FLAG).toBe('true');
      expect(after.e2e_project).toBe('chromium');
      expect(after.e2e_start_command).toBe('npm run dev');
      expect(after.paths_ignore).toContain('custom/**');
      expect(after.uat.enabled).toBe(true);
      expect(after.uat.url).toBe('https://uat.example.com');
      expect(after.production_url_secret).toBe('CUSTOM_PROD_URL');
      // Unknown / future fields the wizard doesn't know about are preserved too
      expect(after.custom_field).toEqual({ lives_here: true });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('throws when no package.json or pyproject.toml is found', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-install-empty-'));
    try {
      await expect(runInstall({ path: dir, nonInteractive: true })).rejects.toThrow(/Could not detect stack/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('throws when DevAudit rejects the PAT (HTTP 401)', async () => {
    server.use(http.get(`${BASE_URL}/api/projects`, () => new HttpResponse(null, { status: 401 })));
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20' }),
    );
    try {
      await expect(
        runInstall({ path: dir, nonInteractive: true, provider: makeFakeProvider() }),
      ).rejects.toThrow(/PAT rejected/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('warns and skips API key issuance if Onboarding-issued already exists', async () => {
    server.use(
      http.get(`${BASE_URL}/api/projects`, () =>
        HttpResponse.json([{ id: 'existing-id', slug: 'fixture-app', name: 'fixture-app' }]),
      ),
      http.get(`${BASE_URL}/api/projects/:id/api-keys`, () =>
        HttpResponse.json([{ id: 'key-x', name: 'Onboarding-issued', revoked_at: null }]),
      ),
    );
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20' }),
    );
    try {
      const report = await runInstall({
        path: dir,
        nonInteractive: true,
        provider: makeFakeProvider(),
      });
      const step6 = report.steps.find((s) => s.step.startsWith('6/'));
      expect(step6?.status).toBe('warn');
      expect(step6?.message).toMatch(/already exists/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
