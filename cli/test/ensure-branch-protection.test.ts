import { describe, it, expect, afterEach, vi } from 'vitest';

// devaudit-installer#990 — `update` must not reset branch protection a
// maintainer configured: add missing required checks, raise a review count
// below DevAudit's minimum, keep everything else, leave ruleset-protected
// branches alone, and report plan-unavailable protection without writing.

interface Call {
  readonly args: readonly string[];
  readonly input?: string;
}
type Reply = { exitCode: number; stdout?: string; stderr?: string };

const calls: Call[] = [];
let routes: Record<string, Reply> = {};

const ok = (body: unknown): Reply => ({ exitCode: 0, stdout: JSON.stringify(body) });
const httpErr = (status: number, message: string): Reply => ({
  exitCode: 1,
  stdout: JSON.stringify({ message, status: String(status) }),
  stderr: `gh: ${message} (HTTP ${status})`,
});
const UPGRADE = 'Upgrade to GitHub Pro or make this repository public to enable this feature.';

vi.mock('execa', () => ({
  execa: async (file: string, args: readonly string[] = [], opts: { input?: string } = {}) => {
    if (file === 'gh' && args[0] === '--version') return { exitCode: 0, stdout: 'gh version 2.0.0', stderr: '' };
    if (file === 'gh' && args[0] === 'repo' && args[1] === 'view') {
      return { exitCode: 0, stdout: JSON.stringify({ owner: 'o', name: 'r', defaultBranch: 'develop' }), stderr: '' };
    }
    if (file === 'gh' && args[0] === 'api') {
      calls.push({ args, ...(opts.input !== undefined ? { input: opts.input } : {}) });
      const method = args[1] === '-X' ? (args[2] ?? 'GET') : 'GET';
      const path = args[1] === '-X' ? args[3] : args[1];
      const reply = routes[`${method} ${path}`] ?? httpErr(404, 'Not Found');
      return { stdout: '', stderr: '', ...reply };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  },
}));

const P = '/repos/o/r/branches/main/protection';
const RULES = '/repos/o/r/rules/branches/main';
const writes = () => calls.filter((c) => c.args[1] === '-X');

async function provider() {
  const mod = await import('../src/lib/git-provider/github.js');
  mod.resetGhAvailabilityCache();
  return new mod.GitHubProvider();
}

afterEach(() => {
  calls.length = 0;
  routes = {};
});

describe('GitHubProvider.ensureBranchProtection (#990)', () => {
  it('leaves a compliant, stricter configuration untouched (no writes)', async () => {
    routes = {
      [`GET ${RULES}`]: ok([]),
      [`GET ${P}`]: ok({
        required_status_checks: { strict: true, contexts: ['Quality Gates', 'Other'] },
        required_pull_request_reviews: { required_approving_review_count: 2, require_code_owner_reviews: true },
        enforce_admins: { enabled: false },
      }),
    };
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], { minReviewCount: 1 });
    expect(r.status).toBe('ok');
    expect(writes()).toEqual([]);
  });

  it('adds only the missing check through the contexts sub-resource', async () => {
    routes = {
      [`GET ${RULES}`]: ok([]),
      [`GET ${P}`]: ok({
        required_status_checks: { strict: true, contexts: ['Other'] },
        required_pull_request_reviews: { required_approving_review_count: 3 },
      }),
      [`POST ${P}/required_status_checks/contexts`]: ok(['Other', 'Quality Gates']),
    };
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], { minReviewCount: 1 });
    expect(r.status).toBe('updated');
    expect(r.changes).toEqual(['added required check(s) "Quality Gates"']);
    expect(writes().map((c) => `${c.args[2]} ${c.args[3]}`)).toEqual([`POST ${P}/required_status_checks/contexts`]);
    expect(JSON.parse(writes()[0]?.input ?? '{}')).toEqual({ contexts: ['Quality Gates'] });
    expect(calls.some((c) => c.args.includes('PUT'))).toBe(false);
  });

  it('raises a review count below the minimum with a PATCH that changes nothing else', async () => {
    routes = {
      [`GET ${RULES}`]: ok([]),
      [`GET ${P}`]: ok({
        required_status_checks: { contexts: ['Quality Gates'] },
        required_pull_request_reviews: { required_approving_review_count: 0, require_code_owner_reviews: true },
      }),
      [`PATCH ${P}/required_pull_request_reviews`]: ok({}),
    };
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], { minReviewCount: 1 });
    expect(r.status).toBe('updated');
    expect(r.changes).toEqual(['raised required approving reviews from 0 to 1']);
    expect(JSON.parse(writes()[0]?.input ?? '{}')).toEqual({ required_approving_review_count: 1 });
  });

  it('applies the install defaults only when the branch has no protection', async () => {
    routes = {
      [`GET ${RULES}`]: ok([]),
      [`PUT ${P}`]: ok({}),
    };
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], { minReviewCount: 1 });
    expect(r.status).toBe('created');
    const put = writes().find((c) => c.args[2] === 'PUT');
    expect(JSON.parse(put?.input ?? '{}').required_pull_request_reviews.required_approving_review_count).toBe(1);
  });

  it('does not add classic protection to a ruleset-protected branch and reports missing checks', async () => {
    routes = {
      [`GET ${RULES}`]: ok([
        { type: 'deletion' },
        { type: 'pull_request', parameters: { required_approving_review_count: 1 } },
        { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Build' }] } },
      ]),
    };
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates', 'Build'], { minReviewCount: 1 });
    expect(r.status).toBe('ruleset');
    expect(r.missingChecks).toEqual(['Quality Gates']);
    expect(r.message).toBeUndefined();
    expect(writes()).toEqual([]);
    expect(calls.some((c) => c.args[1] === P)).toBe(false);
  });

  it('flags a ruleset review count below the minimum', async () => {
    routes = {
      [`GET ${RULES}`]: ok([
        { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
        { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Quality Gates' }] } },
      ]),
    };
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], { minReviewCount: 1 });
    expect(r.status).toBe('ruleset');
    expect(r.missingChecks).toEqual([]);
    expect(r.message).toMatch(/0 approving review/);
  });

  it('treats rulesets without check/review rules as no ruleset protection', async () => {
    routes = {
      [`GET ${RULES}`]: ok([{ type: 'deletion' }, { type: 'non_fast_forward' }]),
      [`GET ${P}`]: ok({ required_status_checks: { contexts: ['Quality Gates'] } }),
    };
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates']);
    expect(r.status).toBe('ok');
  });

  it('reports a private repo on GitHub Free as unavailable without writing', async () => {
    routes = { [`GET ${RULES}`]: httpErr(403, UPGRADE) };
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], { minReviewCount: 1 });
    expect(r.status).toBe('unavailable');
    expect(writes()).toEqual([]);
  });

  it('reads with GET calls that carry no -X (read-only wrappers let them through)', async () => {
    routes = { [`GET ${RULES}`]: ok([]), [`GET ${P}`]: ok({ required_status_checks: { contexts: ['Quality Gates'] } }) };
    await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates']);
    expect(calls.map((c) => c.args)).toEqual([
      ['api', RULES],
      ['api', P],
    ]);
  });

  it('reports a failed write instead of throwing', async () => {
    routes = {
      [`GET ${RULES}`]: ok([]),
      [`GET ${P}`]: ok({ required_status_checks: { contexts: [] } }),
      [`POST ${P}/required_status_checks/contexts`]: httpErr(403, 'Resource not accessible by integration'),
    };
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates']);
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/Resource not accessible/);
  });
});

