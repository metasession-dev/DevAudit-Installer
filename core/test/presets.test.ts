import { describe, expect, it } from 'vitest';
import {
  MOMENTS,
  PRESETS,
  PRESET_CONFIG_KEYS,
  PRESET_IDS,
  SECOND_ADMIN_NOTE,
  SELF_APPROVAL_CLAUSES,
  SOLO_APPROVER_NOTE,
  offerPresets,
  renderPresetsMarkdown,
  suggestPreset,
  type TestGroups,
} from '../src/index.js';

const groups = (g: Partial<TestGroups> = {}): TestGroups => ({ smoke: false, critical: false, full: false, ...g });

describe('the preset data (section 4)', () => {
  it('has four presets, in order', () => {
    expect(PRESET_IDS).toEqual(['A', 'B', 'C', 'D']);
    expect(Object.keys(PRESETS)).toEqual(['A', 'B', 'C', 'D']);
    for (const id of PRESET_IDS) expect(PRESETS[id].id).toBe(id);
  });

  it('writes exactly the configuration of the section 4 table', () => {
    expect(PRESETS.A.config).toEqual({
      onboarding_preset: 'A',
      e2e_regression_enabled: false,
      'approval.mode': 'solo_with_gap',
      release_branch_required_reviews: 0,
      'production_review.terminal_status': 'released',
    });
    expect(PRESETS.B.config).toEqual({
      onboarding_preset: 'B',
      e2e_regression_enabled: true,
      release_gate_tier: 'critical',
      post_deploy_full_regression: true,
      scheduled_full_regression: '0 2 * * *',
      'approval.mode': 'solo_with_gap',
      release_branch_required_reviews: 0,
      'production_review.terminal_status': 'prod_review',
    });
    expect(PRESETS.C.config).toEqual({
      onboarding_preset: 'C',
      e2e_regression_enabled: true,
      release_gate_tier: 'full',
      post_deploy_full_regression: true,
      scheduled_full_regression: '0 2 * * *',
      'approval.mode': 'dual_actor',
      release_branch_required_reviews: 1,
      'production_review.terminal_status': 'prod_review',
    });
    expect(PRESETS.D.config).toEqual({ ...PRESETS.C.config, onboarding_preset: 'D', post_deploy_full_regression: false });
  });

  it('D is C without the full regression after deploy, and nothing else', () => {
    const { onboarding_preset: _c, post_deploy_full_regression: cPost, ...c } = PRESETS.C.config;
    const { onboarding_preset: _d, post_deploy_full_regression: dPost, ...d } = PRESETS.D.config;
    expect(d).toEqual(c);
    expect(cPost).toBe(true);
    expect(dPost).toBe(false); // written explicitly, so switching C to D changes only this key
    expect(PRESETS.D.portalPolicy).toBe(PRESETS.C.portalPolicy);
    expect(PRESETS.D.requires).toEqual(PRESETS.C.requires);
  });

  it('A does not write the release gate keys; the keys any preset writes are known', () => {
    for (const key of ['release_gate_tier', 'post_deploy_full_regression', 'scheduled_full_regression']) {
      expect(key in PRESETS.A.config).toBe(false);
      expect(PRESET_CONFIG_KEYS).toContain(key);
    }
    expect(PRESET_CONFIG_KEYS).toHaveLength(new Set(PRESET_CONFIG_KEYS).size);
  });

  it('a preset with dual_actor has the independent portal policy, and the reverse', () => {
    for (const id of PRESET_IDS) {
      const p = PRESETS[id];
      expect(p.config['approval.mode'] === 'dual_actor', id).toBe(p.portalPolicy === 'independent');
    }
  });

  it('the review count follows the approval mode: 0 for a solo approver, 1 for a different person', () => {
    for (const id of PRESET_IDS) {
      expect(PRESETS[id].config['release_branch_required_reviews'], id).toBe(PRESETS[id].config['approval.mode'] === 'dual_actor' ? 1 : 0);
    }
  });

  it('only preset A completes production review automatically', () => {
    expect(PRESETS.A.config['production_review.terminal_status']).toBe('released');
    for (const id of ['B', 'C', 'D'] as const) expect(PRESETS[id].config['production_review.terminal_status']).toBe('prod_review');
  });

  it('records the self-approval gap for the presets whose policy is self_allowed_with_gap, and for no other', () => {
    for (const id of PRESET_IDS) {
      const p = PRESETS[id];
      expect(p.controls, id).toEqual(p.portalPolicy === 'self_allowed_with_gap' ? [...SELF_APPROVAL_CLAUSES] : []);
    }
    expect([...SELF_APPROVAL_CLAUSES]).toEqual(['SOC2.CC8.1', 'ISO27001.A.8.32']);
  });

  it('describes what runs at each of the five moments, and carries evidence, a gap and its sentence', () => {
    expect(MOMENTS.map((m) => m.n)).toEqual([1, 2, 3, 4, 5]);
    for (const id of PRESET_IDS) {
      const p = PRESETS[id];
      expect(p.moments).toHaveLength(5);
      for (const text of p.moments) expect(text.trim().length).toBeGreaterThan(10);
      expect(p.name.trim().length, id).toBeGreaterThan(5);
      for (const text of [p.summary, p.evidence, p.gap, p.gapText]) expect(text.trim().length, id).toBeGreaterThan(10);
    }
    expect(PRESETS.A.gapText).toMatch(/You approve your own releases/);
    expect(PRESETS.D.gapText).toMatch(/DevAudit does not run it again after the deploy/);
    expect(PRESETS.D.moments[3]).toMatch(/No full regression after deploy/);
    expect(PRESETS.B.moments[2]).toMatch(/smoke if there are no critical tests/);
  });

  it('keeps the word "compliant" out of every text (reports measure evidence readiness)', () => {
    // The one place the word may appear is the sentence that says reports never use it.
    const all = (JSON.stringify(PRESETS) + renderPresetsMarkdown()).replace('they never say a project is compliant', '');
    expect(all).not.toMatch(/\bcompliant\b|\bcertified\b/i);
  });
});

