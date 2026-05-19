import { resolve } from 'node:path';
import { collectFiles, uploadEvidence } from '../lib/ci-upload.js';
import { logger, isJsonMode, emitJsonResult } from '../lib/logger.js';
import { discoverPlugins, buildPluginContext, runHook, type LoadedPlugin } from '../lib/plugin/index.js';

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
  readonly dryRun?: boolean;
  readonly plugins?: readonly LoadedPlugin[];
}

const DEFAULT_BASE_URL = 'https://devaudit.metasession.co';

function buildMetadata(options: PushOptions): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (options.gitSha) metadata['gitSha'] = options.gitSha;
  if (options.ciRunId) metadata['ciRunId'] = options.ciRunId;
  if (options.branch) metadata['branch'] = options.branch;
  return metadata;
}

async function runDryRun(options: PushOptions, baseUrl: string): Promise<void> {
  const log = logger();
  const files = await collectFiles(options.filePath);
  const planned = {
    dryRun: true,
    projectSlug: options.projectSlug,
    requirementId: options.requirementId,
    evidenceType: options.evidenceType,
    baseUrl,
    files: files.map((f) => ({ path: f })),
    metadata: buildMetadata(options),
    ...(options.release !== undefined ? { release: options.release } : {}),
    ...(options.environment !== undefined ? { environment: options.environment } : {}),
    ...(options.category !== undefined ? { category: options.category } : {}),
  };
  if (isJsonMode()) {
    emitJsonResult(planned);
    return;
  }
  log.info(
    `[dry-run] Would upload ${files.length} file(s) for ${options.projectSlug}/${options.requirementId} (${options.evidenceType}) → ${baseUrl}`,
  );
  for (const f of files) log.log(`  · ${f}`);
}

export async function runPush(options: PushOptions): Promise<void> {
  const log = logger();
  const projectPath = resolve(process.cwd());
  const baseUrl = options.baseUrl ?? process.env['DEVAUDIT_BASE_URL'] ?? DEFAULT_BASE_URL;
  if (options.dryRun) {
    await runDryRun(options, baseUrl);
    return;
  }
  const apiKey = options.apiKey ?? process.env['DEVAUDIT_API_KEY'];
  if (!apiKey) {
    if (isJsonMode()) emitJsonResult({ ok: false, reason: 'missing_api_key' });
    else {
      log.error('DEVAUDIT_API_KEY env var is required (or pass --api-key).');
      log.info('Issue a project API key at: <portal>/projects/<slug>/settings → API Key Management.');
    }
    process.exit(3);
  }
  log.info(
    `Uploading ${options.filePath} (project=${options.projectSlug} req=${options.requirementId} type=${options.evidenceType}) → ${baseUrl}`,
  );
  const plugins = options.plugins ?? (await discoverPlugins()).loaded;
  if (plugins.length > 0) {
    const ctx = await buildPluginContext({ projectPath });
    await runHook(plugins, 'beforePush', ctx);
  }
  const metadata = buildMetadata(options);
  const results = await uploadEvidence({
    projectSlug: options.projectSlug,
    requirementId: options.requirementId,
    evidenceType: options.evidenceType,
    filePath: options.filePath,
    apiKey: apiKey as string,
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
  if (plugins.length > 0) {
    const ctx = await buildPluginContext({ projectPath });
    await runHook(plugins, 'afterPush', ctx);
  }
  if (isJsonMode()) {
    emitJsonResult({
      ok: failCount === 0,
      uploaded: okCount,
      failed: failCount,
      results: results.map((r) => ({ file: r.file, ok: r.ok, status: r.status, error: r.error ?? null })),
    });
  }
  if (failCount > 0) process.exit(4);
}
