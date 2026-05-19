import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureLogger } from '../src/lib/logger.js';

const BASE_URL = 'https://devaudit.flag-polish.test';

interface CapturedWrite {
  data: string;
}

function captureStdout(): { writes: CapturedWrite[]; restore: () => void } {
  const writes: CapturedWrite[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    writes.push({ data: text });
    return original(chunk as never, ...(rest as never[]));
  }) as typeof process.stdout.write;
  return {
    writes,
    restore: () => {
      process.stdout.write = original as typeof process.stdout.write;
    },
  };
}

function findJsonLine(writes: readonly CapturedWrite[]): unknown {
  for (const w of writes) {
    const line = w.data.trim();
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        return JSON.parse(line);
      } catch {
        // not JSON
      }
    }
  }
  return null;
}

const uploadHits: string[] = [];

const handlers = [
  http.get(`${BASE_URL}/api/projects`, () =>
    HttpResponse.json([
      { id: 'p1', slug: 'fixture-a', name: 'fixture-a' },
      { id: 'p2', slug: 'fixture-b', name: 'fixture-b' },
    ]),
  ),
  http.post(`${BASE_URL}/api/evidence/upload`, () => {
    uploadHits.push('POST /api/evidence/upload');
    return HttpResponse.json({ ok: true }, { status: 200 });
  }),
];

const server = setupServer(...handlers);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  server.close();
});
afterEach(() => {
  server.resetHandlers(...handlers);
  uploadHits.length = 0;
  configureLogger({ json: false });
});

describe('auth status --json', () => {
  it('emits a single parseable JSON object on stdout', async () => {
    process.env['DEVAUDIT_USER_TOKEN'] = 'mctok_flag_polish';
    process.env['DEVAUDIT_BASE_URL'] = BASE_URL;
    configureLogger({ json: true });
    const cap = captureStdout();
    try {
      const { runAuthStatus } = await import('../src/commands/auth/status.js');
      await runAuthStatus();
      const parsed = findJsonLine(cap.writes) as { ok: boolean; projects: string[] } | null;
      expect(parsed?.ok).toBe(true);
      expect(parsed?.projects).toContain('fixture-a');
      expect(parsed?.projects).toContain('fixture-b');
    } finally {
      cap.restore();
      delete process.env['DEVAUDIT_USER_TOKEN'];
      delete process.env['DEVAUDIT_BASE_URL'];
    }
  });
});

describe('status --json', () => {
  it('emits a single parseable JSON object for a configured project', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'flag-polish-status-'));
    try {
      await fs.writeFile(
        join(dir, 'sdlc-config.json'),
        JSON.stringify({
          project_slug: 'fixture-a',
          stack: 'node',
          host: 'railway',
          node_version: 20,
          devaudit: { base_url: BASE_URL },
        }),
      );
      configureLogger({ json: true });
      const cap = captureStdout();
      try {
        const { runStatus } = await import('../src/commands/status.js');
        await runStatus({ path: dir });
        const parsed = findJsonLine(cap.writes) as {
          ok: boolean;
          project_slug: string;
          stack: string;
          files_present: string[];
          files_missing: string[];
        } | null;
        expect(parsed?.ok).toBe(true);
        expect(parsed?.project_slug).toBe('fixture-a');
        expect(parsed?.stack).toBe('node');
        expect(Array.isArray(parsed?.files_missing)).toBe(true);
      } finally {
        cap.restore();
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('emits a `not_onboarded` reason JSON when no sdlc-config.json exists', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'flag-polish-status-empty-'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      configureLogger({ json: true });
      const cap = captureStdout();
      try {
        const { runStatus } = await import('../src/commands/status.js');
        await runStatus({ path: dir });
        const parsed = findJsonLine(cap.writes) as { ok: boolean; reason: string } | null;
        expect(parsed?.ok).toBe(false);
        expect(parsed?.reason).toBe('not_onboarded');
        expect(exitSpy).toHaveBeenCalledWith(7);
      } finally {
        cap.restore();
      }
    } finally {
      exitSpy.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('push --dry-run', () => {
  it('does not POST evidence; reports planned files', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'flag-polish-push-'));
    try {
      await fs.writeFile(join(dir, 'evidence-a.txt'), 'hello');
      await fs.writeFile(join(dir, 'evidence-b.txt'), 'world');
      const { runPush } = await import('../src/commands/push.js');
      await runPush({
        projectSlug: 'fixture-a',
        requirementId: 'REQ-001',
        evidenceType: 'test_report',
        filePath: dir,
        baseUrl: BASE_URL,
        apiKey: 'dak_test',
        dryRun: true,
      });
      expect(uploadHits).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('with --json + --dry-run emits a structured planned payload', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'flag-polish-push-json-'));
    try {
      await fs.writeFile(join(dir, 'evidence-a.txt'), 'hello');
      configureLogger({ json: true });
      const cap = captureStdout();
      try {
        const { runPush } = await import('../src/commands/push.js');
        await runPush({
          projectSlug: 'fixture-a',
          requirementId: 'REQ-001',
          evidenceType: 'test_report',
          filePath: dir,
          baseUrl: BASE_URL,
          apiKey: 'dak_test',
          dryRun: true,
        });
        const parsed = findJsonLine(cap.writes) as { dryRun: boolean; files: { path: string }[] } | null;
        expect(parsed?.dryRun).toBe(true);
        expect(parsed?.files.length).toBe(1);
        expect(uploadHits).toHaveLength(0);
      } finally {
        cap.restore();
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
