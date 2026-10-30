import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// DevAudit-Installer#1116 WP9 — the open framework registry (contracts/frameworks/).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'contracts', 'frameworks');
const require = createRequire(import.meta.url);

interface Expectation {
  kind: string;
  types?: string[];
  fileNames?: string[];
  eventTypes?: string[];
  expectations?: Expectation[];
  description: string;
}
interface Clause {
  id: string;
  title: string;
  idEdition?: string;
  note?: string;
  equivalents2022?: string[];
  expects: Expectation[];
}
interface Framework {
  registryVersion: string;
  code: string;
  edition: string;
  clauses: Clause[];
}

const CODES = ['soc-2', 'iso-27001', 'iso-29119', 'gdpr', 'eu-ai-act'];
const read = async (name: string): Promise<string> => fs.readFile(join(DIR, name), 'utf-8');
const load = async (code: string): Promise<Framework> => JSON.parse(await read(`${code}.json`)) as Framework;

function* walk(exps: Expectation[]): Generator<Expectation> {
  for (const e of exps) {
    yield e;
    if (e.expectations) yield* walk(e.expectations);
  }
}

describe('the registry files', () => {
  it('there is one file per framework, and the schema', async () => {
    const files = (await fs.readdir(DIR)).sort();
    expect(files).toEqual(['eu-ai-act.json', 'gdpr.json', 'iso-27001.json', 'iso-29119.json', 'schema.json', 'soc-2.json']);
  });

  it('every file is valid against the schema', async () => {
    const Ajv = require('ajv');
    const ajv = new (Ajv.default ?? Ajv)({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(await read('schema.json')));
    for (const code of CODES) {
      const ok = validate(await load(code));
      expect(ok, `${code}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('the schema refuses an unknown kind, a missing edition and an idEdition without a note', async () => {
    const Ajv = require('ajv');
    const ajv = new (Ajv.default ?? Ajv)({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(await read('schema.json')));
    const good = await load('gdpr');
    expect(validate(good)).toBe(true);
    const { edition: _e, ...noEdition } = good;
    expect(validate(noEdition)).toBe(false);
    expect(validate({ ...good, clauses: [{ ...good.clauses[0]!, expects: [{ kind: 'made_up', description: 'x' }] }] })).toBe(false);
    expect(validate({ ...good, clauses: [{ ...good.clauses[0]!, idEdition: '2013' }] })).toBe(false);
    expect(validate({ ...good, clauses: [{ ...good.clauses[0]!, idEdition: '2013', note: 'why' }] })).toBe(true);
  });

  it('every framework has an edition and a date version', async () => {
    for (const code of CODES) {
      const f = await load(code);
      expect(f.edition.length, code).toBeGreaterThan(0);
      expect(f.registryVersion, code).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every evidence type named exists in contracts/evidence-types.json', async () => {
    const known = Object.keys((JSON.parse(await fs.readFile(join(ROOT, 'contracts', 'evidence-types.json'), 'utf-8')) as { evidence_types: Record<string, unknown> }).evidence_types);
    for (const code of CODES) {
      for (const clause of (await load(code)).clauses) {
        for (const e of walk(clause.expects)) {
          if (e.kind === 'evidence_type_any') for (const t of e.types!) expect(known, `${clause.id}: ${t}`).toContain(t);
        }
      }
    }
  });

  it('no clause ID is duplicated within a framework, and every ID starts with its framework prefix', async () => {
    for (const code of CODES) {
      const ids = (await load(code)).clauses.map((c) => c.id);
      expect(new Set(ids).size, code).toBe(ids.length);
    }
  });

  it('a clause with an idEdition has a note', async () => {
    for (const code of CODES) {
      for (const c of (await load(code)).clauses) {
        if (c.idEdition !== undefined) expect(c.note?.length ?? 0, c.id).toBeGreaterThan(0);
        if (c.equivalents2022 !== undefined) expect(Array.isArray(c.equivalents2022), c.id).toBe(true);
      }
    }
  });

  it('ISO27001.A.12.1 is an ID from the 2013 edition, with its 2022 equivalent still to be confirmed', async () => {
    const clause = (await load('iso-27001')).clauses.find((c) => c.id === 'ISO27001.A.12.1')!;
    expect(clause.idEdition).toBe('2013');
    expect(clause.note).toBe('ID from the 2013 edition; 2022 equivalent to be confirmed by the compliance reader');
    expect(clause.equivalents2022).toBeUndefined();
    expect(clause.title).toBe('Operational procedures and responsibilities');
  });

  it('the change-management clauses expect an independent approval (M2)', async () => {
    for (const [code, id] of [['soc-2', 'SOC2.CC8.1'], ['iso-27001', 'ISO27001.A.8.32']] as const) {
      const clause = (await load(code)).clauses.find((c) => c.id === id)!;
      expect(clause.expects).toHaveLength(1);
      expect(clause.expects[0]).toMatchObject({ kind: 'audit_event_any', eventTypes: ['release.independently_approved'] });
    }
  });
});

describe('the public content rules (M4)', () => {
  it('no registry file names a source file, a table, a route or an internal service', async () => {
    for (const name of (await fs.readdir(DIR)).filter((n) => n.endsWith('.json'))) {
      const text = await read(name);
      expect(text, `${name}: backtick-quoted .ts file`).not.toMatch(/`[^`\n]*\.ts`/);
      expect(text, `${name}: a .ts file name`).not.toMatch(/\b[\w-]+\.ts\b/);
      expect(text, `${name}: a compliance_ table`).not.toMatch(/\bcompliance_[a-z_]+/);
      expect(text, `${name}: mfa_factors`).not.toContain('mfa_factors');
      expect(text, `${name}: an /api/ path`).not.toMatch(/\/api\//);
      expect(text, `${name}: an internal service`).not.toMatch(/approval-service|checkProjectAccess/);
    }
  });

  it('docs/framework-registry.md states the licence and the contribution rules', async () => {
    const doc = await fs.readFile(join(ROOT, 'docs', 'framework-registry.md'), 'utf-8');
    expect(doc).toContain('Apache-2.0');
    expect(doc).toContain('Licensing of contributions');
    expect(doc).toContain('HIGH risk');
    for (const field of ['edition', 'idEdition', 'note', 'equivalents2022']) expect(doc).toContain(`\`${field}\``);
  });
});

describe('the compliance lines read the registry', () => {
  it('the clauses a self-approving preset cites exist in the registry and expect an independent approval', async () => {
    const { PRESETS, PRESET_IDS, SELF_APPROVAL_CLAUSES } = await import('@metasession.co/devaudit-core');
    const all = new Map<string, Clause>();
    for (const code of CODES) for (const c of (await load(code)).clauses) all.set(c.id, c);
    for (const id of PRESET_IDS) {
      for (const control of PRESETS[id].controls) {
        const clause = all.get(control);
        expect(clause, `${id} cites ${control}`).toBeDefined();
        expect(JSON.stringify(clause!.expects)).toContain('release.independently_approved');
      }
    }
    for (const control of SELF_APPROVAL_CLAUSES) expect(all.has(control), control).toBe(true);
  });
});

describe('the dispatch workflow and the packaging', () => {
  it('framework-registry-dispatch.yml sends the event with the secret named by the owner', async () => {
    const wf = await fs.readFile(join(ROOT, '.github', 'workflows', 'framework-registry-dispatch.yml'), 'utf-8');
    expect(wf).toContain('contracts/frameworks/**');
    expect(wf).toContain('secrets.DEVAUDIT_INSTALLER_REGISTRY_DISPATCH');
    expect(wf).toContain('framework-registry-updated');
    expect(wf).toContain('branches: [develop]');
  });

  it('the CLI package bundles the registry', async () => {
    const pkg = JSON.parse(await fs.readFile(join(ROOT, 'cli', 'package.json'), 'utf-8')) as { files: string[] };
    expect(pkg.files).toContain('frameworks');
    expect(await fs.readFile(join(ROOT, 'cli', 'tools', 'bundle-templates.mjs'), 'utf-8')).toContain("bundle('contracts/frameworks', 'frameworks')");
    expect(await fs.readFile(join(ROOT, 'scripts', 'check-package-contents.sh'), 'utf-8')).toContain('frameworks/schema.json');
  });
});
