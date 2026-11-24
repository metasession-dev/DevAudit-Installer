import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPlan } from '../src/install/prompts.js';
import { writeSdlcConfig } from '../src/install/write-config.js';
import { setupDelivery } from '../src/install/delivery.js';
import { runInstall } from '../src/install/index.js';
import { InstallRefusal } from '../src/install/refusal.js';
import { logger } from '../src/lib/logger.js';
import { PRESETS } from '@metasession.co/devaudit-core';
import type { FetchLike } from '../src/lib/onboarding-portal.js';
import type { GitProvider } from '../src/lib/git-provider/index.js';
import type { DetectedStack, InstallContext, InstallPlan } from '../src/install/types.js';

// DevAudit-Installer#1272, #1274 — `install --compliance <mode>` (the preset without a question, no prompt under
// --yes) and `install --delivery` (the workflow's config, the delivery-agent key, the repository secrets).

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const detected: DetectedStack = { stack: 'node', workingDirectory: '.' };
const FULL = "export default { projects: [{ name: 'smoke' }, { name: 'critical' }, { name: 'regression' }] };\n";
const SMOKE = "export default { projects: [{ name: 'smoke' }] };\n";

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function repo(opts: { config?: Record<string, unknown> | null; playwright?: string | null } = {}): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-install-delivery-'));
  dirs.push(dir);
  if (opts.config) await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(opts.config));
  if (opts.playwright !== null) await fs.writeFile(join(dir, 'playwright.config.ts'), opts.playwright ?? FULL);
  return dir;
}

function ctxFor(dir: string, extra: Partial<InstallContext> = {}): InstallContext {
  return {
    projectPath: dir,
    repoRoot: dir,
    projectName: 'fixture-app',
    installerRoot: INSTALLER_ROOT,
    token: 't',
    baseUrl: 'https://devaudit.example.test',
    dryRun: false,
    nonInteractive: true,
    installMode: 'operator',
    addTarget: false,
    issueViewerKey: false,
    printViewerKey: false,
    delivery: false,
    ...extra,
  };
}

/** A portal stub answering the approval-policy read; every call is recorded. */
function portal(policy: 'independent' | 'self_allowed_with_gap' | null) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    const body = policy === null ? { slug: 'fixture-app' } : { approval_policy: policy };
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, calls };
}

const plan = (dir: string, extra: Partial<InstallContext> = {}, p = portal(null)) =>
  collectPlan(ctxFor(dir, extra), detected, { fetchImpl: p.fetchImpl, viewerKey: 'viewer-key' });

describe('--compliance with --yes (#1272)', () => {
  it('needs no sdlc-config.json and asks nothing: every mode maps to its preset', async () => {
    for (const [mode, preset] of [['none', 'A'], ['light', 'B'], ['regulated', 'C']] as const) {
      const dir = await repo({ config: null });
      const p = await plan(dir, { compliance: mode });
      expect(p.onboarding?.preset, mode).toBe(preset);
      expect(p.onboarding?.config, mode).toMatchObject(PRESETS[preset].config);
    }
  });

  it('keeps the old refusal for --yes alone on a fresh repository', async () => {
    const dir = await repo({ config: null });
    await expect(collectPlan(ctxFor(dir), detected, { fetchImpl: portal(null).fetchImpl, viewerKey: 'k' })).rejects.toThrow(/--yes requires an existing sdlc-config.json/);
  });

  it('falls back to the next preset down and says so in one line; never D', async () => {
    const info = vi.spyOn(logger(), 'info');
    const dir = await repo({ config: null, playwright: SMOKE });
    const p = await plan(dir, { compliance: 'regulated' });
    expect(p.onboarding?.preset).toBe('B');
    const lines = info.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('Compliance mode'));
    expect(lines).toEqual(['Compliance mode regulated names preset C, but it needs a full test pack and none was found; using preset B instead.']);
  });

  it('with no smoke test regulated lands on A, light on A, and none stays on A', async () => {
    for (const mode of ['regulated', 'light', 'none'] as const) {
      const dir = await repo({ config: null, playwright: null });
      expect((await plan(dir, { compliance: mode })).onboarding?.preset, mode).toBe('A');
    }
  });

  it('names the self-approval in the plan and sets the policy for A and B (the mode is the consent), not for C', async () => {
    const solo = await plan(await repo({ config: null }), { compliance: 'light' }, portal('independent'));
    expect(solo.onboarding?.policyToSet).toBe('self_allowed_with_gap');
    const full = await plan(await repo({ config: null }), { compliance: 'regulated' }, portal('independent'));
    expect(full.onboarding?.policyToSet).toBeNull();
  });

  it('leaves the policy alone when it already allows self-approval', async () => {
    const p = await plan(await repo({ config: null }), { compliance: 'none' }, portal('self_allowed_with_gap'));
    expect(p.onboarding?.policyToSet).toBeNull();
  });

  it('--preset with --yes still refuses A and B when the policy does not allow self-approval (unchanged)', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node' } });
    await expect(plan(dir, { preset: 'A' }, portal('independent'))).rejects.toBeInstanceOf(InstallRefusal);
  });
});

