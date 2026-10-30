import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS, PRESET_IDS } from '@metasession.co/devaudit-core';
import { doneReport, startingWithNoTestsLines } from '../src/install/done-report.js';
import type { InstallContext, InstallPlan } from '../src/install/types.js';

// DevAudit-Installer#1116 WP12 — the skills, templates and documents say the same thing about who
// approves (it follows approval.mode) and about starting with no tests.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): Promise<string> => fs.readFile(join(ROOT, rel), 'utf-8');

describe('approval follows approval.mode', () => {
  it('sdlc-implementer Phase 4 branches on dual_actor and solo_with_gap', async () => {
    const text = await read('sdlc/files/_common/skills/sdlc-implementer/SKILL.md');
    const step = text.slice(text.indexOf('2. **Check who approves, by `sdlc-config.json` `approval.mode`'));
    expect(step).toContain('`dual_actor`');
    expect(step).toContain('halt with a configuration error');
    expect(step).toContain('`solo_with_gap`');
    expect(step).toContain('do **not** halt, for any risk class');
    expect(step).toContain('## Sign-off (solo, recorded gap)');
    expect(step).toContain('signed off');
    expect(text).not.toContain('UAT four-eyes');
    expect(text).toContain('by you, with a recorded gap, under `solo_with_gap`');
  });

  it('the compliance constraint, the risk keeper, the templates and the script agree', async () => {
    const constraint = await read('sdlc/files/_common/skills/sdlc-implementer/references/compliance-constraints.md');
    expect(constraint).toContain('Under `approval.mode: dual_actor`');
    expect(constraint).toContain('Under `solo_with_gap`');
    const keeper = await read('sdlc/files/_common/skills/risk-register-keeper/SKILL.md');
    expect(keeper).toContain('portal reports `independent` while the repository says `solo_with_gap`');
    expect(keeper).toContain('`approval-policy`');
    for (const rel of ['sdlc/files/_common/governance/periodic-review.md.template', 'sdlc/files/ci/periodic-review.yml.template']) {
      const t = await read(rel);
      expect(t, rel).toContain('solo_with_gap');
      expect(t, rel).toContain('different person');
    }
    const script = await read('sdlc/files/_common/scripts/close-out-release.sh');
    expect(script).toContain('SIGN_OFF_KIND="solo, recorded gap"');
    expect(script).toContain('SIGN_OFF_KIND="dual-actor"');
    expect(script).toContain('**Sign-off (${SIGN_OFF_KIND}):**');
    expect(await read('sdlc/files/ci/check-release-approval.yml.template')).toContain('who may approve follows `approval.mode`');
  });

  it('no shipped template still says "UAT four-eyes" without the approval mode', async () => {
    for (const rel of ['sdlc/files/ci/compliance-evidence.yml.template', 'sdlc/files/_common/skills/sdlc-implementer/SKILL.md', 'docs/compliance-gates.md']) {
      expect(await read(rel), rel).not.toMatch(/UAT four-eyes(?! gate)/);
    }
  });
});

describe('Starting with no tests', () => {
  const order = (text: string): number[] => [text.indexOf('e2e-test-engineer'), text.indexOf('devaudit doctor'), text.indexOf('devaudit configure')];

  it('the skill and the onboarding guide name the skill, doctor and configure in that order', async () => {
    for (const [rel, heading] of [
      ['sdlc/files/_common/skills/devaudit-configure/SKILL.md', '## Starting with no tests'],
      ['docs/onboarding.md', '### Starting with no tests'],
    ] as const) {
      const text = await read(rel);
      const section = text.slice(text.indexOf(heading));
      const next = section.slice(heading.length).search(/\n#{2,3} /);
      const body = section.slice(0, next === -1 ? undefined : next + heading.length);
      const [a, b, c] = order(body);
      expect(a, rel).toBeGreaterThan(-1);
      expect(b, rel).toBeGreaterThan(a!);
      expect(c, rel).toBeGreaterThan(b!);
      expect(body, rel).toContain('preset A');
      expect(body, rel).toContain('`custom`');
    }
  });

  it('the closing lines appear only when no smoke tests were found, and name custom when A was not offered', () => {
    const ctx = { projectName: 'example-app', projectPath: '/x', installMode: 'operator', printViewerKey: false } as unknown as InstallContext;
    const plan = (onboarding?: InstallPlan['onboarding']): InstallPlan =>
      ({ projectSlug: 'example-app', ...(onboarding ? { onboarding } : {}) }) as unknown as InstallPlan;
    const base = { preset: 'A', config: {}, removeKeys: [], policyToSet: null, frameworks: [], portalStandards: null } as const;
    expect(doneReport(ctx, plan()).message).not.toContain('Starting with no tests');
    expect(doneReport(ctx, plan({ ...base })).message).not.toContain('Starting with no tests');
    const withA = doneReport(ctx, plan({ ...base, noSmokeTests: true, presetAOffered: true })).message!;
    expect(withA).toContain('Starting with no tests:');
    expect(withA).toContain('Finish on preset A');
    const withoutA = doneReport(ctx, plan({ ...base, preset: 'custom', noSmokeTests: true, presetAOffered: false })).message!;
    expect(withoutA).toContain('Finish on `custom` (preset A is not offered');
    const lines = startingWithNoTestsLines(true).join('\n');
    const [a, b, c] = order(lines);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a!);
    expect(c).toBeGreaterThan(b!);
  });

  it('the add-smoke-tests remediation says what comes next', async () => {
    const src = await read('cli/src/commands/doctor-tiers.ts');
    expect(src).toContain('then run `devaudit configure` to choose when the bigger groups run');
  });
});

describe('the preset-to-clause table', () => {
  it('matches the preset data', async () => {
    const text = await read('docs/governance-templates.md');
    for (const id of PRESET_IDS) {
      const row = text.split('\n').find((l) => l.startsWith(`| ${id} |`));
      expect(row, `row for ${id}`).toBeDefined();
      const controls = PRESETS[id].controls;
      if (controls.length === 0) expect(row).toContain('none from approval');
      else for (const c of controls) expect(row).toContain(`\`${c}\``);
      expect(row).toContain(PRESETS[id].config['approval.mode'] === 'solo_with_gap' ? 'solo_with_gap' : 'dual_actor');
    }
  });
});

describe('docs/e2e-test-tiers.md', () => {
  it('names the strictest combination as preset D', async () => {
    expect(await read('docs/e2e-test-tiers.md')).toContain('**Strictest (preset D):** `release_gate_tier: full` and `post_deploy_full_regression: false`');
  });
});
