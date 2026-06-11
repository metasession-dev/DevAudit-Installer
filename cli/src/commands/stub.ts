import { logger } from '../lib/logger.js';

interface StubInfo {
  readonly command: string;
  readonly summary: string;
  readonly trackedIn?: string;
}

export function makeStub(info: StubInfo): () => Promise<never> {
  return async () => {
    const log = logger();
    log.warn(`\`devaudit ${info.command}\` is not implemented yet.`);
    log.info(info.summary);
    if (info.trackedIn) {
      log.info(`Tracked in: ${info.trackedIn}`);
    }
    log.info(
      'File an issue at https://github.com/metasession-dev/DevAudit-Installer/issues if you need this command.',
    );
    process.exit(1);
  };
}
