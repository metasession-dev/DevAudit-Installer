import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDeliveryGithubToken, type GithubTokenDeps, type GithubTokenOptions } from '../src/commands/delivery-github-token.js';

// DevAudit-Installer#1286 — `devaudit delivery github-token`: the secret, the portal's GitHub App token, the cache,
// the git credential protocol, the author, and the failures.

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-delivery-token-'));
  dirs.push(dir);
  return dir;
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** A fetch that answers the portal and the GitHub API from a script; every call is recorded. */
function net(answers: { portal?: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>; user?: { status: number; body?: unknown } } = {}) {
  const calls: Call[] = [];
  let p = 0;
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string> });
    if (url.endsWith('/user')) {
      const u = answers.user ?? { status: 200, body: { id: 4242, login: 'agent-user' } };
      return new Response(JSON.stringify(u.body ?? {}), { status: u.status });
    }
    const list = answers.portal ?? [];
    const a = list[Math.min(p, list.length - 1)] ?? { status: 503, body: { code: 'not_configured' } };
    p += 1;
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body ?? {}), { status: a.status, headers: a.headers });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl, portalCalls: () => calls.filter((c) => c.url.includes('/delivery-runs/')) };
}

const FUTURE = (ms: number, now: number) => new Date(now + ms).toISOString();
const NOW = Date.parse('2026-11-17T12:00:00Z');
const GOOD = (token = 'ghs_app_token', ms = 60 * 60 * 1000) => ({
  status: 200,
  body: { token, expiresAt: FUTURE(ms, NOW), author: { name: 'DevAudit Agent', email: '123+devaudit-agent[bot]@users.noreply.github.com' } },
});

async function call(options: GithubTokenOptions, env: Record<string, string>, n = net({ portal: [GOOD()] }), extra: Partial<GithubTokenDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const stateDir = extra.stateDir ?? (await tmp());
  const code = await runDeliveryGithubToken(options, {
    env: { DEVAUDIT_AGENT_PORTAL_KEY: 'mc_agent', DEVAUDIT_BASE_URL: 'https://portal.example.test', ...env },
    fetchImpl: n.fetchImpl,
    stateDir,
    cwd: await tmp(),
    now: () => NOW,
    sleep: async () => undefined,
    stdout: (t) => void out.push(t),
    stderr: (t) => void err.push(t),
    ...extra,
  });
  return { code, out: out.join(''), err: err.join(''), n, stateDir };
}

const RUN = { run: 'run_1' };

describe('the token source', () => {
  it('uses the repository secret when it is set, and never asks the portal', async () => {
    const n = net();
    const r = await call(RUN, { DEVAUDIT_AGENT_GITHUB_TOKEN: 'github_pat_machine' }, n);
    expect(r.code).toBe(0);
    expect(r.out).toBe('github_pat_machine\n');
    expect(n.calls).toEqual([]);
  });

  it('asks the portal with the delivery-agent key when there is no secret', async () => {
    const r = await call(RUN, {});
    expect(r.code).toBe(0);
    expect(r.out).toBe('ghs_app_token\n');
    const [c] = r.n.portalCalls();
    expect(c!.url).toBe('https://portal.example.test/api/ci/delivery-runs/run_1/github-token');
    expect(c!.method).toBe('POST');
    expect(c!.headers['authorization']).toBe('Bearer mc_agent');
  });

  it('takes the run id from RUN_ID when --run is not given', async () => {
    const r = await call({}, { RUN_ID: 'run_env' });
    expect(r.n.portalCalls()[0]!.url).toContain('/delivery-runs/run_env/');
  });

  it('fails with a usage error for a missing or malformed run id', async () => {
    expect((await call({}, {})).code).toBe(2);
    expect((await call({ run: 'a b' }, {})).code).toBe(2);
  });

  it('a blank secret counts as not set', async () => {
    const r = await call(RUN, { DEVAUDIT_AGENT_GITHUB_TOKEN: '   ' });
    expect(r.n.portalCalls()).toHaveLength(1);
  });
});

