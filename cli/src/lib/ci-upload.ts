import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { DevAuditApiError } from './devaudit-api.js';

export interface UploadOptions {
  readonly projectSlug: string;
  readonly requirementId: string;
  readonly evidenceType: string;
  readonly filePath: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly releaseVersion?: string;
  readonly createReleaseIfMissing?: boolean;
  readonly environment?: string;
  readonly evidenceCategory?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface UploadResult {
  readonly file: string;
  readonly ok: boolean;
  readonly status: number;
  readonly body?: unknown;
  readonly error?: string;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 1000;

export async function collectFiles(filePath: string): Promise<readonly string[]> {
  const stat = await fs.stat(filePath);
  if (stat.isFile()) return [filePath];
  if (stat.isDirectory()) {
    const entries = await fs.readdir(filePath, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.isFile()) files.push(join(filePath, entry.name));
    }
    return files;
  }
  throw new Error(`${filePath} is neither a file nor a directory.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function uploadOne(file: string, opts: UploadOptions): Promise<UploadResult> {
  const form = new FormData();
  const buf = await fs.readFile(file);
  const blob = new Blob([new Uint8Array(buf)]);
  form.set('file', blob, basename(file));
  form.set('projectSlug', opts.projectSlug);
  form.set('requirementId', opts.requirementId);
  form.set('evidenceType', opts.evidenceType);
  form.set('metadata', JSON.stringify(opts.metadata ?? {}));
  if (opts.releaseVersion) form.set('releaseVersion', opts.releaseVersion);
  if (opts.createReleaseIfMissing) form.set('createReleaseIfMissing', 'true');
  if (opts.environment) form.set('environment', opts.environment);
  if (opts.evidenceCategory) form.set('evidenceCategory', opts.evidenceCategory);
  const url = `${opts.baseUrl.replace(/\/$/, '')}/api/evidence/upload`;
  let attempt = 1;
  let backoff = INITIAL_BACKOFF_MS;
  while (attempt <= MAX_ATTEMPTS) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${opts.apiKey}` },
      body: form,
    });
    if (res.ok) {
      const body = await res.json().catch(() => null);
      return { file, ok: true, status: res.status, body };
    }
    if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff;
      await delay(wait);
      backoff *= 2;
      attempt += 1;
      continue;
    }
    const errText = await res.text().catch(() => '(no body)');
    return { file, ok: false, status: res.status, error: errText };
  }
  return { file, ok: false, status: 0, error: 'max retries exhausted' };
}

export async function uploadEvidence(opts: UploadOptions): Promise<readonly UploadResult[]> {
  const files = await collectFiles(opts.filePath);
  if (files.length === 0) {
    throw new DevAuditApiError(`No files at ${opts.filePath}`, 0, '');
  }
  const results: UploadResult[] = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await uploadOne(file, opts));
  }
  return results;
}
