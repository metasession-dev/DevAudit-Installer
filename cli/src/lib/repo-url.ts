import { execa } from 'execa';

/**
 * The portal needs a repository URL to create a project (`repo_url` is required since metasession-dev/devaudit#826; it is
 * never verified against GitHub). This reads it from the repository's `origin` remote as an https address, with any
 * credentials in the remote removed: a remote like `https://user:token@host/org/repo.git` must never be sent anywhere.
 */

const HOST = /^[A-Za-z0-9.-]+$/;

/** An https URL from a git remote (https, http, ssh, git or scp-like `git@host:org/repo.git`), or null when it is none of those. */
export function normalizeRemoteUrl(remote: string): string | null {
  const raw = remote.trim();
  if (raw === '') return null;
  let host: string;
  let path: string;
  let port = '';
  if (raw.includes('://')) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (!['http:', 'https:', 'ssh:', 'git:'].includes(u.protocol)) return null;
    host = u.hostname;
    // Only an https or http remote's port is part of the web address; an ssh or git port is not.
    port = u.protocol === 'http:' || u.protocol === 'https:' ? u.port : '';
    path = decodeURIComponent(u.pathname);
  } else {
    const colon = raw.indexOf(':');
    if (colon <= 0) return null;
    const left = raw.slice(0, colon);
    host = left.includes('@') ? left.slice(left.lastIndexOf('@') + 1) : left;
    path = raw.slice(colon + 1);
  }
  if (!HOST.test(host)) return null;
  let p = path;
  while (p.startsWith('/')) p = p.slice(1);
  while (p.endsWith('/')) p = p.slice(0, -1);
  if (p.endsWith('.git')) p = p.slice(0, -4);
  if (p === '' || p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  return `https://${host}${port ? `:${port}` : ''}/${p}`;
}

/** The repository's web address from its `origin` remote, or null when there is no remote or it cannot be read as one. */
export async function repoUrlFromRemote(cwd: string): Promise<string | null> {
  const res = await execa('git', ['config', '--get', 'remote.origin.url'], { cwd, reject: false });
  if (res.exitCode !== 0) return null;
  return normalizeRemoteUrl(res.stdout);
}

/** What to tell a person whose repository has no usable `origin` remote. */
export const NO_REMOTE_MESSAGE =
  "The portal needs the repository's web address to create a project, and this repository has no usable `origin` remote. Add one (`git remote add origin <https address>`) and run this again.";
