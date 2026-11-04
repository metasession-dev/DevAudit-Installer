import { defaultGh, type GhRunner } from './deploy-detect.js';

/**
 * DevAudit-Installer#1116 section 5, "Collaborator warning": how many people can push to the repository, read through
 * `gh api repos/{owner}/{repo}/collaborators`. Null when it cannot be told (no `gh`, not signed in, no origin remote, no
 * access to the list): the caller then says nothing.
 */
export async function collaboratorCount(repoRoot: string, gh: GhRunner = defaultGh): Promise<number | null> {
  const r = await gh(['api', 'repos/{owner}/{repo}/collaborators', '--jq', 'length'], repoRoot);
  if (r.exitCode !== 0) return null;
  const n = Number(r.stdout.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** The warning printed when approval by a different person is chosen and the repository has one collaborator. */
export const ONE_COLLABORATOR_WARNING =
  'Warning: you chose approval by a different person, but this repository has only one collaborator, so nobody else can approve a release yet. Add a collaborator (and a second admin on the portal) before the first release, or choose "I approve my own" to record the gap instead.';
