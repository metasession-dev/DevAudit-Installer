import type { Gap } from '../gap.js';
import type { DetectedFacts } from '../detect/index.js';
import { suggestPreset } from '../presets.js';
import type { ClauseDefinition, Expectation, FrameworkFile, FrameworkResult, ScanReport } from './types.js';

/** What to do about a clause, in one imperative sentence, from the kinds of evidence it expects. */
function guidanceFor(clause: ClauseDefinition): string {
  const parts: string[] = [];
  const walk = (exps: readonly Expectation[]): void => {
    for (const e of exps) {
      if (e.kind === 'evidence_filename_any') parts.push(`add and keep up to date ${e.fileNames.join(' or ')} (\`devaudit bootstrap-governance\` copies starters)`);
      else if (e.kind === 'evidence_type_any') parts.push(`set up a workflow that produces ${e.types.join(' or ')} evidence (\`devaudit install\` generates them)`);
      else if (e.kind === 'any_of') walk(e.expectations);
    }
  };
  walk(clause.expects);
  const unique = [...new Set(parts)];
  return unique.length > 0 ? `${unique[0]!.charAt(0).toUpperCase()}${unique[0]!.slice(1)}${unique.length > 1 ? `; also ${unique.slice(1).join('; ')}` : ''}.` : 'Look at what the clause expects and add that evidence.';
}

/** One gap per clause that is missing, partly evidenced or unknown. A clause only the portal can judge is not a gap. */
export function gapsFromResults(frameworks: readonly FrameworkFile[], results: readonly FrameworkResult[]): Gap[] {
  const gaps: Gap[] = [];
  for (const result of results) {
    const file = frameworks.find((f) => f.code === result.code);
    if (!file) continue;
    for (const clause of result.clauses) {
      if (clause.state === 'evidenced' || clause.state === 'needs_portal') continue;
      const def = file.clauses.find((c) => c.id === clause.id);
      gaps.push({
        id: `scan:${clause.id}`,
        source: 'scan',
        check: result.code,
        subject: clause.id,
        state: clause.state,
        title: def?.title ?? clause.id,
        why: clause.reason,
        controls: [clause.id],
        options: [
          {
            id: 'guidance',
            label: def ? guidanceFor(def) : 'Add the evidence the clause expects.',
            tier: 'C',
            consequence: 'Prints the steps; DevAudit changes nothing for you.',
          },
        ],
      });
    }
  }
  return gaps;
}

/** Assemble the report. `suggestedPreset` is the one rule install and doctor share, with the portal unknown (a scan makes no portal call). */
export function assembleReport(input: {
  readonly facts: DetectedFacts;
  readonly frameworks: readonly FrameworkFile[];
  readonly results: readonly FrameworkResult[];
}): ScanReport {
  const suggestion = suggestPreset({ testGroups: input.facts.testGroups }, input.results.map((r) => r.code), 'unknown');
  const registryVersion = input.frameworks.map((f) => f.registryVersion).sort().at(-1) ?? '';
  return {
    scanVersion: '1',
    registryVersion,
    facts: input.facts,
    frameworks: input.results.map((r) => ({ code: r.code, clauses: r.clauses })),
    suggestedPreset: suggestion.preset as ScanReport['suggestedPreset'],
    suggestionReason: suggestion.reason,
    gaps: gapsFromResults(input.frameworks, input.results),
  };
}

/** Counts per framework: evidenced of total. */
export function counts(report: ScanReport): Array<{ code: string; evidenced: number; total: number; missing: number }> {
  return report.frameworks.map((f) => ({
    code: f.code,
    evidenced: f.clauses.filter((c) => c.state === 'evidenced').length,
    total: f.clauses.length,
    missing: f.clauses.filter((c) => c.state === 'missing').length,
  }));
}

/** Clauses that are `missing` across the selected frameworks (for `--ci --max-missing`). */
export function missingCount(report: ScanReport): number {
  return counts(report).reduce((n, c) => n + c.missing, 0);
}
