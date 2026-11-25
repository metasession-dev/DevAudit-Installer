import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { NOT_ASKED, PRESETS } from '@metasession.co/devaudit-core';
import { validateConfigKeyValue, findConfigKey } from '../src/lib/repo-config-keys.js';
import { deliveryWorkflowCheck } from '../src/commands/doctor-delivery.js';
import { CHECK_EXPLANATIONS, gapsFromCheck } from '../src/lib/doctor-explain.js';
import { runConfigureGuided } from '../src/commands/configure-guided.js';
import { DELIVERY_CLAUDE_CODE_VERSION } from '../src/lib/delivery.js';
import { setConfigPath } from '../src/lib/config-path.js';
import type { FetchLike } from '../src/lib/onboarding-portal.js';

// DevAudit-Installer#1272, #1273 — the delivery keys, the delivery-workflow doctor check, the skill's headless
// rules, and `configure --preset <id> --yes` (the preset a delivery run's issue names).

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
beforeAll(() => {
  process.env['DEVAUDIT_INSTALLER_ROOT'] = ROOT;
  // #1321: the doctor check probes the portal when a key is in the environment; these tests never do.
  for (const k of ['DEVAUDIT_AGENT_PORTAL_KEY', 'DEVAUDIT_API_KEY', 'DEVAUDIT_DOCTOR_SKIP_DELIVERY_PROBE']) vi.stubEnv(k, '');
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-delivery-doc-'));
  dirs.push(dir);
  return dir;
}

describe('the delivery configuration keys (#1272)', () => {
  it('delivery.enabled is a boolean', () => {
    expect(validateConfigKeyValue('delivery.enabled', 'true')).toEqual({ value: true });
    expect(validateConfigKeyValue('delivery.enabled', 'false')).toEqual({ value: false });
    expect(validateConfigKeyValue('delivery.enabled', 'yes').error).toBeDefined();
  });

  it('delivery.max_turns is a whole number from 10 to 1000', () => {
    expect(validateConfigKeyValue('delivery.max_turns', '10')).toEqual({ value: 10 });
    expect(validateConfigKeyValue('delivery.max_turns', '1000')).toEqual({ value: 1000 });
    for (const bad of ['9', '1001', '12.5', 'many']) expect(validateConfigKeyValue('delivery.max_turns', bad).error, bad).toBeDefined();
  });

  it('delivery.max_minutes is a whole number from 10 to 360', () => {
    expect(validateConfigKeyValue('delivery.max_minutes', '10')).toEqual({ value: 10 });
    expect(validateConfigKeyValue('delivery.max_minutes', '360')).toEqual({ value: 360 });
    for (const bad of ['9', '361', '1.5', 'long']) expect(validateConfigKeyValue('delivery.max_minutes', bad).error, bad).toBeDefined();
  });

  it('changing one regenerates the delivery workflow', () => {
    for (const key of ['delivery.enabled', 'delivery.max_turns', 'delivery.max_minutes']) {
      expect(findConfigKey(key)?.affects, key).toContain('.github/workflows/devaudit-delivery.yml');
    }
  });

  it('delivery.github_token_source is secret or app (#1286)', () => {
    expect(validateConfigKeyValue('delivery.github_token_source', 'secret')).toEqual({ value: 'secret' });
    expect(validateConfigKeyValue('delivery.github_token_source', 'app')).toEqual({ value: 'app' });
    for (const bad of ['github-token', 'none', '']) expect(validateConfigKeyValue('delivery.github_token_source', bad).error, bad).toBeDefined();
  });

  it('delivery.agent_git_name is a one-line name without angle brackets (#1286)', () => {
    expect(validateConfigKeyValue('delivery.agent_git_name', 'Acme Delivery Bot')).toEqual({ value: 'Acme Delivery Bot' });
    for (const bad of ['', '   ', 'a <b@c>', 'x'.repeat(101)]) expect(validateConfigKeyValue('delivery.agent_git_name', bad).error, bad).toBeDefined();
    expect(findConfigKey('delivery.agent_git_name')?.description).toContain('never configured');
  });

  it('onboarding does not ask them: each is listed as not asked', () => {
    for (const key of ['delivery.enabled', 'delivery.max_turns', 'delivery.max_minutes', 'delivery.github_token_source', 'delivery.agent_git_name']) expect(NOT_ASKED[key], key).toBeDefined();
  });
});

describe('the delivery-workflow doctor check (#1272)', () => {
  const okGh = (names: string[]) => async () => ({ exitCode: 0, stdout: JSON.stringify(names.map((name) => ({ name }))), stderr: '' });
  const goodWorkflow = `steps:\n  - run: npm install -g @anthropic-ai/claude-code@${DELIVERY_CLAUDE_CODE_VERSION} @metasession.co/devaudit-cli@1.0.0\n  - run: devaudit delivery github-token --run "$RUN_ID" --mask --github-env\n`;
  const DEFAULT_CFG = { delivery: { enabled: true, github_token_source: 'app' } };

  async function repoWith(opts: { workflow?: string | null; prompt?: boolean; cfg?: Record<string, unknown> }) {
    const dir = await tmp();
    await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
    if (opts.workflow !== null) await fs.writeFile(join(dir, '.github', 'workflows', 'devaudit-delivery.yml'), opts.workflow ?? goodWorkflow);
    if (opts.prompt !== false) {
      await fs.mkdir(join(dir, '.devaudit'), { recursive: true });
      await fs.writeFile(join(dir, '.devaudit', 'delivery-prompt.md'), 'prompt');
    }
    return { repoRoot: dir, cfg: opts.cfg ?? DEFAULT_CFG };
  }
  const allSecrets = ['DEVAUDIT_AGENT_API_KEY', 'DEVAUDIT_AGENT_PORTAL_KEY'];

  it('is absent unless delivery.enabled is true', async () => {
    for (const cfg of [{}, { delivery: { enabled: false } }, { delivery: {} }]) {
      expect(await deliveryWorkflowCheck(await repoWith({ cfg }), { gh: okGh([]) })).toBeNull();
    }
  });

  it('passes when the workflow, the prompt, both secrets and the Claude Code version are right', async () => {
    const r = await deliveryWorkflowCheck(await repoWith({}), { gh: okGh(['DEVAUDIT_AGENT_API_KEY', 'DEVAUDIT_AGENT_PORTAL_KEY', 'DEVAUDIT_API_KEY']) });
    expect(r).toMatchObject({ name: 'delivery-workflow', ok: true });
  });

  it('names a missing workflow, a missing prompt, and the missing secrets', async () => {
    const r = await deliveryWorkflowCheck(await repoWith({ workflow: null, prompt: false }), { gh: okGh(['DEVAUDIT_AGENT_PORTAL_KEY']) });
    expect(r?.ok).toBe(false);
    expect(r?.findings?.map((f) => f.subject).sort()).toEqual(['prompt-missing', 'secret-missing', 'workflow-missing']);
    const secret = r!.findings!.find((f) => f.subject === 'secret-missing')!;
    expect(secret.detail).toContain('DEVAUDIT_AGENT_API_KEY');
    expect(secret.detail).not.toContain('DEVAUDIT_AGENT_PORTAL_KEY');
    expect(secret.remediation?.plan.join('\n')).toContain('gh secret set DEVAUDIT_AGENT_API_KEY');
  });

  it('flags a Claude Code version that is not the one this CLI generates', async () => {
    const stale = goodWorkflow.replace(DELIVERY_CLAUDE_CODE_VERSION, '1.0.0');
    const r = await deliveryWorkflowCheck(await repoWith({ workflow: stale }), { gh: okGh(['DEVAUDIT_AGENT_API_KEY', 'DEVAUDIT_AGENT_PORTAL_KEY']) });
    expect(r?.findings?.map((f) => f.subject)).toEqual(['claude-code-version']);
    expect(r?.findings?.[0]?.detail).toContain('1.0.0');
    const none = await deliveryWorkflowCheck(await repoWith({ workflow: 'steps: []\n' }), { gh: okGh(['DEVAUDIT_AGENT_API_KEY', 'DEVAUDIT_AGENT_PORTAL_KEY']) });
    expect(none?.findings?.find((f) => f.subject === 'claude-code-version')?.detail).toContain('no pinned version');
  });

  it('skips the secrets, and says so, when the GitHub CLI cannot list them; it does not fail', async () => {
    const r = await deliveryWorkflowCheck(await repoWith({}), { gh: async () => ({ exitCode: 1, stdout: '', stderr: 'not logged in' }) });
    expect(r?.ok).toBe(true);
    expect(r?.detail).toContain('secrets were not checked');
  });

  describe('the agent GitHub token source (#1286)', () => {
    const subjects = async (cfg: Record<string, unknown>, names: string[], workflow?: string) =>
      (await deliveryWorkflowCheck(await repoWith({ cfg, ...(workflow !== undefined ? { workflow } : {}) }), { gh: okGh(names) }))?.findings?.map((f) => f.subject) ?? [];

    it('fails when the token source is not set, or is not secret or app', async () => {
      for (const delivery of [{ enabled: true }, { enabled: true, github_token_source: 'pat' }, { enabled: true, github_token_source: '' }]) {
        const r = await deliveryWorkflowCheck(await repoWith({ cfg: { delivery } }), { gh: okGh(allSecrets) });
        expect(r?.ok, JSON.stringify(delivery)).toBe(false);
        expect(r?.findings?.map((f) => f.subject)).toEqual(['token-source']);
        expect(r?.findings?.[0]?.remediation?.plan.join('\n')).toContain('delivery.github_token_source app');
        expect(r?.findings?.[0]?.remediation?.plan.join('\n')).toContain('delivery.github_token_source secret');
      }
    });

    it('with app it passes, saying the portal mints the token and checks the installation at run time', async () => {
      const r = await deliveryWorkflowCheck(await repoWith({}), { gh: okGh(allSecrets) });
      expect(r?.ok).toBe(true);
      expect(r?.detail).toContain("minted by the portal's GitHub App");
    });

    it('with secret it passes when DEVAUDIT_AGENT_GITHUB_TOKEN is set and fails when it is not', async () => {
      const cfg = { delivery: { enabled: true, github_token_source: 'secret' } };
      expect(await subjects(cfg, [...allSecrets, 'DEVAUDIT_AGENT_GITHUB_TOKEN'])).toEqual([]);
      const missing = await deliveryWorkflowCheck(await repoWith({ cfg }), { gh: okGh(allSecrets) });
      expect(missing?.ok).toBe(false);
      expect(missing?.findings?.map((f) => f.subject)).toEqual(['token-secret-missing']);
      expect(missing?.findings?.[0]?.remediation?.plan.join('\n')).toContain('gh secret set DEVAUDIT_AGENT_GITHUB_TOKEN');
    });

    it('does not guess about the secret when the GitHub CLI cannot list secrets', async () => {
      const cfg = { delivery: { enabled: true, github_token_source: 'secret' } };
      const r = await deliveryWorkflowCheck(await repoWith({ cfg }), { gh: async () => ({ exitCode: 1, stdout: '', stderr: 'no' }) });
      expect(r?.ok).toBe(true);
    });

    it('fails for a workflow generated before the token handling: it falls back to the default token, or never resolves one', async () => {
      const cfg = DEFAULT_CFG;
      expect(await subjects(cfg, allSecrets, `${goodWorkflow}  - env:\n      GH_TOKEN: \${{ secrets.DEVAUDIT_AGENT_GITHUB_TOKEN || github.token }}\n`)).toEqual(['workflow-token-stale']);
      expect(await subjects(cfg, allSecrets, `steps:\n  - run: npm install -g @anthropic-ai/claude-code@${DELIVERY_CLAUDE_CODE_VERSION}\n`)).toEqual(['workflow-token-stale']);
    });

    it('each new finding has an explanation and a gap', async () => {
      for (const key of ['token-source', 'token-secret-missing', 'workflow-token-stale']) expect(CHECK_EXPLANATIONS[`delivery-workflow:${key}`], key).toBeDefined();
      const r = await deliveryWorkflowCheck(await repoWith({ cfg: { delivery: { enabled: true } } }), { gh: okGh(allSecrets) });
      expect(gapsFromCheck(r!)).toHaveLength(1);
    });
  });

  it('every finding is guidance (tier C) and has an explanation', async () => {
    const r = await deliveryWorkflowCheck(await repoWith({ workflow: null, prompt: false }), { gh: okGh([]) });
    for (const f of r!.findings!) expect(f.remediation?.tier, f.subject).toBe('C');
    expect(CHECK_EXPLANATIONS['delivery-workflow']).toBeDefined();
    const gaps = gapsFromCheck(r!);
    expect(gaps).toHaveLength(r!.findings!.length);
    for (const key of ['workflow-missing', 'claude-code-version', 'prompt-missing', 'secret-missing']) {
      expect(CHECK_EXPLANATIONS[`delivery-workflow:${key}`], key).toBeDefined();
    }
  });
});

describe('the sdlc-implementer headless rules (#1273)', () => {
  let skill = '';
  beforeAll(async () => {
    skill = (await fs.readFile(join(ROOT, 'sdlc', 'files', '_common', 'skills', 'sdlc-implementer', 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n');
  });
  const section = () => {
    const start = skill.indexOf('## Headless (delivery run) rules');
    expect(start).toBeGreaterThan(-1);
    return skill.slice(start, skill.indexOf('\n## The workflow', start));
  };

  it('has the section, applied only to a delivery run', () => {
    expect(section()).toContain('This is DevAudit delivery run');
    expect(section()).toContain('`DevAudit-Run: <id>`');
    expect(section()).toContain('this section does not apply');
  });

  it('names the seven rules, each with its report or its hard stop', () => {
    const text = section();
    const rules = [...text.matchAll(/^(\d)\. \*\*/gm)].map((m) => m[1]);
    expect(rules).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(text).toContain('not a tracked change'); // 1
    expect(text).toContain('spec too large'); // 2
    expect(text).toContain('Assumptions (headless)'); // 3
    expect(text).toContain('--phase running --release'); // 4
    expect(text).toContain('--phase awaiting_approval'); // 5
    expect(text).toMatch(/exit 0/);
    expect(text).toContain('Never force-push'); // 6
    expect(text).toContain('branch protection');
    expect(text).toContain('devaudit configure --preset <X> --yes');
    expect(text).toContain('first commit of the run');
    expect(text).toContain('Co-Authored-By:'); // 7
  });

  it('reports the portal release with the agent key, not a viewer key, and never declares the run waiting without one (#1291)', () => {
    const text = section();
    expect(text).toContain('--phase running --release-for REQ-XXX');
    expect(text).toContain('--phase awaiting_approval --release-for REQ-XXX');
    expect(text).toContain("agent's own key");
    expect(text).toContain('do not use `devaudit release status`'); // it needs a viewer key, which a delivery run does not have
    expect(text).not.toContain('release status REQ-XXX --json');
    expect(text).toContain('no release was registered for this run');
    expect(text).toContain('completes a run only when the release the run reported is released');
  });

  it('ends the run with a reason when a push is rejected for editing workflow files, and never works around it (#1286)', () => {
    const text = section();
    expect(text).toContain('.github/workflows');
    expect(text).toContain('the agent has no permission to push workflow files');
    expect(text).toContain('do not retry and do not work around it');
    expect(text).toContain('--phase failed --reason');
  });

  it('the command it tells the agent to run exists', async () => {
    const help = await execa('node', [join(ROOT, 'cli', 'bin', 'devaudit.js'), 'configure', '--help'], { reject: false });
    expect(help.stdout).toContain('--preset');
    const report = await execa('node', [join(ROOT, 'cli', 'bin', 'devaudit.js'), 'delivery', 'report', '--help'], { reject: false });
    for (const flag of ['--run', '--phase', '--reason', '--release', '--cost-file', '--ci-seconds']) expect(report.stdout, flag).toContain(flag);
  });
});

describe('configure --preset <id> --yes (#1273)', () => {
  const FULL = "export default { projects: [{ name: 'smoke' }, { name: 'critical' }, { name: 'regression' }] };\n";
  const SMOKE = "export default { projects: [{ name: 'smoke' }] };\n";
  const policy = (p: 'independent' | 'self_allowed_with_gap'): FetchLike => async () => ({ ok: true, status: 200, json: async () => ({ approval_policy: p }) });

  async function repo(playwright: string): Promise<string> {
    const dir = await tmp();
    await execa('git', ['init', '-q'], { cwd: dir });
    let cfg: Record<string, unknown> = {
      project_slug: 'example-app',
      stack: 'node',
      host: 'railway',
      node_version: '20',
      source_dirs: 'app/',
      working_directory: '.',
      production_url_secret: 'EXAMPLE_APP_PROD_URL',
      runner: 'ubuntu-latest',
      e2e_data_isolation: 'ephemeral',
      approval: { mode: 'dual_actor', auto_low_risk_threshold: 'LOW' },
    };
    cfg = setConfigPath(cfg, 'onboarding_preset', 'custom');
    await fs.writeFile(join(dir, 'sdlc-config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
    await fs.writeFile(join(dir, 'playwright.config.ts'), playwright);
    return dir;
  }
  const read = async (dir: string) => JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8')) as Record<string, any>;
  const run = (dir: string, opts: { preset?: string; yes?: boolean }, policyKind: 'independent' | 'self_allowed_with_gap' = 'independent') =>
    runConfigureGuided({ json: false, ...opts }, { cwd: dir, fetchImpl: policy(policyKind), viewerKey: 'viewer', say: () => undefined, collaborators: async () => null, terminalProblem: 'no terminal' });

  it('applies the preset with no terminal and no question, keeping every other answer', async () => {
    const dir = await repo(FULL);
    expect(await run(dir, { preset: 'C', yes: true })).toBe(0);
    const cfg = await read(dir);
    expect(cfg['onboarding_preset']).toBe('C');
    expect(cfg['approval'].mode).toBe(PRESETS.C.config['approval.mode']);
    expect(cfg['project_slug']).toBe('example-app');
    expect(cfg['host']).toBe('railway');
  });

  it('refuses a preset the repository cannot be offered (exit 2) and writes nothing', async () => {
    const dir = await repo(SMOKE);
    const before = await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8');
    expect(await run(dir, { preset: 'D', yes: true })).toBe(2);
    expect(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8')).toBe(before);
  });

  it('refuses an unknown preset, and --yes without --preset, with exit 2', async () => {
    const dir = await repo(FULL);
    expect(await run(dir, { preset: 'Z', yes: true })).toBe(2);
    expect(await run(dir, { yes: true })).toBe(2);
  });

  it('without --yes it still needs a terminal', async () => {
    const dir = await repo(FULL);
    expect(await run(dir, { preset: 'C' })).not.toBe(0);
  });
});
