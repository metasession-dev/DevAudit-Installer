import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const BASE_URL = 'https://devaudit.test';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
});

afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  delete process.env['DEVAUDIT_USER_TOKEN'];
  delete process.env['DEVAUDIT_BASE_URL'];
});

describe('repoNameFromUrl', () => {
  it('derives the trailing path segment, stripping .git and trailing slashes', async () => {
    const { repoNameFromUrl } = await import('../src/commands/fleet.js');
    expect(repoNameFromUrl('https://github.com/metasession-dev/fleet-control.git')).toBe('fleet-control');
    expect(repoNameFromUrl('https://github.com/metasession-dev/fleet-control')).toBe('fleet-control');
    expect(repoNameFromUrl('https://github.com/metasession-dev/fleet-control/')).toBe('fleet-control');
    expect(repoNameFromUrl('git@github.com:metasession-dev/fleet-control.git')).toBe('fleet-control');
  });

  it('returns null for a URL with no discernible trailing segment', async () => {
    const { repoNameFromUrl } = await import('../src/commands/fleet.js');
    expect(repoNameFromUrl('')).toBeNull();
  });
});

describe('runFleetDoctor', () => {
  it('exits 3 and reports not_logged_in when no token is available', async () => {
    const { runFleetDoctor } = await import('../src/commands/fleet.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((() => undefined) as never));
    await runFleetDoctor({ baseDir: '/tmp' });
    expect(exitSpy).toHaveBeenCalledWith(3);
  });

  it('sweeps projects checked out locally as siblings, skipping ones that are not', async () => {
    process.env['DEVAUDIT_USER_TOKEN'] = 'test-token';
    process.env['DEVAUDIT_BASE_URL'] = BASE_URL;

    const workspace = await fs.mkdtemp(join(tmpdir(), 'fleet-doctor-'));
    const baseDir = join(workspace, 'DevAudit-Installer');
    const siblingRepo = join(workspace, 'fleet-control');
    await fs.mkdir(baseDir, { recursive: true });
    await fs.mkdir(siblingRepo, { recursive: true });

    server.use(
      http.get(`${BASE_URL}/api/projects`, () =>
        HttpResponse.json([
          { id: '1', slug: 'fleet-control-api', name: 'fleet-control-api', repo_url: 'https://github.com/metasession-dev/fleet-control.git' },
          { id: '2', slug: 'not-checked-out', name: 'not-checked-out', repo_url: 'https://github.com/metasession-dev/nowhere-to-be-found.git' },
          { id: '3', slug: 'no-repo-url', name: 'no-repo-url', repo_url: null },
        ]),
      ),
    );

    const runDoctorJson = vi.fn(async (dir: string) => {
      expect(dir).toBe(siblingRepo);
      return { exitCode: 0, json: { ok: true } };
    });

    const { runFleetDoctor } = await import('../src/commands/fleet.js');
    await runFleetDoctor({ baseDir, runDoctorJson });

    expect(runDoctorJson).toHaveBeenCalledTimes(1);
    expect(runDoctorJson).toHaveBeenCalledWith(siblingRepo);

    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('propagates a non-zero doctor exit code as an "issues" result without throwing', async () => {
    process.env['DEVAUDIT_USER_TOKEN'] = 'test-token';
    process.env['DEVAUDIT_BASE_URL'] = BASE_URL;

    const workspace = await fs.mkdtemp(join(tmpdir(), 'fleet-doctor-'));
    const baseDir = join(workspace, 'DevAudit-Installer');
    const siblingRepo = join(workspace, 'flaky-consumer');
    await fs.mkdir(baseDir, { recursive: true });
    await fs.mkdir(siblingRepo, { recursive: true });

    server.use(
      http.get(`${BASE_URL}/api/projects`, () =>
        HttpResponse.json([
          { id: '1', slug: 'flaky-consumer', name: 'flaky-consumer', repo_url: 'https://github.com/metasession-dev/flaky-consumer' },
        ]),
      ),
    );

    const runDoctorJson = vi.fn(async () => ({ exitCode: 6, json: { ok: false } }));

    const { runFleetDoctor } = await import('../src/commands/fleet.js');
    // Should not throw even though the swept project reports issues.
    await expect(runFleetDoctor({ baseDir, runDoctorJson })).resolves.toBeUndefined();
    expect(runDoctorJson).toHaveBeenCalledTimes(1);

    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('exits 3 when the portal rejects the token', async () => {
    process.env['DEVAUDIT_USER_TOKEN'] = 'bad-token';
    process.env['DEVAUDIT_BASE_URL'] = BASE_URL;
    server.use(http.get(`${BASE_URL}/api/projects`, () => new HttpResponse(null, { status: 401 })));

    const { runFleetDoctor } = await import('../src/commands/fleet.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((() => undefined) as never));
    await runFleetDoctor({ baseDir: '/tmp' });
    expect(exitSpy).toHaveBeenCalledWith(3);
  });
});
