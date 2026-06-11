/**
 * `devaudit bootstrap-governance` — explicit, opt-in copy of governance
 * starter templates into the consumer's `compliance/governance/`.
 *
 * Pre-v0.1.36 this ran automatically as install step 11/12. Operators
 * shipped `devaudit install`, the next CI push then uploaded five
 * placeholder governance docs as compliance evidence on day one — the
 * portal then read those starters as the canonical RoPA / DPIA /
 * AI-disclosure / etc. for the project, which they aren't (they're
 * pure placeholders with the literal text "STARTER TEMPLATE — REPLACE
 * BEFORE COMMITTING" at the top).
 *
 * v0.1.36 removes the auto-seed. Operators who genuinely want the
 * starters on disk run this command explicitly. Each target is skipped
 * if a file already exists at that path — non-destructive.
 */
import { resolve } from 'node:path';
import { bootstrapGovernanceDocs } from '../install/bootstrap-governance.js';
import { resolveInstallerRoot } from '../lib/installer-root.js';
import { logger, emitJsonResult, isJsonMode } from '../lib/logger.js';

export interface BootstrapGovernanceOpts {
  readonly path?: string;
  readonly dryRun?: boolean;
}

export async function runBootstrapGovernance(opts: BootstrapGovernanceOpts): Promise<void> {
  const projectPath = resolve(opts.path ?? process.cwd());
  const installerRoot = await resolveInstallerRoot();
  const log = logger();

  const result = await bootstrapGovernanceDocs({
    projectPath,
    installerRoot,
    dryRun: Boolean(opts.dryRun),
  });

  if (isJsonMode()) {
    emitJsonResult(result);
    return;
  }
  if (result.status === 'ok') {
    log.success(`[${result.step}] ${result.message ?? ''}`);
  } else if (result.status === 'warn') {
    log.warn(`[${result.step}] ${result.message ?? ''}`);
  } else if (result.status === 'planned') {
    log.info(`[${result.step}] (dry-run) ${result.message ?? ''}`);
  } else {
    log.log(`[${result.step}] ${result.message ?? ''}`);
  }
}
