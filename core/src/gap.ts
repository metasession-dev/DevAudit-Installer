/**
 * The gap model (DevAudit-Installer#1116 section 7): one shape for "something is not as it should be,
 * here is why, and here is what you can do", shared by `devaudit doctor`, `devaudit scan` and the
 * portal, so the same finding reads the same everywhere.
 *
 * A gap is a description, never an action. It lists options; whoever shows it (the doctor, the guided
 * mode, a web page) decides what to offer and always lets the person leave a gap as it is.
 */

/**
 * How much a fix changes: `A` a local, reversible edit (a configuration key, a file in the
 * repository); `B` a change to portal state, which only a person at a terminal may confirm; `C`
 * guidance or a command that is printed and never run for the person.
 */
export type FixTier = 'A' | 'B' | 'C';

/** How well a repository evidences a clause. `needs_portal` means only the portal can tell. */
export type ClauseState = 'evidenced' | 'partly' | 'missing' | 'unknown' | 'needs_portal';

/**
 * A repair a check can describe (the shape `devaudit doctor --fix` acts on). Plain doctor only reports
 * it; `--fix` applies tier A and B after confirmations and prints tier C.
 */
export interface Remediation {
  readonly id: string;
  readonly tier: FixTier;
  readonly summary: string;
  readonly plan: readonly string[];
  readonly needsPortal: boolean;
  /**
   * Machine-readable parameters for `doctor --fix` (a ticket path, a portal release id, a reason, ...).
   * Absent on descriptors that only describe guidance.
   */
  readonly data?: Readonly<Record<string, string>>;
}

export interface GapOption {
  /** Stable within its gap, for example the remediation id or `guidance`. */
  readonly id: string;
  /** What the option does, in plain words. */
  readonly label: string;
  readonly tier: FixTier;
  /** What happens, and what it means for the project's evidence, if this option is chosen. */
  readonly consequence: string;
  readonly remediation?: Remediation;
}

export interface Gap {
  /** Stable, for example `doctor:srs:srs` or `scan:SOC2.CC8.1`. */
  readonly id: string;
  readonly source: 'scan' | 'doctor';
  /** The doctor check name, or the framework code for a scan gap. */
  readonly check: string;
  /** What the gap is about: a release or requirement id, a configuration key, a clause. */
  readonly subject: string;
  /** Scan gaps only: how well the clause is evidenced. */
  readonly state?: ClauseState;
  readonly title: string;
  /** Why it matters, in plain words. */
  readonly why: string;
  /** Registry clause IDs the gap bears on (never anything else); empty when none is known. */
  readonly controls: string[];
  /** The ways to close the gap. Never empty; "leave this as is" is offered by whoever shows the gap. */
  readonly options: GapOption[];
}

/** What a check says about one thing it found (the part of a doctor `Finding` a gap needs). */
export interface FindingInput {
  readonly subject: string;
  readonly detail: string;
  readonly remediation?: Remediation;
}

/** The plain-language text kept per check (doctor) or per clause (scan). */
export interface GapExplanation {
  readonly title: string;
  readonly why: string;
  /** What to do when the check has no repair of its own: one sentence, imperative. */
  readonly guidance: string;
  readonly controls?: readonly string[];
}

const TIER_CONSEQUENCE: Record<FixTier, string> = {
  A: 'Changes a local file or setting; the change is reversible and shows up in git.',
  B: 'Changes state on the DevAudit portal. It needs your sign-in token, an interactive confirmation and a reason.',
  C: 'Prints the commands or steps; DevAudit changes nothing for you.',
};

/** The stable id of a gap. */
export function gapId(source: Gap['source'], check: string, subject: string): string {
  return `${source}:${check}:${subject}`;
}

/**
 * The gap for one finding of a check. Its options are the finding's repair when it has one, otherwise a
 * guidance option (tier C) built from `explanation.guidance` or, failing that, the finding's own text,
 * so a gap always has at least one option and a non-empty reason.
 */
export function findingToGap(check: string, finding: FindingInput, explanation?: GapExplanation): Gap {
  const subject = finding.subject.trim() !== '' ? finding.subject : check;
  const detail = finding.detail.trim();
  const options: GapOption[] = [];
  if (finding.remediation) {
    const r = finding.remediation;
    options.push({
      id: r.id,
      label: r.summary,
      tier: r.tier,
      consequence: TIER_CONSEQUENCE[r.tier],
      remediation: r,
    });
  } else {
    options.push({
      id: 'guidance',
      label: explanation?.guidance ?? (detail !== '' ? detail : `Look at the ${check} check and fix what it reports.`),
      tier: 'C',
      consequence: TIER_CONSEQUENCE.C,
    });
  }
  return {
    id: gapId('doctor', check, subject),
    source: 'doctor',
    check,
    subject,
    title: explanation?.title ?? check,
    why: explanation?.why ?? (detail !== '' ? detail : `The ${check} check found a problem.`),
    controls: [...(explanation?.controls ?? [])],
    options,
  };
}
