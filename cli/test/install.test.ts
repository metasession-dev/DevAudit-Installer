import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const BASE_URL = 'https://devaudit.test';

interface ExecaCall {
  readonly file: string;
  readonly args: readonly string[];
}

const execaCalls: ExecaCall[] = [];

interface ProviderCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

const providerCalls: ProviderCall[] = [];

function makeFakeProvider() {
  return {
    name: 'github' as const,
    async getRepoMeta(_cwd: string) {
      providerCalls.push({ method: 'getRepoMeta', args: [] });
      return { owner: 'metasession-dev', name: 'fixture-app', defaultBranch: 'main' };
    },
    async setSecret(_cwd: string, name: string, value: string) {
      providerCalls.push({ method: 'setSecret', args: [name, value.length] });
    },
    async setVariable(_cwd: string, name: string, value: string) {
      providerCalls.push({ method: 'setVariable', args: [name, value] });
    },
    async hasSecret(_cwd: string, name: string) {
      providerCalls.push({ method: 'hasSecret', args: [name] });
      return false;
    },
    async setDefaultBranch(_cwd: string, branch: string) {
      providerCalls.push({ method: 'setDefaultBranch', args: [branch] });
      return { changed: true };
    },
    async applyBranchProtection(_cwd: string, branch: string, checks: readonly string[]) {
      providerCalls.push({ method: 'applyBranchProtection', args: [branch, [...checks]] });
      return { applied: true };
    },
    async createPullRequest() {
      providerCalls.push({ method: 'createPullRequest', args: [] });
      return { url: 'https://github.com/metasession-dev/fixture-app/pull/1' };
    },
  };
}

vi.mock('execa', () => ({
  execa: async (file: string, args: readonly string[] = [], opts: { cwd?: string } = {}) => {
    execaCalls.push({ file, args });
    if (file === 'which' || file === 'where') {
      return { exitCode: 0, stdout: `/usr/bin/${args[0]}`, stderr: '' };
    }
    if (file === 'gh' && args[0] === 'repo' && args[1] === 'view') {
      return { exitCode: 0, stdout: 'metasession-dev/fixture-app', stderr: '' };
    }
    if (file === 'gh' && args[0] === 'api') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (file === 'gh') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (file === 'pre-commit' || file === 'npx' || file === 'npm') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    // resolveRepoRoot() calls `git rev-parse --show-toplevel` — real git is
    // never actually invoked in this test file (see the fs-fixture-based
    // `.git-root-marker` helper below), so walk up from opts.cwd looking for
    // that marker, mirroring what a real git top-level lookup would resolve.
    if (file === 'git' && args[0] === 'rev-parse' && args.includes('--show-toplevel')) {
      const nodeFs = await import('node:fs');
      const path = await import('node:path');
      let dir = opts.cwd ?? process.cwd();
      for (;;) {
        if (nodeFs.existsSync(path.join(dir, '.git-root-marker'))) {
          return { exitCode: 0, stdout: dir, stderr: '' };
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return { exitCode: 128, stdout: '', stderr: 'not a git repository' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  },
}));

const handlers = [
  http.get(`${BASE_URL}/api/projects`, () => HttpResponse.json([])),
  http.post(`${BASE_URL}/api/projects`, async ({ request }) => {
    const body = (await request.json()) as { slug: string; name: string };
    return HttpResponse.json({ id: '11111111-aaaa-bbbb-cccc-222222222222', slug: body.slug, name: body.name }, { status: 201 });
  }),
  http.get(`${BASE_URL}/api/projects/:id/api-keys`, () => HttpResponse.json([])),
  http.post(`${BASE_URL}/api/projects/:id/api-keys`, () =>
    HttpResponse.json({ id: 'key-1', name: 'Onboarding-issued', plainTextKey: 'dak_test_plain' }, { status: 201 }),
  ),
];

const server = setupServer(...handlers);

async function buildNodeFixture(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-install-fixture-'));
  await fs.writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'fixture-app',
      version: '0.0.0',
      private: true,
      devDependencies: {
        husky: '*',
        '@commitlint/cli': '*',
        '@commitlint/config-conventional': '*',
        'lint-staged': '*',
        prettier: '*',
        eslint: '*',
        typescript: '*',
        '@playwright/test': '*',
      },
    }),
  );
  await fs.mkdir(join(dir, '.husky'), { recursive: true });
  await fs.mkdir(join(dir, 'scripts'), { recursive: true });
  await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  return dir;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
  process.env['DEVAUDIT_USER_TOKEN'] = 'mctok_test_fixture';
  process.env['DEVAUDIT_BASE_URL'] = BASE_URL;
});

