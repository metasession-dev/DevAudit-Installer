import { detectTestRunners as detectWithReader, playwrightProjectNames, type TestRunnerDetection } from '@metasession.co/devaudit-core';
import { fsRepoReader } from '@metasession.co/devaudit-core/node';

/**
 * devaudit-installer#1060 — which test runners a repository uses, from the files
 * a runner needs. Shared by `devaudit doctor` (the `test-tiers` check) and
 * `devaudit install` (proposing tier commands). Read-only; never runs anything.
 *
 * The detection itself lives in `@metasession.co/devaudit-core` (DevAudit-Installer#1116 WP3), where
 * the portal shares it; this file reads the local file system for it and keeps the CLI's signatures.
 */
export type { TestRunnerDetection };
export { playwrightProjectNames };

export async function detectTestRunners(repoRoot: string): Promise<TestRunnerDetection> {
  return detectWithReader(fsRepoReader(repoRoot));
}