describe('which presets are offered', () => {
  it('A needs a portal that allows a solo approver', () => {
    expect(offerPresets({ testGroups: groups(), soloApprover: 'yes' }).A).toEqual({ offered: true });
    expect(offerPresets({ testGroups: groups(), soloApprover: 'no' }).A).toEqual({
      offered: false,
      reason: 'this portal does not yet allow a solo approver; ask its operator to upgrade',
    });
    expect(offerPresets({ testGroups: groups(), soloApprover: 'unknown' }).A).toEqual({ offered: true, note: SOLO_APPROVER_NOTE });
  });

  it('B needs the same plus smoke tests', () => {
    expect(offerPresets({ testGroups: groups({ smoke: true }), soloApprover: 'yes' }).B.offered).toBe(true);
    expect(offerPresets({ testGroups: groups(), soloApprover: 'yes' }).B).toEqual({ offered: false, reason: 'it needs smoke tests and none were found' });
    expect(offerPresets({ testGroups: groups({ smoke: true }), soloApprover: 'no' }).B.offered).toBe(false);
    expect(offerPresets({ testGroups: groups({ smoke: true }), soloApprover: 'unknown' }).B.note).toBe(SOLO_APPROVER_NOTE);
  });

  it('C and D need a full pack, are shown with the second-admin note, and do not need the solo approver', () => {
    for (const id of ['C', 'D'] as const) {
      expect(offerPresets({ testGroups: groups({ full: true }), soloApprover: 'no' })[id]).toEqual({ offered: true, note: SECOND_ADMIN_NOTE });
      expect(offerPresets({ testGroups: groups({ smoke: true }), soloApprover: 'yes' })[id].offered).toBe(false);
    }
  });
});

