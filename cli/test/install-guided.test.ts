import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS } from '@metasession.co/devaudit-core';
import { collectPlan } from '../src/install/prompts.js';
import { writeSdlcConfig } from '../src/install/write-config.js';
import { applyOnboardingPortal } from '../src/install/onboarding-apply.js';
import { readScanHints } from '../src/install/scan-hints.js';
import { collaboratorCount } from '../src/lib/collaborators.js';
import { InstallRefusal } from '../src/install/refusal.js';
import { describeProjectPreset, complianceLine, effectivePreset, parsePresetFlag, type GuidedAsker } from '../src/install/guided.js';
import { readApprovalPolicy, readClaimedStandards, setApprovalPolicy, type FetchLike } from '../src/lib/onboarding-portal.js';
import type { DetectedStack, InstallContext, InstallPlan } from '../src/install/types.js';

// DevAudit-Installer#1116 WP6 — the guided install: preset suggestion, express summary, change one
// thing, detailed questions, `--preset`, `--from-scan`, `join`, and the portal calls behind them.

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const detected: DetectedStack = { stack: 'node', workingDirectory: '.' };
const FULL_PLAYWRIGHT = "export default { projects: [{ name: 'smoke' }, { name: 'critical' }, { name: 'regression' }] };\n";
const SMOKE_CRITICAL = "export default { projects: [{ name: 'smoke' }, { name: 'critical' }] };\n";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function repo(opts: { config?: Record<string, unknown> | null; playwright?: string | null } = {}): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-install-guided-'));
  dirs.push(dir);
  if (opts.config) await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(opts.config));
  if (opts.playwright !== null) await fs.writeFile(join(dir, 'playwright.config.ts'), opts.playwright ?? FULL_PLAYWRIGHT);
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
    nonInteractive: false,
    installMode: 'operator',
    addTarget: false,
    issueViewerKey: false,
    printViewerKey: false,
    ...extra,
  };
}

interface SelectCall {
  message: string;
  options: ReadonlyArray<{ value: string; label: string; hint?: string }>;
  initial: string;
}

/** An asker that answers from queues and fails loudly on anything unexpected. */
function asker(script: { data?: string; select?: string[]; confirm?: boolean[]; text?: string[]; multiselect?: string[][] } = {}) {
  const queues = { select: [...(script.select ?? [])], confirm: [...(script.confirm ?? [])], text: [...(script.text ?? [])], multiselect: [...(script.multiselect ?? [])] };
  const selects: SelectCall[] = [];
  const texts: Array<{ message: string; initial: string; validate?: (v: string) => string | undefined }> = [];
  const confirms: string[] = [];
  const say: string[] = [];
  const dataAsked: string[] = [];
  const dataAnswer = script.data ?? 'unknown';
  const next = <T>(kind: keyof typeof queues, message: string): T => {
    const value = (queues[kind] as unknown[]).shift();
    if (value === undefined) throw new Error(`unexpected ${kind} prompt: ${message}`);
    return value as T;
  };
  const ask: GuidedAsker = {
    select: async (message, options, initial) => {
      // Q18 is asked straight after B, C or D when the data has no answer; most tests do not care.
      if (message.startsWith('Where do the tests get their data?')) {
        dataAsked.push(message);
        return dataAnswer;
      }
      selects.push({ message, options, initial });
      const answer = next<string>('select', message);
      return answer === '<default>' ? initial : answer;
    },
    text: async (message, initial, validate) => {
      texts.push({ message, initial, ...(validate ? { validate } : {}) });
      const answer = next<string>('text', message);
      return answer === '<default>' ? initial : answer;
    },
    confirm: async (message) => {
      confirms.push(message);
      return next<boolean>('confirm', message);
    },
    multiselect: async (message, _options, initial) => {
      const answer = (queues.multiselect as string[][]).shift();
      if (answer === undefined) return [...initial];
      void message;
      return answer;
    },
  };
  return { ask, selects, texts, confirms, dataAsked, say, sayFn: (line: string) => void say.push(line) };
}

/** A portal stub: `GET /api/ci/projects/{slug}` answers with `project`, the frameworks route with `frameworks`. */
function portal(project: { status: number; body?: unknown } | null, frameworks: { status: number; body?: unknown } | null = null) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, ...(init?.body !== undefined ? { body: init.body } : {}) });
    const reply = url.endsWith('/frameworks') ? frameworks : project;
    const r = reply ?? { status: 404 };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {} };
  };
  return { fetchImpl, calls };
}

const POLICY_SOLO = { status: 200, body: { approval_policy: 'self_allowed_with_gap' } };
const POLICY_INDEPENDENT = { status: 200, body: { approval_policy: 'independent' } };
const POLICY_ABSENT = { status: 200, body: { slug: 'fixture-app' } };

