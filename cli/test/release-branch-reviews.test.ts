import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PromptDriver } from '../src/lib/prompt.js';
import type { ConfirmLowerReviews, EnsureBranchProtectionResult } from '../src/lib/git-provider/types.js';

// DevAudit-Installer#1116 WP2 — `release_branch_required_reviews`: the project sets the release
// branch's required approving reviews (0, 1 or 2). `install` applies it; `update` keeps the branch at
// it in both directions, but lowering an existing branch needs a person's yes.

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

afterEach(async () => {
  calls.length = 0;
  routes = {};
  (await import('../src/lib/prompt.js')).setPromptTestHooks(null);
});

const protection = (reviews: number | undefined) => ({
  required_status_checks: { contexts: ['Quality Gates'] },
  ...(reviews !== undefined ? { required_pull_request_reviews: { required_approving_review_count: reviews } } : {}),
});
const reviewsRoutes = (reviews: number | undefined) => ({
  [`GET ${RULES}`]: ok([]),
  [`GET ${P}`]: ok(protection(reviews)),
  [`PATCH ${P}/required_pull_request_reviews`]: ok({}),
});

describe('GitHubProvider.ensureBranchProtection with an exact review count', () => {
  it('lowers 1 to 0 only after the confirmation, with a PATCH that changes nothing else', async () => {
    routes = reviewsRoutes(1);
    const asked: { branch: string; from: number; to: number }[] = [];
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], {
      minReviewCount: 0,
      exactReviewCount: 0,
      confirmLower: async (change) => {
        asked.push(change);
        return true;
      },
    });
    expect(asked).toEqual([{ branch: 'main', from: 1, to: 0 }]);
    expect(r.status).toBe('updated');
    expect(r.changes).toEqual(['lowered required approving reviews from 1 to 0 (confirmed)']);
    expect(r.reviewsNotLowered).toBeUndefined();
    expect(writes().map((c) => `${c.args[2]} ${c.args[3]}`)).toEqual([`PATCH ${P}/required_pull_request_reviews`]);
    expect(JSON.parse(writes()[0]?.input ?? '{}')).toEqual({ required_approving_review_count: 0 });
  });

  it('does not lower without a confirmation function (non-interactive): reports the difference, writes nothing', async () => {
    routes = reviewsRoutes(1);
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], { minReviewCount: 0, exactReviewCount: 0 });
    expect(r.status).toBe('ok');
    expect(r.reviewsNotLowered).toEqual({ current: 1, configured: 0 });
    expect(writes()).toEqual([]);
  });

  it('does not lower when the person says no', async () => {
    routes = reviewsRoutes(2);
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], {
      minReviewCount: 1,
      exactReviewCount: 1,
      confirmLower: async () => false,
    });
    expect(r.reviewsNotLowered).toEqual({ current: 2, configured: 1 });
    expect(writes()).toEqual([]);
  });

  it('raises 0 to 1 without asking when 1 is configured', async () => {
    routes = reviewsRoutes(0);
    let asked = false;
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], {
      minReviewCount: 1,
      exactReviewCount: 1,
      confirmLower: async () => {
        asked = true;
        return true;
      },
    });
    expect(asked).toBe(false);
    expect(r.changes).toEqual(['raised required approving reviews from 0 to 1']);
    expect(JSON.parse(writes()[0]?.input ?? '{}')).toEqual({ required_approving_review_count: 1 });
  });

  it('keeps 0 as 0: nothing is raised and nothing is asked', async () => {
    routes = reviewsRoutes(0);
    let asked = false;
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], {
      minReviewCount: 0,
      exactReviewCount: 0,
      confirmLower: async () => {
        asked = true;
        return true;
      },
    });
    expect(asked).toBe(false);
    expect(r.status).toBe('ok');
    expect(writes()).toEqual([]);
  });

  it('without an exact count a higher count stays as the maintainer left it (unchanged behaviour)', async () => {
    routes = reviewsRoutes(2);
    let asked = false;
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], {
      minReviewCount: 1,
      confirmLower: async () => {
        asked = true;
        return true;
      },
    });
    expect(asked).toBe(false);
    expect(r.status).toBe('ok');
    expect(writes()).toEqual([]);
  });

  it('reports a failed lowering instead of throwing', async () => {
    routes = {
      [`GET ${RULES}`]: ok([]),
      [`GET ${P}`]: ok(protection(1)),
      [`PATCH ${P}/required_pull_request_reviews`]: httpErr(403, 'Resource not accessible by integration'),
    };
    const r = await (await provider()).ensureBranchProtection('/x', 'main', ['Quality Gates'], {
      minReviewCount: 0,
      exactReviewCount: 0,
      confirmLower: async () => true,
    });
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/could not lower required approving reviews to 0/);
  });
});

