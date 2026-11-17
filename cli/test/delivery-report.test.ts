import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../src/lib/logger.js';
import { runDeliveryReport, usageFromCostFile, type DeliveryReportDeps } from '../src/commands/delivery.js';

// DevAudit-Installer#1273 — `devaudit delivery report`: the event the portal receives, the cost file, and the exit codes.

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-delivery-report-'));
  dirs.push(dir);
  return dir;
}

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function portal(answers: Array<{ status: number; body?: string }> = [{ status: 200, body: '{}' }]) {
  const sent: Sent[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const a = answers[Math.min(i, answers.length - 1)]!;
    i += 1;
    return new Response(a.body ?? '', { status: a.status });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

async function deps(env: Record<string, string>, p = portal()): Promise<DeliveryReportDeps & { sent: Sent[] }> {
  return { env, fetchImpl: p.fetchImpl, stateDir: await tmp(), cwd: await tmp(), sleep: async () => undefined, sent: p.sent };
}

const ENV = { DEVAUDIT_AGENT_PORTAL_KEY: 'mc_agent', DEVAUDIT_BASE_URL: 'https://portal.example.test/' };

describe('the event', () => {
  it('posts the phase to the run on the portal with the agent key', async () => {
    const d = await deps(ENV);
    expect(await runDeliveryReport({ run: 'run_123', phase: 'running' }, d)).toBe(0);
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]!.url).toBe('https://portal.example.test/api/ci/delivery-runs/run_123/events');
    expect(d.sent[0]!.headers['authorization']).toBe('Bearer mc_agent');
    expect(d.sent[0]!.body).toEqual({ phase: 'running' });
  });

  it('sends the reason and the release id when given', async () => {
    const d = await deps(ENV);
    await runDeliveryReport({ run: 'r1', phase: 'failed', reason: 'spec too large', release: 'rel-9' }, d);
    expect(d.sent[0]!.body).toEqual({ phase: 'failed', reason: 'spec too large', releaseId: 'rel-9' });
  });

  it('falls back to DEVAUDIT_API_KEY, and prefers the agent key', async () => {
    const only = await deps({ DEVAUDIT_API_KEY: 'mc_project', DEVAUDIT_BASE_URL: 'https://p.test' });
    await runDeliveryReport({ run: 'r1', phase: 'running' }, only);
    expect(only.sent[0]!.headers['authorization']).toBe('Bearer mc_project');
    const both = await deps({ DEVAUDIT_API_KEY: 'mc_project', DEVAUDIT_AGENT_PORTAL_KEY: 'mc_agent', DEVAUDIT_BASE_URL: 'https://p.test' });
    await runDeliveryReport({ run: 'r1', phase: 'running' }, both);
    expect(both.sent[0]!.headers['authorization']).toBe('Bearer mc_agent');
  });

  it('reads the portal address from sdlc-config.json when the environment has none', async () => {
    const d = await deps({ DEVAUDIT_AGENT_PORTAL_KEY: 'k' });
    await fs.writeFile(join(d.cwd!, 'sdlc-config.json'), JSON.stringify({ devaudit: { base_url: 'https://configured.example.test' } }));
    await fs.mkdir(join(d.cwd!, '.git'));
    await runDeliveryReport({ run: 'r1', phase: 'running' }, d);
    expect(d.sent[0]!.url).toBe('https://configured.example.test/api/ci/delivery-runs/r1/events');
  });
});

describe('the cost file', () => {
  const claudeJson = JSON.stringify({ type: 'result', subtype: 'success', usage: { input_tokens: 100, output_tokens: 40, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 }, total_cost_usd: 0.5 });

  it('reads the token totals from the usage of the session output, and adds the CI seconds', async () => {
    const d = await deps(ENV);
    const file = join(await tmp(), 'out.json');
    await fs.writeFile(file, claudeJson);
    await runDeliveryReport({ run: 'r1', phase: 'awaiting_approval', costFile: file, ciSeconds: '754' }, d);
    expect(d.sent[0]!.body).toEqual({ phase: 'awaiting_approval', usage: { inputTokens: 115, outputTokens: 40, ciSeconds: 754 } });
  });

  it('tolerates a missing cost file: the event is sent without totals', async () => {
    const warn = vi.spyOn(logger(), 'warn');
    const d = await deps(ENV);
    expect(await runDeliveryReport({ run: 'r1', phase: 'failed', costFile: join(await tmp(), 'absent.json'), ciSeconds: '9' }, d)).toBe(0);
    expect(d.sent[0]!.body).toEqual({ phase: 'failed', usage: { ciSeconds: 9 } });
    expect(warn).toHaveBeenCalled();
  });

  it('tolerates a cost file that is not JSON or has no usage', async () => {
    const d = await deps(ENV);
    const file = join(await tmp(), 'bad.json');
    await fs.writeFile(file, 'not json');
    expect(await runDeliveryReport({ run: 'r1', phase: 'running', costFile: file }, d)).toBe(0);
    expect(d.sent[0]!.body).toEqual({ phase: 'running' });
    expect(usageFromCostFile('{"result":"x"}')).toEqual({});
  });

  it('reads the last entry with a usage from a list of messages', () => {
    const list = JSON.stringify([{ type: 'system' }, { type: 'result', usage: { input_tokens: 7, output_tokens: 3 } }]);
    expect(usageFromCostFile(list)).toEqual({ inputTokens: 7, outputTokens: 3 });
  });
});

