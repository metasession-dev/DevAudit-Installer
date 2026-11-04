import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { CACHE_DIR } from '../src/lib/paths.js';
import { cacheFileFor, runScan, type ScanOptions } from '../src/commands/scan.js';
import type { GuidedAsker } from '../src/install/guided.js';

// DevAudit-Installer#1116 WP10 — `devaudit scan` (local).

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function repo(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-scan-'));
  dirs.push(dir);
  await execa('git', ['init', '-q'], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, rel)), { recursive: true });
    await fs.writeFile(join(dir, rel), content);
  }
  return dir;
}

async function listAll(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(p.slice(dir.length));
    }
  };
  await walk(dir);
  return out.sort();
}

interface Captured {
  code: number;
  out: string;
  stdout: string;
}
async function scan(opts: ScanOptions, deps: Parameters<typeof runScan>[1] = {}): Promise<Captured> {
  const lines: string[] = [];
  let stdout = '';
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await runScan({ ...opts }, { installerRoot: ROOT, say: (l) => void lines.push(l), interactive: false, ...deps });
    return { code, out: lines.join('\n'), stdout };
  } finally {
    process.stdout.write = write;
  }
}

function validator(): (v: unknown) => boolean & { errors?: unknown } {
  const Ajv = require('ajv');
  const ajv = new (Ajv.default ?? Ajv)({ allErrors: true, strict: false });
  return ajv.compile(JSON.parse(require('node:fs').readFileSync(join(ROOT, 'contracts', 'scan-report.schema.json'), 'utf-8')));
}

const WORKFLOW = `name: CI
jobs:
  x:
    steps:
      - run: bash scripts/upload-evidence.sh my-app REQ-001 sast_report out.json
      - run: bash scripts/upload-evidence.sh my-app REQ-001 dependency_audit audit.json
`;

describe('the report and its schema', () => {
  it('every report validates against contracts/scan-report.schema.json, including a custom suggestion', async () => {
    const validate = validator();
    const d = await repo({ '.github/workflows/ci.yml': WORKFLOW, 'AGENT.md': 'ours', 'package.json': '{"name":"x"}' });
    const r = await scan({ path: d, framework: 'soc-2,iso-27001,iso-29119,gdpr,eu-ai-act', json: true });
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { suggestedPreset: string; scanVersion: string; frameworks: Array<{ code: string }> };
    expect(validate(report), JSON.stringify((validate as unknown as { errors?: unknown }).errors)).toBe(true);
    expect(report.scanVersion).toBe('1');
    expect(report.frameworks.map((f) => f.code).sort()).toEqual(['eu-ai-act', 'gdpr', 'iso-27001', 'iso-29119', 'soc-2']);
    // no standards, no tests: only the facts and a suggestion; with no smoke tests the suggestion is A or custom
    const bare = JSON.parse((await scan({ path: await repo(), json: true })).stdout.trim().split('\n').at(-1)!) as { frameworks: unknown[]; suggestedPreset: string };
    expect(validate(bare)).toBe(true);
    expect(bare.frameworks).toEqual([]);
    expect(['A', 'custom']).toContain(bare.suggestedPreset);
  });

  it('a schema without additionalProperties would let an extra key through: this one does not', async () => {
    const validate = validator();
    const d = await repo();
    const report = JSON.parse((await scan({ path: d, json: true })).stdout.trim().split('\n').at(-1)!) as Record<string, unknown>;
    expect(validate({ ...report, extra: 1 })).toBe(false);
    expect(validate({ ...report, scanVersion: '2' })).toBe(false);
    expect(validate({ ...report, suggestedPreset: 'D' })).toBe(false);
  });
});