async function run(dir: string, a: ReturnType<typeof asker>, p: ReturnType<typeof portal>, ctxExtra: Partial<InstallContext> = {}, collaborators: () => Promise<number | null> = async () => null): Promise<InstallPlan> {
  return collectPlan(ctxFor(dir, ctxExtra), detected, { ask: a.ask, say: a.sayFn, fetchImpl: p.fetchImpl, viewerKey: 'viewer-key', collaborators });
}

describe('the express path, per preset', () => {
  it.each(['A', 'B', 'C', 'D'] as const)('preset %s: the summary is shown once and "yes" writes the preset values', async (id) => {
    const dir = await repo();
    const a = asker({ select: [id, 'yes'], confirm: PRESETS[id].portalPolicy === 'self_allowed_with_gap' ? [true] : [] });
    const plan = await run(dir, a, portal(POLICY_INDEPENDENT));
    expect(plan.onboarding?.preset).toBe(id);
    expect(plan.onboarding?.config).toMatchObject(PRESETS[id].config);
    const wantsSolo = PRESETS[id].portalPolicy === 'self_allowed_with_gap';
    expect(plan.onboarding?.policyToSet).toBe(wantsSolo ? 'self_allowed_with_gap' : null);
    const summary = a.say.join('\n');
    expect(summary).toContain(`Preset ${id}: ${PRESETS[id].name}`);
    expect(summary).toContain('Compliance:');
    // the express path asks only the preset and the confirmation
    expect(a.selects.map((s) => s.message)).toEqual(['Which preset fits?', 'Use these settings?']);
  });

  it('preset C is suggested for SOC 2 with a full pack, D is listed after C and never suggested', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node', compliance_frameworks: ['soc-2'], onboarding_preset: 'custom' } });
    const a = asker({ select: ['C', 'yes'] });
    await run(dir, a, portal(POLICY_INDEPENDENT));
    const preset = a.selects[0]!;
    expect(preset.initial).toBe('C');
    const values = preset.options.map((o) => o.value);
    expect(values.indexOf('D')).toBe(values.indexOf('C') + 1);
    expect(preset.options.find((o) => o.value === 'D')?.hint).toContain('the full pack is not run again after the deploy');
  });

  it('D is not offered when C is not (no full pack)', async () => {
    const dir = await repo({ playwright: SMOKE_CRITICAL });
    const a = asker({ select: ['B', 'yes'], confirm: [true] });
    await run(dir, a, portal(POLICY_INDEPENDENT));
    const values = a.selects[0]!.options.map((o) => o.value);
    expect(values).not.toContain('C');
    expect(values).not.toContain('D');
    expect(a.say.join('\n')).toContain('Preset D (Full gate, tested once) is not available: it needs a full test pack');
  });

  it('no tests and a portal without approval_policy: only custom is offered and suggested', async () => {
    const dir = await repo({ playwright: null });
    const a = asker({ select: ['custom'], text: [] });
    // the detailed questions follow the custom choice; stop at the first by letting the queue run dry
    await expect(run(dir, a, portal(POLICY_ABSENT))).rejects.toThrow(/unexpected/);
    const first = a.selects[0]!;
    expect(first.options.map((o) => o.value)).toEqual(['custom']);
    expect(first.initial).toBe('custom');
    expect(a.say.join('\n')).toContain('this portal does not yet allow a solo approver; ask its operator to upgrade');
  });

  it('a portal without approval_policy: A and B are listed as unavailable with the reason and C is still offered', async () => {
    const dir = await repo();
    const a = asker({ select: ['C', 'yes'] });
    await run(dir, a, portal(POLICY_ABSENT));
    const values = a.selects[0]!.options.map((o) => o.value);
    expect(values).not.toContain('A');
    expect(values).not.toContain('B');
    expect(values).toContain('C');
    const said = a.say.join('\n');
    expect(said).toContain('Preset A (Solo, fast feedback) is not available: this portal does not yet allow a solo approver; ask its operator to upgrade.');
    expect(said).toContain('Preset B (Safety net) is not available');
  });

  it('declining the policy change for A returns to the preset question', async () => {
    const dir = await repo();
    const a = asker({ select: ['A', 'C', 'yes'], confirm: [false] });
    const plan = await run(dir, a, portal(POLICY_INDEPENDENT));
    expect(plan.onboarding?.preset).toBe('C');
    expect(a.confirms[0]).toBe('Allow that?');
  });

  it('a project whose portal policy already allows self-approval is not asked, and nothing is set', async () => {
    const dir = await repo();
    const a = asker({ select: ['A', 'yes'] });
    const plan = await run(dir, a, portal(POLICY_SOLO));
    expect(plan.onboarding?.preset).toBe('A');
    expect(plan.onboarding?.policyToSet).toBeNull();
    expect(a.confirms).toEqual([]);
  });

  it('custom asks every question that applies, with detected values as defaults', async () => {
    const dir = await repo();
    const a = asker({
      select: ['custom', 'railway', '<default>', 'critical', 'full', '<default>', 'github', 'different-person', 'yes', '<default>', 'clean', 'unknown', 'no'],
      text: ['fixture-app', '<default>', '.', '', '<default>', '<default>', '<default>', '', '', '', '', ''],
    });
    // The queue length is a guide; what matters is the first answers are accepted and the flow ends.
    await run(dir, a, portal(POLICY_INDEPENDENT)).catch(() => undefined);
    const asked = a.selects.map((s) => s.message);
    expect(asked[0]).toBe('Which preset fits?');
    expect(asked.some((m) => m.startsWith('Where does production run?'))).toBe(true);
  });
});