describe('suggestPreset', () => {
  const s = (g: Partial<TestGroups>, frameworks: string[] = [], solo: 'yes' | 'no' | 'unknown' = 'yes') => suggestPreset({ testGroups: groups(g) }, frameworks, solo);

  it('rule 1: no smoke tests suggests A, and B, C and D are not offered', () => {
    const r = s({});
    expect(r.preset).toBe('A');
    expect(r.reason).toBe('No smoke tests were found, so only preset A fits.');
    expect(r.offers.B.offered).toBe(false);
    expect(r.offers.C.offered).toBe(false);
    expect(s({ critical: true, full: true }, ['soc-2']).offers.B.offered).toBe(false); // still no smoke
  });

  it('rule 2: SOC 2 or ISO 27001 with a full pack suggests C, and mentions D', () => {
    for (const standard of ['soc-2', 'iso-27001']) {
      const r = s({ smoke: true, full: true }, [standard]);
      expect(r.preset).toBe('C');
      expect(r.reason).toMatch(/SOC 2 or ISO 27001 and a full test pack exists, so preset C fits/);
      expect(r.reason).toMatch(/D is the same without the full regression after deploy/);
      expect(r.note).toBe(SECOND_ADMIN_NOTE);
    }
  });

  it('rule 3: those standards without a full pack suggests B, saying C needs one', () => {
    const r = s({ smoke: true, critical: true }, ['iso-27001']);
    expect(r.preset).toBe('B');
    expect(r.reason).toMatch(/C needs a full test pack/);
  });

  it('rule 4: critical or full tests suggest B', () => {
    expect(s({ smoke: true, critical: true }).preset).toBe('B');
    expect(s({ smoke: true, full: true }).preset).toBe('B');
    expect(s({ smoke: true, full: true }, ['gdpr', 'eu-ai-act', 'iso-29119']).preset).toBe('B'); // other standards do not trigger C
    expect(s({ smoke: true, critical: true }).reason).toBe('Critical tests exist, so preset B fits.');
    expect(s({ smoke: true, full: true }).reason).toBe('A full test pack exists, so preset B fits.');
  });

  it('rule 5: only smoke tests suggest A', () => {
    const r = s({ smoke: true });
    expect(r.preset).toBe('A');
    expect(r.reason).toBe('Only smoke tests were found, so preset A fits.');
  });

  it('never suggests D, whatever the facts', () => {
    for (const g of [{}, { smoke: true }, { smoke: true, critical: true }, { smoke: true, full: true }, { smoke: true, critical: true, full: true }]) {
      for (const f of [[], ['soc-2'], ['iso-27001', 'gdpr']]) {
        for (const solo of ['yes', 'no', 'unknown'] as const) expect(s(g, f, solo).preset).not.toBe('D');
      }
    }
  });

  it('with an unknown solo approver (a scan) A and B are suggested with the portal-support note', () => {
    expect(s({ smoke: true, critical: true }, [], 'unknown')).toMatchObject({ preset: 'B', note: SOLO_APPROVER_NOTE });
    expect(s({ smoke: true }, [], 'unknown')).toMatchObject({ preset: 'A', note: SOLO_APPROVER_NOTE });
  });

  it('when the portal does not allow a solo approver, only C remains and otherwise custom', () => {
    expect(s({ smoke: true, full: true }, ['soc-2'], 'no').preset).toBe('C');
    const b = s({ smoke: true, critical: true }, [], 'no');
    expect(b.preset).toBe('custom');
    expect(b.reason).toMatch(/no preset can be offered: this portal does not yet allow a solo approver/);
    expect(b.reason).toMatch(/Choose custom/);
    const none = s({}, [], 'no');
    expect(none.preset).toBe('custom');
    expect(none.reason).toMatch(/No smoke tests were found, so only preset A would fit/);
  });

  it('falls down the ladder: a rule that names a preset that cannot be offered gets the next one that can', () => {
    // A full pack with the standards but B/A not offered (no solo approver): C is still offered and chosen.
    expect(s({ smoke: true, full: true }, ['soc-2'], 'no').preset).toBe('C');
    // Rule 4 names B; with no solo approver and a full pack the ladder reaches ... C (the next down is A then none; C is above)
    const r = s({ smoke: true, full: true }, [], 'no');
    expect(r.preset).toBe('custom');
  });

  it('every suggestion carries the offers, and a one-sentence reason', () => {
    for (const g of [{}, { smoke: true }, { smoke: true, full: true }]) {
      const r = s(g, ['soc-2']);
      expect(Object.keys(r.offers)).toEqual(['A', 'B', 'C', 'D']);
      expect(r.reason.length).toBeGreaterThan(20);
      expect(r.reason).not.toContain('\n');
    }
  });
});

describe('docs/presets.md rendering', () => {
  const md = renderPresetsMarkdown();

  it('lists all four presets and custom', () => {
    for (const id of PRESET_IDS) expect(md).toContain(`## Preset ${id}: ${PRESETS[id].name}`);
    expect(md).toContain('**custom** (always offered)');
  });

  it('states each preset\'s keys, the moments, the gap sentence and the requirements', () => {
    expect(md).toContain('| `post_deploy_full_regression` | `false` |');
    expect(md).toContain(PRESETS.D.gapText);
    expect(md).toContain(PRESETS.A.gapText);
    expect(md).toContain('| 3. Release pull request opened |');
    expect(md).toContain('a full test pack');
    expect(md).toContain(`"${SECOND_ADMIN_NOTE}"`);
    expect(md).toContain('It does not write `release_gate_tier`, `post_deploy_full_regression`, `scheduled_full_regression`; switching to it removes them.');
  });

  it('is generated: it says so, and ends with a newline', () => {
    expect(md).toMatch(/^# Onboarding presets\n\n> Generated from `core\/src\/presets.ts`/);
    expect(md.endsWith('\n')).toBe(true);
  });
});
