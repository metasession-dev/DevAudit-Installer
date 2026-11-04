import type { Gap, GapOption } from '@metasession.co/devaudit-core';
import { CHECK_DEPENDENTS, CHECK_EXPLANATIONS, EXPLAINED_CHECKS } from '../lib/doctor-explain.js';
import { logger } from '../lib/logger.js';
import type { Proposal } from '../lib/doctor-types.js';
import * as prompts from '../lib/prompt.js';
import { FIX_EXIT_UNAPPLIED, runFix, type FixDeps } from './doctor-fix.js';

/**
 * DevAudit-Installer#1116 WP8 — `devaudit doctor --explain <check>` and `devaudit doctor --guided`.
 *
 * `--guided` walks the gaps one at a time and only ever offers; "leave as is" is always an option and
 * never an error. It applies a fix by calling `runFix` (the `doctor --fix` code) with one proposal and
 * no `--yes`, so tier A needs its confirmation and tier B its interactive terminal, typed reason and
 * confirmation exactly as under `--fix`: this module cannot weaken them.
 */

export const GUIDED_EXIT_REFUSED = 2;
export const GUIDED_EXIT_UNAPPLIED = FIX_EXIT_UNAPPLIED;

// ---- --explain -----------------------------------------------------------------------------------------------

const TIER_LABEL = { A: 'a local edit', B: 'a change on the portal', C: 'guidance only' } as const;

/** The text of `doctor --explain <check>`; null for a name that is not a doctor check. */
export function renderExplanation(check: string): string | null {
  const e = CHECK_EXPLANATIONS[check];
  if (!e) return null;
  const lines = [
    `${check}: ${e.title}`,
    '',
    `Why it matters: ${e.why}`,
    '',
    'What you can do (you can also leave it as it is):',
    `  - ${e.guidance}`,
    '    Fix tier C: guidance only; DevAudit changes nothing for you.',
    '  - Where the check carries a repair, `devaudit doctor --fix` or `devaudit doctor --guided` offers it:',
    `    ${TIER_LABEL.A} (tier A, reversible, shows up in git) or ${TIER_LABEL.B} (tier B, needs your sign-in and an interactive confirmation).`,
  ];
  if (e.controls && e.controls.length > 0) lines.push('', `Standards clauses affected: ${e.controls.join(', ')}.`);
  return lines.join('\n');
}

/** `doctor --explain <check>`: prints the explanation, or the list of checks (exit 2) for an unknown name. */
export function runExplain(check: string, say: (line: string) => void = (l) => logger().log(l)): number {
  const text = renderExplanation(check);
  if (text === null) {
    logger().error(`Unknown check "${check}". Checks doctor can explain: ${EXPLAINED_CHECKS.join(', ')}.`);
    return 2;
  }
  say(text);
  return 0;
}

// ---- --guided ------------------------------------------------------------------------------------------------

/** The order gaps are walked in: a compliance consequence first (largest first), then fixable gaps, guidance-only last. */
export function orderGaps(gaps: readonly Gap[]): Gap[] {
  const guidanceOnly = (g: Gap): boolean => g.options.every((o) => o.tier === 'C');
  const rank = (g: Gap): number => (g.controls.length > 0 ? 0 : guidanceOnly(g) ? 2 : 1);
  return gaps
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g) - rank(b.g) || (rank(a.g) === 0 ? b.g.controls.length - a.g.controls.length : 0) || a.i - b.i)
    .map((x) => x.g);
}

export interface GuidedDeps {
  readonly ask: Pick<typeof prompts, 'confirm' | 'input' | 'select' | 'nonInteractiveReason'>;
  /** All current gaps (the checks are run again). */
  readonly collect: () => Promise<{ gaps: readonly Gap[]; proposals?: readonly Proposal[] }>;
  readonly fixDeps: FixDeps;
  readonly say?: (line: string) => void;
  /** Adds options to gaps before they are shown (a tier A repair that exists only in guided mode). */
  readonly decorate?: (gaps: readonly Gap[]) => Gap[];
  /** `--json` is set: nothing is prompted. */
  readonly json?: boolean;
}

export interface GuidedReport {
  readonly exitCode: number;
  readonly applied: string[];
  readonly left: string[];
  readonly remaining: string[];
  readonly failed: string[];
}

const optionLine = (o: GapOption): string => `${o.label} [tier ${o.tier}: ${o.consequence}]`;

function proposalFor(gap: Gap, option: GapOption): Proposal | null {
  return option.remediation ? { check: gap.check, subject: gap.subject, detail: gap.title, remediation: option.remediation } : null;
}

/** Gaps of `check` plus every check that declares a dependency on it. */
function affectedChecks(check: string): string[] {
  return [check, ...(CHECK_DEPENDENTS[check] ?? [])];
}