describe('Q18 (where the tests get their data)', () => {
  it.each(['B', 'C', 'D'] as const)('is asked straight after preset %s when the data has no answer', async (id) => {
    const dir = await repo();
    const a = asker({ select: [id, 'yes'], confirm: id === 'B' ? [true] : [] });
    await run(dir, a, portal(POLICY_INDEPENDENT));
    expect(a.dataAsked).toHaveLength(1);
  });

  it('is not asked for preset A, or when the project already has an answer', async () => {
    const dir = await repo();
    const a = asker({ select: ['A', 'yes'], confirm: [true] });
    await run(dir, a, portal(POLICY_INDEPENDENT));
    expect(a.dataAsked).toHaveLength(0);
    const dir2 = await repo({ config: { project_slug: 'fixture-app', stack: 'node', e2e_data_isolation: 'ephemeral', onboarding_preset: 'C' } });
    const b = asker({ select: ['C', 'yes'] });
    const plan = await run(dir2, b, portal(POLICY_INDEPENDENT));
    expect(b.dataAsked).toHaveLength(0);
    expect(plan.onboarding?.preset).toBe('C');
    expect(b.say.join('\n')).toContain('Test data: ephemeral');
  });

  it('writes the answer and the concurrency group for a shared, serialised environment', async () => {
    const dir = await repo();
    const a = asker({ select: ['C', 'yes'], data: 'shared_serialised' });
    const plan = await run(dir, a, portal(POLICY_INDEPENDENT));
    expect(plan.onboarding?.config['e2e_data_isolation']).toBe('shared_serialised');
    expect(plan.onboarding?.config['e2e_concurrency_group']).toBe('fixture-app-e2e-data');
  });
});

describe('the one-collaborator warning', () => {
  const WARNING = 'only one collaborator';

  it('is printed (and nothing is refused) when a different person approves and the repository has one collaborator', async () => {
    const dir = await repo();
    const a = asker({ select: ['C', 'yes'] });
    const plan = await run(dir, a, portal(POLICY_INDEPENDENT), {}, async () => 1);
    expect(a.say.join('\n')).toContain(WARNING);
    expect(plan.onboarding?.config['approval.mode']).toBe('dual_actor');
  });

  it('is not printed with two collaborators, when the count is unknown, or when the person approves their own', async () => {
    for (const count of [2, null]) {
      const dir = await repo();
      const a = asker({ select: ['C', 'yes'] });
      await run(dir, a, portal(POLICY_INDEPENDENT), {}, async () => count);
      expect(a.say.join('\n'), String(count)).not.toContain(WARNING);
    }
    const dir = await repo();
    const solo = asker({ select: ['A', 'yes'] });
    await run(dir, solo, portal(POLICY_SOLO), {}, async () => 1);
    expect(solo.say.join('\n')).not.toContain(WARNING);
  });
});

describe('collaboratorCount', () => {
  it('reads the count from gh and says nothing when gh cannot tell', async () => {
    const calls: string[][] = [];
    const gh = (out: string, exitCode = 0) => async (args: readonly string[]) => {
      calls.push([...args]);
      return { exitCode, stdout: out };
    };
    expect(await collaboratorCount('/repo', gh('1\n'))).toBe(1);
    expect(calls[0]).toEqual(['api', 'repos/{owner}/{repo}/collaborators', '--jq', 'length']);
    expect(await collaboratorCount('/repo', gh('3'))).toBe(3);
    expect(await collaboratorCount('/repo', gh('', 1))).toBeNull();
    expect(await collaboratorCount('/repo', gh('not a number'))).toBeNull();
  });
});

