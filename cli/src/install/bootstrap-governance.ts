import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ensureDir, isFile } from '../lib/fs-utils.js';
import type { InstallContext, StepResult } from './types.js';

/**
 * Tightened view of `InstallContext` — only the fields this function
 * actually reads. Lets the standalone `devaudit bootstrap-governance`
 * command construct a minimal context without faking auth tokens or
 * install-mode state it doesn't have.
 */
type BootstrapCtx = Pick<InstallContext, 'projectPath' | 'installerRoot' | 'dryRun'>;

const STEP = 'Bootstrap governance docs';
const SOURCE_REL = 'sdlc/files/_common/governance';
const TARGET_REL = 'compliance/governance';

/**
 * One-time copy of governance-doc starter templates into the consumer's
 * `compliance/governance/` directory.
 *
 * - Runs on `devaudit install` only — NOT re-run by `devaudit update`. Once
 *   the operator edits a file, our starter is gone; we never overwrite.
 * - Idempotent: each target is skipped if it already exists on disk.
 * - Source files end in `.md.template`; the target drops the `.template`
 *   suffix (e.g. `ropa.md.template` → `compliance/governance/ropa.md`).
 *
 * Templates begin with a prominent "STARTER TEMPLATE — REPLACE BEFORE
 * COMMITTING" banner so the placeholder status is unambiguous on disk
 * and in the portal's rendered evidence view.
 *
 * Closes framework clauses: GDPR.Art-30 (ropa), GDPR.Art-35 (dpia),
 * EUAIA.Art-13 (ai_disclosure), ISO29119.3.5.4 / GDPR.Art-33 / GDPR.Art-34 /
 * SOC2.CC7.2 (incident_report), SOC2.CC4.1 / ISO27001.A.12.1 (periodic_review).
 * The upload path is already wired by v0.1.26's `upload_governance` helper
 * in `sdlc/files/ci/compliance-evidence.yml.template`.
 *
 * See `docs/governance-templates.md` for the per-framework mapping the
 * operator needs to honour when replacing the starter content.
 */
export async function bootstrapGovernanceDocs(ctx: BootstrapCtx): Promise<StepResult> {
  const sourceDir = resolve(ctx.installerRoot, SOURCE_REL);
  const targetDir = resolve(ctx.projectPath, TARGET_REL);
  let templates: readonly string[] = [];
  try {
    templates = (await readdir(sourceDir))
      .filter((name) => name.endsWith('.md.template'))
      .sort();
  } catch (err) {
    return {
      step: STEP,
      status: 'warn',
      message: `source directory not found: ${sourceDir} (${(err as Error).message})`,
    };
  }
  if (templates.length === 0) {
    return { step: STEP, status: 'warn', message: `no .md.template files in ${sourceDir}` };
  }
  if (ctx.dryRun) {
    return {
      step: STEP,
      status: 'planned',
      message: `would copy ${templates.length} starter(s) to ${TARGET_REL}/ (skip-if-exists)`,
      data: { templates: [...templates] },
    };
  }
  await ensureDir(targetDir);
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const template of templates) {
    const targetName = template.replace(/\.template$/, '');
    const targetPath = join(targetDir, targetName);
    if (await isFile(targetPath)) {
      skipped.push(targetName);
      continue;
    }
    const body = await readFile(join(sourceDir, template), 'utf8');
    await writeFile(targetPath, body, 'utf8');
    copied.push(targetName);
  }
  const detail =
    skipped.length === 0
      ? `${copied.length} starter(s) copied to ${TARGET_REL}/`
      : `${copied.length} copied, ${skipped.length} kept (already on disk)`;
  return {
    step: STEP,
    status: 'ok',
    message: `${detail} — STARTERS, edit before production (see docs/governance-templates.md)`,
    data: { copied, skipped, targetDir: TARGET_REL },
  };
}
