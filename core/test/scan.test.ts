import { describe, it, expect } from 'vitest';
import {
  assembleReport,
  clauseState,
  escapeHtml,
  evaluateClause,
  evaluateExpectation,
  evaluateFramework,
  findFiles,
  missingCount,
  renderBadge,
  renderHtml,
  renderSarif,
  renderText,
  type ClauseState,
  type Expectation,
  type FrameworkFile,
  type ScanContext,
  type ScanReport,
} from '../src/index.js';
import { memoryReader } from './memory-reader.js';

// DevAudit-Installer#1116 WP10 — the local clause evaluation, the report and its renderings.

const NOW = new Date('2026-10-30T00:00:00Z');
function ctx(files: Record<string, string>, extra: Partial<ScanContext> = {}): ScanContext {
  return { reader: memoryReader(files), uploadedTypes: new Map(), now: NOW, ...extra };
}
const file = (names: string[], freshnessDays?: number): Expectation => ({ kind: 'evidence_filename_any', fileNames: names, ...(freshnessDays ? { freshnessDays } : {}), description: 'd' });
const type = (types: string[]): Expectation => ({ kind: 'evidence_type_any', types, description: 'd' });

describe('findFiles', () => {
  it('finds a file anywhere and skips dependencies, build output and .git', async () => {
    const reader = memoryReader({ 'docs/Test_Policy.md': 'x', 'node_modules/a/Test_Policy.md': 'x', 'dist/Test_Policy.md': 'x', '.git/Test_Policy.md': 'x', 'a/b/c/Test_Policy.md': 'x' });
    expect(await findFiles(reader, ['Test_Policy.md'])).toEqual(['a/b/c/Test_Policy.md', 'docs/Test_Policy.md']);
  });
});

describe('evidence_filename_any', () => {
  it('evidenced when the file exists and differs from the starter', async () => {
    const r = await evaluateExpectation(file(['Test_Policy.md']), ctx({ 'docs/Test_Policy.md': 'our policy' }, { starterTemplates: async () => ['starter text'] }));
    expect(r).toMatchObject({ state: 'evidenced', paths: ['docs/Test_Policy.md'] });
  });

  it('partly when only the unmodified starter exists', async () => {
    const r = await evaluateExpectation(file(['Test_Policy.md']), ctx({ 'Test_Policy.md': 'starter text' }, { starterTemplates: async () => ['starter text'] }));
    expect(r.state).toBe('partly');
    expect(r.reason).toContain('unmodified starter');
  });

  it('partly when the last commit is older than freshnessDays, evidenced when it is recent', async () => {
    const reader = (date: Date) => ({ ...memoryReader({ 'AGENT.md': 'ours' }), lastCommitDate: async () => date });
    const old = await evaluateExpectation(file(['AGENT.md'], 365), { reader: reader(new Date('2024-01-01')), uploadedTypes: new Map(), now: NOW });
    expect(old.state).toBe('partly');
    expect(old.reason).toContain('365 days');
    const fresh = await evaluateExpectation(file(['AGENT.md'], 365), { reader: reader(new Date('2026-09-01')), uploadedTypes: new Map(), now: NOW });
    expect(fresh.state).toBe('evidenced');
    // no git: freshness cannot be judged, the file counts
    const noGit = await evaluateExpectation(file(['AGENT.md'], 365), ctx({ 'AGENT.md': 'ours' }));
    expect(noGit.state).toBe('evidenced');
  });

  it('missing when no file has one of the names', async () => {
    expect((await evaluateExpectation(file(['ropa.md']), ctx({ 'README.md': 'x' }))).state).toBe('missing');
  });
});

