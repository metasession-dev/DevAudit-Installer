import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// DevAudit-Installer#1272, #1274 — `devaudit install --yes --compliance <mode> --delivery` end to end on a fresh
// repository (no sdlc-config.json): no prompt, the preset the mode names, the delivery config and workflow, the
// delivery-agent key and the repository secrets. The portal and GitHub are stubbed.

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const BASE_URL = 'https://devaudit.test';

interface ProviderCall {
  readonly method: string;
  readonly args: readonly unknown[];
}
const providerCalls: ProviderCall[] = [];
const keyRequests: Array<{ name: string; role: string }> = [];
const policyRequests: Array<{ approval_policy: string }> = [];

function makeFakeProvider() {
  return {
    name: 'github' as const,
    async getRepoMeta() {
      return { owner: 'example-org', name: 'fixture-app', defaultBranch: 'main' };
    },
    async setSecret(_cwd: string, name: string, value: string) {
      providerCalls.push({ method: 'setSecret', args: [name, value] });
    },
    async setVariable(_cwd: string, name: string, value: string) {
      providerCalls.push({ method: 'setVariable', args: [name, value] });
    },
    async hasSecret() {
      return false;
    },
    async deleteSecret() {},
    async deleteVariable() {},
    async setDefaultBranch() {
      return { changed: true };
    },
    async applyBranchProtection() {
      return { applied: true };
    },
    async ensureBranchProtection() {
      return { status: 'ok' as const };
    },
    async createPullRequest() {
      return { url: 'https://github.com/example-org/fixture-app/pull/1' };
    },
  };
}

vi.mock('execa', () => ({
  execa: async (file: string, args: readonly string[] = []) => {
    if (file === 'which' || file === 'where') return { exitCode: 0, stdout: `/usr/bin/${args[0]}`, stderr: '' };
    if (file === 'git' && args[0] === 'config' && args.includes('remote.origin.url')) {
      return { exitCode: 0, stdout: 'git@github.com:example-org/fixture-app.git', stderr: '' };
    }
    if (file === 'git' && args[0] === 'rev-parse' && args.includes('--show-toplevel')) return { exitCode: 128, stdout: '', stderr: 'not a git repository' };
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
  http.patch(`${BASE_URL}/api/projects/:id/approval-policy`, async ({ request }) => {
    policyRequests.push((await request.json()) as { approval_policy: string });
    return HttpResponse.json({ ok: true });
  }),
  http.post(`${BASE_URL}/api/projects/:id/api-keys`, async ({ request }) => {
    const body = (await request.json()) as { name: string; role: string };
    keyRequests.push(body);
    return HttpResponse.json({ id: `key-${keyRequests.length}`, name: body.name, plainTextKey: `plain_${body.name}` }, { status: 201 });
  }),
];
const server = setupServer(...handlers);

const FULL = "export default { projects: [{ name: 'smoke' }, { name: 'critical' }, { name: 'regression' }] };\n";
const SMOKE = "export default { projects: [{ name: 'smoke' }] };\n";

async function fixture(playwright: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-install-headless-'));
  await fs.writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'fixture-app',
      version: '0.0.0',
      private: true,
      devDependencies: { husky: '*', '@commitlint/cli': '*', '@commitlint/config-conventional': '*', 'lint-staged': '*', prettier: '*', eslint: '*', typescript: '*', '@playwright/test': '*' },
    }),
  );
  await fs.writeFile(join(dir, 'playwright.config.ts'), playwright);
  await fs.mkdir(join(dir, '.husky'), { recursive: true });
  await fs.mkdir(join(dir, 'scripts'), { recursive: true });
  await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  return dir;
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
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
  providerCalls.length = 0;
  keyRequests.length = 0;
  policyRequests.length = 0;
  server.resetHandlers(...handlers);
});

const ENV = { DEVAUDIT_AGENT_API_KEY: 'sk-agent-session' };

async function install(dir: string, extra: Record<string, unknown> = {}) {
  const { runInstall } = await import('../src/install/index.js');
  return runInstall({
    path: dir,
    dryRun: false,
    nonInteractive: true,
    provider: makeFakeProvider(),
    viewerKey: false,
    compliance: 'regulated',
    delivery: true,
    env: ENV,
    ...extra,
  });
}

