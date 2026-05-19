import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
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

export async function detectStack(ctx: InstallContext): Promise<{ result: StepResult; detected: DetectedStack }> {
  const root = ctx.projectPath;
  if (await fileExists(join(root, 'pyproject.toml'))) {
    return { result: ok('python', '.'), detected: { stack: 'python', workingDirectory: '.' } };
  }
  const nested = await findPyproject(root, 1, root);
  if (nested) {
    const wd = relative(root, nested).split('/').slice(0, -1).join('/') || '.';
    return { result: ok('python', wd), detected: { stack: 'python', workingDirectory: wd } };
  }
  if (await fileExists(join(root, 'package.json'))) {
    return { result: ok('node', '.'), detected: { stack: 'node', workingDirectory: '.' } };
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
