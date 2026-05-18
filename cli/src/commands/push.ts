import { uploadEvidence } from '../lib/ci-upload.js';
import { logger } from '../lib/logger.js';

export interface PushOptions {
  readonly projectSlug: string;
  readonly requirementId: string;
  readonly evidenceType: string;
  readonly filePath: string;
  readonly release?: string;
  readonly createReleaseIfMissing?: boolean;
  readonly environment?: string;
  readonly category?: string;
  readonly gitSha?: string;
  readonly ciRunId?: string;
  readonly branch?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
}

const DEFAULT_BASE_URL = 'https://devaudit.metasession.co';

export async function runPush(options: PushOptions): Promise<void> {
  const log = logger();
  const apiKey = options.apiKey ?? process.env['DEVAUDIT_API_KEY'];
  if (!apiKey) {
    log.error('DEVAUDIT_API_KEY env var is required (or pass --api-key).');
    log.info('Issue a project API key at: <portal>/projects/<slug>/settings → API Key Management.');
    process.exit(3);
  }
  const baseUrl = options.baseUrl ?? process.env['DEVAUDIT_BASE_URL'] ?? DEFAULT_BASE_URL;
  const metadata: Record<string, unknown> = {};
  if (options.gitSha) metadata['gitSha'] = options.gitSha;
  if (options.ciRunId) metadata['ciRunId'] = options.ciRunId;
  if (options.branch) metadata['branch'] = options.branch;
  log.info(
    `Uploading ${options.filePath} (project=${options.projectSlug} req=${options.requirementId} type=${options.evidenceType}) → ${baseUrl}`,
  );
  const results = await uploadEvidence({
    projectSlug: options.projectSlug,
    requirementId: options.requirementId,
    evidenceType: options.evidenceType,
    filePath: options.filePath,
    apiKey,
    baseUrl,
    ...(options.release !== undefined ? { releaseVersion: options.release } : {}),
    ...(options.createReleaseIfMissing !== undefined
      ? { createReleaseIfMissing: options.createReleaseIfMissing }
      : {}),
    ...(options.environment !== undefined ? { environment: options.environment } : {}),
    ...(options.category !== undefined ? { evidenceCategory: options.category } : {}),
    metadata,
  });
  let okCount = 0;
  let failCount = 0;
  for (const result of results) {
    if (result.ok) {
      okCount++;
      log.success(`  ✓ ${result.file} (HTTP ${result.status})`);
    } else {
      failCount++;
      log.error(`  ✗ ${result.file} (HTTP ${result.status}): ${result.error ?? '(no detail)'}`);
    }
  }
  log.log('');
  log.info(`Uploaded: ${okCount} succeeded, ${failCount} failed.`);
  if (failCount > 0) process.exit(4);
}
