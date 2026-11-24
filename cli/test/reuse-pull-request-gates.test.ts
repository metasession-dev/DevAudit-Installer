import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { execa } from 'execa';
import { syncProject } from '../src/update/index.js';
import { findConfigKey, validateConfigKeyValue } from '../src/lib/repo-config-keys.js';
import { NOT_ASKED } from '@metasession.co/devaudit-core';

// DevAudit-Installer#1298 — a merge reuses the pull request run's quality-gate result when the merged tree is the
// tree that run tested. On unless `reuse_pull_request_gates` is false.

vi.setConfig({ testTimeout: 120_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

let prevRoot: string | undefined;
beforeAll(() => {
  prevRoot = process.env['DEVAUDIT_INSTALLER_ROOT'];
  process.env['DEVAUDIT_INSTALLER_ROOT'] = ROOT;
});
afterAll(() => {
  if (prevRoot === undefined) delete process.env['DEVAUDIT_INSTALLER_ROOT'];
  else process.env['DEVAUDIT_INSTALLER_ROOT'] = prevRoot;
});

type Doc = Record<string, any>;
const parse = (t: string): Doc => yamlLoad(t) as Doc;

const BASE = {
  project_slug: 'fixture-app',
  stack: 'node',
  host: 'railway',
  node_version: '20',
  python_version: '3.12',
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
  paths_ignore: ['SDLC/**', 'compliance/**'],
};

async function render(config: Record<string, unknown>): Promise<Record<string, string>> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-reuse-'));
  try {
    await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ ...BASE, ...config }));
    await fs.writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture-app', private: true, version: '0.0.0', devDependencies: { husky: '*', '@commitlint/cli': '*', '@commitlint/config-conventional': '*', 'lint-staged': '*', prettier: '*', eslint: '*', typescript: '*', '@playwright/test': '*' } }),
    );
    for (const d of ['.husky', 'scripts', '.github/workflows']) await fs.mkdir(join(dir, d), { recursive: true });
    await syncProject(dir);
    const out: Record<string, string> = {};
    for (const f of await fs.readdir(join(dir, '.github', 'workflows'))) out[f] = (await fs.readFile(join(dir, '.github', 'workflows', f), 'utf8')).replace(/\r\n/g, '\n');
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const needsOf = (job: Doc): string[] => (Array.isArray(job['needs']) ? job['needs'] : job['needs'] ? [job['needs']] : []);
const stepNames = (job: Doc): string[] => (job['steps'] as Array<Record<string, any>>).map((s) => String(s['name'] ?? ''));

