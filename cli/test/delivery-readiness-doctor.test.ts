import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { deliveryWorkflowCheck, FLEET_CHILD_ENV, READINESS_CODES } from '../src/commands/doctor-delivery.js';
import { defaultRunDoctorJson } from '../src/commands/fleet.js';
import { CHECK_EXPLANATIONS, gapsFromCheck } from '../src/lib/doctor-explain.js';
import { DELIVERY_CLAUDE_CODE_VERSION } from '../src/lib/delivery.js';

// DevAudit-Installer#1321 — doctor asks the portal's GET /api/ci/delivery-readiness, with the viewer key, what it
// would refuse a delivery run for. The portal is faked here.

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'devaudit.js');
const KEY = 'dav_test_viewer_secret_value_1234567890';
const BASE = 'https://portal.example.test';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});
async function tmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const workflow = `steps:\n  - run: npm install -g @anthropic-ai/claude-code@${DELIVERY_CLAUDE_CODE_VERSION}\n  - run: devaudit delivery github-token --run "$RUN_ID"\n`;
const CFG = { project_slug: 'example-app', devaudit: { base_url: `${BASE}/`, project_slug: 'example-app' }, delivery: { enabled: true, github_token_source: 'app' } };
async function writeRepo(dir: string): Promise<void> {
  await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  await fs.writeFile(join(dir, '.github', 'workflows', 'devaudit-delivery.yml'), workflow);
  await fs.mkdir(join(dir, '.devaudit'), { recursive: true });
  await fs.writeFile(join(dir, '.devaudit', 'delivery-prompt.md'), 'prompt');
}
async function repo(cfg: Record<string, unknown> = CFG) {
  const dir = await tmp('cli-delivery-ready-');
  await writeRepo(dir);
  return { repoRoot: dir, cfg };
}
const gh = async () => ({ exitCode: 0, stdout: JSON.stringify([{ name: 'DEVAUDIT_AGENT_API_KEY' }, { name: 'DEVAUDIT_AGENT_PORTAL_KEY' }]), stderr: '' });
const reply = (status: number, body: unknown = {}) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
const counting = () => {
  const state = { called: false };
  const fetchImpl = (async () => {
    state.called = true;
    return new Response(JSON.stringify({ ready: true, problems: [] }));
  }) as unknown as typeof fetch;
  return { state, fetchImpl };
};
const env = { DEVAUDIT_VIEWER_API_KEY: KEY } as NodeJS.ProcessEnv;
// a viewer-key store that does not exist: no key is found unless a test writes one
const noStore = join(tmpdir(), 'devaudit-no-such-viewer-keys.json');

