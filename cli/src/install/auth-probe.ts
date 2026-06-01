import { DevAuditApiError, DevAuditClient } from '../lib/devaudit-api.js';
import type { InstallContext, StepResult } from './types.js';

export async function runAuthProbe(ctx: InstallContext): Promise<StepResult> {
  const client = new DevAuditClient({ token: ctx.token, baseUrl: ctx.baseUrl });
  try {
    await client.listProjects();
    return { step: '1/12 Authenticate', status: 'ok', message: `PAT accepted at ${ctx.baseUrl}` };
  } catch (err) {
    if (err instanceof DevAuditApiError && (err.status === 401 || err.status === 403)) {
      throw new Error(
        `PAT rejected (HTTP ${err.status}). Issue a fresh token at ${ctx.baseUrl}/settings/tokens and retry.`,
      );
    }
    throw err;
  }
}
