import { basename, resolve } from 'node:path';
import { isDir } from '../lib/fs-utils.js';
import { resolveInstallerRoot } from '../lib/installer-root.js';
import { resolveAdapters } from './resolve-adapters.js';
import { syncStageDocs } from './stage-docs.js';
import { syncAiRules } from './ai-rules.js';
import { syncStackHooks } from './stack-hooks.js';
import { syncStackDeps } from './stack-deps.js';
import { syncScripts } from './scripts.js';
import { syncIssueTemplates } from './issue-templates.js';
import { syncSkills } from './skills.js';
import { syncEvidenceHelper } from './evidence-helper.js';
import { syncCiTemplates } from './ci-templates.js';
import { syncGitignore } from './gitignore.js';
import { syncSdlcEngine } from './sdlc-engine.js';
import { syncWorkflows } from './workflows.js';
import { runValidation } from './validation.js';
import { logger } from '../lib/logger.js';
import type { SyncContext, SectionResult, SyncReport } from './types.js';

const SECTION_RUNNERS: ReadonlyArray<{
  readonly key: string;
  readonly run: (ctx: SyncContext) => Promise<SectionResult>;
}> = [
  { key: '2a', run: syncStageDocs },
  { key: '2b', run: syncAiRules },
  { key: '2c', run: syncStackHooks },
  { key: '2c-ii', run: syncStackDeps },
  { key: '2d', run: syncScripts },
  { key: '2e', run: syncIssueTemplates },
  { key: '2e-ii', run: syncSkills },
  { key: '2e-iii', run: syncEvidenceHelper },
  { key: '2f', run: syncCiTemplates },
  { key: '2g', run: syncGitignore },
  { key: '2h', run: syncSdlcEngine },
  { key: '2i', run: syncWorkflows },
];

export async function syncProject(projectPath: string): Promise<SyncReport> {
  const absPath = resolve(projectPath);
  if (!(await isDir(absPath))) {
    throw new Error(`Project path not found: ${absPath}`);
  }
  const installerRoot = await resolveInstallerRoot();
  const log = logger();
  const projectName = basename(absPath);
  log.info(`--- Syncing to: ${projectName} (${absPath}) ---`);
  const { stack, host, deprecatedDefaults } = await resolveAdapters(absPath, installerRoot);
  log.info(`  Stack: ${stack} | Host: ${host}`);
  if (deprecatedDefaults) {
    log.warn(`  DEPRECATED: stack/host keys missing from sdlc-config.json — defaulted to ${stack}+${host}.`);
  }
  const ctx: SyncContext = { installerRoot, projectPath: absPath, projectName, stack, host };
  const sections: SectionResult[] = [];
  let total = 0;
  for (const { key, run } of SECTION_RUNNERS) {
    const result = await run(ctx);
    sections.push(result);
    total += result.filesSynced;
    if (result.skipped) {
      log.log(`  [${key}] ${result.name}: SKIPPED${result.message ? ` (${result.message})` : ''}`);
    } else {
      log.log(`  [${key}] ${result.name}: ${result.filesSynced} file(s)${result.message ? ` — ${result.message}` : ''}`);
    }
  }
  log.log('');
  log.info(`  Total: ${total} files synced`);
  log.log('');
  log.log('  --- Validation ---');
  const warnings = await runValidation(absPath);
  if (warnings.length === 0) {
    log.success('  All validation checks passed');
  } else {
    for (const w of warnings) log.warn(`  ${w}`);
  }
  log.log('');
  return { project: projectName, stack, host, sections, totalFilesSynced: total, warnings };
}

export async function syncAll(projectPaths: readonly string[]): Promise<readonly SyncReport[]> {
  const reports: SyncReport[] = [];
  for (const p of projectPaths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      reports.push(await syncProject(p));
    } catch (err) {
      const log = logger();
      log.error(`ERROR syncing ${p}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
  return reports;
}