describe('when there is no token', () => {
  const both = (err: string) => {
    expect(err).toContain('DEVAUDIT_AGENT_GITHUB_TOKEN');
    expect(err).toContain('DevAudit Agent GitHub App');
    expect(err).toContain('never used');
  };

  it('a 409 not_installed names the install link and both options', async () => {
    const r = await call(RUN, {}, net({ portal: [{ status: 409, body: { code: 'not_installed', installUrl: 'https://github.com/apps/devaudit-agent/installations/new' } }] }));
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toContain('https://github.com/apps/devaudit-agent/installations/new');
    both(r.err);
  });

  it('a 503 not_configured, a refused key, a finished run and a rate limit each say what happened', async () => {
    const cases: Array<[{ status: number; body?: unknown; headers?: Record<string, string> }, string]> = [
      [{ status: 503, body: { code: 'not_configured' } }, 'no DevAudit Agent GitHub App configured'],
      [{ status: 401, body: {} }, 'did not accept the delivery-agent key'],
      [{ status: 409, body: { code: 'DELIVERY_RUN_NOT_ACTIVE' } }, 'the run is not active'],
      [{ status: 429, body: {}, headers: { 'retry-after': '120' } }, 'retry after 120 seconds'],
      [{ status: 422, body: { code: 'REPO_URL_UNSUPPORTED' } }, 'REPO_URL_UNSUPPORTED'],
    ];
    for (const [answer, text] of cases) {
      const r = await call(RUN, {}, net({ portal: [answer] }));
      expect(r.code, text).toBe(1);
      expect(r.err, text).toContain(text);
      both(r.err);
    }
  });

  it('does not retry a refusal, and retries a 5xx up to three times', async () => {
    const refused = net({ portal: [{ status: 409, body: { code: 'not_installed' } }] });
    await call(RUN, {}, refused);
    expect(refused.portalCalls()).toHaveLength(1);
    const flaky = net({ portal: [{ status: 502 }, { status: 502 }, GOOD()] });
    expect((await call(RUN, {}, flaky)).code).toBe(0);
    expect(flaky.portalCalls()).toHaveLength(3);
    const down = net({ portal: [{ status: 502 }] });
    expect((await call(RUN, {}, down)).code).toBe(1);
    expect(down.portalCalls()).toHaveLength(3);
  });

  it('a 200 without a usable token, expiry or author is a failure, not a token', async () => {
    for (const body of [{}, { token: 'x' }, { token: 'x', expiresAt: 'soon', author: { name: 'a', email: 'b' } }, { token: 'x', expiresAt: FUTURE(1000, NOW), author: { name: 'a' } }]) {
      const r = await call(RUN, {}, net({ portal: [{ status: 200, body }] }));
      expect(r.code).toBe(1);
      expect(r.out).toBe('');
    }
  });

  it('no portal key and no secret fails and names both options', async () => {
    const r = await call(RUN, { DEVAUDIT_AGENT_PORTAL_KEY: '' });
    expect(r.code).toBe(1);
    both(r.err);
  });

  it('a network failure fails', async () => {
    const down = { calls: [], fetchImpl: (async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch, portalCalls: () => [] };
    const r = await call(RUN, {}, down);
    expect(r.code).toBe(1);
    expect(r.err).toContain('no response');
  });
});

describe('the cache: a fresh token for every push, without hammering the portal', () => {
  it('reuses a token until ten minutes before it expires, then asks again', async () => {
    const n = net({ portal: [GOOD('ghs_first', 60 * 60 * 1000), GOOD('ghs_second', 60 * 60 * 1000)] });
    const stateDir = await tmp();
    expect((await call(RUN, {}, n, { stateDir })).out).toBe('ghs_first\n');
    expect((await call(RUN, {}, n, { stateDir })).out).toBe('ghs_first\n');
    expect(n.portalCalls()).toHaveLength(1);
    // 51 minutes later the token has 9 minutes left: inside the margin
    const later = await call(RUN, {}, n, { stateDir, now: () => NOW + 51 * 60 * 1000 });
    expect(later.out).toBe('ghs_second\n');
    expect(n.portalCalls()).toHaveLength(2);
  });

  it('writes the cache with mode 600, per run', async () => {
    const r = await call(RUN, {});
    const file = join(r.stateDir, 'devaudit-delivery-github-token-run_1.json');
    expect(((await fs.stat(file)).mode & 0o777).toString(8)).toBe(process.platform === 'win32' ? ((await fs.stat(file)).mode & 0o777).toString(8) : '600');
    const other = await call({ run: 'run_2' }, {}, net({ portal: [GOOD('ghs_other')] }), { stateDir: r.stateDir });
    expect(other.out).toBe('ghs_other\n');
  });

  it('ignores an unreadable cache', async () => {
    const stateDir = await tmp();
    await fs.writeFile(join(stateDir, 'devaudit-delivery-github-token-run_1.json'), 'not json');
    expect((await call(RUN, {}, net({ portal: [GOOD()] }), { stateDir })).code).toBe(0);
  });
});

describe('the author', () => {
  it('comes from the portal response on the App path', async () => {
    const r = await call({ ...RUN, json: true }, {});
    const j = JSON.parse(r.out) as { token: string; source: string; author: { name: string; email: string }; expiresAt: string };
    expect(j.source).toBe('portal');
    expect(j.author).toEqual({ name: 'DevAudit Agent', email: '123+devaudit-agent[bot]@users.noreply.github.com' });
    expect(j.expiresAt).toBe(FUTURE(60 * 60 * 1000, NOW));
  });

  it("is derived from the token's GitHub user on the secret path: <id>+<login>@users.noreply.github.com", async () => {
    const n = net();
    const r = await call({ ...RUN, json: true }, { DEVAUDIT_AGENT_GITHUB_TOKEN: 'github_pat_machine' }, n);
    const j = JSON.parse(r.out) as { author: { name: string; email: string }; source: string };
    expect(j.source).toBe('secret');
    expect(j.author).toEqual({ name: 'DevAudit Agent', email: '4242+agent-user@users.noreply.github.com' });
    expect(n.calls[0]!.url).toBe('https://api.github.com/user');
    expect(n.calls[0]!.headers['authorization']).toBe('Bearer github_pat_machine');
  });

  it('takes the name from delivery.agent_git_name', async () => {
    const cwd = await tmp();
    await fs.mkdir(join(cwd, '.git'));
    await fs.writeFile(join(cwd, 'sdlc-config.json'), JSON.stringify({ delivery: { agent_git_name: 'Acme Delivery Bot' } }));
    const r = await call({ ...RUN, json: true }, { DEVAUDIT_AGENT_GITHUB_TOKEN: 'github_pat_machine' }, net(), { cwd });
    expect((JSON.parse(r.out) as { author: { name: string } }).author.name).toBe('Acme Delivery Bot');
  });

  it('fails rather than invent an address when the token user cannot be read', async () => {
    for (const user of [{ status: 401, body: {} }, { status: 200, body: { login: 'x' } }, { status: 200, body: { id: 1 } }]) {
      const r = await call({ ...RUN, json: true }, { DEVAUDIT_AGENT_GITHUB_TOKEN: 'github_pat_machine' }, net({ user }));
      expect(r.code).toBe(1);
      expect(r.out).toBe('');
      expect(r.err).toContain('none is invented');
    }
  });

  it('is not looked up when only the token is wanted', async () => {
    const n = net();
    await call(RUN, { DEVAUDIT_AGENT_GITHUB_TOKEN: 'github_pat_machine' }, n);
    expect(n.calls).toEqual([]);
  });
});

describe('--github-env and --mask', () => {
  it('writes the author to GITHUB_ENV, masks the token, and prints the token nowhere else', async () => {
    const dir = await tmp();
    const envFile = join(dir, 'github_env');
    const r = await call({ ...RUN, mask: true, githubEnv: true }, { GITHUB_ENV: envFile });
    expect(r.code).toBe(0);
    expect(r.out).toBe('::add-mask::ghs_app_token\n');
    expect(r.err).not.toContain('ghs_app_token');
    expect(r.out.replace('::add-mask::ghs_app_token', '')).not.toContain('ghs_app_token');
    expect(await fs.readFile(envFile, 'utf8')).toBe('DEVAUDIT_AGENT_GIT_NAME=DevAudit Agent\nDEVAUDIT_AGENT_GIT_EMAIL=123+devaudit-agent[bot]@users.noreply.github.com\n');
    expect(r.err).toContain('portal');
  });

  it('masks a secret-path token too, and names the secret as the source', async () => {
    const dir = await tmp();
    const r = await call({ ...RUN, mask: true, githubEnv: true }, { GITHUB_ENV: join(dir, 'e'), DEVAUDIT_AGENT_GITHUB_TOKEN: 'github_pat_machine' }, net());
    expect(r.out).toBe('::add-mask::github_pat_machine\n');
    expect(r.err).toContain('repository secret DEVAUDIT_AGENT_GITHUB_TOKEN');
    expect(r.err).not.toContain('github_pat_machine');
  });

  it('--github-env outside an Actions step is a usage error', async () => {
    expect((await call({ ...RUN, githubEnv: true }, {})).code).toBe(2);
  });
});

describe('--credential: the git credential-helper protocol', () => {
  const stdin = (text: string) => ({ readStdin: async () => text });

  it('answers get for github.com over https with the token as the password', async () => {
    const r = await call({ ...RUN, credential: true, operation: 'get' }, {}, net({ portal: [GOOD()] }), stdin('protocol=https\nhost=github.com\npath=o/r\n\n'));
    expect(r.code).toBe(0);
    expect(r.out).toBe('username=x-access-token\npassword=ghs_app_token\n');
  });

  it('answers when git passes no attributes', async () => {
    const r = await call({ ...RUN, credential: true }, {}, net({ portal: [GOOD()] }), stdin(''));
    expect(r.out).toContain('password=ghs_app_token');
  });

  it('prints nothing and asks the portal nothing for another host or for http', async () => {
    for (const text of ['protocol=https\nhost=gitlab.example.test\n', 'protocol=http\nhost=github.com\n']) {
      const n = net({ portal: [GOOD()] });
      const r = await call({ ...RUN, credential: true, operation: 'get' }, {}, n, stdin(text));
      expect(r.code).toBe(0);
      expect(r.out).toBe('');
      expect(n.calls).toEqual([]);
    }
  });

  it('does nothing for store and erase', async () => {
    for (const operation of ['store', 'erase']) {
      const n = net({ portal: [GOOD()] });
      const r = await call({ ...RUN, credential: true, operation }, {}, n, stdin('host=github.com\n'));
      expect(r.code).toBe(0);
      expect(r.out).toBe('');
      expect(n.calls).toEqual([]);
    }
  });

  it('fails closed, with nothing on stdout, when no token can be had', async () => {
    const r = await call({ ...RUN, credential: true, operation: 'get' }, {}, net({ portal: [{ status: 409, body: { code: 'not_installed' } }] }), stdin('host=github.com\n'));
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
  });

  it('follows GITHUB_SERVER_URL for an enterprise server', async () => {
    const r = await call({ ...RUN, credential: true, operation: 'get' }, { GITHUB_SERVER_URL: 'https://ghe.example.test' }, net({ portal: [GOOD()] }), stdin('protocol=https\nhost=ghe.example.test\n'));
    expect(r.out).toContain('password=');
  });
});

describe('the token stays out of logs', () => {
  it('appears on stdout only as the answer, never on stderr, in every mode', async () => {
    for (const options of [{ ...RUN }, { ...RUN, json: true }, { ...RUN, credential: true, operation: 'get' }, { ...RUN, mask: true }] as GithubTokenOptions[]) {
      const r = await call(options, {}, net({ portal: [GOOD('ghs_secret_value')] }), { readStdin: async () => 'host=github.com\n' });
      expect(r.err).not.toContain('ghs_secret_value');
    }
  });

  it('a failure message carries no token', async () => {
    const r = await call(RUN, { DEVAUDIT_AGENT_GITHUB_TOKEN: 'github_pat_machine' }, net({ user: { status: 401 } }), {});
    const withUser = await call({ ...RUN, json: true }, { DEVAUDIT_AGENT_GITHUB_TOKEN: 'github_pat_machine' }, net({ user: { status: 401 } }));
    expect(r.err).not.toContain('github_pat_machine');
    expect(withUser.err).not.toContain('github_pat_machine');
  });
});
