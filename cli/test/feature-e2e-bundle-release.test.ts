import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { load as yamlLoad } from 'js-yaml';
import { renderAll } from './helpers/render-workflows.js';

// DevAudit-Installer#1323 — the generated feature-e2e.yml files a co-tracked bundle member's evidence and test
// execution against the bundle core's portal release, and never creates one named after the member. Each step that
// passes --release is run for real (bash) against a repository with a live declared-bundle manifest; the upload and
// execution scripts are stubs that record their arguments.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CORE = 'REQ-100';
const MEMBER = 'REQ-101';

beforeAll(() => {
  process.env['DEVAUDIT_INSTALLER_ROOT'] = ROOT;
});
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

interface Step {
  name?: string;
  run?: string;
}
async function stepsOf(runner: 'playwright' | 'pytest'): Promise<Step[]> {
  const wf = await renderAll('node', runner === 'pytest' ? { test_runner: 'pytest' } : {});
  const doc = yamlLoad(wf['feature-e2e.yml'] as string) as { jobs: Record<string, { steps: Step[] }> };
  return Object.values(doc.jobs).flatMap((j) => j.steps);
}

const manifest = (core: string, members: string[]) => ({
  members: [{ role: 'core', version: core }, ...members.map((version) => ({ role: 'co_tracked', version }))],
});

/** A checked-out PR head with a live bundle `core` naming `MEMBER`, every file the evidence steps look for, and stub scripts. */
async function workspace(bundles: Array<{ core: string; members: string[] }>): Promise<{ dir: string; log: string }> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-fe2e-bundle-'));
  dirs.push(dir);
  const pending = join(dir, 'compliance', 'pending-releases');
  await fs.mkdir(pending, { recursive: true });
  for (const b of bundles) {
    await fs.writeFile(join(pending, `BUNDLED-CHANGES-${b.core}.md`), `# Bundle ${b.core}\n`);
    await fs.writeFile(join(pending, `BUNDLED-CHANGES-${b.core}.json`), JSON.stringify(manifest(b.core, b.members)));
    await fs.writeFile(join(pending, `RELEASE-TICKET-${b.core}.md`), '# ticket\n');
  }
  await fs.mkdir(join(dir, 'scripts'), { recursive: true });
  await fs.copyFile(join(ROOT, 'sdlc', 'files', '_common', 'scripts', 'resolve-bundle-release.sh'), join(dir, 'scripts', 'resolve-bundle-release.sh'));
  const log = join(dir, 'calls.log');
  for (const s of ['upload-evidence.sh', 'report-test-execution.sh']) {
    await fs.writeFile(join(dir, 'scripts', s), `#!/usr/bin/env bash\nprintf '%s\\n' "${s} $*" >> "${log}"\n[ "$1" = start ] && echo '{"id":"rec-1"}'\nexit 0\n`);
  }
  await fs.writeFile(join(dir, 'scripts', 'is-transport-layer-req.sh'), '#!/usr/bin/env bash\nexit 1\n');
  // the evidence the steps upload
  const evidence = join(dir, 'compliance', 'evidence', MEMBER);
  await fs.mkdir(join(evidence, 'screenshots'), { recursive: true });
  await fs.writeFile(join(evidence, 'e2e-scope-decision.md'), 'no e2e needed\n');
  await fs.writeFile(join(evidence, 'screenshots', 'ac-1.png'), 'png');
  for (const f of ['e2e-results.json', 'playwright-report.zip', 'feature-e2e-results.xml', 'README.md']) await fs.writeFile(join(dir, f), '{}');
  await fs.mkdir(join(dir, 'playwright-report'), { recursive: true });
  await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ devaudit: { base_url: 'https://portal.example.test' } }));
  return { dir, log };
}

/** Fill the GitHub expressions a step reads, the way a pull_request run for MEMBER would. */
function expand(run: string): string {
  return run.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
    if (/outputs\.req_id$/.test(expr)) return MEMBER;
    if (/outputs\.has_tests$/.test(expr)) return 'true';
    if (/outputs\.execution_supported$/.test(expr)) return 'true';
    if (/outputs\.execution_record_id$/.test(expr)) return 'rec-1';
    if (expr === 'job.status') return 'success';
    if (expr.startsWith('secrets.')) return 'test-key';
    return 'x';
  });
}