describe('the portal readiness probe of delivery-workflow (#1321)', () => {
  it('sends a GET with the viewer key as Bearer to the configured portal, and no body', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ready: true, problems: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await deliveryWorkflowCheck(await repo(), { gh, fetchImpl, env, viewerKeysFile: noStore });
    expect(r?.ok).toBe(true);
    expect(r?.detail).toContain('portal reports Delivery ready');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/api/ci/delivery-readiness`);
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.body).toBeUndefined();
    expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${KEY}`);
  });

  it('uses the viewer key stored for this project, and never the uploader or delivery-agent key', async () => {
    const store = join(await tmp('cli-viewer-store-'), 'viewer-keys.json');
    await fs.writeFile(store, JSON.stringify({ [BASE]: { 'example-app': { key: 'stored-viewer', name: 'viewer:t', createdAt: '2026-11-25T00:00:00Z' } } }));
    let auth = '';
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>)['authorization'] ?? '';
      return new Response(JSON.stringify({ ready: true, problems: [] }));
    }) as unknown as typeof fetch;
    await deliveryWorkflowCheck(await repo(), { gh, fetchImpl, env: { DEVAUDIT_API_KEY: 'uploader', DEVAUDIT_AGENT_PORTAL_KEY: 'agent' } as NodeJS.ProcessEnv, viewerKeysFile: store });
    expect(auth).toBe('Bearer stored-viewer');

    const none = counting();
    const r = await deliveryWorkflowCheck(await repo(), { gh, fetchImpl: none.fetchImpl, env: { DEVAUDIT_API_KEY: 'uploader', DEVAUDIT_AGENT_PORTAL_KEY: 'agent' } as NodeJS.ProcessEnv, viewerKeysFile: noStore });
    expect(none.state.called).toBe(false);
    expect(r?.ok).toBe(true);
    expect(r?.detail).toContain('no viewer key');
  });

  it('reports each of the six problem codes with the portal message and a remediation line', async () => {
    const problems = READINESS_CODES.map((code) => ({
      code,
      message: `portal says ${code}`,
      ...(code === 'app_not_installed' ? { installUrl: 'https://github.com/apps/example-agent/installations/new' } : {}),
    }));
    const r = await deliveryWorkflowCheck(await repo(), { gh, fetchImpl: reply(200, { ready: false, problems }), env, viewerKeysFile: noStore });
    expect(r?.ok).toBe(false);
    expect(r?.findings?.map((f) => f.subject)).toEqual(READINESS_CODES.map((c) => `portal-${c.replace(/_/g, '-')}`));
    for (const f of r!.findings!) {
      expect(f.remediation?.tier, f.subject).toBe('C');
      expect(f.remediation?.plan.length, f.subject).toBeGreaterThan(0);
      expect(CHECK_EXPLANATIONS[`delivery-workflow:${f.subject}`], f.subject).toBeDefined();
    }
    for (const code of READINESS_CODES) expect(r!.findings!.find((f) => f.subject === `portal-${code.replace(/_/g, '-')}`)!.detail).toContain(`portal says ${code}`);
    const app = r!.findings!.find((f) => f.subject === 'portal-app-not-installed')!;
    expect(app.detail).toContain('https://github.com/apps/example-agent/installations/new');
    expect(app.remediation?.plan.join('\n')).toContain('https://github.com/apps/example-agent/installations/new');
    // a missing App is not fixed by switching the token source: the portal needs it for every run
    const configured = r!.findings!.find((f) => f.subject === 'portal-app-not-configured')!;
    expect(configured.remediation?.plan.join('\n')).not.toContain('github_token_source secret');
    expect(CHECK_EXPLANATIONS['delivery-workflow:portal-app-not-configured']!.guidance).toContain('does not help');
    expect(r!.findings!.find((f) => f.subject === 'portal-no-agent-key')!.remediation?.plan.join('\n')).toContain('devaudit install --delivery');
    expect(gapsFromCheck(r!)).toHaveLength(6);
  });

  it('keeps a message with control characters on one line, and ignores an installUrl that is not https', async () => {
    const r = await deliveryWorkflowCheck(await repo(), {
      gh,
      fetchImpl: reply(200, { ready: false, problems: [{ code: 'app_not_installed', message: 'line1\nline2\u001b[31m', installUrl: 'javascript:alert(1)' }] }),
      env,
      viewerKeysFile: noStore,
    });
    const detail = r!.findings![0]!.detail;
    expect(detail).not.toMatch(/[\n\u001b]/);
    expect(detail).not.toContain('javascript:');
  });

  it('names a problem code it does not know, with the portal message', async () => {
    const r = await deliveryWorkflowCheck(await repo(), { gh, fetchImpl: reply(200, { ready: false, problems: [{ code: 'brand_new', message: 'something new' }] }), env, viewerKeysFile: noStore });
    expect(r?.findings?.[0]?.subject).toBe('portal-unknown');
    expect(r?.findings?.[0]?.detail).toContain('something new');
    expect(CHECK_EXPLANATIONS['delivery-workflow:portal-unknown']).toBeDefined();
  });

  describe('could not probe: each reason is distinct and none fails the check', () => {
    const probe = async (fetchImpl: typeof fetch, e: NodeJS.ProcessEnv = env, cfg: Record<string, unknown> = CFG) => deliveryWorkflowCheck(await repo(cfg), { gh, fetchImpl, env: e, viewerKeysFile: noStore });
    const notProbed = (detail: string | undefined, why: string) => {
      expect(detail).toContain('the portal side was not probed');
      expect(detail).toContain(why);
    };

    it('unreachable portal (and the key is redacted from the error)', async () => {
      const r = await probe((async () => {
        throw new Error(`connect ECONNREFUSED while sending ${KEY}`);
      }) as unknown as typeof fetch);
      expect(r?.ok).toBe(true);
      notProbed(r?.detail, 'could not be reached');
      expect(r?.detail).not.toContain(KEY);
    });

    it('a rejected viewer key (401 or 403)', async () => {
      for (const status of [401, 403]) {
        const r = await probe(reply(status, { code: 'unauthorized' }));
        expect(r?.ok, String(status)).toBe(true);
        expect(r?.findings).toBeUndefined();
        notProbed(r?.detail, `did not accept the viewer key (HTTP ${status})`);
      }
    });

    it('a portal older than the endpoint, or with Delivery off (404)', async () => {
      const r = await probe(reply(404));
      expect(r?.ok).toBe(true);
      notProbed(r?.detail, 'too old to report Delivery readiness');
    });

    it('the rate limit (429)', async () => {
      const r = await probe(reply(429));
      expect(r?.ok).toBe(true);
      notProbed(r?.detail, '30 times per project per hour');
    });

    it('another status, and an answer that is not the expected shape', async () => {
      notProbed((await probe(reply(502)))?.detail, 'HTTP 502');
      notProbed((await probe(reply(200, 'not json')))?.detail, 'not JSON');
      notProbed((await probe(reply(200, { ready: true })))?.detail, 'no problems list');
    });

    it('no devaudit.base_url', async () => {
      const c = counting();
      const r = await probe(c.fetchImpl, env, { delivery: CFG.delivery });
      expect(c.state.called).toBe(false);
      notProbed(r?.detail, 'needs devaudit.base_url');
    });

    it('under doctor --fleet with DEVAUDIT_VIEWER_API_KEY, which is one key for every project', async () => {
      const c = counting();
      const r = await probe(c.fetchImpl, { ...env, [FLEET_CHILD_ENV]: '1' } as NodeJS.ProcessEnv);
      expect(c.state.called).toBe(false);
      expect(r?.ok).toBe(true);
      notProbed(r?.detail, 'skipped under doctor --fleet');
    });
  });

  it('under doctor --fleet, a viewer key stored for the project still probes', async () => {
    const store = join(await tmp('cli-viewer-store-'), 'viewer-keys.json');
    await fs.writeFile(store, JSON.stringify({ [BASE]: { 'example-app': { key: 'stored-viewer', name: 'viewer:t', createdAt: '2026-11-25T00:00:00Z' } } }));
    const c = counting();
    const r = await deliveryWorkflowCheck(await repo(), { gh, fetchImpl: c.fetchImpl, env: { [FLEET_CHILD_ENV]: '1' } as NodeJS.ProcessEnv, viewerKeysFile: store });
    expect(c.state.called).toBe(true);
    expect(r?.detail).toContain('portal reports Delivery ready');
  });

  it('never puts the key in the result, even as JSON', async () => {
    const r = await deliveryWorkflowCheck(await repo(), { gh, fetchImpl: reply(200, { ready: false, problems: [{ code: 'no_agent_key', message: 'no key' }] }), env, viewerKeysFile: noStore });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('adds nothing when delivery.enabled is not true: no output and no portal call', async () => {
    const c = counting();
    for (const cfg of [{ devaudit: CFG.devaudit }, { devaudit: CFG.devaudit, delivery: { enabled: false } }]) {
      expect(await deliveryWorkflowCheck(await repo(cfg), { gh, fetchImpl: c.fetchImpl, env, viewerKeysFile: noStore })).toBeNull();
    }
    expect(c.state.called).toBe(false);
  });
});

