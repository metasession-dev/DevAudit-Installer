import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pendingSignoffIn, rtmRisk, stage3EvidenceCheck } from '../src/commands/doctor-stage3.js';
import { findConfigKey, validateConfigKeyValue } from '../src/lib/repo-config-keys.js';
import { CHECK_EXPLANATIONS, gapsFromCheck } from '../src/lib/doctor-explain.js';

// DevAudit-Installer#1215 — `devaudit doctor` stage3-evidence and the uat.human_pack key.

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const SIGNED = '## Operator sign-off\n- [x] a\n- [~] b\n\n**Reviewer:** Jane Doe <jane@example.com>\n**Date:** 2026-11-08\n';
const PENDING = '## Operator sign-off\n- [ ] a\n\n**Reviewer:** <operator-name>\n**Date:** <YYYY-MM-DD>\n';

async function repo(opts: { rtmRisk?: string; deferred?: boolean; evidence?: Record<string, string> }): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-stage3-'));
  dirs.push(dir);
  await fs.mkdir(join(dir, 'compliance', 'pending-releases'), { recursive: true });
  await fs.mkdir(join(dir, 'compliance', 'evidence', 'REQ-120'), { recursive: true });
  const intent = opts.deferred ? '- **Release intent:** deferred-to-next — parked\n' : '';
  await fs.writeFile(join(dir, 'compliance', 'pending-releases', 'RELEASE-TICKET-REQ-120.md'), `# Release Ticket: REQ-120\n\n${intent}`);
  const header = opts.rtmRisk === undefined ? '| ID | Description | Status |\n| --- | --- | --- |\n| REQ-120 | x | IN PROGRESS |\n' : `| ID | Description | Risk | Status |\n| --- | --- | --- | --- |\n| REQ-120 | x | ${opts.rtmRisk} | IN PROGRESS |\n`;
  await fs.writeFile(join(dir, 'compliance', 'RTM.md'), `# RTM\n\n${header}`);
  for (const [name, text] of Object.entries(opts.evidence ?? {})) {
    await fs.writeFile(join(dir, 'compliance', 'evidence', 'REQ-120', name), text);
  }
  return dir;
}

describe('stage3-evidence parsing (#1215)', () => {
  it('reads sign-off blocks with the rules of check-operator-signoffs.sh', () => {
    expect(pendingSignoffIn('a.md', SIGNED)).toBeNull();
    expect(pendingSignoffIn('a.md', '# no block\n- [ ] x\n')).toBeNull();
    expect(pendingSignoffIn('a.md', PENDING)).toEqual({ file: 'a.md', unticked: 1, reviewerMissing: true, dateMissing: true });
    expect(pendingSignoffIn('a.md', '## Operator sign-off\n  - [ ] indented\nReviewer: bob\n**Date**: 2026-11-08\n')).toEqual({ file: 'a.md', unticked: 1, reviewerMissing: false, dateMissing: false });
    expect(pendingSignoffIn('a.md', '## Operator sign-off\n- [x] a\n**Reviewer:** bob\n**Date:** 2026-11-08\n## Later\n- [ ] not in the block\n')).toBeNull();
  });

  it('reads the RTM Risk cell, and returns empty without a Risk column', () => {
    expect(rtmRisk('| ID | Risk |\n| --- | --- |\n| REQ-120 | HIGH |\n', 'REQ-120')).toBe('HIGH');
    expect(rtmRisk('| REQ-ID | Description | Risk |\n| --- | --- | --- |\n| REQ-121 | y | LOW |\n', 'REQ-121')).toBe('LOW');
    expect(rtmRisk('| ID | Status |\n| --- | --- |\n| REQ-120 | DONE |\n', 'REQ-120')).toBe('');
    expect(rtmRisk('| ID | Risk |\n| --- | --- |\n| REQ-120 | HIGH |\n', 'REQ-999')).toBe('');
  });
});

describe('stage3EvidenceCheck (#1215)', () => {
  it('is ok with no pending ticket', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-stage3-'));
    dirs.push(dir);
    const r = await stage3EvidenceCheck({ repoRoot: dir, cfg: {} });
    expect(r.ok).toBe(true);
  });

  it('reports a pending sign-off and a missing pack for a MEDIUM REQ', async () => {
    const dir = await repo({ rtmRisk: 'MEDIUM', evidence: { 'architecture-decision.md': PENDING } });
    const r = await stage3EvidenceCheck({ repoRoot: dir, cfg: {} });
    expect(r.ok).toBe(false);
    expect(r.findings?.map((f) => f.subject)).toEqual(['REQ-120: signoff-pending', 'REQ-120: uat-pack-missing']);
    expect(r.findings?.[0]?.detail).toContain('compliance/evidence/REQ-120/architecture-decision.md (1 unticked box(es), reviewer missing, date missing)');
    expect(r.findings?.[1]?.detail).toContain('uat-briefing.md, uat-test-procedure.md');
  });

  it('is ok for a LOW REQ with signed blocks, and for a MEDIUM REQ with the pack', async () => {
    const low = await repo({ rtmRisk: 'LOW', evidence: { 'risk-assessment.md': SIGNED } });
    expect((await stage3EvidenceCheck({ repoRoot: low, cfg: {} })).ok).toBe(true);
    const medium = await repo({ rtmRisk: 'MEDIUM', evidence: { 'uat-briefing.md': '# b', 'uat-test-procedure.md': '# p' } });
    expect((await stage3EvidenceCheck({ repoRoot: medium, cfg: {} })).ok).toBe(true);
  });

  it('honours uat.human_pack always and never', async () => {
    const low = await repo({ rtmRisk: 'LOW' });
    expect((await stage3EvidenceCheck({ repoRoot: low, cfg: { uat: { human_pack: 'always' } } })).findings?.map((f) => f.subject)).toEqual(['REQ-120: uat-pack-missing']);
    const high = await repo({ rtmRisk: 'HIGH' });
    expect((await stage3EvidenceCheck({ repoRoot: high, cfg: { uat: { human_pack: 'never' } } })).ok).toBe(true);
  });

  it('ignores a deferred ticket', async () => {
    const dir = await repo({ rtmRisk: 'HIGH', deferred: true, evidence: { 'architecture-decision.md': PENDING } });
    expect((await stage3EvidenceCheck({ repoRoot: dir, cfg: {} })).ok).toBe(true);
  });

  it('every finding carries guidance, never an automatic fix', async () => {
    const dir = await repo({ rtmRisk: 'HIGH', evidence: { 'srs-alignment.md': PENDING } });
    const r = await stage3EvidenceCheck({ repoRoot: dir, cfg: {} });
    for (const f of r.findings ?? []) expect(f.remediation?.tier).toBe('C');
  });
});