for (const stack of ['node', 'python'] as const) {
  describe(`${stack}: reuse on (the default)`, () => {
    let ci: string;
    let jobs: Doc;
    beforeAll(async () => {
      ci = (await render({ stack }))['ci.yml']!;
      jobs = parse(ci)['jobs'];
    }, 120_000);

    it('adds the finder, the light job and keeps every job', () => {
      expect(Object.keys(jobs)).toEqual(expect.arrayContaining(['quality-gates', 'find-tested-run', 'quality-gates-reused', 'register-release', 'upload-evidence']));
    });

    it('the finder runs on a push to the integration branch only, with read permissions, and cannot fail the run', () => {
      const f = jobs['find-tested-run'];
      expect(f['if']).toContain("github.event_name == 'push'");
      expect(f['if']).toContain("github.ref_name == 'develop'");
      expect(f['permissions']).toEqual({ contents: 'read', 'pull-requests': 'read', actions: 'read' });
      const step = (f['steps'] as Array<Record<string, any>>).find((s) => s['id'] === 'find')!;
      expect(step['continue-on-error']).toBe(true);
      expect(step['run']).toBe('bash scripts/find-tested-run.sh');
      expect(Object.keys(f['outputs'])).toEqual(['reuse', 'reason', 'source_run_id', 'source_pr', 'tested_tree']);
    });

    it('the heavy job waits for the finder and is skipped only when reuse is exactly true', () => {
      const g = jobs['quality-gates'];
      expect(needsOf(g)).toContain('find-tested-run');
      expect(g['if']).toContain("needs.find-tested-run.outputs.reuse != 'true'");
      expect(g['if']).toContain('always()');
      expect(g['name']).toBe('Quality Gates');
    });

    it('the light job has its own name, so a pull request never carries a second check named Quality Gates', () => {
      const l = jobs['quality-gates-reused'];
      expect(l['name']).toBe('Reused Quality Gates');
      expect(l['if']).toContain("needs.find-tested-run.outputs.reuse == 'true'");
      expect(l['if']).toContain('always()');
      expect(needsOf(l)).toContain('find-tested-run');
      const names = Object.values(jobs).map((j) => (j as Doc)['name']);
      expect(names.filter((n) => n === 'Quality Gates')).toHaveLength(1);
    });

    it('the evidence job waits for both, downloads the source run only on reuse, and notes the reuse', () => {
      const e = jobs['upload-evidence'];
      expect(needsOf(e)).toEqual(expect.arrayContaining(['quality-gates', 'quality-gates-reused', 'find-tested-run', 'register-release']));
      expect(e['permissions']).toEqual({ contents: 'read', actions: 'read' });
      const steps = e['steps'] as Array<Record<string, any>>;
      const reused = steps.find((s) => String(s['name']).startsWith('Download the CI gate artifacts of the pull request run'))!;
      expect(reused['if']).toBe("needs.find-tested-run.outputs.reuse == 'true'");
      expect(reused['with']['run-id']).toBe('${{ needs.find-tested-run.outputs.source_run_id }}');
      expect(reused['with']['github-token']).toBe('${{ github.token }}');
      expect(reused['continue-on-error']).toBeUndefined();
      const own = steps.find((s) => s['name'] === 'Download CI gate artifacts')!;
      expect(own['if']).toBe("needs.find-tested-run.outputs.reuse != 'true'");
      expect(own['continue-on-error']).toBe(true);
      const note = steps.find((s) => s['name'] === 'Note the reuse in the gate outcomes')!;
      expect(String(note['run'])).toContain('reused_from_run');
      expect(String(note['run'])).toContain('reused_from_pr');
    });

    it('the pull request run records the tree it tested, as an artifact of its own', () => {
      const steps = jobs['quality-gates']['steps'] as Array<Record<string, any>>;
      const record = steps.find((s) => s['name'] === 'Record the tested tree')!;
      expect(record['if']).toBe("always() && github.event_name == 'pull_request'");
      expect(String(record['run'])).toContain("git rev-parse 'HEAD^{tree}'");
      const upload = steps.find((s) => s['with']?.['name'] === 'tested-tree')!;
      expect(upload['with']['path']).toBe('reuse-record/');
      // ci-results is still uploaded
      expect(steps.some((s) => s['with']?.['name'] === 'ci-results')).toBe(true);
    });

    it('the generated run blocks stay small', () => {
      for (const job of Object.values(jobs) as Doc[]) for (const step of job['steps'] ?? []) if (typeof step['run'] === 'string') expect(Buffer.byteLength(step['run'])).toBeLessThan(20000);
    });
  });

  describe(`${stack}: reuse_pull_request_gates false`, () => {
    it('opts out: none of the new jobs, steps or conditions appear', async () => {
      const ci = (await render({ stack, reuse_pull_request_gates: false }))['ci.yml']!;
      for (const needle of ['find-tested-run', 'quality-gates-reused', 'Reused Quality Gates', 'tested-tree', 'reused_from', 'REUSE_']) expect(ci, needle).not.toContain(needle);
      const jobs = parse(ci)['jobs'];
      expect(Object.keys(jobs)).toEqual(['quality-gates', 'register-release', 'upload-evidence']);
      expect(needsOf(jobs['upload-evidence'])).toEqual(['quality-gates', 'register-release']);
      expect(jobs['upload-evidence']['permissions']).toBeUndefined();
    });
  });
}

