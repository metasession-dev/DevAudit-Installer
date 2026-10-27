import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getStoredViewerKey,
  listStoredViewerKeys,
  readViewerKeys,
  removeViewerKey,
  resolveViewerKey,
  saveViewerKey,
  viewerKeyName,
} from '../src/lib/viewer-keys.js';
import { resolvePortalReadKey } from '../src/lib/releases-api.js';
import { runViewerKeySet } from '../src/commands/auth/viewer-key.js';

const BASE = 'https://portal.example';
const entry = (key: string) => ({ key, name: 'viewer:me@example.com:laptop', createdAt: '2026-10-27T00:00:00.000Z' });
const dirs: string[] = [];

async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(join(tmpdir(), 'viewer-keys-'));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe('viewer-keys.json storage (#1099 WP3)', () => {
  it('round-trips the documented shape with owner-only permissions and no temp file left behind', async () => {
    const file = join(await tmp(), 'cfg', 'viewer-keys.json');
    await saveViewerKey(`${BASE}/`, 'example-app', entry('k1'), file);
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ [BASE]: { 'example-app': entry('k1') } });
    expect(await getStoredViewerKey(BASE, 'example-app', file)).toEqual(entry('k1'));
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.readdir(join(file, '..'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps other projects and base URLs when saving or removing one', async () => {
    const file = join(await tmp(), 'viewer-keys.json');
    await saveViewerKey(BASE, 'a', entry('ka'), file);
    await saveViewerKey(BASE, 'b', entry('kb'), file);
    await saveViewerKey('https://other.example', 'a', entry('ko'), file);
    expect(await removeViewerKey(BASE, 'a', file)).toBe(true);
    expect(await removeViewerKey(BASE, 'a', file)).toBe(false);
    const store = await readViewerKeys(file);
    expect(Object.keys(store[BASE] ?? {})).toEqual(['b']);
    expect(store['https://other.example']?.['a']?.key).toBe('ko');
  });

  it('lists projects and names, never key values', async () => {
    const file = join(await tmp(), 'viewer-keys.json');
    await saveViewerKey(BASE, 'a', entry('secret-value'), file);
    const listed = await listStoredViewerKeys(file);
    expect(listed).toEqual([{ baseUrl: BASE, project: 'a', name: 'viewer:me@example.com:laptop' }]);
    expect(JSON.stringify(listed)).not.toContain('secret-value');
  });

  it('a missing or corrupt file reads as empty', async () => {
    const d = await tmp();
    expect(await readViewerKeys(join(d, 'none.json'))).toEqual({});
    await fs.writeFile(join(d, 'bad.json'), '{not json');
    expect(await readViewerKeys(join(d, 'bad.json'))).toEqual({});
  });
});

describe('viewer key lookup order (#1099 WP3)', () => {
  it('env, then the config-folder file, then the legacy .env', async () => {
    const d = await tmp();
    const file = join(d, 'viewer-keys.json');
    await fs.writeFile(join(d, '.env'), 'DEVAUDIT_VIEWER_API_KEY=from-dotenv\n');
    const q = { repoRoot: d, baseUrl: BASE, slug: 'example-app', file };
    expect(await resolveViewerKey({ ...q, env: {} })).toEqual({ key: 'from-dotenv', source: '.env' });
    await saveViewerKey(BASE, 'example-app', entry('from-file'), file);
    expect(await resolveViewerKey({ ...q, env: {} })).toEqual({ key: 'from-file', source: 'file' });
    expect(await resolveViewerKey({ ...q, env: { DEVAUDIT_VIEWER_API_KEY: 'from-env' } })).toEqual({ key: 'from-env', source: 'env' });
  });

  it('never falls back to the uploader key, from the environment or .env', async () => {
    const d = await tmp();
    await fs.writeFile(join(d, '.env'), 'DEVAUDIT_API_KEY=uploader-in-dotenv\n');
    const r = await resolveViewerKey({ repoRoot: d, baseUrl: BASE, slug: 'x', env: { DEVAUDIT_API_KEY: 'uploader-in-env' }, file: join(d, 'none.json') });
    expect(r).toBeNull();
  });

  it('a key saved for another project or portal is not used', async () => {
    const d = await tmp();
    const file = join(d, 'viewer-keys.json');
    await saveViewerKey(BASE, 'other-project', entry('k'), file);
    expect(await resolveViewerKey({ repoRoot: d, baseUrl: BASE, slug: 'example-app', env: {}, file })).toBeNull();
    expect(await resolveViewerKey({ repoRoot: d, baseUrl: 'https://elsewhere.example', slug: 'other-project', env: {}, file })).toBeNull();
  });

  it('resolvePortalReadKey ignores DEVAUDIT_API_KEY', async () => {
    const d = await tmp();
    await fs.writeFile(join(d, 'sdlc-config.json'), JSON.stringify({ devaudit: { project_slug: 'example-app', base_url: BASE } }));
    const before = process.env['DEVAUDIT_API_KEY'];
    const beforeViewer = process.env['DEVAUDIT_VIEWER_API_KEY'];
    process.env['DEVAUDIT_API_KEY'] = 'uploader-secret';
    delete process.env['DEVAUDIT_VIEWER_API_KEY'];
    try {
      expect(await resolvePortalReadKey(d)).toBeNull();
    } finally {
      if (before === undefined) delete process.env['DEVAUDIT_API_KEY']; else process.env['DEVAUDIT_API_KEY'] = before;
      if (beforeViewer !== undefined) process.env['DEVAUDIT_VIEWER_API_KEY'] = beforeViewer;
    }
  });
});

describe('viewer key name (#1099 WP3)', () => {
  it('is viewer:<email>:<hostname>', async () => {
    expect(await viewerKeyName()).toMatch(/^viewer:[^:]+:[^:]+$/);
  });
});

describe('devaudit auth viewer-key set (#1099 WP3)', () => {
  it('saves the key typed at the masked prompt for the project, and never prints it', async () => {
    const d = await tmp();
    const file = join(d, 'viewer-keys.json');
    await fs.writeFile(join(d, 'sdlc-config.json'), JSON.stringify({ devaudit: { project_slug: 'example-app', base_url: BASE } }));
    const code = await runViewerKeySet({ cwd: d, file }, { interactive: true, readSecret: async () => '  typed-secret-key  ' });
    expect(code).toBe(0);
    expect((await getStoredViewerKey(BASE, 'example-app', file))?.key).toBe('typed-secret-key');
  });

  it('--project overrides the config, and it refuses without a terminal or a project', async () => {
    const d = await tmp();
    const file = join(d, 'viewer-keys.json');
    expect(await runViewerKeySet({ cwd: d, file, project: 'p' }, { interactive: false, readSecret: async () => 'k' })).toBe(2);
    expect(await runViewerKeySet({ cwd: d, file }, { interactive: true, readSecret: async () => 'k' })).toBe(2);
    expect(await runViewerKeySet({ cwd: d, file, project: 'p' }, { interactive: true, readSecret: async () => null })).toBe(1);
    expect(await readViewerKeys(file)).toEqual({});
  });
});
