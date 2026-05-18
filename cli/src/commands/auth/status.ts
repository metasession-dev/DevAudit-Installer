import { resolveToken } from '../../lib/auth.js';
import { DevAuditClient, DevAuditApiError } from '../../lib/devaudit-api.js';
import { logger } from '../../lib/logger.js';

export async function runAuthStatus(): Promise<void> {
  const log = logger();
  const resolved = await resolveToken();
  if (!resolved) {
    log.warn('Not logged in. Run `devaudit auth login` or set DEVAUDIT_USER_TOKEN.');
    process.exit(3);
  }
  log.info(`Token source: ${resolved.source === 'env' ? 'DEVAUDIT_USER_TOKEN env var' : '~/.config/devaudit/auth.json'}`);
  log.info(`Portal:       ${resolved.baseUrl}`);
  log.info('Verifying token against portal...');
  try {
    const client = new DevAuditClient({ token: resolved.token, baseUrl: resolved.baseUrl });
    const projects = await client.listProjects();
    log.success(`Token is valid. Accessible projects: ${projects.length}`);
    for (const p of projects.slice(0, 10)) {
      log.log(`  • ${p.slug}`);
    }
    if (projects.length > 10) log.log(`  ... and ${projects.length - 10} more`);
  } catch (err) {
    if (err instanceof DevAuditApiError) {
      log.error(`Portal rejected the token (HTTP ${err.status}). Re-run \`devaudit auth login\`.`);
      process.exit(3);
    }
    log.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
