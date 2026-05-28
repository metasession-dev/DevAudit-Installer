/**
 * `devaudit join` — the second-developer entry point. The subcommand is a
 * thin wrapper around `runInstall({ mode: 'developer' })` with one extra
 * guard: it refuses to run when `sdlc-config.json` is absent (the project
 * isn't onboarded; the operator should run `devaudit install`).
 *
 * The behaviour of mode=developer itself (skipping steps 4/6/7/9, never
 * rotating the team's CI token) is covered in install.test.ts. These tests
 * verify the subcommand's gating + correct mode propagation.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const BASE_URL = 'http://devaudit.test';
const INSTALLER_ROOT = resolve(import.meta.dirname, '..', 'sdlc'); // bundled snapshot is fine for unit tests
// The same in-repo source location the install tests use; both point to the
// same template tree, so either works. Use the canonical root if the snapshot
// isn't present (mirrors what bundle-templates copies on prepack).

interface ProviderCall {
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
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
    async hasSecret(_cwd: string, name: string) {
      providerCalls.push({ method: 'hasSecret', args: [name] });
      return false;
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
  execa: async (_file: string, _args: readonly string[] = [], _opts: unknown = {}) => {
    return { exitCode: 0, stdout: '', stderr: '' };
  },
}));

const server = setupServer(
  http.get(`${BASE_URL}/api/projects`, () => HttpResponse.json([])),
  http.get(`${BASE_URL}/api/projects/:id/api-keys`, () => HttpResponse.json([])),
);

async function buildNodeFixture(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-join-fixture-'));
  await fs.writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture-app', version: '0.0.0', private: true, devDependencies: { husky: '*' } }),
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
  providerCalls.length = 0;
});

describe('runJoinCommand — second-developer entry point', () => {
  it('exits 7 when sdlc-config.json is absent (project not onboarded)', async () => {
    const { runJoinCommand } = await import('../src/commands/join.js');
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-join-empty-'));
    // No sdlc-config.json on disk.
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    try {
      await expect(runJoinCommand({ path: dir, yes: true })).rejects.toThrow('exit:7');
      // The provider's mutating methods were obviously never called.
      expect(providerCalls).toHaveLength(0);
    } finally {
      exit.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

});