async function runStep(step: Step, ws: { dir: string }) {
  const script = join(ws.dir, `step-${Math.random().toString(36).slice(2)}.sh`);
  await fs.writeFile(script, `set -eo pipefail\n${expand(step.run ?? '')}`);
  const out = join(ws.dir, 'github-output');
  await fs.writeFile(out, '');
  return execa('bash', [script], {
    cwd: ws.dir,
    reject: false,
    env: { GITHUB_WORKSPACE: ws.dir, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: join(ws.dir, 'summary'), DEVAUDIT_BASE_URL_VAR: 'https://portal.example.test', DEVAUDIT_API_KEY: 'test-key' },
  });
}

for (const runner of ['playwright', 'pytest'] as const) {
  describe(`feature-e2e.yml (${runner}) for a co-tracked bundle member (#1323)`, { timeout: 120_000 }, () => {
    it('files every upload and execution call against the core release, with the member as the requirement', async () => {
      const steps = (await stepsOf(runner)).filter((s) => s.run?.includes('--release'));
      expect(steps.length).toBeGreaterThanOrEqual(4);
      const ws = await workspace([{ core: CORE, members: [MEMBER] }]);
      for (const step of steps) {
        const r = await runStep(step, ws);
        expect(r.exitCode, `${step.name}: ${r.stderr}${r.stdout}`).toBe(0);
      }
      const calls = (await fs.readFile(ws.log, 'utf8')).trim().split('\n');
      const releases = calls.flatMap((c) => [...c.matchAll(/--release (\S+)/g)].map((m) => m[1]));
      // scope decision, registration, start, e2e_result and complete at least; screenshots and the report on playwright
      expect(releases.length, calls.join('\n')).toBeGreaterThanOrEqual(5);
      expect(new Set(releases)).toEqual(new Set([CORE]));
      expect(calls.join('\n')).not.toContain(`--release ${MEMBER}`);
      // the evidence rows stay tagged with the member's own requirement
      const uploads = calls.filter((c) => c.startsWith('upload-evidence.sh') && !c.includes('_compliance-docs'));
      expect(uploads.length).toBeGreaterThan(0);
      for (const u of uploads) expect(u.split(' ')[2], u).toBe(MEMBER);
    });

    it('passes a REQ that is not in a bundle through unchanged', async () => {
      const steps = (await stepsOf(runner)).filter((s) => s.run?.includes('--release'));
      const ws = await workspace([]);
      for (const step of steps) expect((await runStep(step, ws)).exitCode, step.name).toBe(0);
      const releases = [...(await fs.readFile(ws.log, 'utf8')).matchAll(/--release (\S+)/g)].map((m) => m[1]);
      expect(new Set(releases)).toEqual(new Set([MEMBER]));
    });

    it('fails the step with a named error, and uploads nothing, for a member of two live bundles', async () => {
      const steps = (await stepsOf(runner)).filter((s) => s.run?.includes('--release'));
      const ws = await workspace([
        { core: CORE, members: [MEMBER] },
        { core: 'REQ-200', members: [MEMBER] },
      ]);
      for (const step of steps) {
        const r = await runStep(step, ws);
        expect(r.exitCode, step.name).toBe(1);
        expect(r.stdout, step.name).toContain(`::error::Could not resolve the portal release for ${MEMBER}`);
      }
      await expect(fs.readFile(ws.log, 'utf8')).rejects.toThrow();
    });

    it('does not resolve the release in the scope-decision step when there is no artefact to upload', async () => {
      const scope = (await stepsOf(runner)).find((s) => s.run?.includes('e2e_scope_decision'));
      expect(scope).toBeDefined();
      const ws = await workspace([
        { core: CORE, members: [MEMBER] },
        { core: 'REQ-200', members: [MEMBER] },
      ]);
      await fs.rm(join(ws.dir, 'compliance', 'evidence', MEMBER, 'e2e-scope-decision.md'));
      expect((await runStep(scope!, ws)).exitCode).toBe(0);
    });
  });
}
