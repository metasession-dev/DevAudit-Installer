import { join, relative, sep } from 'node:path';
import { detectStack as detectStackInRepo } from '@metasession.co/devaudit-core';
import { fsRepoReader } from '@metasession.co/devaudit-core/node';
import type { DetectedStack, InstallContext, StepResult } from './types.js';

// The detection itself (the `pyproject.toml` / `requirements.txt` markers up to three levels down,
// then `package.json`) lives in `@metasession.co/devaudit-core`, where the portal shares it
// (DevAudit-Installer#1116 WP3). This file adapts it to the install step.

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
  const found = await detectStackInRepo(fsRepoReader(ctx.projectPath));
  if (!found) {
    throw new Error(
      'Could not detect stack — no pyproject.toml, requirements.txt, or package.json found within 3 directory levels.',
    );
  }
  // The core reports the directory relative to `projectPath`; `working_directory` is relative to the repo root.
  const wd = toRepoRelativeWorkingDirectory(ctx, found.workingDirectory === '.' ? ctx.projectPath : join(ctx.projectPath, found.workingDirectory));
  return { result: ok(found.stack, wd), detected: { stack: found.stack, workingDirectory: wd } };
}

function ok(stack: 'node' | 'python', wd: string): StepResult {
  return {
    step: '2/12 Detect stack',
    status: 'ok',
    message: `stack=${stack} working_directory=${wd}`,
    data: { stack, workingDirectory: wd },
  };
}
