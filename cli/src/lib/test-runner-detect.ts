import { promises as fs } from 'node:fs';
import { join } from 'node:path';

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

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function read(path: string): Promise<string> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch {
    return '';
  }
}

async function firstExisting(root: string, names: readonly string[]): Promise<string | undefined> {
  for (const name of names) {
    if (await exists(join(root, name))) return name;
  }
  return undefined;
}

export async function detectTestRunners(repoRoot: string): Promise<TestRunnerDetection> {
  const playwrightConfig = await firstExisting(repoRoot, PLAYWRIGHT_CONFIGS);

  const pyproject = await read(join(repoRoot, 'pyproject.toml'));
  const pytest =
    (await exists(join(repoRoot, 'pytest.ini'))) ||
    /^\[tool\.pytest/m.test(pyproject) ||
    /^\[tool:pytest\]/m.test(await read(join(repoRoot, 'setup.cfg'))) ||
    /^\[pytest\]/m.test(await read(join(repoRoot, 'tox.ini'))) ||
    (await exists(join(repoRoot, 'conftest.py'))) ||
    (await exists(join(repoRoot, 'tests', 'conftest.py')));

  let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; jest?: unknown } = {};
  try {
    packageJson = JSON.parse(await read(join(repoRoot, 'package.json'))) as typeof packageJson;
  } catch {
    // no readable package.json
  }
  const dep = (name: string): boolean => name in (packageJson.dependencies ?? {}) || name in (packageJson.devDependencies ?? {});
  const jest = (await firstExisting(repoRoot, JEST_CONFIGS)) !== undefined || packageJson.jest !== undefined || dep('jest');
  const vitest = (await firstExisting(repoRoot, VITEST_CONFIGS)) !== undefined || dep('vitest');

  return { playwright: playwrightConfig !== undefined, pytest, jest, vitest, ...(playwrightConfig ? { playwrightConfig } : {}) };
}

/** Names of the `name: '...'` projects declared in a Playwright config file. */
export function playwrightProjectNames(configText: string): string[] {
  return [...configText.matchAll(/name:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}
