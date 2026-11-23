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
    await runDeliveryReport({ run: 'r1', phase: 'awaiting_approval', release: 'rel-1', costFile: file, ciSeconds: '754' }, d);
    expect(d.sent[0]!.body).toEqual({ phase: 'awaiting_approval', releaseId: 'rel-1', usage: { inputTokens: 115, outputTokens: 40, ciSeconds: 754 } });
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
    await runDeliveryReport({ run: 'r2', phase: 'awaiting_approval', release: 'rel-2' }, d);
    expect(d.sent[1]!.body).toEqual({ phase: 'awaiting_approval', releaseId: 'rel-2' });
  });

  it('does not record a phase the portal refused', async () => {
    const d = await deps(ENV, portal([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 200, body: '{}' }]));
    await runDeliveryReport({ run: 'r1', phase: 'failed', reason: 'x' }, d);
    await runDeliveryReport({ run: 'r1', phase: 'awaiting_approval', release: 'rel-3' }, d);
    expect(d.sent[3]!.body).toEqual({ phase: 'awaiting_approval', releaseId: 'rel-3' });
  });
});

// DevAudit-Installer#1291 — the release id, and the CI seconds of the whole job.
describe('the release id', () => {
  const found = (id: string | null): DeliveryReportDeps['lookupRelease'] => async () =>
    id === null ? { kind: 'not-found' } : { kind: 'found', release: { status: 'draft', id, version: 'REQ-121', deferredAt: null, deferredReason: null, deferredUntil: null, deferredToVersion: null } };

  async function withConfig(env: Record<string, string>, extra: Partial<DeliveryReportDeps> = {}) {
    const d = await deps(env);
    await fs.mkdir(join(d.cwd!, '.git'));
    await fs.writeFile(join(d.cwd!, 'sdlc-config.json'), JSON.stringify({ devaudit: { project_slug: 'example-app', base_url: 'https://portal.example.test' } }));
    return Object.assign(d, extra);
  }

  it('--release-for resolves the release with the agent key and sends its id', async () => {
    const seen: Array<{ projectSlug: string; apiKey: string; prefix: string }> = [];
    const d = await withConfig({ DEVAUDIT_AGENT_PORTAL_KEY: 'mc_agent' }, {
      lookupRelease: async (ctx, prefix) => ((seen.push({ projectSlug: ctx.projectSlug, apiKey: ctx.apiKey, prefix })), found('rel-uuid-1')!(ctx, prefix)),
    });
    expect(await runDeliveryReport({ run: 'r1', phase: 'running', releaseFor: 'REQ-121' }, d)).toBe(0);
    expect(seen).toEqual([{ projectSlug: 'example-app', apiKey: 'mc_agent', prefix: 'REQ-121' }]);
    expect(d.sent[0]!.body).toEqual({ phase: 'running', releaseId: 'rel-uuid-1' });
  });

  it('waits for CI to register the release: asks every 15 seconds until it appears', async () => {
    const sleeps: number[] = [];
    let asked = 0;
    const d = await withConfig(ENV, {
      sleep: async (ms) => void sleeps.push(ms),
      lookupRelease: async (ctx, prefix) => ((asked += 1), found(asked >= 3 ? 'rel-late' : null)!(ctx, prefix)),
    });
    expect(await runDeliveryReport({ run: 'r1', phase: 'running', releaseFor: 'REQ-121' }, d)).toBe(0);
    expect(asked).toBe(3);
    expect(sleeps).toEqual([15000, 15000]);
    expect(d.sent[0]!.body['releaseId']).toBe('rel-late');
  });

  it('a release that never appears is a warning for running: the event is sent without an id, and the wait is bounded', async () => {
    const warn = vi.spyOn(logger(), 'warn');
    const sleeps: number[] = [];
    let asked = 0;
    const d = await withConfig(ENV, { sleep: async (ms) => void sleeps.push(ms), lookupRelease: async (ctx, prefix) => ((asked += 1), found(null)!(ctx, prefix)) });
    expect(await runDeliveryReport({ run: 'r1', phase: 'running', releaseFor: 'REQ-121', releaseWait: '30' }, d)).toBe(0);
    expect(asked).toBe(3); // at 0, 15 and 30 seconds
    expect(sleeps).toEqual([15000, 15000]);
    expect(d.sent[0]!.body).toEqual({ phase: 'running' });
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('no release for REQ-121 yet');
  });

  it('--release-wait 0 asks once', async () => {
    let asked = 0;
    const d = await withConfig(ENV, { lookupRelease: async (ctx, prefix) => ((asked += 1), found(null)!(ctx, prefix)) });
    await runDeliveryReport({ run: 'r1', phase: 'running', releaseFor: 'REQ-121', releaseWait: '0' }, d);
    expect(asked).toBe(1);
  });

  it('an unreachable portal is retried like a missing release and named in the warning', async () => {
    const warn = vi.spyOn(logger(), 'warn');
    const d = await withConfig(ENV, { lookupRelease: async () => ({ kind: 'unavailable', reason: 'portal returned 503' }) });
    await runDeliveryReport({ run: 'r1', phase: 'running', releaseFor: 'REQ-121', releaseWait: '0' }, d);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('portal returned 503');
  });

  it('records the id and reuses it for a later event that names none', async () => {
    const d = await withConfig(ENV, { lookupRelease: found('rel-rec') });
    await runDeliveryReport({ run: 'r1', phase: 'running', releaseFor: 'REQ-121' }, d);
    expect(await runDeliveryReport({ run: 'r1', phase: 'awaiting_approval' }, d)).toBe(0);
    expect(d.sent[1]!.body).toEqual({ phase: 'awaiting_approval', releaseId: 'rel-rec' });
  });

  it('an explicit --release wins over the recorded one, and over a lookup', async () => {
    const d = await withConfig(ENV, { lookupRelease: found('rel-looked-up') });
    await runDeliveryReport({ run: 'r1', phase: 'running', releaseFor: 'REQ-121' }, d);
    await runDeliveryReport({ run: 'r1', phase: 'running', release: 'rel-explicit' }, d);
    expect(d.sent[1]!.body['releaseId']).toBe('rel-explicit');
  });

  it('does not carry the release of one run to another', async () => {
    const d = await withConfig(ENV, { lookupRelease: found('rel-a') });
    await runDeliveryReport({ run: 'r1', phase: 'running', releaseFor: 'REQ-121' }, d);
    expect(await runDeliveryReport({ run: 'r2', phase: 'awaiting_approval' }, d)).toBe(1);
  });

  it('refuses awaiting_approval without any release id: exit 1 and nothing sent', async () => {
    const error = vi.spyOn(logger(), 'error');
    const d = await withConfig(ENV, { lookupRelease: found(null) });
    expect(await runDeliveryReport({ run: 'r1', phase: 'awaiting_approval', releaseFor: 'REQ-121', releaseWait: '0' }, d)).toBe(1);
    expect(d.sent).toEqual([]);
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toContain('would wait forever');
  });

  it('a failed event needs no release id, and a run that already failed is not refused', async () => {
    const d = await withConfig(ENV);
    expect(await runDeliveryReport({ run: 'r1', phase: 'failed', reason: 'spec too large' }, d)).toBe(0);
    expect(await runDeliveryReport({ run: 'r1', phase: 'awaiting_approval' }, d)).toBe(0);
    expect(d.sent[1]!.body['phase']).toBe('failed');
  });

  it('a succeeded event is sent with a warning that the portal ignores it', async () => {
    const warn = vi.spyOn(logger(), 'warn');
    const d = await deps(ENV);
    expect(await runDeliveryReport({ run: 'r1', phase: 'succeeded' }, d)).toBe(0);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('ignores a succeeded event');
  });

  it('--release together with --release-for, or a bad --release-wait, is a usage error', async () => {
    const d = await deps(ENV);
    expect(await runDeliveryReport({ run: 'r1', phase: 'running', release: 'a', releaseFor: 'REQ-1' }, d)).toBe(2);
    expect(await runDeliveryReport({ run: 'r1', phase: 'running', releaseFor: 'REQ-1', releaseWait: '-1' }, d)).toBe(2);
    expect(await runDeliveryReport({ run: 'r1', phase: 'running', releaseFor: 'REQ-1', releaseWait: 'soon' }, d)).toBe(2);
    expect(d.sent).toEqual([]);
  });

  it('no project slug in sdlc-config.json: a warning, and the event is sent without an id', async () => {
    const warn = vi.spyOn(logger(), 'warn');
    const d = await deps(ENV);
    expect(await runDeliveryReport({ run: 'r1', phase: 'running', releaseFor: 'REQ-121' }, d)).toBe(0);
    expect(d.sent[0]!.body).toEqual({ phase: 'running' });
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('devaudit.project_slug');
  });
});

