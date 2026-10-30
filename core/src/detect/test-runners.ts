import { isFile, joinRepoPath, readJson, readText, type RepoReader } from '../repo-reader.js';

/**
 * Which test runners a repository uses, from the files a runner needs (ported from the CLI's
 * `test-runner-detect.ts`, DevAudit-Installer#1060 and #1116 WP3). Read-only; never runs anything.
 */
export interface TestRunnerDetection {
  readonly playwright: boolean;
  readonly pytest: boolean;
  readonly jest: boolean;
  readonly vitest: boolean;
  /** The Playwright config file name found in the searched directory, if any. */
  readonly playwrightConfig?: string;
}

export const PLAYWRIGHT_CONFIGS = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'] as const;
const JEST_CONFIGS = ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json'] as const;
const VITEST_CONFIGS = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs', 'vitest.config.mts'] as const;

async function firstExisting(reader: RepoReader, dir: string, names: readonly string[]): Promise<string | undefined> {
  for (const name of names) {
    if (await isFile(reader, joinRepoPath(dir, name))) return name;
  }
  return undefined;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  jest?: unknown;
  scripts?: Record<string, string>;
}

/** Detect the runners in `dir` (the repository root by default). */
export async function detectTestRunners(reader: RepoReader, dir = ''): Promise<TestRunnerDetection> {
  const at = (name: string): string => joinRepoPath(dir, name);
  const playwrightConfig = await firstExisting(reader, dir, PLAYWRIGHT_CONFIGS);

  const pyproject = await readText(reader, at('pyproject.toml'));
  const pytest =
    (await isFile(reader, at('pytest.ini'))) ||
    /^\[tool\.pytest/m.test(pyproject) ||
    /^\[tool:pytest\]/m.test(await readText(reader, at('setup.cfg'))) ||
    /^\[pytest\]/m.test(await readText(reader, at('tox.ini'))) ||
    (await isFile(reader, at('conftest.py'))) ||
    (await isFile(reader, at('tests/conftest.py')));

  const parsed = await readJson(reader, at('package.json'));
  const packageJson: PackageJson = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PackageJson) : {};
  const dep = (name: string): boolean => name in (packageJson.dependencies ?? {}) || name in (packageJson.devDependencies ?? {});
  const jest = (await firstExisting(reader, dir, JEST_CONFIGS)) !== undefined || packageJson.jest !== undefined || dep('jest');
  const vitest = (await firstExisting(reader, dir, VITEST_CONFIGS)) !== undefined || dep('vitest');

  return { playwright: playwrightConfig !== undefined, pytest, jest, vitest, ...(playwrightConfig ? { playwrightConfig } : {}) };
}

/** Names of the `name: '...'` projects declared in a Playwright config file's text. */
export function playwrightProjectNames(configText: string): string[] {
  return [...configText.matchAll(/name:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}
