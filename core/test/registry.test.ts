import { describe, expect, it } from 'vitest';
import {
  NOT_ASKED,
  PRESET_CONFIG_KEYS,
  QUESTIONS,
  VALIDATOR_IDS,
  askedConfigKeys,
  conditionHolds,
  questionById,
  questionsToAsk,
} from '../src/index.js';

const IDS = ['Q0a', 'Q0b', 'Q0c', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10', 'Q11', 'Q12', 'Q13', 'Q14', 'Q15', 'Q16', 'Q17', 'Q18', 'Q19', 'Q20', 'Q21'];

describe('the question registry (section 5)', () => {
  it('has the 24 questions of the table, in order, once each', () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual(IDS);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
    expect(questionById('Q11')?.id).toBe('Q11');
    expect(questionById('Q99')).toBeUndefined();
  });

  it('every question has the fields the section lists, filled in', () => {
    for (const q of QUESTIONS) {
      expect(q.prompt.trim().length, q.id).toBeGreaterThan(10);
      expect(q.why.trim().length, q.id).toBeGreaterThan(20);
      expect(['select', 'multiselect', 'text', 'confirm'], q.id).toContain(q.kind);
      expect(q.changeLater.trim().length, q.id).toBeGreaterThan(10);
      expect(typeof q.express, q.id).toBe('boolean');
      expect(['always', 'tests-exist', 'data-needs-reset', 'preset-needs-data'], q.id).toContain(q.askWhen);
      for (const d of q.defaults) {
        expect(['D', 'P', 'F'], q.id).toContain(d.rule);
        expect(d.source.trim().length, q.id).toBeGreaterThan(0);
      }
      for (const v of [...q.validators, ...(q.parts ?? []).flatMap((p) => p.validators)]) expect(VALIDATOR_IDS, `${q.id} ${v}`).toContain(v);
    }
  });

  it('every choice says what choosing it means', () => {
    for (const q of QUESTIONS) {
      for (const c of [...(q.choices ?? []), ...(q.parts ?? []).flatMap((p) => p.choices ?? [])]) {
        expect(c.value.trim(), q.id).not.toBe('');
        expect(c.label.trim().length, `${q.id} ${c.value}`).toBeGreaterThan(1);
        expect(c.consequence.trim().length, `${q.id} ${c.value}`).toBeGreaterThan(15);
      }
    }
  });

  it('a select has its choices, or says where they come from', () => {
    for (const q of QUESTIONS.filter((x) => x.kind === 'select' || x.kind === 'multiselect')) {
      expect(q.choices !== undefined || q.dynamicChoices !== undefined || (q.parts ?? []).some((p) => p.choices !== undefined), q.id).toBe(true);
    }
  });

  it('matches the Express column of the table', () => {
    const express = QUESTIONS.filter((q) => q.express).map((q) => q.id);
    expect(express).toEqual(['Q1', 'Q2', 'Q4', 'Q8', 'Q9', 'Q11', 'Q12', 'Q13']);
    expect(questionById('Q18')).toMatchObject({ express: false, expressWhen: 'preset-needs-data' });
  });

  it('takes its defaults from the right place: detection for facts, the preset for policy', () => {
    for (const id of ['Q8', 'Q11', 'Q12']) expect(questionById(id)!.defaults.map((d) => d.rule), id).toEqual(['P']);
    for (const id of ['Q1', 'Q4', 'Q5', 'Q21']) expect(questionById(id)!.defaults.some((d) => d.rule === 'D'), id).toBe(true);
    expect(questionById('Q13')!.defaults.map((d) => d.rule)).toEqual(['D', 'F']);
    expect(questionById('Q14')!.defaults).toEqual([]);
  });

  it('writes what the table says', () => {
    const writes = (id: string) => questionById(id)!.writes;
    expect(writes('Q0a')).toEqual(['project_slug']);
    expect(writes('Q1')).toEqual(['host']);
    expect(writes('Q3')).toEqual(['production_url_secret']);
    expect(writes('Q5')).toEqual(['e2e_project', 'test_tier_smoke']);
    expect(writes('Q8')).toEqual(['e2e_regression_enabled', 'release_gate_tier', 'post_deploy_full_regression', 'scheduled_full_regression']);
    expect(writes('Q10')).toEqual(['integration_branch', 'release_branch']);
    expect(writes('Q11')).toEqual(['approval.mode', 'release_branch_required_reviews', 'portal:approval_policy']);
    expect(writes('Q12')).toEqual(['production_review.terminal_status']);
    expect(writes('Q13')).toEqual(['compliance_frameworks', 'portal:claimed_standards']);
    expect(writes('Q14')).toEqual([]);
    expect(writes('Q17')).toEqual(['e2e_start_command', 'e2e_port']);
    expect(writes('Q18')).toEqual(['e2e_data_isolation', 'e2e_concurrency_group']);
    expect(writes('Q19')).toEqual(['e2e_seed_command', 'e2e_seed_paths']);
    expect(writes('Q20')).toEqual(['e2e_reset_command']);
    expect(writes('Q21')).toEqual(['e2e_projects']);
  });

  it('every portal change a question makes is named as one (a tier B action)', () => {
    const portal = QUESTIONS.flatMap((q) => q.writes).filter((w) => w.startsWith('portal:'));
    expect(portal.sort()).toEqual(['portal:approval_policy', 'portal:claimed_standards']);
  });

  it('Q18 offers the four isolation values and "I do not know yet", which writes nothing', () => {
    const q = questionById('Q18')!;
    expect(q.choices!.map((c) => c.value)).toEqual(['none', 'ephemeral', 'shared_serialised', 'shared', 'unknown']);
    expect(q.choices!.find((c) => c.value === 'unknown')!.consequence).toMatch(/Nothing is written/);
    expect(q.choices!.find((c) => c.value === 'shared')!.consequence).toMatch(/Recorded as a risk/);
  });

  it('Q8 has three parts: the release pull request, after a deploy, and the nightly run', () => {
    const q = questionById('Q8')!;
    expect(q.parts!.map((p) => p.id)).toEqual(['release-pr', 'after-deploy', 'nightly']);
    expect(q.parts![0]!.choices!.map((c) => c.value)).toEqual(['none', 'smoke', 'critical', 'full']);
    expect(q.parts![0]!.validators).toEqual(['tierHasTests']);
    expect(q.parts![2]!.choices!.map((c) => c.value)).toEqual(['off', '0 1 * * *', '0 2 * * *', '0 3 * * *', '0 4 * * *', 'custom']);
    expect(q.parts![2]!.validators).toEqual(['cron5']);
  });

  it('Q21 says the project that signs in is a dependency and is not listed, and writes the projects that need the login', () => {
    const q = questionById('Q21')!;
    expect(q.choices!.find((c) => c.value === 'yes')!.consequence).toMatch(/not listed/);
    expect(q.defaults[0]!.source).toMatch(/dependencies entry on a setup project/);
  });
});

