import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Persists the e2e-test-engineer invoke/skip decision as evidence, so the
// portal's per-REQ "No E2E screenshots" advisory can distinguish a
// deliberate skip from a genuine coverage gap (DevAudit-Installer#737).

const root = resolve(import.meta.dirname, '../..');
const readCommon = (relPath: string) =>
  readFileSync(resolve(root, 'sdlc/files/_common', relPath), 'utf8').replace(/\r\n/g, '\n');

describe('implementation plan template — E2E test coverage section (#737)', () => {
  const plan = readCommon('Implementation_Plan_TEMPLATE.md');

  it('carries a dedicated E2E test coverage section, symmetric with ADR/risk sections', () => {
    expect(plan).toContain('## 3. Architecture decisions');
    expect(plan).toContain('## 4. E2E test coverage');
    expect(plan).toContain('## 5. Threat model + security considerations');
    expect(plan).toContain('### Risk register entries');
    // Section is populated by one of the two skills, not authored inline.
    expect(plan).toContain(
      "Populated by the [`e2e-test-engineer` skill](../skills/e2e-test-engineer/SKILL.md) (when invoked) or by the [`sdlc-implementer` skill](../skills/sdlc-implementer/SKILL.md) itself",
    );
  });

  it('documents both the positive (spec) and negative (@e2e-deferred) cases, never leaving the section empty', () => {
    expect(plan).toContain('**Spec(s):**');
    expect(plan).toContain('@e2e-deferred: <rationale>');
    expect(plan).toContain('compliance/evidence/REQ-XXX/e2e-scope-decision.md');
    expect(plan).toContain('evidence type `e2e_scope_decision`');
  });

  it('renumbers the remaining sections consecutively after inserting the new section 4', () => {
    const headings = [...plan.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
    expect(headings).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('e2e-test-engineer skill — writes the e2e-scope-decision artefact (#737)', () => {
  const skill = readCommon('skills/e2e-test-engineer/SKILL.md');

  it('writes a committed (non-gitignored) artefact distinct from the local .e2e-gate-passed sentinel', () => {
    expect(skill).toContain('compliance/evidence/REQ-XXX/e2e-scope-decision.md');
    expect(skill).toContain('committed, not gitignored');
    expect(skill).toContain('generated_by: e2e-test-engineer');
    expect(skill).toContain('e2e_required: true|false');
  });

  it('tags the artefact for upload as evidence_type=e2e_scope_decision', () => {
    expect(skill).toContain('evidence_type=e2e_scope_decision');
  });
});

describe('sdlc-implementer skill — persists the no-invoke decision itself (#737)', () => {
  const skill = readCommon('skills/sdlc-implementer/SKILL.md');

  it('writes the plan section + evidence artefact when e2e-test-engineer is never invoked (no UI-facing files)', () => {
    expect(skill).toContain('If no UI-facing files (API-only, config, docs)');
    expect(skill).toContain('Persist the decision (devaudit-installer#737)');
    expect(skill).toContain('@e2e-deferred: <rationale>');
    expect(skill).toContain('spec_path: null');
  });

  it('does not duplicate the artefact when e2e-test-engineer already wrote it', () => {
    expect(skill).toContain(
      'do not duplicate or overwrite either',
    );
  });

  it('verifies the artefact exists before Stage 3 upload and includes it in the evidence-type list', () => {
    expect(skill).toContain('3b. **Verify the per-REQ e2e-scope-decision artefact exists (devaudit-installer#737)');
    expect(skill).toContain('e2e_scope_decision` (verified in step 3b)');
  });
});
