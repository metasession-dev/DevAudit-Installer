import { describe, it, expect } from 'vitest';
import {
  autoDetectEvidenceShotOrigin,
  composeScreenshotFilename,
  shouldSuppressEvidenceShot,
  validateEvidenceShotInputs,
} from '../../sdlc/files/_common/skills/e2e-test-engineer/references/evidence-shot-core';

describe('validateEvidenceShotInputs', () => {
  it('accepts valid REQ + AC + slug', () => {
    expect(() => validateEvidenceShotInputs('REQ-037', 1, 'edit-dialog-prefilled')).not.toThrow();
    expect(() => validateEvidenceShotInputs('REQ-046-FIX', 10, 'a-b-c-1')).not.toThrow();
  });

  it.each([
    ['req-037', 'lowercase req'],
    ['REQ_037', 'underscore separator'],
    ['REQ-', 'empty id segment'],
    ['REQ-037 ', 'trailing space'],
    ['037', 'no REQ prefix'],
  ])('rejects reqId %s (%s)', (bad) => {
    expect(() => validateEvidenceShotInputs(bad, 1, 'slug')).toThrow(/invalid reqId/);
  });

  it.each([
    [0, 'zero'],
    [-1, 'negative'],
    [1.5, 'fractional'],
    [Number.NaN, 'NaN'],
  ])('rejects ac=%s (%s)', (bad) => {
    expect(() => validateEvidenceShotInputs('REQ-001', bad, 'slug')).toThrow(/invalid ac/);
  });

  it.each([
    ['Foo', 'capitalised'],
    ['foo_bar', 'underscore'],
    ['foo bar', 'space'],
    ['foo!', 'punctuation'],
    ['AC1-foo', 'embedded AC prefix (helper composes that itself)'],
    ['', 'empty'],
  ])('rejects slug %s (%s)', (bad) => {
    expect(() => validateEvidenceShotInputs('REQ-001', 1, bad)).toThrow(/invalid slug/);
  });
});

describe('composeScreenshotFilename', () => {
  it('composes the canonical REQ-AC-slug shape', () => {
    expect(composeScreenshotFilename('REQ-037', 1, 'edit-dialog-prefilled')).toBe(
      'REQ-037-AC1-edit-dialog-prefilled.png',
    );
    expect(composeScreenshotFilename('REQ-100', 12, 'x')).toBe('REQ-100-AC12-x.png');
  });
});

describe('autoDetectEvidenceShotOrigin', () => {
  it('empty / undefined env → regression', () => {
    expect(autoDetectEvidenceShotOrigin('tests/e2e/foo.spec.ts', undefined)).toBe('regression');
    expect(autoDetectEvidenceShotOrigin('tests/e2e/foo.spec.ts', '')).toBe('regression');
    expect(autoDetectEvidenceShotOrigin('tests/e2e/foo.spec.ts', '   \n  ')).toBe('regression');
  });

  it('spec file in the new-specs list → feature', () => {
    const env = 'tests/e2e/new.spec.ts\ntests/e2e/another.spec.ts';
    expect(autoDetectEvidenceShotOrigin('tests/e2e/new.spec.ts', env)).toBe('feature');
    expect(autoDetectEvidenceShotOrigin('tests/e2e/another.spec.ts', env)).toBe('feature');
  });

  it('spec file not in the new-specs list → regression', () => {
    const env = 'tests/e2e/new.spec.ts';
    expect(autoDetectEvidenceShotOrigin('tests/e2e/existing.spec.ts', env)).toBe('regression');
  });

  it('handles CRLF line endings in the env (Windows CI)', () => {
    const env = 'tests/e2e/new.spec.ts\r\ntests/e2e/another.spec.ts';
    expect(autoDetectEvidenceShotOrigin('tests/e2e/another.spec.ts', env)).toBe('feature');
  });

  it('trims whitespace around each entry', () => {
    const env = '  tests/e2e/new.spec.ts  \n\n  tests/e2e/another.spec.ts  ';
    expect(autoDetectEvidenceShotOrigin('tests/e2e/new.spec.ts', env)).toBe('feature');
  });
});

describe('shouldSuppressEvidenceShot', () => {
  it("tier='always' captures on every origin", () => {
    expect(shouldSuppressEvidenceShot('always', 'feature')).toBe(false);
    expect(shouldSuppressEvidenceShot('always', 'regression')).toBe(false);
  });

  it("tier='feature' captures while the spec is a feature artefact", () => {
    expect(shouldSuppressEvidenceShot('feature', 'feature')).toBe(false);
  });

  it("tier='feature' suppresses once the spec has graduated into the regression pack", () => {
    expect(shouldSuppressEvidenceShot('feature', 'regression')).toBe(true);
  });
});
