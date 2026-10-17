import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { load as yamlLoad } from 'js-yaml';
import { renderAll } from './helpers/render-workflows.js';

// devaudit-installer#995 — declared-bundle parity for the Python CI template.
// The Python template keeps its date-based release model for ordinary work and
// switches to the bundle's single core-REQ release only when a live declared
// bundle exists. The rendered "Determine release version" step is executed with
// bash against a mock portal; the other bundle steps are pinned structurally
// (their scripts, generate-bundled-changes / submit-bundle-manifest /
// resolve-bundle-release, are the same ones the Node template uses and have
// their own tests).

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const DATE_RELEASE = 'v2026.10.17.1';

interface Step {
  readonly id?: string;
  readonly name?: string;
  readonly if?: string;
  readonly run?: string;
}

let prevRoot: string | undefined;
let workflowText = '';
let server: Server;
let baseUrl = '';

beforeAll(async () => {
  prevRoot = process.env['DEVAUDIT_INSTALLER_ROOT'];
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
  workflowText = (await renderAll('python'))['ci.yml'] ?? '';
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if ((req.url ?? '').startsWith('/api/ci/releases/resolve?')) {
      res.end(JSON.stringify({ nextSequenceVersion: DATE_RELEASE }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 120_000);

afterAll(async () => {
  if (prevRoot === undefined) delete process.env['DEVAUDIT_INSTALLER_ROOT'];
  else process.env['DEVAUDIT_INSTALLER_ROOT'] = prevRoot;
  if (server) await new Promise((ok) => server.close(ok));
});

function jobSteps(job: string): Step[] {
  const wf = yamlLoad(workflowText) as { jobs: Record<string, { steps: Step[] }> };
  return wf.jobs[job]?.steps ?? [];
}

const parseKv = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );

/** Runs the rendered "Determine release version" step in a throwaway repo. */
async function determineVersion(opts: { declaredBundle: boolean; archivedTicket?: boolean }): Promise<Record<string, string>> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-pybundle-'));
  const aux = await fs.mkdtemp(join(tmpdir(), 'cli-pybundle-aux-'));
  try {
    await fs.mkdir(join(dir, 'scripts'), { recursive: true });
    await fs.copyFile(
      join(INSTALLER_ROOT, 'sdlc', 'files', '_common', 'scripts', 'derive-release-version.sh'),
      join(dir, 'scripts', 'derive-release-version.sh'),
    );
    await fs.mkdir(join(dir, 'compliance', 'pending-releases'), { recursive: true });
    if (opts.declaredBundle) {
      await fs.writeFile(
        join(dir, 'compliance', 'pending-releases', 'BUNDLED-CHANGES-REQ-037.md'),
        '# Bundled changes\n\n## Co-Tracked Bundle Members\n\n- REQ-038\n',
      );
      if (opts.archivedTicket) {
        await fs.mkdir(join(dir, 'compliance', 'approved-releases'), { recursive: true });
        await fs.writeFile(join(dir, 'compliance', 'approved-releases', 'RELEASE-TICKET-REQ-037.md'), 'x\n');
      }
    }
    await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture-app' }));
    const git = (...a: string[]) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'feat: [REQ-038] member work', '-m', 'Ref: REQ-038');

    const step = jobSteps('register-release').find((s) => s.name === 'Determine release version');
    if (!step?.run) throw new Error('"Determine release version" not found in the rendered Python ci.yml');
    const outFile = join(aux, 'out');
    await fs.writeFile(outFile, '');
    const result = await new Promise<{ status: number | null; output: string }>((done) => {
      const child = spawn('bash', ['-c', step.run as string], {
        cwd: dir,
        env: { ...process.env, BASE: baseUrl, DEVAUDIT_API_KEY: 'fixture-token', GITHUB_OUTPUT: outFile },
      });
      let output = '';
      child.stdout.on('data', (c) => (output += c));
      child.stderr.on('data', (c) => (output += c));
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
      child.on('close', (status) => {
        clearTimeout(timer);
        done({ status, output });
      });
    });
    expect(result.status, result.output).toBe(0);
    return parseKv(await fs.readFile(outFile, 'utf8'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(aux, { recursive: true, force: true });
  }
}

describe('Python CI template: declared-bundle parity (#995)', () => {
  it('keeps the date-based release for work that declares no bundle', async () => {
    const out = await determineVersion({ declaredBundle: false });
    expect(out['version']).toBe(DATE_RELEASE);
    expect(out['bundle_core']).toBeUndefined();
  });

  it('registers the run on the declared bundle\'s single core-REQ release', async () => {
    const out = await determineVersion({ declaredBundle: true });
    expect(out['version']).toBe('REQ-037');
    expect(out['bundle_core']).toBe('REQ-037');
  });

  it('ignores a stale declared bundle whose ticket is already archived', async () => {
    const out = await determineVersion({ declaredBundle: true, archivedTicket: true });
    expect(out['version']).toBe(DATE_RELEASE);
    expect(out['bundle_core']).toBeUndefined();
  });

  it('generates, registers and submits the bundle manifest only when a declared bundle is live', () => {
    const step = jobSteps('register-release').find((s) => s.name === 'Generate and upload bundled changes (declared bundle)');
    expect(step, 'bundle step present').toBeTruthy();
    expect(step?.if).toContain("steps.version.outputs.bundle_core != ''");
    const run = step?.run ?? '';
    expect(run).toContain('bash scripts/generate-bundled-changes.sh');
    expect(run).toContain('--declared-bundle');
    expect(run).toContain('select(.role == "co_tracked")');
    expect(run).not.toContain('co-tracked');
    // the single release exists before the manifest is submitted
    expect(run.indexOf('release_registration')).toBeGreaterThan(-1);
    expect(run.indexOf('release_registration')).toBeLessThan(run.indexOf('bash scripts/submit-bundle-manifest.sh'));
    expect(run).toContain('bundled_changes');
    const names = jobSteps('register-release').map((s) => s.name);
    expect(names.indexOf('Generate and upload bundled changes (declared bundle)')).toBeLessThan(names.indexOf('Sync known requirements from RTM'));
  });

  it('files a bundle member\'s artifacts against the bundle release and leaves non-members on this run\'s release', () => {
    const step = jobSteps('upload-evidence').find((s) => (s.run ?? '').includes('IN_SCOPE_REQS'));
    const run = step?.run ?? '';
    expect(run).toContain('bash scripts/resolve-bundle-release.sh "${REQ_ID}"');
    expect(run).toContain('"$RESOLVED_RELEASE" != "${REQ_ID}"');
    expect(run).toContain('MEMBER_RELEASE_FLAGS=(--release "$RESOLVED_RELEASE")');
    // appended after ${FLAGS} so the member's release wins (the uploader keeps the last --release)
    expect(run.indexOf('${FLAGS} "${MEMBER_RELEASE_FLAGS[@]}"')).toBeGreaterThan(-1);
  });
});
