import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { collectFiles } from '../src/lib/ci-upload.js';
import { loadStackAdapter, loadHostAdapter } from '../src/lib/adapter.js';
import { validateOptions } from '../src/commands/push.js';
import { runUpdate } from '../src/commands/update.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');

const tmps: string[] = [];
async function mktmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}
afterEach(async () => {
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
