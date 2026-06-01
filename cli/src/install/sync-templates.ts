import { syncProject } from '../update/index.js';
import type { InstallContext, StepResult } from './types.js';

export async function syncTemplates(ctx: InstallContext): Promise<StepResult> {
  if (ctx.dryRun) {
    return {
      step: '10/12 Sync SDLC templates',
      status: 'planned',
      message: `would run native syncProject() against ${ctx.projectPath}`,
    };
  }
  const report = await syncProject(ctx.projectPath);
  return {
    step: '10/12 Sync SDLC templates',
    status: 'ok',
    message: `synced ${report.totalFilesSynced} files across ${report.sections.length} sections`,
    data: { totalFilesSynced: report.totalFilesSynced },
  };
}