const stepOf = (report: Awaited<ReturnType<typeof install>>, start: string) => report.steps.find((s) => s.step.startsWith(start));

describe('install --yes --compliance regulated --delivery on a fresh repository', () => {
  it('completes with no prompt and sets up the preset, the delivery config, the workflow, the key and the secrets', async () => {
    const dir = await fixture(FULL);
    try {
      const report = await install(dir);
      expect(stepOf(report, '4/')?.status).toBe('ok');
      expect(stepOf(report, '7b/')?.status).toBe('ok');
      const cfg = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8')) as Record<string, any>;
      expect(cfg['onboarding_preset']).toBe('C');
      expect(cfg['delivery']).toEqual({ enabled: true, max_turns: 200, max_minutes: 90 });
      // the sync step, run last, generated the workflow and the prompt from that config
      const workflow = await fs.readFile(join(dir, '.github', 'workflows', 'devaudit-delivery.yml'), 'utf8');
      expect(workflow).toContain('repository_dispatch');
      expect(await fs.readFile(join(dir, '.devaudit', 'delivery-prompt.md'), 'utf8')).toContain('sdlc-implementer');
      // two portal keys: the gates' key and the agent's, each with the role it needs
      expect(keyRequests).toEqual([
        { name: 'Onboarding-issued', role: 'uploader' },
        { name: 'delivery-agent', role: 'uploader' },
      ]);
      const secrets = providerCalls.filter((c) => c.method === 'setSecret');
      const byName = new Map(secrets.map((c) => [c.args[0] as string, c.args[1] as string]));
      expect(byName.get('DEVAUDIT_API_KEY')).toBe('plain_Onboarding-issued');
      expect(byName.get('DEVAUDIT_AGENT_PORTAL_KEY')).toBe('plain_delivery-agent');
      expect(byName.get('DEVAUDIT_AGENT_API_KEY')).toBe('sk-agent-session');
      expect(byName.has('DEVAUDIT_AGENT_GITHUB_TOKEN')).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('without a full test pack falls back to preset B and still completes', async () => {
    const dir = await fixture(SMOKE);
    try {
      const report = await install(dir);
      expect(stepOf(report, '7b/')?.status).toBe('ok');
      const cfg = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8')) as Record<string, any>;
      expect(cfg['onboarding_preset']).toBe('B');
      // B means the author approves; the mode is the consent, so the policy is set on the portal without a question
      expect(policyRequests).toEqual([{ approval_policy: 'self_allowed_with_gap', reason: expect.stringContaining('preset B') }]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('without --delivery it issues one key, sets one key secret, and writes no delivery config or workflow', async () => {
    const dir = await fixture(FULL);
    try {
      const report = await install(dir, { delivery: false });
      expect(stepOf(report, '7b/')).toBeUndefined();
      expect(keyRequests).toEqual([{ name: 'Onboarding-issued', role: 'uploader' }]);
      const names = providerCalls.filter((c) => c.method === 'setSecret').map((c) => c.args[0]);
      expect(names).not.toContain('DEVAUDIT_AGENT_PORTAL_KEY');
      expect(names).not.toContain('DEVAUDIT_AGENT_API_KEY');
      const cfg = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8')) as Record<string, any>;
      expect(cfg['delivery']).toBeUndefined();
      await expect(fs.stat(join(dir, '.github', 'workflows', 'devaudit-delivery.yml'))).rejects.toThrow();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('a rerun reuses the delivery-agent key and does not issue a second one', async () => {
    const dir = await fixture(FULL);
    server.use(http.get(`${BASE_URL}/api/projects/:id/api-keys`, () => HttpResponse.json([{ id: 'k9', name: 'delivery-agent', revoked_at: null }])));
    try {
      const report = await install(dir);
      expect(stepOf(report, '7b/')?.message).toMatch(/already exists and is reused/);
      expect(keyRequests.filter((k) => k.name === 'delivery-agent')).toEqual([]);
      const names = providerCalls.filter((c) => c.method === 'setSecret').map((c) => c.args[0]);
      expect(names).not.toContain('DEVAUDIT_AGENT_PORTAL_KEY');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