describe('refusals before anything is touched (exit code 2)', () => {
  const refused = async (options: Parameters<typeof runInstall>[0]) => {
    const err = await runInstall({ nonInteractive: true, ...options }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InstallRefusal);
    expect((err as InstallRefusal).exitCode).toBe(2);
    return (err as InstallRefusal).message;
  };

  it('--compliance together with --preset', async () => {
    const dir = await repo({ config: null });
    expect(await refused({ path: dir, compliance: 'light', preset: 'B', token: 't' })).toMatch(/--compliance and --preset cannot be used together/);
  });

  it('an unknown compliance mode', async () => {
    const dir = await repo({ config: null });
    expect(await refused({ path: dir, compliance: 'strict', token: 't' })).toMatch(/Unknown compliance mode "strict"/);
  });

  it('--delivery without DEVAUDIT_AGENT_API_KEY in the environment', async () => {
    const dir = await repo({ config: null });
    expect(await refused({ path: dir, delivery: true, token: 't', env: {} })).toMatch(/needs the DEVAUDIT_AGENT_API_KEY environment variable/);
    expect(await refused({ path: dir, delivery: true, token: 't', env: { DEVAUDIT_AGENT_API_KEY: '   ' } })).toMatch(/needs the DEVAUDIT_AGENT_API_KEY/);
  });

  it('--delivery with --add-target', async () => {
    const dir = await repo({ config: null });
    expect(await refused({ path: dir, delivery: true, addTarget: true, token: 't', env: { DEVAUDIT_AGENT_API_KEY: 'k' } })).toMatch(/--add-target/);
  });
});