export async function runGuided(scope: string | undefined, deps: GuidedDeps): Promise<GuidedReport> {
  const say = deps.say ?? ((l: string) => logger().log(l));
  const empty = { applied: [], left: [], remaining: [], failed: [] };
  const why = deps.ask.nonInteractiveReason(Boolean(deps.json));
  if (why) {
    logger().error(`\`devaudit doctor --guided\` asks questions and needs a terminal (${why}). Nothing was changed; run it in a terminal, or use \`devaudit doctor --fix\`.`);
    return { exitCode: GUIDED_EXIT_UNAPPLIED, ...empty };
  }
  if (scope !== undefined && !(scope in CHECK_EXPLANATIONS)) {
    logger().error(`Unknown check "${scope}". Checks doctor can explain: ${EXPLAINED_CHECKS.join(', ')}.`);
    return { exitCode: GUIDED_EXIT_REFUSED, ...empty };
  }
  const decorate = deps.decorate ?? ((g: readonly Gap[]) => [...g]);
  const inScope = (gaps: readonly Gap[]): Gap[] => decorate(gaps).filter((g) => scope === undefined || g.check === scope);
  let current = await deps.collect();
  let queue = orderGaps(inScope(current.gaps));
  if (queue.length === 0) {
    say(scope === undefined ? 'No gaps: nothing to do.' : `No gaps for ${scope}: nothing to do.`);
    return { exitCode: 0, ...empty };
  }

  const applied: string[] = [];
  const left: string[] = [];
  const failed: string[] = [];
  const shown: string[] = [];
  const done = new Set<string>();
  let stopped = false;

  while (queue.length > 0 && !stopped) {
    const gap = queue[0]!;
    queue = queue.slice(1);
    if (done.has(gap.id)) continue;
    say('');
    say(`${gap.title}`);
    say(`  ${gap.why}`);
    say(`  About: ${gap.subject} (${gap.check})`);
    if (gap.controls.length > 0) say(`  Standards clauses affected: ${gap.controls.join(', ')}`);
    say('  Options:');
    for (const o of gap.options) say(`    - ${optionLine(o)}`);
    say('    - Leave this as it is');
    const choices = [
      ...gap.options.map((o, i) => ({ value: `option:${i}`, label: `${o.label} (tier ${o.tier})` })),
      { value: 'leave', label: 'Leave this as it is' },
      { value: 'stop', label: 'Stop here (the rest is left as it is)' },
    ];
    const answer = await deps.ask.select('What do you want to do about this?', choices);
    if (answer === null || answer === 'stop') {
      stopped = true;
      left.push(gap.id, ...queue.map((g) => g.id));
      queue = [];
      break;
    }
    done.add(gap.id);
    if (answer === 'leave') {
      left.push(gap.id);
      continue;
    }
    const option = gap.options[Number(answer.slice('option:'.length))];
    if (!option) {
      left.push(gap.id);
      continue;
    }
    const proposal = proposalFor(gap, option);
    if (proposal === null || option.tier === 'C') {
      // Guidance: print it, change nothing. The gap stays in the remaining list.
      say(`  ${option.label}`);
      if (proposal) for (const step of proposal.remediation.plan) say(`    ${step}`);
      shown.push(gap.id);
      continue;
    }
    const report = await runFix([proposal], deps.fixDeps, { yes: false, dryRun: false, json: false });
    const outcome = report.outcomes[0];
    if (outcome) say(`  [${outcome.tier}] ${outcome.id}: ${outcome.status} — ${outcome.message}`);
    if (!outcome || outcome.status === 'unapplied' || outcome.status === 'failed') {
      failed.push(gap.id);
      continue;
    }
    // Re-check the affected check and everything that depends on it, and show the new state.
    current = await deps.collect();
    const checks = affectedChecks(gap.check);
    const stillOpen = current.gaps.filter((g) => checks.includes(g.check));
    if (stillOpen.some((g) => g.id === gap.id)) {
      say('  The check was run again and this gap is still open.');
      shown.push(gap.id);
    } else {
      applied.push(gap.id);
      say('  The check was run again: this gap is closed.');
    }
    // The queue is what is still open now, in the same order, plus gaps a dependent check newly reports.
    const open = new Set(inScope(current.gaps).map((g) => g.id));
    const known = new Set([...done, ...queue.map((g) => g.id)]);
    const fresh = orderGaps(inScope(current.gaps).filter((g) => !known.has(g.id) && checks.includes(g.check)));
    queue = [...queue.filter((g) => open.has(g.id)), ...fresh];
  }

  const remaining = [...new Set([...shown, ...queue.map((g) => g.id), ...failed])];
  say('');
  say(`Summary: ${applied.length} fixed, ${left.length} left as they are, ${remaining.length} still open.`);
  if (applied.length > 0) say(`  Fixed: ${applied.join(', ')}`);
  if (left.length > 0) say(`  Left as they are: ${left.join(', ')}`);
  if (remaining.length > 0) say(`  Still open: ${remaining.join(', ')}`);
  // A gap the person chose to leave, and guidance that was only shown, are not errors.
  const exitCode = failed.length > 0 ? GUIDED_EXIT_UNAPPLIED : 0;
  return { exitCode, applied, left, remaining, failed };
}