afterAll(() => {
  server.close();
  delete process.env['DEVAUDIT_USER_TOKEN'];
  delete process.env['DEVAUDIT_BASE_URL'];
});

afterEach(() => {
  execaCalls.length = 0;
  providerCalls.length = 0;
  server.resetHandlers(...handlers);
});

describe('runInstall — native TS install against a node fixture', () => {
  it('dry-run produces a plan without mutating disk or calling execa', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    try {
      const report = await runInstall({
        path: dir,
        dryRun: true,
        nonInteractive: true,
        provider: makeFakeProvider(),
      });
      expect(report.dryRun).toBe(true);
      expect(report.steps.find((s) => s.step.startsWith('4/'))?.status).toBe('planned');
      expect(report.steps.find((s) => s.step.startsWith('5/'))?.status).toBe('planned');
      expect(report.steps.find((s) => s.step.startsWith('7/'))?.status).toBe('planned');
      // No write of sdlc-config.json in dry run
      await expect(fs.stat(join(dir, 'sdlc-config.json'))).rejects.toThrow();
      // dry-run never invokes provider mutating methods
      const mutating = providerCalls.filter((c) => c.method !== 'getRepoMeta');
      expect(mutating).toHaveLength(0);
      // and never invokes mutating execa commands
      const mutatingExeca = execaCalls.filter(
        (c) => c.file === 'pre-commit' || c.file === 'npx',
      );
      expect(mutatingExeca).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('full run writes sdlc-config.json, creates project, issues key, sets secrets, syncs', async () => {
    const { runInstall } = await import('../src/install/index.js');
    // --yes path requires an existing sdlc-config.json
    const dir = await buildNodeFixture();
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20' }),
    );
    try {
      const report = await runInstall({
        path: dir,
        dryRun: false,
        nonInteractive: true,
        provider: makeFakeProvider(),
      });
      expect(report.dryRun).toBe(false);
      const stepByStart = (s: string) => report.steps.find((x) => x.step.startsWith(s));
      expect(stepByStart('1/')?.status).toBe('ok');
      expect(stepByStart('2/')?.status).toBe('ok');
      expect(stepByStart('4/')?.status).toBe('ok');
      expect(stepByStart('5/')?.status).toBe('ok');
      expect(stepByStart('6/')?.status).toBe('ok');
      expect(stepByStart('7/')?.status).toBe('ok');
      expect(stepByStart('8/')?.status).toBe('ok');
      expect(stepByStart('9/')?.status).toBe('ok');
      expect(stepByStart('10/')?.status).toBe('ok');
      // v0.1.36: governance-doc auto-seed removed from the default
      // install flow. compliance/governance/ should NOT exist after a
      // fresh install — operators run `devaudit bootstrap-governance`
      // explicitly when they want the starter templates on disk.
      const govDirExists = await fs
        .stat(join(dir, 'compliance', 'governance'))
        .then(() => true)
        .catch(() => false);
      expect(govDirExists).toBe(false);
      // sdlc-config.json was rewritten by step 4
      const written = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      expect(written.stack).toBe('node');
      expect(written.project_slug).toBe('fixture-app');
      // develop-first branch defaults (DevAudit-Installer#70)
      expect(written.integration_branch).toBe('develop');
      expect(written.release_branch).toBe('main');
      // new scaffolds default to the portal-configurable runner (DevAudit-Installer#664/#803),
      // not a literal 'ubuntu-latest' that would bypass CI_RUNNER_LABEL
      expect(written.runner).toBe('self-hosted');
      // provider was called for secrets + variable
      const secretCalls = providerCalls.filter((c) => c.method === 'setSecret');
      const secretNames = secretCalls.map((c) => c.args[0]);
      expect(secretNames).toContain('DEVAUDIT_API_KEY');
      expect(secretNames).toContain('DEVAUDIT_USER_TOKEN');
      const variableCall = providerCalls.find((c) => c.method === 'setVariable');
      expect(variableCall?.args[0]).toBe('DEVAUDIT_BASE_URL');
      // default branch set via provider (devaudit#731), before branch
      // protection is configured
      const defaultBranchCall = providerCalls.find((c) => c.method === 'setDefaultBranch');
      expect(defaultBranchCall?.args[0]).toBe('develop');
      const bpFirstIdx = providerCalls.findIndex((c) => c.method === 'applyBranchProtection');
      const dbIdx = providerCalls.findIndex((c) => c.method === 'setDefaultBranch');
      expect(dbIdx).toBeGreaterThanOrEqual(0);
      expect(dbIdx).toBeLessThan(bpFirstIdx);
      // branch protection applied via provider
      expect(providerCalls.find((c) => c.method === 'applyBranchProtection')).toBeDefined();
      // DevAudit-Installer#264/#432: only emitted unconditional check
      // contexts should be required. CI Status Fallback emits the Quality
      // Gates job name; it must not be required as its own context.
      const bpCalls = providerCalls.filter((c) => c.method === 'applyBranchProtection');
      for (const call of bpCalls) {
        const branch = call.args[0] as string;
        const checks = call.args[1] as readonly string[];
        expect(checks).not.toContain('Compliance Validation');
        expect(checks).not.toContain('DevAudit Release Approval');
        expect(checks).toEqual(['Quality Gates']);
        expect(checks).not.toContain('CI Status Fallback');
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  // devaudit#731 regression: branch protection must key off the config's own
  // release_branch, not the GitHub-reported default branch. Before this fix,
  // once a repo's actual default branch was 'develop' (as it now can be,
  // via the new default-branch step), applyBranchProtection would apply the
  // strict main-only rule to 'develop' and skip protecting 'main' entirely
  // (the integrationBranch !== meta.defaultBranch guard would go false).
  it('branch protection uses release_branch from config, not the reported default branch', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({
        project_slug: 'fixture-app',
        stack: 'node',
        host: 'railway',
        node_version: '20',
        integration_branch: 'develop',
        release_branch: 'main',
      }),
    );
    const provider = {
      ...makeFakeProvider(),
      async getRepoMeta(_cwd: string) {
        providerCalls.push({ method: 'getRepoMeta', args: [] });
        // Simulates a repo where GitHub's default branch is already
        // 'develop' (e.g. the new default-branch step already ran).
        return { owner: 'metasession-dev', name: 'fixture-app', defaultBranch: 'develop' };
      },
    };
    try {
      await runInstall({ path: dir, nonInteractive: true, provider });
      const bpCalls = providerCalls.filter((c) => c.method === 'applyBranchProtection');
      const branches = bpCalls.map((c) => c.args[0]);
      // Both branches protected — main with the strict 1-review rule, develop
      // with the lighter 0-review rule — regardless of which one GitHub
      // reports as the default.
      expect(branches).toContain('main');
      expect(branches).toContain('develop');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('preserves rich sdlc-config fields when re-running --yes on an existing consumer', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    // Seed a richly customized config — mirrors WGB's shape (runner: self-hosted,
    // sast_baseline > 0, mongodb db service, custom build_env, custom prod-url secret)
    const seeded = {
      project_slug: 'fixture-app',
      stack: 'node',
      host: 'railway',
      node_version: 20,
      working_directory: '.',
      source_dirs: 'app/ lib/ services/',
      production_url_secret: 'CUSTOM_PROD_URL',
      runner: 'self-hosted',
      sast_baseline: 6,
      accepted_dep_risks: 'xlsx',
      database_service: 'mongodb',
      database_image: 'mongo:7',
      database_port: '27017',
      database_env: { MONGODB_DB_NAME: 'fixture_test' },
      app_env: { CUSTOM_APP_FLAG: 'on' },
      build_env: { CUSTOM_BUILD_FLAG: 'true' },
      e2e_project: 'chromium',
      e2e_start_command: 'npm run dev',
      paths_ignore: ['SDLC/**', 'compliance/**', 'custom/**'],
      devaudit: { base_url: BASE_URL, project_slug: 'fixture-app', api_key_secret: 'DEVAUDIT_API_KEY' },
      uat: { enabled: true, url: 'https://uat.example.com', required_risk_classes: ['payment'] },
      custom_field: { lives_here: true },
    };
    await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(seeded));
    try {
      await runInstall({
        path: dir,
        dryRun: false,
        nonInteractive: true,
        provider: makeFakeProvider(),
      });
      const after = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      // Wizard-owned fields still come from the plan
      expect(after.project_slug).toBe('fixture-app');
      expect(after.stack).toBe('node');
      expect(after.host).toBe('railway');
      // Customizations preserved
      expect(after.runner).toBe('self-hosted');
      expect(after.sast_baseline).toBe(6);
      expect(after.accepted_dep_risks).toBe('xlsx');
      expect(after.database_service).toBe('mongodb');
      expect(after.database_image).toBe('mongo:7');
      expect(after.database_env.MONGODB_DB_NAME).toBe('fixture_test');
      expect(after.app_env.CUSTOM_APP_FLAG).toBe('on');
      expect(after.build_env.CUSTOM_BUILD_FLAG).toBe('true');
      expect(after.e2e_project).toBe('chromium');
      expect(after.e2e_start_command).toBe('npm run dev');
      expect(after.paths_ignore).toContain('custom/**');
      expect(after.uat.enabled).toBe(true);
      expect(after.uat.url).toBe('https://uat.example.com');
      expect(after.production_url_secret).toBe('CUSTOM_PROD_URL');
      // Unknown / future fields the wizard doesn't know about are preserved too
      expect(after.custom_field).toEqual({ lives_here: true });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('throws when no package.json or pyproject.toml is found', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await fs.mkdtemp(join(tmpdir(), 'cli-install-empty-'));
    try {
      await expect(runInstall({ path: dir, nonInteractive: true })).rejects.toThrow(/Could not detect stack/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('throws when DevAudit rejects the PAT (HTTP 401)', async () => {
    server.use(http.get(`${BASE_URL}/api/projects`, () => new HttpResponse(null, { status: 401 })));
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20' }),
    );
    try {
      await expect(
        runInstall({ path: dir, nonInteractive: true, provider: makeFakeProvider() }),
      ).rejects.toThrow(/PAT rejected/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  // Helper for the developer-mode tests below: a provider whose hasSecret
  // returns true (the fixture's "DEVAUDIT_USER_TOKEN is already wired up"
  // bit of the four-bit dev-mode detection).
  function makeOnboardedProvider() {
    const fp = makeFakeProvider();
    return {
      ...fp,
      async hasSecret(_cwd: string, name: string) {
        providerCalls.push({ method: 'hasSecret', args: [name] });
        return true;
      },
    };
  }
  // Seeds an MSW state where the project + 'Onboarding-issued' key already
  // exist on the portal — the other two bits of dev-mode detection.
  function seedOnboardedPortal(): void {
    server.use(
      http.get(`${BASE_URL}/api/projects`, () =>
        HttpResponse.json([{ id: 'existing-id', slug: 'fixture-app', name: 'fixture-app' }]),
      ),
      http.get(`${BASE_URL}/api/projects/:id/api-keys`, () =>
        HttpResponse.json([{ id: 'key-x', name: 'Onboarding-issued', revoked_at: null }]),
      ),
    );
  }

  it('developer mode: skips steps 4, 6, 7, 9, 10 when all four detection bits are true', async () => {
    seedOnboardedPortal();
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20' }),
    );
    try {
      const report = await runInstall({
        path: dir,
        nonInteractive: true,
        provider: makeOnboardedProvider(),
      });
      const step4 = report.steps.find((s) => s.step.startsWith('4/'));
      const step6 = report.steps.find((s) => s.step.startsWith('6/'));
      const step7 = report.steps.find((s) => s.step.startsWith('7/'));
      const step9 = report.steps.find((s) => s.step.startsWith('9/'));
      const step10 = report.steps.find((s) => s.step.startsWith('10/'));
      expect(step4?.status).toBe('skipped');
      expect(step6?.status).toBe('skipped');
      expect(step7?.status).toBe('skipped');
      expect(step9?.status).toBe('skipped');
      expect(step10?.status).toBe('skipped');
      expect(step7?.message).toMatch(/developer mode/);
      expect(step9?.message).toMatch(/developer mode/);
      expect(step9?.step).toMatch(/Set default branch/);
      expect(step10?.message).toMatch(/developer mode/);
      expect(step10?.step).toMatch(/Configure branch protection/);
      // The provider's mutating methods were never called.
      expect(providerCalls.find((c) => c.method === 'setSecret')).toBeUndefined();
      expect(providerCalls.find((c) => c.method === 'setVariable')).toBeUndefined();
      expect(providerCalls.find((c) => c.method === 'setDefaultBranch')).toBeUndefined();
      expect(providerCalls.find((c) => c.method === 'applyBranchProtection')).toBeUndefined();
      // The done report carries the developer-mode marker.
      const stepDone = report.steps.find((s) => s.step.includes('Done'));
      expect(stepDone?.step).toMatch(/developer mode/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('developer mode falls back to operator when DEVAUDIT_USER_TOKEN secret is missing on the repo', async () => {
    seedOnboardedPortal();
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20' }),
    );
    try {
      // hasSecret returns false by default in makeFakeProvider — proves bit-4
      // is required to trip dev-mode (the safe default that matches today's
      // behaviour when the repo isn't fully wired up yet).
      const report = await runInstall({
        path: dir,
        nonInteractive: true,
        provider: makeFakeProvider(),
      });
      // Operator path: secrets + branch protection actually called.
      expect(providerCalls.find((c) => c.method === 'setSecret')).toBeDefined();
      expect(providerCalls.find((c) => c.method === 'applyBranchProtection')).toBeDefined();
      const step7 = report.steps.find((s) => s.step.startsWith('7/'));
      expect(step7?.status).toBe('ok');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('--force-team-config: pins back to operator mode even when all dev-mode bits are true', async () => {
    seedOnboardedPortal();
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20' }),
    );
    try {
      const report = await runInstall({
        path: dir,
        nonInteractive: true,
        provider: makeOnboardedProvider(),
        forceTeamConfig: true,
      });
      // Destructive steps did run.
      expect(providerCalls.find((c) => c.method === 'setSecret')).toBeDefined();
      expect(providerCalls.find((c) => c.method === 'applyBranchProtection')).toBeDefined();
      const step7 = report.steps.find((s) => s.step.startsWith('7/'));
      expect(step7?.status).toBe('ok');
      const stepDone = report.steps.find((s) => s.step.includes('Done'));
      // Operator copy ('Done', not 'Done (developer mode)').
      expect(stepDone?.step).toBe('12/12 Done');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('mode: developer (pinned, the join code path): routes to developer mode without checking detection bits', async () => {
    // Here the portal returns an empty project list (no existing project) but
    // we pin mode=developer; the destructive steps should still skip. This
    // proves `devaudit join` works as the explicit second-dev entry point.
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20' }),
    );
    try {
      const report = await runInstall({
        path: dir,
        nonInteractive: true,
        provider: makeFakeProvider(),
        mode: 'developer',
      });
      expect(report.steps.find((s) => s.step.startsWith('7/'))?.status).toBe('skipped');
      expect(report.steps.find((s) => s.step.startsWith('9/'))?.status).toBe('skipped');
      expect(providerCalls.find((c) => c.method === 'setSecret')).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('warns and skips API key issuance if Onboarding-issued already exists', async () => {
    server.use(
      http.get(`${BASE_URL}/api/projects`, () =>
        HttpResponse.json([{ id: 'existing-id', slug: 'fixture-app', name: 'fixture-app' }]),
      ),
      http.get(`${BASE_URL}/api/projects/:id/api-keys`, () =>
        HttpResponse.json([{ id: 'key-x', name: 'Onboarding-issued', revoked_at: null }]),
      ),
    );
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildNodeFixture();
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20' }),
    );
    try {
      const report = await runInstall({
        path: dir,
        nonInteractive: true,
        provider: makeFakeProvider(),
      });
      const step6 = report.steps.find((s) => s.step.startsWith('6/'));
      expect(step6?.status).toBe('warn');
      expect(step6?.message).toMatch(/already exists/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  // --add-target (#689/#691): a polyglot-monorepo repo with an already-onboarded
  // Node target at the root and a not-yet-onboarded Python target nested under
  // api/. detectStack finds the nested pyproject.toml before the root
  // package.json, so pointing install at the repo root without any extra flag
  // naturally resolves to the *other* target.
  async function buildPolyglotFixture(): Promise<string> {
    const dir = await buildNodeFixture();
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture-app', stack: 'node', host: 'railway', node_version: '20', working_directory: '.' }),
    );
    await fs.mkdir(join(dir, 'api'), { recursive: true });
    await fs.writeFile(join(dir, 'api', 'pyproject.toml'), '[project]\nname = "fixture-api"\n');
    return dir;
  }

  it('refuses to overwrite when the repo already configures a different target and --add-target is not passed', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildPolyglotFixture();
    try {
      const report = await runInstall({
        path: dir,
        nonInteractive: true,
        provider: makeFakeProvider(),
      });
      const step4 = report.steps.find((s) => s.step.startsWith('4/'));
      expect(step4?.status).toBe('fail');
      expect(step4?.message).toMatch(/--add-target/);
      // The original single-target config is untouched.
      const after = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      expect(after.project_slug).toBe('fixture-app');
      expect(after.targets).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('--add-target appends a new target instead of overwriting the existing one', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildPolyglotFixture();
    try {
      const report = await runInstall({
        path: dir,
        nonInteractive: true,
        addTarget: true,
        provider: makeFakeProvider(),
      });
      const step4 = report.steps.find((s) => s.step.startsWith('4/'));
      expect(step4?.status).toBe('ok');
      const after = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      expect(Array.isArray(after.targets)).toBe(true);
      const names = (after.targets as Array<{ name: string }>).map((t) => t.name);
      // The legacy flat config synthesizes as the 'default' target (per
      // resolveTargets, #690); the newly-appended one is the auto-derived 'api'.
      expect(names).toContain('default');
      expect(names).toContain('api');
      const apiTarget = (after.targets as Array<{ name: string; stack?: string; working_directory?: string }>).find(
        (t) => t.name === 'api',
      );
      expect(apiTarget?.stack).toBe('python');
      expect(apiTarget?.working_directory).toBe('api');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('--add-target refuses when a target with the same name already exists', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildPolyglotFixture();
    // Pre-seed a `targets` array that already claims the name the new
    // (auto-derived) target would use ('api').
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({
        project_slug: 'fixture-app',
        targets: [
          { name: 'fixture-app', stack: 'node', working_directory: '.' },
          { name: 'api', stack: 'python', working_directory: 'other-dir' },
        ],
      }),
    );
    try {
      const report = await runInstall({
        path: dir,
        nonInteractive: true,
        addTarget: true,
        provider: makeFakeProvider(),
      });
      const step4 = report.steps.find((s) => s.step.startsWith('4/'));
      expect(step4?.status).toBe('fail');
      expect(step4?.message).toMatch(/already exists/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  // api_key_secret collision safety (#689/#694): GitHub repo secrets are
  // repo-scoped, not per-directory. A second target must not silently reuse
  // (and overwrite) the first target's secret name.
  it('--add-target derives a distinct api_key_secret name instead of reusing the existing target\'s', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildPolyglotFixture();
    try {
      const report = await runInstall({
        path: dir,
        nonInteractive: true,
        addTarget: true,
        provider: makeFakeProvider(),
      });
      const step4 = report.steps.find((s) => s.step.startsWith('4/'));
      expect(step4?.status).toBe('ok');
      const after = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      const apiTarget = (
        after.targets as Array<{ name: string; devaudit?: { api_key_secret?: string } }>
      ).find((t) => t.name === 'api');
      // The root/default target has no devaudit.api_key_secret in this
      // fixture, so the derived name is collision-free by construction —
      // the real assertion is that it's target-specific, not the literal
      // 'DEVAUDIT_API_KEY' the first (default) target would use.
      expect(apiTarget?.devaudit?.api_key_secret).toBeTruthy();
      expect(apiTarget?.devaudit?.api_key_secret).not.toBe('DEVAUDIT_API_KEY');
      // The secret actually pushed to GitHub for this run uses that same name.
      const secretCalls = providerCalls.filter((c) => c.method === 'setSecret');
      const secretNames = secretCalls.map((c) => c.args[0]);
      expect(secretNames).toContain(apiTarget?.devaudit?.api_key_secret);
      expect(secretNames).not.toContain('DEVAUDIT_API_KEY');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('--add-target disambiguates when the derived api_key_secret name is already claimed', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildPolyglotFixture();
    // Pre-seed a targets array where the *other* target already claims the
    // name the new 'api' target would naturally derive ('API_API_KEY').
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({
        project_slug: 'fixture-app',
        targets: [
          {
            name: 'fixture-app',
            stack: 'node',
            working_directory: '.',
            devaudit: { project_slug: 'fixture-app', api_key_secret: 'API_API_KEY' },
          },
        ],
      }),
    );
    try {
      const report = await runInstall({
        path: dir,
        nonInteractive: true,
        addTarget: true,
        provider: makeFakeProvider(),
      });
      const step4 = report.steps.find((s) => s.step.startsWith('4/'));
      expect(step4?.status).toBe('ok');
      const after = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      const apiTarget = (
        after.targets as Array<{ name: string; devaudit?: { api_key_secret?: string } }>
      ).find((t) => t.name === 'api');
      expect(apiTarget?.devaudit?.api_key_secret).not.toBe('API_API_KEY');
      expect(apiTarget?.devaudit?.api_key_secret).toBeTruthy();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  // Branch protection multi-target namespacing (#689/#696): once a repo has
  // two targets, each target's required check must be individually applied
  // (and, per #695, unioned rather than overwritten) so branch protection
  // actually matches what each target's namespaced CI workflow reports.
  it('--add-target applies namespaced branch-protection checks for every target', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const dir = await buildPolyglotFixture();
    try {
      const report = await runInstall({
        path: dir,
        nonInteractive: true,
        addTarget: true,
        provider: makeFakeProvider(),
      });
      const step10 = report.steps.find((s) => s.step.startsWith('10/'));
      expect(step10?.status).toBe('ok');
      const bpCalls = providerCalls.filter((c) => c.method === 'applyBranchProtection');
      const mainCallsChecks = bpCalls
        .filter((c) => c.args[0] === 'main')
        .map((c) => c.args[1] as readonly string[]);
      expect(mainCallsChecks).toContainEqual(['Quality Gates (default)']);
      expect(mainCallsChecks).toContainEqual(['Quality Gates (api)']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  // Repo-root discovery (#689 follow-up): a git repo where the first
  // target's install ran from *its own* subdirectory (not the repo root),
  // and --add-target for the second target is invoked from a *different*
  // subdirectory. Neither ever pointed `path` at the repo root itself — this
  // is what `--add-target` looked like in the real ThorStack onboarding that
  // surfaced the bug: `sdlc-config.json` must be found (and appended to) at
  // the git repo root regardless of which target directory install runs
  // from, not just when someone happens to invoke it from the root.
  //
  // execa is mocked file-wide (see vi.mock('execa', ...) above) so git is
  // never really invoked here; `.git-root-marker` stands in for a real
  // `.git/` for the mock's `rev-parse --show-toplevel` walk-up.
  it('--add-target finds and appends to the repo-root config when invoked from a different subdirectory than the first target', async () => {
    const { runInstall } = await import('../src/install/index.js');
    const repoDir = await fs.mkdtemp(join(tmpdir(), 'cli-install-multirepo-'));
    try {
      await fs.writeFile(join(repoDir, '.git-root-marker'), '');

      const serviceA = join(repoDir, 'service-a');
      await fs.mkdir(join(serviceA, '.husky'), { recursive: true });
      await fs.mkdir(join(serviceA, 'scripts'), { recursive: true });
      await fs.writeFile(
        join(serviceA, 'package.json'),
        JSON.stringify({ name: 'service-a', version: '0.0.0', private: true }),
      );

      const serviceB = join(repoDir, 'service-b');
      await fs.mkdir(serviceB, { recursive: true });
      await fs.writeFile(join(serviceB, 'pyproject.toml'), '[project]\nname = "service-b"\n');

      // --yes/nonInteractive requires an existing sdlc-config.json to plan
      // from, even for the very first target — seed it at the repo root,
      // matching the working_directory detectStack will resolve for
      // service-a so writeSdlcConfig treats this as the *same* target
      // (a rotation) rather than a second, unconfigured one.
      await fs.writeFile(
        join(repoDir, 'sdlc-config.json'),
        JSON.stringify({
          project_slug: 'service-a',
          stack: 'node',
          host: 'railway',
          node_version: '20',
          working_directory: 'service-a',
        }),
      );

      const firstReport = await runInstall({
        path: serviceA,
        nonInteractive: true,
        provider: makeFakeProvider(),
      });
      const firstStep4 = firstReport.steps.find((s) => s.step.startsWith('4/'));
      expect(firstStep4?.status).toBe('ok');
      // Written at the repo root, not inside service-a/.
      const rootConfigAfterFirst = JSON.parse(
        await fs.readFile(join(repoDir, 'sdlc-config.json'), 'utf-8'),
      );
      expect(rootConfigAfterFirst.project_slug).toBe('service-a');
      await expect(fs.stat(join(serviceA, 'sdlc-config.json'))).rejects.toThrow();

      const secondReport = await runInstall({
        path: serviceB,
        nonInteractive: true,
        addTarget: true,
        provider: makeFakeProvider(),
      });
      const secondStep4 = secondReport.steps.find((s) => s.step.startsWith('4/'));
      expect(secondStep4?.status).toBe('ok');

      const rootConfigAfterSecond = JSON.parse(
        await fs.readFile(join(repoDir, 'sdlc-config.json'), 'utf-8'),
      );
      const names = (rootConfigAfterSecond.targets as Array<{ name: string; working_directory?: string }>).map(
        (t) => t.name,
      );
      // The legacy flat config (service-a, seeded with no `targets` array)
      // synthesizes as the 'default' target per resolveTargets (#690).
      expect(names).toContain('default');
      expect(names).toContain('service-b');
      const serviceBTarget = (
        rootConfigAfterSecond.targets as Array<{ name: string; working_directory?: string }>
      ).find((t) => t.name === 'service-b');
      expect(serviceBTarget?.working_directory).toBe('service-b');
      // Still only one config file, at the repo root — not a second one
      // inside service-b/.
      await expect(fs.stat(join(serviceB, 'sdlc-config.json'))).rejects.toThrow();
    } finally {
      await fs.rm(repoDir, { recursive: true, force: true });
    }
  }, 60_000);
});
