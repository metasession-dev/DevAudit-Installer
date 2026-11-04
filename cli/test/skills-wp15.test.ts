import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

// DevAudit-Installer#1116 WP15 — the e2e-test-data skill, its hooks, and the inventories that list skills.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): Promise<string> => fs.readFile(join(ROOT, rel), 'utf-8');

describe('the e2e-test-data skill', () => {
  it('is short, has a narrow description and validates against the skill schema', async () => {
    const text = await read('sdlc/files/_common/skills/e2e-test-data/SKILL.md');
    expect(text.split('\n').length).toBeLessThan(150);
    const description = /^description: (.+)$/m.exec(text)![1]!;
    for (const trigger of ['seed', 'fixture', 'teardown', 'test account', 'seed-data gap']) expect(description.toLowerCase()).toContain(trigger);
    expect(description).toContain('Do NOT use for writing specs');
    const r = await execa('node', [join(ROOT, 'scripts', 'validate-adapter.cjs'), join(ROOT, 'sdlc/files/_common/skills/e2e-test-data/SKILL.md')], { reject: false });
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    for (const ref of ['seed-conventions.md', 'drift-checks.md']) await expect(read(`sdlc/files/_common/skills/e2e-test-data/references/${ref}`)).resolves.toContain('#');
  });

  it('covers the declaration, seed and reset conventions, the three drift checks and the leak audit', async () => {
    const text = await read('sdlc/files/_common/skills/e2e-test-data/SKILL.md');
    expect(text).toContain('Test Data Requirements');
    expect(text).toContain('three');
    for (const check of ['seed against the schema', 'seed against the specs', 'live data against the baseline']) expect(text.toLowerCase()).toContain(check);
    expect(text).toContain('Leak audit');
    const conventions = await read('sdlc/files/_common/skills/e2e-test-data/references/seed-conventions.md');
    for (const rule of ['Idempotent upserts', 'afterAll', 'killed run']) expect(conventions).toContain(rule);
  });
});

describe('the orchestrator and the other skills call it', () => {
  it('sdlc-implementer and its call graph name e2e-test-data in Phase 2', async () => {
    expect(await read('sdlc/files/_common/skills/sdlc-implementer/SKILL.md')).toContain('Skill(name: "e2e-test-data"');
    const graph = await read('sdlc/files/_common/skills/sdlc-implementer/references/call-graph.md');
    expect(graph).toContain('### `e2e-test-data` — Phase 2');
    expect(graph.indexOf('### `e2e-test-engineer`')).toBeLessThan(graph.indexOf('### `e2e-test-data`'));
  });

  it('e2e-test-engineer has thin hooks only: Phase 5 asks, Phase 6 hands over', async () => {
    const text = await read('sdlc/files/_common/skills/e2e-test-engineer/SKILL.md');
    expect(text).toContain('Does this change alter what data the tests need?');
    expect(text).toContain('Hand a `precondition_gap` or `seed-data gap` to the `e2e-test-data` skill');
  });

  it('devaudit-configure covers Q18 to Q21, the new keys, and hands data work over', async () => {
    const text = await read('sdlc/files/_common/skills/devaudit-configure/SKILL.md');
    const description = /^description: (.+)$/m.exec(text)![1]!;
    for (const key of ['Q18 to Q21', 'e2e_data_isolation', 'e2e_seed_paths', 'e2e_seed_command', 'e2e_reset_command', 'e2e_preflight_command', 'e2e_leak_check_command', 'e2e_max_skipped', 'feature_e2e_projects']) expect(description).toContain(key);
    expect(text).toContain('never writes seed code itself');
    expect(text).toMatch(/version: 1\.3\.0/);
    // the "Starting with no tests" path gains the data steps after the smoke tests exist
    const section = text.slice(text.indexOf('## Starting with no tests'));
    expect(section.indexOf('e2e-test-data')).toBeGreaterThan(section.indexOf('Run `devaudit configure`'));
  });
});

describe('the skill inventories', () => {
  it('list nine skills including e2e-test-data', async () => {
    expect(await read('README.md')).toContain('nine AI skills');
    expect(await read('README.md')).toContain('e2e-test-data');
    expect(await read('docs/skills.md')).toContain('DevAudit ships nine AI skills');
    expect(await read('docs/skills.md')).toContain('| `e2e-test-data` |');
    expect(await read('sdlc/SKILLS.md')).toContain('| `e2e-test-data`');
    expect(await read('docs/prompts-faq.md')).toContain('`e2e-test-data`');
    expect(await read('.devin/workflows/devaudit-update-install.md')).toContain('e2e-test-data');
  });
});

describe('the example config and docs', () => {
  it('the example config documents the test-data keys and stays valid JSON', async () => {
    const parsed = JSON.parse(await read('sdlc/files/sdlc-config.example.json')) as Record<string, unknown>;
    expect(String(parsed['_comment_e2e_data'])).toContain('e2e_data_isolation');
  });

  it('the stale "What DevAudit ships today" section is reconciled', async () => {
    const text = await read('docs/e2e-test-tiers.md');
    expect(text).toContain('The three-tier model is generated');
    expect(text).toContain('## Test data (#1116)');
  });
});
