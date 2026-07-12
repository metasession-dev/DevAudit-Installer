import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';

import { collectFiles, uploadEvidence } from '../src/lib/ci-upload.js';
import { loadStackAdapter, loadHostAdapter } from '../src/lib/adapter.js';
import { validateOptions } from '../src/commands/push.js';
import { runUpdate } from '../src/commands/update.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const BIN = resolve(HERE, '..', 'bin', 'devaudit.js');

const tmps: string[] = [];
async function mktmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env['UPLOAD_MAX_ATTEMPTS'];
  delete process.env['UPLOAD_MAX_TIME_SECONDS'];
  while (tmps.length) await fs.rm(tmps.pop()!, { recursive: true, force: true });
});

// #155 — collectFiles walks directories recursively (parity with `find -type f`).
describe('ci-upload collectFiles (#155)', () => {
  it('recurses into nested directories', async () => {
    const dir = await mktmp('ci-collect-');
    await fs.mkdir(join(dir, 'a', 'b'), { recursive: true });
    await fs.writeFile(join(dir, 'top.txt'), 'x');
    await fs.writeFile(join(dir, 'a', 'mid.txt'), 'x');
    await fs.writeFile(join(dir, 'a', 'b', 'deep.txt'), 'x');
    const files = await collectFiles(dir);
    // Normalise to forward slashes so the assertion is cross-platform (Windows
    // uses `\` as the path separator).
    const rel = files.map((f) => relative(dir, f).split(sep).join('/')).sort();
    expect(rel).toEqual(['a/b/deep.txt', 'a/mid.txt', 'top.txt']);
  });
});

