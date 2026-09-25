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
      message: `'${KEY_NAME}' API key already exists — revoke it in the portal and re-run, or set ${plan.apiKeySecretName} manually`,
    };
  }
  const issued = await client.issueApiKey(plan.projectId, KEY_NAME);
  plan.apiKey = issued.plainTextKey;
  return {
    step: '6/12 Issue project API key',
    status: 'ok',
    message: `issued (will be stored as repo secret ${plan.apiKeySecretName})`,
  };
}

const VIEWER_KEY_NAME = 'Onboarding-issued (viewer)';

/**
 * devaudit-installer#867 — a second, read-only, project-scoped API key,
 * issued only when the operator opts in via `--with-viewer-key`. Never
 * granted upload or approval rights: the portal's viewer role can only
 * reach the read-back endpoints (GET .../checks, GET .../cycles), so
 * handing this key to an agent or CI status check doesn't blur audit
 * attribution the way the uploader key would.
 */
export async function issueViewerApiKey(
  ctx: InstallContext,
  plan: InstallPlan,
): Promise<StepResult> {
  const step = "6b/12 Issue viewer-role API key";
  if (!plan.viewerApiKeySecretName) {
    return { step, status: 'skipped', message: 'not requested (pass --with-viewer-key to enable)' };
  }
  if (ctx.installMode === 'developer') {
    return {
      step,
      status: 'skipped',
      message:
        "developer mode — leaving the project's viewer-role API key untouched (the team key is already configured by the project operator).",
    };
  }
  if (ctx.dryRun) {
    return {
      step,
      status: 'planned',
      message: `would issue a viewer-role API key named '${VIEWER_KEY_NAME}' on project '${plan.projectSlug}' (if not already present)`,
    };
  }
  if (!plan.projectId) {
    throw new Error('projectId missing from plan — step 5 must run before step 6b.');
  }
  const client = new DevAuditClient({ token: ctx.token, baseUrl: ctx.baseUrl });
  const existing = await client.listApiKeys(plan.projectId);
  const live = existing.find((k) => k.name === VIEWER_KEY_NAME && k.revoked_at === null);
  if (live) {
    return {
      step,
      status: 'warn',
      message: `'${VIEWER_KEY_NAME}' API key already exists — revoke it in the portal and re-run, or set ${plan.viewerApiKeySecretName} manually`,
    };
  }
  const issued = await client.issueApiKey(plan.projectId, VIEWER_KEY_NAME, 'viewer');
  plan.viewerApiKey = issued.plainTextKey;
  return {
    step,
    status: 'ok',
    message: `issued (will be stored as repo secret ${plan.viewerApiKeySecretName})`,
  };
}
