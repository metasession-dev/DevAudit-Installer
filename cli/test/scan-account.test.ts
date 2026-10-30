import { describe, it, expect, afterEach, beforeAll, afterAll, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execa } from 'execa';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { AUTH_FILE, VIEWER_KEYS_FILE } from '../src/lib/paths.js';
import { cacheFileFor, runScan } from '../src/commands/scan.js';
import { LOCAL_FIXES, NOT_A_TERMINAL_LINE, type AccountPrompts } from '../src/commands/scan-account.js';

// DevAudit-Installer#1116 WP11 — the account step of `devaudit scan`.

const BASE = 'https://devaudit.example.test';
const INSTALLER_ROOT = join(__dirname, '..', '..');
const TOKEN = 'mctok_secret-token-value';

interface Call {
  method: string;
  path: string;
  token: string | null;
  body: string;
}
let calls: Call[] = [];
let handlers: Parameters<typeof server.use>;
const server = setupServer();
beforeAll(() => {
  process.env['DEVAUDIT_BASE_URL'] = BASE;
  server.listen({ onUnhandledFrame: 'error' });
});
afterAll(() => {
  delete process.env['DEVAUDIT_BASE_URL'];
  server.close();
});

const record = async (request: Request): Promise<void> => {
  calls.push({ method: request.method, path: new URL(request.url).pathname, token: request.headers.get('x-devaudit-token'), body: await request.clone().text() });
};

/** A portal where everything the account step needs exists. `pendingPolls` polls answer "pending" first. */
function portal(opts: { projects?: Array<{ id: string; slug: string }>; pendingPolls?: number; deviceStatus?: number; pollError?: string; uploadStatus?: number } = {}): void {
  let polls = 0;
  const projects = opts.projects ?? [];
  server.use(
    http.post(`${BASE}/api/auth/device`, async ({ request }) => {
      await record(request);
      if (opts.deviceStatus) return new HttpResponse('not here', { status: opts.deviceStatus });
      return HttpResponse.json({ user_code: 'ABCD-EFGH', verification_uri: `${BASE}/device`, device_code: 'dev-code-1', interval: 1, expires_in: 60 });
    }),
    http.post(`${BASE}/api/auth/device/token`, async ({ request }) => {
      await record(request);
      polls += 1;
      if (opts.pollError) return HttpResponse.json({ error: opts.pollError }, { status: 400 });
      if (polls <= (opts.pendingPolls ?? 0)) return HttpResponse.json({ error: 'authorization_pending' }, { status: 400 });
      return HttpResponse.json({ token: TOKEN, organisation_id: 'org-1' });
    }),
    http.get(`${BASE}/api/projects`, async ({ request }) => {
      await record(request);
      return HttpResponse.json({ projects });
    }),
    http.post(`${BASE}/api/projects`, async ({ request }) => {
      await record(request);
      return HttpResponse.json({ id: 'proj-1', slug: 'x', name: 'x' });
    }),
    http.post(`${BASE}/api/projects/:id/api-keys`, async ({ request }) => {
      await record(request);
      return HttpResponse.json({ id: 'key-1', name: 'viewer', plainTextKey: 'mck_viewer_value' });
    }),
    http.post(`${BASE}/api/projects/:id/scan-reports`, async ({ request }) => {
      await record(request);
      return opts.uploadStatus ? new HttpResponse('nope', { status: opts.uploadStatus }) : HttpResponse.json({ id: 'report-1' });
    }),
  );
}

const dirs: string[] = [];
beforeEach(async () => {
  calls = [];
  server.resetHandlers();
  await fs.rm(AUTH_FILE, { force: true });
  await fs.rm(VIEWER_KEYS_FILE, { force: true });
});
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function repo(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-scanacct-'));
  dirs.push(dir);
  await execa('git', ['init', '-q'], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, rel)), { recursive: true });
    await fs.writeFile(join(dir, rel), content);
  }
  return dir;
}

function prompts(script: { confirm?: boolean[]; select?: string[] }): { ask: AccountPrompts; asked: string[] } {
  const confirms = [...(script.confirm ?? [])];
  const selects = [...(script.select ?? [])];
  const asked: string[] = [];
  return {
    asked,
    ask: {
      confirm: async (m) => {
        asked.push(m);
        const v = confirms.shift();
        if (v === undefined) throw new Error(`unexpected confirm: ${m}`);
        return v;
      },
      select: async (m) => {
        asked.push(m);
        const v = selects.shift();
        if (v === undefined) throw new Error(`unexpected select: ${m}`);
        return v;
      },
    },
  };
}

