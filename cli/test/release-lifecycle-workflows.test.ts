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

  it('arms auto-merge on the close-out PR and best-effort reports it as opened (devaudit#620/#740)', () => {
    const source = template('close-out-release.yml.template');
    // Auto-merge is armed right after PR creation, not gated on it succeeding
    // (a rerun where the PR already exists should still get auto-merge armed).
    expect(source.indexOf('gh pr create --base develop')).toBeLessThan(
      source.indexOf('gh pr merge "$BRANCH" --auto --merge'),
    );
    expect(source).toContain('gh pr merge "$BRANCH" --auto --merge');
    // The pr_opened report step must never fail the job — devaudit may not
    // yet accept status=pr_opened until #740 is deployed there.
    expect(source).toContain('Report close-out PR opened');
    expect(source).toContain('continue-on-error: true');
    expect(source).toContain('status:"pr_opened"');
    expect(source.indexOf('Report close-out PR opened')).toBeGreaterThan(
      source.indexOf('gh pr merge "$BRANCH" --auto --merge'),
    );
  });

  it('never lets a jq failure while building the pr_opened payload silently abort the report step (devaudit-installer#601)', () => {
    const source = template('close-out-release.yml.template');
    // Every jq call feeding a later variable inside "Report close-out PR
    // opened" is guarded with `|| true` so a parse failure can't trip
    // `set -e` and abort the script before the intended warning fires.
    expect(source).toContain("jq -r '.number // empty' <<<\"${PR_JSON:-{}}\" 2>/dev/null || true");
    expect(source).toContain("jq -r '.url // empty' <<<\"${PR_JSON:-{}}\" 2>/dev/null || true");
    expect(source).toContain("jq -r '.latest.id // empty' <<<\"${RELEASE:-{}}\" 2>/dev/null || true");
    expect(source).toContain("jq -r '.latest.version // empty' <<<\"${RELEASE:-{}}\" 2>/dev/null || true");
    // The resolve-release curl call is guarded too, so a non-2xx response
    // (--fail-with-body) can't abort the script ahead of the existing
    // "Unable to resolve" warning branch.
    expect(source).toContain('--data-urlencode "versionPrefix=${REQ}" || true)"');
    // Resolved values are logged so a future failure is diagnosable from
    // the Actions log alone, without needing after-the-fact DB forensics.
    expect(source).toContain("Resolved close-out PR for ${BRANCH}: number='${NUMBER}' url='${URL}'");
    expect(source).toContain("Resolved portal release for ${REQ}: id='${RELEASE_ID}' version='${RELEASE_VERSION}'");
    // The resolved PR number is validated as a bare integer before being
    // passed to `--argjson` (which requires valid JSON) — this is the most
    // plausible trigger for the original parse error.
    expect(source).toContain("is not a bare integer");
    // The POST payload is built into its own variable with its own `||`
    // guard, so a jq failure there is caught at the exact point it occurs
    // — not masked by the step-level `continue-on-error: true` with no
    // warning ever posted.
    const payloadAssignIdx = source.indexOf('PAYLOAD="$(jq -nc');
    const payloadGuardIdx = source.indexOf('Failed to build the pr_opened payload');
    const curlDataIdx = source.indexOf('--data "$PAYLOAD"');
    expect(payloadAssignIdx).toBeGreaterThan(-1);
    expect(payloadGuardIdx).toBeGreaterThan(payloadAssignIdx);
    expect(curlDataIdx).toBeGreaterThan(payloadGuardIdx);
  });

  it('self-reports close-out completion instead of depending solely on the pull_request:closed webhook (devaudit-installer#602)', () => {
    const source = template('close-out-release.yml.template');
    // The new step must exist, run after the PR is opened/auto-merge armed,
    // and never fail the job — it's a best-effort supplement to
    // close-out-completion.yml, not a replacement for it.
    const openIdx = source.indexOf('gh pr merge "$BRANCH" --auto --merge');
    const waitIdx = source.indexOf('Wait for close-out PR merge and report completion');
    expect(openIdx).toBeGreaterThan(-1);
    expect(waitIdx).toBeGreaterThan(openIdx);

    const step = source.slice(waitIdx);
    expect(step).toContain('continue-on-error: true');

    // It polls rather than assuming the merge already happened, and treats
    // a manual close (no merge) as a distinct, non-error outcome.
    expect(step).toContain('gh pr view "$BRANCH" --repo "$GITHUB_REPOSITORY" --json state,mergedAt,mergeCommit,number,url');
    expect(step).toContain('if [ "$STATE" = "MERGED" ]');
    expect(step).toContain('if [ "$STATE" = "CLOSED" ]');
    expect(step).toContain('was closed without merging; not reporting completion.');

    // A bounded timeout backs off to the existing manual catch-up path
    // instead of hanging the job or failing it outright.
    expect(step).toContain('did not merge within');
    expect(step).toContain('workflow_dispatch');

    // Resolved values are guarded and logged the same way as the sibling
    // pr_opened step (devaudit-installer#601) — no silent jq/curl aborts.
    expect(step).toContain("jq -r '.number // empty' <<<\"$PR_JSON\" 2>/dev/null || true");
    expect(step).toContain("jq -r '.mergeCommit.oid // empty' <<<\"$PR_JSON\" 2>/dev/null || true");
    expect(step).toContain('is not a bare integer');

    // Same completion shape as close-out-completion.yml's own report, so
    // the portal-side handler doesn't need a second code path.
    expect(step).toContain('status:"completed"');
    expect(step).toContain('mergeSha:$mergeSha');
    const payloadAssignIdx = step.indexOf('PAYLOAD="$(jq -nc');
    const payloadGuardIdx = step.indexOf('Failed to build the completion payload');
    const curlDataIdx = step.indexOf('--data "$PAYLOAD"');
    expect(payloadAssignIdx).toBeGreaterThan(-1);
    expect(payloadGuardIdx).toBeGreaterThan(payloadAssignIdx);
    expect(curlDataIdx).toBeGreaterThan(payloadGuardIdx);
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

  it('hard-bounds generated dev-server readiness probes (#544)', () => {
    for (const workflow of ['ci.yml.template', 'feature-e2e.yml.template']) {
      expect(template(workflow)).toContain(
        'timeout --signal=TERM --kill-after=15s 150s npx wait-on http://localhost:3000 --timeout 120000',
      );
    }
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

  it('uploads test-plan.md/test-cases.md/test-summary-report.md as project-level documents, not attached to any release (devaudit-installer#621)', () => {
    const uploader = commonScript('upload-compliance-documents.sh');
    expect(uploader).toContain('PROJECT_LEVEL_FLAGS=');
    expect(uploader).toContain('upload_project_level_doc()');
    expect(uploader).toContain('upload_project_level_doc compliance/test-plan.md   test_plan');
    expect(uploader).toContain('upload_project_level_doc compliance/test-cases.md  test_cases');
    expect(uploader).toContain('upload_project_level_doc compliance/test-summary-report.md compliance_document');

    const levelFn = uploader.slice(
      uploader.indexOf('upload_project_level_doc() {'),
      uploader.indexOf('\n}', uploader.indexOf('upload_project_level_doc() {')),
    );
    expect(levelFn).not.toContain('--release');
    expect(levelFn).toContain('${PROJECT_LEVEL_FLAGS}');

    // RTM.md, unlike the three above, is genuinely per-release evidence
    // (kept current per REQ, read by the portal's release-completeness
    // check) and must stay release-scoped via the original function.
    expect(uploader).toContain('upload_project_doc compliance/RTM.md rtm');
    const docFn = uploader.slice(
      uploader.indexOf('upload_project_doc() {'),
      uploader.indexOf('\n}', uploader.indexOf('upload_project_doc() {')),
    );
    expect(docFn).toContain('--release "${DERIVED_RELEASE}"');
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

  it('uploads the project-level Test Summary Report without attaching it to any release (devaudit-installer#621)', () => {
    const source = template('ci.yml.template');
    const uploadBlockStart = source.indexOf('if [ -f "compliance/test-summary-report.md" ]; then');
    const uploadBlockEnd = source.indexOf('\n          fi', uploadBlockStart);
    const uploadBlock = source.slice(uploadBlockStart, uploadBlockEnd);
    // Previously attached --release/--create-release-if-missing/
    // --environment/--sdlc-stage, contradicting this block's own comment
    // that the file is a release-independent Documents-tab baseline —
    // every release displayed this often-months-stale file as if it were
    // current per-release test evidence.
    expect(uploadBlock).not.toContain('--release');
    expect(uploadBlock).not.toContain('--create-release-if-missing');
    expect(uploadBlock).not.toContain('--environment');
    expect(uploadBlock).not.toContain('--sdlc-stage');
    expect(uploadBlock).toContain('--category planning');
    expect(uploadBlock).toContain('--git-sha');
  });

  it('generates and uploads bundled changes for bare-date housekeeping releases too, not just REQ releases (devaudit-installer#622)', () => {
    const source = template('ci.yml.template');
    expect(source).toContain('- name: Generate and upload bundled changes\n');
    expect(source).not.toContain('name: Generate and upload bundled changes (REQ releases only)');
    expect(source).not.toContain('housekeeping (bare-date) releases don\'t bundle other housekeeping.');
    expect(source).not.toContain("is housekeeping — skipping bundled changes");
  });
});
