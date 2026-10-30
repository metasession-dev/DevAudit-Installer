import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { PRESETS } from '@metasession.co/devaudit-core';
import { runConfigureGuided, NO_TERMINAL_MESSAGE } from '../src/commands/configure-guided.js';
import { setConfigPath } from '../src/lib/config-path.js';
import type { FetchLike } from '../src/lib/onboarding-portal.js';
import type { GuidedAsker } from '../src/install/guided.js';

// DevAudit-Installer#1116 WP7 — `devaudit configure` with no arguments: the guided questions with the
// current values as defaults, a before/after summary, and a write of only what changed.

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
beforeAll(() => {
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const PLAYWRIGHT = "export default { projects: [{ name: 'smoke' }, { name: 'critical' }, { name: 'regression' }] };\n";

/** A configuration as a preset (or custom) leaves it. */
function configFor(preset: 'A' | 'B' | 'C' | 'D' | 'custom', extra: Record<string, unknown> = {}): Record<string, unknown> {
  let cfg: Record<string, unknown> = {
    project_slug: 'example-app',
    stack: 'node',
    host: 'railway',
    node_version: '20',
    source_dirs: 'app/',
    working_directory: '.',
    production_url_secret: 'EXAMPLE_APP_PROD_URL',
    approval: { mode: 'dual_actor', auto_low_risk_threshold: 'LOW' },
    e2e_data_isolation: 'ephemeral',
    runner: 'github-ci',
  };
  if (preset !== 'custom') for (const [k, v] of Object.entries(PRESETS[preset].config)) cfg = setConfigPath(cfg, k, v);
  else cfg = setConfigPath(cfg, 'onboarding_preset', 'custom');
  for (const [k, v] of Object.entries(extra)) cfg = setConfigPath(cfg, k, v);
  return cfg;
}

async function repo(cfg: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-configure-guided-'));
  dirs.push(dir);
  await execa('git', ['init', '-q'], { cwd: dir });
  await fs.writeFile(join(dir, 'sdlc-config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  await fs.writeFile(join(dir, 'playwright.config.ts'), PLAYWRIGHT);
  return dir;
}

const read = async (dir: string): Promise<Record<string, unknown>> => JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;

function asker(script: { select?: string[]; confirm?: boolean[] } = {}) {
  const queues = { select: [...(script.select ?? [])], confirm: [...(script.confirm ?? [])] };
  const say: string[] = [];
  const dataAsked: string[] = [];
  const selects: Array<{ message: string; initial: string; values: string[] }> = [];
  const take = <T>(kind: 'select' | 'confirm', message: string): T => {
    const v = queues[kind].shift();
    if (v === undefined) throw new Error(`unexpected ${kind} prompt: ${message}`);
    return v as T;
  };
  const ask: GuidedAsker = {
    select: async (message, options, initial) => {
      if (message.startsWith('Where do the tests get their data?')) {
        dataAsked.push(message);
        return 'ephemeral';
      }
      selects.push({ message, initial, values: options.map((o) => o.value) });
      const a = take<string>('select', message);
      return a === '<default>' ? initial : a;
    },
    text: async () => {
      throw new Error('unexpected text prompt');
    },
    confirm: async (message) => take<boolean>('confirm', message),
    multiselect: async (_m, _o, initial) => [...initial],
  };
  return { ask, say, dataAsked, selects, sayFn: (l: string) => void say.push(l) };
}

function portal(policy: 'independent' | 'self_allowed_with_gap' | null): FetchLike {
  return async (url) => {
    const body = url.endsWith('/frameworks') ? null : policy === null ? { slug: 'example-app' } : { approval_policy: policy };
    const status = url.endsWith('/frameworks') ? 404 : 200;
    return { ok: status === 200, status, json: async () => body ?? {} };
  };
}

async function run(dir: string, a: ReturnType<typeof asker>, over: Partial<Parameters<typeof runConfigureGuided>[1]> = {}, json = false) {
  return runConfigureGuided({ json }, { ask: a.ask, say: a.sayFn, cwd: dir, fetchImpl: portal('independent'), viewerKey: 'k', terminalProblem: null, ...over });
}

describe('configure with no arguments', () => {
  it('without a terminal asks nothing, writes nothing and exits 8', async () => {
    const dir = await repo(configFor('C'));
    const before = await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8');
    const a = asker();
    expect(await run(dir, a, { terminalProblem: 'no TTY' })).toBe(8);
    expect(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')).toBe(before);
    expect(a.say).toEqual([]);
    expect(NO_TERMINAL_MESSAGE).toBe('`devaudit configure` without arguments asks questions; run it in a terminal, or use `devaudit configure set <key> <value>`.');
  });

  it('exits 1 when sdlc-config.json cannot be read', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-configure-guided-'));
    dirs.push(dir);
    await execa('git', ['init', '-q'], { cwd: dir });
    expect(await run(dir, asker())).toBe(1);
  });

  it('the project\'s current preset is the default, and no change means no write', async () => {
    const dir = await repo(configFor('C'));
    const before = await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8');
    const a = asker({ select: ['<default>', 'yes'] });
    expect(await run(dir, a)).toBe(0);
    expect(a.selects[0]!.initial).toBe('C');
    expect(a.say.join('\n')).toContain('Nothing to change');
    expect(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')).toBe(before);
  });

  it('C to D changes only post_deploy_full_regression (and the recorded preset)', async () => {
    const dir = await repo(configFor('C'));
    const a = asker({ select: ['D', 'yes'], confirm: [true] });
    expect(await run(dir, a)).toBe(0);
    const said = a.say.join('\n');
    expect(said).toContain('post_deploy_full_regression: true -> false');
    expect(said).toContain('onboarding_preset: "C" -> "D"');
    expect(said.match(/ -> /g)).toHaveLength(2);
    const after = await read(dir);
    expect(after['post_deploy_full_regression']).toBe(false);
    expect(after['onboarding_preset']).toBe('D');
    // D back to C
    const b = asker({ select: ['C', 'yes'], confirm: [true] });
    expect(await run(dir, b)).toBe(0);
    expect((await read(dir))['post_deploy_full_regression']).toBe(true);
  });

  it('C to A removes the keys A does not write, and sets the approval and review keys', async () => {
    const dir = await repo(configFor('C'));
    const policies: string[] = [];
    const a = asker({ select: ['A', 'yes'], confirm: [true, true] });
    const code = await run(dir, a, {
      setPolicy: async (policy) => {
        policies.push(policy);
        return { ok: true };
      },
    });
    expect(code).toBe(0);
    expect(policies).toEqual(['self_allowed_with_gap']);
    const after = await read(dir);
    for (const key of ['release_gate_tier', 'post_deploy_full_regression', 'scheduled_full_regression']) expect(after[key]).toBeUndefined();
    expect(after['e2e_regression_enabled']).toBe(false);
    expect(after['release_branch_required_reviews']).toBe(0);
    expect(after['approval']).toEqual({ mode: 'solo_with_gap', auto_low_risk_threshold: 'LOW' });
    expect(after['production_review']).toEqual({ terminal_status: 'released' });
    expect(after['onboarding_preset']).toBe('A');
    const said = a.say.join('\n');
    expect(said).toContain('release_gate_tier: "full" -> removed');
    expect(said).toContain('portal approval policy: independent -> self_allowed_with_gap');
    expect(said).toContain('devaudit update');
  });

  it('a repository with several targets sets the approval policy on every target project, in one confirmation', async () => {
    const targets = [
      { name: 'api', devaudit: { project_slug: 'example-app-api' } },
      { name: 'ui', devaudit: { project_slug: 'example-app-ui' } },
      { name: 'ui-copy', devaudit: { project_slug: 'example-app-ui' } },
    ];
    const dir = await repo(configFor('C', { targets }));
    const set: Array<[string, string | undefined]> = [];
    const a = asker({ select: ['A', 'yes'], confirm: [true, true] });
    const code = await run(dir, a, {
      setPolicy: async (policy, _reason, slug) => {
        set.push([policy, slug]);
        return { ok: true };
      },
    });
    expect(code).toBe(0);
    expect(set).toEqual([['self_allowed_with_gap', 'example-app-api'], ['self_allowed_with_gap', 'example-app-ui']]);
    expect(a.say.join('\n')).toContain('on each of these 2 projects, in this one confirmation: example-app-api, example-app-ui');
    expect((await read(dir))['onboarding_preset']).toBe('A');
  });

  it('when the policy cannot be set on one target, says which and keeps the approval settings as they were', async () => {
    const dir = await repo(configFor('C', { targets: [{ name: 'api', devaudit: { project_slug: 'example-app-api' } }, { name: 'ui', devaudit: { project_slug: 'example-app-ui' } }] }));
    const a = asker({ select: ['A', 'yes'], confirm: [true, true] });
    const code = await run(dir, a, { setPolicy: async (_p, _r, slug) => (slug === 'example-app-ui' ? { ok: false, unavailable: false, message: 'not a project admin' } : { ok: true }) });
    expect(code).toBe(0);
    const after = await read(dir);
    expect(after['onboarding_preset']).not.toBe('A');
    expect(after['approval']).toEqual(configFor('C')['approval']);
  });

  it('A to C writes the C values back', async () => {
    const dir = await repo(configFor('A', { approval: { mode: 'solo_with_gap', auto_low_risk_threshold: 'LOW' } }));
    const a = asker({ select: ['C', 'yes'], confirm: [true] });
    expect(await run(dir, a, { fetchImpl: portal('self_allowed_with_gap'), setPolicy: async () => ({ ok: true }) })).toBe(0);
    const after = await read(dir);
    expect(after['release_gate_tier']).toBe('full');
    expect(after['release_branch_required_reviews']).toBe(1);
    expect((after['approval'] as { mode: string }).mode).toBe('dual_actor');
    expect(after['onboarding_preset']).toBe('C');
  });

  it('custom to a preset shows every changed key before anything is written', async () => {
    const dir = await repo(configFor('custom', { release_gate_tier: 'smoke', e2e_regression_enabled: true }));
    const a = asker({ select: ['C', 'yes'], confirm: [true] });
    let seenBeforeConfirm = '';
    const ask: GuidedAsker = {
      ...a.ask,
      confirm: async (m) => {
        seenBeforeConfirm = a.say.join('\n');
        return a.ask.confirm(m, true);
      },
    };
    expect(await runConfigureGuided({ json: false }, { ask, say: a.sayFn, cwd: dir, fetchImpl: portal('independent'), viewerKey: 'k', terminalProblem: null })).toBe(0);
    expect(seenBeforeConfirm).toContain('These changes would be written to sdlc-config.json:');
    expect(seenBeforeConfirm).toContain('release_gate_tier: "smoke" -> "full"');
    expect(seenBeforeConfirm).toContain('onboarding_preset: "custom" -> "C"');
  });

  it('declining the confirmation writes nothing and exits 8', async () => {
    const dir = await repo(configFor('C'));
    const before = await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8');
    const a = asker({ select: ['D', 'yes'], confirm: [false] });
    expect(await run(dir, a)).toBe(8);
    expect(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')).toBe(before);
  });

  it('a portal that refuses the solo policy leaves the approval settings alone', async () => {
    const dir = await repo(configFor('C'));
    const a = asker({ select: ['A', 'yes'], confirm: [true, true] });
    const code = await run(dir, a, { setPolicy: async () => ({ ok: false, unavailable: true, message: 'the portal answered HTTP 404' }) });
    expect(code).toBe(0);
    const after = await read(dir);
    expect((after['approval'] as { mode: string }).mode).toBe('dual_actor');
    expect(after['release_branch_required_reviews']).toBe(1);
    expect(after['onboarding_preset']).toBe('C');
    // the rest of A was written
    expect(after['e2e_regression_enabled']).toBe(false);
  });

  it('preset A and B are not offered by a portal without an approval policy', async () => {
    const dir = await repo(configFor('C'));
    const a = asker({ select: ['<default>', 'yes'] });
    await run(dir, a, { fetchImpl: portal(null) });
    expect(a.selects[0]!.values).not.toContain('A');
    expect(a.selects[0]!.values).not.toContain('B');
  });

  it('moving to a test-running preset asks Q18 straight away when the data has no answer', async () => {
    const cfg = configFor('A', { approval: { mode: 'solo_with_gap', auto_low_risk_threshold: 'LOW' } });
    delete cfg['e2e_data_isolation'];
    const dir = await repo(cfg);
    const a = asker({ select: ['B', 'yes'], confirm: [true] });
    await run(dir, a, { fetchImpl: portal('self_allowed_with_gap'), setPolicy: async () => ({ ok: true }) });
    expect(a.dataAsked).toHaveLength(1);
    expect(a.say.join('\n')).toContain('e2e_data_isolation: (unset) -> "ephemeral"');
    expect((await read(dir))['e2e_data_isolation']).toBe('ephemeral');
  });
});
