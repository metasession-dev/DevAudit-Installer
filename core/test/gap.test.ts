import { describe, expect, it } from 'vitest';
import { findingToGap, gapId, type Remediation } from '../src/index.js';

const remediation = (tier: 'A' | 'B' | 'C'): Remediation => ({
  id: `fix-${tier}`,
  tier,
  summary: `Fix it (${tier})`,
  plan: ['step one', 'step two'],
  needsPortal: tier === 'B',
  data: { key: 'value' },
});

const explanation = { title: 'The thing is wrong', why: 'Because it matters.', guidance: 'Do the thing.', controls: ['SOC2.CC8.1'] };

describe('gapId', () => {
  it('is stable and readable', () => {
    expect(gapId('doctor', 'srs', 'srs')).toBe('doctor:srs:srs');
    expect(gapId('scan', 'SOC2.CC8.1', 'SOC2.CC8.1')).toBe('scan:SOC2.CC8.1:SOC2.CC8.1');
  });
});

describe('findingToGap', () => {
  it('turns a finding with a repair into a gap whose option is that repair', () => {
    for (const tier of ['A', 'B', 'C'] as const) {
      const gap = findingToGap('deploy-host', { subject: 'host', detail: 'it says railway', remediation: remediation(tier) }, explanation);
      expect(gap.source).toBe('doctor');
      expect(gap.check).toBe('deploy-host');
      expect(gap.subject).toBe('host');
      expect(gap.id).toBe('doctor:deploy-host:host');
      expect(gap.title).toBe('The thing is wrong');
      expect(gap.why).toBe('Because it matters.');
      expect(gap.controls).toEqual(['SOC2.CC8.1']);
      expect(gap.options).toHaveLength(1);
      const option = gap.options[0]!;
      expect(option.id).toBe(`fix-${tier}`);
      expect(option.label).toBe(`Fix it (${tier})`);
      expect(option.tier).toBe(tier);
      expect(option.remediation).toEqual(remediation(tier));
      expect(option.consequence.length).toBeGreaterThan(10);
    }
  });

  it('says in the consequence how far each tier reaches', () => {
    const consequence = (tier: 'A' | 'B' | 'C') => findingToGap('c', { subject: 's', detail: 'd', remediation: remediation(tier) }).options[0]!.consequence;
    expect(consequence('A')).toMatch(/local file or setting/);
    expect(consequence('B')).toMatch(/portal/);
    expect(consequence('B')).toMatch(/interactive confirmation/);
    expect(consequence('C')).toMatch(/changes nothing for you/);
  });

  it('a finding without a repair gets a guidance option (tier C) from the explanation', () => {
    const gap = findingToGap('srs', { subject: 'srs', detail: 'docs/SRS.md is missing' }, explanation);
    expect(gap.options).toEqual([
      { id: 'guidance', label: 'Do the thing.', tier: 'C', consequence: expect.stringMatching(/changes nothing for you/) },
    ]);
    expect(gap.options[0]!.remediation).toBeUndefined();
  });

  it('with no explanation it falls back to the finding text, so a gap always has a reason and an option', () => {
    const gap = findingToGap('mystery', { subject: 'x', detail: 'something is off' });
    expect(gap.title).toBe('mystery');
    expect(gap.why).toBe('something is off');
    expect(gap.options).toHaveLength(1);
    expect(gap.options[0]!.label).toBe('something is off');
    expect(gap.controls).toEqual([]);
  });

  it('survives an empty detail and an empty subject', () => {
    const gap = findingToGap('mystery', { subject: '  ', detail: '   ' });
    expect(gap.subject).toBe('mystery');
    expect(gap.id).toBe('doctor:mystery:mystery');
    expect(gap.why).not.toBe('');
    expect(gap.options[0]!.label).not.toBe('');
  });

  it('copies the controls so a gap cannot change the explanation', () => {
    const shared = { ...explanation, controls: ['A.1'] };
    const gap = findingToGap('c', { subject: 's', detail: 'd' }, shared);
    gap.controls.push('B.2');
    expect(shared.controls).toEqual(['A.1']);
  });
});