describe('change one thing and detailed questions', () => {
  it('"change one thing" re-shows the summary with the new value and records custom', async () => {
    const dir = await repo();
    const a = asker({ select: ['C', 'change', 'Q12', 'no', 'yes'] });
    const plan = await run(dir, a, portal(POLICY_INDEPENDENT));
    const said = a.say.join('\n');
    expect(said.match(/Preset C: Team with a compliance lead/g)).toHaveLength(2);
    expect(said).toContain('After a deploy a person confirms production: yes (two recorded clicks)');
    expect(said).toContain('After a deploy a person confirms production: no (automatic)');
    expect(plan.onboarding?.config['production_review.terminal_status']).toBe('released');
    expect(plan.onboarding?.preset).toBe('custom');
    expect(plan.onboarding?.config['onboarding_preset']).toBe('custom');
  });

  it('the compliance line is recomputed after the approval answer changes', async () => {
    const dir = await repo();
    const a = asker({ select: ['C', 'change', 'Q11', 'solo', 'yes'], confirm: [] });
    const plan = await run(dir, a, portal(POLICY_SOLO));
    const lines = a.say.filter((l) => l.includes('Compliance:'));
    expect(lines[0]).toContain('No control gap');
    expect(lines[1]).toContain('You approve your own releases');
    expect(plan.onboarding?.config['approval.mode']).toBe('solo_with_gap');
    expect(plan.onboarding?.config['release_branch_required_reviews']).toBe(0);
    expect(plan.onboarding?.policyToSet).toBeNull();
  });

  it('a flag overrides the preset value and is recorded as custom', async () => {
    const dir = await repo();
    const a = asker({ select: ['C', 'yes'] });
    const plan = await run(dir, a, portal(POLICY_INDEPENDENT), { testOptions: { release_gate_tier: 'smoke' } });
    expect(plan.onboarding?.config['release_gate_tier']).toBe('smoke');
    expect(plan.onboarding?.preset).toBe('custom');
  });

  it('the text questions refuse what the registry validators refuse', async () => {
    const dir = await repo();
    const a = asker({ select: ['C', 'detailed', 'yes'], text: ['<default>', '<default>', '<default>', '<default>', '', '<default>', '<default>', '<default>', '<default>', '', '', '', '', ''] });
    await run(dir, a, portal(POLICY_INDEPENDENT)).catch(() => undefined);
    const slug = a.texts.find((t) => t.message.startsWith('What is the project called'));
    expect(slug?.validate?.('Not A Slug')).toContain('lower-case letters');
    expect(slug?.validate?.('my-app')).toBeUndefined();
    const url = a.texts.find((t) => t.message.startsWith('What is the production web address'));
    expect(url?.validate?.('http://x.example.com')).toContain('https://');
    expect(url?.validate?.('')).toBeUndefined();
    const secret = a.texts.find((t) => t.message.startsWith('What is the name of the secret'));
    expect(secret?.validate?.('lower_case')).toContain('upper-case');
  });
});

describe('re-running on a project that has a config but no onboarding_preset (decision 12)', () => {
  it('keeping the current settings applies no preset and no policy', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node', release_gate_tier: 'smoke' } });
    const a = asker({ select: ['keep'] });
    const plan = await run(dir, a, portal(POLICY_INDEPENDENT));
    expect(plan.onboarding?.preset).toBeNull();
    expect(plan.onboarding?.config).toEqual({});
    expect(plan.onboarding?.policyToSet).toBeNull();
    expect(a.selects[0]!.initial).toBe('keep');
    const ctx = ctxFor(dir);
    await writeSdlcConfig(ctx, plan);
    const written = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;
    expect(written['onboarding_preset']).toBeUndefined();
    expect(written['release_gate_tier']).toBe('smoke');
    expect((written['approval'] as { mode: string }).mode).toBe('dual_actor');
  });

  it('choosing a preset switches cleanly: keys of other presets are removed', async () => {
    const dir = await repo({
      config: { project_slug: 'fixture-app', stack: 'node', onboarding_preset: 'B', e2e_regression_enabled: true, release_gate_tier: 'critical', post_deploy_full_regression: true, scheduled_full_regression: '0 2 * * *', approval: { mode: 'solo_with_gap', auto_low_risk_threshold: 'LOW' }, release_branch_required_reviews: 0 },
    });
    const a = asker({ select: ['A', 'yes'] });
    const plan = await run(dir, a, portal(POLICY_SOLO));
    expect([...(plan.onboarding?.removeKeys ?? [])].sort()).toEqual(['post_deploy_full_regression', 'release_gate_tier', 'scheduled_full_regression']);
    await writeSdlcConfig(ctxFor(dir), plan);
    const written = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;
    expect(written['onboarding_preset']).toBe('A');
    expect(written['release_gate_tier']).toBeUndefined();
    expect(written['e2e_regression_enabled']).toBe(false);
    // the sibling of approval.mode survives
    expect(written['approval']).toEqual({ mode: 'solo_with_gap', auto_low_risk_threshold: 'LOW' });
  });
});

