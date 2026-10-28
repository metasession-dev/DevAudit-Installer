import { DevAuditApiError, DevAuditClient, isActiveApiKey, viewerKeyRefusal } from '../lib/devaudit-api.js';
import { VIEWER_KEYS_FILE } from '../lib/paths.js';
import { getStoredViewerKey, saveViewerKey, viewerKeyName } from '../lib/viewer-keys.js';
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

/**
 * devaudit-installer#1099 — the person's own viewer key: read-only,
 * project-scoped, named `viewer:<user email>:<hostname>` (the portal needs a
 * non-empty name and records the creator). Issued by default for both the
 * operator (`install`) and a teammate (`join`) with their own PAT, then saved
 * to `~/.config/devaudit/viewer-keys.json`. It is never written to the repo,
 * a repo secret or `.env`, and the value is printed only with
 * `--print-viewer-key`.
 *
 * A failure here never fails the run. Members may issue their own viewer keys
 * (metasession-dev/devaudit#921); a refusal (403: the five-key cap or no access,
 * 409: a live key of that name) is reported with the portal's own reason.
 */
export async function issueViewerApiKey(
  ctx: InstallContext,
  plan: InstallPlan,
  deps: { readonly save?: typeof saveViewerKey; readonly name?: () => Promise<string> } = {},
): Promise<StepResult> {
  const step = '6b/12 Issue your viewer key';
  if (!ctx.issueViewerKey) {
    return { step, status: 'skipped', message: 'skipped (--no-viewer-key)' };
  }
  const name = await (deps.name ?? (() => viewerKeyName(ctx.repoRoot)))();
  if (ctx.dryRun) {
    return {
      step,
      status: 'planned',
      message: `would issue a viewer-role API key named '${name}' on project '${plan.projectSlug}' and save it to the CLI config folder`,
    };
  }
  if (!plan.projectId) {
    throw new Error('projectId missing from plan — step 5 must run before step 6b.');
  }
  if (await getStoredViewerKey(ctx.baseUrl, plan.projectSlug)) {
    return { step, status: 'ok', message: 'a viewer key for this project is already saved on this machine; left unchanged' };
  }
  const client = new DevAuditClient({ token: ctx.token, baseUrl: ctx.baseUrl });
  try {
    const existing = await client.listApiKeys(plan.projectId);
    if (existing.find((k) => k.name === name && isActiveApiKey(k))) {
      return {
        step,
        status: 'warn',
        message: `a live key named '${name}' exists but is not saved on this machine — revoke it in the portal and rerun, or save it with \`devaudit auth viewer-key set\``,
      };
    }
    const issued = await client.issueApiKey(plan.projectId, name, 'viewer');
    await (deps.save ?? saveViewerKey)(ctx.baseUrl, plan.projectSlug, {
      key: issued.plainTextKey,
      name,
      createdAt: new Date().toISOString(),
    });
    plan.viewerApiKey = issued.plainTextKey;
    return { step, status: 'ok', message: `issued '${name}' and saved to ${VIEWER_KEYS_FILE}` };
  } catch (err) {
    if (err instanceof DevAuditApiError && (err.status === 403 || err.status === 409)) {
      return { step, status: 'warn', message: viewerKeyRefusal(err, name) };
    }
    return {
      step,
      status: 'warn',
      message: `could not issue a viewer key (${err instanceof Error ? err.message : 'unknown error'}); rerun \`devaudit install\` or save one with \`devaudit auth viewer-key set\``,
    };
  }
}
