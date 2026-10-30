/**
 * FROZEN REFERENCE for the parity tests of DevAudit-Installer#1116 WP3: the detection code exactly as
 * it was in `cli/src/install/detect-stack.ts`, `cli/src/lib/test-runner-detect.ts` and
 * `cli/src/lib/deploy-detect.ts` before it moved to `@metasession.co/devaudit-core`. Only names and
 * imports changed. Do not edit it to follow the new code: the parity test exists to show the
 * moved code answers exactly as this did. Delete it with the parity test once nothing needs the comparison.
 */
import { promises as fs } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { execa } from 'execa';
import { exists } from '../../src/lib/fs-utils.js';
import type { DetectedStack, InstallContext, StepResult } from '../../src/install/types.js';

// ---- test-runner-detect ----

/**
 * devaudit-installer#1060 — which test runners a repository uses, from the files
 * a runner needs. Shared by `devaudit doctor` (the `test-tiers` check) and
 * `devaudit install` (proposing tier commands). Read-only; never runs anything.
 */
export interface TestRunnerDetection {
  readonly playwright: boolean;
  readonly pytest: boolean;
  readonly jest: boolean;
  readonly vitest: boolean;
  /** The Playwright config file name found at the repo root, if any. */
  readonly playwrightConfig?: string;
}

const PLAYWRIGHT_CONFIGS = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'] as const;
const JEST_CONFIGS = ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json'] as const;
const VITEST_CONFIGS = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs', 'vitest.config.mts'] as const;

async function trdExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function trdRead(path: string): Promise<string> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch {
    return '';
  }
}

async function trdFirstExisting(root: string, names: readonly string[]): Promise<string | undefined> {
  for (const name of names) {
    if (await trdExists(join(root, name))) return name;
  }
  return undefined;
}

export async function legacyDetectTestRunners(repoRoot: string): Promise<TestRunnerDetection> {
  const playwrightConfig = await trdFirstExisting(repoRoot, PLAYWRIGHT_CONFIGS);

  const pyproject = await trdRead(join(repoRoot, 'pyproject.toml'));
  const pytest =
    (await trdExists(join(repoRoot, 'pytest.ini'))) ||
    /^\[tool\.pytest/m.test(pyproject) ||
    /^\[tool:pytest\]/m.test(await trdRead(join(repoRoot, 'setup.cfg'))) ||
    /^\[pytest\]/m.test(await trdRead(join(repoRoot, 'tox.ini'))) ||
    (await trdExists(join(repoRoot, 'conftest.py'))) ||
    (await trdExists(join(repoRoot, 'tests', 'conftest.py')));

  let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; jest?: unknown } = {};
  try {
    packageJson = JSON.parse(await trdRead(join(repoRoot, 'package.json'))) as typeof packageJson;
  } catch {
    // no readable package.json
  }
  const dep = (name: string): boolean => name in (packageJson.dependencies ?? {}) || name in (packageJson.devDependencies ?? {});
  const jest = (await trdFirstExisting(repoRoot, JEST_CONFIGS)) !== undefined || packageJson.jest !== undefined || dep('jest');
  const vitest = (await trdFirstExisting(repoRoot, VITEST_CONFIGS)) !== undefined || dep('vitest');

  return { playwright: playwrightConfig !== undefined, pytest, jest, vitest, ...(playwrightConfig ? { playwrightConfig } : {}) };
}

