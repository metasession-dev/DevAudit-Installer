import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { load as yamlLoad } from 'js-yaml';
import { renderAll } from './helpers/render-workflows.js';

// devaudit-installer#941 — behavioural test of the generated "Release Close-out"
// workflow, the counterpart of release-approval-gate-behavior.test.ts. The
// rendered `run:` steps (Resolve inputs, Run close-out, Report close-out PR
// opened, Wait for close-out PR merge and report completion) are executed with
// bash against a tracer-consumer fixture, a fake `gh` and a mock portal, instead
// of only string-matching the YAML (release-lifecycle-workflows.test.ts).
//
// Test-harness only. The mock portal simulates the answers the real portal would
// give to the close-out reports; it never creates an approval or a release, and
// nothing here talks to a real portal or GitHub. A human clicking "Mark as
// Released" is the compliance control being *reacted to*, never automated.

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const SLUG = 'fixture-app';
const REQ = 'REQ-777';
const RELEASE_ID = '22222222-2222-4222-8222-222222222222';
const PR_URL = 'https://github.com/owner/repo/pull/777';
const MERGE_SHA = 'abc123def4567890abc123def4567890abc12345';

interface Step {
  readonly id?: string;
  readonly name?: string;
  readonly run?: string;
}

interface PortalRequest {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

let prevRoot: string | undefined;
let workflowText = '';
let server: Server;
let baseUrl = '';
let requests: PortalRequest[] = [];
let portalRelease: { id: string; version: string } | null = { id: RELEASE_ID, version: REQ };

beforeAll(async () => {
  prevRoot = process.env['DEVAUDIT_INSTALLER_ROOT'];
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
  const override = process.env['CLOSEOUT_WORKFLOW_FILE'];
  workflowText = override
    ? await fs.readFile(override, 'utf8')
    : ((await renderAll('node'))['close-out-release.yml'] ?? '');
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = req.url ?? '';
      requests.push({ method: req.method ?? '', url, body: Buffer.concat(chunks).toString('utf8') });
      res.setHeader('content-type', 'application/json');
      if (url.startsWith('/api/ci/releases/resolve?')) {
        res.statusCode = 200;
        res.end(JSON.stringify({ latest: portalRelease }));
      } else if (req.method === 'POST' && /^\/api\/ci\/releases\/[^/]+\/close-out$/.test(url)) {
        res.statusCode = 200;
        res.end('{"ok":true}');
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
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

function steps(): Record<string, Step> {
  const wf = yamlLoad(workflowText) as { jobs: Record<string, { steps: Step[] }> };
  const out: Record<string, Step> = {};
  for (const s of wf.jobs['close-out']?.steps ?? []) if (s.name) out[s.name] = s;
  return out;
}

const parseKv = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );

interface Fixture {
  readonly dir: string;
  /** Harness files (step outputs, env file, gh log) live outside the repo so they never dirty `git status`. */
  readonly aux: string;
  readonly env: Record<string, string>;
  readonly outputs: Record<string, Record<string, string>>;
  readonly transcript: { text: string };
}

async function makeFixture(): Promise<Fixture> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-closeout-'));
  const aux = await fs.mkdtemp(join(tmpdir(), 'cli-closeout-aux-'));
  await fs.mkdir(join(dir, 'scripts'), { recursive: true });
  await fs.mkdir(join(dir, 'compliance', 'pending-releases'), { recursive: true });
  await fs.mkdir(join(dir, 'bin'), { recursive: true });
  const scriptsDir = join(INSTALLER_ROOT, 'sdlc', 'files', '_common', 'scripts');
  for (const f of await fs.readdir(scriptsDir)) {
    if (f.endsWith('.sh') && !f.endsWith('.test.sh')) await fs.copyFile(join(scriptsDir, f), join(dir, 'scripts', f));
  }
  await fs.writeFile(
    join(dir, 'compliance', 'RTM.md'),
    [
      '# Requirements Traceability Matrix',
      '',
      '| Status | Meaning |',
      '| --- | --- |',
      '| RELEASED | Closed approval envelope |',
      '',
      '| REQ-ID | Issue | Risk | Evidence | Status | Owner |',
      '| --- | --- | --- | --- | --- | --- |',
      `| ${REQ} | #777 | MEDIUM | compliance/evidence/${REQ}/ | TESTED - PENDING SIGN-OFF | QA |`,
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    join(dir, 'compliance', 'pending-releases', `RELEASE-TICKET-${REQ}.md`),
    `# Release ticket ${REQ}\n\n**Status:** TESTED - PENDING SIGN-OFF\n**DevAudit Release:** ${REQ}\n`,
  );
  await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: SLUG, devaudit: { base_url: baseUrl } }));
  // Fake `gh`: the close-out PR exists (number/url) and is MERGED unless GH_PR_STATE says otherwise.
  const gh = `#!/usr/bin/env bash
echo "gh $*" >> "\${GH_LOG:-/dev/null}"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  case "$*" in
    *state,mergedAt,mergeCommit*)
      printf '{"state":"%s","mergedAt":"2026-10-17T12:00:00Z","mergeCommit":{"oid":"${MERGE_SHA}"},"number":777,"url":"${PR_URL}"}' "\${GH_PR_STATE:-MERGED}" ;;
    *) printf '{"number":777,"url":"${PR_URL}"}' ;;
  esac
  exit 0
fi
exit 0
`;
  await fs.writeFile(join(dir, 'bin', 'gh'), gh, { mode: 0o755 });
  const git = (...a: string[]) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', `feat: [${REQ}] closeout fixture`, '-m', `Ref: ${REQ}`);
  return { dir, aux, env: {}, outputs: {}, transcript: { text: '' } };
}

