import type { GitProvider } from '../lib/git-provider/index.js';
import { DevAuditClient, isActiveApiKey } from '../lib/devaudit-api.js';
import {
  DELIVERY_AGENT_API_SECRET,
  DELIVERY_AGENT_GITHUB_SECRET,
  DELIVERY_AGENT_KEY_NAME,
  DELIVERY_AGENT_PORTAL_SECRET,
} from '../lib/delivery.js';
import type { InstallContext, InstallPlan, StepResult } from './types.js';

const STEP = '7b/12 Delivery agent: portal key and secrets';

export interface DeliveryStepDeps {
  /** Test seam: the portal client. */
  readonly client?: Pick<DevAuditClient, 'listApiKeys' | 'issueApiKey'>;
}

/**
 * DevAudit-Installer#1272, #1274 — what `install --delivery` adds on the portal and in the repository's secrets:
 *
 *  - a SECOND project API key named `delivery-agent` (role uploader, the lowest that can register a release and upload
 *    evidence), kept apart from `DEVAUDIT_API_KEY` (the one the gates use) so a release a delivery run creates names the
 *    agent as its creator and the client's approver is independent of it. A live key of that name is reused, never
 *    duplicated (the portal refuses a duplicate name): its value cannot be read back, so its secret is left as it is.
 *  - the repository secrets `DEVAUDIT_AGENT_PORTAL_KEY` (that key), `DEVAUDIT_AGENT_API_KEY` (from the environment) and,
 *    when the environment has one, `DEVAUDIT_AGENT_GITHUB_TOKEN`.
 *
 * No secret value is printed. A developer joining a project never runs it.
 */
export async function setupDelivery(
  ctx: InstallContext,
  plan: InstallPlan,
  provider: GitProvider | null,
  deps: DeliveryStepDeps = {},
): Promise<StepResult> {
  if (!ctx.delivery) return { step: STEP, status: 'skipped', message: 'no --delivery.' };
  if (ctx.installMode === 'developer') {
    return {
      step: STEP,
      status: 'skipped',
      message: `developer mode — leaving the ${DELIVERY_AGENT_KEY_NAME} key and the delivery secrets as the project operator set them. Use --force-team-config to refresh them.`,
    };
  }
  const secretNames = [DELIVERY_AGENT_API_SECRET, DELIVERY_AGENT_PORTAL_SECRET, ...(ctx.deliveryAgentGithubToken ? [DELIVERY_AGENT_GITHUB_SECRET] : [])];
  if (ctx.dryRun) {
    return {
      step: STEP,
      status: 'planned',
      message: `would issue an uploader key named '${DELIVERY_AGENT_KEY_NAME}' on project '${plan.projectSlug}' (a live one is reused) and set the repository secrets ${secretNames.join(', ')}`,
    };
  }
  if (!plan.projectId) throw new Error('projectId missing from plan — step 5 must run before step 7b.');
  if (!ctx.deliveryAgentApiKey) throw new Error(`${DELIVERY_AGENT_API_SECRET} is missing from the environment — --delivery checks it before anything is touched.`);

  const client = deps.client ?? new DevAuditClient({ token: ctx.token, baseUrl: ctx.baseUrl });
  const messages: string[] = [];
  const existing = await client.listApiKeys(plan.projectId);
  const live = existing.find((k) => k.name === DELIVERY_AGENT_KEY_NAME && isActiveApiKey(k));
  if (live) {
    messages.push(`the '${DELIVERY_AGENT_KEY_NAME}' key already exists and is reused; ${DELIVERY_AGENT_PORTAL_SECRET} is left unchanged (rotate it in the portal and rerun to replace it)`);
  } else {
    const issued = await client.issueApiKey(plan.projectId, DELIVERY_AGENT_KEY_NAME, 'uploader');
    plan.agentPortalKey = issued.plainTextKey;
    messages.push(`issued the '${DELIVERY_AGENT_KEY_NAME}' key`);
  }

  if (!provider) {
    return {
      step: STEP,
      status: 'warn',
      message: `${messages.join('; ')}; no git provider is available, so the repository secrets were not set: set ${secretNames.join(', ')} yourself (\`gh secret set <NAME>\`).`,
    };
  }
  const set: string[] = [];
  await provider.setSecret(ctx.projectPath, DELIVERY_AGENT_API_SECRET, ctx.deliveryAgentApiKey);
  set.push(DELIVERY_AGENT_API_SECRET);
  if (plan.agentPortalKey) {
    await provider.setSecret(ctx.projectPath, DELIVERY_AGENT_PORTAL_SECRET, plan.agentPortalKey);
    set.push(DELIVERY_AGENT_PORTAL_SECRET);
  }
  if (ctx.deliveryAgentGithubToken) {
    await provider.setSecret(ctx.projectPath, DELIVERY_AGENT_GITHUB_SECRET, ctx.deliveryAgentGithubToken);
    set.push(DELIVERY_AGENT_GITHUB_SECRET);
  }
  messages.push(`set ${set.join(', ')}`);
  // #1286: with no token of its own the agent gets one from the portal's GitHub App, which the client installs.
  messages.push(
    ctx.deliveryAgentGithubToken
      ? `the agent pushes with the machine user's token in ${DELIVERY_AGENT_GITHUB_SECRET} (the pilot path)`
      : `no ${DELIVERY_AGENT_GITHUB_SECRET} in the environment: the agent's GitHub token will be minted by the portal's DevAudit Agent GitHub App, which must be installed on this repository (the product path); to use a machine user's token instead, set ${DELIVERY_AGENT_GITHUB_SECRET} and run this again`,
  );
  return { step: STEP, status: 'ok', message: messages.join('; ') };
}
