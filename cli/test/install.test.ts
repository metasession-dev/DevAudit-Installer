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
  server.resetHandlers(...handlers);
});

describe('runInstall — native TS install against a node fixture', () => {
  it('dry-run produces a plan without mutating disk or calling execa', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    try {
      const report = await runInstall({ path: dir, dryRun: true, nonInteractive: true });
      expect(report.dryRun).toBe(true);
      expect(report.steps.find((s) => s.step.startsWith('4/'))?.status).toBe('planned');
      expect(report.steps.find((s) => s.step.startsWith('5/'))?.status).toBe('planned');
      expect(report.steps.find((s) => s.step.startsWith('7/'))?.status).toBe('planned');
      // No write of sdlc-config.json in dry run
      await expect(fs.stat(join(dir, 'sdlc-config.json'))).rejects.toThrow();
      // dry-run may call read-only `gh repo view` but never mutating commands
      const mutating = execaCalls.filter(
        (c) =>
          (c.file === 'gh' && (c.args[0] === 'secret' || c.args[0] === 'variable' || c.args[1] === 'PUT')) ||
          c.file === 'pre-commit' ||
          c.file === 'npx',
      );
      expect(mutating).toHaveLength(0);
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
      const report = await runInstall({ path: dir, dryRun: false, nonInteractive: true });
      expect(report.dryRun).toBe(false);
      const stepByStart = (s: string) => report.steps.find((x) => x.step.startsWith(s));
      expect(stepByStart('1/')?.status).toBe('ok');
      expect(stepByStart('2/')?.status).toBe('ok');
      expect(stepByStart('4/')?.status).toBe('ok');
      expect(stepByStart('5/')?.status).toBe('ok');
      expect(stepByStart('6/')?.status).toBe('ok');
      expect(stepByStart('7/')?.status).toBe('ok');
      expect(stepByStart('8/')?.status).toBe('ok');
      expect(stepByStart('10/')?.status).toBe('ok');
      // sdlc-config.json was rewritten by step 4
      const written = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      expect(written.stack).toBe('node');
      expect(written.project_slug).toBe('fixture-app');
      // gh secret set + gh variable set were called
      const ghCalls = execaCalls.filter((c) => c.file === 'gh');
      const secretNames = ghCalls
        .filter((c) => c.args[0] === 'secret' && c.args[1] === 'set')
        .map((c) => c.args[2]);
      expect(secretNames).toContain('DEVAUDIT_API_KEY');
      expect(secretNames).toContain('DEVAUDIT_USER_TOKEN');
      const variableCall = ghCalls.find((c) => c.args[0] === 'variable' && c.args[1] === 'set');
      expect(variableCall?.args[2]).toBe('DEVAUDIT_BASE_URL');
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
      await expect(runInstall({ path: dir, nonInteractive: true })).rejects.toThrow(/PAT rejected/);
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
      const report = await runInstall({ path: dir, nonInteractive: true });
      const step6 = report.steps.find((s) => s.step.startsWith('6/'));
      expect(step6?.status).toBe('warn');
      expect(step6?.message).toMatch(/already exists/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
