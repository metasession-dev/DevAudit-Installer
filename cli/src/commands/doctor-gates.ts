import type { Remediation } from '@metasession.co/devaudit-core';
import type { CheckResult, Finding } from '../lib/doctor-types.js';
import { pathsIgnoreCovers } from '../update/ci-templates.js';

/**
 * DevAudit-Installer#1297 — `pull-request-gates`: what a pull request into the integration branch costs. Two
 * informational findings, never a failure:
 *
 *  - `docs-only-skip-off`: `paths_ignore_pull_request` is not true, so every pull request, including one that changes
 *    only evidence and docs, runs the full Quality Gates. A project onboarded before the key existed is in this state
 *    until it opts in; `devaudit update` never changes it.
 *  - `docs-not-ignored`: `paths_ignore` leaves a documentation path out (the default list for a new project covers
 *    docs/, .devaudit/, the issue templates and markdown at any depth, the paths the attribution classifier treats as
 *    documentation), so a change to it runs CI on push and, with the key on, on pull requests.
 *
 * Static, no portal call.
 */

/** A sample file under each documentation location a new project's default `paths_ignore` covers. */
export const DOC_PATH_SAMPLES: ReadonlyArray<{ readonly pattern: string; readonly sample: string }> = [
  { pattern: 'SDLC/**', sample: 'SDLC/1-plan-requirement.md' },
  { pattern: 'compliance/**', sample: 'compliance/RTM.md' },
  { pattern: 'docs/**', sample: 'docs/guide.txt' },
  { pattern: '.devaudit/**', sample: '.devaudit/sync-manifest.json' },
  { pattern: '.github/ISSUE_TEMPLATE/**', sample: '.github/ISSUE_TEMPLATE/bug.yml' },
  { pattern: '**/*.md', sample: 'src/notes/README.md' },
];

const guidance = (id: string, summary: string, plan: string[]): Remediation => ({ id, tier: 'C', summary, plan, needsPortal: false });

export function pullRequestGatesCheck(consumer: { readonly cfg: Record<string, unknown> }): CheckResult {
  const name = 'pull-request-gates';
  const cfg = consumer.cfg;
  const findings: Finding[] = [];

  if (cfg['paths_ignore_pull_request'] !== true) {
    findings.push({
      subject: 'docs-only-skip-off',
      detail:
        'paths_ignore_pull_request is not true, so every pull request into the integration branch runs the full Quality Gates, including one that changes only evidence and docs.',
      remediation: guidance('enable-docs-only-skip', 'Skip the full gates for docs-only pull requests', [
        'devaudit configure set paths_ignore_pull_request true',
        'devaudit update   (on a fix branch: regenerates ci.yml and ci-status-fallback.yml)',
      ]),
    });
  }

  const list = Array.isArray(cfg['paths_ignore']) ? (cfg['paths_ignore'] as unknown[]).filter((x): x is string => typeof x === 'string') : null;
  if (list !== null) {
    const missing = DOC_PATH_SAMPLES.filter((s) => !pathsIgnoreCovers(list, s.sample));
    if (missing.length > 0) {
      const merged = [...list, ...missing.map((m) => m.pattern)];
      findings.push({
        subject: 'docs-not-ignored',
        detail: `paths_ignore does not cover ${missing.map((m) => m.sample).join(', ')}: a change to ${missing.length === 1 ? 'it' : 'them'} runs CI. Add ${missing.map((m) => m.pattern).join(', ')}.`,
        remediation: guidance('cover-docs-paths', 'Add the documentation paths to paths_ignore', [
          `devaudit configure set paths_ignore ${merged.join(',')}   (replaces the whole list)`,
        ]),
      });
    }
  }

  if (findings.length === 0) {
    return { name, ok: true, detail: 'docs-only pull requests skip the full gates, and paths_ignore covers the documentation paths', suspectedOrigin: 'consumer-drift' };
  }
  // Informational: the project works as it is, it just costs more than it needs to.
  return { name, ok: true, detail: `${findings.length} way(s) to save gate runs on documentation-only changes`, suspectedOrigin: 'consumer-drift', findings };
}