describe('--preset without questions (--yes)', () => {
  it('preset C needs no policy check', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node' } });
    const p = portal(null);
    const plan = await collectPlan(ctxFor(dir, { nonInteractive: true, preset: 'C' }), detected, { fetchImpl: p.fetchImpl, viewerKey: null });
    expect(plan.onboarding?.preset).toBe('C');
    expect(plan.onboarding?.config).toMatchObject(PRESETS.C.config);
    expect(plan.onboarding?.policyToSet).toBeNull();
  });

  it('preset A with a policy that allows self-approval is applied', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node' } });
    const plan = await collectPlan(ctxFor(dir, { nonInteractive: true, preset: 'a' }), detected, { fetchImpl: portal(POLICY_SOLO).fetchImpl, viewerKey: 'k' });
    expect(plan.onboarding?.preset).toBe('A');
  });

  it.each(['A', 'B'])('preset %s refuses (exit 2) when the portal does not report self-approval', async (id) => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node' } });
    for (const project of [POLICY_ABSENT, POLICY_INDEPENDENT, null]) {
      const err = await collectPlan(ctxFor(dir, { nonInteractive: true, preset: id }), detected, { fetchImpl: portal(project).fetchImpl, viewerKey: 'k' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InstallRefusal);
      expect((err as InstallRefusal).exitCode).toBe(2);
      expect((err as Error).message).toBe(
        `Preset ${id} needs the project's approval policy to allow self-approval with a recorded gap. Run \`devaudit install\` in a terminal (it asks to set it), or set it in the portal's project settings, then run this again.`,
      );
    }
  });

  it('preset C without a full pack refuses with the reason', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node' }, playwright: SMOKE_CRITICAL });
    const err = await collectPlan(ctxFor(dir, { nonInteractive: true, preset: 'C' }), detected, { fetchImpl: portal(null).fetchImpl, viewerKey: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InstallRefusal);
    expect((err as Error).message).toContain('needs a full test pack');
  });

  it('custom records the preset and nothing else', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node' } });
    const plan = await collectPlan(ctxFor(dir, { nonInteractive: true, preset: 'custom' }), detected, { fetchImpl: portal(null).fetchImpl, viewerKey: null });
    expect(plan.onboarding?.config).toEqual({ onboarding_preset: 'custom' });
  });

  it('an unknown preset is refused', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node' } });
    const err = await collectPlan(ctxFor(dir, { nonInteractive: true, preset: 'E' }), detected, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InstallRefusal);
    expect((err as Error).message).toContain('Unknown preset "E"');
  });

  it('--yes without --preset is unchanged: no onboarding block, no portal call', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node' } });
    const p = portal(POLICY_SOLO);
    const plan = await collectPlan(ctxFor(dir, { nonInteractive: true }), detected, { fetchImpl: p.fetchImpl, viewerKey: 'k' });
    expect(plan.onboarding).toBeUndefined();
    expect(p.calls).toEqual([]);
  });
});

describe('--preset while interactive', () => {
  it('skips the preset question', async () => {
    const dir = await repo();
    const a = asker({ select: ['yes'] });
    const plan = await run(dir, a, portal(POLICY_INDEPENDENT), { preset: 'C' });
    expect(plan.onboarding?.preset).toBe('C');
    expect(a.selects.map((s) => s.message)).toEqual(['Use these settings?']);
  });

  it('refuses a preset that cannot be offered', async () => {
    const dir = await repo({ playwright: SMOKE_CRITICAL });
    const a = asker({});
    await expect(run(dir, a, portal(POLICY_INDEPENDENT), { preset: 'C' })).rejects.toBeInstanceOf(InstallRefusal);
  });
});

