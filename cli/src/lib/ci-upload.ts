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
  /** Git branch — forwarded as the `releaseBranch` form field (parity with upload-evidence.sh). */
  readonly releaseBranch?: string;
  /** Human title for the release row — forwarded as `releaseTitle` (portal no-clobbers existing values). */
  readonly releaseTitle?: string;
  /** Conventional-commit prefix for the release row — forwarded as `changeType`. */
  readonly changeType?: string;
  /** `passed` | `failed` | `skipped` — forwarded as `gateStatus`. */
  readonly gateStatus?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface UploadResult {
  readonly file: string;
  readonly ok: boolean;
  readonly status: number;
  readonly body?: unknown;
  readonly error?: string;
  /** True when the file was an unedited starter stub and was deliberately not uploaded. */
  readonly skipped?: boolean;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_UPLOAD_MAX_TIME_SECONDS = 120;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Retry budget — defaults to 5, overridable via `UPLOAD_MAX_ATTEMPTS`
 * (parity with scripts/upload-evidence.sh). Read at call time so tests/CI can
 * set the env var after import.
 */
function maxAttempts(): number {
  const raw = Number.parseInt(process.env['UPLOAD_MAX_ATTEMPTS'] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_ATTEMPTS;
}

/**
 * Per-attempt upload timeout — defaults to 120s, overridable via
 * `UPLOAD_MAX_TIME_SECONDS` (parity with scripts/upload-evidence.sh). Read at
 * call time so tests/CI can set the env var after import.
 */
function uploadMaxTimeSeconds(): number {
  const raw = Number(process.env['UPLOAD_MAX_TIME_SECONDS'] ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_UPLOAD_MAX_TIME_SECONDS;
}

/**
 * Recursively collect every regular file under `filePath` (parity with the
 * shell's `find -type f`). A single file returns itself.
 */
export async function collectFiles(filePath: string): Promise<readonly string[]> {
  const stat = await fs.stat(filePath);
  if (stat.isFile()) return [filePath];
  if (stat.isDirectory()) {
    const files: string[] = [];
    const entries = await fs.readdir(filePath, { withFileTypes: true });
    for (const entry of entries) {
      const child = join(filePath, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        files.push(...(await collectFiles(child)));
      } else if (entry.isFile()) {
        files.push(child);
      }
    }
    return files;
  }
  throw new Error(`${filePath} is neither a file nor a directory.`);
}

/**
 * Detect an unedited DevAudit starter stub by its banner
 * ("STARTER TEMPLATE — REPLACE BEFORE …"). Such files must never be uploaded
 * as evidence (devaudit#133). Binary files won't match the ASCII banner.
 */
const STUB_BANNER = /STARTER TEMPLATE.+REPLACE BEFORE/;
function isUneditedStub(buf: Buffer): boolean {
  return STUB_BANNER.test(buf.toString('utf-8'));
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function buildUploadForm(file: string, buf: Buffer, opts: UploadOptions): FormData {
  const form = new FormData();
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
  if (opts.releaseBranch) form.set('releaseBranch', opts.releaseBranch);
  if (opts.releaseTitle) form.set('releaseTitle', opts.releaseTitle);
  if (opts.changeType) form.set('changeType', opts.changeType);
  if (opts.gateStatus) form.set('gateStatus', opts.gateStatus);
  return form;
}

function uploadFailureMessage(err: unknown, timeoutSeconds: number): string {
  if (err instanceof Error && err.name === 'AbortError') {
    return `upload timed out after ${timeoutSeconds}s`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Probe `${baseUrl}/api/health` and warn if the host issues a cross-host
 * redirect (parity with the shell's base-URL drift check, devaudit-installer#143).
 * Best-effort — returns a warning string or `null`; never throws. Uploads still
 * succeed (fetch follows redirects); the warning nudges the operator to rotate
 * the DEVAUDIT_BASE_URL secret.
 */
export async function probeBaseUrlDrift(baseUrl: string): Promise<string | null> {
  try {
    const probeUrl = `${baseUrl.replace(/\/$/, '')}/api/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(probeUrl, { method: 'HEAD', redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.status < 300 || res.status >= 400) return null;
    const location = res.headers.get('location');
    if (!location) return null;
    const oldHost = new URL(baseUrl).host;
    const newHost = new URL(location, baseUrl).host;
    if (!newHost || oldHost === newHost) return null;
    return (
      `DEVAUDIT_BASE_URL host '${oldHost}' redirects to '${newHost}'. ` +
      `Rotate the DEVAUDIT_BASE_URL secret to the new host to avoid silent breakage ` +
      `(uploads still succeed this run). Ref: https://github.com/metasession-dev/DevAudit-Installer/issues/143`
    );
  } catch {
    return null;
  }
}

async function uploadOne(file: string, buf: Buffer, opts: UploadOptions): Promise<UploadResult> {
  const attempts = maxAttempts();
  const timeoutSeconds = uploadMaxTimeSeconds();
  const url = `${opts.baseUrl.replace(/\/$/, '')}/api/evidence/upload`;
  let attempt = 1;
  let backoff = INITIAL_BACKOFF_MS;
  while (attempt <= attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.apiKey}` },
        body: buildUploadForm(file, buf, opts),
        signal: controller.signal,
      });
    } catch (err) {
      const error = uploadFailureMessage(err, timeoutSeconds);
      if (attempt < attempts) {
        await delay(backoff);
        backoff *= 2;
        attempt += 1;
        continue;
      }
      return { file, ok: false, status: 0, error };
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      const body = await res.json().catch(() => null);
      return { file, ok: true, status: res.status, body };
    }
    if (RETRYABLE_STATUSES.has(res.status) && attempt < attempts) {
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
    const buf = await fs.readFile(file);
    if (isUneditedStub(buf)) {
      results.push({ file, ok: true, status: 0, skipped: true });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    results.push(await uploadOne(file, buf, opts));
  }
  return results;
}
