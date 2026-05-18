import { deleteAuth } from '../../lib/auth.js';
import { AUTH_FILE } from '../../lib/paths.js';
import { logger } from '../../lib/logger.js';

export async function runAuthLogout(): Promise<void> {
  const log = logger();
  const existed = await deleteAuth();
  if (existed) {
    log.success(`Removed cached token at ${AUTH_FILE}.`);
  } else {
    log.info('No cached token to remove.');
  }
}
