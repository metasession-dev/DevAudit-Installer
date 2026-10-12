/**
 * First-pass signal for `fleet-doctor` (devaudit-installer#867): whether a
 * failing check most likely points at this one consumer having drifted from
 * what onboarding/template-sync should have produced (`consumer-drift`), or
 * at the framework/portal itself (`framework`) -- e.g. every consumer would
 * fail the same way regardless of local state. `fleet-doctor` re-evaluates
 * this with cross-consumer evidence; it isn't taken as final here. Tool
 * preflight checks (node/git/gh/jq/curl) describe the operator's own
 * machine, not either repo, so they're tagged `unknown`.
 */
export type SuspectedOrigin = 'framework' | 'consumer-drift' | 'unknown';

/**
 * devaudit-installer#956 — additive descriptor a finding may carry. Plain
 * `doctor` only reports it (read-only); `doctor --fix` (phase 3b) acts on it. Tier A = local + reversible, B = portal
 * state change (human PAT), C = git history/code (commands printed only).
 */
export interface Remediation {
  readonly id: string;
  readonly tier: 'A' | 'B' | 'C';
  readonly summary: string;
  readonly plan: readonly string[];
  readonly needsPortal: boolean;
  /**
   * Machine-readable parameters for `doctor --fix` (ticket path, portal
   * release id, reason, ...). Additive; absent on descriptors that only
   * describe guidance.
   */
  readonly data?: Readonly<Record<string, string>>;
}

export interface Finding {
  /** The release/REQ the finding is about, e.g. `REQ-042`. */
  readonly subject: string;
  readonly detail: string;
  readonly remediation?: Remediation;
}

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly suspectedOrigin?: SuspectedOrigin;
  /** Per-subject findings behind a non-ok result (release-deferral checks only). */
  readonly findings?: readonly Finding[];
}

/** One entry of the additive `proposals` array in `doctor --json`. */
export interface Proposal {
  readonly check: string;
  readonly subject: string;
  readonly detail: string;
  readonly remediation: Remediation;
}
