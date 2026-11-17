import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_MODES,
  isComplianceMode,
  offerPresets,
  presetForComplianceMode,
  renderPresetsMarkdown,
  type ComplianceMode,
  type TestGroups,
} from '../src/index.js';

// DevAudit-Installer#1272 — the compliance mode of a headless install names a preset.

const groups = (g: Partial<TestGroups> = {}): TestGroups => ({ smoke: false, critical: false, full: false, ...g });
const offers = (g: Partial<TestGroups>) => offerPresets({ testGroups: groups(g), soloApprover: 'yes' });

describe('presetForComplianceMode', () => {
  it('knows the three modes', () => {
    expect(COMPLIANCE_MODES).toEqual(['none', 'light', 'regulated']);
    expect(isComplianceMode('light')).toBe(true);
    expect(isComplianceMode('strict')).toBe(false);
  });

  const full = { smoke: true, critical: true, full: true };
  const smokeOnly = { smoke: true };
  const none = {};

  const table: Array<[ComplianceMode, Partial<TestGroups>, string, string | null, boolean]> = [
    // mode, tests, requested, used, fell back
    ['none', full, 'A', 'A', false],
    ['none', smokeOnly, 'A', 'A', false],
    ['none', none, 'A', 'A', false],
    ['light', full, 'B', 'B', false],
    ['light', smokeOnly, 'B', 'B', false],
    ['light', none, 'B', 'A', true],
    ['regulated', full, 'C', 'C', false],
    ['regulated', smokeOnly, 'C', 'B', true],
    ['regulated', none, 'C', 'A', true],
  ];

  it.each(table)('%s with %j asks for %s and uses %s (fallback %s)', (mode, tests, requested, used, fellBack) => {
    const r = presetForComplianceMode(mode, offers(tests));
    expect(r.requested).toBe(requested);
    expect(r.preset).toBe(used);
    expect(r.fallbackNote !== undefined).toBe(fellBack);
  });

  it('says which preset it fell back to and why, in one line', () => {
    const r = presetForComplianceMode('regulated', offers({ smoke: true }));
    expect(r.fallbackNote).toBe('Compliance mode regulated names preset C, but it needs a full test pack and none was found; using preset B instead.');
    expect(r.fallbackNote).not.toContain('\n');
  });

  it('never picks D, even when D is offered and C is not', () => {
    const o = offers(full);
    const noC = { ...o, C: { offered: false, reason: 'test' } };
    const r = presetForComplianceMode('regulated', noC);
    expect(r.preset).toBe('B');
  });

  it('returns no preset when nothing can be offered (a portal that refuses a solo approver and no full pack)', () => {
    const o = offerPresets({ testGroups: groups(), soloApprover: 'no' });
    const r = presetForComplianceMode('regulated', o);
    expect(r.preset).toBeNull();
    expect(r.fallbackNote).toContain('no lower preset can be offered');
  });
});

describe('docs/presets.md source', () => {
  it('has a Compliance modes section naming the mapping and the delivery-run paragraph', () => {
    const md = renderPresetsMarkdown();
    expect(md).toContain('## Compliance modes');
    expect(md).toContain('| `none` | **A**');
    expect(md).toContain('| `regulated` | **C**');
    expect(md).toContain('`delivery-agent`');
  });
});
