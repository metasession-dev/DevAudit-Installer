import { joinRepoPath, listFileNames, readJson, readText, type RepoReader } from '../repo-reader.js';
import { hostEvidenceFromFiles, rankHostEvidence } from './deploy.js';
import { detectStack } from './stack.js';
import { detectTestData, type TestDataFacts } from './test-data.js';
import { detectTestRunners, playwrightProjectNames, type TestRunnerDetection } from './test-runners.js';

/**
 * Everything the onboarding questions and the scan can learn about a repository from its files
 * (DevAudit-Installer#1116 section 7). Detection never runs repository content: it only reads.
 */

export interface TestGroups {
  readonly smoke: boolean;
  readonly critical: boolean;
  readonly full: boolean;
}

export interface DetectedFacts {
  readonly stack: 'node' | 'python' | null;
  /** The directory that holds the app, relative to the repository root (`.` for the root); null when no stack was found. */
  readonly workingDirectory: string | null;
  readonly host: string | null;
  readonly testRunner: 'playwright' | 'pytest' | null;
  readonly testGroups: TestGroups;
  readonly branches: { readonly integration: string | null; readonly release: string | null };
  /** `github`: a GitHub-hosted label (or self-hosted with CI_RUNNER_LABEL github-ci); `self-hosted`: our own machines. */
  readonly runner: 'github' | 'self-hosted' | null;
  /** Governance documents already in `compliance/governance/`, as repository paths. */
  readonly governanceFiles: string[];
  readonly testData: TestDataFacts;
}

export interface DetectOptions {
  /**
   * Test groups a collect-only run proved to hold tests (`test_tier_*` commands, which only the CLI
   * can run). They are added to what the files show; they never remove anything.
   */
  readonly collected?: Partial<TestGroups>;
}

const MAX_CONFIG_BYTES = 1_000_000;
const RELEASE_BRANCH_CANDIDATES = ['main', 'master', 'production'] as const;
const INTEGRATION_BRANCH_CANDIDATES = ['develop', 'development', 'dev'] as const;

async function readConfig(reader: RepoReader): Promise<Record<string, unknown> | null> {
  const parsed = await readJson(reader, 'sdlc-config.json', MAX_CONFIG_BYTES);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

const nonEmptyString = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** The branch names git knows locally or on `origin`, read from `.git` (empty when `.git` is not a directory). */
async function gitBranchNames(reader: RepoReader): Promise<Set<string>> {
  const names = new Set<string>();
  for (const dir of ['.git/refs/heads', '.git/refs/remotes/origin']) {
    for (const name of await listFileNames(reader, dir)) names.add(name);
    // A name with a slash (feature/x) is a directory here; the candidates we look for have none.
  }
  const packed = await readText(reader, '.git/packed-refs');
  for (const line of packed.split('\n')) {
    const m = /^[0-9a-f]{40}\s+refs\/(?:heads|remotes\/origin)\/(\S+)$/.exec(line.trim());
    if (m) names.add(m[1]!);
  }
  return names;
}

/** The integration and release branches: the project's own configuration first, then the branches git has. */
export async function detectBranches(
  reader: RepoReader,
  config: Record<string, unknown> | null,
): Promise<{ integration: string | null; release: string | null }> {
  const configured = { integration: nonEmptyString(config?.['integration_branch']), release: nonEmptyString(config?.['release_branch']) };
  if (configured.integration && configured.release) return configured;
  const known = await gitBranchNames(reader);
  const pick = (candidates: readonly string[]): string | null => candidates.find((c) => known.has(c)) ?? null;
  return {
    integration: configured.integration ?? pick(INTEGRATION_BRANCH_CANDIDATES),
    release: configured.release ?? pick(RELEASE_BRANCH_CANDIDATES),
  };
}

/** Where CI runs: the project's `runner` key, else the `runs-on` of its workflows. */
export async function detectRunner(reader: RepoReader, config: Record<string, unknown> | null): Promise<'github' | 'self-hosted' | null> {
  const configured = nonEmptyString(config?.['runner']);
  if (configured) return configured === 'self-hosted' ? 'self-hosted' : 'github';
  let sawGithub = false;
  for (const name of (await listFileNames(reader, '.github/workflows')).filter((n) => /\.ya?ml$/.test(n))) {
    const text = await readText(reader, joinRepoPath('.github/workflows', name));
    for (const line of text.split('\n')) {
      const m = /^\s*runs-on:(.*)$/.exec(line);
      if (!m) continue;
      const runsOn = m[1]!.trim();
      if (/self-hosted/.test(runsOn)) return 'self-hosted';
      if (/(ubuntu|windows|macos)-/.test(runsOn)) sawGithub = true;
    }
  }
  return sawGithub ? 'github' : null;
}

/** The governance documents in `compliance/governance/`. */
export async function detectGovernanceFiles(reader: RepoReader): Promise<string[]> {
  return (await listFileNames(reader, 'compliance/governance'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => joinRepoPath('compliance/governance', name));
}

async function playwrightConfigText(reader: RepoReader, dirs: readonly string[]): Promise<string> {
  for (const dir of dirs) {
    const runners = await detectTestRunners(reader, dir);
    if (runners.playwrightConfig) return readText(reader, joinRepoPath(dir, runners.playwrightConfig));
  }
  return '';
}

/**
 * Which test groups exist. From files alone: smoke when the Playwright config has a `smoke` project or
 * the project named by `e2e_project`; critical when it has a `critical` project; full when it has a
 * `regression` project. `options.collected` adds groups a collect-only run found.
 */
export async function detectTestGroups(
  reader: RepoReader,
  config: Record<string, unknown> | null,
  workingDirectory: string | null,
  options: DetectOptions = {},
): Promise<TestGroups> {
  const dirs = workingDirectory && workingDirectory !== '.' ? [workingDirectory, ''] : [''];
  const projects = playwrightProjectNames(await playwrightConfigText(reader, dirs));
  const e2eProject = nonEmptyString(config?.['e2e_project']);
  return {
    smoke: projects.includes('smoke') || (e2eProject !== null && projects.includes(e2eProject)) || options.collected?.smoke === true,
    critical: projects.includes('critical') || options.collected?.critical === true,
    full: projects.includes('regression') || options.collected?.full === true,
  };
}

export async function detectFacts(reader: RepoReader, options: DetectOptions = {}): Promise<DetectedFacts> {
  const config = await readConfig(reader);
  const stack = await detectStack(reader);
  const workingDirectory = stack?.workingDirectory ?? null;
  const dir = workingDirectory && workingDirectory !== '.' ? workingDirectory : '';
  const runners: TestRunnerDetection = await detectTestRunners(reader, dir);
  const hostRank = rankHostEvidence(await hostEvidenceFromFiles(reader));
  return {
    stack: stack?.stack ?? null,
    workingDirectory,
    host: hostRank.detected,
    testRunner: runners.playwright ? 'playwright' : runners.pytest ? 'pytest' : null,
    testGroups: await detectTestGroups(reader, config, workingDirectory, options),
    branches: await detectBranches(reader, config),
    runner: await detectRunner(reader, config),
    governanceFiles: await detectGovernanceFiles(reader),
    testData: await detectTestData(reader, dir),
  };
}
