import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ciPipelineCheck } from '../src/commands/doctor-ci-pipeline.js';
import { CHECK_EXPLANATIONS, gapsFromCheck } from '../src/lib/doctor-explain.js';

// DevAudit-Installer#1335 — the `ci-pipeline` doctor check: leftovers from before the single CI pipeline.

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});
async function repo(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-doctor-ci-pipeline-'));
  dirs.push(dir);
  await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  await fs.writeFile(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI Pipeline\n');
  for (const [path, content] of Object.entries(files)) {
    await fs.mkdir(join(dir, path, '..'), { recursive: true });
    await fs.writeFile(join(dir, path), content);
  }
  return dir;
}
const subjects = (r: Awaited<ReturnType<typeof ciPipelineCheck>>) => (r.findings ?? []).map((f) => f.subject);

describe('the ci-pipeline doctor check (#1335)', () => {
  it('is quiet for a project on the single pipeline', async () => {
    const r = await ciPipelineCheck({ repoRoot: await repo({ 'playwright.config.ts': "const x = process.env.GITHUB_JOB === 'feature-e2e';\n" }), cfg: { paths_ignore: ['docs/**'] } });
    expect(r).toMatchObject({ name: 'ci-pipeline', ok: true });
    expect(r.findings).toBeUndefined();
  });

  it('legacy-workflow: names every replaced workflow that is left, including target variants', async () => {
    const dir = await repo({ '.github/workflows/feature-e2e.yml': 'x', '.github/workflows/ci-status-fallback-web.yml': 'x', '.github/workflows/e2e-regression.yml': 'x' });
    const r = await ciPipelineCheck({ repoRoot: dir, cfg: {} });
    expect(subjects(r)).toEqual(['legacy-workflow']);
    const f = r.findings![0]!;
    expect(f.detail).toContain('.github/workflows/ci-status-fallback-web.yml');
    expect(f.detail).toContain('.github/workflows/feature-e2e.yml');
    expect(f.detail).not.toContain('e2e-regression.yml');
    expect(f.detail).toContain('second "Quality Gates"');
    expect(f.remediation!.plan.join('\n')).toContain('git rm .github/workflows/feature-e2e.yml');
  });

  it('retired-key: names a retired key in sdlc-config.json, whatever its value', async () => {
    for (const cfg of [{ paths_ignore_pull_request: true }, { reuse_pull_request_gates: false }, { paths_ignore_pull_request: false, reuse_pull_request_gates: true }]) {
      const r = await ciPipelineCheck({ repoRoot: await repo(), cfg });
      expect(subjects(r), JSON.stringify(cfg)).toEqual(['retired-key']);
      for (const k of Object.keys(cfg)) expect(r.findings![0]!.detail, k).toContain(k);
    }
  });

  it('feature-workflow-guard: a Playwright config at the root or under working_directory that tests the old name', async () => {
    const guard = "const inFeatureE2e = process.env.GITHUB_WORKFLOW === 'Feature In-Scope E2E';\n";
    const atRoot = await ciPipelineCheck({ repoRoot: await repo({ 'playwright.config.ts': guard }), cfg: {} });
    expect(subjects(atRoot)).toEqual(['feature-workflow-guard']);
    expect(atRoot.findings![0]!.detail).toContain('playwright.config.ts');
    expect(atRoot.findings![0]!.remediation!.plan.join('\n')).toContain("process.env.GITHUB_JOB === 'feature-e2e'");
    const sub = await ciPipelineCheck({ repoRoot: await repo({ 'web/playwright.config.mjs': guard }), cfg: { working_directory: 'web' } });
    expect(subjects(sub)).toEqual(['feature-workflow-guard']);
    expect(sub.findings![0]!.detail).toContain('web/playwright.config.mjs');
  });

  it('never fails, every finding is guidance with an explanation and a gap', async () => {
    const dir = await repo({ '.github/workflows/quality-gates-provenance.yml': 'x', 'playwright.config.js': 'Feature In-Scope E2E' });
    const r = await ciPipelineCheck({ repoRoot: dir, cfg: { reuse_pull_request_gates: true } });
    expect(r.ok).toBe(true);
    expect(subjects(r).sort()).toEqual(['feature-workflow-guard', 'legacy-workflow', 'retired-key']);
    for (const f of r.findings!) {
      expect(f.remediation?.tier, f.subject).toBe('C');
      expect(CHECK_EXPLANATIONS[`ci-pipeline:${f.subject}`], f.subject).toBeDefined();
    }
    expect(CHECK_EXPLANATIONS['ci-pipeline']).toBeDefined();
    expect(gapsFromCheck(r)).toHaveLength(3);
  });

  it('a repository without .github/workflows is not an error', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-doctor-ci-pipeline-'));
    dirs.push(dir);
    const r = await ciPipelineCheck({ repoRoot: dir, cfg: {} });
    expect(r.ok).toBe(true);
    expect(r.findings).toBeUndefined();
  });
});