describe('release-branch review count helpers', () => {
  it('uses the configured count when it is 0, 1 or 2 and ignores anything else', async () => {
    const { configuredReleaseReviewCount, releaseReviewCount } = await import('../src/lib/branch-protection-checks.js');
    expect(configuredReleaseReviewCount({ release_branch_required_reviews: 0 })).toBe(0);
    expect(configuredReleaseReviewCount({ release_branch_required_reviews: 2 })).toBe(2);
    for (const bad of [3, -1, 1.5, '1', null, undefined]) {
      expect(configuredReleaseReviewCount({ release_branch_required_reviews: bad })).toBeUndefined();
      expect(releaseReviewCount({ release_branch_required_reviews: bad })).toBe(1);
    }
    expect(releaseReviewCount(null)).toBe(1);
    expect(releaseReviewCount({})).toBe(1);
    expect(releaseReviewCount({ release_branch_required_reviews: 0 })).toBe(0);
  });
});

async function repoWithConfig(cfg: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-reviews-'));
  await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'x', stack: 'node', ...cfg }));
  return dir;
}

describe('install applies the configured review count (step 10)', () => {
  async function run(cfg: Record<string, unknown>, dryRun = false) {
    const dir = await repoWithConfig(cfg);
    const applied: { branch: string; reviews: number | undefined }[] = [];
    const provider = {
      getRepoMeta: async () => ({ owner: 'o', name: 'r', defaultBranch: 'develop' }),
      applyBranchProtection: async (_c: string, branch: string, _k: readonly string[], o?: { requiredReviewCount?: number }) => {
        applied.push({ branch, reviews: o?.requiredReviewCount });
        return { applied: true };
      },
    };
    try {
      const { configureBranchProtection } = await import('../src/install/branch-protection.js');
      const result = await configureBranchProtection(
        { installMode: 'operator', projectPath: dir, repoRoot: dir, dryRun } as never,
        provider as never,
      );
      return { applied, result };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  for (const [configured, expected, label] of [
    [undefined, 1, '1 review'],
    [0, 0, '0 reviews'],
    [1, 1, '1 review'],
    [2, 2, '2 reviews'],
  ] as const) {
    it(`release_branch_required_reviews ${configured === undefined ? 'unset' : configured}: the release branch gets ${expected}`, async () => {
      const { applied, result } = await run(configured === undefined ? {} : { release_branch_required_reviews: configured });
      expect(applied).toEqual([
        { branch: 'main', reviews: expected },
        { branch: 'develop', reviews: 0 },
      ]);
      expect(result.message).toContain(`main: ok (${label})`);
    });
  }

  it('the dry run states the configured count', async () => {
    const { applied, result } = await run({ release_branch_required_reviews: 0 }, true);
    expect(applied).toEqual([]);
    expect(result.status).toBe('planned');
    expect(result.message).toContain('main (0 reviews)');
  });

  it('a value outside 0-2 in a hand-edited config is ignored (default 1)', async () => {
    const { applied } = await run({ release_branch_required_reviews: 7 });
    expect(applied[0]).toEqual({ branch: 'main', reviews: 1 });
  });
});

describe('update section 2k keeps the release branch at the configured count', () => {
  interface Seen {
    branch: string;
    min: number | undefined;
    exact: number | undefined;
    confirm: ConfirmLowerReviews | undefined;
  }

  async function runUpdate(cfg: Record<string, unknown>, outcomes: Record<string, EnsureBranchProtectionResult>) {
    const dir = await repoWithConfig(cfg);
    const seen: Seen[] = [];
    vi.doMock('../src/lib/git-provider/index.js', () => ({
      getGitProvider: async () => ({
        getRepoMeta: async () => ({ owner: 'o', name: 'r', defaultBranch: 'develop' }),
        ensureBranchProtection: async (
          _c: string,
          branch: string,
          _k: readonly string[],
          o?: { minReviewCount?: number; exactReviewCount?: number; confirmLower?: ConfirmLowerReviews },
        ) => {
          seen.push({ branch, min: o?.minReviewCount, exact: o?.exactReviewCount, confirm: o?.confirmLower });
          return outcomes[branch] ?? { status: 'ok' };
        },
      }),
    }));
    // The update module imports the provider and the prompt helper once; load it fresh for this mock.
    vi.resetModules();
    try {
      const { verifyBranchProtection } = await import('../src/update/branch-protection.js');
      const result = await verifyBranchProtection({
        installerRoot: '',
        projectPath: dir,
        repoRoot: dir,
        projectName: 'x',
        stack: 'node',
        host: 'railway',
      });
      return { seen, result };
    } finally {
      vi.doUnmock('../src/lib/git-provider/index.js');
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it('without the key: the minimum stays 1 and no exact count is sent (unchanged behaviour)', async () => {
    const { seen } = await runUpdate({}, {});
    expect(seen.map(({ branch, min, exact }) => ({ branch, min, exact }))).toEqual([
      { branch: 'main', min: 1, exact: undefined },
      { branch: 'develop', min: 0, exact: undefined },
    ]);
    expect(seen[0]?.confirm).toBeUndefined();
  });

  it('with 0: the minimum is 0, the exact count is 0 and a confirmation is supplied', async () => {
    const { seen } = await runUpdate({ release_branch_required_reviews: 0 }, {});
    expect(seen[0]).toMatchObject({ branch: 'main', min: 0, exact: 0 });
    expect(typeof seen[0]?.confirm).toBe('function');
    expect(seen[1]).toMatchObject({ branch: 'develop', min: 0, exact: undefined });
  });

  it('with 2: the exact count is 2 (raised as before)', async () => {
    const { seen } = await runUpdate({ release_branch_required_reviews: 2 }, {});
    expect(seen[0]).toMatchObject({ branch: 'main', min: 2, exact: 2 });
  });

  it('a lowering that was not confirmed is reported with both numbers and raises the warning', async () => {
    const { result } = await runUpdate(
      { release_branch_required_reviews: 0 },
      { main: { status: 'ok', reviewsNotLowered: { current: 1, configured: 0 } } },
    );
    expect(result.message).toContain('main: ok — requires 1 approving review(s) but release_branch_required_reviews is 0; not lowered');
    expect(result.warning).toBeDefined();
  });

  it('a confirmed lowering is reported as a change and raises no warning', async () => {
    const { result } = await runUpdate(
      { release_branch_required_reviews: 0 },
      { main: { status: 'updated', changes: ['lowered required approving reviews from 1 to 0 (confirmed)'] } },
    );
    expect(result.message).toContain('main: lowered required approving reviews from 1 to 0 (confirmed)');
    expect(result.warning).toBeUndefined();
  });

  describe('the confirmation', () => {
    const driverAnswering = (answer: boolean): PromptDriver & { questions: string[] } => {
      const questions: string[] = [];
      return {
        questions,
        confirm: async (message) => {
          questions.push(message);
          return answer;
        },
        text: async () => '',
        select: async () => '',
        isCancel: () => false,
      };
    };
    const tty = { stdinIsTty: true, stdoutIsTty: true, ci: false, json: false };

    async function confirmFn(): Promise<ConfirmLowerReviews> {
      const { seen } = await runUpdate({ release_branch_required_reviews: 0 }, {});
      const fn = seen[0]?.confirm;
      if (!fn) throw new Error('no confirmation supplied');
      return fn;
    }

    const hooks = async () => (await import('../src/lib/prompt.js')).setPromptTestHooks;

    it('without a terminal it declines without asking', async () => {
      const driver = driverAnswering(true);
      const fn = await confirmFn();
      (await hooks())({ driver, env: { ...tty, stdinIsTty: false } });
      expect(await fn({ branch: 'main', from: 1, to: 0 })).toBe(false);
      expect(driver.questions).toEqual([]);
    });

    it('in CI it declines without asking', async () => {
      const driver = driverAnswering(true);
      const fn = await confirmFn();
      (await hooks())({ driver, env: { ...tty, ci: true } });
      expect(await fn({ branch: 'main', from: 1, to: 0 })).toBe(false);
      expect(driver.questions).toEqual([]);
    });

    it('at a terminal it asks, states the recorded control gap for 0, and applies only on yes', async () => {
      const fn = await confirmFn();
      const yes = driverAnswering(true);
      (await hooks())({ driver: yes, env: tty });
      expect(await fn({ branch: 'main', from: 1, to: 0 })).toBe(true);
      expect(yes.questions).toHaveLength(1);
      expect(yes.questions[0]).toContain('from 1 to 0');
      expect(yes.questions[0]).toContain('control gap');
      expect(yes.questions[0]).toContain('SOC 2 CC8.1');

      const no = driverAnswering(false);
      (await hooks())({ driver: no, env: tty });
      expect(await fn({ branch: 'main', from: 1, to: 0 })).toBe(false);
    });
  });
});
