import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const template = (name: string) =>
  readFileSync(resolve(root, 'sdlc/files/ci', name), 'utf8').replace(/\r\n/g, '\n');
const reference = (name: string) =>
  readFileSync(resolve(root, 'sdlc/files/_common/skills/e2e-test-engineer/references', name), 'utf8').replace(
    /\r\n/g,
    '\n',
  );

describe('authoritative release lifecycle workflow templates (#405)', () => {
  it('records quality-gate lifecycle around execution and uses the upstream job result', () => {
    const source = template('ci.yml.template');
    expect(source).toContain('quality-gates:\n    name: Quality Gates\n    needs: [register-release]');
    expect(source.indexOf('Start authoritative quality-gate cycle')).toBeLessThan(
      source.indexOf('- name: TypeScript Check'),
    );
    expect(source).toContain('case "${{ needs.quality-gates.result }}" in');
    expect(source).toContain('--environment ci');
    expect(source).not.toContain('case "${{ job.status }}" in');
  });

  it('records E2E outcome and timestamps from the triggering workflow, not artifact upload', () => {
    const source = template('compliance-evidence.yml.template');
    expect(source).toContain('case "${{ github.event.workflow_run.conclusion }}" in');
    expect(source).toContain('e2e-regression-metadata.json');
    expect(source).toContain('EXECUTION_OUTCOME="$(jq -r');
    expect(source).toContain('passed|failed|timed_out)');
    expect(source).toContain('REQ_OUTCOME=timed_out');
    expect(source).toContain('executionOutcome:$executionOutcome');
    expect(source).toContain('--meta-key "execution_outcome=${EXECUTION_OUTCOME:-unknown}"');
    expect(source).toContain('--started-at "${{ github.event.workflow_run.run_started_at }}"');
    expect(source).toContain('--completed-at "${{ github.event.workflow_run.updated_at }}"');
    expect(source).toContain('artifactUploadFailures');
    expect(source).not.toContain('if [ "$REQ_FAILURES" -gt 0 ]; then\n              REQ_OUTCOME=failed');
  });

  it('imports deployment-origin E2E as production Stage 5 evidence only when REQ-scoped', () => {
    const source = template('compliance-evidence.yml.template');
    expect(source).toContain('deployment_status)  TIER=regression; STAGE=5; E2E_ENVIRONMENT=production ;;');
    expect(source).toContain('--environment "${E2E_ENVIRONMENT}"');
    expect(source).toContain('--sdlc-stage "${STAGE:-2}"');
    expect(source).toContain('Deployment-origin E2E evidence requires tagged or in-scope REQ attribution');
    expect(source).toContain('refusing _compliance-docs fallback');
    expect(source).toContain('--meta-key source_event=${PRIOR_EVENT}');
    expect(source).toContain('--meta-key source_workflow=E2E_Regression');
    expect(source).toContain('${STAGE:-2}:${E2E_ENVIRONMENT}:${DERIVED_RELEASE}');
  });

  it('records deployment and smoke as distinct always-finalized production cycles', () => {
    const source = template('post-deploy-prod.yml.template');
    expect(source.indexOf('Start production deployment cycles')).toBeLessThan(
      source.indexOf('Probe production health independently'),
    );
    expect(source).toContain('Complete production deployment cycles\n        if: always()');
    expect(source).toContain('--cycle-kind deployment');
    expect(source).toContain('--cycle-kind smoke');
    expect(source).toContain('Complete production smoke cycles\n        if: always()');
    expect(source).toContain("if: steps.production_smoke.outcome == 'success'");
    expect(source).toContain('Production Evidence Completeness');
    expect(source).toContain('Probe production health independently');
    expect(source).toContain('production_health_timeout');
    expect(source).toContain('host-deployment-result.env');
    expect(source).toContain('deployment_status_timeout');
    expect(source).toContain('hostVerification:$hostVerification');
    expect(source).toContain('deployment_status:\n    types: [created]');
    expect(source).toContain("github.event.deployment_status.state == 'success'");
    expect(source).toContain("endsWith(github.event.deployment.environment, '/ production')");
    expect(source).toContain("endsWith(github.event.deployment.environment, '/production')");
    expect(source).toContain('GIT_SHA: ${{ github.event.deployment.sha || github.sha }}');
  });

  it('only fans out E2E JSON to requirements whose tests executed in that result', () => {
    const source = template('ci.yml.template');
    expect(source).toContain('has_req_tagged_e2e_result()');
    expect(source).toContain('has_req_tagged_e2e_result "$REQ_ID" ci-evidence/e2e-results.json');
    expect(source).toContain('Not attaching generic E2E JSON to ${REQ_ID}');
    expect(source).toContain('Run-level evidence remains on _compliance-docs');
    expect(source).toContain("result.get('status') not in {'skipped', 'interrupted'}");
  });

  it('bounds post-merge E2E and retains terminal timeout evidence', () => {
    const source = reference('e2e-regression-3-tier.yml');
    expect(source).toContain('timeout-minutes: 55');
    expect(source).toContain('timeout --signal=TERM --kill-after=60s 40m npx playwright test');
    expect(source).toContain('e2e-regression-metadata.json');
    expect(source).toContain('outcome: "running"');
    expect(source).toContain('OUTCOME="timed_out"');
    expect(source).toContain('test_server_start');
    expect(source).toContain('test_server_stop');
    expect(source).toContain('if: always()');
    expect(source).toContain('test-results/');
    expect(source).toContain('e2e-server.log');
    expect(source).toContain('deployment_status:\n    types: [created]');
    expect(source).toContain("github.event_name == 'deployment_status'");
    expect(source).toContain("endsWith(github.event.deployment.environment, '/ production')");
    expect(source).toContain("endsWith(github.event.deployment.environment, '/production')");
  });

  it('runs self-hosted runner prerequisite preflight before quality gates', () => {
    const source = template('ci.yml.template');
    expect(source.indexOf('Validate self-hosted runner prerequisites')).toBeLessThan(
      source.indexOf('Start authoritative quality-gate cycle'),
    );
    expect(source).toContain('DEVAUDIT_RUNNER_ENVIRONMENT: ${{ runner.environment }}');
    expect(source).toContain('bash scripts/check-self-hosted-runner.sh');
  });
});