describe('exit codes', () => {
  it('a portal refusal exits 1 and prints the body', async () => {
    const error = vi.spyOn(logger(), 'error');
    const d = await deps(ENV, portal([{ status: 409, body: '{"error":"run is not active"}' }]));
    expect(await runDeliveryReport({ run: 'r1', phase: 'running' }, d)).toBe(1);
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toContain('HTTP 409');
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toContain('run is not active');
    expect(d.sent).toHaveLength(1); // a 4xx is not retried
  });

  it('retries a 5xx and succeeds', async () => {
    const d = await deps(ENV, portal([{ status: 503 }, { status: 200, body: '{}' }]));
    expect(await runDeliveryReport({ run: 'r1', phase: 'running' }, d)).toBe(0);
    expect(d.sent).toHaveLength(2);
  });

  it('gives up after three 5xx and exits 1', async () => {
    const d = await deps(ENV, portal([{ status: 502, body: 'bad gateway' }]));
    expect(await runDeliveryReport({ run: 'r1', phase: 'running' }, d)).toBe(1);
    expect(d.sent).toHaveLength(3);
  });

  it('usage errors exit 2 and make no request', async () => {
    const d = await deps(ENV);
    expect(await runDeliveryReport({ phase: 'running' }, d)).toBe(2);
    expect(await runDeliveryReport({ run: 'a b', phase: 'running' }, d)).toBe(2);
    expect(await runDeliveryReport({ run: 'r1', phase: 'done' }, d)).toBe(2);
    expect(await runDeliveryReport({ run: 'r1' }, d)).toBe(2);
    expect(await runDeliveryReport({ run: 'r1', phase: 'running', ciSeconds: '-3' }, d)).toBe(2);
    expect(await runDeliveryReport({ run: 'r1', phase: 'running' }, { ...d, env: {} })).toBe(2);
    expect(d.sent).toEqual([]);
  });
});

describe('a failed run stays failed', () => {
  it('turns a later awaiting_approval into failed with the recorded reason, so the closing step cannot undo the skill', async () => {
    const d = await deps(ENV);
    await runDeliveryReport({ run: 'r1', phase: 'failed', reason: 'not a tracked change' }, d);
    await runDeliveryReport({ run: 'r1', phase: 'awaiting_approval', ciSeconds: '30' }, d);
    expect(d.sent[1]!.body).toEqual({ phase: 'failed', reason: 'not a tracked change', usage: { ciSeconds: 30 } });
  });

  it('keeps the recorded reason when the closing step reports failed with none', async () => {
    const d = await deps(ENV);
    await runDeliveryReport({ run: 'r1', phase: 'failed', reason: 'spec too large' }, d);
    await runDeliveryReport({ run: 'r1', phase: 'failed' }, d);
    expect(d.sent[1]!.body['reason']).toBe('spec too large');
  });

  it('does not carry a failure to another run', async () => {
    const d = await deps(ENV);
    await runDeliveryReport({ run: 'r1', phase: 'failed', reason: 'x' }, d);
    await runDeliveryReport({ run: 'r2', phase: 'awaiting_approval' }, d);
    expect(d.sent[1]!.body).toEqual({ phase: 'awaiting_approval' });
  });

  it('does not record a phase the portal refused', async () => {
    const d = await deps(ENV, portal([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 200, body: '{}' }]));
    await runDeliveryReport({ run: 'r1', phase: 'failed', reason: 'x' }, d);
    await runDeliveryReport({ run: 'r1', phase: 'awaiting_approval' }, d);
    expect(d.sent[3]!.body).toEqual({ phase: 'awaiting_approval' });
  });
});
