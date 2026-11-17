import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRepoRoot } from '../lib/git-root.js';
import { readSdlcConfig } from '../lib/sdlc-config.js';
import { DELIVERY_AGENT_GITHUB_SECRET, DELIVERY_GIT_NAME_DEFAULT, DELIVERY_TOKEN_REFRESH_MARGIN_MS } from '../lib/delivery.js';

/**
 * DevAudit-Installer#1286 — `devaudit delivery github-token`: the GitHub token a delivery run pushes and opens its
 * pull request with. A push or pull request made with the workflow's own `GITHUB_TOKEN` starts no workflow, so the
 * release's CI would never run; the agent therefore works with one of two tokens, resolved in this order:
 *
 *  1. the repository secret `DEVAUDIT_AGENT_GITHUB_TOKEN` (the pilot path: a machine user's fine-grained token), read
 *     from the environment of the same name;
 *  2. a token the portal mints for the run from the DevAudit Agent GitHub App
 *     (`POST <portal>/api/ci/delivery-runs/<run>/github-token` with the agent key; answer `{ token, expiresAt, author }`);
 *  3. otherwise it fails, naming both options. It never falls back to the default token.
 *
 * A portal token lasts about an hour and a run can last longer, so it is fetched when needed and cached in a file
 * (mode 600, under `RUNNER_TEMP`) until ten minutes before it expires. `--credential` speaks git's credential-helper
 * protocol, so every `git push` gets a current token; the `gh` shim (`scripts/delivery-gh.sh`) does the same for `gh`.
 *
 * The token is printed only where a caller needs it: on stdout by default and with `--json`, and as the `password` of
 * `--credential`. `--mask` prints the `::add-mask::` command for the workflow log. Exit codes: 0 a token, 1 none could be
 * had (the reason on stderr), 2 a usage error.
 */

export interface GithubTokenOptions {
  readonly run?: string;
  readonly json?: boolean;
  /** Answer as a git credential helper (`get` is the only operation that prints). */
  readonly credential?: boolean;
  /** The operation git passes to a credential helper: get, store or erase. */
  readonly operation?: string;
  /** Print `::add-mask::<token>` (stdout) so the workflow log hides it. */
  readonly mask?: boolean;
  /** Append the author to the file named by `GITHUB_ENV` and report what was resolved, without printing the token. */
  readonly githubEnv?: boolean;
}

export interface GithubTokenDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  /** Folder of the cache files; defaults to `RUNNER_TEMP`, else the system temp folder. */
  readonly stateDir?: string;
  readonly cwd?: string;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** The text git passes on standard input to a credential helper. */
  readonly readStdin?: () => Promise<string>;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

export interface GitAuthor {
  readonly name: string;
  readonly email: string;
}

interface Resolved {
  readonly token: string;
  readonly expiresAt: string | null;
  readonly source: 'secret' | 'portal';
  readonly author: GitAuthor | null;
}

class TokenFailure extends Error {}

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_BASE_URL = 'https://devaudit.ai';
const MAX_ATTEMPTS = 3;

const BOTH_OPTIONS =
  `Set the repository secret ${DELIVERY_AGENT_GITHUB_SECRET} (a fine-grained token of a machine user with Contents and Pull requests read/write ` +
  'and Issues read on this repository: the pilot path), or install the DevAudit Agent GitHub App on this repository (the product path).';

async function resolveBaseUrl(env: NodeJS.ProcessEnv, cwd: string | undefined): Promise<string> {
  const fromEnv = env['DEVAUDIT_BASE_URL'];
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  try {
    const cfg = await readSdlcConfig(await resolveRepoRoot(cwd ?? process.cwd()));
    if (cfg?.devaudit?.base_url) return cfg.devaudit.base_url.replace(/\/$/, '');
  } catch {
    // no repository or no config: the default portal
  }
  return DEFAULT_BASE_URL;
}

async function configuredName(cwd: string | undefined): Promise<string> {
  try {
    const cfg = await readSdlcConfig(await resolveRepoRoot(cwd ?? process.cwd()));
    const name = (cfg as { delivery?: { agent_git_name?: unknown } } | null)?.delivery?.agent_git_name;
    if (typeof name === 'string' && name.trim() !== '') return name.trim();
  } catch {
    // no config: the default name
  }
  return DELIVERY_GIT_NAME_DEFAULT;
}

