import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * #298 — Regression tests for presigned upload error surfacing.
 *
 * Verifies that:
 * 1. Portal R2-required error message is surfaced on presigned step 1 failure
 * 2. Content-Type sent to /upload-url metadata matches the R2 PUT Content-Type header
 */

// We need to mock global fetch to simulate portal responses
const originalFetch = global.fetch;

function makeMockResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: new Headers(headers),
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as Response;
}

describe('#298 — presigned upload error surfacing', () => {
  let tempFile: string;

  beforeEach(async () => {
    // Create a temp file large enough to trigger the presigned path (>25MB)
    tempFile = join(tmpdir(), `devaudit-test-${Date.now()}.zip`);
    // Write 26MB of zeros — above the 25MB presigned threshold
    const buf = Buffer.alloc(26 * 1024 * 1024, 0);
    await fs.writeFile(tempFile, buf);
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    try {
      await fs.unlink(tempFile);
    } catch {
      // ignore
    }
  });

  it('surfaces Portal R2-required error message on presigned step 1 failure', async () => {
    const portalErrorMessage =
      'Presigned uploads require R2 storage configuration. Set R2_EVIDENCE_BUCKET and related env vars to enable large-file uploads (>25MB).';

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse(501, JSON.stringify({ error: portalErrorMessage })),
    );
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const { uploadEvidence } = await import('../src/lib/ci-upload.js');

    const results = await uploadEvidence({
      projectSlug: 'test-project',
      requirementId: 'REQ-001',
      evidenceType: 'e2e_result',
      filePath: tempFile,
      apiKey: 'mc_test_key',
      baseUrl: 'https://portal.test',
    });

    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result).toBeDefined();
    expect(result!.ok).toBe(false);
    expect(result!.status).toBe(501);
    expect(result!.error).toContain('presigned step 1');
    expect(result!.error).toContain(portalErrorMessage);
  });

  it('surfaces Portal error for non-retriable 403 forbidden', async () => {
    const portalErrorMessage = 'API key does not have upload permission for this project.';

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse(403, JSON.stringify({ error: portalErrorMessage })),
    );
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const { uploadEvidence } = await import('../src/lib/ci-upload.js');

    const results = await uploadEvidence({
      projectSlug: 'test-project',
      requirementId: 'REQ-001',
      evidenceType: 'e2e_result',
      filePath: tempFile,
      apiKey: 'mc_test_key',
      baseUrl: 'https://portal.test',
    });

    const [result] = results;
    expect(result).toBeDefined();
    expect(result!.ok).toBe(false);
    expect(result!.status).toBe(403);
    expect(result!.error).toContain(portalErrorMessage);
  });

  it('Content-Type sent to /upload-url matches R2 PUT Content-Type header', async () => {
    // #298 Problem 3 — The MIME type sent as `mimeType` in the /upload-url
    // JSON body must exactly match the Content-Type header on the R2 PUT.
    // If the Portal signs ContentType into the presigned PutObjectCommand,
    // a mismatch will cause R2 to reject the upload.
    let step1MimeType: string | undefined;
    let step2ContentType: string | undefined;

    const mockFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/evidence/upload-url')) {
        const body = JSON.parse(init?.body as string) as { mimeType?: string };
        step1MimeType = body.mimeType;
        return makeMockResponse(200, JSON.stringify({
          uploadUrl: 'https://r2.test/bucket/file.zip',
          evidenceId: 'ev-123',
        }));
      }
      if (urlStr.includes('r2.test')) {
        const headers = init?.headers as Record<string, string>;
        step2ContentType = headers?.['content-type'] ?? headers?.['Content-Type'];
        return makeMockResponse(200, '');
      }
      if (urlStr.includes('/api/evidence/upload-complete')) {
        return makeMockResponse(200, JSON.stringify({ ok: true }));
      }
      return makeMockResponse(404, 'not found');
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const { uploadEvidence } = await import('../src/lib/ci-upload.js');

    const results = await uploadEvidence({
      projectSlug: 'test-project',
      requirementId: 'REQ-001',
      evidenceType: 'e2e_result',
      filePath: tempFile,
      apiKey: 'mc_test_key',
      baseUrl: 'https://portal.test',
    });

    const [result] = results;
    expect(result).toBeDefined();
    expect(result!.ok).toBe(true);
    expect(step1MimeType).toBeDefined();
    expect(step2ContentType).toBeDefined();
    expect(step1MimeType).toBe(step2ContentType);
    // .zip file should derive application/zip
    expect(step1MimeType).toBe('application/zip');
  });
});
