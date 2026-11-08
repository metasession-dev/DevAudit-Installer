import { describe, it, expect, vi, afterEach } from 'vitest';
import { emitJsonResult, writeStdoutSync } from '../src/lib/logger.js';

// DevAudit-Installer#1234 — `--json` output must be complete when the command exits.
// `process.stdout.write` is asynchronous on a pipe and the commands end with `process.exit`, which cut a
// report larger than the 64 KiB pipe buffer off mid-string. The fix makes the stream's handle blocking
// before writing, so the write is synchronous; the data still goes through `process.stdout.write`.

type Stream = NodeJS.WriteStream & { _handle?: { setBlocking?: (blocking: boolean) => void } };
const stream = process.stdout as Stream;
const originalWrite = stream.write;
const originalHandle = Object.getOwnPropertyDescriptor(stream, '_handle');

afterEach(() => {
  stream.write = originalWrite;
  if (originalHandle) Object.defineProperty(stream, '_handle', originalHandle);
  else delete stream._handle;
});

function capture(): { chunks: string[]; order: string[] } {
  const chunks: string[] = [];
  const order: string[] = [];
  stream.write = ((chunk: string | Uint8Array): boolean => {
    order.push('write');
    chunks.push(String(chunk));
    return true;
  }) as typeof stream.write;
  return { chunks, order };
}

function fakeHandle(order: string[]): { calls: boolean[] } {
  const calls: boolean[] = [];
  Object.defineProperty(stream, '_handle', {
    configurable: true,
    value: {
      setBlocking: (blocking: boolean) => {
        order.push('setBlocking');
        calls.push(blocking);
      },
    },
  });
  return { calls };
}

describe('writeStdoutSync (#1234)', () => {
  it('makes the stdout handle blocking before it writes, so the write is complete when it returns', () => {
    const { chunks, order } = capture();
    const { calls } = fakeHandle(order);
    writeStdoutSync('hello\n');
    expect(calls).toEqual([true]);
    expect(order).toEqual(['setBlocking', 'write']);
    expect(chunks.join('')).toBe('hello\n');
  });

  it('writes through a stream that has no handle (a file, or a stream replaced by a test)', () => {
    const { chunks } = capture();
    delete stream._handle;
    expect(() => writeStdoutSync('plain')).not.toThrow();
    expect(chunks.join('')).toBe('plain');
  });

  it('writes through a handle that cannot be made blocking (no setBlocking)', () => {
    const { chunks } = capture();
    Object.defineProperty(stream, '_handle', { configurable: true, value: {} });
    expect(() => writeStdoutSync('plain')).not.toThrow();
    expect(chunks.join('')).toBe('plain');
  });
});

describe('emitJsonResult (#1234)', () => {
  it('writes the report as one parseable line, larger than the 64 KiB pipe buffer included', () => {
    const { chunks, order } = capture();
    fakeHandle(order);
    const payload = { ok: true, gaps: Array.from({ length: 600 }, (_, i) => ({ id: `g${i}`, why: 'a long explanation '.repeat(10) })) };
    emitJsonResult(payload);
    const out = chunks.join('');
    expect(out.length).toBeGreaterThan(65536);
    expect(out.endsWith('\n')).toBe(true);
    expect(JSON.parse(out)).toEqual(payload);
    expect(order[0]).toBe('setBlocking');
  });

  it('keeps multi-byte characters whole', () => {
    const { chunks } = capture();
    emitJsonResult({ text: 'a — b é' });
    expect(JSON.parse(chunks.join(''))).toEqual({ text: 'a — b é' });
  });
});
