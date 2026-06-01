import { DevAuditClient } from '../lib/devaudit-api.js';
import type { InstallContext, InstallPlan, StepResult } from './types.js';

const KEY_NAME = 'Onboarding-issued';

export async function issueApiKey(ctx: InstallContext, plan: InstallPlan): Promise<StepResult> {
  if (ctx.installMode === 'developer') {
    return {
      step: '6/12 Issue project API key',
      status: 'skipped',
      message:
        "developer mode — leaving the project's 'Onboarding-issued' API key untouched (the team key is already configured by the project operator).",
    };
  }
  if (ctx.dryRun) {
    return {
      step: '6/12 Issue project API key',
      status: 'planned',
      message: `would issue API key named '${KEY_NAME}' on project '${plan.projectSlug}' (if not already present)`,
    };
  }
  if (!plan.projectId) {
    throw new Error('projectId missing from plan — step 5 must run before step 6.');
  }
  const client = new DevAuditClient({ token: ctx.token, baseUrl: ctx.baseUrl });
  const existing = await client.listApiKeys(plan.projectId);
  const live = existing.find((k) => k.name === KEY_NAME && k.revoked_at === null);
  if (live) {
    return {
      step: '6/12 Issue project API key',
      status: 'warn',
      message: `'${KEY_NAME}' API key already exists — revoke it in the portal and re-run, or set DEVAUDIT_API_KEY manually`,
    };
  }
  const issued = await client.issueApiKey(plan.projectId, KEY_NAME);
  plan.apiKey = issued.plainTextKey;
  return {
    step: '6/12 Issue project API key',
    status: 'ok',
    message: `issued (will be stored as repo secret DEVAUDIT_API_KEY)`,
  };
}