describe('sdlc-config.json (#1272)', () => {
  const basePlan = (): InstallPlan => ({
    stack: 'node',
    host: 'railway',
    projectSlug: 'fixture-app',
    runtimeVersion: '20',
    sourceDirs: 'app/',
    workingDirectory: '.',
    prodUrlSecretName: 'FIXTURE_PROD_URL',
    prodUrlValue: '',
    apiKeySecretName: 'DEVAUDIT_API_KEY',
  });

  it('records delivery.enabled with the default limits and the portal App as the token source', async () => {
    const dir = await repo({ config: null, playwright: null });
    await writeSdlcConfig(ctxFor(dir, { delivery: true }), basePlan());
    const cfg = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8')) as { delivery: unknown };
    expect(cfg.delivery).toEqual({ enabled: true, max_turns: 200, max_minutes: 90, github_token_source: 'app' });
  });

  it('records the secret as the token source when the environment has a token of its own (#1286)', async () => {
    const dir = await repo({ config: null, playwright: null });
    await writeSdlcConfig(ctxFor(dir, { delivery: true, deliveryAgentGithubToken: 'github_pat_machine' }), basePlan());
    expect(JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8')).delivery.github_token_source).toBe('secret');
  });

  it('keeps a token source and an author name that were already chosen when the environment has no token', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node', delivery: { github_token_source: 'secret', agent_git_name: 'Acme Bot' } }, playwright: null });
    await writeSdlcConfig(ctxFor(dir, { delivery: true }), basePlan());
    expect(JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8')).delivery).toMatchObject({ enabled: true, github_token_source: 'secret', agent_git_name: 'Acme Bot' });
  });

  it('keeps limits that were already set, and writes no delivery key without --delivery', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node', delivery: { enabled: false, max_turns: 50, max_minutes: 30 } }, playwright: null });
    await writeSdlcConfig(ctxFor(dir, { delivery: true }), basePlan());
    expect(JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8')).delivery).toEqual({ enabled: true, max_turns: 50, max_minutes: 30, github_token_source: 'app' });
    const plain = await repo({ config: null, playwright: null });
    await writeSdlcConfig(ctxFor(plain), basePlan());
    expect(JSON.parse(await fs.readFile(join(plain, 'sdlc-config.json'), 'utf8')).delivery).toBeUndefined();
  });
});

describe('the delivery-agent key and the repository secrets (#1272, #1274)', () => {
  const makePlan = (): InstallPlan => ({
    stack: 'node',
    host: 'railway',
    projectSlug: 'fixture-app',
    runtimeVersion: '20',
    sourceDirs: 'app/',
    workingDirectory: '.',
    prodUrlSecretName: 'FIXTURE_PROD_URL',
    prodUrlValue: '',
    apiKeySecretName: 'DEVAUDIT_API_KEY',
    projectId: 'proj-1',
  });
  const fakeClient = (keys: Array<{ id: string; name: string; revoked_at: string | null; expires_at?: string | null }>) => {
    const issued: Array<[string, string, string]> = [];
    return {
      issued,
      client: {
        listApiKeys: async () => keys,
        issueApiKey: async (projectId: string, name: string, role: 'uploader' | 'viewer' = 'uploader') => {
          issued.push([projectId, name, role]);
          return { id: 'k-new', name, plainTextKey: 'mc_agent_plaintext' };
        },
      },
    };
  };
  const fakeProvider = () => {
    const secrets: Array<[string, string]> = [];
    const provider = { name: 'fake', setSecret: async (_p: string, name: string, value: string) => void secrets.push([name, value]), setVariable: async () => undefined } as unknown as GitProvider;
    return { secrets, provider };
  };
  const ctx = (extra: Partial<InstallContext> = {}) => ctxFor('/unused', { delivery: true, deliveryAgentApiKey: 'sk-agent-session', ...extra });

  it('issues an uploader key named delivery-agent and sets both secrets', async () => {
    const { client, issued } = fakeClient([{ id: 'k1', name: 'Onboarding-issued', revoked_at: null }]);
    const { provider, secrets } = fakeProvider();
    const p = makePlan();
    const step = await setupDelivery(ctx(), p, provider, { client });
    expect(step.status).toBe('ok');
    expect(issued).toEqual([['proj-1', 'delivery-agent', 'uploader']]);
    expect(secrets).toEqual([
      ['DEVAUDIT_AGENT_API_KEY', 'sk-agent-session'],
      ['DEVAUDIT_AGENT_PORTAL_KEY', 'mc_agent_plaintext'],
    ]);
    expect(step.message).not.toContain('mc_agent_plaintext');
    expect(step.message).not.toContain('sk-agent-session');
  });

  it('stores the optional GitHub token when the environment has one', async () => {
    const { client } = fakeClient([]);
    const { provider, secrets } = fakeProvider();
    await setupDelivery(ctx({ deliveryAgentGithubToken: 'ghp_agent' }), makePlan(), provider, { client });
    expect(secrets.map(([n]) => n)).toEqual(['DEVAUDIT_AGENT_API_KEY', 'DEVAUDIT_AGENT_PORTAL_KEY', 'DEVAUDIT_AGENT_GITHUB_TOKEN']);
  });

  it("says the portal's GitHub App must be installed when there is no token of its own, and names the pilot path when there is (#1286)", async () => {
    const without = await setupDelivery(ctx(), makePlan(), fakeProvider().provider, { client: fakeClient([]).client });
    expect(without.message).toContain('DevAudit Agent GitHub App');
    expect(without.message).toContain('must be installed on this repository');
    const withToken = await setupDelivery(ctx({ deliveryAgentGithubToken: 'ghp_agent' }), makePlan(), fakeProvider().provider, { client: fakeClient([]).client });
    expect(withToken.message).toContain("machine user's token");
    expect(withToken.message).not.toContain('ghp_agent');
  });

  it('reuses a live delivery-agent key instead of failing on the duplicate name, and leaves its secret alone', async () => {
    const { client, issued } = fakeClient([{ id: 'k2', name: 'delivery-agent', revoked_at: null }]);
    const { provider, secrets } = fakeProvider();
    const step = await setupDelivery(ctx(), makePlan(), provider, { client });
    expect(issued).toEqual([]);
    expect(secrets).toEqual([['DEVAUDIT_AGENT_API_KEY', 'sk-agent-session']]);
    expect(step.message).toMatch(/already exists and is reused/);
  });

  it('issues a new key when the only delivery-agent key is revoked or expired', async () => {
    const { client, issued } = fakeClient([
      { id: 'k3', name: 'delivery-agent', revoked_at: '2026-01-01T00:00:00Z' },
      { id: 'k4', name: 'delivery-agent', revoked_at: null, expires_at: '2020-01-01T00:00:00Z' },
    ]);
    await setupDelivery(ctx(), makePlan(), fakeProvider().provider, { client });
    expect(issued).toHaveLength(1);
  });

  it('does nothing without --delivery, in developer mode, and in a dry run (which names what it would do)', async () => {
    const { client, issued } = fakeClient([]);
    const { provider, secrets } = fakeProvider();
    expect((await setupDelivery(ctx({ delivery: false }), makePlan(), provider, { client })).status).toBe('skipped');
    expect((await setupDelivery(ctx({ installMode: 'developer' }), makePlan(), provider, { client })).status).toBe('skipped');
    const dry = await setupDelivery(ctx({ dryRun: true }), makePlan(), provider, { client });
    expect(dry.status).toBe('planned');
    expect(dry.message).toContain('DEVAUDIT_AGENT_PORTAL_KEY');
    expect(issued).toEqual([]);
    expect(secrets).toEqual([]);
  });

  it('warns, with the key issued, when no git provider is available', async () => {
    const { client, issued } = fakeClient([]);
    const step = await setupDelivery(ctx(), makePlan(), null, { client });
    expect(step.status).toBe('warn');
    expect(issued).toHaveLength(1);
    expect(step.message).toMatch(/gh secret set/);
  });
});
