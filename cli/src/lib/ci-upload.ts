import { openAsBlob, promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { DevAuditApiError } from './devaudit-api.js';
import {
  renderEvidenceLineageFields,
  type EvidenceScope,
  type LineagePortalCapabilities,
} from './release-lineage-contract.js';

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
  /** Reviewer-facing short description — forwarded as `releaseSummary` (portal no-clobbers existing values). DevAudit-Installer#285. */
  readonly releaseSummary?: string;
  /** Conventional-commit prefix for the release row — forwarded as `changeType`. */
  readonly changeType?: string;
  /** `passed` | `failed` | `skipped` — forwarded as `gateStatus`. */
  readonly gateStatus?: string;
  /** SDLC stage 1-5 — forwarded as `sdlcStage` (parity with upload-evidence.sh). */
  readonly sdlcStage?: string;
  /** Test execution identifier - transported as `testCycleId` until the portal upload field is renamed. */
  readonly testExecutionId?: string;
  /** Evidence ownership scope — forwarded as `evidenceScope`. */
  readonly evidenceScope?: EvidenceScope;
  /** First-class test execution UUID - transported as `testCycleRecordId` until the upload field is renamed. */
  readonly testExecutionRecordId?: string;
  /** Raw `.sdlc-implementer-invoked` content for portal-side sentinel verification. */
  readonly sentinelContent?: string;
  /** Commit timestamp used during portal-side sentinel verification. */
  readonly commitTimestamp?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly lineageCapabilities?: LineagePortalCapabilities;
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

interface UploadSource {
  readonly blob: Blob;
  readonly size: number;
  readonly mimeType: string;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_UPLOAD_MAX_TIME_SECONDS = 120;
const INITIAL_BACKOFF_MS = 1000;

// DevAudit-Installer#189 — files above this size use the presigned R2 URL
// upload flow (3-step: request URL → PUT to R2 → notify portal) instead of
// the multipart POST. Parity with scripts/upload-evidence.sh.
const DEFAULT_PRESIGNED_THRESHOLD_BYTES = 26214400; // 25MB
const DEFAULT_PRESIGNED_MAX_ATTEMPTS = 3;
const DEFAULT_PRESIGNED_UPLOAD_MAX_TIME_SECONDS = 300;
const STUB_PREFIX_BYTES = 4096;

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
const TEXT_STUB_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.yml',
  '.yaml',
  '.csv',
  '.html',
  '.xml',
  '.log',
]);

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function extensionOf(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot === -1 ? '' : file.slice(dot).toLowerCase();
}

function isTextLikeEvidenceFile(file: string): boolean {
  return TEXT_STUB_EXTENSIONS.has(extensionOf(file));
}

async function readFilePrefix(file: string, bytes: number): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await handle.close();
  }
}

async function isUneditedStub(file: string): Promise<boolean> {
  if (!isTextLikeEvidenceFile(file)) return false;
  const prefix = await readFilePrefix(file, STUB_PREFIX_BYTES);
  return STUB_BANNER.test(prefix);
}

async function createUploadSource(file: string): Promise<UploadSource> {
  const mimeType = deriveMimeType(file);
  const { size } = await fs.stat(file);
  try {
    return {
      blob: await openAsBlob(file, { type: mimeType }),
      size,
      mimeType,
    };
  } catch {
    return {
      blob: new Blob([await fs.readFile(file)], { type: mimeType }),
      size,
      mimeType,
    };
  }
}