async function scan(dir: string, opts: Partial<Parameters<typeof runScan>[0]>, deps: Parameters<typeof runScan>[1]): Promise<{ lines: string[]; code: number }> {
  const lines: string[] = [];
  const code = await runScan({ path: dir, framework: 'soc-2', ...opts }, { installerRoot: INSTALLER_ROOT, say: (l) => void lines.push(l), interactive: false, ...deps });
  return { lines, code };
}

const noStored = { storedToken: async () => null };
const sleep = async (): Promise<void> => undefined;

describe('when the offer is not made', () => {
  it('without a terminal: the line, no offer and zero requests', async () => {
    portal();
    const d = await repo();
    const r = await scan(d, {}, { terminal: false });
    expect(r.lines).toContain(NOT_A_TERMINAL_LINE);
    expect(calls).toEqual([]);
  });

  it('--local and --ci: local fixes only, or nothing; zero requests', async () => {
    portal();
    const d = await repo();
    const local = await scan(d, { local: true }, { terminal: true });
    expect(local.lines).toContain(LOCAL_FIXES);
    expect(local.lines).not.toContain(NOT_A_TERMINAL_LINE);
    const ci = await scan(d, { ci: true }, { terminal: true });
    expect(ci.lines).not.toContain(LOCAL_FIXES);
    expect(calls).toEqual([]);
  });

  it('--json never makes the offer', async () => {
    portal();
    const d = await repo();
    await scan(d, { json: true }, { terminal: true });
    expect(calls).toEqual([]);
  });
});

describe('declined', () => {
  it('consent declined: zero requests, local fixes, no install hand-off', async () => {
    portal();
    const d = await repo();
    const p = prompts({ confirm: [false] });
    let installed = false;
    const r = await scan(d, {}, { terminal: true, account: { ask: p.ask, ...noStored, runInstall: async () => void (installed = true) } });
    expect(p.asked[0]).toContain('Create your free DevAudit account');
    expect(calls).toEqual([]);
    expect(installed).toBe(false);
    expect(r.lines).toContain(LOCAL_FIXES);
  });
});

describe('accepted', () => {
  it('device sign-in, project, viewer key, upload in order; the token is saved, never printed; the upload is the cached report byte for byte', async () => {
    portal({ pendingPolls: 1 });
    const d = await repo({ 'AGENT.md': 'ours' });
    const p = prompts({ confirm: [true], select: ['later'] });
    const r = await scan(d, {}, { terminal: true, account: { ask: p.ask, ...noStored, sleep, fetchImpl: undefined } });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/auth/device',
      'POST /api/auth/device/token',
      'POST /api/auth/device/token',
      'GET /api/projects',
      'POST /api/projects',
      'POST /api/projects/proj-1/api-keys',
      'POST /api/projects/proj-1/scan-reports',
    ]);
    // the token comes from the sign-in, is saved where `auth login` saves it, and appears in no output
    expect(JSON.parse(await fs.readFile(AUTH_FILE, 'utf-8')).token).toBe(TOKEN);
    if (process.platform !== 'win32') expect((await fs.stat(AUTH_FILE)).mode & 0o777).toBe(0o600);
    expect(r.lines.join('\n')).not.toContain(TOKEN);
    expect(r.lines.join('\n')).not.toContain('mck_viewer_value');
    expect(r.lines.join('\n')).toContain('ABCD-EFGH');
    // the viewer key is saved as install saves it
    expect(await fs.readFile(VIEWER_KEYS_FILE, 'utf-8')).toContain('mck_viewer_value');
    expect(JSON.parse(calls[5]!.body)).toMatchObject({ role: 'viewer' });
    expect(JSON.parse(calls[5]!.body).name).toMatch(/^viewer:.+:.+/);
    // the upload carries the person's token and exactly the cached bytes
    expect(calls[6]!.token).toBe(TOKEN);
    expect(calls[6]!.body).toBe(await fs.readFile(cacheFileFor(await fs.realpath(d)), 'utf-8'));
    expect(calls.slice(0, 3).every((c) => c.token === null)).toBe(true);
  });

  it('an existing valid token means no device sign-in', async () => {
    portal();
    const d = await repo();
    const p = prompts({ confirm: [true], select: ['later'] });
    await scan(d, {}, { terminal: true, account: { ask: p.ask, sleep, storedToken: async () => ({ token: TOKEN, baseUrl: BASE }) } });
    expect(calls.some((c) => c.path.startsWith('/api/auth/device'))).toBe(false);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /api/projects/proj-1/scan-reports');
  });

  it('the hand-off: yes runs the guided install with the cached report and the suggested preset; change one thing without a preset; not now only prints the command', async () => {
    const run = async (choice: string): Promise<{ options: Array<Record<string, unknown>>; lines: string[] }> => {
      server.resetHandlers();
      calls = [];
      portal();
      const options: Array<Record<string, unknown>> = [];
      const d = await repo();
      const p = prompts({ confirm: [true], select: [choice] });
      const r = await scan(d, {}, { terminal: true, account: { ask: p.ask, sleep, storedToken: async () => ({ token: TOKEN, baseUrl: BASE }), runInstall: async (o) => void options.push(o) } });
      return { options, lines: r.lines };
    };
    const yes = await run('yes');
    expect(yes.options).toHaveLength(1);
    expect(String(yes.options[0]!['fromScan'])).toMatch(/scans[\\/][0-9a-f]{64}\.json$/);
    expect(['A', 'B', 'C']).toContain(yes.options[0]!['preset'] ?? 'custom-or-none');
    const change = await run('change');
    expect(change.options[0]!['preset']).toBeUndefined();
    expect(change.options[0]!['fromScan']).toBeDefined();
    const later = await run('later');
    expect(later.options).toEqual([]);
    expect(later.lines.join('\n')).toContain('devaudit install --from-scan');
  });
});