/** Expressions the runner would resolve before bash sees the script. */
function expand(script: string, fx: Fixture, event: { release: string; releasePr?: string }): string {
  const ctx: Record<string, string> = {
    'github.event.inputs.release': event.release,
    'github.event.inputs.release_pr': event.releasePr ?? '',
    'github.event.client_payload.release': '',
    'github.event.client_payload.release_pr': '',
    'github.run_id': '4242',
    'github.server_url': 'https://github.com',
    'github.repository': 'owner/repo',
  };
  for (const [id, kv] of Object.entries(fx.outputs)) for (const [k, v] of Object.entries(kv)) ctx[`steps.${id}.outputs.${k}`] = v;
  return script.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_m, expr: string) => ctx[expr] ?? '');
}

/** Runs one rendered step; async so the in-process mock portal can answer curl. */
async function runStep(
  fx: Fixture,
  name: string,
  event: { release: string; releasePr?: string },
  extraEnv: Record<string, string> = {},
): Promise<number> {
  const step = steps()[name];
  if (!step?.run) throw new Error(`step not found in the rendered workflow: ${name}`);
  const id = step.id ?? name;
  const outFile = join(fx.aux, `out-${id}`);
  const envFile = join(fx.aux, 'gh-env');
  await fs.writeFile(outFile, '');
  await fs.appendFile(envFile, '');
  const envAdds = parseKv(await fs.readFile(envFile, 'utf8'));
  const script = expand(step.run, fx, event);
  const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn('bash', ['-c', script], {
      cwd: fx.dir,
      env: {
        ...process.env,
        PATH: `${join(fx.dir, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env['PATH'] ?? ''}`,
        ...envAdds,
        DEVAUDIT_API_KEY: 'fixture-token',
        GH_TOKEN: 'fixture-gh-token',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_OUTPUT: outFile,
        GITHUB_ENV: envFile,
        GH_LOG: join(fx.aux, 'gh.log'),
        ...extraEnv,
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
  fx.transcript.text += `\n## ${name}\n${result.stdout}${result.stderr}`;
  fx.outputs[id] = { ...(fx.outputs[id] ?? {}), ...parseKv(await fs.readFile(outFile, 'utf8')) };
  return result.status ?? 1;
}

const closeOutPosts = () =>
  requests
    .filter((r) => r.method === 'POST' && r.url.endsWith('/close-out'))
    .map((r) => JSON.parse(r.body) as { status: string; pullRequestNumber?: number; pullRequestUrl?: string; mergeSha?: string });

const reset = () => {
  requests = [];
  portalRelease = { id: RELEASE_ID, version: REQ };
};

describe('generated Release Close-out workflow, run against a mock portal (#941)', () => {
  it('rendered the close-out workflow', () => {
    expect(workflowText).toContain('name: Release Close-out');
    expect(Object.keys(steps())).toEqual(
      expect.arrayContaining(['Resolve inputs', 'Run close-out', 'Report close-out PR opened', 'Wait for close-out PR merge and report completion']),
    );
  });

  it('reacts to a release-closed dispatch: reconciles the tree, then reports pr_opened and completed to the portal', async () => {
    reset();
    const fx = await makeFixture();
    try {
      const event = { release: REQ };
      expect(await runStep(fx, 'Resolve inputs', event)).toBe(0);
      expect(fx.outputs['in']).toMatchObject({ req: REQ });

      expect(await runStep(fx, 'Run close-out', event)).toBe(0);
      expect(fx.outputs['closeout']?.['changed']).toBe('true');
      // the ticket moved to approved-releases and the RTM row flipped to RELEASED
      await expect(fs.stat(join(fx.dir, 'compliance', 'approved-releases', `RELEASE-TICKET-${REQ}.md`))).resolves.toBeTruthy();
      await expect(fs.stat(join(fx.dir, 'compliance', 'pending-releases', `RELEASE-TICKET-${REQ}.md`))).rejects.toThrow();
      const ticket = await fs.readFile(join(fx.dir, 'compliance', 'approved-releases', `RELEASE-TICKET-${REQ}.md`), 'utf8');
      expect(ticket).toMatch(/^\*\*Status:\*\* RELEASED/m);
      expect(await fs.readFile(join(fx.dir, 'compliance', 'RTM.md'), 'utf8')).toMatch(new RegExp(`\\| ${REQ} .*\\| RELEASED \\|`));

      expect(await runStep(fx, 'Report close-out PR opened', event)).toBe(0);
      expect(await runStep(fx, 'Wait for close-out PR merge and report completion', event)).toBe(0);

      const posts = closeOutPosts();
      expect(posts.map((p) => p.status)).toEqual(['pr_opened', 'completed']);
      expect(posts[0]).toMatchObject({ pullRequestNumber: 777, pullRequestUrl: PR_URL });
      expect(posts[1]).toMatchObject({ pullRequestNumber: 777, pullRequestUrl: PR_URL, mergeSha: MERGE_SHA });
      // both reports target the release the portal resolved for this REQ
      expect(requests.filter((r) => r.method === 'POST').every((r) => r.url === `/api/ci/releases/${RELEASE_ID}/close-out`)).toBe(true);
      expect(fx.transcript.text).not.toMatch(/::warning::/);
    } finally {
      await fs.rm(fx.dir, { recursive: true, force: true });
      await fs.rm(fx.aux, { recursive: true, force: true });
    }
  });

  it('is a no-op for a non-REQ release (standalone / integration housekeeping has no ticket or RTM close-out)', async () => {
    reset();
    const fx = await makeFixture();
    try {
      expect(await runStep(fx, 'Resolve inputs', { release: 'v2026.10.17' })).toBe(0);
      expect(fx.outputs['in']?.['req']).toBeUndefined();
      expect(fx.transcript.text).toContain('No-op');
      expect(closeOutPosts()).toEqual([]);
    } finally {
      await fs.rm(fx.dir, { recursive: true, force: true });
      await fs.rm(fx.aux, { recursive: true, force: true });
    }
  });

  it('is idempotent: a second close-out changes nothing, so nothing is reported', async () => {
    reset();
    const fx = await makeFixture();
    try {
      const event = { release: REQ };
      await runStep(fx, 'Resolve inputs', event);
      await runStep(fx, 'Run close-out', event);
      expect(fx.outputs['closeout']?.['changed']).toBe('true');
      // commit what the first run changed, then run it again on the clean tree
      spawnSync('git', ['add', '-A'], { cwd: fx.dir });
      spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'chore: close out'], { cwd: fx.dir });
      fx.outputs['closeout'] = {};
      expect(await runStep(fx, 'Run close-out', event)).toBe(0);
      expect(fx.outputs['closeout']?.['changed']).toBe('false');
      expect(fx.transcript.text).toContain('Nothing to close out');
    } finally {
      await fs.rm(fx.dir, { recursive: true, force: true });
      await fs.rm(fx.aux, { recursive: true, force: true });
    }
  });

  // devaudit-installer#1088 — a self-hosted runner keeps untracked E2E output between jobs
  // (checkout clean: false). Close-out writes only under compliance/, so that output must
  // neither make an empty close-out look like work nor be committed into the close-out PR.
  const strayShardOutput = async (dir: string) => {
    await fs.mkdir(join(dir, 'playwright-report-shard-1'), { recursive: true });
    await fs.writeFile(join(dir, 'playwright-report-shard-1', 'index.html'), '<html></html>');
    await fs.mkdir(join(dir, 'test-results-shard-1'), { recursive: true });
    await fs.writeFile(join(dir, 'test-results-shard-1', 'trace.zip'), 'x');
  };
  const git = (dir: string, ...a: string[]) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });

  it('stray untracked E2E output alone is not a close-out: nothing changed, no PR (#1088)', async () => {
    reset();
    const fx = await makeFixture();
    try {
      const event = { release: REQ };
      await runStep(fx, 'Resolve inputs', event);
      await runStep(fx, 'Run close-out', event);
      git(fx.dir, 'add', '-A');
      git(fx.dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'chore: close out');
      await strayShardOutput(fx.dir);
      fx.outputs['closeout'] = {};
      expect(await runStep(fx, 'Run close-out', event)).toBe(0);
      expect(fx.outputs['closeout']?.['changed']).toBe('false');
      expect(fx.transcript.text).toContain('Nothing to close out');
    } finally {
      await fs.rm(fx.dir, { recursive: true, force: true });
      await fs.rm(fx.aux, { recursive: true, force: true });
    }
  });

  it('the close-out commit holds only compliance/ changes, never stray E2E output (#1088)', async () => {
    reset();
    const fx = await makeFixture();
    try {
      const bare = join(fx.aux, 'origin.git');
      git(fx.dir, 'init', '-q', '--bare', bare);
      git(fx.dir, 'remote', 'add', 'origin', bare);
      await strayShardOutput(fx.dir);
      const event = { release: REQ };
      await runStep(fx, 'Resolve inputs', event);
      expect(await runStep(fx, 'Run close-out', event)).toBe(0);
      expect(fx.outputs['closeout']?.['changed']).toBe('true');
      fx.outputs['merge'] = { merged: 'false' };
      expect(await runStep(fx, 'Open close-out PR', event)).toBe(0);

      const files = git(fx.dir, 'show', '--name-only', '--format=', 'HEAD').stdout.split('\n').filter(Boolean);
      expect(files.length).toBeGreaterThan(0);
      expect(files.every((f) => f.startsWith('compliance/'))).toBe(true);
      expect(files).toContain(`compliance/approved-releases/RELEASE-TICKET-${REQ}.md`);
      // the stray output is still just sitting there, untracked and uncommitted
      const status = git(fx.dir, 'status', '--porcelain').stdout;
      expect(status).toContain('?? playwright-report-shard-1/');
      expect(status).toContain('?? test-results-shard-1/');
    } finally {
      await fs.rm(fx.dir, { recursive: true, force: true });
      await fs.rm(fx.aux, { recursive: true, force: true });
    }
  });

  it('does not report a PR that the portal cannot match to this REQ (no silent wrong-release POST)', async () => {
    reset();
    portalRelease = { id: RELEASE_ID, version: 'REQ-999' };
    const fx = await makeFixture();
    try {
      const event = { release: REQ };
      await runStep(fx, 'Resolve inputs', event);
      await runStep(fx, 'Run close-out', event);
      expect(await runStep(fx, 'Report close-out PR opened', event)).toBe(0);
      expect(await runStep(fx, 'Wait for close-out PR merge and report completion', event)).toBe(0);
      expect(closeOutPosts()).toEqual([]);
      expect(fx.transcript.text).toContain(`Unable to resolve ${REQ} on the portal`);
    } finally {
      await fs.rm(fx.dir, { recursive: true, force: true });
      await fs.rm(fx.aux, { recursive: true, force: true });
    }
  });

  it('does not report completion for a close-out PR that was closed without merging', async () => {
    reset();
    const fx = await makeFixture();
    try {
      const event = { release: REQ };
      await runStep(fx, 'Resolve inputs', event);
      await runStep(fx, 'Run close-out', event);
      expect(await runStep(fx, 'Wait for close-out PR merge and report completion', event, { GH_PR_STATE: 'CLOSED' })).toBe(0);
      expect(closeOutPosts()).toEqual([]);
      expect(fx.transcript.text).toContain('was closed without merging');
    } finally {
      await fs.rm(fx.dir, { recursive: true, force: true });
      await fs.rm(fx.aux, { recursive: true, force: true });
    }
  });

  it('skips the portal reports, with a warning, when no API key is available', async () => {
    reset();
    const fx = await makeFixture();
    try {
      const event = { release: REQ };
      await runStep(fx, 'Resolve inputs', event);
      await runStep(fx, 'Run close-out', event);
      expect(await runStep(fx, 'Report close-out PR opened', event, { DEVAUDIT_API_KEY: '' })).toBe(0);
      expect(closeOutPosts()).toEqual([]);
      expect(fx.transcript.text).toContain('required to report the close-out PR');
    } finally {
      await fs.rm(fx.dir, { recursive: true, force: true });
      await fs.rm(fx.aux, { recursive: true, force: true });
    }
  });
});
