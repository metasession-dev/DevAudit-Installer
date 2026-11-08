import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// DevAudit-Installer#1198 — the human UAT pack: templates, orchestrator steps, validator and upload routing.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): Promise<string> => fs.readFile(join(ROOT, rel), 'utf-8').then((t) => t.replace(/\r\n/g, '\n'));
const REFS = 'sdlc/files/_common/skills/sdlc-implementer/references';

describe('the UAT pack templates (#1198)', () => {
  it('ship three templates that open with the 29119-3 document they satisfy', async () => {
    for (const name of ['uat-briefing', 'uat-test-procedure', 'uat-execution-record']) {
      const text = await read(`${REFS}/${name}.md.template`);
      expect(text.startsWith('<!--'), name).toBe(true);
      expect(text, name).toContain('29119-3');
    }
  });

  it('the procedure template carries the step columns and the not-testable table', async () => {
    const text = await read(`${REFS}/uat-test-procedure.md.template`);
    for (const column of ['Precondition', 'Action (click by click)', 'Expected result (exact)', 'Evidence file', 'Stop if fails']) {
      expect(text).toContain(column);
    }
    expect(text).toContain('## ACs not testable by a human');
    expect(text).toContain('REQ-XXX-AC<n>-<slug>.png');
  });

  it('the execution record template has preparation, results, defects, independence and sign-off', async () => {
    const text = await read(`${REFS}/uat-execution-record.md.template`);
    for (const section of ['Tester independence declaration', '## Operator preparation', '## Results', '## Defect log', '## Sign-off']) {
      expect(text).toContain(section);
    }
  });

  it('the briefing never asks for credentials in the file', async () => {
    const text = await read(`${REFS}/uat-briefing.md.template`);
    expect(text).toContain('out of band');
    expect(text.toLowerCase()).toContain('never put credentials');
  });
});

describe('the pack is wired into the orchestrator, validator and uploader (#1198)', () => {
  it('sdlc-implementer writes it in Phase 3 step 3c and checks the record before merging', async () => {
    const skill = await read('sdlc/files/_common/skills/sdlc-implementer/SKILL.md');
    expect(skill).toContain('3c. **Write the human UAT pack (devaudit-installer#1198).**');
    expect(skill).toContain('**UAT execution record check (devaudit-installer#1198).**');
    expect(skill.indexOf('3c. **Write the human UAT pack')).toBeGreaterThan(skill.indexOf('3b. **Verify the per-REQ e2e-scope-decision'));
    expect(skill.indexOf('UAT execution record check')).toBeLessThan(skill.indexOf('`gh pr merge <M> --merge`'));
  });

  it('the validator requires the pack for MEDIUM+ or uat.enabled and checks AC coverage', async () => {
    const validator = await read('sdlc/files/_common/scripts/validate-compliance-artifacts.sh');
    expect(validator).toContain("'MEDIUM|HIGH|CRITICAL'");
    expect(validator).toContain('.uat.enabled // false');
    expect(validator).toContain('still has REPLACE markers');
    expect(validator).toContain('has no step or not-testable row for');
    for (const known of ['uat-briefing.md', 'uat-test-procedure.md', 'uat-execution-record.md', 'e2e-scope-decision.md']) {
      expect(validator).toContain(known);
    }
  });

  it('uses the existing evidence types, so the contract is unchanged', async () => {
    const upload = await read('sdlc/files/_common/scripts/upload-compliance-documents.sh');
    expect(upload).toContain('uat-briefing.md|uat-test-procedure.md)\n          EVTYPE=test_cases; EVCAT=planning');
    expect(upload).toContain('uat-execution-record.md)\n          EVTYPE=test_report; EVCAT=test_report');
    const contract = JSON.parse(await read('contracts/evidence-types.json')) as { evidence_types: Record<string, unknown> };
    expect(contract.evidence_types).toHaveProperty('test_cases');
    expect(contract.evidence_types).toHaveProperty('test_report');
  });

  it('the Stage 3 blueprint and the release ticket template point at the pack', async () => {
    const blueprint = await read('sdlc/src/blueprints/3-compile-evidence.raw.md');
    expect(blueprint).toContain('### Step 9b: Human UAT Pack');
    expect(blueprint).toContain('## UAT pack');
  });
});
