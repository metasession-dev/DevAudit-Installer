import { describe, it, expect, beforeAll } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { load as yamlLoad } from 'js-yaml';
import { renderAll } from './helpers/render-workflows.js';
import { findConfigKey, parseConfigValue } from '../src/lib/repo-config-keys.js';

// devaudit-installer#1059 Phase A — configurable E2E release gate. With none of
// release_gate_tier / post_deploy_full_regression / scheduled_full_regression
// set, e2e-regression.yml and check-release-approval.yml render exactly as before.

const HERE = dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  process.env['DEVAUDIT_INSTALLER_ROOT'] = resolve(HERE, '..', '..');
});

interface Workflow {
  readonly on?: Record<string, unknown>;
  readonly jobs?: Record<string, { readonly steps?: { readonly name?: string; readonly run?: string }[] }>;
}

/** Byte length of each `run: |` block at step level, as update.test.ts measures them. */
function runBlockSizes(workflow: string): number[] {
  const lines = workflow.split('\n');
  const sizes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s{8}run: \|\s*$/.test(lines[i]!)) continue;
    let j = i + 1;
    const body: string[] = [];
    while (j < lines.length && (lines[j]!.trim() === '' || lines[j]!.length - lines[j]!.trimStart().length > 8)) body.push(lines[j++]!);
    sizes.push(Buffer.byteLength(body.join('\n')));
    i = j - 1;
  }
  return sizes;
}

const triggers = (text: string): string[] => Object.keys((yamlLoad(text) as Workflow).on ?? {});

function bashProblems(text: string): string[] {
  const problems: string[] = [];
  for (const job of Object.values((yamlLoad(text) as Workflow).jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (!step.run) continue;
      const r = spawnSync('bash', ['-n'], { input: step.run.replace(/\$\{\{[\s\S]*?\}\}/g, 'X'), encoding: 'utf8' });
      if (r.status !== 0 || /warning/i.test(r.stderr)) problems.push(`${step.name}: ${r.stderr.trim().split('\n')[0]}`);
    }
  }
  return problems;
}

describe('release gate: no key set is the same as before', { timeout: 180_000 }, () => {
  it('keeps the original triggers, checkout ref, selector and PATCH body', async () => {
    const wf = await renderAll('node');
    const reg = wf['e2e-regression.yml']!;
    expect(triggers(reg).sort()).toEqual(['deployment_status', 'pull_request', 'workflow_dispatch']);
    expect(reg).toContain('ref: ${{ github.event.deployment.sha || github.sha }}');
    expect(reg).toContain('            deployment_status)\n              echo "project=regression"');
    expect(reg).not.toMatch(/tier: \$tier|steps\.select\.outputs\.tier|schedule/);
    expect(wf['check-release-approval.yml']).toContain('pull_request:\n    branches: [main]');
    expect(wf['check-release-approval.yml']).toContain('\\"number\\":${PR_NUMBER}}}"');
    expect(wf['check-release-approval.yml']).not.toContain('releaseGateTier');
  });

  it('a gate key set to its default value still changes nothing the portal sees until configured', async () => {
    const wf = await renderAll('node', { post_deploy_full_regression: true });
    expect(triggers(wf['e2e-regression.yml']!).sort()).toEqual(['deployment_status', 'pull_request', 'workflow_dispatch']);
    expect(wf['check-release-approval.yml']).not.toContain('releaseGateTier');
  });
});

