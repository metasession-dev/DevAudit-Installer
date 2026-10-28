import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import type { PluginContext, PluginEvent } from '@metasession.co/devaudit-plugin-sdk';

const BASE_URL = 'https://devaudit.test';
const FILE_BYTES = new TextEncoder().encode('evidence-fixture-content');

interface LoggerCapture {
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
  readonly debug: string[];
}

function makeCtx(events: PluginEvent[] = [], auth?: () => Promise<{ token: string; baseUrl: string } | null>): { ctx: PluginContext; capture: LoggerCapture } {
  const capture: LoggerCapture = { info: [], warn: [], error: [], debug: [] };
  const ctx: PluginContext = {
    projectPath: '/tmp',
    sdlcConfig: { project_slug: 'fixture', devaudit: { base_url: BASE_URL } },
    logger: {
      info: (m) => capture.info.push(m),
      warn: (m) => capture.warn.push(m),
      error: (m) => capture.error.push(m),
      debug: (m) => capture.debug.push(m),
    },
    apiVersion: '1',
    emit: (e) => events.push(e),
    ...(auth ? { getPersonalAuth: auth } : {}),
  };
  return { ctx, capture };
}

const happyHandlers = [
  http.get(`${BASE_URL}/api/evidence`, ({ request }) => {
    const url = new URL(request.url);
    const reqId = url.searchParams.get('requirementId');
    if (reqId) {
      return HttpResponse.json([
        {
          id: 'ev1',
          requirement_id: reqId,
          file_path: `fixture/${reqId}/file-a.pdf`,
          file_name: 'file-a.pdf',
          file_size_bytes: FILE_BYTES.length,
          mime_type: 'application/pdf',
          uploaded_at: '2026-05-19T00:00:00Z',
        },
      ]);
    }
    return HttpResponse.json([
      { requirement_id: 'REQ-001', evidence_count: 1, latest_upload: '2026-05-19T00:00:00Z' },
      { requirement_id: 'REQ-002', evidence_count: 1, latest_upload: '2026-05-19T00:00:00Z' },
      { requirement_id: 'REQ-EMPTY', evidence_count: 0, latest_upload: null },
    ]);
  }),
  http.get(`${BASE_URL}/api/evidence/download`, ({ request }) => {
    const filePath = new URL(request.url).searchParams.get('filePath') ?? '';
    return HttpResponse.json({ signedUrl: `${BASE_URL}/download-stream/${encodeURIComponent(filePath)}` });
  }),
  http.get(`${BASE_URL}/download-stream/:path`, () =>
    new HttpResponse(FILE_BYTES, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }),
  ),
];

const server = setupServer(...happyHandlers);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  process.env['DEVAUDIT_USER_TOKEN'] = 'mctok_test_fixture';
});
afterAll(() => {
  server.close();
  delete process.env['DEVAUDIT_USER_TOKEN'];
});
afterEach(() => {
  server.resetHandlers(...happyHandlers);
});

describe('list command', () => {
  it('prints requirements with counts', async () => {
    const { list } = await import('../src/commands/list.js');
    const events: PluginEvent[] = [];
    const { ctx, capture } = makeCtx(events);
    await list(ctx, ['fixture']);
    const joined = capture.info.join('\n');
    expect(joined).toContain('REQ-001');
    expect(joined).toContain('REQ-002');
    expect(events.find((e) => e.type === 'evidence-export-list')).toBeDefined();
  });

  it('errors clearly when projectSlug is missing', async () => {
    const { list } = await import('../src/commands/list.js');
    const { ctx, capture } = makeCtx();
    await list(ctx, []);
    expect(capture.error[0]).toMatch(/Usage:/);
  });

  it('errors clearly when no token is available from the CLI or the environment', async () => {
    delete process.env['DEVAUDIT_USER_TOKEN'];
    try {
      const { list } = await import('../src/commands/list.js');
      const { ctx } = makeCtx([], async () => null);
      await expect(list(ctx, ['fixture'])).rejects.toThrow(/devaudit auth login/);
      // No accessor (an older CLI) and no env var: same message.
      const { ctx: old } = makeCtx();
      await expect(list(old, ['fixture'])).rejects.toThrow(/devaudit auth login/);
    } finally {
      process.env['DEVAUDIT_USER_TOKEN'] = 'mctok_test_fixture';
    }
  });

  it('uses the CLI-provided token and never needs DEVAUDIT_USER_TOKEN (#1100)', async () => {
    delete process.env['DEVAUDIT_USER_TOKEN'];
    try {
      const seen: Array<string | null> = [];
      server.use(
        http.get(`${BASE_URL}/api/evidence`, ({ request }) => {
          seen.push(request.headers.get('x-devaudit-token') ?? request.headers.get('authorization'));
          return HttpResponse.json([{ requirement_id: 'REQ-001', evidence_count: 1, latest_upload: null }]);
        }),
      );
      const { list } = await import('../src/commands/list.js');
      const { ctx, capture } = makeCtx([], async () => ({ token: 'mctok_from_cli', baseUrl: BASE_URL }));
      await list(ctx, ['fixture']);
      expect(seen.length).toBe(1);
      expect(String(seen[0])).toContain('mctok_from_cli');
      // The token is never logged.
      expect(JSON.stringify(capture)).not.toContain('mctok_from_cli');
    } finally {
      process.env['DEVAUDIT_USER_TOKEN'] = 'mctok_test_fixture';
    }
  });

  it('falls back to DEVAUDIT_USER_TOKEN when the CLI has no accessor', async () => {
    const { resolveAuth } = await import('../src/util/token.js');
    const { ctx } = makeCtx();
    await expect(resolveAuth(ctx, BASE_URL)).resolves.toMatchObject({ token: 'mctok_test_fixture', baseUrl: BASE_URL });
  });

  it('surfaces portal 401s', async () => {
    server.use(http.get(`${BASE_URL}/api/evidence`, () => new HttpResponse(null, { status: 401 })));
    const { list } = await import('../src/commands/list.js');
    const { ctx } = makeCtx();
    await expect(list(ctx, ['fixture'])).rejects.toThrow(/HTTP 401/);
  });
});