// wawagardenbar-app#382 — hung evidence uploads must be bounded.
describe('ci-upload upload timeout (#382)', () => {
  it('aborts a hung POST and returns a bounded failure result', async () => {
    const dir = await mktmp('ci-upload-timeout-');
    const file = join(dir, 'evidence.txt');
    await fs.writeFile(file, 'real evidence');
    process.env['UPLOAD_MAX_ATTEMPTS'] = '1';
    process.env['UPLOAD_MAX_TIME_SECONDS'] = '0.01';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(((_input: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as typeof fetch);

    const [result] = await uploadEvidence({
      projectSlug: 'my-project',
      requirementId: 'REQ-001',
      evidenceType: 'test_report',
      filePath: file,
      apiKey: 'mc_test_dummy',
      baseUrl: 'https://devaudit.example.test',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      file,
      ok: false,
      status: 0,
      error: 'upload timed out after 0.01s',
    });
  });
});

describe('ci-upload memory shape (#331)', () => {
  it('skips unedited text stubs without fs.readFile buffering or upload attempts', async () => {
    const dir = await mktmp('ci-upload-stub-');
    const file = join(dir, 'incident-report.md');
    await fs.writeFile(
      file,
      [
        '---',
        'title: Placeholder',
        '---',
        '',
        '> STARTER TEMPLATE -- REPLACE BEFORE COMMITTING',
        '',
        'This is still a stub.',
      ].join('\n'),
    );

    const readSpy = vi.spyOn(fs, 'readFile');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const [result] = await uploadEvidence({
      projectSlug: 'my-project',
      requirementId: '_compliance-docs',
      evidenceType: 'incident_report',
      filePath: file,
      apiKey: 'mc_test_dummy',
      baseUrl: 'https://devaudit.example.test',
    });

    expect(result).toMatchObject({ file, ok: true, status: 0, skipped: true });
    expect(readSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uploads normal files without going through fs.readFile', async () => {
    const dir = await mktmp('ci-upload-stream-');
    const file = join(dir, 'evidence.txt');
    await fs.writeFile(file, 'real evidence');

    const readSpy = vi.spyOn(fs, 'readFile');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true }),
      text: async () => '',
      headers: new Headers(),
    } as Response);

    const [result] = await uploadEvidence({
      projectSlug: 'my-project',
      requirementId: 'REQ-001',
      evidenceType: 'test_report',
      filePath: file,
      apiKey: 'mc_test_dummy',
      baseUrl: 'https://devaudit.example.test',
    });

    expect(result).toMatchObject({ file, ok: true, status: 201 });
    expect(readSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// #155 — client-side argument validation matching upload-evidence.sh.
describe('push validateOptions (#155)', () => {
  const base = { projectSlug: 's', requirementId: 'REQ-001', evidenceType: 't', filePath: 'f' };
  it('rejects --environment without --release', () => {
    expect(validateOptions({ ...base, environment: 'uat' })).toMatch(/--environment requires --release/);
  });
  it('rejects --release without --category', () => {
    expect(validateOptions({ ...base, release: 'v1.0.0' })).toMatch(/--category is required/);
  });
  it('rejects a bare --meta-key', () => {
    expect(validateOptions({ ...base, metaKeys: ['bad'] })).toMatch(/key=value/);
  });
  it('accepts a coherent set', () => {
    expect(
      validateOptions({ ...base, release: 'v1', category: 'ci_pipeline', metaKeys: ['k=v'] }),
    ).toBeNull();
  });
});

// #158 — adapters are validated against their JSON schema at load time.
describe('adapter schema validation (#158)', () => {
  it('loads the shipped node + railway adapters', async () => {
    await expect(loadStackAdapter(INSTALLER_ROOT, 'node')).resolves.toMatchObject({ name: 'node' });
    await expect(loadHostAdapter(INSTALLER_ROOT, 'railway')).resolves.toMatchObject({ name: 'railway' });
  });

  it('rejects a parseable-but-schema-invalid stack adapter', async () => {
    const root = await mktmp('adapter-bad-');
    // Bring the real schema across, then drop an adapter missing required keys.
    const schemaDst = join(root, 'sdlc', 'files', 'stacks', '_schema');
    const adapterDst = join(root, 'sdlc', 'files', 'stacks', 'broken');
    await fs.mkdir(schemaDst, { recursive: true });
    await fs.mkdir(adapterDst, { recursive: true });
    await fs.copyFile(
      join(INSTALLER_ROOT, 'sdlc', 'files', 'stacks', '_schema', 'adapter.schema.json'),
      join(schemaDst, 'adapter.schema.json'),
    );
    await fs.writeFile(join(adapterDst, 'adapter.json'), JSON.stringify({ name: 'broken' }));
    await expect(loadStackAdapter(root, 'broken')).rejects.toThrow(/failed schema validation/);
  });

  it('reports invalid JSON distinctly', async () => {
    const root = await mktmp('adapter-json-');
    const adapterDst = join(root, 'sdlc', 'files', 'stacks', 'oops');
    await fs.mkdir(adapterDst, { recursive: true });
    await fs.writeFile(join(adapterDst, 'adapter.json'), '{ not json');
    await expect(loadStackAdapter(root, 'oops')).rejects.toThrow(/Invalid JSON/);
  });
});

// #154 — `update --dry-run` must not write anything into the consumer.
describe('update --dry-run (#154)', () => {
  it('writes no files when dryRun is set', async () => {
    const dir = await mktmp('update-dry-');
    await fs.writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
    const before = await fs.readdir(dir);
    await runUpdate({ version: 'vTEST', paths: [dir], dryRun: true, plugins: [] });
    const after = await fs.readdir(dir);
    expect(after.sort()).toEqual(before.sort()); // no SDLC/, .github/, CLAUDE.md, etc.
  });
});

// #162 — driving the real binary (not runUpdate directly) catches the action
// arg-binding regression where commander bound `cmd` to the options object, so
// `cmd.optsWithGlobals()` threw "is not a function". Runs the built bin/ — CI
// builds before testing (cli.yml); run `npm run build` first locally.
describe('devaudit update via the CLI (#162)', () => {
  it('runs `update --dry-run <path>` exit 0 without the optsWithGlobals crash', async () => {
    const dir = await mktmp('update-cli-');
    await fs.writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
    const res = await execa('node', [BIN, 'update', '--dry-run', dir], { reject: false });
    expect(res.stderr).not.toMatch(/optsWithGlobals is not a function/);
    expect(res.exitCode).toBe(0);
    expect(await fs.readdir(dir)).toEqual(['package.json']); // dry-run wrote nothing
  });
});
