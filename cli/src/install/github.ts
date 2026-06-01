import type { GitProvider } from '../lib/git-provider/index.js';
import type { InstallContext, InstallPlan, StepResult } from './types.js';

interface SecretOperation {
  readonly kind: 'secret' | 'variable';
  readonly name: string;
  readonly value: string;
}

function buildOperations(ctx: InstallContext, plan: InstallPlan): SecretOperation[] {
  const operations: SecretOperation[] = [];
  if (plan.apiKey) operations.push({ kind: 'secret', name: 'DEVAUDIT_API_KEY', value: plan.apiKey });
  operations.push({ kind: 'secret', name: 'DEVAUDIT_USER_TOKEN', value: ctx.token });
  if (plan.prodUrlValue) {
    operations.push({ kind: 'secret', name: plan.prodUrlSecretName, value: plan.prodUrlValue });
  }
  operations.push({ kind: 'variable', name: 'DEVAUDIT_BASE_URL', value: ctx.baseUrl });
  return operations;
}

function buildSkipped(plan: InstallPlan): string[] {
  const skipped: string[] = [];
  if (!plan.apiKey) skipped.push('DEVAUDIT_API_KEY (no new key issued)');
  if (!plan.prodUrlValue) skipped.push(`${plan.prodUrlSecretName} (no value provided)`);
  return skipped;
}

export async function setGithubSecrets(
  ctx: InstallContext,
  plan: InstallPlan,
  provider: GitProvider,
): Promise<StepResult> {
  if (ctx.installMode === 'developer') {
    return {
      step: '7/12 Set GitHub secrets and variables',
      status: 'skipped',
      message:
        'developer mode — leaving DEVAUDIT_USER_TOKEN, DEVAUDIT_API_KEY, DEVAUDIT_BASE_URL, and the production-URL secret unchanged. Use --force-team-config to rotate them as the project operator.',
    };
  }
  const operations = buildOperations(ctx, plan);
  if (ctx.dryRun) {
    const summary = operations.map((op) => `${op.kind}:${op.name}`).join(', ');
    return {
      step: '7/12 Set GitHub secrets and variables',
      status: 'planned',
      message: `would set ${summary} via ${provider.name} provider`,
    };
  }
  for (const op of operations) {
    if (op.kind === 'secret') {
      // eslint-disable-next-line no-await-in-loop
      await provider.setSecret(ctx.projectPath, op.name, op.value);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await provider.setVariable(ctx.projectPath, op.name, op.value);
    }
  }
  const skipped = buildSkipped(plan);
  const detail = `${operations.length} item(s) set${skipped.length > 0 ? ` (skipped: ${skipped.join('; ')})` : ''}`;
  return { step: '7/12 Set GitHub secrets and variables', status: 'ok', message: detail };
}
