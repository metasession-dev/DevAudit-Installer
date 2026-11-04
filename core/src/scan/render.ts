import type { ClauseState } from '../gap.js';
import { counts } from './report.js';
import type { ScanReport } from './types.js';

/**
 * Renderings of a scan report (DevAudit-Installer#1116 section 6): terminal text, HTML, SARIF and an SVG
 * badge. Everything derived from the repository (paths, reasons) is escaped for its format, and nothing
 * here says "compliant", "certified" or "pass", or shows a percentage: a scan says what a repository is set
 * up to evidence.
 */

const STATE_WORD: Record<ClauseState, string> = {
  evidenced: 'evidenced',
  partly: 'partly evidenced',
  missing: 'missing',
  unknown: 'unknown',
  needs_portal: 'needs the portal',
};

/** Remove control characters (other than tab and newline) that could break a terminal or a document. */
const clean = (s: string): string => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

export function escapeHtml(s: string): string {
  return clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderText(report: ScanReport): string {
  const lines: string[] = [];
  lines.push('DevAudit scan: what this repository is set up to evidence');
  lines.push('');
  const f = report.facts;
  lines.push(`Stack: ${f.stack ?? 'not found'}; tests: ${f.testRunner ?? 'none found'} (smoke ${f.testGroups.smoke ? 'yes' : 'no'}, critical ${f.testGroups.critical ? 'yes' : 'no'}, full ${f.testGroups.full ? 'yes' : 'no'}); host: ${f.host ?? 'not found'}`);
  lines.push('');
  if (report.frameworks.length === 0) lines.push('No standards were selected, so no clauses were evaluated. Use --framework soc-2,iso-27001 (or set compliance_frameworks).');
  for (const fw of report.frameworks) {
    const c = counts(report).find((x) => x.code === fw.code)!;
    lines.push(`${fw.code}: ${c.evidenced} of ${c.total} clauses evidenced`);
    for (const clause of fw.clauses) {
      lines.push(`  ${clause.state === 'evidenced' ? '✓' : clause.state === 'needs_portal' ? '·' : '✗'} ${clause.id} — ${STATE_WORD[clause.state]}${clause.state === 'evidenced' ? '' : `: ${clean(clause.reason)}`}`);
    }
    lines.push('');
  }
  lines.push(`Suggested preset: ${report.suggestedPreset}. ${clean(report.suggestionReason)}`);
  if (report.gaps.length > 0) {
    lines.push('', 'To close the gaps:');
    for (const g of report.gaps) lines.push(`  - ${g.subject}: ${clean(g.options[0]?.label ?? '')}`);
  }
  lines.push('', 'Clauses marked "needs the portal" can only be judged from the release records. A scan is a readiness report, not an assessment of compliance.');
  return lines.join('\n');
}

export function renderHtml(report: ScanReport): string {
  const rows = report.frameworks
    .map((fw) => {
      const c = counts(report).find((x) => x.code === fw.code)!;
      const body = fw.clauses
        .map((cl) => `<tr><td>${escapeHtml(cl.id)}</td><td>${escapeHtml(STATE_WORD[cl.state])}</td><td>${escapeHtml(cl.reason)}</td><td>${escapeHtml(cl.paths.join(', '))}</td></tr>`)
        .join('\n');
      return `<h2>${escapeHtml(fw.code)}: ${c.evidenced} of ${c.total} clauses evidenced</h2>\n<table><thead><tr><th>Clause</th><th>State</th><th>Why</th><th>Where</th></tr></thead><tbody>\n${body}\n</tbody></table>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DevAudit scan</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:60rem;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:.35rem .5rem;text-align:left;vertical-align:top}</style></head>
<body><h1>DevAudit scan</h1><p>What this repository is set up to evidence. A readiness report, not an assessment of compliance.</p>
${rows || '<p>No standards were selected, so no clauses were evaluated.</p>'}
<h2>Suggested preset</h2><p>${escapeHtml(report.suggestedPreset)}. ${escapeHtml(report.suggestionReason)}</p>
</body></html>
`;
}

const SARIF_LEVEL: Record<ClauseState, 'warning' | 'note' | 'none' | undefined> = {
  evidenced: undefined,
  missing: 'warning',
  partly: 'note',
  unknown: 'note',
  needs_portal: 'none',
};

/** SARIF 2.1.0: one result per clause that is not evidenced. */
export function renderSarif(report: ScanReport): string {
  const results = report.frameworks.flatMap((fw) =>
    fw.clauses.flatMap((cl) => {
      const level = SARIF_LEVEL[cl.state];
      if (level === undefined) return [];
      return [
        {
          ruleId: cl.id,
          level,
          message: { text: clean(cl.reason) },
          ...(cl.paths.length > 0 ? { locations: [{ physicalLocation: { artifactLocation: { uri: clean(cl.paths[0]!) } } }] } : {}),
        },
      ];
    }),
  );
  const ruleIds = [...new Set(results.map((r) => r.ruleId))];
  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'devaudit scan', informationUri: 'https://devaudit.ai/', rules: ruleIds.map((id) => ({ id })) } }, results }],
    },
    null,
    2,
  );
}

/** An SVG badge: one line per selected framework, in one neutral colour. */
export function renderBadge(report: ScanReport): string {
  const lines = counts(report).map((c) => `evidence readiness · ${c.code} · ${c.evidenced} of ${c.total}`);
  if (lines.length === 0) lines.push('evidence readiness · no standard selected');
  const width = Math.max(...lines.map((l) => l.length)) * 6.4 + 24;
  const height = lines.length * 20 + 8;
  const text = lines.map((l, i) => `<text x="12" y="${20 + i * 20}" fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">${escapeHtml(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${height}" role="img" aria-label="${escapeHtml(lines.join('; '))}"><rect width="${Math.ceil(width)}" height="${height}" rx="4" fill="#555"/>${text}</svg>\n`;
}
