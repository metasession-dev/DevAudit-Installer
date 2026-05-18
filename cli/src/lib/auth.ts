import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { AUTH_FILE } from './paths.js';

interface AuthRecord {
  readonly version: 1;
  readonly token: string;
  readonly base_url: string;
}

const DEFAULT_BASE_URL = 'https://devaudit.metasession.co';

export async function readAuth(): Promise<AuthRecord | null> {
  try {
    const raw = await fs.readFile(AUTH_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as AuthRecord;
    if (parsed.version !== 1 || typeof parsed.token !== 'string') {
      return null;
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeAuth(token: string, baseUrl: string = DEFAULT_BASE_URL): Promise<void> {
  await fs.mkdir(dirname(AUTH_FILE), { recursive: true, mode: 0o700 });
  const record: AuthRecord = { version: 1, token, base_url: baseUrl };
  await fs.writeFile(AUTH_FILE, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
}

export async function deleteAuth(): Promise<boolean> {
  try {
    await fs.unlink(AUTH_FILE);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

export async function resolveToken(): Promise<{ token: string; baseUrl: string; source: 'env' | 'file' } | null> {
  const envToken = process.env['DEVAUDIT_USER_TOKEN'];
  if (envToken) {
    const envBase = process.env['DEVAUDIT_BASE_URL'] ?? DEFAULT_BASE_URL;
    return { token: envToken, baseUrl: envBase, source: 'env' };
  }
  const record = await readAuth();
  if (record) return { token: record.token, baseUrl: record.base_url, source: 'file' };
  return null;
}
