import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { logger } from '../lib/logger.js';

/**
 * devaudit-installer#970 — the synced issue templates declare `labels:`
 * (e.g. `needs-triage`) that nothing created in the consumer repo, so
 * `gh issue create --label needs-triage` failed outright. `install` and
 * `update` (both go through `syncProject`) now idempotently seed them.
 */

const TEMPLATE_DIR = ['sdlc', 'files', '_common', 'github', 'ISSUE_TEMPLATE'];

/** Always seeded, even if a template stops declaring them. */
const BASELINE_LABELS = ['bug', 'requirement', 'needs-triage', 'accepted-e2e-failure', 'accepted-dependency-risk'] as const;

const LABEL_META: Readonly<Record<string, { color: string; description: string }>> = {
  'needs-triage': { color: 'FBCA04', description: 'Awaiting triage' },
  bug: { color: 'D73A4A', description: "Something isn't working" },
  requirement: { color: '0E8A16', description: 'SDLC requirement (REQ-XXX)' },
  task: { color: 'C5DEF5', description: 'Tracked task' },
  chore: { color: 'EDEDED', description: 'Maintenance / housekeeping' },
  documentation: { color: '0075CA', description: 'Improvements or additions to documentation' },
  'srs-bootstrap': { color: '5319E7', description: 'SRS bootstrap request' },
  'accepted-e2e-failure': { color: 'FBCA04', description: 'Tracks an accepted (documented-exception) E2E failure; carries a Review by date' },
  'accepted-dependency-risk': { color: 'FBCA04', description: 'Tracks an accepted dependency-audit risk; carries a Review by date' },
};
const DEFAULT_META = { color: 'EDEDED', description: '' };

/** Pull the top-level `labels: [..]` array out of an issue-form YAML. */
export function parseTemplateLabels(yaml: string): string[] {
  const m = /^labels:\s*\[([^\]]*)\]/m.exec(yaml);
  if (!m || m[1] === undefined) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 0);
}

export async function collectTemplateLabels(installerRoot: string): Promise<string[]> {
  const labels = new Set<string>(BASELINE_LABELS);
  const dir = join(installerRoot, ...TEMPLATE_DIR);
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch {
    // templates dir absent — baseline only
  }
  for (const f of entries) {
    const text = await fs.readFile(join(dir, f), 'utf8');
    for (const l of parseTemplateLabels(text)) labels.add(l);
  }
  return [...labels].sort();
}

export interface EnsureLabelsResult {
  readonly created: readonly string[];
  readonly skipped?: string;
}

/**
 * Best-effort: never throws. Warns when `gh` is missing/unauthenticated or
 * the repo is not on GitHub. Creates only labels that are missing, so an
 * existing label's colour/description is never overwritten.
 */
export async function ensureIssueTemplateLabels(
  repoRoot: string,
  installerRoot: string,
  opts: { dryRun?: boolean } = {},
): Promise<EnsureLabelsResult> {
  const log = logger();
  const wanted = await collectTemplateLabels(installerRoot);
  if (opts.dryRun) {
    log.log(`  [dry-run] would ensure GitHub labels exist: ${wanted.join(', ')}`);
    return { created: [], skipped: 'dry-run' };
  }
  const skip = (reason: string): EnsureLabelsResult => {
    log.warn(
      `  Could not seed issue-template labels (${reason}). Create them manually: ${wanted
        .map((l) => `gh label create ${l} --force`)
        .join('; ')}`,
    );
    return { created: [], skipped: reason };
  };
  try {
    const listed = await execa('gh', ['label', 'list', '--limit', '500', '--json', 'name', '--jq', '.[].name'], {
      cwd: repoRoot,
      reject: false,
    });
    if (listed.exitCode !== 0) {
      return skip('gh unavailable, unauthenticated, or repo not on GitHub');
    }
    const existing = new Set(String(listed.stdout ?? '').split('\n').map((s) => s.trim().toLowerCase()));
    const created: string[] = [];
    for (const label of wanted) {
      if (existing.has(label.toLowerCase())) continue;
      const meta = LABEL_META[label] ?? DEFAULT_META;
      const args = ['label', 'create', label, '--force', '--color', meta.color];
      if (meta.description) args.push('--description', meta.description);
      // eslint-disable-next-line no-await-in-loop
      const res = await execa('gh', args, { cwd: repoRoot, reject: false });
      if (res.exitCode === 0) created.push(label);
      else log.warn(`  Could not create label '${label}': ${String(res.stderr ?? '').trim()}`);
    }
    log.log(
      created.length > 0
        ? `  [2o] issue-template labels: created ${created.join(', ')}`
        : '  [2o] issue-template labels: all present',
    );
    return { created };
  } catch (err) {
    return skip(err instanceof Error ? err.message : String(err));
  }
}