function buildUploadForm(file: string, source: UploadSource, opts: UploadOptions): FormData {
  const metadata = {
    ...(opts.metadata ?? {}),
    ...(opts.commitTimestamp ? { commitTimestamp: opts.commitTimestamp } : {}),
  };
  const lineageFields = renderEvidenceLineageFields(
    {
      evidenceScope: opts.evidenceScope,
      testExecutionRecordId: opts.testExecutionRecordId,
      testExecutionId: opts.testExecutionId,
    },
    opts.lineageCapabilities ?? { supportsFirstClassTestExecutionApi: true },
  );
  const form = new FormData();
  form.set('file', source.blob, basename(file));
  form.set('projectSlug', opts.projectSlug);
  form.set('requirementId', opts.requirementId);
  form.set('evidenceType', opts.evidenceType);
  form.set('metadata', JSON.stringify(metadata));
  if (opts.releaseVersion) form.set('releaseVersion', opts.releaseVersion);
  if (opts.createReleaseIfMissing) form.set('createReleaseIfMissing', 'true');
  if (opts.environment) form.set('environment', opts.environment);
  if (opts.evidenceCategory) form.set('evidenceCategory', opts.evidenceCategory);
  if (opts.releaseBranch) form.set('releaseBranch', opts.releaseBranch);
  if (opts.releaseTitle) form.set('releaseTitle', opts.releaseTitle);
  if (opts.releaseSummary) form.set('releaseSummary', opts.releaseSummary);
  if (opts.changeType) form.set('changeType', opts.changeType);
  if (opts.gateStatus) form.set('gateStatus', opts.gateStatus);
  if (opts.sdlcStage) form.set('sdlcStage', opts.sdlcStage);
  if (lineageFields.testExecutionId) form.set('testCycleId', lineageFields.testExecutionId);
  if (lineageFields.evidenceScope) {
    form.set('evidenceScope', lineageFields.evidenceScope === 'execution' ? 'cycle' : lineageFields.evidenceScope);
  }
  if (lineageFields.testExecutionRecordId) {
    form.set('testCycleRecordId', lineageFields.testExecutionRecordId);
  }
  if (opts.sentinelContent) form.set('sentinelContent', opts.sentinelContent);
  if (opts.commitTimestamp) form.set('commitTimestamp', opts.commitTimestamp);
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

async function uploadOne(
  file: string,
  source: UploadSource,
  opts: UploadOptions,
): Promise<UploadResult> {
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
        body: buildUploadForm(file, source, opts),
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

const PRESIGNED_FALLBACK = Symbol('presigned-fallback');

async function uploadPresigned(
  file: string,
  source: UploadSource,
  opts: UploadOptions,
): Promise<UploadResult | typeof PRESIGNED_FALLBACK> {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const presignUrl = `${baseUrl}/api/evidence/upload-url`;
  const completeUrl = `${baseUrl}/api/evidence/upload-complete`;
  const maxAttemptsPresigned = DEFAULT_PRESIGNED_MAX_ATTEMPTS;
  const timeoutSeconds = uploadMaxTimeSeconds();
  const presignedTimeoutSeconds = DEFAULT_PRESIGNED_UPLOAD_MAX_TIME_SECONDS;

  const metadata = {
    ...(opts.metadata ?? {}),
    ...(opts.commitTimestamp ? { commitTimestamp: opts.commitTimestamp } : {}),
  };
  const lineageFields = renderEvidenceLineageFields(
    {
      evidenceScope: opts.evidenceScope,
      testExecutionRecordId: opts.testExecutionRecordId,
      testExecutionId: opts.testExecutionId,
    },
    opts.lineageCapabilities ?? { supportsFirstClassTestExecutionApi: true },
  );

  // Step 1: Request presigned upload URL
  let uploadUrl = '';
  let evidenceId = '';
  let attempt = 1;
  let backoff = INITIAL_BACKOFF_MS;
  while (attempt <= maxAttemptsPresigned) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    let res: Response;
    try {
      res = await fetch(presignUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          projectSlug: opts.projectSlug,
          requirementId: opts.requirementId,
          evidenceType: opts.evidenceType,
          fileName: basename(file),
          fileSizeBytes: source.size,
          mimeType: source.mimeType,
          metadata,
          ...(opts.releaseVersion ? { releaseVersion: opts.releaseVersion } : {}),
          ...(opts.createReleaseIfMissing ? { createReleaseIfMissing: true } : {}),
          ...(opts.releaseBranch ? { releaseBranch: opts.releaseBranch } : {}),
          ...(opts.environment ? { environment: opts.environment } : {}),
          ...(opts.evidenceCategory ? { evidenceCategory: opts.evidenceCategory } : {}),
          ...(opts.releaseTitle ? { releaseTitle: opts.releaseTitle } : {}),
          ...(opts.releaseSummary ? { releaseSummary: opts.releaseSummary } : {}),
          ...(opts.changeType ? { changeType: opts.changeType } : {}),
          ...(opts.sdlcStage ? { sdlcStage: opts.sdlcStage } : {}),
          ...(lineageFields.testExecutionId ? { testCycleId: lineageFields.testExecutionId } : {}),
          ...(lineageFields.evidenceScope
            ? {
                evidenceScope:
                  lineageFields.evidenceScope === 'execution' ? 'cycle' : lineageFields.evidenceScope,
              }
            : {}),
          ...(lineageFields.testExecutionRecordId
            ? { testCycleRecordId: lineageFields.testExecutionRecordId }
            : {}),
          ...(opts.sentinelContent ? { sentinelContent: opts.sentinelContent } : {}),
          ...(opts.commitTimestamp ? { commitTimestamp: opts.commitTimestamp } : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (attempt < maxAttemptsPresigned) {
        await delay(backoff);
        backoff *= 2;
        attempt += 1;
        continue;
      }
      return { file, ok: false, status: 0, error: uploadFailureMessage(err, timeoutSeconds) };
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      const body = await res.json().catch(() => null) as { uploadUrl?: string; evidenceId?: string } | null;
      if (body?.uploadUrl && body?.evidenceId) {
        uploadUrl = body.uploadUrl;
        evidenceId = body.evidenceId;
        break;
      }
      // Portal responded 2xx but didn't return presigned URL fields —
      // presigned URL flow not configured. Fall back to multipart.
      return PRESIGNED_FALLBACK;
    }
    if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttemptsPresigned) {
      await delay(backoff);
      backoff *= 2;
      attempt += 1;
      continue;
    }
    // Non-retriable error (4xx other than 429)
    const errText = await res.text().catch(() => '(no body)');
    return { file, ok: false, status: res.status, error: `presigned step 1: ${errText}` };
  }
  if (!uploadUrl || !evidenceId) {
    return { file, ok: false, status: 0, error: 'presigned step 1: no URL after retries' };
  }

  // Step 2: Upload directly to R2 via presigned URL
  attempt = 1;
  backoff = INITIAL_BACKOFF_MS;
  while (attempt <= maxAttemptsPresigned) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), presignedTimeoutSeconds * 1000);
    let res: Response;
    try {
      res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': source.mimeType },
        body: source.blob,
        signal: controller.signal,
      });
    } catch (err) {
      if (attempt < maxAttemptsPresigned) {
        await delay(backoff);
        backoff *= 2;
        attempt += 1;
        continue;
      }
      return { file, ok: false, status: 0, error: `presigned step 2: ${uploadFailureMessage(err, presignedTimeoutSeconds)}` };
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) break;
    if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttemptsPresigned) {
      await delay(backoff);
      backoff *= 2;
      attempt += 1;
      continue;
    }
    return { file, ok: false, status: res.status, error: `presigned step 2: HTTP ${res.status}` };
  }

  // Step 3: Notify portal that upload is complete
  attempt = 1;
  backoff = INITIAL_BACKOFF_MS;
  while (attempt <= maxAttemptsPresigned) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    let res: Response;
    try {
      res = await fetch(completeUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ evidenceId }),
        signal: controller.signal,
      });
    } catch (err) {
      if (attempt < maxAttemptsPresigned) {
        await delay(backoff);
        backoff *= 2;
        attempt += 1;
        continue;
      }
      return { file, ok: false, status: 0, error: `presigned step 3: ${uploadFailureMessage(err, timeoutSeconds)}` };
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      const body = await res.json().catch(() => null);
      return { file, ok: true, status: res.status, body };
    }
    if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttemptsPresigned) {
      await delay(backoff);
      backoff *= 2;
      attempt += 1;
      continue;
    }
    return { file, ok: false, status: res.status, error: `presigned step 3: HTTP ${res.status}` };
  }
  return { file, ok: false, status: 0, error: 'presigned step 3: max retries exhausted' };
}

function deriveMimeType(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.html')) return 'text/html';
  return 'application/octet-stream';
}

export async function uploadEvidence(opts: UploadOptions): Promise<readonly UploadResult[]> {
  const files = await collectFiles(opts.filePath);
  if (files.length === 0) {
    throw new DevAuditApiError(`No files at ${opts.filePath}`, 0, '');
  }
  const results: UploadResult[] = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    if (await isUneditedStub(file)) {
      results.push({ file, ok: true, status: 0, skipped: true });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const source = await createUploadSource(file);
    // DevAudit-Installer#189 — large files use the presigned R2 URL flow.
    // Falls back to multipart if the portal doesn't support presigned URLs.
    if (source.size >= DEFAULT_PRESIGNED_THRESHOLD_BYTES) {
      // eslint-disable-next-line no-await-in-loop
      const presignedResult = await uploadPresigned(file, source, opts);
      if (presignedResult !== PRESIGNED_FALLBACK) {
        results.push(presignedResult);
        continue;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    results.push(await uploadOne(file, source, opts));
  }
  return results;
}
