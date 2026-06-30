import { execa } from 'execa';
import type {
  BranchProtectionResult,
  GitProvider,
  PullRequestCreateOptions,
  PullRequestCreated,
  RepoMeta,
} from './types.js';

interface GithubProviderOptions {
  readonly preferGhCli?: boolean;
  readonly token?: string;
}

interface GhCheckResult {
  readonly available: boolean;
}

let ghAvailabilityCache: GhCheckResult | null = null;

async function ghAvailable(): Promise<boolean> {
  if (ghAvailabilityCache !== null) return ghAvailabilityCache.available;
  try {
    await execa('gh', ['--version']);
    ghAvailabilityCache = { available: true };
    return true;
  } catch {
    ghAvailabilityCache = { available: false };
    return false;
  }
}

export class GitHubProvider implements GitProvider {
  readonly name = 'github' as const;
  private readonly preferGhCli: boolean;
  private readonly token: string | undefined;

  constructor(opts: GithubProviderOptions = {}) {
    this.preferGhCli = opts.preferGhCli ?? true;
    this.token = opts.token ?? process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN'];
  }

  async getRepoMeta(cwd: string): Promise<RepoMeta> {
    if (this.preferGhCli && (await ghAvailable())) {
      const res = await execa(
        'gh',
        ['repo', 'view', '--json', 'owner,name,defaultBranchRef', '--jq', '{owner: .owner.login, name: .name, defaultBranch: .defaultBranchRef.name}'],
        { cwd, reject: false },
      );
      if (res.exitCode === 0 && res.stdout.trim().length > 0) {
        const parsed = JSON.parse(res.stdout) as RepoMeta;
        return parsed;
      }
    }
    const { owner, name } = await parseOriginRemote(cwd);
    if (!this.token) {
      throw new Error(
        'No `gh` CLI on PATH and no GH_TOKEN env var — cannot resolve repo metadata for GitHub.',
      );
    }
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`GitHub REST repo lookup failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { default_branch: string };
    return { owner, name, defaultBranch: json.default_branch };
  }

  async setSecret(cwd: string, name: string, value: string): Promise<void> {
    if (this.preferGhCli && (await ghAvailable())) {
      await execa('gh', ['secret', 'set', name], { cwd, input: value });
      return;
    }
    throw new Error(
      'Setting a GitHub repo secret without `gh` CLI requires sodium encryption (libsodium) — not implemented. Install `gh` CLI to use this command.',
    );
  }

  async hasSecret(cwd: string, name: string): Promise<boolean> {
    // Best-effort probe used by install's dev-mode detection (#NN). Returns
    // false on any read failure — the safe default routes to operator mode,
    // which preserves today's behaviour for first-dev installs.
    if (this.preferGhCli && (await ghAvailable())) {
      const res = await execa('gh', ['secret', 'list', '--json', 'name'], { cwd, reject: false });
      if (res.exitCode !== 0) return false;
      try {
        const rows = JSON.parse(res.stdout) as Array<{ name: string }>;
        return rows.some((r) => r.name === name);
      } catch {
        return false;
      }
    }
    const meta = await this.getRepoMeta(cwd);
    if (!this.token) return false;
    const res = await fetch(
      `https://api.github.com/repos/${meta.owner}/${meta.name}/actions/secrets/${name}`,
      { headers: this.authHeaders() },
    );
    return res.ok;
  }

  async setVariable(cwd: string, name: string, value: string): Promise<void> {
    if (this.preferGhCli && (await ghAvailable())) {
      await execa('gh', ['variable', 'set', name, '--body', value], { cwd });
      return;
    }
    const { owner, name: repoName } = await this.getRepoMeta(cwd);
    if (!this.token) {
      throw new Error('No `gh` CLI and no GH_TOKEN — cannot set repo variable.');
    }
    const res = await fetch(`https://api.github.com/repos/${owner}/${repoName}/actions/variables`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ name, value }),
    });
    if (res.status === 409) {
      const update = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/actions/variables/${name}`,
        {
          method: 'PATCH',
          headers: { ...this.authHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify({ value }),
        },
      );
      if (!update.ok) throw new Error(`GitHub REST variable update failed: HTTP ${update.status}`);
      return;
    }
    if (!res.ok) throw new Error(`GitHub REST variable create failed: HTTP ${res.status}`);
  }

  async applyBranchProtection(
    cwd: string,
    branch: string,
    requiredChecks: readonly string[],
    options?: { readonly requiredReviewCount?: number },
  ): Promise<BranchProtectionResult> {
    const reviewCount = options?.requiredReviewCount ?? 0;
    const body = {
      required_status_checks: { strict: false, contexts: requiredChecks },
      enforce_admins: true,
      required_pull_request_reviews: { dismiss_stale_reviews: true, required_approving_review_count: reviewCount },
      restrictions: null,
    };
    if (this.preferGhCli && (await ghAvailable())) {
      const meta = await this.getRepoMeta(cwd);
      const res = await execa(
        'gh',
        ['api', '-X', 'PUT', `/repos/${meta.owner}/${meta.name}/branches/${branch}/protection`, '--input', '-'],
        { cwd, input: JSON.stringify(body), reject: false },
      );
      if (res.exitCode === 0) return { applied: true };
      return { applied: false, message: res.stderr.split('\n')[0] || 'gh api call failed' };
    }
    const meta = await this.getRepoMeta(cwd);
    if (!this.token) {
      return { applied: false, message: 'No `gh` CLI and no GH_TOKEN — cannot apply branch protection.' };
    }
    const res = await fetch(
      `https://api.github.com/repos/${meta.owner}/${meta.name}/branches/${branch}/protection`,
      {
        method: 'PUT',
        headers: { ...this.authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (res.ok) return { applied: true };
    return { applied: false, message: `GitHub REST branch-protection PUT failed: HTTP ${res.status}` };
  }

  async createPullRequest(cwd: string, opts: PullRequestCreateOptions): Promise<PullRequestCreated> {
    if (this.preferGhCli && (await ghAvailable())) {
      const res = await execa(
        'gh',
        ['pr', 'create', '--base', opts.base, '--head', opts.head, '--title', opts.title, '--body', opts.body],
        { cwd },
      );
      return { url: res.stdout.trim() };
    }
    const meta = await this.getRepoMeta(cwd);
    if (!this.token) {
      throw new Error('No `gh` CLI and no GH_TOKEN — cannot create pull request.');
    }
    const res = await fetch(`https://api.github.com/repos/${meta.owner}/${meta.name}/pulls`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(`GitHub REST PR create failed: HTTP ${res.status}`);
    const json = (await res.json()) as { html_url: string };
    return { url: json.html_url };
  }

  private authHeaders(): Record<string, string> {
    if (!this.token) return { accept: 'application/vnd.github+json' };
    return { accept: 'application/vnd.github+json', authorization: `Bearer ${this.token}` };
  }
}

async function parseOriginRemote(cwd: string): Promise<{ owner: string; name: string }> {
  const res = await execa('git', ['remote', 'get-url', 'origin'], { cwd, reject: false });
  if (res.exitCode !== 0) {
    throw new Error('No `origin` git remote configured; cannot determine GitHub repo.');
  }
  const url = res.stdout.trim();
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Could not parse GitHub owner/name from remote URL: ${url}`);
  }
  return { owner: match[1] ?? '', name: match[2] ?? '' };
}

export function resetGhAvailabilityCache(): void {
  ghAvailabilityCache = null;
}