describe('stage3EvidenceCheck follow-ups (#1226, #1227)', () => {
  it('reports an invalid uat.human_pack with a tier A fix, and reads it as risk', async () => {
    const dir = await repo({ rtmRisk: 'HIGH' });
    const r = await stage3EvidenceCheck({ repoRoot: dir, cfg: { uat: { human_pack: 'Always' } } });
    const bad = r.findings?.find((f) => f.subject === 'uat.human_pack');
    expect(bad?.detail).toContain('"Always"');
    expect(bad?.remediation?.tier).toBe('A');
    expect(bad?.remediation?.plan).toEqual(['devaudit configure set uat.human_pack risk']);
    expect(r.findings?.map((f) => f.subject)).toContain('REQ-120: uat-pack-missing');
  });

  it('skips a stale pending copy of a released ticket (archived elsewhere, or RTM released)', async () => {
    const archived = await repo({ rtmRisk: 'HIGH', evidence: { 'srs-alignment.md': PENDING } });
    await fs.mkdir(join(archived, 'compliance', 'approved-releases'), { recursive: true });
    await fs.writeFile(join(archived, 'compliance', 'approved-releases', 'RELEASE-TICKET-REQ-120.md'), '# done\n');
    expect((await stage3EvidenceCheck({ repoRoot: archived, cfg: {} })).ok).toBe(true);

    const released = await repo({ rtmRisk: 'HIGH', evidence: { 'srs-alignment.md': PENDING } });
    const rtmPath = join(released, 'compliance', 'RTM.md');
    await fs.writeFile(rtmPath, (await fs.readFile(rtmPath, 'utf-8')).replace('IN PROGRESS', 'RELEASED'));
    expect((await stage3EvidenceCheck({ repoRoot: released, cfg: {} })).ok).toBe(true);
  });

  it('does not ask a co_tracked member of a live bundle for its own UAT pack, but still the core', async () => {
    const dir = await repo({ rtmRisk: 'MEDIUM' });
    // REQ-120 is a member of core REQ-119 (also pending, MEDIUM)
    const pending = join(dir, 'compliance', 'pending-releases');
    await fs.writeFile(join(pending, 'RELEASE-TICKET-REQ-119.md'), '# Release Ticket: REQ-119\n');
    await fs.writeFile(join(pending, 'BUNDLED-CHANGES-REQ-119.json'), JSON.stringify({ members: [{ version: 'REQ-120', role: 'co_tracked' }] }));
    const rtmPath = join(dir, 'compliance', 'RTM.md');
    await fs.writeFile(rtmPath, `${await fs.readFile(rtmPath, 'utf-8')}| REQ-119 | core | MEDIUM | IN PROGRESS |\n`);
    const subjects = (await stage3EvidenceCheck({ repoRoot: dir, cfg: {} })).findings?.map((f) => f.subject);
    expect(subjects).toContain('REQ-119: uat-pack-missing');
    expect(subjects).not.toContain('REQ-120: uat-pack-missing');
  });

  it('resolves the per-finding explanation for a REQ-prefixed subject', async () => {
    expect(CHECK_EXPLANATIONS['stage3-evidence']).toBeDefined();
    const dir = await repo({ rtmRisk: 'MEDIUM', evidence: { 'architecture-decision.md': PENDING } });
    const gaps = gapsFromCheck(await stage3EvidenceCheck({ repoRoot: dir, cfg: {} }));
    expect(gaps.length).toBe(2);
    expect(JSON.stringify(gaps)).toContain(CHECK_EXPLANATIONS['stage3-evidence:signoff-pending']!.title);
    expect(JSON.stringify(gaps)).toContain(CHECK_EXPLANATIONS['stage3-evidence:uat-pack-missing']!.title);
  });
});

describe('uat.human_pack config key (#1215)', () => {
  it('is settable with risk, always or never', () => {
    expect(findConfigKey('uat.human_pack')?.enum).toEqual(['risk', 'always', 'never']);
    expect(validateConfigKeyValue('uat.human_pack', 'never').error).toBeUndefined();
    expect(validateConfigKeyValue('uat.human_pack', 'sometimes').error).toBeDefined();
  });
});