/** The token's own GitHub identity: `<id>+<login>@users.noreply.github.com`. Fails rather than inventing an address. */
export async function authorFromToken(token: string, name: string, env: NodeJS.ProcessEnv, doFetch: typeof fetch): Promise<GitAuthor> {
  const api = (env['GITHUB_API_URL'] || 'https://api.github.com').replace(/\/$/, '');
  let status = 0;
  let body: { id?: unknown; login?: unknown } = {};
  try {
    const res = await doFetch(`${api}/user`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'devaudit-cli' },
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    if (res.ok) body = (await res.json().catch(() => ({}))) as typeof body;
  } catch {
    status = 0;
  }
  if (typeof body.id !== 'number' || typeof body.login !== 'string' || body.login === '') {
    throw new TokenFailure(
      `The token's GitHub user could not be read (${status === 0 ? 'no response' : `HTTP ${status}`}), so no commit author address can be derived, and none is invented. Check that ${DELIVERY_AGENT_GITHUB_SECRET} is a valid token of a machine user.`,
    );
  }
  return { name, email: `${body.id}+${body.login}@users.noreply.github.com` };
}

interface CacheFile {
  readonly token: string;
  readonly expiresAt: string;
  readonly author: GitAuthor;
}

function validAuthor(a: unknown): a is GitAuthor {
  return typeof a === 'object' && a !== null && typeof (a as GitAuthor).name === 'string' && typeof (a as GitAuthor).email === 'string' && (a as GitAuthor).name !== '' && (a as GitAuthor).email !== '' && !/[\r\n]/.test(`${(a as GitAuthor).name}${(a as GitAuthor).email}`);
}

async function fromPortal(run: string, env: NodeJS.ProcessEnv, deps: GithubTokenDeps, now: () => number): Promise<Resolved> {
  const stateDir = deps.stateDir ?? env['RUNNER_TEMP'] ?? tmpdir();
  const cacheFile = join(stateDir, `devaudit-delivery-github-token-${run}.json`);
  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, 'utf-8')) as CacheFile;
    if (typeof cached.token === 'string' && cached.token !== '' && validAuthor(cached.author) && Date.parse(cached.expiresAt) - now() > DELIVERY_TOKEN_REFRESH_MARGIN_MS) {
      return { token: cached.token, expiresAt: cached.expiresAt, source: 'portal', author: cached.author };
    }
  } catch {
    // no usable cache: ask the portal
  }

  const key = env['DEVAUDIT_AGENT_PORTAL_KEY'] || env['DEVAUDIT_API_KEY'];
  if (!key) throw new TokenFailure('There is no portal key (DEVAUDIT_AGENT_PORTAL_KEY) to ask the portal for a GitHub token with.');
  const url = `${await resolveBaseUrl(env, deps.cwd)}/api/ci/delivery-runs/${encodeURIComponent(run)}/github-token`;
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let status = 0;
  let text = '';
  let retryAfter = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await doFetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
      status = res.status;
      retryAfter = res.headers.get('retry-after') ?? '';
      // eslint-disable-next-line no-await-in-loop
      text = await res.text().catch(() => '');
    } catch (err) {
      status = 0;
      text = err instanceof Error ? err.message : String(err);
    }
    if (status === 200) break;
    // A refusal is final; a 5xx or a network failure is tried again.
    if (status !== 0 && status < 500) break;
    if (attempt < MAX_ATTEMPTS) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }

  if (status !== 200) throw new TokenFailure(portalFailure(status, text, retryAfter));
  let body: { token?: unknown; expiresAt?: unknown; author?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    body = {};
  }
  if (typeof body.token !== 'string' || body.token === '' || typeof body.expiresAt !== 'string' || Number.isNaN(Date.parse(body.expiresAt)) || !validAuthor(body.author)) {
    throw new TokenFailure('The portal answered 200 without a usable token, expiry and author. This is a portal fault, not a setting of this repository.');
  }
  const file: CacheFile = { token: body.token, expiresAt: body.expiresAt, author: body.author };
  try {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(file), { mode: 0o600 });
    await fs.chmod(cacheFile, 0o600).catch(() => undefined);
  } catch {
    // an unwritable cache only costs another request
  }
  return { token: body.token, expiresAt: body.expiresAt, source: 'portal', author: body.author };
}

