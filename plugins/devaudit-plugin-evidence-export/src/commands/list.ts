import type { PluginContext } from '@metasession.co/devaudit-plugin-sdk';
import { EvidenceApi } from '../api/client.js';
import { resolveAuth } from '../util/token.js';

export async function list(ctx: PluginContext, args: readonly string[]): Promise<void> {
  const projectSlug = args[0];
  if (!projectSlug) {
    ctx.logger.error('Usage: devaudit evidence-export list <project-slug>');
    return;
  }
  const sdlcBaseUrl = (ctx.sdlcConfig['devaudit'] as { base_url?: string } | undefined)?.base_url;
  const { token, baseUrl } = resolveAuth(sdlcBaseUrl);
  const api = new EvidenceApi({ token, baseUrl });
  const summaries = await api.listRequirements(projectSlug);
  if (summaries.length === 0) {
    ctx.logger.info(`No evidence for project '${projectSlug}'.`);
    return;
  }
  ctx.logger.info(`Project '${projectSlug}' — ${summaries.length} requirement(s):`);
  for (const s of summaries) {
    ctx.logger.info(
      `  ${s.requirement_id}: ${s.evidence_count} file(s)${s.latest_upload ? ` (latest ${s.latest_upload})` : ''}`,
    );
  }
  ctx.emit({
    type: 'evidence-export-list',
    payload: { projectSlug, requirementCount: summaries.length },
  });
}