describe('doctor --fleet marks each child doctor (#1321)', () => {
  it('runs the child with the fleet marker in its environment', async () => {
    const dir = await tmp('cli-fleet-child-');
    const script = join(dir, 'fake-cli.mjs');
    await fs.writeFile(script, `process.stdout.write(JSON.stringify({ marker: process.env[${JSON.stringify(FLEET_CHILD_ENV)}] ?? null }));\n`);
    const saved = process.argv[1];
    process.argv[1] = script;
    try {
      const { json } = await defaultRunDoctorJson(dir);
      expect(json).toEqual({ marker: '1' });
    } finally {
      process.argv[1] = saved as string;
    }
  });
});

describe('portal readiness findings never change the doctor exit code (#1321)', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = undefined;
  });

  async function portal(readiness: unknown): Promise<string> {
    server = createServer((req, res) => {
      if (req.url === '/api/ci/delivery-readiness') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(readiness));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  async function doctor(base: string): Promise<{ exitCode: number | undefined; delivery: { ok: boolean; findings?: Array<{ subject: string }> } | undefined; raw: string }> {
    const dir = await tmp('cli-delivery-exit-');
    await execa('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ ...CFG, devaudit: { base_url: base, project_slug: 'example-app' } }));
    await writeRepo(dir);
    const childEnv: NodeJS.ProcessEnv = { ...process.env, DEVAUDIT_VIEWER_API_KEY: KEY };
    for (const k of ['DEVAUDIT_API_KEY', 'DEVAUDIT_AGENT_PORTAL_KEY', FLEET_CHILD_ENV]) delete childEnv[k];
    const r = await execa('node', [BIN, 'doctor', '--json'], { cwd: dir, env: childEnv, reject: false });
    const json = JSON.parse(r.stdout) as { onboarding: Array<{ name: string; ok: boolean; findings?: Array<{ subject: string }> }> };
    return { exitCode: r.exitCode, delivery: json.onboarding.find((c) => c.name === 'delivery-workflow'), raw: r.stdout + r.stderr };
  }

  it('the same repository exits the same with the portal ready and with every problem reported', async () => {
    const ready = await doctor(await portal({ ready: true, problems: [] }));
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    const problems = READINESS_CODES.map((code) => ({ code, message: `portal says ${code}` }));
    const blocked = await doctor(await portal({ ready: false, problems }));
    expect(ready.delivery?.findings?.some((f) => f.subject.startsWith('portal-'))).toBeFalsy();
    expect(blocked.delivery?.ok).toBe(false);
    expect(blocked.delivery?.findings?.filter((f) => f.subject.startsWith('portal-'))).toHaveLength(6);
    expect(blocked.exitCode).toBe(ready.exitCode);
    expect(blocked.raw).not.toContain(KEY);
  }, 120_000);
});
