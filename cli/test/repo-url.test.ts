import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { normalizeRemoteUrl, repoUrlFromRemote } from '../src/lib/repo-url.js';
import { findOrCreateProject } from '../src/install/project.js';
import type { InstallContext, InstallPlan } from '../src/install/types.js';

// The portal will not create a project without the repository's web address (metasession-dev/devaudit#826).
// `install` and `scan` read it from the `origin` remote, as an https address, without credentials.

describe('normalizeRemoteUrl', () => {
  it('turns the usual remotes into an https address', () => {
    for (const [remote, expected] of [
      ['git@github.com:example-org/example-app.git', 'https://github.com/example-org/example-app'],
      ['github.com:example-org/example-app', 'https://github.com/example-org/example-app'],
      ['https://github.com/example-org/example-app.git', 'https://github.com/example-org/example-app'],
      ['https://github.com/example-org/example-app/', 'https://github.com/example-org/example-app'],
      ['http://git.example.test/team/sub/app.git', 'https://git.example.test/team/sub/app'],
      ['ssh://git@git.example.test:2222/team/app.git', 'https://git.example.test/team/app'],
      ['git://github.com/example-org/example-app.git', 'https://github.com/example-org/example-app'],
      ['https://git.example.test:8443/team/app.git', 'https://git.example.test:8443/team/app'],
    ] as const) {
      expect(normalizeRemoteUrl(remote), remote).toBe(expected);
    }
  });

  it('never carries credentials', () => {
    for (const remote of ['https://user:secret-token@github.com/example-org/example-app.git', 'https://secret-token@github.com/example-org/example-app', 'ssh://deploy:pw@github.com/example-org/example-app.git']) {
      const url = normalizeRemoteUrl(remote);
      expect(url, remote).toBe('https://github.com/example-org/example-app');
      expect(url).not.toMatch(/secret-token|deploy|pw@/);
    }
  });

  it('refuses what is not an address of a repository', () => {
    for (const remote of ['', '   ', 'not a url', '/srv/git/example-app.git', 'file:///srv/git/example-app.git', 'https://github.com/', 'https://github.com', 'git@github.com:', 'git@github.com:a/../b', 'ftp://github.com/a/b']) {
      expect(normalizeRemoteUrl(remote), JSON.stringify(remote)).toBeNull();
    }
  });
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function gitRepo(remote: string | null): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-repourl-'));
  dirs.push(dir);
  await execa('git', ['init', '-q'], { cwd: dir });
  if (remote !== null) await execa('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  return dir;
}

describe('repoUrlFromRemote', () => {
  it('reads the origin remote of a real repository, and says nothing when there is none', async () => {
    expect(await repoUrlFromRemote(await gitRepo('git@github.com:example-org/example-app.git'))).toBe('https://github.com/example-org/example-app');
    expect(await repoUrlFromRemote(await gitRepo(null))).toBeNull();
  });
});

describe('install step 5, find or create the project', () => {
  const BASE = 'https://devaudit.example.test';
  let posted: Array<Record<string, unknown>> = [];
  const server = setupServer(
    http.get(`${BASE}/api/projects`, () => HttpResponse.json([])),
    http.post(`${BASE}/api/projects`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posted.push(body);
      return HttpResponse.json({ id: '11111111-aaaa-bbbb-cccc-222222222222', slug: body['slug'], name: body['name'] }, { status: 201 });
    }),
  );
  beforeAll(() => server.listen());
  afterAll(() => server.close());
  afterEach(() => {
    posted = [];
    server.resetHandlers();
  });

  const ctxFor = (repoRoot: string): InstallContext => ({ token: 't', baseUrl: BASE, dryRun: false, repoRoot }) as unknown as InstallContext;
  const planFor = (): InstallPlan => ({ projectSlug: 'example-app' }) as unknown as InstallPlan;

  it('sends repo_url from the origin remote when it creates the project', async () => {
    const result = await findOrCreateProject(ctxFor(await gitRepo('git@github.com:example-org/example-app.git')), planFor());
    expect(result.status).toBe('ok');
    expect(posted).toEqual([{ slug: 'example-app', name: 'example-app', repo_url: 'https://github.com/example-org/example-app' }]);
  });

  it('fails clearly, and requests nothing, when there is no origin remote', async () => {
    const result = await findOrCreateProject(ctxFor(await gitRepo(null)), planFor());
    expect(result.status).toBe('fail');
    expect(result.message).toContain('git remote add origin');
    expect(posted).toEqual([]);
  });
});
