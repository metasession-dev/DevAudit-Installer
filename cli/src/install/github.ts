import { execa } from 'execa';
import type { InstallContext, InstallPlan, StepResult } from './types.js';

interface SecretSet {
  readonly action: 'secret' | 'variable';
  readonly name: string;
  readonly value: string;
}

export async function setGithubSecrets(ctx: InstallContext, plan: InstallPlan): Promise<StepResult> {
  const operations: SecretSet[] = [];
  if (plan.apiKey) operations.push({ action: 'secret', name: 'DEVAUDIT_API_KEY', value: plan.apiKey });
  operations.push({ action: 'secret', name: 'DEVAUDIT_USER_TOKEN', value: ctx.token });
  if (plan.prodUrlValue) {
    operations.push({ action: 'secret', name: plan.prodUrlSecretName, value: plan.prodUrlValue });
  }
  operations.push({ action: 'variable', name: 'DEVAUDIT_BASE_URL', value: ctx.baseUrl });
  if (ctx.dryRun) {
    const summary = operations.map((op) => `${op.action}:${op.name}`).join(', ');
    return {
      step: '7/11 Set GitHub secrets and variables',
      status: 'planned',
      message: `would set ${summary}`,
    };
  }
  const skipped: string[] = [];
  if (!plan.apiKey) skipped.push('DEVAUDIT_API_KEY (no new key issued)');
  if (!plan.prodUrlValue) skipped.push(`${plan.prodUrlSecretName} (no value provided)`);
  for (const op of operations) {
    // eslint-disable-next-line no-await-in-loop
    await runGh(op, ctx.projectPath);
  }
  const detail = `${operations.length} item(s) set${skipped.length > 0 ? ` (skipped: ${skipped.join('; ')})` : ''}`;
  return { step: '7/11 Set GitHub secrets and variables', status: 'ok', message: detail };
}

async function runGh(op: SecretSet, cwd: string): Promise<void> {
  if (op.action === 'secret') {
    await execa('gh', ['secret', 'set', op.name], { cwd, input: op.value, stdio: ['pipe', 'inherit', 'inherit'] });
  } else {
    await execa('gh', ['variable', 'set', op.name, '--body', op.value], { cwd, stdio: 'inherit' });
  }
}
