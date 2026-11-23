import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { load as yamlLoad } from 'js-yaml';
import { syncProject } from '../src/update/index.js';
import { findConfigKey, validateConfigKeyValue } from '../src/lib/repo-config-keys.js';

// DevAudit-Installer#1290 — `paths_ignore_pull_request`: a docs-only pull request skips the full Quality Gates, and
// the status fallback reports `Quality Gates` for it, and only for it.

vi.setConfig({ testTimeout: 120_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');

let prevRoot: string | undefined;
beforeAll(() => {
  prevRoot = process.env['DEVAUDIT_INSTALLER_ROOT'];
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
});
afterAll(() => {
  if (prevRoot === undefined) delete process.env['DEVAUDIT_INSTALLER_ROOT'];
  else process.env['DEVAUDIT_INSTALLER_ROOT'] = prevRoot;
});

const BASE = {
  project_slug: 'fixture-app',
  stack: 'node',
  host: 'railway',
  node_version: '20',
  runner: 'ubuntu-latest',
  working_directory: '.',
  source_dirs: 'app/ lib/',
  sast_baseline: 0,
  accepted_dep_risks: '',
  production_url_secret: 'FIXTURE_PROD_URL',
  database_service: '',
  database_image: '',
  database_port: '',
  e2e_project: 'chromium',
  e2e_start_command: 'npm run dev',
  paths_ignore: ['SDLC/**', 'compliance/**', '*.md'],
};

async function render(config: Record<string, unknown>): Promise<{ ci: string; fallback: string }> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-pathsignore-'));
  try {
    await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ ...BASE, ...config }));
    await fs.writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture-app', private: true, version: '0.0.0', devDependencies: { husky: '*', '@commitlint/cli': '*', '@commitlint/config-conventional': '*', 'lint-staged': '*', prettier: '*', eslint: '*', typescript: '*', '@playwright/test': '*' } }),
    );
    for (const d of ['.husky', 'scripts', '.github/workflows']) await fs.mkdir(join(dir, d), { recursive: true });
    await syncProject(dir);
    const read = async (f: string) => (await fs.readFile(join(dir, '.github', 'workflows', f), 'utf8')).replace(/\r\n/g, '\n');
    return { ci: await read('ci.yml'), fallback: await read('ci-status-fallback.yml') };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

type Doc = Record<string, any>;
const parse = (text: string): Doc => yamlLoad(text) as Doc;

