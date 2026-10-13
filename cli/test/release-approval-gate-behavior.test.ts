import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { load as yamlLoad } from 'js-yaml';
import { renderAll } from './helpers/render-workflows.js';

// devaudit-installer#941 — behavioural test of the generated "Release Approval
// Gate" workflow. The rendered `run:` steps (Resolve DevAudit base URL,
// Resolve current release, Enforce release approval) are executed with bash and
// curl against a mock portal that walks a release through its statuses, instead
// of only string-matching the YAML (release-lifecycle-workflows.test.ts).
//
// Test-harness only: the mock portal simulates what the portal would answer. It
// never creates an approval; nothing here talks to a real portal.

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const SLUG = 'fixture-app';

interface Step {
  readonly id?: string;
  readonly name?: string;
  readonly run?: string;
}

let prevRoot: string | undefined;
let workflowText = '';
let server: Server;
let baseUrl = '';
let portal: { projectStatus: number; resolveStatus: number; release: { id: string; version: string; status: string } | null } = {
  projectStatus: 200,
  resolveStatus: 200,
  release: null,
};

beforeAll(async () => {
  prevRoot = process.env['DEVAUDIT_INSTALLER_ROOT'];
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
  // Release validation layer 2b points the test at an updated clone's own workflow and
  // derive script (GATE_WORKFLOW_FILE / GATE_DERIVE_SCRIPT) instead of a fixture render.
  const override = process.env['GATE_WORKFLOW_FILE'];
  workflowText = override
    ? await fs.readFile(override, 'utf8')
    : ((await renderAll('node'))['check-release-approval.yml'] ?? '');
  server = createServer((req, res) => {
    const url = req.url ?? '';
    res.setHeader('content-type', 'application/json');
    if (req.method === 'HEAD' || url === '/') {
      res.statusCode = 200;
      res.end('{}');
    } else if (url.startsWith(`/api/ci/projects/${SLUG}`)) {
      res.statusCode = portal.projectStatus;
      res.end('{}');
    } else if (url.startsWith('/api/ci/releases/resolve?')) {
      res.statusCode = portal.resolveStatus;
      res.end(JSON.stringify({ latest: portal.release }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  // Rendering runs the whole sync (incl. the formatter); under a parallel full
  // run that exceeds vitest's 10s default hook timeout.
}, 120_000);
afterAll(async () => {
  if (prevRoot === undefined) delete process.env['DEVAUDIT_INSTALLER_ROOT'];
  else process.env['DEVAUDIT_INSTALLER_ROOT'] = prevRoot;
  if (server) await new Promise((ok) => server.close(ok));
});

function stepsByName(): Record<string, Step> {
  const wf = yamlLoad(workflowText) as { jobs: Record<string, { steps: Step[] }> };
  const out: Record<string, Step> = {};
  for (const s of wf.jobs['check-approval']?.steps ?? []) if (s.name) out[s.name] = s;
  return out;
}

/** Expressions the runner would resolve before bash sees the script. */
function expand(script: string, outputs: Record<string, string>): string {
  const ctx: Record<string, string> = {
    'github.event_name': 'workflow_dispatch',
    'github.event.client_payload.release': '',
    'github.repository': 'owner/repo',
    ...Object.fromEntries(Object.entries(outputs).map(([k, v]) => [`steps.release.outputs.${k}`, v])),
  };
  return script.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_m, expr: string) => ctx[expr] ?? '');
}

interface GateRun {
  readonly exitCode: number;
  readonly output: string;
  readonly bootstrap: boolean;
}

/** Runs the three gate steps in order in a throwaway repo; stops at the first failing step like Actions does. */
async function runGate(opts: { apiKey: string }): Promise<GateRun> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-gate-'));
  try {
    await fs.mkdir(join(dir, 'scripts'), { recursive: true });
    await fs.copyFile(
      process.env['GATE_DERIVE_SCRIPT'] ?? join(INSTALLER_ROOT, 'sdlc', 'files', '_common', 'scripts', 'derive-release-version.sh'),
      join(dir, 'scripts', 'derive-release-version.sh'),
    );
    await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: SLUG, devaudit: { base_url: baseUrl } }));
    const git = (...a: string[]) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'feat: [REQ-777] gate fixture', '-m', 'Ref: REQ-777');

    const envFile = join(dir, '.gh-env');
    const outFile = join(dir, '.gh-out');
    await fs.writeFile(envFile, '');
    await fs.writeFile(outFile, '');
    const steps = stepsByName();
    const order = ['Resolve DevAudit base URL', 'Resolve current release', 'Enforce release approval'];
    let transcript = '';
    for (const name of order) {
      const envAdds = Object.fromEntries(
        (await fs.readFile(envFile, 'utf8')).split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      );
      if (name !== 'Resolve DevAudit base URL' && envAdds['BOOTSTRAP_MODE'] === 'true') break; // the real `if:` skips these
      const outputs = Object.fromEntries(
        (await fs.readFile(outFile, 'utf8')).split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      );
      const script = expand(steps[name]?.run ?? 'exit 99', outputs);
      // Async spawn: the mock portal lives in this process, and a blocking spawnSync would stop it answering curl.
      const r = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
        const child = spawn('bash', ['-c', script], {
          cwd: dir,
          env: {
            ...process.env,
            ...envAdds,
            DEVAUDIT_API_KEY: opts.apiKey,
            DEVAUDIT_BASE_URL_VAR: '',
            PROJECT_SLUG: SLUG,
            GITHUB_ENV: envFile,
            GITHUB_OUTPUT: outFile,
          },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c) => (stdout += c));
        child.stderr.on('data', (c) => (stderr += c));
        const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
        child.on('close', (status) => {
          clearTimeout(timer);
          done({ status, stdout, stderr });
        });
      });
      transcript += `${r.stdout}${r.stderr}`;
      if (r.status !== 0) return { exitCode: r.status ?? 1, output: transcript, bootstrap: false };
    }
    const env = await fs.readFile(envFile, 'utf8');
    return { exitCode: 0, output: transcript, bootstrap: /BOOTSTRAP_MODE=true/.test(env) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const setRelease = (status: string) => {
  portal = { projectStatus: 200, resolveStatus: 200, release: { id: '11111111-1111-4111-8111-111111111111', version: 'REQ-777', status } };
};

describe('generated Release Approval Gate, run against a mock portal (#941)', () => {
  it('rendered the gate workflow', () => {
    expect(workflowText).toContain('name: Release Approval Gate');
  });

  for (const status of ['draft', 'uat_review', 'uat_rejected', 'uat_changes_requested', 'prod_rejected']) {
    it(`blocks while the release is ${status}`, async () => {
      setRelease(status);
      const r = await runGate({ apiKey: 'fixture-key' });
      expect(r.exitCode).not.toBe(0);
      expect(r.output).toContain(`is '${status}' — release approval required`);
    }, 90_000);
  }

  it('blocks a deferred release with the deferral message (#956)', async () => {
    setRelease('deferred');
    const r = await runGate({ apiKey: 'fixture-key' });
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toContain('is deferred');
    expect(r.output).toContain('Absorbed predecessor releases');
  }, 90_000);

  for (const status of ['uat_approved', 'prod_review', 'prod_approved', 'released']) {
    it(`passes once the release is ${status}`, async () => {
      setRelease(status);
      const r = await runGate({ apiKey: 'fixture-key' });
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain(`Release approval confirmed (status: ${status})`);
    }, 90_000);
  }

  it('resolves the release the derive script names, not a hardcoded one', async () => {
    setRelease('uat_approved');
    const r = await runGate({ apiKey: 'fixture-key' });
    expect(r.output).toContain('Derived release prefix from git history: REQ-777');
  }, 90_000);

  it('passes in bootstrap mode when the API key is not set yet', async () => {
    setRelease('draft');
    const r = await runGate({ apiKey: '' });
    expect(r.exitCode).toBe(0);
    expect(r.bootstrap).toBe(true);
  }, 90_000);

  it('passes in bootstrap mode when the project does not exist in the portal yet', async () => {
    portal = { projectStatus: 404, resolveStatus: 404, release: null };
    const r = await runGate({ apiKey: 'fixture-key' });
    expect(r.exitCode).toBe(0);
    expect(r.bootstrap).toBe(true);
  }, 90_000);

  it('fails closed when the project endpoint 404s but releases/resolve says the project exists', async () => {
    portal = { projectStatus: 404, resolveStatus: 200, release: null };
    const r = await runGate({ apiKey: 'fixture-key' });
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toContain('Failing closed');
  }, 90_000);

  it('fails on an invalid API key', async () => {
    portal = { projectStatus: 401, resolveStatus: 401, release: null };
    const r = await runGate({ apiKey: 'wrong' });
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toContain('HTTP 401');
  }, 90_000);
});
