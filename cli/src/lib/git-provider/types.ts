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
  createPullRequest(cwd: string, opts: PullRequestCreateOptions): Promise<PullRequestCreated>;
}