describe('node: the opt-out and the default keep the rest of the workflow', () => {
  it('opt-out keeps today\'s gate result and condition lines', async () => {
    const ci = (await render({ reuse_pull_request_gates: false }))['ci.yml']!;
    expect(ci).toContain('needs: [register-release]\n    if: ${{ always() && (github.event_name != \'pull_request\' || !startsWith(github.head_ref, \'chore/close-out-\')) && (github.event_name == \'pull_request\' || needs.register-release.result == \'success\') }}');
    expect(ci).toContain('case "${{ needs.quality-gates.result }}" in');
    expect(ci).toContain('--details-json \'{"executionSource":"needs.quality-gates.result","evidenceUploadJob":"${{ job.status }}"}\'');
  });

  it('on, the outcome and the release check read the light job when it ran', async () => {
    const ci = (await render({}))['ci.yml']!;
    expect(ci).toContain("case \"${{ needs.quality-gates-reused.result == 'success' && 'success' || needs.quality-gates.result }}\" in");
    expect(ci).toContain('"reusedFromRun":"${{ needs.find-tested-run.outputs.source_run_id }}"');
  });

  it('a pull request run still has exactly the gates job: the finder and light jobs do not apply to it', async () => {
    const jobs = parse((await render({}))['ci.yml']!)['jobs'];
    expect(jobs['find-tested-run']['if']).toContain("'push'");
    expect(jobs['register-release']['if']).toContain("github.event_name != 'pull_request'");
    expect(jobs['quality-gates']['if']).toContain("github.event_name == 'pull_request'");
  });

  it('every step of the evidence and gates jobs still renders (no unreplaced token)', async () => {
    for (const body of Object.values(await render({}))) expect(body).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});

describe('the release pull request accepts the reuse job', () => {
  it('on, the provenance workflow names the reuse check; off it does not', async () => {
    const on = (await render({}))['quality-gates-provenance.yml']!;
    expect(on).toContain('QG_REUSED_NAME: Reused Quality Gates');
    expect(on).toContain('QG_NAME: Quality Gates');
    const off = (await render({ reuse_pull_request_gates: false }))['quality-gates-provenance.yml']!;
    expect(off).not.toContain('QG_REUSED_NAME');
    expect(off).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});

describe('several targets', () => {
  const target = { stack: 'node', working_directory: '.', source_dirs: 'app/ lib/', production_url_secret: 'FIXTURE_PROD_URL', devaudit: { project_slug: 'fixture-app' } };
  it('namespaces the reuse job once, and the provenance workflow names the same check', async () => {
    const files = await render({
      targets: [
        { name: 'web', ...target },
        { name: 'api', ...target, stack: 'python', working_directory: 'api', devaudit: { project_slug: 'fixture-api' } },
      ],
    });
    for (const t of ['web', 'api']) {
      const jobs = parse(files[`ci-${t}.yml`]!)['jobs'];
      expect(jobs['quality-gates']['name']).toBe(`Quality Gates (${t})`);
      expect(jobs['quality-gates-reused']['name']).toBe(`Reused Quality Gates (${t})`);
      expect(jobs['find-tested-run']['name']).toBe(`Find tested run (${t})`);
      const prov = files[`quality-gates-provenance-${t}.yml`]!;
      expect(prov).toContain(`QG_REUSED_NAME: Reused Quality Gates (${t})`);
      expect(prov).toContain(`QG_NAME: Quality Gates (${t})`);
    }
  });
});

describe('the config key', () => {
  it('is a boolean that regenerates ci.yml and is not asked in onboarding', () => {
    expect(findConfigKey('reuse_pull_request_gates')?.type).toBe('boolean');
    expect(findConfigKey('reuse_pull_request_gates')?.affects).toContain('.github/workflows/ci.yml');
    expect(validateConfigKeyValue('reuse_pull_request_gates', 'false')).toEqual({ value: false });
    expect(validateConfigKeyValue('reuse_pull_request_gates', 'maybe').error).toBeDefined();
    expect(NOT_ASKED['reuse_pull_request_gates']).toBeDefined();
  });
});

describe('the finder script is synced with the other scripts', () => {
  it('is in the common scripts directory and executable by bash', async () => {
    const p = join(ROOT, 'sdlc', 'files', '_common', 'scripts', 'find-tested-run.sh');
    const body = await fs.readFile(p, 'utf8');
    expect(body.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(body).toContain('reuse=false');
    expect(stepNames({ steps: [] })).toEqual([]);
  });
});

describe('the new run blocks, executed against fixtures', () => {
  const runBlock = (jobs: Doc, job: string, name: string): string =>
    String(((jobs[job]['steps'] as Array<Record<string, any>>).find((s) => s['name'] === name) as Record<string, any>)['run']);

  for (const stack of ['node', 'python'] as const) {
    it(`${stack}: records the tested tree and the gate outcomes of a pull request run`, async () => {
      const jobs = parse((await render({ stack }))['ci.yml']!)['jobs'];
      const dir = await fs.mkdtemp(join(tmpdir(), 'cli-reuse-record-'));
      try {
        await execa('git', ['init', '-q', '-b', 'main'], { cwd: dir });
        await execa('git', ['-c', 'user.email=t@e.test', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: dir });
        const outcomes = stack === 'python' ? join(dir, 'ci-evidence', 'gate-outcomes.json') : join(dir, 'gate-outcomes.json');
        await fs.mkdir(dirname(outcomes), { recursive: true });
        await fs.writeFile(outcomes, '{"sast":"success"}');
        await fs.writeFile(join(dir, 'step.sh'), runBlock(jobs, 'quality-gates', 'Record the tested tree'));
        await execa('bash', [join(dir, 'step.sh')], { cwd: dir, env: { GITHUB_WORKSPACE: dir } });
        const tree = (await execa('git', ['rev-parse', 'HEAD^{tree}'], { cwd: dir })).stdout.trim();
        expect((await fs.readFile(join(dir, 'reuse-record', 'tested-tree.txt'), 'utf8')).trim()).toBe(tree);
        expect(await fs.readFile(join(dir, 'reuse-record', 'gate-outcomes.json'), 'utf8')).toBe('{"sast":"success"}');
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it(`${stack}: notes the reuse in the downloaded gate outcomes and keeps the gates`, async () => {
      const jobs = parse((await render({ stack }))['ci.yml']!)['jobs'];
      const dir = await fs.mkdtemp(join(tmpdir(), 'cli-reuse-note-'));
      try {
        await fs.mkdir(join(dir, 'ci-evidence'), { recursive: true });
        const file = join(dir, 'ci-evidence', 'gate-outcomes.json');
        await fs.writeFile(file, '{"typescript":"success","sast":"success"}');
        await fs.writeFile(join(dir, 'step.sh'), runBlock(jobs, 'upload-evidence', 'Note the reuse in the gate outcomes'));
        await execa('bash', [join(dir, 'step.sh')], { cwd: dir, env: { SOURCE_RUN: '101', SOURCE_PR: '42', TESTED_TREE: 'abc123' } });
        expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ typescript: 'success', sast: 'success', reused_from_run: '101', reused_from_pr: '42', reused_tested_tree: 'abc123' });
        await expect(fs.stat(`${file}.tmp`)).rejects.toThrow();
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  }
});
