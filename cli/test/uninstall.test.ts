/**
 * `devaudit uninstall` — disconnects a repo from a DevAudit project:
 * revokes the project's API key(s), deletes the GitHub secrets/variables
 * `install` wrote, and removes the target from sdlc-config.json.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE_URL = 'http://devaudit.test';

interface ProviderCall {
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
}
const providerCalls: ProviderCall[] = [];
const revokedKeyIds: string[] = [];

function makeFakeProvider() {
  return {
    name: 'github' as const,
    async getRepoMeta(_cwd: string) {
      return { owner: 'metasession-dev', name: 'fixture-app', defaultBranch: 'main' };
    },
    async setSecret() {},
    async setVariable() {},
    async hasSecret() {
      return false;
    },
    async deleteSecret(_cwd: string, name: string) {
      providerCalls.push({ method: 'deleteSecret', args: [name] });
    },
    async deleteVariable(_cwd: string, name: string) {
      providerCalls.push({ method: 'deleteVariable', args: [name] });
    },
    async setDefaultBranch() {
      return { changed: false };
    },
    async applyBranchProtection() {
      return { applied: true };
    },
    async createPullRequest() {
      return { url: 'https://github.com/metasession-dev/fixture-app/pull/1' };
    },
  };
}

const server = setupServer(
  http.get(`${BASE_URL}/api/projects`, () =>
    HttpResponse.json([{ id: 'proj-1', slug: 'fixture-app', name: 'fixture-app' }]),
  ),
  http.get(`${BASE_URL}/api/projects/proj-1/api-keys`, () =>
    HttpResponse.json([
      { id: 'key-1', name: 'Onboarding-issued', revoked_at: null },
      { id: 'key-2', name: 'rotated', revoked_at: '2026-01-01T00:00:00Z' },
    ]),
  ),
  http.delete(`${BASE_URL}/api/projects/proj-1/api-keys/key-1`, () => {
    revokedKeyIds.push('key-1');
    return HttpResponse.json({ id: 'key-1' });
  }),
);

async function writeConfig(dir: string, content: unknown): Promise<void> {
  await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(content, null, 2), 'utf-8');
}

async function fixtureDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), 'cli-uninstall-fixture-'));
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  providerCalls.length = 0;
  revokedKeyIds.length = 0;
  server.resetHandlers();
});

describe('runUninstall', () => {
  it('errors when sdlc-config.json is absent', async () => {
    const { runUninstall } = await import('../src/uninstall/index.js');
    const dir = await fixtureDir();
    try {
      await expect(
        runUninstall({ path: dir, token: 't', nonInteractive: true, provider: makeFakeProvider() }),
      ).rejects.toThrow(/No sdlc-config.json found/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('revokes the live API key, deletes GitHub secrets/variables, and removes sdlc-config.json', async () => {
    const { runUninstall } = await import('../src/uninstall/index.js');
    const dir = await fixtureDir();
    await writeConfig(dir, {
      project_slug: 'fixture-app',
      stack: 'node',
      working_directory: '.',
      devaudit: {
        base_url: BASE_URL,
        project_slug: 'fixture-app',
        api_key_secret: 'DEVAUDIT_API_KEY',
      },
    });
    try {
      const report = await runUninstall({
        path: dir,
        token: 't',
        nonInteractive: true,
        provider: makeFakeProvider(),
      });

      expect(report.projectSlug).toBe('fixture-app');
      expect(revokedKeyIds).toEqual(['key-1']);

      const deletedSecrets = providerCalls
        .filter((c) => c.method === 'deleteSecret')
        .map((c) => c.args[0]);
      expect(deletedSecrets).toEqual(['DEVAUDIT_API_KEY', 'DEVAUDIT_USER_TOKEN']);
      expect(providerCalls.some((c) => c.method === 'deleteVariable' && c.args[0] === 'DEVAUDIT_BASE_URL')).toBe(
        true,
      );

      const exists = await fs
        .access(join(dir, 'sdlc-config.json'))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);

      const configStep = report.steps.find((s) => s.step.includes('Remove target'));
      expect(configStep?.status).toBe('ok');
      expect(configStep?.message).toContain('deleted sdlc-config.json');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('treats an already-deleted portal project as a successful no-op key revoke', async () => {
    server.use(http.get(`${BASE_URL}/api/projects`, () => HttpResponse.json([])));
    const { runUninstall } = await import('../src/uninstall/index.js');
    const dir = await fixtureDir();
    await writeConfig(dir, {
      project_slug: 'fixture-app',
      stack: 'node',
      working_directory: '.',
      devaudit: {
        base_url: BASE_URL,
        project_slug: 'fixture-app',
        api_key_secret: 'DEVAUDIT_API_KEY',
      },
    });
    try {
      const report = await runUninstall({
        path: dir,
        token: 't',
        nonInteractive: true,
        provider: makeFakeProvider(),
      });
      const keyStep = report.steps.find((s) => s.step.includes('Revoke project API key'));
      expect(keyStep?.status).toBe('ok');
      expect(keyStep?.message).toMatch(/no longer exists on the portal/);
      expect(revokedKeyIds).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('dry-run performs no mutations', async () => {
    const { runUninstall } = await import('../src/uninstall/index.js');
    const dir = await fixtureDir();
    await writeConfig(dir, {
      project_slug: 'fixture-app',
      stack: 'node',
      working_directory: '.',
      devaudit: {
        base_url: BASE_URL,
        project_slug: 'fixture-app',
        api_key_secret: 'DEVAUDIT_API_KEY',
      },
    });
    try {
      const report = await runUninstall({
        path: dir,
        token: 't',
        nonInteractive: true,
        dryRun: true,
        provider: makeFakeProvider(),
      });
      expect(report.dryRun).toBe(true);
      expect(report.steps.every((s) => s.status === 'planned')).toBe(true);
      expect(providerCalls).toHaveLength(0);
      expect(revokedKeyIds).toEqual([]);
      const exists = await fs
        .access(join(dir, 'sdlc-config.json'))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('--target selects among multiple configured targets, leaving the other(s) intact', async () => {
    const { runUninstall } = await import('../src/uninstall/index.js');
    const dir = await fixtureDir();
    await writeConfig(dir, {
      project_slug: 'thorstack',
      targets: [
        {
          name: 'fixture-app',
          stack: 'node',
          working_directory: '.',
          devaudit: {
            base_url: BASE_URL,
            project_slug: 'fixture-app',
            api_key_secret: 'DEVAUDIT_API_KEY',
          },
        },
        {
          name: 'other',
          stack: 'python',
          working_directory: 'other',
          devaudit: {
            base_url: BASE_URL,
            project_slug: 'other-slug',
            api_key_secret: 'DEVAUDIT_API_KEY_OTHER',
          },
        },
      ],
    });
    try {
      const report = await runUninstall({
        path: dir,
        token: 't',
        nonInteractive: true,
        target: 'fixture-app',
        provider: makeFakeProvider(),
      });
      expect(report.targetName).toBe('fixture-app');
      const configStep = report.steps.find((s) => s.step.includes('Remove target'));
      expect(configStep?.message).toContain('other');

      const raw = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')) as {
        project_slug: string;
      };
      expect(raw.project_slug).toBe('other-slug');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('errors asking for --target when multiple targets exist and none is specified', async () => {
    const { runUninstall } = await import('../src/uninstall/index.js');
    const dir = await fixtureDir();
    await writeConfig(dir, {
      project_slug: 'thorstack',
      targets: [
        {
          name: 'fixture-app',
          stack: 'node',
          working_directory: '.',
          devaudit: { base_url: BASE_URL, project_slug: 'fixture-app', api_key_secret: 'DEVAUDIT_API_KEY' },
        },
        {
          name: 'other',
          stack: 'python',
          working_directory: 'other',
          devaudit: { base_url: BASE_URL, project_slug: 'other-slug', api_key_secret: 'DEVAUDIT_API_KEY_OTHER' },
        },
      ],
    });
    try {
      await expect(
        runUninstall({ path: dir, token: 't', nonInteractive: true, provider: makeFakeProvider() }),
      ).rejects.toThrow(/--target/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