describe('--from-scan', () => {
  it('a report id without a portal address is refused with the file as the alternative', async () => {
    const err = await readScanHints('rpt_8f3a91c2d4').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InstallRefusal);
    expect((err as Error).message).toContain('pass the report file instead');
  });

  describe('a saved report read from the portal (#926)', () => {
    const REPORT = { scanVersion: '1', registryVersion: '2026-10-30', suggestedPreset: 'C', suggestionReason: 'x', facts: {}, gaps: [], frameworks: [{ code: 'soc-2', clauses: [] }, { code: 'gdpr', clauses: [] }] };
    const okFetch = (calls: Array<{ url: string; auth: string | undefined }>, status = 200): FetchLike => async (url, init) => {
      calls.push({ url, auth: init?.headers?.['Authorization'] });
      return { ok: status >= 200 && status < 300, status, json: async () => REPORT };
    };
    const withKey = async (fn: () => Promise<void>): Promise<void> => {
      const prev = process.env['DEVAUDIT_VIEWER_API_KEY'];
      process.env['DEVAUDIT_VIEWER_API_KEY'] = 'viewer-key-for-test';
      try {
        await fn();
      } finally {
        if (prev === undefined) delete process.env['DEVAUDIT_VIEWER_API_KEY'];
        else process.env['DEVAUDIT_VIEWER_API_KEY'] = prev;
      }
    };

    it('reads <project-slug>/<report-id> with the viewer key and takes the preset and the standards', async () => {
      const calls: Array<{ url: string; auth: string | undefined }> = [];
      await withKey(async () => {
        const hints = await readScanHints('example-app/rpt_8f3a91c2d4', { baseUrl: 'https://portal.example/', repoRoot: process.cwd(), fetchImpl: okFetch(calls) });
        expect(hints).toEqual({ preset: 'C', frameworks: ['soc-2', 'gdpr'] });
      });
      expect(calls).toEqual([{ url: 'https://portal.example/api/ci/projects/example-app/scan-reports/rpt_8f3a91c2d4', auth: 'Bearer viewer-key-for-test' }]);
    });

    it('a bare id uses the project in sdlc-config.json', async () => {
      const calls: Array<{ url: string; auth: string | undefined }> = [];
      await withKey(async () => {
        await readScanHints('rpt_8f3a91c2d4', { baseUrl: 'https://portal.example', repoRoot: process.cwd(), configuredSlug: 'example-app', fetchImpl: okFetch(calls) });
      });
      expect(calls[0]!.url).toContain('/projects/example-app/scan-reports/rpt_8f3a91c2d4');
    });

    it('a bare id with no project is refused without a request', async () => {
      const calls: Array<{ url: string; auth: string | undefined }> = [];
      const err = await readScanHints('rpt_8f3a91c2d4', { baseUrl: 'https://portal.example', repoRoot: process.cwd(), fetchImpl: okFetch(calls) }).catch((e: unknown) => e);
      expect((err as Error).message).toContain('has no devaudit.project_slug');
      expect(calls).toEqual([]);
    });

    it('is refused with a reason for 404, 403 and a missing key, and never prints the key', async () => {
      await withKey(async () => {
        for (const [status, text] of [[404, /has no scan report/], [403, /was not accepted/]] as const) {
          const err = await readScanHints('example-app/rpt_8f3a91c2d4', { baseUrl: 'https://portal.example', repoRoot: process.cwd(), fetchImpl: okFetch([], status) }).catch((e: unknown) => e);
          expect(err).toBeInstanceOf(InstallRefusal);
          expect((err as Error).message).toMatch(text);
          expect((err as Error).message).not.toContain('viewer-key-for-test');
        }
      });
      const prev = process.env['DEVAUDIT_VIEWER_API_KEY'];
      delete process.env['DEVAUDIT_VIEWER_API_KEY'];
      try {
        const err = await readScanHints('example-app/rpt_8f3a91c2d4', { baseUrl: 'https://portal.example', repoRoot: '/nonexistent-repo-root', fetchImpl: okFetch([]) }).catch((e: unknown) => e);
        expect((err as Error).message).toContain('needs your viewer key');
      } finally {
        if (prev !== undefined) process.env['DEVAUDIT_VIEWER_API_KEY'] = prev;
      }
    });
  });

  it('an unreadable path and malformed JSON are refused', async () => {
    const dir = await repo({ playwright: null });
    await expect(readScanHints(join(dir, 'missing.json'))).rejects.toBeInstanceOf(InstallRefusal);
    await fs.writeFile(join(dir, 'bad.json'), '{not json');
    await expect(readScanHints(join(dir, 'bad.json'))).rejects.toThrow(/not valid JSON/);
    await fs.writeFile(join(dir, 'list.json'), '[]');
    await expect(readScanHints(join(dir, 'list.json'))).rejects.toThrow(/expected a JSON object/);
  });

  it('takes the suggested preset and the standards from the report', async () => {
    const dir = await repo({ playwright: null });
    await fs.writeFile(join(dir, 'scan.json'), JSON.stringify({ suggestedPreset: 'B', frameworks: ['soc-2', 5] }));
    expect(await readScanHints(join(dir, 'scan.json'))).toEqual({ preset: 'B', frameworks: ['soc-2'] });
  });

  it('takes the standards from a real scan report, whose frameworks are objects with a code', async () => {
    const dir = await repo({ playwright: null });
    await fs.writeFile(join(dir, 'scan.json'), JSON.stringify({ suggestedPreset: 'A', frameworks: [{ code: 'soc-2', clauses: [] }, { code: 'iso-27001', clauses: [] }, { clauses: [] }] }));
    expect(await readScanHints(join(dir, 'scan.json'))).toEqual({ preset: 'A', frameworks: ['soc-2', 'iso-27001'] });
  });

  it('the report preset is the default of the preset question when it can be offered', async () => {
    const dir = await repo();
    const a = asker({ select: ['<default>', 'yes'], confirm: [true] });
    const plan = await run(dir, a, portal(POLICY_INDEPENDENT), { scanHints: { preset: 'B' } });
    expect(a.selects[0]!.initial).toBe('B');
    expect(plan.onboarding?.preset).toBe('B');
  });
});

describe('devaudit join', () => {
  it('asks no question and writes no policy key or preset; shows the project preset', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node', onboarding_preset: 'C' } });
    const a = asker({});
    const plan = await collectPlan(ctxFor(dir, { joining: true }), detected, { ask: a.ask, say: a.sayFn });
    expect(plan.onboarding).toBeUndefined();
    expect(plan.projectSlug).toBe('fixture-app');
    expect(describeProjectPreset({ onboarding_preset: 'C' })).toBe(`This project uses preset C: ${PRESETS.C.name}. ${PRESETS.C.summary}`);
    expect(describeProjectPreset({})).toContain('custom settings');
    expect(describeProjectPreset(null)).toContain('custom settings');
  });
});

