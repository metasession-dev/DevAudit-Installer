import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { PRESETS, type Gap } from '@metasession.co/devaudit-core';
import { setConfigPath } from '../src/lib/config-path.js';
import { gapsFromCheck, CHECK_EXPLANATIONS, EXPLAINED_CHECKS } from '../src/lib/doctor-explain.js';
import { approvalPolicyCheck, durationsCheck, presetDriftCheck, standardsFitCheck } from '../src/commands/doctor-onboarding.js';
import { orderGaps, renderExplanation, runExplain, runGuided, type GuidedDeps } from '../src/commands/doctor-guided.js';
import type { GhRunner } from '../src/lib/deploy-detect.js';
import type { Proposal } from '../src/lib/doctor-types.js';

// DevAudit-Installer#1116 WP8 — the preset-drift, standards-fit, approval-policy and durations checks,
// `doctor --explain` and `doctor --guided`.

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'devaudit.js');
const INSTALLER_ROOT = resolve(HERE, '..', '..');

beforeAll(() => {
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function configFor(preset: 'A' | 'B' | 'C' | 'D', extra: Record<string, unknown> = {}): Record<string, unknown> {
  let cfg: Record<string, unknown> = { project_slug: 'example-app', stack: 'node', host: 'railway', approval: { mode: 'dual_actor', auto_low_risk_threshold: 'LOW' } };
  for (const [k, v] of Object.entries(PRESETS[preset].config)) cfg = setConfigPath(cfg, k, v);
  for (const [k, v] of Object.entries(extra)) cfg = setConfigPath(cfg, k, v);
  return cfg;
}

const ALL_TESTS = { smoke: true, critical: true, full: true };

describe('preset-drift', () => {
  it('is silent without a recorded preset, and for custom (decision 12)', () => {
    expect(presetDriftCheck({ project_slug: 'x' }, ALL_TESTS)).toMatchObject({ name: 'preset-drift', ok: true });
    expect(presetDriftCheck({ onboarding_preset: 'custom', release_gate_tier: 'smoke' }, ALL_TESTS).ok).toBe(true);
  });

  it('passes when the configuration is exactly the preset', () => {
    for (const id of ['A', 'B', 'C', 'D'] as const) expect(presetDriftCheck(configFor(id), ALL_TESTS).ok, id).toBe(true);
  });

  it('for preset D, post_deploy_full_regression true is drift and C is named as the closest preset', () => {
    const r = presetDriftCheck(configFor('D', { post_deploy_full_regression: true }), ALL_TESTS);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('Closest preset: C');
    const finding = r.findings!.find((f) => f.subject === 'post_deploy_full_regression')!;
    expect(finding.remediation).toMatchObject({ id: 'set-config', tier: 'A', data: { key: 'post_deploy_full_regression', value: 'false' } });
    // and a way to record the difference as deliberate
    expect(r.findings!.some((f) => f.remediation?.data?.['value'] === 'custom')).toBe(true);
  });

  it('reports keys another preset wrote and this one does not, and a gated tier with no tests', () => {
    const r = presetDriftCheck(configFor('A', { release_gate_tier: 'full' }), ALL_TESTS);
    expect(r.ok).toBe(false);
    expect(r.findings!.find((f) => f.subject === 'release_gate_tier')!.remediation).toBeUndefined();
    const noTests = presetDriftCheck(configFor('C'), { smoke: true, critical: false, full: false });
    expect(noTests.ok).toBe(false);
    expect(noTests.findings!.some((f) => f.detail.includes('no full tests were found'))).toBe(true);
  });
});

describe('standards-fit', () => {
  it('names the clauses with a recorded gap when SOC 2 is needed and the author approves', () => {
    const r = standardsFitCheck(configFor('A', { compliance_frameworks: ['soc-2'] }), null);
    expect(r.ok).toBe(false);
    expect(r.findings![0]!.detail).toContain('SOC2.CC8.1');
    expect(r.findings![0]!.detail).toContain('ISO27001.A.8.32');
  });

  it('passes with a different approver, and with no standards', () => {
    expect(standardsFitCheck(configFor('C', { compliance_frameworks: ['soc-2'] }), null).ok).toBe(true);
    expect(standardsFitCheck(configFor('A'), null)).toMatchObject({ ok: true, detail: 'no standards recorded' });
  });

  it('compares the configuration with what the portal says the project claims', () => {
    const r = standardsFitCheck(configFor('C', { compliance_frameworks: ['soc-2', 'gdpr'] }), ['soc-2', 'iso-27001']);
    expect(r.ok).toBe(false);
    expect(r.findings!.map((f) => f.detail).join(' ')).toContain('gdpr');
    expect(r.findings!.map((f) => f.detail).join(' ')).toContain('iso-27001');
  });
});

describe('approval-policy', () => {
  it('compares approval.mode with the portal policy', () => {
    expect(approvalPolicyCheck(configFor('C'), { status: 'ok', policy: 'independent' }).ok).toBe(true);
    expect(approvalPolicyCheck(configFor('A'), { status: 'ok', policy: 'self_allowed_with_gap' }).ok).toBe(true);
    const solo = approvalPolicyCheck(configFor('A'), { status: 'ok', policy: 'independent' });
    expect(solo.ok).toBe(false);
    expect(solo.detail).toContain('cannot approve their own release');
    const dual = approvalPolicyCheck(configFor('C'), { status: 'ok', policy: 'self_allowed_with_gap' });
    expect(dual.ok).toBe(false);
  });

  it('does not fail when the portal does not report a policy or cannot be read', () => {
    expect(approvalPolicyCheck(configFor('A'), { status: 'unsupported' }).ok).toBe(true);
    expect(approvalPolicyCheck(configFor('A'), { status: 'unknown', reason: 'no-key' }).ok).toBe(true);
  });
});

describe('durations', () => {
  it('reports the median job duration of the last successful runs', async () => {
    const jobs = (start: string, end: string) => JSON.stringify({ jobs: [{ name: 'Quality Gates', startedAt: start, completedAt: end, conclusion: 'success' }] });
    const gh: GhRunner = async (args) => {
      if (args[0] === 'run' && args[1] === 'list') return { exitCode: 0, stdout: args.includes('ci.yml') ? JSON.stringify([{ databaseId: 1 }, { databaseId: 2 }, { databaseId: 3 }]) : '[]' };
      const id = args[2];
      const mins = id === '1' ? 2 : id === '2' ? 4 : 10;
      return { exitCode: 0, stdout: jobs('2026-01-01T00:00:00Z', `2026-01-01T00:${String(mins).padStart(2, '0')}:00Z`) };
    };
    const r = await durationsCheck('/tmp', gh);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('ci.yml: Quality Gates 4m');
  });

  it('says "not measured yet" without gh or runs', async () => {
    const r = await durationsCheck('/tmp', async () => ({ exitCode: 1, stdout: '' }));
    expect(r).toMatchObject({ name: 'durations', ok: true });
    expect(r.detail).toContain('not measured yet');
  });
});

describe('--explain', () => {
  it('has an explanation for every new check and prints why, the options and the consequence', () => {
    for (const name of ['preset-drift', 'standards-fit', 'approval-policy', 'durations']) expect(EXPLAINED_CHECKS).toContain(name);
    for (const name of EXPLAINED_CHECKS) {
      const text = renderExplanation(name)!;
      expect(text, name).toContain('Why it matters:');
      expect(text, name).toContain(CHECK_EXPLANATIONS[name]!.guidance);
      expect(text, name).toContain('leave it as it is');
    }
  });

  it('refuses an unknown check with the list (exit 2)', () => {
    expect(renderExplanation('nope')).toBeNull();
    expect(runExplain('nope', () => undefined)).toBe(2);
    const lines: string[] = [];
    expect(runExplain('srs', (l) => lines.push(l))).toBe(0);
    expect(lines.join('\n')).toContain('srs:');
  });
});

// ---- --guided -------------------------------------------------------------------------------------------

async function repo(cfg: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-doctor-guided-'));
  dirs.push(dir);
  await execa('git', ['init', '-q'], { cwd: dir });
  await fs.writeFile(join(dir, 'sdlc-config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  return dir;
}

const readCfg = async (dir: string): Promise<Record<string, unknown>> => JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;

/** Scripted prompts: select answers by queue, confirm answers by queue. */
function prompts(script: { select?: Array<string | null>; confirm?: Array<boolean | null> }, reason: string | null = null) {
  const selects = [...(script.select ?? [])];
  const confirms = [...(script.confirm ?? [])];
  const asked: string[] = [];
  const ask = {
    nonInteractiveReason: () => reason,
    select: async (q: string) => {
      asked.push(q);
      const v = selects.shift();
      if (v === undefined) throw new Error(`unexpected select: ${q}`);
      return v;
    },
    confirm: async (q: string) => {
      asked.push(q);
      const v = confirms.shift();
      if (v === undefined) throw new Error(`unexpected confirm: ${q}`);
      return v;
    },
    input: async (q: string) => {
      throw new Error(`unexpected input: ${q}`);
    },
  };
  return { ask, asked };
}

function driftDeps(dir: string, p: ReturnType<typeof prompts>, extra: Partial<GuidedDeps> = {}) {
  const lines: string[] = [];
  const collects: number[] = [];
  const deps: GuidedDeps = {
    ask: p.ask,
    say: (l) => void lines.push(l),
    fixDeps: { repoRoot: dir, baseUrl: '', ask: p.ask },
    collect: async () => {
      collects.push(1);
      const cfg = await readCfg(dir);
      const check = presetDriftCheck(cfg, ALL_TESTS);
      const proposals: Proposal[] = (check.findings ?? []).flatMap((f) => (f.remediation ? [{ check: check.name, subject: f.subject, detail: f.detail, remediation: f.remediation }] : []));
      return { gaps: gapsFromCheck(check), proposals };
    },
    ...extra,
  };
  return { deps, lines, collects };
}

describe('--guided', () => {
  it.each([
    ['no TTY', 'no TTY'],
    ['CI set', 'CI is set'],
    ['--json', '--json never prompts'],
  ])('with %s it prompts for nothing, changes nothing and exits 8', async (_label, reason) => {
    const dir = await repo(configFor('D', { post_deploy_full_regression: true }));
    const before = await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8');
    const p = prompts({}, reason);
    const { deps, collects } = driftDeps(dir, p);
    const r = await runGuided(undefined, deps);
    expect(r.exitCode).toBe(8);
    expect(p.asked).toEqual([]);
    expect(collects).toEqual([]);
    expect(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')).toBe(before);
  });

  it('with no gaps it says so and exits 0', async () => {
    const dir = await repo(configFor('C'));
    const { deps, lines } = driftDeps(dir, prompts({}));
    expect((await runGuided(undefined, deps)).exitCode).toBe(0);
    expect(lines.join('\n')).toContain('No gaps');
  });

  it('"leave as is" records nothing, and "stop" leaves the rest; both exit 0 with a summary', async () => {
    const dir = await repo(configFor('D', { post_deploy_full_regression: true, scheduled_full_regression: '0 4 * * *' }));
    const before = await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8');
    const p = prompts({ select: ['leave', 'stop'] });
    const { deps, lines } = driftDeps(dir, p);
    const r = await runGuided(undefined, deps);
    expect(r.exitCode).toBe(0);
    expect(r.applied).toEqual([]);
    expect(r.left.length).toBeGreaterThanOrEqual(2);
    expect(lines.join('\n')).toMatch(/Summary: 0 fixed, \d+ left as they are/);
    expect(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')).toBe(before);
    // the next run reports the same gaps again
    const again = await driftDeps(dir, prompts({})).deps.collect();
    expect(again.gaps.length).toBeGreaterThanOrEqual(2);
  });

  it('applies a fix after a confirmation, re-runs the check and shows the gap closed', async () => {
    const dir = await repo(configFor('D', { post_deploy_full_regression: true }));
    // gaps: the key, and "record as custom"
    const p = prompts({ select: ['option:0', 'leave'], confirm: [true] });
    const { deps, lines, collects } = driftDeps(dir, p);
    const r = await runGuided(undefined, deps);
    expect((await readCfg(dir))['post_deploy_full_regression']).toBe(false);
    expect(r.applied).toHaveLength(1);
    expect(collects.length).toBe(2); // the first look and the re-check
    expect(lines.join('\n')).toContain('this gap is closed');
    expect(r.exitCode).toBe(0);
  });

  it('a declined fix is not applied and exits 8', async () => {
    const dir = await repo(configFor('D', { post_deploy_full_regression: true }));
    const before = await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8');
    const p = prompts({ select: ['option:0', 'stop'], confirm: [false] });
    const r = await runGuided(undefined, driftDeps(dir, p).deps);
    expect(r.exitCode).toBe(8);
    expect(r.failed).toHaveLength(1);
    expect(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')).toBe(before);
  });

  it('a fix that does not clear the gap is reported as such and stays in the remaining list', async () => {
    const dir = await repo(configFor('D', { post_deploy_full_regression: true }));
    const stuck = await driftDeps(dir, prompts({})).deps.collect();
    const p = prompts({ select: ['option:0', 'stop'], confirm: [true] });
    const { deps, lines } = driftDeps(dir, p, { collect: async () => stuck });
    const r = await runGuided(undefined, deps);
    expect(lines.join('\n')).toContain('still open');
    expect(r.applied).toEqual([]);
    expect(r.remaining.length).toBeGreaterThan(0);
    expect(r.exitCode).toBe(0);
  });

  it('tier B is refused without an interactive terminal and is not satisfied by anything the guided mode passes', async () => {
    const dir = await repo(configFor('C'));
    const tierB: Gap = {
      id: 'doctor:deferred-portal-sync:REQ-1',
      source: 'doctor',
      check: 'deferred-portal-sync',
      subject: 'REQ-1',
      title: 'A release is deferred in the ticket but not on the portal',
      why: 'The portal and the ticket disagree about this release.',
      controls: [],
      options: [
        {
          id: 'defer-on-portal',
          label: 'Defer it on the portal',
          tier: 'B',
          consequence: 'Changes state on the DevAudit portal.',
          remediation: { id: 'defer-on-portal', tier: 'B', summary: 'Defer it on the portal', plan: ['defer'], needsPortal: true, data: { version: 'REQ-1' } },
        },
      ],
    };
    const guidedAsk = prompts({ select: ['option:0'] });
    // the fix code sees a terminal that cannot prompt (as in CI): tier B stays unapplied
    const fixAsk = prompts({}, 'no TTY');
    const r = await runGuided(undefined, {
      ask: guidedAsk.ask,
      say: () => undefined,
      fixDeps: { repoRoot: dir, baseUrl: '', ask: fixAsk.ask },
      collect: async () => ({ gaps: [tierB] }),
    });
    expect(r.exitCode).toBe(8);
    expect(r.failed).toEqual([tierB.id]);
    expect(fixAsk.asked).toEqual([]);
  });

  it('scopes to one check, refuses an unknown one, and orders compliance gaps first', async () => {
    const dir = await repo(configFor('D', { post_deploy_full_regression: true }));
    const p = prompts({});
    const unknown = await runGuided('nope', driftDeps(dir, p).deps);
    expect(unknown.exitCode).toBe(2);
    const other = await runGuided('srs', driftDeps(dir, p).deps);
    expect(other.exitCode).toBe(0); // no gaps for srs
    const mk = (id: string, controls: string[], tier: 'A' | 'C'): Gap => ({
      id,
      source: 'doctor',
      check: id,
      subject: id,
      title: id,
      why: 'x'.repeat(40),
      controls,
      options: [{ id: 'o', label: 'o', tier, consequence: 'c' }],
    });
    const ordered = orderGaps([mk('guidance', [], 'C'), mk('fixable', [], 'A'), mk('one', ['A'], 'C'), mk('two', ['A', 'B'], 'A')]);
    expect(ordered.map((g) => g.id)).toEqual(['two', 'one', 'fixable', 'guidance']);
  });
});

describe('the command line', () => {
  async function cli(args: string[], env: Record<string, string> = {}) {
    const home = await fs.mkdtemp(join(tmpdir(), 'cli-doctor-guided-home-'));
    dirs.push(home);
    return execa('node', [BIN, ...args], {
      reject: false,
      env: { HOME: home, USERPROFILE: home, DEVAUDIT_INSTALLER_ROOT: INSTALLER_ROOT, CI: '', ...env },
      extendEnv: true,
    });
  }

  it.each([['--fix'], ['--fleet'], ['--yes']])('--guided combined with %s is refused with exit 2', async (flag) => {
    const r = await cli(['doctor', '--guided', flag]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--guided');
  });

  it('--guided without a terminal changes nothing and exits 8', async () => {
    const r = await cli(['doctor', '--guided']);
    expect(r.exitCode).toBe(8);
    expect(r.stderr).toContain('needs a terminal');
  });

  it('--explain prints the explanation; an unknown check exits 2', async () => {
    const ok = await cli(['doctor', '--explain', 'preset-drift']);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain('Why it matters:');
    expect((await cli(['doctor', '--explain', 'nope'])).exitCode).toBe(2);
  });
});
