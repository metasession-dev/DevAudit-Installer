import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliveryWorkflowCheck, READINESS_CODES } from '../src/commands/doctor-delivery.js';
import { CHECK_EXPLANATIONS, gapsFromCheck } from '../src/lib/doctor-explain.js';
import { DELIVERY_CLAUDE_CODE_VERSION } from '../src/lib/delivery.js';

// DevAudit-Installer#1321 — doctor probes the portal's GET /api/ci/delivery-readiness (faked here).

const KEY = 'dak_test_secret_value_1234567890';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const workflow = `steps:\n  - run: npm install -g @anthropic-ai/claude-code@${DELIVERY_CLAUDE_CODE_VERSION}\n  - run: devaudit delivery github-token --run "$RUN_ID"\n`;
async function repo(cfg: Record<string, unknown> = { delivery: { enabled: true, github_token_source: 'app' } }) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-delivery-ready-'));
  dirs.push(dir);
  await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  await fs.writeFile(join(dir, '.github', 'workflows', 'devaudit-delivery.yml'), workflow);
  await fs.mkdir(join(dir, '.devaudit'), { recursive: true });
  await fs.writeFile(join(dir, '.devaudit', 'delivery-prompt.md'), 'prompt');
  return { repoRoot: dir, cfg };
}
const gh = async () => ({ exitCode: 0, stdout: JSON.stringify([{ name: 'DEVAUDIT_AGENT_API_KEY' }, { name: 'DEVAUDIT_AGENT_PORTAL_KEY' }]), stderr: '' });
const reply = (status: number, body: unknown = {}) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
const env = { DEVAUDIT_AGENT_PORTAL_KEY: KEY } as NodeJS.ProcessEnv;