describe('paths_ignore_pull_request is off (the default)', () => {
  it('leaves ci.yml with no path filter on pull_request, and the fallback as it was', async () => {
    const { ci, fallback } = await render({});
    const doc = parse(ci);
    expect(doc['on']['pull_request']).toEqual({ branches: ['develop'] });
    const fb = parse(fallback);
    expect(Object.keys(fb['on']).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(Object.keys(fb['jobs'])).toEqual(['quality-gates']);
    expect(fb['jobs']['quality-gates']['name']).toBe('Quality Gates');
    expect(fb['permissions']).toEqual({ contents: 'read', statuses: 'write' });
    expect(fallback).not.toContain('classify');
  });

  it('keeps the fallback job text exactly as before', async () => {
    const { fallback } = await render({ paths_ignore_pull_request: false });
    expect(fallback.endsWith(
      [
        'jobs:',
        '  quality-gates:',
        '    name: Quality Gates',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Acknowledge docs/compliance-only commit',
        '        run: |',
        '          echo "Commit ${{ github.sha }} only touches docs/compliance paths."',
        '          echo "Heavy quality-gates workflow (ci.yml) was correctly skipped."',
        '          echo "This fallback emits the \'Quality Gates\' status so branch protection is satisfied."',
        '',
      ].join('\n'),
    )).toBe(true);
  });
});

describe('paths_ignore_pull_request is on', () => {
  it('applies paths_ignore to ci.yml\'s pull_request trigger, the same patterns as its push filter plus sdlc-config.json', async () => {
    const { ci } = await render({ paths_ignore_pull_request: true });
    const doc = parse(ci);
    const pr = doc['on']['pull_request'];
    expect(pr['branches']).toEqual(['develop']);
    expect(pr['paths-ignore']).toEqual(['SDLC/**', 'compliance/**', '*.md', 'sdlc-config.json']);
    for (const p of doc['on']['push']['paths-ignore'] as string[]) expect(pr['paths-ignore']).toContain(p);
  });

  it('does not repeat sdlc-config.json when paths_ignore already lists it', async () => {
    const { ci } = await render({ paths_ignore_pull_request: true, paths_ignore: ['compliance/**', 'sdlc-config.json'] });
    expect(parse(ci)['on']['pull_request']['paths-ignore']).toEqual(['compliance/**', 'sdlc-config.json']);
  });

  it('fires the fallback on exactly the paths ci.yml ignores for pull requests: the complement, so one of them always runs', async () => {
    const { ci, fallback } = await render({ paths_ignore_pull_request: true });
    const fb = parse(fallback);
    expect(fb['on']['pull_request']['paths']).toEqual(parse(ci)['on']['pull_request']['paths-ignore']);
    expect(fb['on']['pull_request']['branches']).toEqual(['develop']);
    expect(fb['on']['push']['paths']).toEqual(expect.arrayContaining(['SDLC/**', 'compliance/**', '*.md']));
  });

  it('needs to read the pull request\'s files, and nothing more', async () => {
    const fb = parse((await render({ paths_ignore_pull_request: true })).fallback);
    expect(fb['permissions']).toEqual({ contents: 'read', statuses: 'write', 'pull-requests': 'read' });
  });

  it('names the Quality Gates job from a classify job, so a pull request with code never gets a second check of that name', async () => {
    const fb = parse((await render({ paths_ignore_pull_request: true })).fallback);
    expect(Object.keys(fb['jobs'])).toEqual(['classify', 'quality-gates']);
    expect(fb['jobs']['classify']['name']).toBe('Classify the change');
    expect(fb['jobs']['quality-gates']['needs']).toBe('classify');
    expect(fb['jobs']['quality-gates']['name']).toBe('${{ needs.classify.outputs.gate_name }}');
    expect(fb['jobs']['classify']['outputs']['gate_name']).toBe('${{ steps.classify.outputs.gate_name }}');
  });

  it('works for a Python project too', async () => {
    const { ci, fallback } = await render({ paths_ignore_pull_request: true, stack: 'python', python_version: '3.12', node_version: undefined });
    expect(parse(ci)['on']['pull_request']['paths-ignore']).toContain('compliance/**');
    expect(parse(fallback)['on']['pull_request']['paths']).toContain('compliance/**');
  });

  it('an invalid key value is refused by configure, and the key regenerates the two workflows', () => {
    const spec = findConfigKey('paths_ignore_pull_request');
    expect(spec?.type).toBe('boolean');
    expect(spec?.affects).toEqual(expect.arrayContaining(['.github/workflows/ci.yml', '.github/workflows/ci-status-fallback.yml']));
    expect(validateConfigKeyValue('paths_ignore_pull_request', 'true')).toEqual({ value: true });
    expect(validateConfigKeyValue('paths_ignore_pull_request', 'sometimes').error).toBeDefined();
  });
});

describe('the classify step, run for real against a fake gh', () => {
  async function classify(files: string[], event: 'pull_request' | 'push' | 'workflow_dispatch', ghFails = false) {
    const { fallback } = await render({ paths_ignore_pull_request: true });
    const doc = parse(fallback);
    const step = (doc['jobs']['classify']['steps'] as Array<Record<string, any>>).find((s) => s['id'] === 'classify')!;
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-classify-'));
    try {
      await fs.mkdir(join(dir, 'scripts'));
      await fs.mkdir(join(dir, 'bin'));
      await fs.copyFile(join(INSTALLER_ROOT, 'sdlc', 'files', '_common', 'scripts', 'provenance-gated-commit.sh'), join(dir, 'scripts', 'provenance-gated-commit.sh'));
      const calls = join(dir, 'gh.log');
      await fs.writeFile(
        join(dir, 'bin', 'gh'),
        `#!/usr/bin/env bash\necho "$*" >> "${calls}"\n${ghFails ? 'echo "gh: not authenticated" >&2; exit 1' : `printf '%s\\n' ${files.map((f) => `'${f}'`).join(' ')}`}\n`,
        { mode: 0o755 },
      );
      await fs.writeFile(join(dir, 'step.sh'), String(step['run']));
      const out = join(dir, 'github_output');
      await fs.writeFile(out, '');
      const env = step['env'] as Record<string, string>;
      const result = await execa('bash', [join(dir, 'step.sh')], {
        cwd: dir,
        reject: false,
        env: {
          PATH: `${join(dir, 'bin')}:${process.env['PATH']}`,
          GITHUB_OUTPUT: out,
          GH_TOKEN: 't',
          EVENT_NAME: event,
          REPOSITORY: 'example-org/example-app',
          PR_NUMBER: '42',
          PATHS_IGNORE: env['PATHS_IGNORE']!,
        },
      });
      const called = await fs.readFile(calls, 'utf8').catch(() => '');
      return { code: result.exitCode, output: (await fs.readFile(out, 'utf8')).trim(), called, stderr: result.stderr };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it('a docs-only pull request is named Quality Gates', async () => {
    const r = await classify(['compliance/evidence/REQ-1/plan.md', 'SDLC/1-plan.md', 'README.md', 'sdlc-config.json'], 'pull_request');
    expect(r.code).toBe(0);
    expect(r.output).toBe('gate_name=Quality Gates');
    expect(r.called).toContain('repos/example-org/example-app/pulls/42/files');
    expect(r.called).toContain('--paginate');
  });

  it('a pull request with a code file is NOT named Quality Gates, so ci.yml is the only check of that name', async () => {
    const r = await classify(['compliance/evidence/REQ-1/plan.md', 'src/app.ts'], 'pull_request');
    expect(r.code).toBe(0);
    expect(r.output).not.toBe('gate_name=Quality Gates');
    expect(r.output).toContain('gate_name=Quality Gates not reported here');
  });

  it('a nested markdown file is code: *.md covers the root only', async () => {
    const r = await classify(['docs/guide.md'], 'pull_request');
    expect(r.output).toContain('not reported here');
  });

  it('a pull request with no files listed is treated as code', async () => {
    const r = await classify([], 'pull_request');
    expect(r.output).toContain('not reported here');
  });

  it('a push or a manual run keeps the unconditional Quality Gates, and asks GitHub nothing', async () => {
    for (const event of ['push', 'workflow_dispatch'] as const) {
      const r = await classify(['src/app.ts'], event);
      expect(r.output, event).toBe('gate_name=Quality Gates');
      expect(r.called, event).toBe('');
    }
  });

  it('when the file list cannot be read the step fails and reports nothing: the pull request waits, it never passes on a guess', async () => {
    const r = await classify([], 'pull_request', true);
    expect(r.code).not.toBe(0);
    expect(r.output).toBe('');
  });
});
