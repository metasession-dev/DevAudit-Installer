import { describe, it, expect, afterEach } from 'vitest';
import { execa } from 'execa';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Gap } from '@metasession.co/devaudit-core';
import { CHECK_EXPLANATIONS, EXPLAINED_CHECKS, gapsFromCheck, gapsFromChecks, gapsFromCloseout } from '../src/lib/doctor-explain.js';
import type { CheckResult } from '../src/lib/doctor-types.js';

// DevAudit-Installer#1116 WP4 — `doctor --json` gains an additive `gaps` array: every non-ok check as
// gaps with a plain-language reason and at least one option.

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', 'src');
const BIN = resolve(HERE, '..', 'bin', 'devaudit.js');

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('the explanation table', () => {
  it('has a complete entry for every check name doctor can emit', async () => {
    const files = ['commands/doctor.ts', 'commands/doctor-config.ts', 'commands/doctor-tiers.ts', 'commands/doctor-deferral.ts', 'lib/credentials-check.ts'];
    const found = new Set<string>();
    for (const file of files) {
      const text = await fs.readFile(join(SRC, file), 'utf-8');
      for (const m of text.matchAll(/\bconst name = '([a-z0-9-]+)'/g)) found.add(m[1]!);
      for (const m of text.matchAll(/\{\s*name: '([a-z0-9-]+)',\s*ok:/g)) found.add(m[1]!);
      for (const m of text.matchAll(/checkCommand\('([a-z0-9-]+)'/g)) found.add(m[1]!);
    }
    found.add('node'); // checkNodeVersion builds its own result
    expect([...found].sort().length).toBeGreaterThanOrEqual(30);
    const missing = [...found].filter((name) => !(name in CHECK_EXPLANATIONS)).sort();
    expect(missing, 'add an explanation to CHECK_EXPLANATIONS for a new doctor check').toEqual([]);
  });

  it('every entry has a title, a reason and guidance that say something', () => {
    for (const name of EXPLAINED_CHECKS) {
      const e = CHECK_EXPLANATIONS[name]!;
      expect(e.title.trim().length, `${name} title`).toBeGreaterThan(8);
      expect(e.why.trim().length, `${name} why`).toBeGreaterThan(30);
      expect(e.guidance.trim().length, `${name} guidance`).toBeGreaterThan(20);
    }
  });
});

describe('gapsFromCheck', () => {
  const ok: CheckResult = { name: 'srs', ok: true, detail: 'docs/SRS.md present' };

  it('an ok check has no gap', () => {
    expect(gapsFromCheck(ok)).toEqual([]);
    expect(gapsFromChecks([ok, { ...ok, name: 'rtm' }])).toEqual([]);
  });

  it('a failing check without findings is one gap with guidance', () => {
    const gaps = gapsFromCheck({ name: 'srs', ok: false, detail: 'docs/SRS.md is missing' });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ id: 'doctor:srs:srs', source: 'doctor', check: 'srs', subject: 'srs' });
    expect(gaps[0]!.title).toBe(CHECK_EXPLANATIONS['srs']!.title);
    expect(gaps[0]!.why).toBe(CHECK_EXPLANATIONS['srs']!.why);
    expect(gaps[0]!.options.map((o) => o.id)).toEqual(['guidance']);
  });

  it('a failing check with findings is one gap per finding, each keeping its own repair', () => {
    const repair = (id: string) => ({ id, tier: 'A' as const, summary: `fix ${id}`, plan: ['x'], needsPortal: false });
    const gaps = gapsFromCheck({
      name: 'deferred-portal-sync',
      ok: false,
      detail: 'two releases',
      findings: [
        { subject: 'REQ-001', detail: 'd1', remediation: repair('r1') },
        { subject: 'REQ-002', detail: 'd2' },
      ],
    });
    expect(gaps.map((g) => g.id)).toEqual(['doctor:deferred-portal-sync:REQ-001', 'doctor:deferred-portal-sync:REQ-002']);
    expect(gaps[0]!.options[0]).toMatchObject({ id: 'r1', tier: 'A', label: 'fix r1' });
    expect(gaps[1]!.options[0]).toMatchObject({ id: 'guidance', tier: 'C' });
  });

  it('a check this table does not know still gets a reason and an option from its own text', () => {
    const gaps = gapsFromCheck({ name: 'brand-new-check', ok: false, detail: 'it is broken' });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.why).toBe('it is broken');
    expect(gaps[0]!.options).toHaveLength(1);
  });

  it('the close-out check is one gap per release that is still pending locally', () => {
    const closeout: CheckResult = { name: 'releases', ok: false, detail: 'two drifted' };
    const repair = (req: string) => ({ id: 'close-out-release', tier: 'C' as const, summary: `Close out ${req} locally`, plan: [`./scripts/close-out-release.sh ${req}`], needsPortal: false });
    const gaps = gapsFromCloseout(closeout, [
      { subject: 'REQ-1', detail: 'd', remediation: repair('REQ-1') },
      { subject: 'REQ-2', detail: 'd', remediation: repair('REQ-2') },
    ]);
    expect(gaps.map((g) => g.subject)).toEqual(['REQ-1', 'REQ-2']);
    expect(gaps[1]!.options[0]!.remediation?.plan).toEqual(['./scripts/close-out-release.sh REQ-2']);
    expect(gapsFromCloseout({ ...closeout, ok: true }, [])).toEqual([]);
    expect(gapsFromCloseout(closeout, [])).toHaveLength(1); // not ok, nothing listed: the check as a whole
  });
});

