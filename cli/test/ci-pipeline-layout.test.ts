import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { renderAll } from './helpers/render-workflows.js';
import { jobSection } from './helpers/workflow-jobs.js';
import { syncProject } from '../src/update/index.js';
import { sha256, writeManifest } from '../src/update/sync-manifest.js';
import { includeFragments } from '../src/lib/templates.js';
import { RETIRED_CONFIG_KEYS, validateConfigKeyValue } from '../src/lib/repo-config-keys.js';
import { REPLACED_WORKFLOWS_PATTERN } from '../src/update/ci-templates.js';

// DevAudit-Installer#1335 WP2 — the single CI pipeline: one ci.yml per target, a plan job, one required check.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const FRAGMENTS = join(ROOT, 'sdlc', 'files', 'ci', 'fragments');
beforeAll(() => {
  process.env['DEVAUDIT_INSTALLER_ROOT'] = ROOT;
});

type Job = { name?: string; needs?: string | string[]; if?: string; 'runs-on'?: string; steps?: Array<Record<string, unknown>> };
type Workflow = { on?: Record<string, unknown>; [k: string]: unknown; concurrency?: { group: string; 'cancel-in-progress': string }; jobs: Record<string, Job> };
const parse = (text: string): Workflow => yamlLoad(text) as Workflow;
const triggers = (wf: Workflow) => (wf.on ?? (wf as unknown as Record<string, unknown>)['true']) as Record<string, unknown>;

const VARIANTS: Array<[string, 'node' | 'python', Record<string, unknown>]> = [
  ['node', 'node', {}],
  ['node with pytest', 'node', { test_runner: 'pytest' }],
  ['python', 'python', {}],
  ['python with pytest', 'python', { test_runner: 'pytest' }],
  ['node without a database', 'node', { database_service: '' }],
  ['node with custom branches', 'node', { integration_branch: 'next', release_branch: 'production' }],
];

