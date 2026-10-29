import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
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

type WorkflowStep = { name?: string; run?: string; 'working-directory'?: string };
type WorkflowJob = {
  if?: string;
  permissions?: Record<string, string>;
  steps: WorkflowStep[];
};
type ReleaseWorkflow = {
  on: { workflow_dispatch: { inputs: Record<string, { default?: string; required?: boolean; options?: string[] }> } };
  jobs: Record<string, WorkflowJob>;
};

describe('@metasession.co/devaudit-core in the release (DevAudit-Installer#1116 WP1)', () => {
  const source = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
  const workflow = yamlLoad(source) as ReleaseWorkflow;

  it('publishes core after plugin-sdk and before the cli, verifies it, and pins it in the cli only', () => {
    const at = (name: string) => {
      const index = source.indexOf(name);
      expect(index, `step "${name}" is in release.yml`).toBeGreaterThanOrEqual(0);
      return index;
    };
    const sdk = at('plugin-sdk — install + build + publish');
    const core = at('core — install + build + test + publish');
    const verifyCore = at('Verify core is publicly installable');
    const pinCore = at('Pin core version in the cli');
    const cli = at('cli — install + build + publish');
    expect(sdk).toBeLessThan(core);
    expect(core).toBeLessThan(verifyCore);
    expect(verifyCore).toBeLessThan(pinCore);
    expect(pinCore).toBeLessThan(cli);
    expect(source).toContain('bash scripts/verify-npm-publication.sh @metasession.co/devaudit-core');
    const publish = workflow.jobs.publish!;
    const pin = publish.steps.find((step) => step.name === 'Pin core version in the cli');
    expect(pin?.run).toContain('.dependencies["@metasession.co/devaudit-core"] = $v');
    expect(pin?.run).toContain('cli/package.json');
    // Only the cli depends on core: the plugins are not touched by the core pin.
    expect(pin?.run).not.toContain('plugins/');
  });

  it('keeps a tag push and a manual release on the publish job, and takes it off the core prerelease run', () => {
    expect(workflow.on.workflow_dispatch.inputs.mode?.default).toBe('release');
    expect(workflow.on.workflow_dispatch.inputs.mode?.options).toEqual(['release', 'core-prerelease']);
    expect(workflow.on.workflow_dispatch.inputs.version?.required).toBe(false);
    expect(workflow.jobs.publish!.if).toBe("github.event_name == 'push' || inputs.mode != 'core-prerelease'");
    const guard = workflow.jobs.publish!.steps[0];
    expect(guard?.run).toContain('needs the \'version\' input');
  });

  it('the core prerelease job runs only from develop, publishes only core to the next tag, and releases nothing (M8)', () => {
    const job = workflow.jobs['core-prerelease'];
    expect(job).toBeDefined();
    expect(job!.if).toBe("github.event_name == 'workflow_dispatch' && inputs.mode == 'core-prerelease'");
    expect(job!.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(job!.steps[0]?.run).toContain('refs/heads/develop');
    const runs = job!.steps.map((step) => step.run ?? '').join('\n');
    expect(runs).toContain('npm publish --provenance --access public --tag next');
    expect(runs.match(/npm publish/g)).toHaveLength(1);
    const publishStep = job!.steps.find((step) => (step.run ?? '').includes('npm publish'));
    expect(publishStep?.['working-directory']).toBe('core');
    expect(runs).toContain('VER="${BASE}-next.${SHA7}"');
    expect(runs).toContain('verify-npm-publication.sh @metasession.co/devaudit-core');
    for (const forbidden of ['gh release', 'git tag', 'git push', '--tag latest', 'plugin-sdk', 'working-directory: cli']) {
      expect(runs, `the prerelease job must not contain "${forbidden}"`).not.toContain(forbidden);
    }
    for (const step of job!.steps) {
      expect(step['working-directory'] ?? '', 'no step runs in another package').not.toMatch(/^(cli|plugin-sdk|sdlc|plugins\/)/);
    }
  });
});

describe('authoritative release lifecycle workflow templates (#405)', () => {
  it('does not create a GitHub release until every npm package is publicly retrievable (#534)', () => {
    const source = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
    const verifier = readFileSync(resolve(root, 'scripts/verify-npm-publication.sh'), 'utf8');
    const verificationNames = [
      'Verify plugin-sdk is publicly installable',
      'Verify core is publicly installable',
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

  it('provenance requires a real ci.yml Quality Gates success on the latest code-bearing commit (#971)', () => {
    const source = template('quality-gates-provenance.yml.template');
    const helper = commonScript('provenance-gated-commit.sh');
    expect(source).toContain('bash scripts/provenance-gated-commit.sh gated-commit');
    expect(source).toContain('"$VERIFY" "$GATED_SHA" "$CURRENT_RUN_ID"');
    expect(source).toContain('VERIFY=real-ci-success');
    expect(source).toContain('CI_WORKFLOW_PATH: .github/workflows/ci.yml');
    expect(source).toContain('{{PATHS_IGNORE_LIST}}');
    expect(source).toContain('fetch-depth: 0');
    expect(source).toContain('does not count for code beneath it');
    expect(source).toContain('MAX_ATTEMPTS=10');
    // Hotfix dispatch path is unchanged.
    expect(source).toContain('gh workflow run ci.yml --ref "$HEAD_REF"');
    // The helper resolves each check-run's workflow run and compares .path.
    expect(helper).toContain("--jq '.path'");
    expect(helper).toContain('/actions/runs/${run_id}');
    expect(helper).toContain('"${run_path%%@*}" = "$CI_WORKFLOW_PATH"');
    expect(helper).toContain('.conclusion == \\"success\\"');
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

  it('authenticates as INSTALLER_DISPATCH_TOKEN when available so its own PR is not action_required-gated (devaudit-installer#613)', () => {
    const source = template('close-out-release.yml.template');
    // A PR authored by the default GITHUB_TOKEN (actor github-actions[bot])
    // has its own pull_request-triggered required checks stuck at
    // action_required, blocking auto-merge until a maintainer manually
    // approves each pending run — confirmed live on a consumer / devaudit#795.
    // INSTALLER_DISPATCH_TOKEN opts out of that gate by authenticating as a
    // real, already-trusted account instead; falling back to github.token
    // keeps every consumer who hasn't configured the secret unaffected.
    const expectedTokenExpr = '${{ secrets.INSTALLER_DISPATCH_TOKEN || github.token }}';
    expect(source).toContain(`GH_TOKEN: ${expectedTokenExpr}`);
    expect(source).toContain(`token: ${expectedTokenExpr}`);
    // The checkout step is the one that needs the explicit token override
    // (its default is a read-only, non-configurable github.token) —
    // confirm it's the actions/checkout step specifically, not some
    // unrelated `token:` field.
    const checkoutIdx = source.indexOf('uses: actions/checkout@v6');
    const checkoutTokenIdx = source.indexOf(`token: ${expectedTokenExpr}`);
    expect(checkoutIdx).toBeGreaterThan(-1);
    expect(checkoutTokenIdx).toBeGreaterThan(checkoutIdx);
    // devaudit-installer#815 added a clean: {{CHECKOUT_CLEAN}} line (+
    // comment) to this same `with:` block, pushing the distance past the
    // original 200-char heuristic without changing which step `token:`
    // belongs to — widened with margin for future same-block additions.
    expect(checkoutTokenIdx - checkoutIdx).toBeLessThan(400);
  });

  it('delegates advisory-scoped dependency-risk evaluation to the synced fail-closed helper', () => {
    const source = template('ci.yml.template');
    expect(source).toContain('bash "$GITHUB_WORKSPACE/scripts/evaluate-npm-audit.sh"');
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
    expect(source).toContain(
      'Deployment-origin E2E evidence requires tagged, in-scope, or nearest-ancestor REQ attribution',
    );
    expect(source).toContain('refusing _compliance-docs fallback');
    expect(source).toContain('--meta-key source_event=${PRIOR_EVENT}');
    expect(source).toContain('--meta-key source_workflow=E2E_Regression');
    expect(source).toContain('${STAGE:-2}:${E2E_ENVIRONMENT}:${DERIVED_RELEASE}');
  });

  // devaudit-installer#787 — critical (pre-merge) and regression
  // (post-deploy) E2E tiers were previously indistinguishable everywhere a
  // human looks: same workflow name, same job name, and the identical
  // portal check label "E2E Regression (${REQ})" regardless of tier.
  it('gives the critical and regression E2E tiers distinct portal check labels', () => {
    const source = template('compliance-evidence.yml.template');
    expect(source).toContain('critical)   TIER_LABEL="E2E Critical (pre-merge)" ;;');
    expect(source).toContain(
      'regression) TIER_LABEL="E2E Regression (post-deploy production)" ;;',
    );
    expect(source).toContain('--label "${TIER_LABEL} (${REQ})"');
    expect(source).not.toContain('--label "E2E Regression (${REQ})"');
  });

  // The shipped e2e-regression.yml reference template has no `push`
  // trigger (only pull_request, deployment_status, workflow_dispatch) —
  // this branch could never execute.
  it('does not carry the dead push-triggered tier-derivation branch', () => {
    const source = template('compliance-evidence.yml.template');
    expect(source).not.toContain('push)               TIER=regression; STAGE=5 ;;');
  });

  it('reports the post-deploy regression tier as not required, so it cannot deadlock UAT approval (devaudit-installer#798)', () => {
    const source = template('compliance-evidence.yml.template');
    expect(source).toContain('critical)   CHECK_REQUIRED=true ;;');
    expect(source).toContain('regression) CHECK_REQUIRED=false ;;');
    expect(source).toContain('--required "$CHECK_REQUIRED"');
    // report-release-check.sh defaults REQUIRED=true when the flag is
    // omitted — the bug this REQ fixes was exactly that omission.
    const call = source.slice(
      source.indexOf('bash scripts/report-release-check.sh'),
      source.indexOf('done', source.indexOf('bash scripts/report-release-check.sh')),
    );
    expect(call).toContain('--required');
  });

  it('resolves deployment-origin E2E REQ attribution via nearest-ancestor commit search before hard-failing (devaudit-installer#807)', () => {
    const source = template('compliance-evidence.yml.template');
    expect(source).toContain(
      "NEAREST_REQ=$(git log -1 --format=%s --grep='\\[REQ-[0-9]{3,}\\]' -E \\",
    );
    expect(source).toContain(
      "NEAREST_REQ=$(git log -1 --format=%B --grep='^Ref: REQ-[0-9]{3,}' -E \\",
    );
    expect(source).toContain(
      '::error::Deployment-origin E2E evidence requires tagged, in-scope, or nearest-ancestor REQ attribution; refusing _compliance-docs fallback.',
    );
    // The ancestry search must run strictly before the hard-fail, not after.
    expect(source.indexOf('NEAREST_REQ=')).toBeLessThan(
      source.indexOf(
        '::error::Deployment-origin E2E evidence requires tagged, in-scope, or nearest-ancestor',
      ),
    );
  });

  describe('nearest-ancestor REQ resolution git mechanism (devaudit-installer#807)', () => {
    // Exercises the exact `git log -1 --grep=...` commands the template
    // step runs, against a real git repo — proving the mechanism (not just
    // the source text) resolves correctly: nearest tagged ancestor wins,
    // an unrelated older tag further back is never reached, and a
    // trailer-only commit (e.g. a close-out commit, which cites its REQ
    // via `Ref:` rather than a `[REQ-XXX]` subject prefix) falls through
    // to the second search.
    function git(dir: string, ...args: string[]): string {
      return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    }

    function commit(dir: string, message: string): void {
      writeFileSync(join(dir, `f-${Date.now()}-${Math.random()}`), 'x');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', message);
    }

    function resolveNearestReq(dir: string, sha: string): string {
      let subjectMatch = '';
      try {
        subjectMatch = execFileSync(
          'git',
          ['log', '-1', '--format=%s', '--grep=\\[REQ-[0-9]{3,}\\]', '-E', sha],
          { cwd: dir, encoding: 'utf8' },
        );
      } catch {
        subjectMatch = '';
      }
      const subjectHit = subjectMatch.match(/\[REQ-\d+\]/)?.[0]?.replace(/[[\]]/g, '');
      if (subjectHit) return subjectHit;

      let bodyMatch = '';
      try {
        bodyMatch = execFileSync(
          'git',
          ['log', '-1', '--format=%B', '--grep=^Ref: REQ-[0-9]{3,}', '-E', sha],
          { cwd: dir, encoding: 'utf8' },
        );
      } catch {
        bodyMatch = '';
      }
      return bodyMatch.match(/REQ-\d+/)?.[0] ?? '';
    }

    function withRepo(fn: (dir: string) => void): void {
      const dir = mkdtempSync(join(tmpdir(), 'devaudit-nearest-req-'));
      try {
        git(dir, 'init', '-q', '--initial-branch=main');
        git(dir, 'config', 'user.email', 'test@example.com');
        git(dir, 'config', 'user.name', 'test');
        fn(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it('resolves the nearest [REQ-XXX]-tagged ancestor commit', () => {
      withRepo((dir) => {
        commit(dir, '[REQ-103] feat: add menu pricing window');
        commit(dir, 'chore: unrelated housekeeping commit');
        const sha = git(dir, 'rev-parse', 'HEAD').trim();
        expect(resolveNearestReq(dir, sha)).toBe('REQ-103');
      });
    });

    it('does not reach past a nearer tagged commit to an older, unrelated REQ', () => {
      withRepo((dir) => {
        commit(dir, '[REQ-050] feat: old unrelated feature');
        commit(dir, '[REQ-103] feat: add menu pricing window');
        commit(dir, 'chore: close-out housekeeping');
        const sha = git(dir, 'rev-parse', 'HEAD').trim();
        expect(resolveNearestReq(dir, sha)).toBe('REQ-103');
      });
    });

    it('falls back to a Ref: REQ-XXX trailer when no [REQ-XXX] subject exists', () => {
      withRepo((dir) => {
        commit(dir, 'compliance: close out REQ-103\n\nRef: REQ-103');
        const sha = git(dir, 'rev-parse', 'HEAD').trim();
        expect(resolveNearestReq(dir, sha)).toBe('REQ-103');
      });
    });

    it('resolves nothing when no ancestor commit is tagged at all', () => {
      withRepo((dir) => {
        commit(dir, 'chore: untracked housekeeping only');
        const sha = git(dir, 'rev-parse', 'HEAD').trim();
        expect(resolveNearestReq(dir, sha)).toBe('');
      });
    });
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
    expect(source).toContain('GIT_SHA: ${{ github.event.deployment.sha || github.event.inputs.deployed_sha || github.sha }}');
  });

  it('only fans out E2E JSON to requirements whose tests executed in that result', () => {
    const source = template('ci.yml.template');
    expect(source).toContain('has_req_tagged_e2e_result()');
    expect(source).toContain('has_req_tagged_e2e_result "$REQ_ID" ci-evidence/e2e-results.json');
    expect(source).toContain('Not attaching generic E2E JSON to ${REQ_ID}');
    expect(source).toContain('Run-level evidence remains on _compliance-docs');
    expect(source).toContain("result.get('status') not in {'skipped', 'interrupted'}");
  });

  it('fans out SAST/Dependency Audit evidence to declared-bundle co-tracked members (#819)', () => {
    const source = template('ci.yml.template');
    // Keys off the committed declared-bundle manifest, distinguished from
    // the ephemeral retroactive-absorption manifest by the same
    // "Co-Tracked Bundle Members" guard derive-release-version.sh step 0
    // uses, and filters to role == "co_tracked" only (devaudit-installer#817
    // — underscore, matching the portal's validation).
    expect(source).toContain("grep -q 'Co-Tracked Bundle Members' \"$BUNDLE_DECLARATION\"");
    expect(source).toContain('select(.role == "co_tracked") | .version');
    // Fans out both evidence types, unlike E2E's per-spec-tag gating --
    // SAST/dependency-audit apply uniformly to the whole bundle's shared diff.
    expect(source).toContain('sast-results.json -> ${MEMBER_REQ}');
    expect(source).toContain('dependency-audit.json -> ${MEMBER_REQ}');
    expect(source).toContain('{{PROJECT_SLUG}} "${MEMBER_REQ}" sast_report');
    expect(source).toContain('{{PROJECT_SLUG}} "${MEMBER_REQ}" dependency_audit');
    // #192 terminal-release skip, mirroring the existing E2E fan-out.
    expect(source).toContain('compliance/approved-releases/RELEASE-TICKET-${MEMBER_REQ}.md');
    expect(source).toContain('compliance/superseded-releases/RELEASE-TICKET-${MEMBER_REQ}.md');
    // devaudit-installer#955 — a declared bundle is ONE portal release. The
    // member's evidence keeps its own REQ as the requirement tag but is filed
    // against the bundle's release (resolve-bundle-release.sh), never a
    // release named after the member (that created orphan drafts nothing
    // ever submitted or approved, blocking the core via the portal's
    // co_tracked sibling gate).
    expect(source).toContain('MEMBER_RELEASE=$(bash scripts/resolve-bundle-release.sh "$MEMBER_REQ")');
    expect(source).toContain('--release ${MEMBER_RELEASE} --create-release-if-missing');
    expect(source).not.toContain('--release ${MEMBER_REQ} --create-release-if-missing');
    // This block must appear before the SAST/dependency-audit primary
    // uploads' section ends and the (unrelated) E2E fan-out begins, so a
    // reader sees both fan-outs are analogous, adjacent mechanisms.
    expect(source.indexOf('BUNDLE_DECLARATION=')).toBeGreaterThan(
      source.indexOf('_compliance-docs dependency_audit ci-evidence/dependency-risk-evaluation.json'),
    );
    expect(source.indexOf('BUNDLE_DECLARATION=')).toBeLessThan(
      source.indexOf('has_req_tagged_e2e_result()'),
    );
  });

  it.each(['ci.yml.template', 'feature-e2e.yml.template'])(
    'fails loudly instead of silently swallowing a stale E2E dev server on %s (#820)',
    (name) => {
      const source = template(name);
      // The old `|| true` swallowed a cross-user EPERM on a persistent
      // self-hosted runner, letting CI's own dev server fail to bind while
      // the very next wait-on step passed against the stale process
      // instead. Re-check after the kill attempt and fail the job instead
      // of limping forward against the wrong server.
      expect(source).toContain('if lsof -ti:{{E2E_PORT}} >/dev/null 2>&1; then');
      expect(source).toContain('lsof -ti:{{E2E_PORT}} | xargs kill -9 2>/dev/null || true');
      expect(source).toContain('is still held by another process after a kill attempt');
      expect(source).toContain('exit 1');
      // Unconditional, not self-hosted-only: nothing is ever listening on
      // {{E2E_PORT}} on the ephemeral github-ci path, so this is a no-op
      // there — no runner-label branching needed.
      expect(source).not.toContain("== 'github-ci'");
    },
  );

  it('e2e-regression.yml.template warms up routes on npm-run-dev, not build+start (#821)', () => {
    // #821 correction: `npm run build && npm run start` was tried on the
    // motivating consumer and reverted — it silently enables Next.js's
    // production-only Link prefetching, which broke every
    // waitForLoadState('networkidle') call with reproducible timeouts. The
    // template must encode the corrected fix, not the "obviously correct"
    // one that was already disproven, so nobody re-templates the wrong fix.
    const source = template('e2e-regression.yml.template');
    expect(source).not.toContain('npm run build');
    expect(source).toContain('Warm up dev-compiled routes');
    expect(source).toContain('page\\.goto');
    expect(source).toContain('networkidle');
  });

  it('e2e-regression.yml.template is conditionally generated, unlike every other CI_TEMPLATES entry', () => {
    const source = readFileSync(resolve(root, 'cli/src/update/ci-templates.ts'), 'utf8');
    expect(source).toContain(
      "if (tmpl === 'e2e-regression.yml.template' && !cfg.e2e_regression_enabled) continue;",
    );
    expect(source).toContain('e2e_regression_enabled');
  });

  it('e2e_regression_enabled is discoverable in sdlc-config.example.json, like other wizard-unprompted keys', () => {
    // Advanced keys the install wizard never prompts for (install_flags,
    // mypy_scoped_diff, e2e_regression_enabled) are only discoverable if
    // documented in the example config — this one was missed when #821
    // shipped (caught during an onboarding-process audit, not at review
    // time), so guard it from silently regressing again.
    const example = readFileSync(resolve(root, 'sdlc/files/sdlc-config.example.json'), 'utf8');
    expect(example).toContain('"_comment_e2e_regression"');
    expect(example).toContain('"e2e_regression_enabled": false');
    expect(() => JSON.parse(example)).not.toThrow();
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
    expect(source).toContain('bash "$GITHUB_WORKSPACE/scripts/check-self-hosted-runner.sh"');
  });

  it('hard-bounds generated dev-server readiness probes (#544)', () => {
    for (const workflow of ['ci.yml.template', 'feature-e2e.yml.template']) {
      expect(template(workflow)).toContain(
        'timeout --signal=TERM --kill-after=15s 150s npx wait-on http://localhost:{{E2E_PORT}} --timeout 120000',
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

  // #973 — link the PR before the approval gate so pr_url is set while draft.
  it('links the release PR before the approval gate and keeps the gate text and conditions (#973)', () => {
    const source = template('check-release-approval.yml.template').replace(/\r\n/g, '\n');
    const at = (s: string) => source.indexOf(`- name: ${s}`);
    const order = [
      'Resolve current release',
      'Link PR to release',
      'Post release link on PR',
      'Enforce release approval',
      'SHA comparison',
    ].map(at);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const resolve = source.slice(order[0], order[1]);
    expect(resolve).toContain('echo "approved_sha=${APPROVED_SHA}" >> "$GITHUB_OUTPUT"');
    expect(resolve).toContain('No release found for ${LOOKUP_PREFIX}');
    expect(resolve).not.toContain('case "$STATUS"');
    const enforce = source.slice(order[3], order[4]);
    expect(enforce).toContain("if: env.BOOTSTRAP_MODE != 'true' && steps.standalone.outputs.standalone != 'true'");
    expect(enforce).not.toContain('github.event_name == ');
    expect(enforce).toContain('uat_approved|prod_review|prod_approved|released)');
    expect(enforce).toContain("release approval required (have an authorised reviewer approve in DevAudit;");
    expect(enforce).toContain('exit 1');
    const link = source.slice(order[1], order[2]);
    expect(link).toContain("github.event_name == 'pull_request'");
    expect(link).toContain('prInfo');
    // The SHA comparison and the dispatch re-trigger stay behind the gate.
    expect(order[3]).toBeLessThan(source.indexOf('- name: Create refreshed PR check run'));
  });

  it('admits only declared standalone promotions without tracked portal approval', () => {
    const source = template('check-release-approval.yml.template');
    expect(source).toContain('Detect declared standalone housekeeping promotion');
    expect(source).toContain("Standalone housekeeping promotion");
    expect(source).toContain('scripts/standalone-housekeeping-release.sh validate');
    expect(source).toContain("steps.standalone.outputs.standalone != 'true'");
  });

  // devaudit-installer#788 — the re-dispatch on release-approved posted a
  // brand-new "DevAudit Release Approval" check-run instead of updating the
  // original, leaving the pre-approval failed/pending one dangling forever
  // — a likely contributor to devaudit#825's duplicate-check-run confusion.
  it('concludes the stale pre-approval check run as superseded instead of abandoning it', () => {
    const source = template('check-release-approval.yml.template');
    expect(source).toContain("--jq '.id')");
    expect(source).toContain('/commits/${TARGET_SHA}/check-runs"');
    expect(source).toContain('.conclusion != "success"');
    expect(source).toContain('-f conclusion=neutral');
    expect(source).toContain('Superseded by a later approval check');
    // Best-effort: a failure to conclude the stale run must not fail the
    // refresh itself, which already succeeded by this point.
    expect(source).toContain('::warning::Could not conclude stale');
  });

  it('makes the incomplete-client_payload PR-resolution fallback loud instead of silent', () => {
    const source = template('check-release-approval.yml.template');
    expect(source).toContain(
      "::error::client_payload incomplete (approved_sha and release_pr both missing or unresolvable)",
    );
    expect(source.indexOf('::error::client_payload incomplete')).toBeLessThan(
      source.indexOf("gh pr list --base main --json number,headRefOid,updatedAt --limit 20"),
    );
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

  it('routes e2e-scope-decision.md to its own evidence type, distinguishing deliberate no-e2e from missing coverage (#737)', () => {
    const uploader = commonScript('upload-compliance-documents.sh');
    expect(uploader).toContain('e2e-scope-decision.md)');
    expect(uploader).toContain('EVTYPE=e2e_scope_decision; EVCAT=planning ;;');
    // Sits alongside the other per-REQ SoT-alignment artefacts, not the
    // catch-all — see the #205 unrecognized-basename skip-with-warning path.
    const caseBlock = uploader.slice(
      uploader.indexOf('case "$BASENAME" in'),
      uploader.indexOf('esac', uploader.indexOf('case "$BASENAME" in')),
    );
    expect(caseBlock).toContain('risk-assessment.md)');
    expect(caseBlock).toContain('e2e-scope-decision.md)');
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

  it('retires the UAT scripts: recording and submitting UAT are portal actions (#1099)', () => {
    for (const name of ['record-uat-execution.sh', 'record-uat-execution.test.sh', 'submit-for-uat-review.sh']) {
      expect(existsSync(join(root, 'sdlc', 'files', '_common', 'scripts', name))).toBe(false);
    }
    const skill = readFileSync(join(root, 'sdlc', 'files', '_common', 'skills', 'sdlc-implementer', 'SKILL.md'), 'utf-8');
    expect(skill).not.toContain('record-uat-execution');
    expect(skill).not.toContain('submit-for-uat-review');
    expect(skill).toContain('devaudit release check');
  });

  it('the sdlc-implementer skill makes no portal write and never holds the uploader key or PAT (#1099)', () => {
    const dir = join(root, 'sdlc', 'files', '_common', 'skills', 'sdlc-implementer');
    const skill = readFileSync(join(dir, 'SKILL.md'), 'utf-8');
    const loop = readFileSync(join(dir, 'references', 'change-request-loop.md'), 'utf-8');
    const constraints = readFileSync(join(dir, 'references', 'compliance-constraints.md'), 'utf-8');
    const callGraph = readFileSync(join(dir, 'references', 'call-graph.md'), 'utf-8');
    // No instruction to upload, create a release, or record triage from the session.
    for (const text of [skill, loop, constraints, callGraph]) {
      expect(text).not.toMatch(/^\s*devaudit push /m);
      expect(text).not.toContain('--create-release-if-missing --environment');
      expect(text).not.toContain('report-test-execution.sh resolve --');
      expect(text).not.toContain('falls back to the uploader key');
    }
    expect(skill).not.toContain('bash scripts/upload-evidence.sh {{PROJECT_SLUG}}');
    // Phase 0 states the model and carries the canonical per-step table.
    expect(skill).toContain('an agent holds neither the uploader key nor the PAT');
    expect(skill).toContain('Who does what, step by step.');
    expect(skill).toContain('Never run `devaudit install`, `join`, `auth`, `doctor --fix` or `doctor --fleet`.');
    // Evidence reaches the portal through CI; state is read with release status.
    expect(skill).toContain('`Compliance Evidence Upload`');
    expect(skill).toContain('gh run list --workflow \"Compliance Evidence Upload\" --commit <sha>');
    expect(skill).toContain('devaudit release status --json');
    expect(skill).toContain('Resolving a failed execution is a portal action by a **project admin**');
    expect(skill).toContain('pending metasession-dev/devaudit#918');
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

  // devaudit-installer#786 — a missed release-closed dispatch (portal side)
  // previously had no consumer-side safety net: a release ticket could sit
  // un-reconciled in compliance/pending-releases/ forever even though its
  // code was already live on main. close-out-reconcile.yml is the scheduled
  // fallback; it detects staleness (via close-out-reconcile.sh) and
  // triggers the *existing* close-out-release.yml reconciliation rather
  // than duplicating that logic.
  describe('close-out reconciliation safety net (devaudit-installer#786)', () => {
    it('runs on a daily schedule as well as manual dispatch, and only triggers reconciliation when something is actually stale', () => {
      const source = template('close-out-reconcile.yml.template');
      expect(source).toContain('schedule:');
      expect(source).toContain("cron: '17 6 * * *'");
      expect(source).toContain('workflow_dispatch:');
      expect(source).toContain('bash scripts/close-out-reconcile.sh compliance/pending-releases');
      expect(source).toContain("if [ -z \"$STALE\" ]");
      expect(source).toContain('echo "found=false" >> "$GITHUB_OUTPUT"');
    });

    it('triggers the existing close-out-release.yml workflow_dispatch instead of duplicating its reconciliation logic', () => {
      const source = template('close-out-reconcile.yml.template');
      expect(source).toContain("gh workflow run close-out-release.yml -f \"release=${REQ}\"");
      expect(source).toContain("steps.scan.outputs.found == 'true'");
    });

    it('opens a tracking issue for auditability, best-effort, without failing the job', () => {
      const source = template('close-out-reconcile.yml.template');
      expect(source).toContain('gh issue create');
      expect(source).toContain('Release close-out reconciliation: stale pending release(s) detected');
      expect(source).toContain('|| echo "::warning::Could not open the reconciliation tracking issue."');
    });

    it('is registered in the CI template sync list', () => {
      const source = readFileSync(resolve(root, 'cli/src/update/ci-templates.ts'), 'utf8');
      expect(source).toContain("'close-out-reconcile.yml.template'");
    });

    it('close-out-reconcile.sh detects a pending ticket whose REQ already shipped to origin/main', () => {
      const source = commonScript('close-out-reconcile.sh');
      expect(source).toContain('RELEASE-TICKET-REQ-*.md');
      expect(source).toContain('git log origin/main -E --grep="\\[${REQ}\\]" --grep="Ref: ${REQ}\\$"');
    });
  });
});

describe('deferred tickets are skipped by every pending-ticket loop (#956 phase 3b)', () => {
  const SKIP_GUARD = 'if [ -f scripts/is-deferred-ticket.sh ] && bash scripts/is-deferred-ticket.sh "$TICKET"; then';
  const SKIP_LOG = 'Skipping ${REQ_ID}: deferred (Release intent: deferred-to-next)';

  it('post-deploy-prod does not promote, upload to, or PATCH a deferred release', () => {
    const source = template('post-deploy-prod.yml.template');
    const loop = source.slice(source.indexOf('Resolve in-scope releases'), source.indexOf('Start production deployment executions'));
    expect(loop).toContain('if [ -f scripts/is-deferred-ticket.sh ] && bash scripts/is-deferred-ticket.sh "$T"; then');
    expect(loop).toContain('Skipping ${PENDING_REQ}: deferred (Release intent: deferred-to-next)');
    // the skip happens before the REQ is added to the promoted set
    expect(loop.indexOf('is-deferred-ticket.sh')).toBeLessThan(loop.indexOf('REQS="${REQS} ${PENDING_REQ}"'));
    // all-deferred falls through to the existing "no tracked release ticket" path, loudly
    expect(loop).toContain('are deferred: treating this promotion as having no tracked release ticket');
    expect(loop.indexOf('are deferred: treating')).toBeLessThan(loop.indexOf('if [ -z "${REQS}" ]; then\n              chmod +x scripts/derive-release-version.sh'));
    // the standalone-housekeeping fallback is still there
    expect(loop).toContain('STANDALONE-HOUSEKEEPING-${VERSION}.json');
    expect(loop).toContain('No tracked release ticket or standalone declaration');
  });

  it('ci.yml skips deferred tickets in the E2E fan-out and the per-REQ screenshot loop', () => {
    const source = template('ci.yml.template');
    expect(source.split(SKIP_GUARD).length - 1).toBe(2);
    expect(source.split(SKIP_LOG).length - 1).toBe(2);
    expect(source.indexOf(SKIP_GUARD)).toBeLessThan(source.indexOf('E2E_REQS+=("$REQ_ID")'));
    expect(source.indexOf(SKIP_GUARD, source.indexOf('SHOT_REQS=()'))).toBeLessThan(source.indexOf('SHOT_REQS+=("$REQ_ID")'));
  });

  it('the python ci.yml in-scope evidence loop skips deferred tickets (parity with the node template)', () => {
    const source = template('python/ci.yml.template');
    expect(source).toContain(SKIP_GUARD);
    expect(source).toContain(SKIP_LOG);
    expect(source.indexOf(SKIP_GUARD)).toBeLessThan(source.indexOf('IN_SCOPE_REQS+=("$REQ_ID")'));
  });

  it('compliance-evidence.yml and upload-compliance-documents.sh skip deferred tickets', () => {
    const wf = template('compliance-evidence.yml.template');
    expect(wf).toContain(SKIP_GUARD);
    expect(wf.indexOf(SKIP_GUARD)).toBeLessThan(wf.indexOf('REQS+=("$REQ_ID")'));
    const script = commonScript('upload-compliance-documents.sh');
    expect(script).toContain('bash scripts/is-deferred-ticket.sh "$TICKET"');
    expect(script).toContain(SKIP_LOG);
  });

  it('periodic-review reports deferred tickets separately from pending ones', () => {
    const source = template('periodic-review.yml.template');
    expect(source).toContain('DEFERRED_RELEASES=$((DEFERRED_RELEASES + 1))');
    expect(source).toContain('echo "deferred_releases=${DEFERRED_RELEASES}"');
    expect(source).toContain('| Deferred releases at period end');
    expect(source).not.toContain("PENDING_RELEASES=$(find compliance/pending-releases");
  });

  it('close-out-reconcile never treats a deferred ticket as a missed close-out, but keeps the silent-absorption signal', () => {
    const script = commonScript('close-out-reconcile.sh');
    expect(script).toContain('echo "$REQ deferred"');
    const wf = template('close-out-reconcile.yml.template');
    expect(wf).toContain("sed -nE 's/^(REQ-[^ ]+) deferred$/\\1/p'");
    expect(wf).toContain("if: steps.scan.outputs.has_stale == 'true'");
    expect(wf).toContain('silent absorption');
    // #984 — stale wording only when a stale ticket was found; a deferred-only
    // finding gets its own title and no "close-out triggered" text.
    expect(wf).toContain('if [ "$HAS_STALE" = "true" ]; then');
    expect(wf).toContain('Release close-out reconciliation: deferred release(s) shipped without approval');
    expect(wf).toContain('--title "$TITLE"');
  });

  it('the helper ships in the synced scripts and is executable shell', () => {
    const helper = commonScript('is-deferred-ticket.sh');
    expect(helper).toContain("grep -qE '^- \\*\\*Release intent:\\*\\*[[:space:]]+deferred-to-next'");
  });
});

describe('integration housekeeping registers no portal release (#1020)', () => {
  const OPT_IN = 'DEVAUDIT_SKIP_INTEGRATION_HOUSEKEEPING=1';

  it('ci.yml and compliance-evidence.yml derive the version with the housekeeping opt-in on every call', () => {
    const ci = template('ci.yml.template');
    const ce = template('compliance-evidence.yml.template');
    expect(ci.split('./scripts/derive-release-version.sh)').length - 1).toBe(1);
    expect(ci.split(`${OPT_IN} DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK=1 ./scripts/derive-release-version.sh`).length - 1).toBe(1);
    // push/dispatch job + workflow_run job
    expect(ce.split('./scripts/derive-release-version.sh)').length - 1).toBe(2);
    expect(ce.split(`${OPT_IN} DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK=1 ./scripts/derive-release-version.sh`).length - 1).toBe(2);
  });

  it('the node ci.yml upload-evidence job is not run (and never creates a release called "skip") when registration was skipped', () => {
    const ci = template('ci.yml.template');
    const job = ci.slice(ci.indexOf('\n  upload-evidence:'));
    const ifLine = job.split('\n').find((l) => l.trim().startsWith('if: ${{ !cancelled()')) ?? '';
    expect(ifLine).toContain("needs.register-release.outputs.version != 'skip'");
  });

  it('release registration steps in register-release stay gated on version != skip', () => {
    const ci = template('ci.yml.template');
    const reg = ci.slice(ci.indexOf('\n  register-release:'), ci.indexOf('\n  upload-evidence:'));
    for (const step of [
      'Ensure release exists for gate-execution lineage',
      'Upload standalone housekeeping declaration',
      'Generate and upload bundled changes',
    ]) {
      const from = reg.indexOf(`- name: ${step}`);
      expect(from, step).toBeGreaterThan(-1);
      expect(reg.slice(from, from + 200), step).toContain("steps.version.outputs.version != 'skip'");
    }
  });

  it('the disabled legacy housekeeping steps are gone from compliance-evidence.yml', () => {
    const ce = template('compliance-evidence.yml.template');
    expect(ce).not.toContain('Legacy housekeeping approval path');
    expect(ce).not.toContain('Legacy housekeeping gate dispatch');
    expect(ce).not.toContain('if: ${{ false }}');
  });

  it('derive-release-version.sh documents the rule and no longer claims sync commits skip CI', () => {
    const script = commonScript('derive-release-version.sh');
    expect(script).toContain('DEVAUDIT_SKIP_INTEGRATION_HOUSEKEEPING');
    expect(script).toContain('STANDALONE-HOUSEKEEPING-<version>.json');
    expect(script).not.toMatch(/include\s+`\[skip ci\]`/);
    expect(script).not.toContain('no longer trigger CI');
  });
});

describe('post-deploy probes can carry an access header (#1022)', () => {
  const source = template('post-deploy-prod.yml.template');

  it('reads the optional DEVAUDIT_PROBE_HEADER secret once, at job level', () => {
    expect(source.split('PROBE_HEADER: ${{ secrets.DEVAUDIT_PROBE_HEADER }}').length - 1).toBe(1);
  });

  it('sends it with the health probe, the smoke check and the header check, and only when set', () => {
    const probe = source.slice(source.indexOf('Probe production health independently'), source.indexOf('Confirm terminal host deployment success'));
    expect(probe).toContain('if [ -n "${PROBE_HEADER:-}" ]; then PROBE_ARGS=(-H "$PROBE_HEADER"); fi');
    expect(probe).toContain('${PROBE_ARGS[@]+"${PROBE_ARGS[@]}"} "${PROD_URL}/"');
    const smoke = source.slice(source.indexOf('Production smoke tests (read-only)'));
    expect(smoke).toContain('if [ -n "${PROBE_HEADER:-}" ]; then PROBE_ARGS=(-H "$PROBE_HEADER"); fi');
    expect(smoke).toContain('curl -s -I ${PROBE_ARGS[@]+"${PROBE_ARGS[@]}"} "${PROD_URL}/"');
  });

  it('works under set -u with no secret: an empty array expands to nothing', () => {
    const r = execFileSync('bash', ['-c', 'set -u; PROBE_HEADER=""; PROBE_ARGS=(); if [ -n "${PROBE_HEADER:-}" ]; then PROBE_ARGS=(-H "$PROBE_HEADER"); fi; printf "[%s]" ${PROBE_ARGS[@]+"${PROBE_ARGS[@]}"}'], { encoding: 'utf8' });
    expect(r).toBe('[]');
    const withHeader = execFileSync('bash', ['-c', 'set -u; PROBE_HEADER="x-vercel-protection-bypass: tok"; PROBE_ARGS=(); if [ -n "${PROBE_HEADER:-}" ]; then PROBE_ARGS=(-H "$PROBE_HEADER"); fi; printf "[%s]" ${PROBE_ARGS[@]+"${PROBE_ARGS[@]}"}'], { encoding: 'utf8' });
    expect(withHeader).toBe('[-H][x-vercel-protection-bypass: tok]');
  });

  it('the Vercel adapter documents the secret instead of telling the operator to disable protection', () => {
    const adapter = readFileSync(resolve(root, 'sdlc/files/hosts/vercel/adapter.json'), 'utf8');
    expect(adapter).toContain('DEVAUDIT_PROBE_HEADER');
    expect(adapter).toContain('x-vercel-protection-bypass');
  });
});