describe('what it finds', () => {
  it('reads the states from files: a policy document, workflows that upload evidence, and what only the portal can tell', async () => {
    const d = await repo({ '.github/workflows/ci.yml': WORKFLOW, 'docs/Test_Policy.md': 'ours', 'Test_Strategy.md': 'ours' });
    const r = await scan({ path: d, framework: 'iso-27001,iso-29119,soc-2', json: true });
    const report = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { frameworks: Array<{ code: string; clauses: Array<{ id: string; state: string }> }> };
    const state = (code: string, id: string): string => report.frameworks.find((f) => f.code === code)!.clauses.find((c) => c.id === id)!.state;
    expect(state('iso-29119', 'ISO29119.2.5')).toBe('evidenced'); // Test_Policy.md
    expect(state('iso-29119', 'ISO29119.2.6')).toBe('evidenced'); // Test_Strategy.md
    expect(state('iso-27001', 'ISO27001.A.8.28')).toBe('evidenced'); // sast_report / dependency_audit workflows
    expect(state('iso-27001', 'ISO27001.A.5.15')).toBe('needs_portal');
    expect(state('soc-2', 'SOC2.CC8.1')).toBe('needs_portal');
    expect(state('soc-2', 'SOC2.CC4.1')).toBe('missing'); // no periodic_review upload
  });

  it('an unmodified starter template counts as partly', async () => {
    const starterDir = join(ROOT, 'sdlc', 'files', '_common');
    const policy = await fs.readFile(join(starterDir, 'Test_Policy.md'), 'utf-8');
    const d = await repo({ 'Test_Policy.md': policy });
    const r = await scan({ path: d, framework: 'iso-29119', json: true });
    const report = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { frameworks: Array<{ clauses: Array<{ id: string; state: string }> }> };
    expect(report.frameworks[0]!.clauses.find((c) => c.id === 'ISO29119.2.5')!.state).toBe('partly');
  });
});

describe('--framework and its defaults', () => {
  const ask = (answer: string[]): { ask: GuidedAsker; asked: Array<{ message: string; initial: readonly string[] }> } => {
    const asked: Array<{ message: string; initial: readonly string[] }> = [];
    return {
      asked,
      ask: {
        select: async () => '',
        text: async () => '',
        confirm: async () => true,
        multiselect: async (message, _o, initial) => {
          asked.push({ message, initial });
          return answer;
        },
      },
    };
  };
  const codes = (r: Captured): string[] => (JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { frameworks: Array<{ code: string }> }).frameworks.map((f) => f.code);

  it('--framework names the standards and an unknown one is refused (exit 2)', async () => {
    const d = await repo();
    expect(codes(await scan({ path: d, framework: 'gdpr', json: true }))).toEqual(['gdpr']);
    expect((await scan({ path: d, framework: 'hipaa' })).code).toBe(2);
  });

  it('without it, a non-interactive run uses compliance_frameworks, and with none evaluates nothing', async () => {
    const d = await repo({ 'sdlc-config.json': JSON.stringify({ project_slug: 'x', compliance_frameworks: ['soc-2'] }) });
    expect(codes(await scan({ path: d, json: true }))).toEqual(['soc-2']);
    expect(codes(await scan({ path: await repo(), json: true }))).toEqual([]);
  });

  it('an interactive run asks once and defaults to compliance_frameworks', async () => {
    const d = await repo({ 'sdlc-config.json': JSON.stringify({ project_slug: 'x', compliance_frameworks: ['iso-27001'] }) });
    const a = ask(['gdpr']);
    const r = await scan({ path: d, json: true }, { interactive: true, ask: a.ask });
    expect(a.asked).toHaveLength(1);
    expect(a.asked[0]!.initial).toEqual(['iso-27001']);
    expect(codes(r)).toEqual(['gdpr']);
  });
});

describe('flags and exit codes', () => {
  it('--local with --github is refused (exit 2)', async () => {
    const r = await scan({ path: await repo(), local: true, github: true });
    expect(r.code).toBe(2);
  });

  it('--max-missing needs --ci and a whole number', async () => {
    const d = await repo();
    expect((await scan({ path: d, maxMissing: '2' })).code).toBe(2);
    expect((await scan({ path: d, ci: true, maxMissing: 'two' })).code).toBe(2);
  });

  it('--ci exits 1 only when more than --max-missing clauses are missing', async () => {
    const d = await repo({ 'sdlc-config.json': JSON.stringify({ project_slug: 'x', compliance_frameworks: ['gdpr'] }) });
    const missing = (JSON.parse((await scan({ path: d, json: true })).stdout.trim().split('\n').at(-1)!) as { frameworks: Array<{ clauses: Array<{ state: string }> }> }).frameworks[0]!.clauses.filter((c) => c.state === 'missing').length;
    expect(missing).toBeGreaterThan(1);
    expect((await scan({ path: d, ci: true })).code).toBe(1);
    expect((await scan({ path: d, ci: true, maxMissing: String(missing - 1) })).code).toBe(1);
    expect((await scan({ path: d, ci: true, maxMissing: String(missing) })).code).toBe(0);
    expect((await scan({ path: d })).code).toBe(0); // without --ci a report is always exit 0
  });
});

