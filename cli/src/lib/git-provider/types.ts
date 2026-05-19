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
  applyBranchProtection(
    cwd: string,
    branch: string,
    requiredChecks: readonly string[],
  ): Promise<BranchProtectionResult>;
  createPullRequest(cwd: string, opts: PullRequestCreateOptions): Promise<PullRequestCreated>;
}
