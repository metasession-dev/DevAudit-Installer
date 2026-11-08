import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// DevAudit-Installer#1200 — Stage 3 operator sign-offs are collected in one step and gate the release PR.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): Promise<string> => fs.readFile(join(ROOT, rel), 'utf-8').then((t) => t.replace(/\r\n/g, '\n'));

const SKILLS = ['requirements-aligner', 'adr-author', 'risk-register-keeper', 'e2e-test-engineer'];

describe('Stage 3 operator sign-offs (#1200)', () => {
  it('sdlc-implementer collects them in Phase 3 step 8b and guards Phase 4', async () => {
    const skill = await read('sdlc/files/_common/skills/sdlc-implementer/SKILL.md');
    expect(skill).toContain('8b. **Collect the Stage 3 operator sign-offs in one exchange');
    expect(skill).toContain('bash scripts/check-operator-signoffs.sh REQ-XXX --json');
    for (const reply of ['`approved`', '`updated and approved`']) expect(skill).toContain(reply);
    expect(skill).toContain('Never tick a box or fill Reviewer without that explicit reply');
    // #1211: a conditional box that does not apply is marked not applicable, not ticked.
    expect(skill).toContain('mark a conditional box that does not apply `- [~]`');
    expect(await read('sdlc/files/_common/skills/adr-author/SKILL.md')).toContain('the other is marked `- [~]` (not applicable)');
    expect(skill).toContain('**Sign-off guard (devaudit-installer#1200).**');
    // step 8b sits between the RTM update (8) and the sticky (9)
    expect(skill.indexOf('8b. **Collect')).toBeGreaterThan(skill.indexOf('8. **Update `compliance/RTM.md`**'));
    expect(skill.indexOf('8b. **Collect')).toBeLessThan(skill.indexOf('9. **Update SDLC status sticky** before exiting Phase 3'));
  });

  it.each(SKILLS)('%s keeps its sign-off block and tells the agent not to fill it in', async (name) => {
    const skill = await read(`sdlc/files/_common/skills/${name}/SKILL.md`);
    expect(skill).toContain('## Operator sign-off');
    expect(skill).toContain('**Reviewer:** <operator-name>');
    expect(skill).toContain('Phase 3 step 8b collects this sign-off');
  });

  it('the validator runs the check and fails on a pending block', async () => {
    const validator = await read('sdlc/files/_common/scripts/validate-compliance-artifacts.sh');
    expect(validator).toContain('check-operator-signoffs.sh');
    expect(validator).toContain('ERROR: Operator sign-off pending');
  });

  it('the shell tests run in template-lint', async () => {
    const lint = await read('.github/workflows/template-lint.yml');
    expect(lint).toContain('check-operator-signoffs.test.sh');
  });
});