describe('devaudit doctor --json', () => {
  it('lists the gaps of a fresh consumer next to the existing keys, each with a reason and an option', async () => {
    const repo = await fs.mkdtemp(join(tmpdir(), 'cli-doctor-gaps-'));
    dirs.push(repo);
    await fs.writeFile(join(repo, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture', stack: 'node' }));
    const result = await execa('node', [BIN, '--json', 'doctor'], { cwd: repo, reject: false });
    const json = JSON.parse(result.stdout) as {
      ok: boolean;
      tools: { name: string; ok: boolean }[];
      releaseCloseoutDrift: { name: string; ok: boolean };
      onboarding: { name: string; ok: boolean }[];
      deferral: { name: string; ok: boolean }[];
      proposals: { check: string; subject: string; remediation: { id: string } }[];
      gaps: Gap[];
    };

    // The keys that were there are still there.
    for (const key of ['ok', 'tools', 'releaseCloseoutDrift', 'onboarding', 'deferral', 'proposals']) expect(json, key).toHaveProperty(key);
    expect(Array.isArray(json.gaps)).toBe(true);
    expect(json.gaps.length).toBeGreaterThan(0);

    // Every gap has what the guided mode needs.
    const ids = new Set<string>();
    for (const gap of json.gaps) {
      expect(gap.source).toBe('doctor');
      expect(gap.title.trim(), gap.id).not.toBe('');
      expect(gap.why.trim(), gap.id).not.toBe('');
      expect(gap.options.length, gap.id).toBeGreaterThan(0);
      expect(Array.isArray(gap.controls)).toBe(true);
      for (const option of gap.options) {
        expect(['A', 'B', 'C']).toContain(option.tier);
        expect(option.consequence.trim(), gap.id).not.toBe('');
      }
      expect(ids.has(gap.id), `duplicate gap id ${gap.id}`).toBe(false);
      ids.add(gap.id);
    }

    // Every check that is not ok has at least one gap.
    const failing = [
      ...json.tools.filter((c) => !c.ok),
      ...(json.releaseCloseoutDrift.ok ? [] : [json.releaseCloseoutDrift]),
      ...json.onboarding.filter((c) => !c.ok),
      ...json.deferral.filter((c) => !c.ok),
    ];
    for (const check of failing) expect(json.gaps.some((g) => g.check === check.name), `a gap for ${check.name}`).toBe(true);
    // A fresh consumer has no SRS and no RTM, so those are among them.
    expect(json.gaps.some((g) => g.check === 'srs')).toBe(true);
    expect(json.gaps.some((g) => g.check === 'rtm')).toBe(true);

    // Every proposal appears as a gap option carrying the same repair.
    for (const proposal of json.proposals) {
      const gap = json.gaps.find((g) => g.check === proposal.check && g.subject === proposal.subject);
      expect(gap, `a gap for the ${proposal.check} proposal ${proposal.subject}`).toBeDefined();
      expect(gap!.options.some((o) => o.remediation?.id === proposal.remediation.id)).toBe(true);
    }
  }, 120_000);

  it('plain doctor prints no gap data (the text output is unchanged)', async () => {
    const repo = await fs.mkdtemp(join(tmpdir(), 'cli-doctor-gaps-text-'));
    dirs.push(repo);
    await fs.writeFile(join(repo, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture', stack: 'node' }));
    const result = await execa('node', [BIN, 'doctor'], { cwd: repo, reject: false });
    const text = result.stdout + result.stderr;
    expect(text).not.toContain('"gaps"');
    expect(text).not.toContain('doctor:srs:srs');
    expect(text).toContain('srs');
  }, 120_000);
});
