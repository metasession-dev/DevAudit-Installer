export type GitProviderName = 'github' | 'gitlab' | 'bitbucket' | 'self-hosted';

export interface RepoMeta {
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
}

export interface BranchProtectionResult {
  readonly applied: boolean;
  readonly message?: string;
}

/**
 * devaudit-installer#990 — outcome of `ensureBranchProtection` (used by
 * `update`). `ok`: nothing to change. `updated`: missing pieces were added
 * (see `changes`). `created`: the branch had no protection, so the install
 * defaults were applied. `ruleset`: repository rulesets protect the branch,
 * so classic protection is left alone (`missingChecks` lists required checks
 * the rulesets lack). `unavailable`: the plan does not offer protection for
 * this repository (private repo on GitHub Free). `failed`: a read or write
 * failed (`message`).
 */
export interface EnsureBranchProtectionResult {
  readonly status: 'ok' | 'updated' | 'created' | 'ruleset' | 'unavailable' | 'failed';
  readonly changes?: readonly string[];
  readonly missingChecks?: readonly string[];
  readonly message?: string;
}

export interface SetDefaultBranchResult {
  readonly changed: boolean;
  readonly message?: string;
}

export interface PullRequestCreateOptions {
  readonly base: string;
  readonly head: string;
  readonly title: string;
  readonly body: string;
}

export interface PullRequestCreated {
  readonly url: string;
}

export interface GitProvider {
  readonly name: GitProviderName;
  getRepoMeta(cwd: string): Promise<RepoMeta>;
  setSecret(cwd: string, name: string, value: string): Promise<void>;
  setVariable(cwd: string, name: string, value: string): Promise<void>;
  /**
   * Read-only probe: does the repo already have a secret with this name?
   * Used by `install`'s dev-mode auto-detection to recognise an already-
   * onboarded project's CI token before deciding whether to (re-)write it.
   * Implementations should never throw on "secret doesn't exist" — that's a
   * `false` return — only on auth / network failures.
   */
  hasSecret(cwd: string, name: string): Promise<boolean>;
  /**
   * devaudit-installer#778 — delete a repo secret written by `install`
   * (e.g. when `uninstall` disconnects a repo from a project). Must not
   * throw if the secret doesn't exist — that's a no-op, matching
   * `hasSecret`'s "false means not present" contract.
   */
  deleteSecret(cwd: string, name: string): Promise<void>;
  /** devaudit-installer#778 — delete a repo variable (e.g. DEVAUDIT_BASE_URL). Same no-throw-if-absent contract as `deleteSecret`. */
  deleteVariable(cwd: string, name: string): Promise<void>;
  /**
   * Set the repo's GitHub-reported default branch to `branch` (idempotent —
   * reads the current value via getRepoMeta() first; a no-op if it already
   * matches returns `{ changed: false }`). GitHub creates every repo with
   * `main` as default; without this, a contributor using GitHub's own UI
   * (new-branch dropdown, "Compare & pull request") lands on `main` instead
   * of the integration branch, silently skipping the real Quality Gates
   * workflow (which only triggers on PRs to the integration branch). See
   * devaudit#731.
   */
  setDefaultBranch(cwd: string, branch: string): Promise<SetDefaultBranchResult>;
  applyBranchProtection(
    cwd: string,
    branch: string,
    requiredChecks: readonly string[],
    options?: { readonly requiredReviewCount?: number },
  ): Promise<BranchProtectionResult>;
  /**
   * devaudit-installer#990 — the `update` path. Reads the branch's current
   * protection and adds only what DevAudit needs (missing required checks,
   * a review count below `minReviewCount`). Never lowers or removes a
   * setting a maintainer chose, never adds classic protection to a branch
   * that repository rulesets already protect, and only falls back to the
   * install defaults when the branch has no protection at all.
   */
  ensureBranchProtection(
    cwd: string,
    branch: string,
    requiredChecks: readonly string[],
    options?: { readonly minReviewCount?: number },
  ): Promise<EnsureBranchProtectionResult>;
  createPullRequest(cwd: string, opts: PullRequestCreateOptions): Promise<PullRequestCreated>;
}