describe('the rendered ci.yml (#1335)', { timeout: 300_000 }, () => {
  for (const [label, stack, extra] of VARIANTS) {
    it(`${label}: one workflow, the plan-driven jobs, one Quality Gates`, async () => {
      const wf = await renderAll(stack, extra);
      const text = wf['ci.yml']!;
      expect(text, 'no unresolved template token').not.toMatch(/(?<!\$)\{\{\s*[A-Za-z_:]+/);
      const ci = parse(text);
      const integration = (extra['integration_branch'] as string) ?? 'develop';
      const release = (extra['release_branch'] as string) ?? 'main';
      const on = triggers(ci);
      expect(on['pull_request']).toEqual({ branches: [integration, release] });
      expect(on['push']).toEqual({ branches: [integration] });
      expect(text).not.toMatch(/^ {4}paths(-ignore)?:/m);
      expect(ci.concurrency).toEqual({
        group: "${{ github.workflow }}-${{ github.event_name == 'push' && github.sha || github.ref }}",
        'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
      });
      const ids = Object.keys(ci.jobs).sort();
      expect(ids).toEqual(['e2e-scope-decision', 'feature-e2e', 'plan', 'quality-gates', 'register-release', 'release-provenance', 'release-scope-integrity', 'required-check', 'upload-evidence'].sort());
      const named = Object.values(ci.jobs).filter((j) => j.name === 'Quality Gates');
      expect(named).toHaveLength(1);
      expect(ci.jobs['required-check']!.name).toBe('Quality Gates');
      expect(ci.jobs['required-check']!.if).toBe('always()');
      expect(ci.jobs['required-check']!.needs).toEqual(['plan', 'register-release', 'quality-gates', 'release-provenance']);
      expect(ci.jobs['quality-gates']!.name).toBe('Run quality gates');
      const runner = ci.jobs['plan']!['runs-on'];
      for (const [id, job] of Object.entries(ci.jobs)) expect(job['runs-on'], id).toBe(runner);
      for (const id of ['register-release', 'e2e-scope-decision', 'feature-e2e', 'release-scope-integrity', 'release-provenance']) {
        expect(ci.jobs[id]!.needs, id).toBe('plan');
        expect(ci.jobs[id]!.if, id).toMatch(/^needs\.plan\.outputs\.run_[a-z_]+ == 'true'$/);
      }
      // the plan job: the integration and release branches, and the runner kind
      const planEnv = (ci.jobs['plan']!.steps!.find((s) => s['id'] === 'plan')!['env'] as Record<string, string>);
      expect(planEnv['INTEGRATION_BRANCH']).toBe(integration);
      expect(planEnv['RELEASE_BRANCH']).toBe(release);
      expect(planEnv['TEST_RUNNER']).toBe(extra['test_runner'] === 'pytest' ? 'pytest' : 'playwright');
      expect(planEnv['REQUIRED_CHECK_NAME']).toBe('Quality Gates');
      // no other workflow reports the required check
      for (const gone of ['ci-status-fallback.yml', 'quality-gates-provenance.yml', 'feature-e2e.yml']) expect(wf[gone], gone).toBeUndefined();
      for (const [file, content] of Object.entries(wf)) {
        if (file === 'ci.yml') continue;
        expect(content, file).not.toMatch(/^ {4}name: Quality Gates$/m);
      }
    });
  }

  it('multi-target: each ci-<target>.yml namespaces the required check and the names that look for it', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-ci-pipeline-mt-'));
    try {
      const base = { stack: 'node', source_dirs: 'app/', production_url_secret: 'FIXTURE_PROD_URL' };
      await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({
        project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20', runner: 'self-hosted', working_directory: '.',
        source_dirs: 'app/', sast_baseline: 0, accepted_dep_risks: '', production_url_secret: 'FIXTURE_PROD_URL',
        database_service: '', e2e_project: 'chromium', e2e_start_command: 'npm run dev', paths_ignore: ['docs/**'],
        targets: [
          { name: 'web', ...base, working_directory: 'web', devaudit: { project_slug: 'fixture-web' } },
          { name: 'api', ...base, working_directory: 'api', devaudit: { project_slug: 'fixture-api' } },
        ],
      }));
      await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await syncProject(dir);
      for (const t of ['web', 'api']) {
        const text = await fs.readFile(join(dir, '.github', 'workflows', `ci-${t}.yml`), 'utf8');
        const ci = parse(text);
        expect(ci.jobs['required-check']!.name, t).toBe(`Quality Gates (${t})`);
        expect(jobSection(text, 'plan'), t).toContain(`REQUIRED_CHECK_NAME: Quality Gates (${t})`);
        expect(jobSection(text, 'release-provenance'), t).toContain(`QG_NAME: Quality Gates (${t})`);
        expect(Object.values(ci.jobs).filter((j) => j.name?.startsWith('Quality Gates'))).toHaveLength(1);
        const other = t === 'web' ? 'api' : 'web';
        expect(jobSection(text, 'plan'), t).toMatch(new RegExp(`- ['"]${other}/\\*\\*['"]`));
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('evidence identity is unchanged (#1335 invariant)', { timeout: 300_000 }, () => {
  it('the gate run, the feature run and the scope decision keep every evidence string', async () => {
    const node = (await renderAll('node'))['ci.yml']!;
    const gates = `${jobSection(node, 'quality-gates')}${jobSection(node, 'upload-evidence')}`;
    for (const literal of [
      '--external-job-id "quality-gates"',
      '--idempotency-key "github:${{ github.repository }}:quality-gates.quality_gate:${{ github.run_id }}:${{ github.run_attempt }}:2:${{ needs.register-release.outputs.version }}"',
      '--workflow-name "Quality Gates"',
      '--check-key "quality-gates:${{ github.run_id }}:${{ github.run_attempt }}"',
      '--label "Quality Gates"',
      '--suite-kind quality_gate',
      '--sdlc-stage 2 --environment ci --suite-kind quality_gate',
    ]) expect(gates, literal).toContain(literal);
    const feature = jobSection(node, 'feature-e2e');
    for (const literal of [
      '--idempotency-key "github:${{ github.repository }}:feature-in-scope-e2e.e2e:${{ github.run_id }}:${{ github.run_attempt }}:2:${REQ_ID}"',
      '--workflow-name "Feature In-Scope E2E"',
      '--meta-key "origin=feature"',
      '--category e2e_result --release "$RELEASE_ID" --create-release-if-missing',
    ]) expect(feature, literal).toContain(literal);
    expect(jobSection(node, 'e2e-scope-decision')).toMatch(/fixture-app "\$REQ_ID" e2e_scope_decision "\$ARTEFACT"/);
    const python = (await renderAll('python'))['ci.yml']!;
    expect(jobSection(python, 'upload-evidence')).toContain(':quality-gates-python.quality_gate:');
  });

  it('a reused merge reports passed, and carries the source run only when reused', async () => {
    const upload = jobSection((await renderAll('node'))['ci.yml']!, 'upload-evidence');
    expect(upload).toContain("case \"${{ needs.plan.outputs.reuse == 'true' && 'success' || needs.quality-gates.result }}\" in");
    expect(upload).toContain(`\${{ needs.plan.outputs.reuse == 'true' && format(',"reusedFromRun":"{0}","reusedFromPr":"{1}"', needs.plan.outputs.source_run_id, needs.plan.outputs.source_pr) || '' }}`);
    expect(upload).toContain("run-id: ${{ needs.plan.outputs.source_run_id }}");
  });
});

describe('the include pass (D9)', () => {
  it('inserts a fragment before the tokens are substituted', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-include-'));
    try {
      await fs.writeFile(join(dir, 'a.yml.template'), '  job:\n    runs-on: {{RUNNER}}\n');
      const out = await includeFragments('jobs:\n  {{INCLUDE:a}}\nend', { a: 'a.yml.template' }, dir);
      expect(out).toBe('jobs:\n  job:\n    runs-on: {{RUNNER}}\nend');
      expect(await includeFragments('no includes', {}, dir)).toBe('no includes');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses an unknown name and a fragment that includes another', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-include-'));
    try {
      await fs.writeFile(join(dir, 'b.yml.template'), '{{INCLUDE:a}}\n');
      await expect(includeFragments('{{INCLUDE:nope}}', { a: 'a.yml.template' }, dir)).rejects.toThrow("unknown fragment include 'nope'");
      await expect(includeFragments('{{INCLUDE:b}}', { b: 'b.yml.template' }, dir)).rejects.toThrow('contains an include line');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('no shipped fragment contains an include line or a GitHub-hosted runner', async () => {
    for (const f of await fs.readdir(FRAGMENTS)) {
      const text = await fs.readFile(join(FRAGMENTS, f), 'utf8');
      expect(text, f).not.toMatch(/^\s*\{\{INCLUDE:/m);
      expect(text, f).not.toMatch(/runs-on: (ubuntu|windows|macos)-/);
    }
  });
});

describe('retired configuration keys (D12)', () => {
  it('configure refuses them with the retirement message', () => {
    for (const key of ['paths_ignore_pull_request', 'reuse_pull_request_gates']) {
      const r = validateConfigKeyValue(key, 'true');
      expect(r.error, key).toBe(RETIRED_CONFIG_KEYS[key]);
      expect(r.error, key).toContain('retired in DevAudit-Installer#1335');
    }
  });
});

describe('update removes the replaced workflows (#1335)', { timeout: 300_000 }, () => {
  async function fixture(): Promise<string> {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-ci-pipeline-update-'));
    await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({
      project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20', runner: 'ubuntu-latest', working_directory: '.',
      source_dirs: 'app/', sast_baseline: 0, accepted_dep_risks: '', production_url_secret: 'FIXTURE_PROD_URL',
      database_service: '', e2e_project: 'chromium', e2e_start_command: 'npm run dev', paths_ignore: ['docs/**'],
    }));
    await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
    return dir;
  }
  const old = { 'feature-e2e.yml': 'name: Feature In-Scope E2E\n', 'ci-status-fallback.yml': 'name: CI Status Fallback\n', 'quality-gates-provenance.yml': 'name: CI Pipeline\n' };

  it('the pattern matches the three workflows and their target variants only', () => {
    for (const f of ['feature-e2e.yml', 'ci-status-fallback.yml', 'quality-gates-provenance.yml', 'feature-e2e-web.yml']) expect(REPLACED_WORKFLOWS_PATTERN.test(f), f).toBe(true);
    for (const f of ['ci.yml', 'e2e-regression.yml', 'feature-e2e.yaml', 'my-feature-e2e.yml']) expect(REPLACED_WORKFLOWS_PATTERN.test(f), f).toBe(false);
  });

  it('removes an unmodified copy silently', async () => {
    const dir = await fixture();
    try {
      const files: Record<string, { sha256: string; section: string }> = {};
      for (const [f, content] of Object.entries(old)) {
        await fs.writeFile(join(dir, '.github', 'workflows', f), content);
        files[`.github/workflows/${f}`] = { sha256: sha256(content), section: '2f' };
      }
      await writeManifest(dir, { version: 1, cli_version: '1.16.0', files });
      const report = await syncProject(dir);
      const left = await fs.readdir(join(dir, '.github', 'workflows'));
      for (const f of Object.keys(old)) expect(left, f).not.toContain(f);
      expect(report.warnings.join('\n')).not.toContain('second "Quality Gates"');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps a modified copy and warns that it reports a second Quality Gates', async () => {
    const dir = await fixture();
    try {
      const content = old['feature-e2e.yml'];
      await fs.writeFile(join(dir, '.github', 'workflows', 'feature-e2e.yml'), `${content}# a local change\n`);
      await writeManifest(dir, { version: 1, cli_version: '1.16.0', files: { '.github/workflows/feature-e2e.yml': { sha256: sha256(content), section: '2f' } } });
      const report = await syncProject(dir);
      expect(await fs.readdir(join(dir, '.github', 'workflows'))).toContain('feature-e2e.yml');
      const warning = report.warnings.join('\n');
      expect(warning).toContain('.github/workflows/feature-e2e.yml was kept because it was modified');
      expect(warning).toContain('second "Quality Gates" check. Delete it before merging this sync.');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('a .devaudit-patches/ci.yml.patch made against the old ci.yml is reported and not half-applied', async () => {
    const dir = await fixture();
    try {
      await fs.mkdir(join(dir, '.devaudit-patches'), { recursive: true });
      await fs.writeFile(join(dir, '.devaudit-patches', 'ci.yml.patch'), [
        '--- a/.github/workflows/ci.yml',
        '+++ b/.github/workflows/ci.yml',
        '@@ -1,3 +1,3 @@',
        '-# CI Pipeline — all gates on PRs to develop and code pushes to develop',
        '+# CI Pipeline — patched header',
        ' #',
        ' # Generated by `devaudit install` / `devaudit update` from sdlc-config.json.',
        '',
      ].join('\n'));
      await fs.writeFile(join(dir, '.devaudit-patches', 'ci.yml.patch.json'), JSON.stringify({ upstream_issue: 'https://github.com/example-org/example-app/issues/1', reason: 'test' }));
      const report = await syncProject(dir);
      const ci = await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf8');
      expect(ci.startsWith('# CI Pipeline — the one workflow that reports the required check `Quality Gates`')).toBe(true);
      expect(ci).not.toContain('patched header');
      expect(report.warnings.join('\n')).toContain('ci.yml.patch');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