describe('evidence_type_any, categories and the other kinds', () => {
  it('"set up to produce": evidenced when a workflow uploads a listed type', async () => {
    const c = ctx({}, { uploadedTypes: new Map([['sast_report', ['.github/workflows/ci.yml']]]) });
    const r = await evaluateExpectation(type(['sast_report', 'dependency_audit']), c);
    expect(r).toMatchObject({ state: 'evidenced', paths: ['.github/workflows/ci.yml'] });
    expect(r.reason).toContain('set up to produce');
    expect((await evaluateExpectation(type(['ropa']), c)).state).toBe('missing');
  });

  it('evidence_category_any maps types to categories', async () => {
    const c = ctx({}, { uploadedTypes: new Map([['sast_report', ['w.yml']]]), categoryOf: (t) => (t === 'sast_report' ? 'security_scan' : undefined) });
    expect((await evaluateExpectation({ kind: 'evidence_category_any', categories: ['security_scan'], description: 'd' }, c)).state).toBe('evidenced');
    expect((await evaluateExpectation({ kind: 'evidence_category_any', categories: ['planning'], description: 'd' }, c)).state).toBe('missing');
  });

  it('requirement_any: evidenced, missing, or unknown without an SRS or RTM', async () => {
    const e: Expectation = { kind: 'requirement_any', ids: ['REQ-001'], description: 'd' };
    expect((await evaluateExpectation(e, ctx({ 'docs/SRS.md': 'REQ-001 login' }))).state).toBe('evidenced');
    expect((await evaluateExpectation(e, ctx({ 'docs/SRS.md': 'REQ-002' }))).state).toBe('missing');
    expect((await evaluateExpectation(e, ctx({}))).state).toBe('unknown');
  });

  it('portal-only kinds are needs_portal', async () => {
    for (const e of [
      { kind: 'requirement_meta', riskClass: 'HIGH', description: 'd' },
      { kind: 'portal_invariant', description: 'd' },
      { kind: 'audit_event_any', eventTypes: ['release.approved'], description: 'd' },
      { kind: 'manual_attestation', description: 'd' },
    ] as Expectation[]) {
      expect((await evaluateExpectation(e, ctx({}))).state, e.kind).toBe('needs_portal');
    }
  });

  it('any_of takes the best child (evidenced > partly > unknown > missing > needs_portal)', async () => {
    const c = ctx({ 'AGENT.md': 'ours' }, { uploadedTypes: new Map() });
    const e: Expectation = { kind: 'any_of', description: 'd', expectations: [type(['ropa']), file(['AGENT.md'])] };
    expect((await evaluateExpectation(e, c)).state).toBe('evidenced');
    const none: Expectation = { kind: 'any_of', description: 'd', expectations: [type(['ropa']), { kind: 'portal_invariant', description: 'd' }] };
    expect((await evaluateExpectation(none, ctx({}))).state).toBe('missing');
  });
});

describe('clauseState (section 6)', () => {
  const cases: Array<[ClauseState[], ClauseState]> = [
    [['needs_portal', 'needs_portal'], 'needs_portal'],
    [['evidenced', 'evidenced'], 'evidenced'],
    [['evidenced', 'needs_portal'], 'evidenced'],
    [['missing', 'missing'], 'missing'],
    [['missing', 'needs_portal'], 'missing'],
    [['unknown', 'missing'], 'unknown'],
    [['evidenced', 'missing'], 'partly'],
    [['partly', 'evidenced'], 'partly'],
    [['evidenced', 'unknown'], 'partly'],
  ];
  it.each(cases)('%j gives %s', (states, expected) => {
    expect(clauseState(states)).toBe(expected);
  });
});

const FRAMEWORK: FrameworkFile = {
  registryVersion: '2026-10-30',
  code: 'soc-2',
  name: 'SOC 2',
  longName: 'SOC 2',
  edition: 'AICPA TSC 2017',
  clauses: [
    { id: 'SOC2.CC2.1', title: 'Communication', expects: [file(['AGENT.md'])] },
    { id: 'SOC2.CC4.1', title: 'Monitoring', expects: [type(['periodic_review'])] },
    { id: 'SOC2.CC8.1', title: 'Change management', expects: [{ kind: 'audit_event_any', eventTypes: ['release.independently_approved'], description: 'd' }] },
  ],
};
const FACTS = {
  stack: 'node' as const,
  workingDirectory: '.',
  host: null,
  testRunner: null,
  testGroups: { smoke: false, critical: false, full: false },
  branches: { integration: 'develop', release: 'main' },
  runner: null,
  governanceFiles: [],
  testData: { seedScripts: [], dependentProjects: [] },
};

async function report(files: Record<string, string>): Promise<ScanReport> {
  const c = ctx(files);
  return assembleReport({ facts: FACTS, frameworks: [FRAMEWORK], results: [await evaluateFramework(FRAMEWORK, c)] });
}

