import { execa } from 'execa';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await execa('git', args, { cwd });
  return r.stdout.trim();
}

/** A consumer repo on `develop` (one commit on main) with sdlc-config.json. */
export async function fixtureRepo(config: Record<string, unknown>): Promise<string> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'devaudit-doctor-fix-'));
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'config', 'user.email', 't@example.test');
  await git(dir, 'config', 'user.name', 'T');
  await git(dir, 'config', 'commit.gpgsign', 'false');
  await fsp.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(config));
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-q', '-m', 'chore: init');
  await git(dir, 'checkout', '-q', '-b', 'develop');
  return dir;
}

export async function writeTicket(
  dir: string,
  version: string,
  o: { intent?: string; preds?: string; pr?: string } = {},
): Promise<string> {
  const lines = [`# Release Ticket: ${version} — t`, '', '**Status:** TESTED - PENDING SIGN-OFF'];
  if (o.pr) lines.push(`**PR:** ${o.pr}`);
  lines.push('', '## Bundled Changes', '');
  if (o.preds !== undefined) lines.push(`- **Absorbed predecessor releases:** ${o.preds}`);
  if (o.intent) lines.push(`- **Release intent:** ${o.intent}`);
  const d = join(dir, 'compliance', 'pending-releases');
  await fsp.mkdir(d, { recursive: true });
  const p = join(d, `RELEASE-TICKET-${version}.md`);
  await fsp.writeFile(p, lines.join('\n') + '\n');
  return p;
}

export async function writeRtm(dir: string, rows: Record<string, string>): Promise<string> {
  const lines = ['# RTM', '', '| Requirement | Description | Status |', '|---|---|---|'];
  for (const [req, status] of Object.entries(rows)) lines.push(`| ${req} | thing | ${status} |`);
  await fsp.mkdir(join(dir, 'compliance'), { recursive: true });
  const p = join(dir, 'compliance', 'RTM.md');
  await fsp.writeFile(p, lines.join('\n') + '\n');
  return p;
}
