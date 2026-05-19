import type { InstallContext, InstallPlan, StepResult } from './types.js';

export function doneReport(ctx: InstallContext, plan: InstallPlan): StepResult {
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
    step: '11/11 Done',
    status: 'ok',
    message: lines.join('\n'),
    data: { nextBranch: branch },
  };
}