describe('release gate: triggers and selector follow the keys', { timeout: 180_000 }, () => {
  it('release_gate_tier full: the full tier runs on the PR and is recorded', async () => {
    const wf = await renderAll('node', { release_gate_tier: 'full' });
    const reg = wf['e2e-regression.yml']!;
    expect(triggers(reg)).toContain('pull_request');
    expect(reg).toContain('pull_request)\n              echo "project=regression" >> "$GITHUB_OUTPUT"');
    expect(reg).toContain('echo "tier=full" >> "$GITHUB_OUTPUT"');
    expect(reg).toContain('--arg tier "${{ steps.select.outputs.tier || \'full\' }}"');
    expect(reg).toContain('project: $project, tier: $tier, selected_specs');
    expect(wf['check-release-approval.yml']).toContain('\\"number\\":${PR_NUMBER}},\\"releaseGateTier\\":\\"full\\"}"');
  });

  it('release_gate_tier smoke runs the e2e_project; critical keeps the critical-or-smoke fallback', async () => {
    const smoke = (await renderAll('node', { release_gate_tier: 'smoke' }))['e2e-regression.yml']!;
    expect(smoke).toContain('pull_request)\n              echo "project=chromium" >> "$GITHUB_OUTPUT"');
    expect(smoke).toContain('echo "tier=smoke"');
    const critical = (await renderAll('node', { release_gate_tier: 'critical' }))['e2e-regression.yml']!;
    expect(critical).toContain('echo "project=smoke" >> "$GITHUB_OUTPUT"');
    expect(critical).toContain('echo "tier=critical"');
  });

  it('release_gate_tier none drops the PR trigger; post_deploy_full_regression false drops the deployment trigger', async () => {
    const none = await renderAll('node', { release_gate_tier: 'none' });
    expect(triggers(none['e2e-regression.yml']!).sort()).toEqual(['deployment_status', 'workflow_dispatch']);
    const noPost = await renderAll('node', { release_gate_tier: 'full', post_deploy_full_regression: false });
    expect(triggers(noPost['e2e-regression.yml']!).sort()).toEqual(['pull_request', 'workflow_dispatch']);
  });

  it('a custom release branch is used by the trigger and the approval workflow', async () => {
    const wf = await renderAll('node', { release_gate_tier: 'full', release_branch: 'production' });
    expect(wf['e2e-regression.yml']).toContain('pull_request:\n    branches: [production]');
    expect(wf['check-release-approval.yml']).toContain('pull_request:\n    branches: [production]');
  });

  it('scheduled_full_regression adds the cron, tests the integration branch and opens one issue on failure', async () => {
    const wf = await renderAll('node', { scheduled_full_regression: '0 3 * * *', integration_branch: 'next' });
    const reg = wf['e2e-regression.yml']!;
    expect(triggers(reg)).toContain('schedule');
    expect(reg).toContain("- cron: '0 3 * * *'");
    expect(reg).toContain("(github.event_name == 'schedule' && 'next')");
    expect(reg).toContain('deployment_status|schedule)\n              echo "project=regression"');
    expect(reg).toContain("if: failure() && github.event_name == 'schedule'");
    expect(reg).toContain('[scheduled regression] Full E2E failing on next');
    expect(reg).toContain('--label bug');
    expect((await renderAll('node'))['e2e-regression.yml']).not.toContain('scheduled regression');
  });

  it('an invalid cron expression is ignored rather than written into the workflow', async () => {
    const reg = (await renderAll('node', { scheduled_full_regression: "0 3 * *' evil" }))['e2e-regression.yml']!;
    expect(triggers(reg)).not.toContain('schedule');
  });

  it('the tier script maps the PR tier to the configured gate when tier commands are set', async () => {
    const reg = (await renderAll('node', { release_gate_tier: 'smoke', test_tier_full: 'make full' }))['e2e-regression.yml']!;
    expect(reg).toContain('echo full || echo smoke)');
  });

  it('every gate combination yields valid YAML whose bash steps parse', async () => {
    for (const extra of [
      { release_gate_tier: 'full', post_deploy_full_regression: false, scheduled_full_regression: '0 3 * * 1' },
      { release_gate_tier: 'none', scheduled_full_regression: '*/30 * * * *' },
    ]) {
      for (const stack of ['node', 'python'] as const) {
        const wf = await renderAll(stack, extra);
        for (const name of ['e2e-regression.yml', 'check-release-approval.yml', 'compliance-evidence.yml']) {
          expect(bashProblems(wf[name]!), `${stack} ${name} ${JSON.stringify(extra)}`).toEqual([]);
        }
      }
    }
  });

  it('the pytest regression workflow runs the gate tier on the PR and records it', async () => {
    const reg = (await renderAll('node', { test_runner: 'pytest', release_gate_tier: 'full', scheduled_full_regression: '0 3 * * *' }))['e2e-regression.yml']!;
    expect(reg).toContain('pull_request)\n              echo "tier=full" >> "$GITHUB_OUTPUT"');
    expect(reg).toContain('deployment_status|schedule)');
    expect(reg).toContain('project: $project, tier: $tier, selected_specs');
    expect(triggers(reg)).toContain('schedule');
    expect(bashProblems(reg)).toEqual([]);
  });
});