describe('helpers', () => {
  it('parsePresetFlag accepts A-D in either case and custom', () => {
    expect(parsePresetFlag('a')).toBe('A');
    expect(parsePresetFlag('D')).toBe('D');
    expect(parsePresetFlag('custom')).toBe('custom');
    expect(parsePresetFlag('AB')).toBeNull();
    expect(parsePresetFlag('')).toBeNull();
  });

  it('effectivePreset is custom once a preset-owned value deviates', () => {
    expect(effectivePreset('C', { ...PRESETS.C.config })).toBe('C');
    expect(effectivePreset('C', { ...PRESETS.C.config, release_gate_tier: 'smoke' })).toBe('custom');
  });

  it('complianceLine follows the approval mode and the standards', () => {
    expect(complianceLine({ 'approval.mode': 'dual_actor' }, [])).toContain('No control gap');
    expect(complianceLine({ 'approval.mode': 'solo_with_gap' }, [])).toContain('SOC 2 CC8.1 and ISO 27001 A.8.32');
    expect(complianceLine({ 'approval.mode': 'solo_with_gap' }, ['soc-2'])).toContain('you need evidence for SOC 2 or ISO 27001');
  });
});

describe('the portal reads and writes', () => {
  const base = { baseUrl: 'https://devaudit.example.test', slug: 'fixture-app' };

  it('reads the policy, tells an absent field from a missing project, and never throws', async () => {
    expect(await readApprovalPolicy({ ...base, viewerKey: 'k', fetchImpl: portal(POLICY_SOLO).fetchImpl })).toEqual({ status: 'ok', policy: 'self_allowed_with_gap' });
    expect(await readApprovalPolicy({ ...base, viewerKey: 'k', fetchImpl: portal(POLICY_ABSENT).fetchImpl })).toEqual({ status: 'unsupported' });
    expect(await readApprovalPolicy({ ...base, viewerKey: 'k', fetchImpl: portal({ status: 404 }).fetchImpl })).toEqual({ status: 'unknown', reason: 'no-project' });
    expect(await readApprovalPolicy({ ...base, viewerKey: null })).toEqual({ status: 'unknown', reason: 'no-key' });
    const boom: FetchLike = async () => {
      throw new Error('network');
    };
    expect(await readApprovalPolicy({ ...base, viewerKey: 'k', fetchImpl: boom })).toEqual({ status: 'unknown', reason: 'unreachable' });
  });

  it('sends the viewer key as a bearer token on reads', async () => {
    const p = portal(POLICY_SOLO);
    await readApprovalPolicy({ ...base, viewerKey: 'secret-key', fetchImpl: p.fetchImpl });
    expect(p.calls[0]!.headers['Authorization']).toBe('Bearer secret-key');
    expect(p.calls[0]!.url).toBe('https://devaudit.example.test/api/ci/projects/fixture-app');
  });

  it('reads claimed standards, or says unavailable', async () => {
    expect(await readClaimedStandards({ ...base, viewerKey: 'k', fetchImpl: portal(POLICY_SOLO, { status: 200, body: { frameworks: [{ code: 'soc-2' }, { code: 'gdpr' }] } }).fetchImpl })).toEqual({ status: 'ok', codes: ['soc-2', 'gdpr'] });
    expect(await readClaimedStandards({ ...base, viewerKey: 'k', fetchImpl: portal(POLICY_SOLO, { status: 404 }).fetchImpl })).toEqual({ status: 'unavailable' });
  });

  it('writes with the personal token header, and treats 400/404/405 as "not available"', async () => {
    const p = portal({ status: 200 });
    expect(await setApprovalPolicy({ baseUrl: base.baseUrl, token: 'mctok_x', projectId: 'p1', fetchImpl: p.fetchImpl }, 'self_allowed_with_gap', 'because')).toEqual({ ok: true });
    expect(p.calls[0]!.method).toBe('PATCH');
    expect(p.calls[0]!.headers['x-devaudit-token']).toBe('mctok_x');
    expect(p.calls[0]!.url).toBe('https://devaudit.example.test/api/projects/p1/approval-policy');
    expect(JSON.parse(p.calls[0]!.body!)).toEqual({ approval_policy: 'self_allowed_with_gap', reason: 'because' });
    for (const status of [400, 404, 405]) {
      const r = await setApprovalPolicy({ baseUrl: base.baseUrl, token: 't', projectId: 'p1', fetchImpl: portal({ status }).fetchImpl }, 'independent', 'r');
      expect(r).toMatchObject({ ok: false, unavailable: true });
    }
    const forbidden = await setApprovalPolicy({ baseUrl: base.baseUrl, token: 't', projectId: 'p1', fetchImpl: portal({ status: 403 }).fetchImpl }, 'independent', 'r');
    expect(forbidden).toMatchObject({ ok: false, unavailable: false });
    expect(JSON.stringify(forbidden)).not.toContain('mctok');
  });
});

