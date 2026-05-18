import * as clack from '@clack/prompts';
import { writeAuth } from '../../lib/auth.js';
import { DevAuditClient, DevAuditApiError } from '../../lib/devaudit-api.js';
import { logger } from '../../lib/logger.js';

interface LoginOptions {
  readonly token?: string;
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://devaudit.metasession.co';

export async function runAuthLogin(options: LoginOptions): Promise<void> {
  const log = logger();
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  let token = options.token ?? process.env['DEVAUDIT_USER_TOKEN'];
  if (!token) {
    log.info(`Open ${baseUrl}/settings/tokens in your browser and issue a Personal Access Token.`);
    log.info('Paste the `mctok_...` value below; it never leaves this machine.');
    const result = await clack.password({
      message: 'Paste your DevAudit Personal Access Token (mctok_...):',
      validate: (val) => {
        if (!val) return 'Token is required.';
        if (!val.startsWith('mctok_')) return "Token should start with 'mctok_'.";
        return undefined;
      },
    });
    if (clack.isCancel(result)) {
      log.warn('Cancelled.');
      process.exit(0);
    }
    token = result;
  }
  log.info('Validating token against portal...');
  try {
    const client = new DevAuditClient({ token, baseUrl });
    await client.listProjects();
  } catch (err) {
    if (err instanceof DevAuditApiError && (err.status === 401 || err.status === 403)) {
      log.error('Token rejected by portal (HTTP ' + err.status + '). Check it was copied correctly + is not revoked.');
      process.exit(3);
    }
    throw err;
  }
  await writeAuth(token, baseUrl);
  log.success('Logged in. Token cached at ~/.config/devaudit/auth.json (mode 0600).');
}
