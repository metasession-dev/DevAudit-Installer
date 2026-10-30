import type { ClauseState } from '../gap.js';
import { baseName, type RepoReader } from '../repo-reader.js';
import type {
  ClauseDefinition,
  ClauseResult,
  Expectation,
  ExpectationResult,
  FrameworkFile,
  FrameworkResult,
  ScanContext,
} from './types.js';

/**
 * The local clause evaluation (DevAudit-Installer#1116 section 6). It reads files through a `RepoReader`,
 * never runs repository content and never reads outside the repository root. The wording says "set up to
 * produce", never "compliant": a scan tells what a repository is set up to evidence.
 */

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', 'target', '__pycache__', '.venv', 'venv', '.tox', '.cache']);
const MAX_DIRS = 4000;
const MAX_DEPTH = 8;
const MAX_FILE_BYTES = 1_000_000;
const DAY_MS = 86_400_000;

/** Repository paths of files whose name is one of `names` (build output, dependencies and `.git` are skipped). */
export async function findFiles(reader: RepoReader, names: readonly string[]): Promise<string[]> {
  const wanted = new Set(names);
  const found: string[] = [];
  let visited = 0;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: '', depth: 0 }];
  while (queue.length > 0 && visited < MAX_DIRS) {
    const { dir, depth } = queue.shift()!;
    visited += 1;
    for (const entry of await reader.list(dir)) {
      if (entry.endsWith('/')) {
        const name = baseName(entry);
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(name)) queue.push({ dir: entry.slice(0, -1), depth: depth + 1 });
      } else if (wanted.has(baseName(entry))) {
        found.push(entry);
      }
    }
  }
  return found.sort();
}

const ORDER: Record<ClauseState, number> = { evidenced: 4, partly: 3, unknown: 2, missing: 1, needs_portal: 0 };

/** The best state of a list (evidenced > partly > unknown > missing > needs_portal). */
function best(results: readonly ExpectationResult[]): ExpectationResult {
  return results.reduce((a, b) => (ORDER[b.state] > ORDER[a.state] ? b : a));
}

async function filenamePredicate(e: Extract<Expectation, { kind: 'evidence_filename_any' }>, ctx: ScanContext): Promise<ExpectationResult> {
  const paths = await findFiles(ctx.reader, e.fileNames);
  if (paths.length === 0) return { state: 'missing', reason: `${e.fileNames.join(' or ')} was not found in the repository`, paths: [] };
  const now = (ctx.now ?? new Date()).getTime();
  let stubOnly = true;
  let stale = false;
  for (const path of paths) {
    const content = await ctx.reader.read(path, MAX_FILE_BYTES);
    const starters = ctx.starterTemplates ? await ctx.starterTemplates(baseName(path)) : [];
    if (content !== null && starters.includes(content)) continue;
    stubOnly = false;
    if (e.freshnessDays !== undefined && ctx.reader.lastCommitDate) {
      const changed = await ctx.reader.lastCommitDate(path);
      if (changed !== null && now - changed.getTime() > e.freshnessDays * DAY_MS) {
        stale = true;
        continue;
      }
    }
    return { state: 'evidenced', reason: `${path} exists`, paths: paths.slice(0, 5) };
  }
  if (stubOnly) return { state: 'partly', reason: `only the unmodified starter ${baseName(paths[0]!)} exists (${paths[0]}); fill it in`, paths: paths.slice(0, 5) };
  if (stale) return { state: 'partly', reason: `${paths[0]} was last changed more than ${e.freshnessDays} days ago`, paths: paths.slice(0, 5) };
  return { state: 'missing', reason: `${e.fileNames.join(' or ')} was not found in the repository`, paths: [] };
}

function typePredicate(types: readonly string[], ctx: ScanContext): ExpectationResult {
  const hits = types.filter((t) => ctx.uploadedTypes.has(t));
  if (hits.length > 0) {
    const files = [...new Set(hits.flatMap((t) => ctx.uploadedTypes.get(t) ?? []))].sort();
    return { state: 'evidenced', reason: `a workflow is set up to produce ${hits.join(', ')}`, paths: files.slice(0, 5) };
  }
  return { state: 'missing', reason: `no workflow under .github/workflows is set up to produce ${types.join(' or ')}`, paths: [] };
}

/** Evaluate one expectation against the repository. */
export async function evaluateExpectation(e: Expectation, ctx: ScanContext): Promise<ExpectationResult> {
  switch (e.kind) {
    case 'evidence_filename_any':
      return filenamePredicate(e, ctx);
    case 'evidence_type_any':
      return typePredicate(e.types, ctx);
    case 'evidence_category_any': {
      const types = [...ctx.uploadedTypes.keys()].filter((t) => {
        const c = ctx.categoryOf?.(t);
        return c !== undefined && e.categories.includes(c);
      });
      return types.length > 0 ? typePredicate(types, ctx) : { state: 'missing', reason: `no workflow is set up to produce evidence in ${e.categories.join(' or ')}`, paths: [] };
    }
    case 'requirement_any': {
      const text = (await ctx.reader.read('docs/SRS.md', MAX_FILE_BYTES)) ?? (await ctx.reader.read('compliance/RTM.md', MAX_FILE_BYTES));
      if (text === null) return { state: 'unknown', reason: 'neither docs/SRS.md nor compliance/RTM.md exists to look the requirements up in', paths: [] };
      const missing = e.ids.filter((id) => !text.includes(id));
      return missing.length === 0 ? { state: 'evidenced', reason: 'every requirement is listed', paths: [] } : { state: 'missing', reason: `not listed: ${missing.join(', ')}`, paths: [] };
    }
    case 'any_of': {
      const children = await Promise.all(e.expectations.map((c) => evaluateExpectation(c, ctx)));
      return best(children);
    }
    case 'requirement_meta':
    case 'manual_attestation':
    case 'portal_invariant':
    case 'audit_event_any':
      return { state: 'needs_portal', reason: 'only the portal can tell: it needs the release records', paths: [] };
    default:
      return { state: 'unknown', reason: 'this kind of expectation is not known to this version', paths: [] };
  }
}

/** The clause's state from its expectations (section 6). */
export function clauseState(states: readonly ClauseState[]): ClauseState {
  if (states.length > 0 && states.every((s) => s === 'needs_portal')) return 'needs_portal';
  const real = states.filter((s) => s !== 'needs_portal');
  if (real.length === 0) return 'needs_portal';
  if (real.every((s) => s === 'evidenced')) return 'evidenced';
  if (real.every((s) => s === 'missing')) return 'missing';
  if (!real.includes('evidenced') && real.includes('unknown')) return 'unknown';
  return 'partly';
}

export async function evaluateClause(clause: ClauseDefinition, ctx: ScanContext): Promise<ClauseResult> {
  const results = await Promise.all(clause.expects.map((e) => evaluateExpectation(e, ctx)));
  const state = clauseState(results.map((r) => r.state));
  const deciding = results.filter((r) => r.state !== 'needs_portal');
  const shown = deciding.length > 0 ? deciding : results;
  const reason = [...new Set(shown.map((r) => r.reason))].join('; ');
  const paths = [...new Set(results.flatMap((r) => r.paths))].slice(0, 5);
  return { id: clause.id, state, reason: reason.slice(0, 400), paths };
}

export async function evaluateFramework(framework: FrameworkFile, ctx: ScanContext): Promise<FrameworkResult> {
  const clauses: ClauseResult[] = [];
  for (const clause of framework.clauses) clauses.push(await evaluateClause(clause, ctx));
  return { code: framework.code, clauses };
}