describe('what each question writes, against the keys that exist', () => {
  it('no key is both asked and listed as not asked, and every reason is written out', () => {
    const asked = new Set(askedConfigKeys());
    for (const [key, reason] of Object.entries(NOT_ASKED)) {
      expect(asked.has(key), `${key} is asked and also in NOT_ASKED`).toBe(false);
      expect(reason.trim().length, key).toBeGreaterThan(15);
    }
  });

  it('the keys a preset writes are asked by a question or declared (onboarding_preset is the one the preset step writes)', () => {
    const asked = new Set(askedConfigKeys());
    for (const key of PRESET_CONFIG_KEYS) expect(asked.has(key) || key in NOT_ASKED, key).toBe(true);
  });

  it('the seven test-data keys of decision M7 are all accounted for', () => {
    const asked = new Set(askedConfigKeys());
    for (const key of ['e2e_data_isolation', 'e2e_seed_paths', 'e2e_reset_command']) expect(asked.has(key), key).toBe(true);
    for (const key of ['e2e_preflight_command', 'e2e_leak_check_command', 'e2e_max_skipped', 'feature_e2e_projects']) {
      expect(NOT_ASKED[key], key).toBe('set by `configure set`; advanced');
    }
  });
});

describe('when a question is asked', () => {
  const none = { testsExist: false };
  const tests = { testsExist: true };

  it('conditions', () => {
    expect(conditionHolds('always', none)).toBe(true);
    expect(conditionHolds('tests-exist', none)).toBe(false);
    expect(conditionHolds('tests-exist', tests)).toBe(true);
    // Q20: the data needs putting back unless there is none or it is made fresh each time
    for (const [iso, expected] of [['shared', true], ['shared_serialised', true], ['none', false], ['ephemeral', false], ['unknown', false], [undefined, false]] as const) {
      expect(conditionHolds('data-needs-reset', { testsExist: true, dataIsolation: iso }), String(iso)).toBe(expected);
    }
    expect(conditionHolds('data-needs-reset', { testsExist: false, dataIsolation: 'shared' })).toBe(false);
    // Q18 on the express path: a preset that runs the regression, with no answer yet
    for (const preset of ['B', 'C', 'D'] as const) expect(conditionHolds('preset-needs-data', { testsExist: true, preset }), preset).toBe(true);
    for (const preset of ['A', 'custom', undefined] as const) expect(conditionHolds('preset-needs-data', { testsExist: true, preset }), String(preset)).toBe(false);
    expect(conditionHolds('preset-needs-data', { testsExist: true, preset: 'C', dataIsolation: 'ephemeral' })).toBe(false);
    expect(conditionHolds('preset-needs-data', { testsExist: true, preset: 'C', dataIsolation: 'unknown' })).toBe(true);
    expect(conditionHolds('preset-needs-data', { testsExist: false, preset: 'C' })).toBe(false);
  });

  it('with no end-to-end tests the test questions, the data questions and the start command are skipped', () => {
    const ids = questionsToAsk(none).map((q) => q.id);
    for (const skipped of ['Q5', 'Q6', 'Q7', 'Q8', 'Q17', 'Q18', 'Q19', 'Q20', 'Q21']) expect(ids, skipped).not.toContain(skipped);
    for (const asked of ['Q0a', 'Q1', 'Q4', 'Q9', 'Q10', 'Q11', 'Q12', 'Q13', 'Q14', 'Q15', 'Q16']) expect(ids, asked).toContain(asked);
  });

  it('Q18 to Q21 follow the test questions, and Q20 only when the data needs putting back', () => {
    const ids = questionsToAsk({ testsExist: true, dataIsolation: 'ephemeral' }).map((q) => q.id);
    expect(ids).toContain('Q19');
    expect(ids).toContain('Q21');
    expect(ids).not.toContain('Q20');
    expect(ids.indexOf('Q17')).toBeLessThan(ids.indexOf('Q18'));
    expect(questionsToAsk({ testsExist: true, dataIsolation: 'shared' }).map((q) => q.id)).toContain('Q20');
  });

  it('the express path asks the express questions, and Q18 for a preset that runs the regression', () => {
    const base = questionsToAsk({ testsExist: true, preset: 'A' }, { express: true }).map((q) => q.id);
    expect(base).toEqual(['Q1', 'Q2', 'Q4', 'Q8', 'Q9', 'Q11', 'Q12', 'Q13']);
    const withData = questionsToAsk({ testsExist: true, preset: 'C' }, { express: true }).map((q) => q.id);
    expect(withData).toContain('Q18');
    expect(questionsToAsk({ testsExist: true, preset: 'C', dataIsolation: 'ephemeral' }, { express: true }).map((q) => q.id)).not.toContain('Q18');
    const noTests = questionsToAsk({ testsExist: false }, { express: true }).map((q) => q.id);
    expect(noTests).toEqual(['Q1', 'Q2', 'Q4', 'Q9', 'Q11', 'Q12', 'Q13']);
  });
});
