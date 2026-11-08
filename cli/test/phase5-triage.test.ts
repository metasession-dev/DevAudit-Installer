import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// DevAudit-Installer#1199 — Phase 5 triage hand-off, decision table, UI regression sweep, renderer input.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): Promise<string> => fs.readFile(join(ROOT, rel), 'utf-8').then((t) => t.replace(/\r\n/g, '\n'));
const SKILL = 'sdlc/files/_common/skills/sdlc-implementer/SKILL.md';
const REFS = 'sdlc/files/_common/skills/sdlc-implementer/references';

describe('Phase 5 triage hand-off (#1199)', () => {
  it('the template has the four parts: executions, git steps, portal step, order', async () => {
    const t = await read(`${REFS}/phase5-triage-handoff.md.template`);
    for (const part of ['### 1. Executions blocking closure', '### 2. Git steps', '### 3. Portal step', '### 4. Order']) {
      expect(t).toContain(part);
    }
    for (const step of ['accepted-e2e-failure', 'validate-risk-acceptance-record.sh --kind e2e', 'render-test-executions.sh', 'validate-test-summary.sh']) {
      expect(t).toContain(step);
    }
  });

  it('sdlc-implementer makes it a hard step and defines an unresolved failure', async () => {
    const skill = await read(SKILL);
    expect(skill).toContain('devaudit release status <REQ> --json');
    expect(skill).toContain('empty `resolution_type`');
    expect(skill).toContain('**This hand-off is a hard step, not a note.**');
    expect(skill).toContain('references/phase5-triage-handoff.md.template');
    expect(skill).toContain('references/phase5-triage-decision-table.md');
  });

  it('the decision table maps every classification and explains the deployed-SHA limit', async () => {
    const t = await read(`${REFS}/phase5-triage-decision-table.md`);
    for (const r of ['`retry_passed`', '`superseded`', '`accepted_exception`', '`incident_remediated`']) expect(t).toContain(r);
    expect(t).toContain('The post-deploy run tests the deployed SHA');
    expect(t).toContain('cannot produce a `retry_passed`');
  });

  it('no sdlc, docs or CLI text still says the portal resolve action is pending', async () => {
    for (const rel of [SKILL, 'docs/credentials.md', 'docs/SRS.md']) {
      expect(await read(rel), rel).not.toContain('devaudit#918');
    }
  });
});

describe('UI-change regression sweep (#1199)', () => {
  it('Phase 2 step 5c greps all of e2e/ and runs the regression project, between 5b and 6', async () => {
    const skill = await read(SKILL);
    expect(skill).toContain('5c. **UI-change regression sweep (devaudit-installer#1199).**');
    expect(skill).toContain('grep -rn "<old value>" e2e/');
    expect(skill).toContain('--project=regression');
    expect(skill).toContain('## UI regression sweep');
    expect(skill.indexOf('5c. **UI-change')).toBeGreaterThan(skill.indexOf('5b. **E2E gate verification'));
    expect(skill.indexOf('5c. **UI-change')).toBeLessThan(skill.indexOf('6. **On gate failure**'));
  });
});

describe('render-test-executions.sh accepts release status output (#1199)', () => {
  it('reads .executions[] and maps the snake_case cycle fields', async () => {
    const script = await read('sdlc/files/_common/scripts/render-test-executions.sh');
    for (const field of ['.executions', 'sdlc_stage', 'cycle_kind', 'workflow_url', 'external_run_id', 'remediation_reference', 'resolution_type', '$root.version']) {
      expect(script).toContain(field);
    }
    expect(script).toContain('.testExecutions');
    expect(await read(SKILL)).toContain('devaudit release status REQ-XXX --json > /tmp/release-status.json');
  });
});
