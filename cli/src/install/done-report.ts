import type { InstallContext, InstallPlan, StepResult } from './types.js';

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
  const lines = [
    '',
    `  ${ctx.projectName} is onboarded.`,
    '',
    '  Next steps:',
    `    cd ${ctx.projectPath}`,
    '    git status                # review the diff',
    `    git checkout -b ${branch}`,
    '    git add -A',
    `    git commit -m "feat: onboard ${plan.projectSlug} to Metasession SDLC"`,
    `    git push -u origin ${branch}`,
    '    gh pr create --base main',
    '',
    '  After the PR merges:',
    '    - Push a compliance/ doc to develop so compliance-evidence.yml',
    '      registers the first release in DevAudit.',
    '    - Then walk REQ-001 through SDLC/0-project-setup.md → SDLC/5-deploy-main.md.',
    '',
  ];
  return {
    step: '12/12 Done',
    status: 'ok',
    message: lines.join('\n'),
    data: { nextBranch: branch, mode: 'operator' },
  };
}
