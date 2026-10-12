import { describe, it, expect } from 'vitest';
import { addPredecessor, clearReleaseIntent, setReleaseIntent, setRtmStatus } from '../src/lib/ticket-edit.js';

const T = '# Release Ticket: REQ-1\n\n**Status:** X\n\n## Bundled Changes\n\n- **Absorbed predecessor releases:** None\n';

describe('setReleaseIntent', () => {
  it('inserts after the predecessors line, then is idempotent', () => {
    const a = setReleaseIntent(T, 'PR closed')!;
    expect(a).toContain('None\n- **Release intent:** deferred-to-next — PR closed\n');
    expect(setReleaseIntent(a, 'PR closed')).toBeNull();
  });
  it('replaces an existing intent line', () => {
    const a = setReleaseIntent(T, 'one')!;
    expect(setReleaseIntent(a, 'two')).toContain('— two');
    expect(setReleaseIntent(a, 'two')!.match(/Release intent/g)).toHaveLength(1);
  });
  it('falls back to the Bundled Changes heading, then to the end; keeps CRLF', () => {
    expect(setReleaseIntent('## Bundled Changes\nx\n', 'r')).toContain('## Bundled Changes\n\n- **Release intent:**');
    expect(setReleaseIntent('# t\n', 'r')).toBe('# t\n\n- **Release intent:** deferred-to-next — r\n');
    const crlf = setReleaseIntent(T.replace(/\n/g, '\r\n'), 'r')!;
    expect(crlf).not.toMatch(/[^\r]\n/);
  });
  it('omits the dash when the reason is empty', () => {
    expect(setReleaseIntent('# t\n', '  ')).toContain('deferred-to-next\n');
  });
});

describe('clearReleaseIntent', () => {
  it('removes the line and is idempotent', () => {
    const a = setReleaseIntent(T, 'r')!;
    const b = clearReleaseIntent(a)!;
    expect(b).toBe(T);
    expect(clearReleaseIntent(b)).toBeNull();
  });
});

describe('addPredecessor', () => {
  it('replaces None, appends, never duplicates, and does not confuse REQ-1 with REQ-10', () => {
    const a = addPredecessor(T, 'REQ-7')!;
    expect(a).toContain('releases:** REQ-7\n');
    expect(addPredecessor(a, 'REQ-7')).toBeNull();
    expect(addPredecessor(a, 'REQ-8')).toContain('REQ-7, REQ-8');
    expect(addPredecessor('- **Absorbed predecessor releases:** REQ-10\n', 'REQ-1')).toContain('REQ-10, REQ-1');
  });
  it('creates the line when absent', () => {
    expect(addPredecessor('## Bundled Changes\n', 'REQ-7')).toContain('- **Absorbed predecessor releases:** REQ-7');
  });
});

describe('setRtmStatus', () => {
  const RTM = '| Requirement | Description | Status |\n|---|---|---|\n| REQ-1 | a | TESTED - PENDING SIGN-OFF (note) |\n| REQ-10 | b | IN PROGRESS |\n';
  it('flips only the matching row, keeps notes, idempotent', () => {
    const a = setRtmStatus(RTM, 'REQ-1', 'DEFERRED')!;
    expect(a).toContain('| REQ-1 | a | DEFERRED (note) |');
    expect(a).toContain('| REQ-10 | b | IN PROGRESS |');
    expect(setRtmStatus(a, 'REQ-1', 'DEFERRED')).toBeNull();
  });
  it('respects onlyFrom and missing rows', () => {
    expect(setRtmStatus(RTM, 'REQ-10', 'TESTED', 'DEFERRED')).toBeNull();
    expect(setRtmStatus(RTM, 'REQ-99', 'DEFERRED')).toBeNull();
    const d = setRtmStatus(RTM, 'REQ-10', 'DEFERRED')!;
    expect(setRtmStatus(d, 'REQ-10', 'TESTED - PENDING SIGN-OFF', 'DEFERRED')).toContain('| REQ-10 | b | TESTED - PENDING SIGN-OFF |');
  });
});
