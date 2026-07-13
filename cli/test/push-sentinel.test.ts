import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmps: string[] = [];

async function mktmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  while (tmps.length) await fs.rm(tmps.pop()!, { recursive: true, force: true });
});

describe('runPush sentinel propagation (#343)', () => {
  it('auto-attaches sentinel content and commit timestamp for tracked change types', async () => {
    const dir = await mktmp('push-sentinel-');
    await fs.writeFile(join(dir, 'evidence.txt'), 'real evidence');
    await fs.writeFile(
      join(dir, '.sdlc-implementer-invoked'),
      JSON.stringify([{ currentPhase: '3', initializedBy: 'skill', status: 'active' }]),
      'utf8',
    );

    const uploadEvidence = vi.fn().mockResolvedValue([{ file: 'evidence.txt', ok: true, status: 201 }]);
    const probeBaseUrlDrift = vi.fn().mockResolvedValue(null);
    vi.doMock('../src/lib/ci-upload.js', () => ({
      collectFiles: vi.fn().mockResolvedValue([join(dir, 'evidence.txt')]),
      uploadEvidence,
      probeBaseUrlDrift,
    }));
    vi.doMock('execa', () => ({
      execa: vi.fn().mockResolvedValue({ stdout: '2026-07-13T10:11:12Z' }),
    }));

    const { runPush } = await import('../src/commands/push.js');
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await runPush({
        projectSlug: 'fixture-a',
        requirementId: 'REQ-091',
        evidenceType: 'test_report',
        filePath: join(dir, 'evidence.txt'),
        release: 'v2026.07.13',
        category: 'test_report',
        changeType: 'feat',
        baseUrl: 'https://devaudit.example.test',
        apiKey: 'mc_test_dummy',
      });
    } finally {
      process.chdir(cwd);
    }

    expect(uploadEvidence).toHaveBeenCalledTimes(1);
    expect(uploadEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        sentinelContent: '[{"currentPhase":"3","initializedBy":"skill","status":"active"}]',
        commitTimestamp: '2026-07-13T10:11:12Z',
        metadata: expect.objectContaining({
          commitTimestamp: '2026-07-13T10:11:12Z',
        }),
      }),
    );
  });
});
