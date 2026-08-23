import { execa } from 'execa';

/**
 * Resolve the git repository's top-level directory for `cwd`. Several sync
 * targets (`.github/workflows`, `.github/ISSUE_TEMPLATE`, `.devin/workflows`,
 * `.husky`, `.pre-commit-config.yaml`) are read by external tools (GitHub
 * Actions, git itself, Devin) from a fixed, repo-root-relative location —
 * never from wherever a particular target's `sdlc-config.json` happens to
 * live. In a single-target repo `cwd` already *is* the repo root, so this is
 * a no-op; in a polyglot monorepo (#689) where a target lives in a
 * subdirectory (e.g. `mission-control/`), writing those paths relative to
 * `cwd` instead of the repo root produces files no tool ever reads. See
 * #689 follow-up.
 *
 * Falls back to `cwd` itself when it isn't inside a git repository (or `git`
 * isn't on PATH) — same behaviour as before this existed.
 */
export async function resolveRepoRoot(cwd: string): Promise<string> {
  const res = await execa('git', ['rev-parse', '--show-toplevel'], { cwd, reject: false });
  if (res.exitCode === 0 && res.stdout.trim().length > 0) {
    return res.stdout.trim();
  }
  return cwd;
}