describe('update section 2j summary (#990)', () => {
  it('reports each outcome and warns only when something needs attention', async () => {
    const { promises: fs } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-bp990-'));
    await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'x', stack: 'node' }));
    const outcomes: Record<string, import('../src/lib/git-provider/types.js').EnsureBranchProtectionResult> = {
      main: { status: 'updated', changes: ['added required check(s) "Quality Gates"'] },
      develop: { status: 'ok' },
    };
    const seen: { branch: string; min: number | undefined }[] = [];
    vi.doMock('../src/lib/git-provider/index.js', () => ({
      getGitProvider: async () => ({
        getRepoMeta: async () => ({ owner: 'o', name: 'r', defaultBranch: 'develop' }),
        ensureBranchProtection: async (_c: string, branch: string, _k: readonly string[], o?: { minReviewCount?: number }) => {
          seen.push({ branch, min: o?.minReviewCount });
          return outcomes[branch];
        },
      }),
    }));
    try {
      const { verifyBranchProtection } = await import('../src/update/branch-protection.js');
      const ctx = { installerRoot: '', projectPath: dir, repoRoot: dir, projectName: 'x', stack: 'node', host: 'railway' };
      let r = await verifyBranchProtection(ctx);
      expect(seen).toEqual([{ branch: 'main', min: 1 }, { branch: 'develop', min: 0 }]);
      expect(r.message).toBe('main: added required check(s) "Quality Gates" | develop: ok');
      expect(r.warning).toBeUndefined();

      outcomes['main'] = { status: 'unavailable', message: UPGRADE };
      outcomes['develop'] = { status: 'ruleset', missingChecks: ['Quality Gates'] };
      r = await verifyBranchProtection(ctx);
      expect(r.message).toMatch(/main: branch protection is not available/);
      expect(r.message).toMatch(/develop: protected by rulesets — rulesets do not require "Quality Gates"/);
      expect(r.warning).toBeDefined();
    } finally {
      vi.doUnmock('../src/lib/git-provider/index.js');
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