describe('the CI seconds of the whole job', () => {
  const T0 = 1_800_000_000; // epoch seconds of the job start
  const at = (secondsAfter: number) => () => (T0 + secondsAfter) * 1000;

  it('is the time since DEVAUDIT_JOB_STARTED, on every event, as a cumulative total', async () => {
    const d = await deps({ ...ENV, DEVAUDIT_JOB_STARTED: String(T0) });
    await runDeliveryReport({ run: 'r1', phase: 'running' }, { ...d, now: at(40) });
    await runDeliveryReport({ run: 'r1', phase: 'running', release: 'rel-1' }, { ...d, now: at(900) });
    await runDeliveryReport({ run: 'r1', phase: 'awaiting_approval' }, { ...d, now: at(1500) });
    expect(d.sent.map((s) => (s.body['usage'] as { ciSeconds: number }).ciSeconds)).toEqual([40, 900, 1500]);
  });

  it('--ci-seconds wins over the job start', async () => {
    const d = await deps({ ...ENV, DEVAUDIT_JOB_STARTED: String(T0) });
    await runDeliveryReport({ run: 'r1', phase: 'running', ciSeconds: '7' }, { ...d, now: at(500) });
    expect(d.sent[0]!.body['usage']).toEqual({ ciSeconds: 7 });
  });

  it('is absent when neither is set, or the start is not a time', async () => {
    const d = await deps(ENV);
    await runDeliveryReport({ run: 'r1', phase: 'running' }, d);
    expect(d.sent[0]!.body).toEqual({ phase: 'running' });
    const bad = await deps({ ...ENV, DEVAUDIT_JOB_STARTED: 'yesterday' });
    await runDeliveryReport({ run: 'r1', phase: 'running' }, bad);
    expect(bad.sent[0]!.body).toEqual({ phase: 'running' });
  });

  it('is never negative when the clock is behind the recorded start', async () => {
    const d = await deps({ ...ENV, DEVAUDIT_JOB_STARTED: String(T0) });
    await runDeliveryReport({ run: 'r1', phase: 'running' }, { ...d, now: at(-30) });
    expect((d.sent[0]!.body['usage'] as { ciSeconds: number }).ciSeconds).toBe(0);
  });

  it('adds the token totals of the cost file to it', async () => {
    const d = await deps({ ...ENV, DEVAUDIT_JOB_STARTED: String(T0) });
    const file = join(await tmp(), 'out.json');
    await fs.writeFile(file, JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }));
    await runDeliveryReport({ run: 'r1', phase: 'failed', costFile: file }, { ...d, now: at(60) });
    expect(d.sent[0]!.body['usage']).toEqual({ inputTokens: 10, outputTokens: 5, ciSeconds: 60 });
  });
});
