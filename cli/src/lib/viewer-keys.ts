import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { execa } from 'execa';
import { VIEWER_KEYS_FILE } from './paths.js';

/**
 * devaudit-installer#1099 WP3 — per-person viewer keys.
 *
 * A viewer key is read-only and belongs to one person on one machine. It lives
 * in the CLI config folder (`~/.config/devaudit/viewer-keys.json`, mode 0600),
 * never in the repository and never as a repo secret. Shape:
 * `{ "<baseUrl>": { "<projectSlug>": { key, name, createdAt } } }`.
 *
 * Lookup order everywhere the CLI reads it: `DEVAUDIT_VIEWER_API_KEY` in the
 * environment, then this file, then the repo-root `.env` (legacy, read-only;
 * the CLI never writes `.env`). `DEVAUDIT_API_KEY` is never a fallback.
 * Key values are never printed unless a caller is explicitly asked to.
 */

export interface StoredViewerKey {
  readonly key: string;
  readonly name: string;
  readonly createdAt: string;
}

export type ViewerKeyStore = Record<string, Record<string, StoredViewerKey>>;

export type ViewerKeySource = 'env' | 'file' | '.env';

export interface ResolvedViewerKey {
  readonly key: string;
  readonly source: ViewerKeySource;
}

const normalizeBase = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');

export async function readViewerKeys(file: string = VIEWER_KEYS_FILE): Promise<ViewerKeyStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as ViewerKeyStore;
  } catch {
    // absent or unreadable: treated as empty
  }
  return {};
}

async function writeStore(store: ViewerKeyStore, file: string): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, file);
}

export async function getStoredViewerKey(baseUrl: string, slug: string, file: string = VIEWER_KEYS_FILE): Promise<StoredViewerKey | null> {
  return (await readViewerKeys(file))[normalizeBase(baseUrl)]?.[slug] ?? null;
}

export async function saveViewerKey(baseUrl: string, slug: string, entry: StoredViewerKey, file: string = VIEWER_KEYS_FILE): Promise<void> {
  const store = await readViewerKeys(file);
  const base = normalizeBase(baseUrl);
  await writeStore({ ...store, [base]: { ...(store[base] ?? {}), [slug]: entry } }, file);
}

/** Returns true when an entry was removed. */
export async function removeViewerKey(baseUrl: string, slug: string, file: string = VIEWER_KEYS_FILE): Promise<boolean> {
  const store = await readViewerKeys(file);
  const base = normalizeBase(baseUrl);
  if (!store[base]?.[slug]) return false;
  const { [slug]: _gone, ...rest } = store[base]!;
  const next: ViewerKeyStore = { ...store };
  if (Object.keys(rest).length === 0) delete next[base];
  else next[base] = rest;
  await writeStore(next, file);
  return true;
}

/** Per project: whether a key is stored (never the value). */
export async function listStoredViewerKeys(file: string = VIEWER_KEYS_FILE): Promise<Array<{ baseUrl: string; project: string; name: string }>> {
  const store = await readViewerKeys(file);
  return Object.entries(store).flatMap(([baseUrl, projects]) =>
    Object.entries(projects ?? {}).map(([project, e]) => ({ baseUrl, project, name: e.name })),
  );
}

function readDotenvValue(content: string, name: string): string | null {
  for (const raw of content.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] !== name) continue;
    let value = m[2] ?? '';
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    return value.length > 0 ? value : null;
  }
  return null;
}

export interface ViewerLookup {
  readonly repoRoot: string;
  readonly baseUrl: string;
  readonly slug: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly file?: string;
}

/** env, then the config-folder file, then the legacy repo-root `.env`. */
export async function resolveViewerKey(q: ViewerLookup): Promise<ResolvedViewerKey | null> {
  const env = q.env ?? process.env;
  const fromEnv = env['DEVAUDIT_VIEWER_API_KEY'];
  if (fromEnv) return { key: fromEnv, source: 'env' };
  if (q.baseUrl && q.slug) {
    const stored = await getStoredViewerKey(q.baseUrl, q.slug, q.file);
    if (stored) return { key: stored.key, source: 'file' };
  }
  try {
    const legacy = readDotenvValue(await fs.readFile(join(q.repoRoot, '.env'), 'utf-8'), 'DEVAUDIT_VIEWER_API_KEY');
    if (legacy) return { key: legacy, source: '.env' };
  } catch {
    // no .env
  }
  return null;
}

/** `viewer:<user email>:<hostname>`: one key per person per project per machine. */
export async function viewerKeyName(cwd: string = process.cwd()): Promise<string> {
  let email = '';
  try {
    const r = await execa('git', ['config', 'user.email'], { cwd, reject: false });
    if (r.exitCode === 0) email = r.stdout.trim();
  } catch {
    // git unavailable
  }
  if (!email) email = userInfo().username;
  return `viewer:${email}:${hostname()}`;
}
