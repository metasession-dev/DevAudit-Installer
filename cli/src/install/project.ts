import { DevAuditClient } from '../lib/devaudit-api.js';
import type { InstallContext, InstallPlan, StepResult } from './types.js';

export async function findOrCreateProject(
  ctx: InstallContext,
  plan: InstallPlan,
): Promise<StepResult> {
  if (ctx.dryRun) {
    return {
      step: '5/12 Find or create DevAudit project',
      status: 'planned',
      message: `would create or find project slug='${plan.projectSlug}' on ${ctx.baseUrl}`,
    };
  }
  const client = new DevAuditClient({ token: ctx.token, baseUrl: ctx.baseUrl });
  const existing = await client.getProjectBySlug(plan.projectSlug);
  if (existing) {
    plan.projectId = existing.id;
    return {
      step: '5/12 Find or create DevAudit project',
      status: 'ok',
      message: `project '${plan.projectSlug}' already exists (id ${existing.id.slice(0, 8)}…) — skipping creation`,
      data: { projectId: existing.id, created: false },
    };
  }
  const created = await client.createProject(plan.projectSlug, plan.projectSlug);
  plan.projectId = created.id;
  return {
    step: '5/12 Find or create DevAudit project',
    status: 'ok',
    message: `project '${plan.projectSlug}' created (id ${created.id.slice(0, 8)}…)`,
    data: { projectId: created.id, created: true },
  };
}
