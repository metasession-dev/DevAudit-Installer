import { promises as fs } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { DetectedStack, InstallContext, StepResult } from './types.js';

const MAX_DEPTH = 3;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo']);

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function findPyproject(root: string, depth: number, current: string): Promise<string | null> {
  if (depth > MAX_DEPTH) return null;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name === 'pyproject.toml') {
      return join(current, e.name);
    }
  }
  for (const e of entries) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name)) {
      const found = await findPyproject(root, depth + 1, join(current, e.name));
      if (found) return found;
    }
  }
  return null;
}

/**
 * `working_directory` describes a target's location relative to the git
 * REPO ROOT (that's what CI templates `cd` into, and what GitHub Actions'
 * path-scoped triggers filter on) — never relative to wherever `devaudit
 * install` happened to be invoked from. In the common single-target case
 * `ctx.repoRoot === ctx.projectPath`, so this is a no-op ('.'). In a
 * polyglot-monorepo target living in a subdirectory (#689's `--add-target`),
 * `ctx.projectPath` is that subdirectory, not the repo root — omitting this
 * normalization silently wrote `working_directory: "."` into
 * sdlc-config.json for a target that isn't actually at the repo root,
 * breaking every repo-root-relative step downstream (namespaced CI's `cd`
 * into the target, path-scoped triggers, etc.). Also normalizes to POSIX
 * separators — see the note on `resolveTargetWorkingDir`'s Windows fix.
 */
function toRepoRelativeWorkingDirectory(ctx: InstallContext, absoluteTargetDir: string): string {
  const rel = relative(ctx.repoRoot, absoluteTargetDir).split(sep).join('/');
  return rel || '.';
}

export async function detectStack(ctx: InstallContext): Promise<{ result: StepResult; detected: DetectedStack }> {
  const root = ctx.projectPath;
  if (await fileExists(join(root, 'pyproject.toml'))) {
    const wd = toRepoRelativeWorkingDirectory(ctx, root);
    return { result: ok('python', wd), detected: { stack: 'python', workingDirectory: wd } };
  }
  const nested = await findPyproject(root, 1, root);
  if (nested) {
    const wd = toRepoRelativeWorkingDirectory(ctx, dirname(nested));
    return { result: ok('python', wd), detected: { stack: 'python', workingDirectory: wd } };
  }
  if (await fileExists(join(root, 'package.json'))) {
    const wd = toRepoRelativeWorkingDirectory(ctx, root);
    return { result: ok('node', wd), detected: { stack: 'node', workingDirectory: wd } };
  }
  throw new Error(
    'Could not detect stack — no pyproject.toml or package.json found within 3 directory levels.',
  );
}

function ok(stack: 'node' | 'python', wd: string): StepResult {
  return {
    step: '2/11 Detect stack',
    status: 'ok',
    message: `stack=${stack} working_directory=${wd} host=railway`,
    data: { stack, workingDirectory: wd, host: 'railway' },
  };
}
