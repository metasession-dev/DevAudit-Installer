import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const template = (name: string) =>
  readFileSync(resolve(root, 'sdlc/files/ci', name), 'utf8').replace(/\r\n/g, '\n');
const commonScript = (name: string) =>
  readFileSync(resolve(root, 'sdlc/files/_common/scripts', name), 'utf8').replace(/\r\n/g, '\n');
const reference = (name: string) =>
  readFileSync(resolve(root, 'sdlc/files/_common/skills/e2e-test-engineer/references', name), 'utf8').replace(
    /\r\n/g,
    '\n',
  );

describe('authoritative release lifecycle workflow templates (#405)', () => {
  it('does not create a GitHub release until every npm package is publicly retrievable (#534)', () => {
    const source = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
    const verifier = readFileSync(resolve(root, 'scripts/verify-npm-publication.sh'), 'utf8');
    const verificationNames = [
      'Verify plugin-sdk is publicly installable',
      'Verify CLI is publicly installable',
      'Verify Prisma plugin is publicly installable',
      'Verify evidence-export plugin is publicly installable',
      'Verify SDLC engine is publicly installable',
    ];

    for (const name of verificationNames) {
      expect(source).toContain(name);
      expect(source.indexOf(name)).toBeLessThan(source.indexOf('Create GitHub Release'));
    }
    expect(verifier).toContain('npm view "${PACKAGE_NAME}@${EXPECTED_VERSION}" version');
    expect(verifier).toContain('curl --fail --silent --show-error --location --head "$tarball_url"');
    expect(verifier).toContain('Public npm verification timed out');
  });

  it('reports a tracked close-out only after its reconciliation PR merges', () => {
    const source = template('close-out-completion.yml.template');
    expect(source).toContain("types: [closed]");
    expect(source).toContain("github.event.pull_request.merged == true");
    expect(source).toContain("startsWith(github.event.pull_request.head.ref, 'chore/close-out-')");
    expect(source).toContain('/api/ci/releases/resolve');
    expect(source).toContain('/close-out');
    expect(source).toContain('Standalone and integration housekeeping have no tracked close-out callback.');
  });

  it('reports a verified manual no-op close-out only for its merged reconciliation PR', () => {
    const source = template('close-out-release.yml.template');
    expect(source).toContain('Report verified manual close-out catch-up');
    expect(source).toContain("github.event_name == 'workflow_dispatch'");
    expect(source).toContain('headRefName,mergeCommit,number,url');
    expect(source).toContain('chore/close-out-$REQ');
    expect(source).toContain('/api/ci/releases/${RELEASE_ID}/close-out');
  });

  it('delegates advisory-scoped dependency-risk evaluation to the synced fail-closed helper', () => {
    const source = template('ci.yml.template');
    expect(source).toContain('bash scripts/evaluate-npm-audit.sh');
    expect(source).toContain('dependency-risk-evaluation.json');
    expect(source).not.toContain('UNACCEPTED=$(python3');
    expect(source).not.toContain('echo "unknown"');
  });

  it('records quality-gate lifecycle around execution and uses the upstream job result', () => {
    const source = template('ci.yml.template');
    expect(source).toContain('quality-gates:\n    name: Quality Gates\n    needs: [register-release]');
    expect(source.indexOf('Start authoritative quality-gate execution')).toBeLessThan(
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

  it('records deployment and smoke as distinct always-finalized production executions', () => {
    const source = template('post-deploy-prod.yml.template');
    expect(source.indexOf('Start production deployment executions')).toBeLessThan(
      source.indexOf('Probe production health independently'),
    );
    expect(source).toContain('Complete production deployment executions\n        if: always()');
    expect(source).toContain('--suite-kind deployment');
    expect(source).toContain('--suite-kind smoke');
    expect(source).toContain('Complete production smoke executions\n        if: always()');
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

  it('does not fan out generic gate outcomes to pending REQs', () => {
    const source = template('ci.yml.template');
    expect(source).toContain('Not fanning out gate-outcomes.json to pending REQs');
    expect(source).toContain('pending release tickets alone do');
    expect(source).toContain('not make that gate current approval evidence for every REQ');
    expect(source).not.toContain('Fanning out gate evidence to in-scope REQs');
    expect(source).not.toContain('gate-outcomes.json -> ${REQ_ID}');
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
      source.indexOf('Start authoritative quality-gate execution'),
    );
    expect(source).toContain('DEVAUDIT_RUNNER_ENVIRONMENT: ${{ runner.environment }}');
    expect(source).toContain('bash scripts/check-self-hosted-runner.sh');
  });

  it('exports the resolved DevAudit URL into the current quality-execution shell', () => {
    const source = template('ci.yml.template');
    expect(source).toContain('export DEVAUDIT_BASE_URL="${BASE%/}"');
    expect(source).toContain('echo "DEVAUDIT_BASE_URL=${DEVAUDIT_BASE_URL}" >> "$GITHUB_ENV"');
    expect(source.indexOf('export DEVAUDIT_BASE_URL')).toBeLessThan(
      source.indexOf('bash scripts/report-test-execution.sh start'),
    );
  });

  it('admits only declared standalone promotions without tracked portal approval', () => {
    const source = template('check-release-approval.yml.template');
    expect(source).toContain('Detect declared standalone housekeeping promotion');
    expect(source).toContain("Standalone housekeeping promotion");
    expect(source).toContain('scripts/standalone-housekeeping-release.sh validate');
    expect(source).toContain("steps.standalone.outputs.standalone != 'true'");
  });

  it('uploads a standalone declaration as common evidence owned by its bare-date release (#540)', () => {
    const source = template('ci.yml.template');
    expect(source).toContain('Upload standalone housekeeping declaration');
    expect(source).toContain('{{PROJECT_SLUG}} _compliance-docs release_ticket "$DECLARATION"');
    expect(source).toContain('--release "$VERSION" --create-release-if-missing');
    expect(source).not.toContain('{{PROJECT_SLUG}} "$VERSION" release_ticket "$DECLARATION"');
  });

  it('keeps untagged bare-date E2E runs out of portal approval evidence', () => {
    const source = template('compliance-evidence.yml.template');
    expect(source).toContain('No tracked REQ was executed for standalone/integration housekeeping');
    expect(source).toContain('preserving this as GitHub historical CI without portal approval evidence');
  });

  it('scopes incident report uploads to their owning release', () => {
    const source = template('compliance-evidence.yml.template');
    const uploader = commonScript('upload-compliance-documents.sh');
    expect(source).toContain('bash scripts/upload-compliance-documents.sh');
    expect(uploader).toContain('frontmatter_value()');
    expect(uploader).toContain('bundle_manifest_allows_source_release()');
    expect(uploader).toContain('missing required frontmatter incident_kind');
    expect(uploader).toContain('nil incident reports require source_release frontmatter');
    expect(uploader).toContain('incident reports require source_issue frontmatter');
    expect(uploader).toContain('source release ${TARGET_RELEASE} is not ${DERIVED_RELEASE}');
    expect(uploader).toContain('--release "${TARGET_RELEASE}"');
    expect(uploader).toContain('--evidence-scope release');
    expect(uploader).toContain('--meta-key "incident_kind=${KIND}"');
    expect(uploader).toContain('--meta-key "source_release=${TARGET_RELEASE}"');
    expect(uploader).toContain('--meta-key "semantic_id=${SEMANTIC_ID}"');
    expect(uploader).toContain('--meta-key "content_hash=${CONTENT_HASH}"');
  });

  it('exports incident reports with source ownership frontmatter', () => {
    const source = template('incident-export.yml.template');
    expect(source).toContain('Baseline-only incident export requires the issue body to reference its owning REQ-XXX');
    expect(source).toContain('SOURCE_RELEASE=$(printf');
    expect(source).toContain('incident_kind: \\"incident\\"');
    expect(source).toContain('source_release: \\"\'"${SOURCE_RELEASE}"\'\\"');
    expect(source).toContain('source_issue: \\"" + (.number|tostring) + "\\"');
    expect(source).toContain('source_issue_url: ');
    expect(source).toContain('semantic_id: \\"INC-');
  });

  it('keeps UAT submission distinct from explicit Stage 4 execution recording', () => {
    const submit = commonScript('submit-for-uat-review.sh');
    const record = commonScript('record-uat-execution.sh');
    expect(submit).toContain('Submission only moves the release into review; it does not claim UAT passed.');
    expect(submit).toContain('./scripts/record-uat-execution.sh');
    expect(record).toContain('--sdlc-stage 4');
    expect(record).toContain('--environment uat');
    expect(record).toContain('--suite-kind uat');
    expect(record).toContain('--provider manual_uat');
    expect(record).toContain('manual-uat:${PROJECT_SLUG}:${RELEASE_VERSION}:${EXECUTION_ID}');
    expect(record).toContain('executor=${EXECUTOR}; tested_sha=${TESTED_SHA}');
    expect(record).toContain('"$REPORT_TEST_EXECUTION" start');
    expect(record).toContain('"$REPORT_TEST_EXECUTION" complete');
  });
});