describe('release gate: tier recording, labels and the release check', { timeout: 180_000 }, () => {
  it('compliance-evidence.yml reads the tier from the metadata, labels each tier and requires every pre-merge tier', async () => {
    const ce = (await renderAll('node'))['compliance-evidence.yml']!;
    expect(ce).toContain('read -r TIER META_TIER < <(bash scripts/e2e-release-gate.sh resolve "$PRIOR_EVENT" "$TIER" e2e-artifacts/e2e-regression-metadata.json)');
    expect(ce).toContain('smoke)      TIER_LABEL="E2E Smoke (pre-merge)"');
    expect(ce).toContain('critical)   TIER_LABEL="E2E Critical (pre-merge)"');
    expect(ce).toContain('full)       TIER_LABEL="E2E Full (pre-merge)"');
    expect(ce).toContain('regression) TIER_LABEL="E2E Regression (post-deploy production)"');
    expect(ce).toContain('critical)   CHECK_REQUIRED=true ;;');
    expect(ce).toContain('smoke|full) CHECK_REQUIRED=true ;;');
    expect(ce).toContain('regression) CHECK_REQUIRED=false ;;');
    // the post-deploy mapping the portal exempts by stage and environment is unchanged
    expect(ce).toContain('deployment_status)  TIER=regression; STAGE=5; E2E_ENVIRONMENT=production ;;');
  });

  it('only pre-merge runs with a recorded tier report the e2e-release-gate check', async () => {
    const ce = (await renderAll('node'))['compliance-evidence.yml']!;
    expect(ce).toContain('if [ -n "$META_TIER" ]; then\n            bash scripts/e2e-release-gate.sh report fixture-app "${DERIVED_RELEASE}" "$META_TIER" "$PRIOR_BRANCH"');
    // the run context reaches the script through the step environment
    for (const name of ['E2E_CONCLUSION', 'E2E_HEAD_SHA', 'E2E_RUN_ID', 'E2E_RUN_URL', 'E2E_RUN_STARTED_AT', 'E2E_RUN_UPDATED_AT']) {
      expect(ce).toContain(`${name}: \${{`);
    }
  });

  it('a scheduled run is kept as GitHub CI only, before anything is uploaded', async () => {
    const ce = (await renderAll('node'))['compliance-evidence.yml']!;
    const skip = ce.indexOf('if [ "$PRIOR_EVENT" = "schedule" ]; then');
    expect(skip).toBeGreaterThan(-1);
    expect(ce.slice(skip, skip + 260)).toContain('exit 0');
    expect(skip).toBeLessThan(ce.indexOf('report-test-execution.sh start'));
    expect(skip).toBeLessThan(ce.indexOf('scripts/e2e-release-gate.sh report'));
  });

  it('the python stack gets the same compliance logic', async () => {
    const ce = (await renderAll('python'))['compliance-evidence.yml']!;
    expect(ce).toContain('scripts/e2e-release-gate.sh report');
  });

  it('keeps the compliance-evidence run block under the size limit with headroom', async () => {
    for (const stack of ['node', 'python'] as const) {
      const ce = (await renderAll(stack))['compliance-evidence.yml']!;
      const sizes = runBlockSizes(ce);
      expect(Math.max(...sizes), stack).toBeLessThan(19_900);
    }
  });
});

describe('release gate config keys', () => {
  const validate = (key: string, value: unknown) => findConfigKey(key)!.validate?.(value) ?? null;

  it('release_gate_tier is one of none, smoke, critical, full', () => {
    expect(findConfigKey('release_gate_tier')!.enum).toEqual(['none', 'smoke', 'critical', 'full']);
  });

  it('post_deploy_full_regression is a boolean', () => {
    expect(parseConfigValue(findConfigKey('post_deploy_full_regression')!, 'false').value).toBe(false);
    expect(parseConfigValue(findConfigKey('post_deploy_full_regression')!, 'maybe').error).toMatch(/true or false/);
  });

  it('scheduled_full_regression takes five cron fields or empty', () => {
    expect(validate('scheduled_full_regression', '0 3 * * *')).toBeNull();
    expect(validate('scheduled_full_regression', '*/15 8-18 * * 1-5')).toBeNull();
    expect(validate('scheduled_full_regression', '')).toBeNull();
    expect(validate('scheduled_full_regression', '0 3 * *')).toMatch(/five/);
    expect(validate('scheduled_full_regression', "0 3 * * *'")).toMatch(/quotes/);
    expect(validate('scheduled_full_regression', '0 3 * * *\n1 1 * * *')).toMatch(/quotes or line breaks/);
  });

  it('the keys name the workflows they change', () => {
    expect(findConfigKey('release_gate_tier')!.affects).toEqual([
      '.github/workflows/e2e-regression.yml',
      '.github/workflows/compliance-evidence.yml',
      '.github/workflows/check-release-approval.yml',
    ]);
    expect(findConfigKey('scheduled_full_regression')!.affects).toEqual(['.github/workflows/e2e-regression.yml']);
  });
});
