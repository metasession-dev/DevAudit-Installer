import { getGitProvider } from '../lib/git-provider/index.js';
import { readSdlcConfig } from '../lib/sdlc-config.js';
import type { SyncContext, SectionResult } from './types.js';

/**
 * Section 2j-i: Verify (and re-apply, if drifted) the repo's GitHub default
 * branch is `integration_branch`. See devaudit#731 — GitHub creates every
 * repo with `main` as default, and nothing set it to the integration branch
 * during the original `devaudit install`, so a re-sync is also the recovery
 * path for already-onboarded repos.
 */
export async function verifyDefaultBranch(ctx: SyncContext): Promise<SectionResult> {
  // sdlc-config.json lives at the repo root (#689 follow-up), not this
  // target's own directory — see write-config.ts for why.
  const config = await readSdlcConfig(ctx.repoRoot);
  const integrationBranch = config?.integration_branch ?? 'develop';
  let provider;
  try {
    provider = await getGitProvider(ctx.projectPath);
  } catch (err) {
    return {
      name: 'Default branch',
      filesSynced: 0,
      warning: `git provider unavailable (${(err as Error).message}) — verify manually`,
    };
  }
  const result = await provider.setDefaultBranch(ctx.projectPath, integrationBranch);
  if (!result.changed) {
    if (result.message) {
      return { name: 'Default branch', filesSynced: 0, warning: `FAILED — ${result.message}` };
    }
    return { name: 'Default branch', filesSynced: 0, message: `already ${integrationBranch}` };
  }
  return { name: 'Default branch', filesSynced: 0, message: `-> ${integrationBranch}` };
}
