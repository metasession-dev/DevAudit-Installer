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
      // The record opens with front matter the portal reads (#1246); its comment follows it.
      const opening = name === 'uat-execution-record' ? '---\nexecution_mode: manual\nexecuted_by: REPLACE\ntested_sha: REPLACE\n---\n<!--' : '<!--';
      expect(text.startsWith(opening), name).toBe(true);
      expect(text, name).toContain('29119-3');
    }
  });

  it('the record template says who executed the run and lets a reviewer force a manual re-run (#1246)', async () => {
    const text = await read(`${REFS}/uat-execution-record.md.template`);
    for (const part of ['Execution mode', 'Executed by', 'Reviewed by', '## Actions taken by the agent', 'A manual re-run is required', 'compliance/evidence/REQ-XXX/uat/']) {
      expect(text).toContain(part);
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
    for (const section of ['Independence declaration', '## Operator preparation', '## Results', '## Defect log', '## Sign-off']) {
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
    expect(skill).toContain('**UAT execution record check (devaudit-installer#1198, #1212).**');
    // #1212: the record lands before approval; it is never committed at merge time
    expect(skill).toContain('so the record is on the portal when the reviewer approves');
    expect(skill).toContain('Never commit the record at merge time');
    expect(skill.indexOf('3c. **Write the human UAT pack')).toBeGreaterThan(skill.indexOf('3b. **Verify the per-REQ e2e-scope-decision'));
    expect(skill.indexOf('UAT execution record check')).toBeLessThan(skill.indexOf('`gh pr merge <M> --merge`'));
  });

  it('Phase 4 step 4a lets the agent execute UAT under uat.mode auto, never signing or recording it (#1246)', async () => {
    const skill = await read('sdlc/files/_common/skills/sdlc-implementer/SKILL.md');
    const step = skill.slice(skill.indexOf('4a. **Agent-executed UAT, only when `uat.mode` is `auto`'), skill.indexOf('5. **Inspect PR blockers before handoff'));
    expect(step.length).toBeGreaterThan(500);
    for (const part of [
      'compliance/evidence/REQ-XXX/uat/',
      '`execution_mode: agent_executed`',
      'operator action',
      'never records or submits UAT in the portal, and never signs',
      'allowed for every risk class, HIGH and CRITICAL included',
      'manual re-run',
      '`BLOCKED`, not guessed',
    ]) {
      expect(step).toContain(part);
    }
    expect(skill).toContain('never fill the reviewer\'s declaration, decision or sign-off');
  });

  it('Phase 1 step 11 shows the SDLC configuration and changes it only through configure set (#1247)', async () => {
    const skill = await read('sdlc/files/_common/skills/sdlc-implementer/SKILL.md');
    const step = skill.slice(skill.indexOf('11. **Show the SDLC configuration, then checkpoint'), skill.indexOf('12. **Update SDLC status sticky**'));
    expect(step.length).toBeGreaterThan(500);
    for (const part of ['bash scripts/show-sdlc-config.sh <RISK>', '--confirm-config', 'DEVAUDIT_CONFIRM_CONFIG=1', 'devaudit configure set <key> <value> --dry-run', 'Never edit `sdlc-config.json` by hand', '`approval.mode` is the one key']) {
      expect(step).toContain(part);
    }
    const blueprint = await read('sdlc/src/blueprints/1-plan-requirement.raw.md');
    expect(blueprint).toContain('### Step 10b: Review the SDLC Configuration');
  });

  it('the validator reads the record front matter and uat.mode (#1246)', async () => {
    const validator = await read('sdlc/files/_common/scripts/validate-compliance-artifacts.sh');
    for (const part of ["jq -r '.uat.mode // \"manual\"'", 'execution_mode', 'agent_executed', 'compliance/evidence/$REQ/uat/']) {
      expect(validator).toContain(part);
    }
  });

  it('the validator requires the pack per uat.human_pack (default MEDIUM+) and checks AC coverage', async () => {
    const validator = await read('sdlc/files/_common/scripts/validate-compliance-artifacts.sh');
    expect(validator).toContain("'MEDIUM|HIGH|CRITICAL'");
    expect(validator).toContain(".uat.human_pack // \"risk\"");
    expect(validator).not.toContain('.uat.enabled');
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
