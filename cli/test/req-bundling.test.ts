import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// sdlc-implementer's opt-in bundling of multiple tracked REQs onto one
// shared branch/PR/release (#736), instead of forcing N full
// REQ->plan->PR->UAT->release cycles for small, independent issues.

const root = resolve(import.meta.dirname, '..', '..');
const readCommon = (relPath: string) =>
  readFileSync(resolve(root, 'sdlc/files/_common', relPath), 'utf8').replace(/\r\n/g, '\n');

describe('sdlc-implementer skill — bundle eligibility (#736)', () => {
  const skill = readCommon('skills/sdlc-implementer/SKILL.md');

  it('requires a structural declaration, never inferring from prose', () => {
    expect(skill).toContain('Bundles: #A, #B');
    expect(skill).toContain('Never infer bundle-worthiness from free prose alone');
  });

  it('rejects CRITICAL members, wide risk-tier gaps, and overlapping files', () => {
    expect(skill).toContain('any bundled issue classifies as CRITICAL risk');
    expect(skill).toContain('span more than one tier apart');
    expect(skill).toContain('touch overlapping files/logic');
  });

  it('runs bundle ceremony at the max risk class across the set', () => {
    expect(skill).toContain('Bundle-level ceremony = the max risk class across the set');
  });

  it('still runs Phase 1 steps 1-12 once per REQ inside an eligible bundle', () => {
    expect(skill).toContain('Run Phase 1 steps 1–12 once per REQ-XXX in the bundle');
    expect(skill).toContain('own plan, own AC table, own SRS-IDs, own ADR/risk assessment, own RTM row');
  });

  it('the out-of-scope list carries the bundling exception', () => {
    const idx = skill.indexOf('**Out of scope**');
    expect(idx).toBeGreaterThan(-1);
    const section = skill.slice(idx, idx + 600);
    expect(section).toContain('**unless** the operator has explicitly declared a bundle');
  });

  it('shares one branch and one PR in bundle mode, still one commit per REQ', () => {
    expect(skill).toContain('feat/bundle-<slug>');
    expect(skill).toContain('still one commit per REQ');
    expect(skill).toContain('open **one** PR');
  });

  it('the Workflow Decision template has a bundled variant surfacing the change-request-loop cost', () => {
    expect(skill).toContain('Bundled-REQs variant');
    expect(skill).toContain('the shared PR still needs full re-review');
  });
});

describe('generate-bundled-changes.sh — declared co-tracked bundle members (#736)', () => {
  const script = readCommon('scripts/generate-bundled-changes.sh');

  it('accepts --declared-bundle as an additive mode alongside predecessor absorption', () => {
    expect(script).toContain('--declared-bundle');
    expect(script).toContain('role: "co-tracked"');
    expect(script).toContain('relationship: "bundled"');
  });

  it('rejects self-inclusion and duplicate declared members', () => {
    expect(script).toContain('cannot include its own core release');
    expect(script).toContain('duplicate declared bundle member');
  });

  it('keeps co-tracked members fully evidence-isolated (no inheritance)', () => {
    expect(script).toMatch(/mode:\s*"none"/);
  });
});

describe('derive-release-version.sh — declared-bundle manifest priority tier (#736)', () => {
  const script = readCommon('scripts/derive-release-version.sh');

  it('checks for a declared-bundle manifest before the subject-tag rule', () => {
    const bundleIdx = script.indexOf('Co-Tracked Bundle Members');
    const subjectRuleIdx = script.indexOf("# 1. Subject: [REQ-XXX]");
    expect(bundleIdx).toBeGreaterThan(-1);
    expect(subjectRuleIdx).toBeGreaterThan(-1);
    expect(bundleIdx).toBeLessThan(subjectRuleIdx);
  });

  it('requires exactly one declared-bundle file, else falls through unchanged', () => {
    expect(script).toContain('DECLARED_BUNDLE_FILES[@]');
    expect(script).toContain('-eq 1');
  });
});
