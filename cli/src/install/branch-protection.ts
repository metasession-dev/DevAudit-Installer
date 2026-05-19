import { execa } from 'execa';
import type { InstallContext, StepResult } from './types.js';

const REQUIRED_CHECKS: readonly string[] = [
  'Compliance Validation',
  'DevAudit Release Approval',
  'Quality Gates',
];

async function detectRepo(cwd: string): Promise<string | null> {
  try {
    const result = await execa('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
      cwd,
      reject: false,
    });
    if (result.exitCode !== 0) return null;
    const out = result.stdout.trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export async function configureBranchProtection(ctx: InstallContext): Promise<StepResult> {
  const repo = await detectRepo(ctx.projectPath);
  if (!repo) {
    return {
      step: '9/11 Configure branch protection',
      status: 'warn',
      message: 'could not resolve GitHub repo — configure branch protection manually in repo settings',
    };
  }
  if (ctx.dryRun) {
    return {
      step: '9/11 Configure branch protection',
      status: 'planned',
      message: `would PUT branch protection on ${repo}:main with checks=${JSON.stringify(REQUIRED_CHECKS)}`,
    };
  }
  const body = {
    required_status_checks: { strict: false, contexts: REQUIRED_CHECKS },
    enforce_admins: false,
    required_pull_request_reviews: { dismiss_stale_reviews: true, required_approving_review_count: 0 },
    restrictions: null,
  };
  const res = await execa('gh', ['api', '-X', 'PUT', `/repos/${repo}/branches/main/protection`, '--input', '-'], {
    cwd: ctx.projectPath,
    input: JSON.stringify(body),
    reject: false,
  });
  if (res.exitCode !== 0) {
    return {
      step: '9/11 Configure branch protection',
      status: 'warn',
      message: `branch protection API call failed (${res.stderr.split('\n')[0]}) — configure manually`,
    };
  }
  return {
    step: '9/11 Configure branch protection',
    status: 'ok',
    message: `required checks on main: ${REQUIRED_CHECKS.join(', ')}`,
  };
}