describe('the portal does not have the feature yet', () => {
  it('a device route that is not there ends in one plain line and nothing is created', async () => {
    portal({ deviceStatus: 404 });
    const d = await repo();
    const p = prompts({ confirm: [true] });
    const r = await scan(d, {}, { terminal: true, account: { ask: p.ask, ...noStored, sleep } });
    expect(r.lines.join('\n')).toContain('not available on this portal yet');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/auth/device']);
  });

  it('a declined or expired sign-in creates nothing', async () => {
    for (const error of ['access_denied', 'expired_token']) {
      server.resetHandlers();
      calls = [];
      portal({ pollError: error });
      const d = await repo();
      const r = await scan(d, {}, { terminal: true, account: { ask: prompts({ confirm: [true] }).ask, ...noStored, sleep } });
      expect(calls.some((c) => c.path === '/api/projects' && c.method === 'POST'), error).toBe(false);
      expect(r.lines.join('\n')).toMatch(/declined|expired/);
    }
  });

  it('a report route that is not there says so, and the hand-off still runs', async () => {
    portal({ uploadStatus: 404 });
    const d = await repo();
    const r = await scan(d, {}, { terminal: true, account: { ask: prompts({ confirm: [true], select: ['later'] }).ask, sleep, storedToken: async () => ({ token: TOKEN, baseUrl: BASE }) } });
    expect(r.lines.join('\n')).toContain('Saving a report is not available on this portal yet');
  });
});

describe('an already onboarded repository', () => {
  const onboarded = { 'sdlc-config.json': JSON.stringify({ project_slug: 'example-app', devaudit: { project_slug: 'example-app', base_url: BASE } }) };

  it('uploads to the existing project with the personal access token and creates nothing', async () => {
    portal({ projects: [{ id: 'proj-9', slug: 'example-app' }] });
    const d = await repo(onboarded);
    const p = prompts({ confirm: [true] });
    const r = await scan(d, {}, { terminal: true, account: { ask: p.ask, sleep, storedToken: async () => ({ token: TOKEN, baseUrl: BASE }) } });
    expect(p.asked[0]).toBe('Save this report to example-app?');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/projects')).toBe(false);
    expect(calls.some((c) => c.path.endsWith('/api-keys'))).toBe(false);
    const up = calls.find((c) => c.path === '/api/projects/proj-9/scan-reports')!;
    expect(up.token).toBe(TOKEN);
    expect(r.lines.join('\n')).toContain('devaudit configure');
  });

  it('with only a viewer key (no token) uploads nothing and prints the auth login line', async () => {
    portal();
    const d = await repo(onboarded);
    const r = await scan(d, {}, { terminal: true, account: { ask: prompts({}).ask, ...noStored, sleep } });
    expect(calls).toEqual([]);
    expect(r.lines).toContain('Run `devaudit auth login` to save this report to example-app.');
  });
});