describe('bundle command', () => {
  it('downloads all evidence to <output>/<requirementId>/<file>', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'ev-bundle-'));
    try {
      const { bundle } = await import('../src/commands/bundle.js');
      const events: PluginEvent[] = [];
      const { ctx } = makeCtx(events);
      await bundle(ctx, ['fixture', '--output', dir]);
      expect((await fs.stat(join(dir, 'REQ-001', 'file-a.pdf'))).size).toBe(FILE_BYTES.length);
      expect((await fs.stat(join(dir, 'REQ-002', 'file-a.pdf'))).size).toBe(FILE_BYTES.length);
      const manifest = JSON.parse(await fs.readFile(join(dir, 'manifest.json'), 'utf-8'));
      expect(manifest.project_slug).toBe('fixture');
      expect(manifest.total_files).toBe(2);
      expect(manifest.successful).toBe(2);
      expect(manifest.failed).toBe(0);
      expect(events.find((e) => e.type === 'evidence-export-bundle')).toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('isolates per-file download failures and records them in manifest', async () => {
    server.use(
      http.get(`${BASE_URL}/download-stream/:path`, ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname.includes('REQ-002')) {
          return new HttpResponse(null, { status: 500 });
        }
        return new HttpResponse(FILE_BYTES, { status: 200 });
      }),
    );
    const dir = await fs.mkdtemp(join(tmpdir(), 'ev-bundle-partial-'));
    try {
      const { bundle } = await import('../src/commands/bundle.js');
      const { ctx } = makeCtx();
      await bundle(ctx, ['fixture', '--output', dir]);
      const manifest = JSON.parse(await fs.readFile(join(dir, 'manifest.json'), 'utf-8'));
      expect(manifest.successful).toBe(1);
      expect(manifest.failed).toBe(1);
      const failed = manifest.entries.find((e: { error?: string }) => e.error);
      expect(failed?.error).toMatch(/HTTP 500/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('errors when output flag is missing', async () => {
    const { bundle } = await import('../src/commands/bundle.js');
    const { ctx, capture } = makeCtx();
    await bundle(ctx, ['fixture']);
    expect(capture.error[0]).toMatch(/Usage:/);
  });
});

describe('onDoctor hook', () => {
  it('warns only when neither the CLI nor the environment has a token', async () => {
    delete process.env['DEVAUDIT_USER_TOKEN'];
    try {
      const { onDoctor } = await import('../src/hooks/on-doctor.js');
      const { ctx, capture } = makeCtx([], async () => null);
      await onDoctor(ctx);
      expect(capture.warn[0]).toMatch(/no personal access token/);
      // The CLI has a token and the env var is unset: no warning.
      const { ctx: ctx2, capture: capture2 } = makeCtx([], async () => ({ token: 't', baseUrl: BASE_URL }));
      await onDoctor(ctx2);
      expect(capture2.warn).toEqual([]);
      expect(capture2.info[0]).toMatch(/available/);
    } finally {
      process.env['DEVAUDIT_USER_TOKEN'] = 'mctok_test_fixture';
    }
  });

  it('confirms when token is present', async () => {
    const { onDoctor } = await import('../src/hooks/on-doctor.js');
    const { ctx, capture } = makeCtx();
    await onDoctor(ctx);
    expect(capture.info[0]).toMatch(/available/);
  });
});