describe('the report', () => {
  it('has the shape of the schema: version, registryVersion, a suggestion that is never D, gaps for what is not evidenced', async () => {
    const r = await report({ 'AGENT.md': 'ours' });
    expect(r.scanVersion).toBe('1');
    expect(r.registryVersion).toBe('2026-10-30');
    expect(['A', 'B', 'C', 'custom']).toContain(r.suggestedPreset);
    expect(r.frameworks[0]!.clauses.map((c) => `${c.id}:${c.state}`)).toEqual(['SOC2.CC2.1:evidenced', 'SOC2.CC4.1:missing', 'SOC2.CC8.1:needs_portal']);
    // a gap for the missing clause only: needs_portal is the portal's to judge
    expect(r.gaps.map((g) => g.id)).toEqual(['scan:SOC2.CC4.1']);
    expect(r.gaps[0]!).toMatchObject({ source: 'scan', check: 'soc-2', controls: ['SOC2.CC4.1'], state: 'missing' });
    expect(r.gaps[0]!.options[0]!.tier).toBe('C');
    expect(missingCount(r)).toBe(1);
  });

  it('evaluating a clause on its own gives the same answer', async () => {
    const clause = await evaluateClause(FRAMEWORK.clauses[0]!, ctx({ 'AGENT.md': 'ours' }));
    expect(clause).toMatchObject({ id: 'SOC2.CC2.1', state: 'evidenced' });
  });
});

describe('renderings', () => {
  const FORBIDDEN = /compliant|certified|pass|%/i;

  it('the badge text is exact, one line per framework, neutral, with no forbidden word', async () => {
    const r = await report({ 'AGENT.md': 'ours' });
    const svg = renderBadge(r);
    expect(svg).toContain('evidence readiness · soc-2 · 1 of 3');
    expect(svg.match(/<rect /g)).toHaveLength(1);
    expect(svg).not.toMatch(FORBIDDEN);
    expect(renderBadge(await report({}))).toContain('evidence readiness · soc-2 · 0 of 3');
  });

  it('SARIF: one result per clause that is not evidenced, level per state, no forbidden word', async () => {
    const r = await report({});
    const sarif = JSON.parse(renderSarif(r)) as { version: string; runs: Array<{ results: Array<{ ruleId: string; level: string; message: { text: string } }> }> };
    expect(sarif.version).toBe('2.1.0');
    const byRule = Object.fromEntries(sarif.runs[0]!.results.map((x) => [x.ruleId, x.level]));
    expect(byRule).toEqual({ 'SOC2.CC2.1': 'warning', 'SOC2.CC4.1': 'warning', 'SOC2.CC8.1': 'none' });
    expect(renderSarif(r)).not.toMatch(FORBIDDEN);
    // partly and unknown are notes
    const partly: ScanReport = { ...r, frameworks: [{ code: 'soc-2', clauses: [{ id: 'X.1', state: 'partly', reason: 'r', paths: [] }, { id: 'X.2', state: 'unknown', reason: 'r', paths: [] }, { id: 'X.3', state: 'evidenced', reason: 'r', paths: [] }] }] };
    const levels = (JSON.parse(renderSarif(partly)) as { runs: Array<{ results: Array<{ level: string }> }> }).runs[0]!.results.map((x) => x.level);
    expect(levels).toEqual(['note', 'note']);
  });

  it('HTML and SARIF escape text derived from the repository', async () => {
    const r = await report({});
    const evil: ScanReport = {
      ...r,
      suggestionReason: '<script>alert(1)</script>',
      frameworks: [{ code: 'soc-2', clauses: [{ id: 'SOC2.CC4.1', state: 'missing', reason: '<img src=x onerror=alert(1)> "quoted" & more\u0007', paths: ['docs/<b>x</b>.md'] }] }],
    };
    const html = renderHtml(evil);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>x');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&amp; more');
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    const sarif = renderSarif(evil);
    expect(sarif).not.toContain('\u0007');
    expect(() => JSON.parse(sarif)).not.toThrow();
    expect(renderText(evil)).not.toContain('\u0007');
  });

  it('the text report says it is a readiness report', async () => {
    const text = renderText(await report({}));
    expect(text).toContain('soc-2: 0 of 3 clauses evidenced');
    expect(text).toContain('readiness report, not an assessment of compliance');
    expect(text).toContain('Suggested preset');
  });
});