function portalFailure(status: number, text: string, retryAfter: string): string {
  let parsed: { code?: unknown; installUrl?: unknown; error?: unknown } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    // not JSON: the raw text is shortened below
  }
  const code = typeof parsed.code === 'string' ? parsed.code : typeof parsed.error === 'string' ? parsed.error : '';
  if (status === 409 && code === 'not_installed') {
    const install = typeof parsed.installUrl === 'string' && parsed.installUrl !== '' ? ` Install it here: ${parsed.installUrl}` : '';
    return `The DevAudit Agent GitHub App is not installed on this repository.${install}`;
  }
  if (status === 409) return `The portal refused a token for this run (${code || 'HTTP 409'}): the run is not active.`;
  if (status === 503) return 'The portal has no DevAudit Agent GitHub App configured (not_configured).';
  if (status === 401 || status === 403) return `The portal did not accept the delivery-agent key for this run (HTTP ${status}).`;
  if (status === 422) return `The portal cannot mint a token for this project's repository (${code || 'HTTP 422'}): its repository address is not a github.com repository.`;
  if (status === 429) return `The portal's rate limit for this run's GitHub tokens was reached${retryAfter ? `; retry after ${retryAfter} seconds` : ''}.`;
  return `The portal did not give a GitHub token (${status === 0 ? `no response: ${text.slice(0, 200)}` : `HTTP ${status}`}).`;
}

async function resolveToken(run: string, needAuthor: boolean, env: NodeJS.ProcessEnv, deps: GithubTokenDeps, now: () => number): Promise<Resolved> {
  const secret = (env[DELIVERY_AGENT_GITHUB_SECRET] ?? '').trim();
  if (secret !== '') {
    const author = needAuthor ? await authorFromToken(secret, await configuredName(deps.cwd), env, deps.fetchImpl ?? fetch) : null;
    return { token: secret, expiresAt: null, source: 'secret', author };
  }
  return fromPortal(run, env, deps, now);
}

async function readAll(deps: GithubTokenDeps): Promise<string> {
  if (deps.readStdin) return deps.readStdin();
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf-8');
}

export async function runDeliveryGithubToken(options: GithubTokenOptions, deps: GithubTokenDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.stdout ?? ((t: string) => void process.stdout.write(t));
  const err = deps.stderr ?? ((t: string) => void process.stderr.write(t));
  const now = deps.now ?? Date.now;

  // git also calls a helper to store and erase; there is nothing to store.
  if (options.credential && options.operation !== undefined && options.operation !== 'get') return 0;

  const run = options.run ?? env['RUN_ID'];
  if (!run || !RUN_ID.test(run)) {
    err('--run needs the delivery run id (letters, digits, - and _ only); RUN_ID in the environment is used when it is not given.\n');
    return 2;
  }

  if (options.credential) {
    // Only answer for GitHub over https: a helper must not hand the token to another host.
    const attrs = new Map<string, string>();
    for (const line of (await readAll(deps)).split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0) attrs.set(line.slice(0, i), line.slice(i + 1));
    }
    const serverHost = (() => {
      try {
        return new URL(env['GITHUB_SERVER_URL'] || 'https://github.com').host;
      } catch {
        return 'github.com';
      }
    })();
    const host = attrs.get('host');
    const protocol = attrs.get('protocol');
    if ((host !== undefined && host !== serverHost) || (protocol !== undefined && protocol !== 'https')) return 0;
  }

  let resolved: Resolved;
  try {
    resolved = await resolveToken(run, Boolean(options.json || options.githubEnv), env, deps, now);
  } catch (e) {
    if (e instanceof TokenFailure) {
      err(`${e.message}\nNo GitHub token for the delivery agent. ${BOTH_OPTIONS}\nThe default GITHUB_TOKEN is never used: a push made with it starts no CI.\n`);
      return 1;
    }
    throw e;
  }

  if (options.mask) out(`::add-mask::${resolved.token}\n`);

  if (options.githubEnv) {
    const file = env['GITHUB_ENV'];
    if (!file) {
      err('--github-env needs GITHUB_ENV (it is set inside a GitHub Actions step).\n');
      return 2;
    }
    const a = resolved.author!;
    await fs.appendFile(file, `DEVAUDIT_AGENT_GIT_NAME=${a.name}\nDEVAUDIT_AGENT_GIT_EMAIL=${a.email}\n`);
    err(
      `GitHub token for the agent: ${resolved.source === 'secret' ? `the repository secret ${DELIVERY_AGENT_GITHUB_SECRET}` : `the portal's DevAudit Agent GitHub App (expires ${resolved.expiresAt})`}. Commits are authored as ${a.name} <${a.email}>.\n`,
    );
    return 0;
  }
  if (options.credential) {
    out(`username=x-access-token\npassword=${resolved.token}\n`);
    return 0;
  }
  if (options.json) {
    out(`${JSON.stringify({ token: resolved.token, expiresAt: resolved.expiresAt, source: resolved.source, author: resolved.author })}\n`);
    return 0;
  }
  out(`${resolved.token}\n`);
  return 0;
}
