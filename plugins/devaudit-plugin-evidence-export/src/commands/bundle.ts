import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PluginContext } from '@metasession-dev/devaudit-plugin-sdk';
import { EvidenceApi, type ComplianceEvidence } from '../api/client.js';
import { resolveAuth } from '../util/token.js';

interface CliArgs {
  readonly projectSlug: string;
  readonly outputDir: string;
}

interface BundleEntry {
  readonly requirement_id: string;
  readonly file_path: string;
  readonly file_name: string;
  readonly file_size_bytes: number | null;
  readonly bundled_to: string;
  readonly error?: string;
}

function parseArgs(args: readonly string[]): CliArgs | null {
  let projectSlug = '';
  let outputDir = '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--output' || a === '-o') {
      outputDir = args[i + 1] ?? '';
      i++;
    } else if (a !== undefined && !a.startsWith('-') && !projectSlug) {
      projectSlug = a;
    }
  }
  if (!projectSlug || !outputDir) return null;
  return { projectSlug, outputDir: resolve(outputDir) };
}

async function downloadOne(
  api: EvidenceApi,
  outputDir: string,
  evidence: ComplianceEvidence,
): Promise<BundleEntry> {
  const dir = join(outputDir, evidence.requirement_id);
  await fs.mkdir(dir, { recursive: true });
  const dest = join(dir, evidence.file_name);
  try {
    const signedUrl = await api.getSignedUrl(evidence.file_path);
    await api.download(signedUrl, dest);
    return {
      requirement_id: evidence.requirement_id,
      file_path: evidence.file_path,
      file_name: evidence.file_name,
      file_size_bytes: evidence.file_size_bytes,
      bundled_to: dest,
    };
  } catch (err) {
    return {
      requirement_id: evidence.requirement_id,
      file_path: evidence.file_path,
      file_name: evidence.file_name,
      file_size_bytes: evidence.file_size_bytes,
      bundled_to: dest,
      error: (err as Error).message,
    };
  }
}

export async function bundle(ctx: PluginContext, args: readonly string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (!parsed) {
    ctx.logger.error('Usage: devaudit evidence-export bundle <project-slug> --output <dir>');
    return;
  }
  const sdlcBaseUrl = (ctx.sdlcConfig['devaudit'] as { base_url?: string } | undefined)?.base_url;
  const { token, baseUrl } = resolveAuth(sdlcBaseUrl);
  const api = new EvidenceApi({ token, baseUrl });
  await fs.mkdir(parsed.outputDir, { recursive: true });
  const summaries = await api.listRequirements(parsed.projectSlug);
  const requirementsWithEvidence = summaries.filter((s) => s.evidence_count > 0);
  ctx.logger.info(
    `Bundling evidence for '${parsed.projectSlug}': ${requirementsWithEvidence.length} requirement(s) → ${parsed.outputDir}`,
  );
  const entries: BundleEntry[] = [];
  for (const summary of requirementsWithEvidence) {
    // eslint-disable-next-line no-await-in-loop
    const evidence = await api.listEvidence(parsed.projectSlug, summary.requirement_id);
    for (const e of evidence) {
      // eslint-disable-next-line no-await-in-loop
      const entry = await downloadOne(api, parsed.outputDir, e);
      entries.push(entry);
      if (entry.error) ctx.logger.error(`  ✗ ${e.requirement_id}/${e.file_name}: ${entry.error}`);
      else ctx.logger.info(`  ✓ ${e.requirement_id}/${e.file_name}`);
    }
  }
  const manifest = {
    project_slug: parsed.projectSlug,
    base_url: baseUrl,
    generated_at: new Date().toISOString(),
    total_files: entries.length,
    successful: entries.filter((e) => !e.error).length,
    failed: entries.filter((e) => e.error).length,
    entries,
  };
  await fs.writeFile(join(parsed.outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  ctx.emit({ type: 'evidence-export-bundle', payload: { total: entries.length, failed: manifest.failed } });
  ctx.logger.info(`Bundle complete: ${manifest.successful} succeeded, ${manifest.failed} failed.`);
}
