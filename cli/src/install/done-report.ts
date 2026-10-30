import type { InstallContext, InstallPlan, StepResult } from './types.js';

/** The way from "no tests yet" to a gated release; the same four steps as docs/onboarding.md and the devaudit-configure skill. */
export function startingWithNoTestsLines(presetAOffered: boolean): string[] {
  return [
    '  Starting with no tests:',
    presetAOffered
      ? '    1. Finish on preset A (smoke only is not yet a gate), or on `custom` if you want a different person to approve.'
      : '    1. Finish on `custom` (preset A is not offered: this portal does not allow a solo approver yet).',
    '    2. Use the e2e-test-engineer skill to write the first smoke tests (a requirement and an approved plan come first).',
    '    3. Run `devaudit doctor`; the test-tiers check should now pass.',
    '    4. Run `devaudit configure` to enable critical or full when those tests exist.',
    '',
  ];
}

export function doneReport(ctx: InstallContext, plan: InstallPlan): StepResult {
  if (ctx.installMode === 'developer') {
    const lines = [
      '',
      `  ${ctx.projectName} — local developer setup complete.`,
      '',
      '  What ran:',
      '    - Templates re-synced from DevAudit-Installer (SDLC/, scripts/, .husky/, …).',
      '    - Git hooks bootstrapped.',
      '',
      '  What was deliberately skipped (developer mode):',
      '    - sdlc-config.json (team config — already on disk).',
      "    - 'Onboarding-issued' API key (team-owned by the project operator).",
      '    - GitHub repo secrets (DEVAUDIT_USER_TOKEN, DEVAUDIT_API_KEY, DEVAUDIT_BASE_URL).',
      '    - Branch protection rules.',
      '',
      '  Verify your local install:',
      '    devaudit auth status      # confirm your personal mctok_… is valid',
      '    devaudit status .         # check framework files are present',
      '    devaudit doctor           # node ≥22, git, gh, jq, curl',
      '',
      '  See SDLC/joining-an-existing-project.md for the full second-developer guide.',
      '  Rotate team secrets only as the project operator: `devaudit install --force-team-config`.',
      '',
    ];
    return {
      step: '12/12 Done (developer mode)',
      status: 'ok',
      message: lines.join('\n'),
      data: { mode: 'developer' },
    };
  }
  const branch = 'feat/sdlc-onboarding';
  // devaudit-installer#1099 — the viewer key is per person, saved in the CLI config folder
  // (never the repo, a repo secret or .env). The value is shown only on request.
  const viewerKeyLines = plan.viewerApiKey
    ? [
        '',
        '  Your viewer key (read-only) is saved in the DevAudit config folder.',
        ...(ctx.printViewerKey
          ? [`  ⚠ Shown once because of --print-viewer-key:`, `    ${plan.viewerApiKey}`]
          : ['  It is not printed; pass --print-viewer-key to see it once.']),
      ]
    : [];
  const testLines = [
    ...(plan.testNotes ?? []).map((n) => `  ${n}`),
    ...(plan.testConfig ? [`  Test tier settings written: ${Object.keys(plan.testConfig).join(', ')}.`] : []),
  ];
  const noTestsLines = plan.onboarding?.noSmokeTests ? startingWithNoTestsLines(plan.onboarding.presetAOffered !== false) : [];
  const lines = [
    '',
    `  ${ctx.projectName} is onboarded.`,
    ...viewerKeyLines,
    ...(testLines.length > 0 ? ['', ...testLines] : []),
    '',
    '  Next steps:',
    `    cd ${ctx.projectPath}`,
    '    git status                # review the diff',
    `    git checkout -b ${branch}`,
    '    git add -A',
    `    git commit -m "feat: onboard ${plan.projectSlug} to Metasession SDLC"`,
    `    git push -u origin ${branch}`,
    // The onboarding PR targets develop, like every other PR in this
    // framework's GitFlow model — never main (devaudit#731). Line 50 below
    // already assumed develop as the working branch; this brings the two in
    // sync.
    '    gh pr create --base develop',
    '',
    ...noTestsLines,
    '  Review your test tiers any time with `devaudit doctor` (the test-tiers and',
    '    e2e-release-gate checks); if there is no smoke tier yet, the e2e-test-engineer',
    '    skill scaffolds one.',
    '',
    '  After the PR merges:',
    '    - Push a compliance/ doc to develop so compliance-evidence.yml',
    '      registers the first release in DevAudit.',
    '    - Then walk REQ-001 through SDLC/0-project-setup.md → SDLC/5-deploy-main.md.',
    '',
    '  Optional — smoother release close-out (devaudit-installer#613, devaudit#795):',
    '    Without it, a release close-out PR still completes correctly, but needs one',
    "    manual 'Approve and run' click on GitHub each time (its default token is",
    '    subject to the action_required gate on its own required checks). Set a repo',
    '    secret named INSTALLER_DISPATCH_TOKEN (a GitHub PAT — classic `repo` scope,',
    '    or fine-grained with Contents + Pull requests read/write) to skip the click.',
    '    Not created by this installer — see docs/consuming-projects.md#token-contract.',
    '',
  ];
  return {
    step: '12/12 Done',
    status: 'ok',
    message: lines.join('\n'),
    data: { nextBranch: branch, mode: 'operator' },
  };
}
