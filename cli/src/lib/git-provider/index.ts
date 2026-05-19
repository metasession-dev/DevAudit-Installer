import { GitHubProvider } from './github.js';
import { detectProvider } from './detect.js';
import type { GitProvider } from './types.js';

export { GitHubProvider } from './github.js';
export { detectProvider, classifyRemoteUrl } from './detect.js';
export type {
  GitProvider,
  GitProviderName,
  RepoMeta,
  BranchProtectionResult,
  PullRequestCreateOptions,
  PullRequestCreated,
} from './types.js';

export async function getGitProvider(cwd: string): Promise<GitProvider> {
  const { provider, host } = await detectProvider(cwd);
  if (provider === 'github') return new GitHubProvider();
  throw new Error(
    `Git provider '${provider}' (host: ${host}) is not yet supported. Only GitHub is implemented in workstream C; GitLab/Bitbucket/self-hosted are planned.`,
  );
}
