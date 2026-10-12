import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  canPrompt,
  select,
  confirm,
  input,
  isCiEnv,
  nonInteractiveReason,
  setPromptTestHooks,
  type PromptDriver,
} from '../src/lib/prompt.js';

const TTY = { stdinIsTty: true, stdoutIsTty: true, ci: false, json: false };
const CANCEL = Symbol('cancel');

function fakeDriver(c: boolean | symbol, t: string | symbol, sel: string | symbol = 'b'): PromptDriver & { calls: number } {
  const d = {
    calls: 0,
    confirm: async () => (d.calls++, c),
    text: async () => (d.calls++, t),
    select: async () => (d.calls++, sel),
    isCancel: (v: unknown) => v === CANCEL,
  };
  return d;
}

afterEach(() => setPromptTestHooks(null));

describe('isCiEnv', () => {
  it('treats unset, empty, 0 and false as not CI', () => {
    expect(isCiEnv({})).toBe(false);
    expect(isCiEnv({ CI: '' })).toBe(false);
    expect(isCiEnv({ CI: '0' })).toBe(false);
    expect(isCiEnv({ CI: 'false' })).toBe(false);
    expect(isCiEnv({ CI: 'true' })).toBe(true);
    expect(isCiEnv({ CI: '1' })).toBe(true);
  });
});

describe('prompt helper', () => {
  it('prompts on a TTY outside CI and json', async () => {
    const d = fakeDriver(true, '  because  ');
    setPromptTestHooks({ driver: d, env: TTY });
    expect(canPrompt(false)).toBe(true);
    expect(nonInteractiveReason(false)).toBeNull();
    expect(await confirm('Apply?')).toBe(true);
    expect(await input('Reason?')).toBe('because');
    expect(d.calls).toBe(2);
  });

  it('returns false when the operator declines', async () => {
    setPromptTestHooks({ driver: fakeDriver(false, ''), env: TTY });
    expect(await confirm('Apply?')).toBe(false);
  });

  it('returns null on cancel and on empty text', async () => {
    setPromptTestHooks({ driver: fakeDriver(CANCEL, CANCEL), env: TTY });
    expect(await confirm('Apply?')).toBeNull();
    expect(await input('Reason?')).toBeNull();
    setPromptTestHooks({ driver: fakeDriver(true, '   '), env: TTY });
    expect(await input('Reason?')).toBeNull();
  });

  it.each([
    ['--json', { ...TTY }, true, '--json never prompts'],
    ['CI', { ...TTY, ci: true }, false, 'CI is set'],
    ['no stdin TTY', { ...TTY, stdinIsTty: false }, false, 'no TTY'],
    ['no stdout TTY', { ...TTY, stdoutIsTty: false }, false, 'no TTY'],
  ])('never prompts with %s', async (_label, env, json, reason) => {
    const d = fakeDriver(true, 'x');
    setPromptTestHooks({ driver: d, env });
    expect(canPrompt(json)).toBe(false);
    expect(nonInteractiveReason(json)).toBe(reason);
    expect(await confirm('Apply?', { json })).toBeNull();
    expect(await input('Reason?', { json })).toBeNull();
    expect(d.calls).toBe(0);
  });

  it('select returns the chosen value, null on cancel and when non-interactive', async () => {
    const opts = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
    setPromptTestHooks({ driver: fakeDriver(true, 'x', 'a'), env: TTY });
    expect(await select('Pick', opts)).toBe('a');
    setPromptTestHooks({ driver: fakeDriver(true, 'x', CANCEL), env: TTY });
    expect(await select('Pick', opts)).toBeNull();
    const d = fakeDriver(true, 'x');
    setPromptTestHooks({ driver: d, env: { ...TTY, ci: true } });
    expect(await select('Pick', opts)).toBeNull();
    expect(d.calls).toBe(0);
  });

  it('refuses to ask for secrets', async () => {
    setPromptTestHooks({ driver: fakeDriver(true, 'x'), env: TTY });
    await expect(input('Paste your API key')).rejects.toThrow(/secrets/);
    await expect(confirm('Use this token?')).rejects.toThrow(/secrets/);
  });

  it('reads CI from the real environment when no hook is set', () => {
    vi.stubEnv('CI', 'true');
    expect(canPrompt(false)).toBe(false);
    expect(nonInteractiveReason(false)).toBe('CI is set');
    vi.unstubAllEnvs();
  });
});
