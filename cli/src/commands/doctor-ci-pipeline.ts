import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Remediation } from '@metasession.co/devaudit-core';
import type { CheckResult, Finding } from '../lib/doctor-types.js';
import { RETIRED_CONFIG_KEYS } from '../lib/repo-config-keys.js';
import { REPLACED_WORKFLOWS_PATTERN } from '../update/ci-templates.js';

/**
 * DevAudit-Installer#1335 — `ci-pipeline`: what is left of the CI layout before the single pipeline. Informational,
 * never a failure, and never changes the doctor exit code:
 *
 *  - `legacy-workflow`: a workflow the single `ci.yml` replaced (`ci-status-fallback.yml`, `quality-gates-provenance.yml`,
 *    `feature-e2e.yml`, or a `-<target>` variant) is still in `.github/workflows/`, usually because `update` kept a
 *    modified copy. It would report a second `Quality Gates` check.
 *  - `retired-key`: `sdlc-config.json` still has a retired key (`paths_ignore_pull_request`, `reuse_pull_request_gates`).
 *  - `feature-workflow-guard`: a Playwright config tests `GITHUB_WORKFLOW` against `Feature In-Scope E2E`, which no
 *    longer matches: the feature E2E is a job of `ci.yml` (`GITHUB_JOB=feature-e2e`).
 *
 * Static, local, no portal call.
 */

const guidance = (id: string, summary: string, plan: string[]): Remediation => ({ id, tier: 'C', summary, plan, needsPortal: false });

const PLAYWRIGHT_CONFIGS = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'];

export async function ciPipelineCheck(consumer: { readonly repoRoot: string; readonly cfg: Record<string, unknown> }): Promise<CheckResult> {
  const name = 'ci-pipeline';
  const findings: Finding[] = [];

  const workflows = await fs.readdir(join(consumer.repoRoot, '.github', 'workflows')).catch(() => [] as string[]);
  const legacy = workflows.filter((f) => REPLACED_WORKFLOWS_PATTERN.test(f)).sort();
  if (legacy.length > 0) {
    findings.push({
      subject: 'legacy-workflow',
      detail: `${legacy.map((f) => `.github/workflows/${f}`).join(', ')} ${legacy.length === 1 ? 'is' : 'are'} no longer generated: ci.yml replaced ${legacy.length === 1 ? 'it' : 'them'}, and a copy that is left reports a second "Quality Gates" check.`,
      remediation: guidance('remove-replaced-workflow', 'Delete the workflows the single CI pipeline replaced', [
        ...legacy.map((f) => `git rm .github/workflows/${f}   (on a fix branch; read its .devaudit-new note first if update kept it as a conflict)`),
        'devaudit update   (to confirm nothing regenerates it)',
      ]),
    });
  }

  const retired = Object.keys(RETIRED_CONFIG_KEYS).filter((k) => Object.prototype.hasOwnProperty.call(consumer.cfg, k)).sort();
  if (retired.length > 0) {
    findings.push({
      subject: 'retired-key',
      detail: `sdlc-config.json still has ${retired.join(' and ')}, which no longer ${retired.length === 1 ? 'does' : 'do'} anything: documentation-only changes always skip the gates, and a merge always reuses a tested pull request result.`,
      remediation: guidance('remove-retired-key', 'Remove the retired keys from sdlc-config.json', retired.map((k) => `remove "${k}" from sdlc-config.json   (it has no effect; see docs/ci-pipeline.md)`)),
    });
  }

  const workingDirectory = typeof consumer.cfg['working_directory'] === 'string' && consumer.cfg['working_directory'] !== '' ? (consumer.cfg['working_directory'] as string) : '.';
  const dirs = [...new Set([consumer.repoRoot, join(consumer.repoRoot, workingDirectory)])];
  const guarded: string[] = [];
  for (const dir of dirs) {
    for (const file of PLAYWRIGHT_CONFIGS) {
      const text = await fs.readFile(join(dir, file), 'utf-8').catch(() => null);
      if (text !== null && text.includes('Feature In-Scope E2E')) guarded.push(relative(consumer.repoRoot, join(dir, file)).split(sep).join('/'));
    }
  }
  if (guarded.length > 0) {
    findings.push({
      subject: 'feature-workflow-guard',
      detail: `${guarded.join(', ')} test${guarded.length === 1 ? 's' : ''} for "Feature In-Scope E2E", the old workflow name. The feature E2E is a job of ci.yml now (GITHUB_WORKFLOW is "CI Pipeline"), so the guard no longer matches and the projects it should skip run in the feature E2E.`,
      remediation: guidance('update-feature-guard', 'Guard on the job instead of the workflow', [
        "replace process.env.GITHUB_WORKFLOW === 'Feature In-Scope E2E' with process.env.GITHUB_JOB === 'feature-e2e'   (or DEVAUDIT_E2E_SCOPE === 'feature')",
      ]),
    });
  }

  if (findings.length === 0) {
    return { name, ok: true, detail: 'no workflow, key or Playwright guard from before the single CI pipeline is left', suspectedOrigin: 'consumer-drift' };
  }
  return { name, ok: true, detail: `${findings.length} leftover(s) from before the single CI pipeline`, suspectedOrigin: 'consumer-drift', findings };
}