describe('applyOnboardingPortal', () => {
  const plan = (over: Partial<NonNullable<InstallPlan['onboarding']>>): InstallPlan => ({
    stack: 'node',
    host: 'railway',
    projectSlug: 'fixture-app',
    runtimeVersion: '20',
    sourceDirs: 'app/',
    workingDirectory: '.',
    prodUrlSecretName: 'X_PROD_URL',
    prodUrlValue: '',
    apiKeySecretName: 'DEVAUDIT_API_KEY',
    projectId: 'p1',
    onboarding: { preset: 'A', config: {}, removeKeys: [], policyToSet: 'self_allowed_with_gap', frameworks: [], portalStandards: null, ...over },
  });

  it('sets the policy when the portal accepts it', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node', approval: { mode: 'solo_with_gap' }, release_branch_required_reviews: 0, onboarding_preset: 'A' } });
    const p = portal({ status: 200 });
    const r = await applyOnboardingPortal(ctxFor(dir), plan({}), { fetchImpl: p.fetchImpl });
    expect(r.status).toBe('ok');
    expect(p.calls).toHaveLength(1);
    const written = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;
    expect(written['onboarding_preset']).toBe('A');
  });

  it('reverts a solo mode the portal would not accept, with one plain line', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node', approval: { mode: 'solo_with_gap', auto_low_risk_threshold: 'LOW' }, release_branch_required_reviews: 0, onboarding_preset: 'A' } });
    const r = await applyOnboardingPortal(ctxFor(dir), plan({}), { fetchImpl: portal({ status: 404 }).fetchImpl });
    expect(r.status).toBe('warn');
    expect(r.message).toContain('records preset custom');
    const written = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;
    expect(written['approval']).toEqual({ mode: 'dual_actor', auto_low_risk_threshold: 'LOW' });
    expect(written['release_branch_required_reviews']).toBeUndefined();
    expect(written['onboarding_preset']).toBe('custom');
  });

  it('does nothing in developer mode and nothing in a dry run', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node' } });
    const p = portal({ status: 200 });
    expect((await applyOnboardingPortal(ctxFor(dir, { installMode: 'developer' }), plan({}), { fetchImpl: p.fetchImpl })).status).toBe('skipped');
    expect((await applyOnboardingPortal(ctxFor(dir, { dryRun: true }), plan({}), { fetchImpl: p.fetchImpl })).status).toBe('planned');
    expect(p.calls).toEqual([]);
  });

  it('claims missing standards only after a confirmation, and says so when the portal cannot', async () => {
    const dir = await repo({ config: { project_slug: 'fixture-app', stack: 'node' } });
    const p = portal({ status: 200 }, { status: 200 });
    const yes = { confirm: async () => true };
    const r = await applyOnboardingPortal(ctxFor(dir), plan({ policyToSet: null, frameworks: ['soc-2', 'gdpr'], portalStandards: ['gdpr'] }), { fetchImpl: p.fetchImpl, ask: yes });
    expect(r.message).toContain('claimed soc-2 on the portal');
    expect(p.calls.map((c) => c.url)).toEqual(['https://devaudit.example.test/api/projects/p1/frameworks']);
    const none = await applyOnboardingPortal(ctxFor(dir), plan({ policyToSet: null, frameworks: ['soc-2'], portalStandards: null }), { fetchImpl: p.fetchImpl, ask: yes });
    expect(none.message).toContain('claiming them on the portal needs a portal that supports it');
    const declined = await applyOnboardingPortal(ctxFor(dir), plan({ policyToSet: null, frameworks: ['soc-2'], portalStandards: [] }), { fetchImpl: p.fetchImpl, ask: { confirm: async () => false } });
    expect(declined.message).toContain('standards not claimed on the portal');
  });
});

describe('the runner (#1164)', () => {
  it("a fresh install on GitHub's machines writes a runner label GitHub provides, not the logical name", async () => {
    const dir = await repo();
    const a = asker({ select: ['C', 'yes'] });
    const plan = await run(dir, a, portal(POLICY_INDEPENDENT));
    expect(plan.onboarding?.config['runner']).toBe('ubuntu-latest');
    expect(a.say.join('\n')).toContain("Tests and builds run on: GitHub's machines");
  });

  it("an existing ubuntu-latest is shown as GitHub's machines; self-hosted shows our own machines", async () => {
    const gh = asker({ select: ['C', 'yes'] });
    await run(await repo({ config: { project_slug: 'fixture-app', stack: 'node', runner: 'ubuntu-latest' } }), gh, portal(POLICY_INDEPENDENT));
    expect(gh.say.join('\n')).toContain("Tests and builds run on: GitHub's machines");
    const own = asker({ select: ['C', 'yes'] });
    await run(await repo({ config: { project_slug: 'fixture-app', stack: 'node', runner: 'self-hosted' } }), own, portal(POLICY_INDEPENDENT));
    expect(own.say.join('\n')).toContain('Tests and builds run on: our own machines');
  });
});