/** Names of the `name: '...'` projects declared in a Playwright config file. */
export function legacyPlaywrightProjectNames(configText: string): string[] {
  return [...configText.matchAll(/name:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

// ---- deploy-detect ----

/**
 * devaudit-installer#1040 — evidence for where a consumer's production really
 * deploys, compared with the `host` recorded in `sdlc-config.json`. Onboarding
 * before 1.9.0 hardcoded `host: railway`, so a Vercel-hosted or self-hosted project silently got the Railway-specific workflows.
 *
 * Signals, strongest first:
 *  - who created the repo's production GitHub deployments (the host's GitHub
 *    app, or a workflow in the repo for a deploy devaudit or the team runs);
 *  - host config files committed to the repo.
 * Nothing here fails when `gh` is unavailable: what could not be checked is
 * listed in `unchecked`.
 */

export type LegacyDetectedHost = 'railway' | 'vercel' | 'custom';

export interface LegacyDeployEvidence {
  readonly host: LegacyDetectedHost;
  readonly source: 'deployments' | 'file';
  readonly detail: string;
  readonly weight: number;
}

export interface LegacyDeployDetection {
  readonly recorded: string;
  /** Host with the most evidence, or null when there is none. */
  readonly detected: LegacyDetectedHost | null;
  readonly confidence: 'high' | 'medium' | 'low' | 'none';
  readonly evidence: readonly LegacyDeployEvidence[];
  /** Signals that could not be checked (e.g. `gh` unauthenticated). */
  readonly unchecked: readonly string[];
  /** Latest production deployment URL GitHub recorded, if any (for the probe check). */
  readonly environmentUrl: string | null;
}

export interface LegacyGhResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export type LegacyGhRunner = (args: readonly string[], cwd: string) => Promise<LegacyGhResult>;

const LegacyDefaultGh: LegacyGhRunner = async (args, cwd) => {
  try {
    const r = await execa('gh', [...args], { cwd, reject: false, timeout: 20_000 });
    return { exitCode: r.exitCode ?? 1, stdout: r.stdout };
  } catch {
    return { exitCode: 1, stdout: '' };
  }
};

/** GitHub app / bot logins that create deployments, mapped to a host. */
const LegacyCREATORS: ReadonlyArray<[RegExp, LegacyDetectedHost, string]> = [
  [/^vercel(\[bot\])?$/i, 'vercel', 'Vercel GitHub app'],
  [/^railway(-app)?(\[bot\])?$/i, 'railway', 'Railway GitHub app'],
  [/^github-actions(\[bot\])?$/i, 'custom', 'a GitHub Actions workflow in this repo'],
];

const LegacyFILES: ReadonlyArray<[string, LegacyDetectedHost, string, number]> = [
  ['vercel.json', 'vercel', 'vercel.json', 2],
  ['.vercel/project.json', 'vercel', '.vercel/project.json (linked Vercel project)', 2],
  ['railway.json', 'railway', 'railway.json', 2],
  ['railway.toml', 'railway', 'railway.toml', 2],
  ['fly.toml', 'custom', 'fly.toml (Fly.io: deploy with the custom host)', 2],
  ['serverless.yml', 'custom', 'serverless.yml (Serverless Framework)', 1],
  ['appspec.yml', 'custom', 'appspec.yml (AWS CodeDeploy)', 1],
  ['terraform', 'custom', 'terraform/', 1],
  ['k8s', 'custom', 'k8s/ manifests', 1],
  ['helm', 'custom', 'helm/ chart', 1],
];

interface LegacyDeployment {
  readonly id: number;
  readonly environment: string;
  readonly creator?: { readonly login?: string } | null;
}

const LegacyIsProduction = (env: string): boolean => /prod/i.test(env);

export async function legacyDetectDeployHost(
  repoRoot: string,
  recordedHost: string,
  deps: { readonly gh?: LegacyGhRunner } = {},
): Promise<LegacyDeployDetection> {
  const gh = deps.gh ?? LegacyDefaultGh;
  const evidence: LegacyDeployEvidence[] = [];
  const unchecked: string[] = [];
  let environmentUrl: string | null = null;

  const listed = await gh(['api', 'repos/{owner}/{repo}/deployments?per_page=30'], repoRoot);
  if (listed.exitCode !== 0) {
    unchecked.push('GitHub deployments (gh api failed: not authenticated, no repo access, or no origin remote)');
  } else {
    let deployments: LegacyDeployment[] = [];
    try {
      deployments = (JSON.parse(listed.stdout) as LegacyDeployment[]).filter((d) => LegacyIsProduction(d.environment ?? ''));
    } catch {
      unchecked.push('GitHub deployments (unreadable response)');
    }
    const byHost = new Map<LegacyDetectedHost, { count: number; label: string; login: string }>();
    for (const d of deployments) {
      const login = d.creator?.login ?? '';
      const match = LegacyCREATORS.find(([re]) => re.test(login));
      if (!match) continue;
      const [, host, label] = match;
      const prev = byHost.get(host);
      byHost.set(host, { count: (prev?.count ?? 0) + 1, label, login });
    }
    for (const [host, { count, label, login }] of byHost) {
      evidence.push({
        host,
        source: 'deployments',
        detail: `${count} recent production deployment(s) created by ${login} (${label})`,
        weight: 3 + Math.min(count, 5),
      });
    }
    const latest = deployments[0];
    if (latest) {
      const statuses = await gh(['api', `repos/{owner}/{repo}/deployments/${latest.id}/statuses?per_page=5`], repoRoot);
      if (statuses.exitCode === 0) {
        try {
          const url = (JSON.parse(statuses.stdout) as Array<{ environment_url?: string }>).find(
            (s) => typeof s.environment_url === 'string' && s.environment_url !== '',
          )?.environment_url;
          environmentUrl = url ?? null;
        } catch {
          // no URL; not an error
        }
      }
    }
  }

  for (const [rel, host, detail, weight] of LegacyFILES) {
    if (await exists(join(repoRoot, rel))) evidence.push({ host, source: 'file', detail, weight });
  }

  const totals = new Map<LegacyDetectedHost, number>();
  for (const e of evidence) totals.set(e.host, (totals.get(e.host) ?? 0) + e.weight);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) {
    return { recorded: recordedHost, detected: null, confidence: 'none', evidence, unchecked, environmentUrl };
  }
  const [detected, score] = top;
  const runnerUp = ranked[1]?.[1] ?? 0;
  const fromDeployments = evidence.some((e) => e.host === detected && e.source === 'deployments');
  const confidence =
    runnerUp > 0 && score - runnerUp < 3 ? 'low' : fromDeployments ? 'high' : 'medium';
  return { recorded: recordedHost, detected, confidence, evidence, unchecked, environmentUrl };
}

/** One-line human summary, e.g. for doctor output and configure warnings. */
export function LegacyDescribeDetection(d: LegacyDeployDetection): string {
  if (!d.detected) return 'no deploy-host evidence found';
  const reasons = d.evidence
    .filter((e) => e.host === d.detected)
    .map((e) => e.detail)
    .join('; ');
  return `${d.detected} (${d.confidence} confidence: ${reasons})`;
}

// ---- detect-stack ----

const DS_MAX_DEPTH = 3;
const DS_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo']);

async function dsFileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

// `pyproject.toml` is preferred (the Python packaging standard), but a repo
// managed with a plain `requirements.txt` — no `pyproject.toml` at all — is
// a real, valid convention (e.g. an unpackaged FastAPI service pinned via
// pip-compile/uv rather than declared as an installable package) and must
// still be detectable, or `--add-target` can never onboard it.
const DS_PYTHON_MARKERS = ['pyproject.toml', 'requirements.txt'];

async function findPyproject(root: string, depth: number, current: string): Promise<string | null> {
  if (depth > DS_MAX_DEPTH) return null;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const marker of DS_PYTHON_MARKERS) {
    const hit = entries.find((e) => e.isFile() && e.name === marker);
    if (hit) return join(current, hit.name);
  }
  for (const e of entries) {
    if (e.isDirectory() && !DS_SKIP_DIRS.has(e.name)) {
      const found = await findPyproject(root, depth + 1, join(current, e.name));
      if (found) return found;
    }
  }
  return null;
}

/**
 * `working_directory` describes a target's location relative to the git
 * REPO ROOT (that's what CI templates `cd` into, and what GitHub Actions'
 * path-scoped triggers filter on) — never relative to wherever `devaudit
 * install` happened to be invoked from. In the common single-target case
 * `ctx.repoRoot === ctx.projectPath`, so this is a no-op ('.'). In a
 * polyglot-monorepo target living in a subdirectory (#689's `--add-target`),
 * `ctx.projectPath` is that subdirectory, not the repo root — omitting this
 * normalization silently wrote `working_directory: "."` into
 * sdlc-config.json for a target that isn't actually at the repo root,
 * breaking every repo-root-relative step downstream (namespaced CI's `cd`
 * into the target, path-scoped triggers, etc.). Also normalizes to POSIX
 * separators — see the note on `resolveTargetWorkingDir`'s Windows fix.
 */
function dsToRepoRelative(ctx: InstallContext, absoluteTargetDir: string): string {
  const rel = relative(ctx.repoRoot, absoluteTargetDir).split(sep).join('/');
  return rel || '.';
}

export async function legacyDetectStack(ctx: InstallContext): Promise<{ result: StepResult; detected: DetectedStack }> {
  const root = ctx.projectPath;
  for (const marker of DS_PYTHON_MARKERS) {
    if (await dsFileExists(join(root, marker))) {
      const wd = dsToRepoRelative(ctx, root);
      return { result: dsOk('python', wd), detected: { stack: 'python', workingDirectory: wd } };
    }
  }
  const nested = await findPyproject(root, 1, root);
  if (nested) {
    const wd = dsToRepoRelative(ctx, dirname(nested));
    return { result: dsOk('python', wd), detected: { stack: 'python', workingDirectory: wd } };
  }
  if (await dsFileExists(join(root, 'package.json'))) {
    const wd = dsToRepoRelative(ctx, root);
    return { result: dsOk('node', wd), detected: { stack: 'node', workingDirectory: wd } };
  }
  throw new Error(
    'Could not detect stack — no pyproject.toml, requirements.txt, or package.json found within 3 directory levels.',
  );
}

function dsOk(stack: 'node' | 'python', wd: string): StepResult {
  return {
    step: '2/12 Detect stack',
    status: 'ok',
    message: `stack=${stack} working_directory=${wd}`,
    data: { stack, workingDirectory: wd },
  };
}