describe('outputs', () => {
  it('--out writes all four files and the badge says what the issue specifies', async () => {
    const d = await repo({ 'sdlc-config.json': JSON.stringify({ project_slug: 'x', compliance_frameworks: ['soc-2'] }) });
    const out = join(await repo(), 'reports');
    const r = await scan({ path: d, out });
    expect(r.code).toBe(0);
    expect((await fs.readdir(out)).sort()).toEqual(['scan-badge.svg', 'scan-report.json', 'scan.html', 'scan.sarif']);
    const badge = await fs.readFile(join(out, 'scan-badge.svg'), 'utf-8');
    expect(badge).toMatch(/evidence readiness · soc-2 · \d+ of 8/);
    expect(badge).not.toMatch(/compliant|certified|pass|%/i);
    expect(JSON.parse(await fs.readFile(join(out, 'scan.sarif'), 'utf-8')).version).toBe('2.1.0');
  });

  it('--html, --sarif and --badge write the named files', async () => {
    const d = await repo();
    const where = await repo();
    await scan({ path: d, framework: 'gdpr', html: join(where, 'a.html'), sarif: join(where, 'a.sarif'), badge: join(where, 'a.svg') });
    expect((await fs.readdir(where)).filter((f) => f.startsWith('a.')).sort()).toEqual(['a.html', 'a.sarif', 'a.svg']);
  });

  it('writes nothing into the scanned repository, and the last report is cached in DEVAUDIT_CACHE_DIR', async () => {
    const d = await repo({ 'AGENT.md': 'ours', 'sdlc-config.json': JSON.stringify({ project_slug: 'x', compliance_frameworks: ['soc-2'] }) });
    const before = await listAll(d);
    await scan({ path: d });
    expect(await listAll(d)).toEqual(before);
    const cache = cacheFileFor(await fs.realpath(d));
    expect(cache.startsWith(CACHE_DIR)).toBe(true);
    expect(CACHE_DIR).toBe(process.env['DEVAUDIT_CACHE_DIR']);
    expect(JSON.parse(await fs.readFile(cache, 'utf-8')).scanVersion).toBe('1');
  });
});

describe('no network', () => {
  const server = setupServer();
  const seen: string[] = [];
  beforeAll(() => {
    // Any request at all is recorded (and would fail the test below); nothing is meant to reach the network.
    server.use(http.all('*', ({ request }) => { seen.push(request.url); return HttpResponse.text('blocked', { status: 599 }); }));
    server.listen({ onUnhandledFrame: 'error' });
  });
  afterAll(() => server.close());

  it('the default report and --local make no request at all', async () => {
    const d = await repo({ '.github/workflows/ci.yml': WORKFLOW });
    seen.length = 0;
    await scan({ path: d, framework: 'soc-2,gdpr' });
    await scan({ path: d, framework: 'soc-2', local: true, json: true });
    expect(seen).toEqual([]);
  });
});

describe('--github is read-only posture through gh', () => {
  it('reads the release branch protection and adds a gap when no review is required', async () => {
    const d = await repo();
    const calls: string[][] = [];
    const gh = async (args: readonly string[]): Promise<{ exitCode: number; stdout: string }> => {
      calls.push([...args]);
      return { exitCode: 0, stdout: '0\n' };
    };
    const r = await scan({ path: d, github: true, json: true }, { gh });
    const report = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { gaps: Array<{ id: string }>; suggestionReason: string };
    expect(calls[0]!.slice(0, 2)).toEqual(['api', 'repos/{owner}/{repo}/branches/main/protection']);
    expect(report.gaps.map((g) => g.id)).toContain('scan:github:release-branch-reviews');
    expect(report.suggestionReason).toContain('requires 0 approving reviews');
    expect(validator()(report)).toBe(true);
  });
});
