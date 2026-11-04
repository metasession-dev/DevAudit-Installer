import { execa } from 'execa';
import type {
  BranchProtectionResult,
  ConfirmLowerReviews,
  EnsureBranchProtectionResult,
  GitProvider,
  PullRequestCreateOptions,
  PullRequestCreated,
  RepoMeta,
  SetDefaultBranchResult,
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

/** GitHub's answer when the plan has no branch protection for this repo (private repo on GitHub Free). */
const PLAN_UNAVAILABLE = /upgrade to github pro|make this repository public/i;

interface BranchRule {
  readonly type: string;
  readonly parameters?: {
    readonly required_status_checks?: readonly { readonly context: string }[];
    readonly required_approving_review_count?: number;
  };
}

interface ClassicProtection {
  readonly required_status_checks?: {
    readonly contexts?: readonly string[];
    readonly checks?: readonly { readonly context: string }[];
  } | null;
  readonly required_pull_request_reviews?: { readonly required_approving_review_count?: number } | null;
}

/** Order-preserving, deduped union of two required-check-context lists. Exported for tests. */
export function unionRequiredChecks(
  existing: readonly string[],
  requested: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const check of [...existing, ...requested]) {
    if (seen.has(check)) continue;
    seen.add(check);
    result.push(check);
  }
  return result;
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

  async deleteSecret(cwd: string, name: string): Promise<void> {
    if (this.preferGhCli && (await ghAvailable())) {
      // `reject: false` — `gh secret delete` exits non-zero when the secret
      // is already gone; that's a success state for a delete, not a failure.
      await execa('gh', ['secret', 'delete', name], { cwd, reject: false });
      return;
    }
    if (!this.token) {
      throw new Error(
        'Deleting a GitHub repo secret without `gh` CLI requires a GH_TOKEN/GITHUB_TOKEN env var. Install `gh` CLI to use this command.',
      );
    }
    const meta = await this.getRepoMeta(cwd);
    const res = await fetch(
      `https://api.github.com/repos/${meta.owner}/${meta.name}/actions/secrets/${name}`,
      { method: 'DELETE', headers: this.authHeaders() },
    );
    // 404 means the secret is already gone — that's the goal state, not an error.
    if (!res.ok && res.status !== 404) {
      throw new Error(`GitHub REST secret delete failed: HTTP ${res.status}`);
    }
  }

  async deleteVariable(cwd: string, name: string): Promise<void> {
    if (this.preferGhCli && (await ghAvailable())) {
      // `reject: false` — same "already gone is a success" contract as
      // `deleteSecret`.
      await execa('gh', ['variable', 'delete', name], { cwd, reject: false });
      return;
    }
    if (!this.token) {
      throw new Error(
        'Deleting a GitHub repo variable without `gh` CLI requires a GH_TOKEN/GITHUB_TOKEN env var. Install `gh` CLI to use this command.',
      );
    }
    const meta = await this.getRepoMeta(cwd);
    const res = await fetch(
      `https://api.github.com/repos/${meta.owner}/${meta.name}/actions/variables/${name}`,
      { method: 'DELETE', headers: this.authHeaders() },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`GitHub REST variable delete failed: HTTP ${res.status}`);
    }
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

  async setDefaultBranch(cwd: string, branch: string): Promise<SetDefaultBranchResult> {
    const meta = await this.getRepoMeta(cwd);
    if (meta.defaultBranch === branch) return { changed: false };
    if (this.preferGhCli && (await ghAvailable())) {
      const res = await execa(
        'gh',
        ['repo', 'edit', `${meta.owner}/${meta.name}`, '--default-branch', branch],
        { cwd, reject: false },
      );
      if (res.exitCode === 0) return { changed: true };
      return { changed: false, message: res.stderr.split('\n')[0] || 'gh repo edit failed' };
    }
    if (!this.token) {
      return { changed: false, message: 'No `gh` CLI and no GH_TOKEN — cannot set default branch.' };
    }
    const res = await fetch(`https://api.github.com/repos/${meta.owner}/${meta.name}`, {
      method: 'PATCH',
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ default_branch: branch }),
    });
    if (res.ok) return { changed: true };
    return { changed: false, message: `GitHub REST default-branch PATCH failed: HTTP ${res.status}` };
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

  /**
   * Current required-status-check contexts for `branch`, or `[]` if the
   * branch has no protection yet (404) or the read otherwise fails. Used by
   * `applyBranchProtection` to merge rather than blindly replace — see
   * `unionRequiredChecks` and #695.
   */
  private async currentRequiredChecks(cwd: string, branch: string): Promise<readonly string[]> {
    if (this.preferGhCli && (await ghAvailable())) {
      const meta = await this.getRepoMeta(cwd);
      const res = await execa(
        'gh',
        [
          'api',
          `/repos/${meta.owner}/${meta.name}/branches/${branch}/protection/required_status_checks/contexts`,
        ],
        { cwd, reject: false },
      );
      if (res.exitCode !== 0) return [];
      try {
        const parsed = JSON.parse(res.stdout) as unknown;
        return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
      } catch {
        return [];
      }
    }
    const meta = await this.getRepoMeta(cwd);
    if (!this.token) return [];
    const res = await fetch(
      `https://api.github.com/repos/${meta.owner}/${meta.name}/branches/${branch}/protection/required_status_checks/contexts`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) return [];
    try {
      const parsed = (await res.json()) as unknown;
      return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
    } catch {
      return [];
    }
  }

  async applyBranchProtection(
    cwd: string,
    branch: string,
    requiredChecks: readonly string[],
    options?: { readonly requiredReviewCount?: number },
  ): Promise<BranchProtectionResult> {
    const reviewCount = options?.requiredReviewCount ?? 0;
    // Read-merge-write (#695): a second `install`/`--add-target` run for
    // another target must not drop the first target's required checks by
    // blindly PUTting a fresh list. Union whatever's currently required with
    // what this call is asking for — additive, order-preserving, deduped.
    const existingChecks = await this.currentRequiredChecks(cwd, branch);
    const contexts = unionRequiredChecks(existingChecks, requiredChecks);
    const body = {
      required_status_checks: { strict: false, contexts },
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

  async ensureBranchProtection(
    cwd: string,
    branch: string,
    requiredChecks: readonly string[],
    options?: {
      readonly minReviewCount?: number;
      readonly exactReviewCount?: number;
      readonly confirmLower?: ConfirmLowerReviews;
    },
  ): Promise<EnsureBranchProtectionResult> {
    const exactReviews = options?.exactReviewCount;
    // An exact count also acts as the floor, so a count below it is raised as before.
    const minReviews = Math.max(options?.minReviewCount ?? 0, exactReviews ?? 0);
    let meta: RepoMeta;
    try {
      meta = await this.getRepoMeta(cwd);
    } catch (err) {
      return { status: 'failed', message: (err as Error).message };
    }
    const repo = `/repos/${meta.owner}/${meta.name}`;
    const base = `${repo}/branches/${encodeURIComponent(branch)}/protection`;

    // Rulesets first: a branch they protect gets no classic protection on
    // top (#990). The endpoint answers 403 "Upgrade to GitHub Pro" for a
    // private repo on GitHub Free, where classic protection is unavailable too.
    const rules = await this.api(cwd, 'GET', `${repo}/rules/branches/${encodeURIComponent(branch)}`);
    if (rules.status === 403 && PLAN_UNAVAILABLE.test(rules.message)) {
      return { status: 'unavailable', message: rules.message };
    }
    if (rules.status === 200 && Array.isArray(rules.data)) {
      const list = rules.data as readonly BranchRule[];
      const protecting = list.filter((r) => r.type === 'required_status_checks' || r.type === 'pull_request');
      if (protecting.length > 0) {
        const have = new Set(
          list
            .filter((r) => r.type === 'required_status_checks')
            .flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c) => c.context)),
        );
        const reviews = Math.max(
          0,
          ...list.filter((r) => r.type === 'pull_request').map((r) => r.parameters?.required_approving_review_count ?? 0),
        );
        return {
          status: 'ruleset',
          missingChecks: requiredChecks.filter((c) => !have.has(c)),
          ...(reviews < minReviews
            ? { message: `rulesets require ${reviews} approving review(s); DevAudit expects at least ${minReviews}` }
            : {}),
        };
      }
    }

    const current = await this.api(cwd, 'GET', base);
    if (current.status === 403 && PLAN_UNAVAILABLE.test(current.message)) {
      return { status: 'unavailable', message: current.message };
    }
    if (current.status === 404) {
      // No protection at all: nothing to preserve, so apply the install defaults.
      const applied = await this.applyBranchProtection(cwd, branch, requiredChecks, { requiredReviewCount: minReviews });
      if (applied.applied) return { status: 'created' };
      if (PLAN_UNAVAILABLE.test(applied.message ?? '')) return { status: 'unavailable', message: applied.message };
      return { status: 'failed', message: applied.message };
    }
    if (current.status !== 200) {
      return { status: 'failed', message: `could not read branch protection: ${current.message}` };
    }

    const data = (current.data ?? {}) as ClassicProtection;
    const changes: string[] = [];
    const existing = new Set([
      ...(data.required_status_checks?.contexts ?? []),
      ...(data.required_status_checks?.checks ?? []).map((c) => c.context),
    ]);
    const missing = requiredChecks.filter((c) => !existing.has(c));
    if (missing.length > 0) {
      // Sub-resource writes only, so every other setting stays as it is.
      const res = data.required_status_checks
        ? await this.api(cwd, 'POST', `${base}/required_status_checks/contexts`, { contexts: missing })
        : await this.api(cwd, 'PATCH', `${base}/required_status_checks`, { strict: false, contexts: missing });
      if (res.status < 200 || res.status >= 300) {
        return { status: 'failed', message: `could not add required check(s): ${res.message}` };
      }
      changes.push(`added required check(s) ${missing.map((c) => `"${c}"`).join(', ')}`);
    }
    const reviews = data.required_pull_request_reviews?.required_approving_review_count;
    if (minReviews > 0 && (reviews === undefined || reviews < minReviews)) {
      const res = await this.api(cwd, 'PATCH', `${base}/required_pull_request_reviews`, {
        required_approving_review_count: minReviews,
      });
      if (res.status < 200 || res.status >= 300) {
        return {
          status: 'failed',
          changes,
          message: `could not raise required approving reviews to ${minReviews}: ${res.message}`,
        };
      }
      changes.push(`raised required approving reviews from ${reviews ?? 'none'} to ${minReviews}`);
    }
    // DevAudit-Installer#1116 WP2: a project that set `release_branch_required_reviews` wants the branch
    // at exactly that count. Lowering weakens protection, so it needs an explicit yes from a person.
    let reviewsNotLowered: { current: number; configured: number } | undefined;
    if (exactReviews !== undefined && reviews !== undefined && reviews > exactReviews) {
      const confirmed = options?.confirmLower ? await options.confirmLower({ branch, from: reviews, to: exactReviews }) : false;
      if (confirmed) {
        const res = await this.api(cwd, 'PATCH', `${base}/required_pull_request_reviews`, {
          required_approving_review_count: exactReviews,
        });
        if (res.status < 200 || res.status >= 300) {
          return {
            status: 'failed',
            changes,
            message: `could not lower required approving reviews to ${exactReviews}: ${res.message}`,
          };
        }
        changes.push(`lowered required approving reviews from ${reviews} to ${exactReviews} (confirmed)`);
      } else {
        reviewsNotLowered = { current: reviews, configured: exactReviews };
      }
    }
    return {
      status: changes.length > 0 ? 'updated' : 'ok',
      ...(changes.length > 0 ? { changes } : {}),
      ...(reviewsNotLowered ? { reviewsNotLowered } : {}),
    };
  }

  /**
   * One GitHub REST call through `gh api` (preferred) or fetch. Never throws:
   * `status` is the HTTP status (0 when no transport is available) and
   * `message` the API's error message. A GET is sent without `-X` so a
   * read-only `gh` wrapper (the release-validation stub) lets it through.
   */
  private async api(
    cwd: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data?: unknown; message: string }> {
    if (this.preferGhCli && (await ghAvailable())) {
      const args = method === 'GET' ? ['api', path] : ['api', '-X', method, path, '--input', '-'];
      const res = await execa('gh', args, {
        cwd,
        reject: false,
        ...(body !== undefined ? { input: JSON.stringify(body) } : {}),
      });
      let data: unknown;
      try {
        data = res.stdout ? (JSON.parse(res.stdout) as unknown) : undefined;
      } catch {
        data = undefined;
      }
      if (res.exitCode === 0) return { status: 200, data, message: '' };
      const status = Number(/HTTP (\d{3})/.exec(res.stderr)?.[1] ?? 0);
      const apiMessage = (data as { message?: string } | undefined)?.message;
      return { status, data, message: apiMessage ?? (res.stderr.split('\n')[0] || 'gh api call failed') };
    }
    if (!this.token) return { status: 0, message: 'No `gh` CLI and no GH_TOKEN' };
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: { ...this.authHeaders(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let data: unknown;
    try {
      data = (await res.json()) as unknown;
    } catch {
      data = undefined;
    }
    const apiMessage = (data as { message?: string } | undefined)?.message;
    return { status: res.status, data, message: res.ok ? '' : (apiMessage ?? `HTTP ${res.status}`) };
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