describe('the portal readiness probe of delivery-workflow (#1321)', () => {
  it('sends a GET with the key as Bearer to the configured portal, and nothing else', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ready: true, problems: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await deliveryWorkflowCheck(await repo({ delivery: { enabled: true, github_token_source: 'app' }, devaudit: { base_url: 'https://portal.example.test/' } }), { gh, fetchImpl, env });
    expect(r?.ok).toBe(true);
    expect(r?.detail).toContain('portal reports Delivery ready');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://portal.example.test/api/ci/delivery-readiness');
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.body).toBeUndefined();
    expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${KEY}`);
  });

  it('falls back to DEVAUDIT_API_KEY, and DEVAUDIT_BASE_URL wins over the config', async () => {
    let seen = '';
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = `${url} ${(init.headers as Record<string, string>)['authorization']}`;
      return new Response(JSON.stringify({ ready: true, problems: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await deliveryWorkflowCheck(await repo(), { gh, fetchImpl, env: { DEVAUDIT_API_KEY: 'k2', DEVAUDIT_BASE_URL: 'https://b.example.test' } as NodeJS.ProcessEnv });
    expect(seen).toBe('https://b.example.test/api/ci/delivery-readiness Bearer k2');
  });

  it('reports each of the six problem codes with the portal message and a remediation line', async () => {
    const problems = READINESS_CODES.map((code) => ({
      code,
      message: `portal says ${code}`,
      ...(code === 'app_not_installed' ? { installUrl: 'https://github.com/apps/example-agent/installations/new' } : {}),
    }));
    const r = await deliveryWorkflowCheck(await repo(), { gh, fetchImpl: reply(200, { ready: false, problems }), env });
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
    expect(gapsFromCheck(r!)).toHaveLength(6);
  });

  it('keeps a message with control characters on one line, and ignores an installUrl that is not https', async () => {
    const r = await deliveryWorkflowCheck(await repo(), {
      gh,
      fetchImpl: reply(200, { ready: false, problems: [{ code: 'app_not_installed', message: 'line1\nline2\u001b[31m', installUrl: 'javascript:alert(1)' }] }),
      env,
    });
    const detail = r!.findings![0]!.detail;
    expect(detail).not.toMatch(/[\n\u001b]/);
    expect(detail).not.toContain('javascript:');
  });

  it('names a problem code it does not know, with the portal message', async () => {
    const r = await deliveryWorkflowCheck(await repo(), { gh, fetchImpl: reply(200, { ready: false, problems: [{ code: 'brand_new', message: 'something new' }] }), env });
    expect(r?.findings?.[0]?.subject).toBe('portal-unknown');
    expect(r?.findings?.[0]?.detail).toContain('something new');
    expect(CHECK_EXPLANATIONS['delivery-workflow:portal-unknown']).toBeDefined();
  });

  describe('could not probe: each reason is distinct and none fails the check', () => {
    const noteFor = async (fetchImpl: typeof fetch, e: NodeJS.ProcessEnv = env) => deliveryWorkflowCheck(await repo(), { gh, fetchImpl, env: e });

    it('unreachable portal', async () => {
      const r = await noteFor((async () => {
        throw new Error(`connect ECONNREFUSED while sending ${KEY}`);
      }) as unknown as typeof fetch);
      expect(r?.ok).toBe(true);
      expect(r?.detail).toContain('could not be reached');
      expect(r?.detail).not.toContain(KEY);
    });

    it('a portal older than the endpoint, or with Delivery off (404)', async () => {
      const r = await noteFor(reply(404));
      expect(r?.ok).toBe(true);
      expect(r?.detail).toContain('too old to report Delivery readiness');
    });

    it('the rate limit (429)', async () => {
      const r = await noteFor(reply(429));
      expect(r?.ok).toBe(true);
      expect(r?.detail).toContain('30 per project per hour');
    });

    it('another status, and an answer that is not the expected shape', async () => {
      expect((await noteFor(reply(502)))?.detail).toContain('HTTP 502');
      expect((await noteFor(reply(200, 'not json')))?.detail).toContain('not JSON');
      expect((await noteFor(reply(200, { ready: true })))?.detail).toContain('no problems list');
    });

    it('no key in the environment', async () => {
      let called = false;
      const r = await noteFor((async () => {
        called = true;
        return new Response('{}');
      }) as unknown as typeof fetch, {} as NodeJS.ProcessEnv);
      expect(called).toBe(false);
      expect(r?.ok).toBe(true);
      expect(r?.detail).toContain('DEVAUDIT_AGENT_PORTAL_KEY or DEVAUDIT_API_KEY');
    });

    it('skipped under doctor --fleet, with the reason', async () => {
      let called = false;
      const r = await noteFor((async () => {
        called = true;
        return new Response('{}');
      }) as unknown as typeof fetch, { ...env, DEVAUDIT_DOCTOR_SKIP_DELIVERY_PROBE: '1' } as NodeJS.ProcessEnv);
      expect(called).toBe(false);
      expect(r?.ok).toBe(true);
      expect(r?.detail).toContain('skipped under doctor --fleet');
    });

    it('a revoked or wrong key (401) is reported as a finding naming the key, not as a pass', async () => {
      const r = await noteFor(reply(401, { code: 'unauthorized' }));
      expect(r?.findings?.map((f) => f.subject)).toEqual(['portal-no-agent-key']);
      expect(r?.findings?.[0]?.detail).toContain('revoked');
      expect(r?.findings?.[0]?.remediation?.tier).toBe('C');
    });
  });

  it('never puts the key in the result, even as JSON', async () => {
    const r = await deliveryWorkflowCheck(await repo(), { gh, fetchImpl: reply(200, { ready: false, problems: [{ code: 'no_agent_key', message: 'no key' }] }), env });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('adds nothing when delivery.enabled is not true: no output and no portal call', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    for (const cfg of [{}, { delivery: { enabled: false } }]) expect(await deliveryWorkflowCheck(await repo(cfg), { gh, fetchImpl, env })).toBeNull();
    expect(called).toBe(false);
  });
});
