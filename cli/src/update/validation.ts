import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { isDir, listFiles, fileBasename, exists } from '../lib/fs-utils.js';

const TIER_1_DOCS = ['Test_Policy.md', 'Test_Strategy.md', 'Test_Architecture.md'];

/**
 * Post-sync validation. Surfaces warnings that don't fail the sync but the
 * operator should see before committing.
 */
export async function runValidation(projectPath: string): Promise<readonly string[]> {
  const warnings: string[] = [];
  const workflowsDir = join(projectPath, '.github', 'workflows');
  if (await isDir(workflowsDir)) {
    const ymls = await listFiles(workflowsDir, (n) => n.endsWith('.yml'));
    for (const wf of ymls) {
      const content = await fs.readFile(wf, 'utf-8');
      const name = fileBasename(wf);
      if (content.includes('push:') && !content.includes('pull_request:')) {
        const dead = (content.match(/event_name.*pull_request/g) ?? []).length;
        if (dead > 0) {
          warnings.push(`${name} has ${dead} dead 'event_name == pull_request' condition(s) (push-only trigger)`);
        }
      }
      if (/require.*package\.json.*version/i.test(content)) {
        warnings.push(`${name} uses package.json for version (should be date-based)`);
      }
      if (content.includes('raw.githubusercontent.com/metasession-dev/devaudit')) {
        warnings.push(`${name} downloads from DevAudit at runtime (should use local scripts)`);
      }
    }
  }
  const sdlcDir = join(projectPath, 'SDLC');
  if (await isDir(sdlcDir)) {
    for (const doc of TIER_1_DOCS) {
      if (!(await exists(join(sdlcDir, doc)))) {
        warnings.push(`Missing Tier 1 doc: SDLC/${doc}`);
      }
    }
  }
  return warnings;
}
