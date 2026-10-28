import { execa } from 'execa';

/**
 * devaudit-installer#956 — TypeScript ports of the REQ-to-commit lookups in
 * the framework scripts, so `devaudit doctor` can answer the same question
 * the scripts do without shelling out to files a consumer may not have.
 *
 * Ports of (keep them in step; doctor.test.ts pins the guard port to the bash
 * original on a shared fixture):
 *   - listReqsInCommits  <- sdlc/files/_common/scripts/list-reqs-in-range.sh
 *   - reqHasCommits      <- req_has_commits_in_range() in
 *                           sdlc/files/_common/scripts/generate-bundled-changes.sh
 */

export interface CommitMessage {
  readonly subject: string;
  readonly body: string;
}

async function gitOk(repoRoot: string, args: readonly string[]): Promise<string | null> {
  const res = await execa('git', [...args], { cwd: repoRoot, reject: false, timeout: 30_000 });
  return res.exitCode === 0 ? res.stdout.trim() : null;
}

export async function refExists(repoRoot: string, ref: string): Promise<boolean> {
  return (await gitOk(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) !== null;
}

/**
 * Same default lower bound as list-reqs-in-range.sh: the last tag reachable
 * from `until`, else the merge-base with origin/main (or main). Null when
 * neither exists (the caller then scans all of `until`'s history).
 */
export async function defaultSinceRef(repoRoot: string, until = 'HEAD'): Promise<string | null> {
  const tag = await gitOk(repoRoot, ['describe', '--tags', '--abbrev=0', until]);
  if (tag) return tag;
  for (const base of ['origin/main', 'main']) {
    if (!(await refExists(repoRoot, base))) continue;
    const mb = await gitOk(repoRoot, ['merge-base', base, until]);
    if (mb) return mb;
  }
  return null;
}

/** Commit messages in `since..until` (or all of `until` when `since` is null). */
export async function commitsInRange(
  repoRoot: string,
  since: string | null,
  until: string,
): Promise<readonly CommitMessage[]> {
  const range = since ? `${since}..${until}` : until;
  const res = await execa('git', ['log', range, '--format=%x1e%s%x1f%b'], { cwd: repoRoot, reject: false, timeout: 30_000 });
  if (res.exitCode !== 0) return [];
  return res.stdout
    .split('\x1e')
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const [subject = '', ...rest] = chunk.replace(/\r/g, '').split('\x1f');
      return { subject: subject.trim(), body: rest.join('\x1f') };
    });
}

/**
 * Distinct REQ ids referenced by `[REQ-x]` subject tags and `Ref: REQ-x`
 * trailers, upper-cased and sorted; commits carrying a `Release-Closeout:`
 * marker are skipped. Mirrors list-reqs-in-range.sh exactly.
 */
export function listReqsInCommits(commits: readonly CommitMessage[]): readonly string[] {
  const out = new Set<string>();
  for (const { subject, body } of commits) {
    if (/^Release-Closeout:[ \t]*REQ-[0-9]{3,}/m.test(body)) continue;
    for (const m of subject.matchAll(/\[REQ-[0-9]+\]/g)) out.add(m[0].slice(1, -1).toUpperCase());
    for (const m of body.matchAll(/Ref:[ \t]*(REQ-[0-9]+)/gi)) out.add((m[1] ?? '').toUpperCase());
  }
  return [...out].sort();
}

/**
 * True when a commit carries `[REQ-x]` or `Ref: REQ-x` (exact id; REQ-1 does
 * not match REQ-10). Mirrors req_has_commits_in_range() in
 * generate-bundled-changes.sh: `git log --grep "\[REQ-x\]|Ref:[[:space:]]*REQ-x([^0-9]|$)"`
 * over the whole message, case-sensitive, and — unlike list-reqs-in-range.sh —
 * NOT skipping `Release-Closeout:` commits.
 */
export function reqHasCommits(commits: readonly CommitMessage[], req: string): boolean {
  if (!/^REQ-[0-9]+$/.test(req)) return false;
  const re = new RegExp(`\\[${req}\\]|Ref:[ \\t]*${req}([^0-9]|$)`, 'm');
  return commits.some(({ subject, body }) => re.test(`${subject}\n${body}`));
}
