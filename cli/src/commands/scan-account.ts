import { promises as fs } from 'node:fs';
import { basename } from 'node:path';
import { hostname } from 'node:os';
import type { ScanReport } from '@metasession.co/devaudit-core';
import { readAuth, resolveToken, writeAuth } from '../lib/auth.js';
import { DevAuditApiError, DevAuditClient } from '../lib/devaudit-api.js';
import { saveViewerKey, viewerKeyName } from '../lib/viewer-keys.js';

/**
 * DevAudit-Installer#1116 WP11 — the account step of `devaudit scan`: after the report, offer to save it and get
 * help fixing it. In order: device sign-in (skipped when a valid personal access token exists), the project, the
 * person's own viewer key, the report upload, then the hand-off to the guided install with the scan's answers.
 *
 * The personal access token is saved by the same function `devaudit auth login` uses and is never printed, logged
 * or put in an environment variable. Every portal call that its dependency (portal #925, #926) has not delivered
 * ends in one plain line, "not available on this portal yet", and the run goes on. The device-flow field names
 * are the portal's final contract (portal #925, RFC 8628 names; the token is `access_token`) and the upload is
 * portal #926 (`POST /api/projects/{id}/scan-reports`, admin PAT in `X-DevAudit-Token`).
 */

export const NOT_A_TERMINAL_LINE = 'To create an account, run `devaudit scan` in your own terminal.';
export const LOCAL_FIXES =
  'Local fixes you can make without an account: `devaudit bootstrap-governance` (starter governance documents) and `devaudit configure` (the settings that go in sdlc-config.json). Onboarding with DevAudit (`devaudit install`) needs an account; it is free.';

export interface AccountStepInput {
  readonly report: ScanReport;
  /** The cached report file: its bytes are the upload body. */
  readonly cacheFile: string;
  readonly repoRoot: string;
  readonly baseUrl: string;
  readonly cfg: Record<string, unknown> | null;
}

export interface AccountPrompts {
  confirm(message: string, initial: boolean): Promise<boolean>;
  select(message: string, options: ReadonlyArray<{ value: string; label: string; hint?: string }>, initial: string): Promise<string>;
}

export interface AccountStepDeps {
  readonly say?: (line: string) => void;
  readonly ask?: AccountPrompts;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Hand-off: runs the guided install (default: `runInstall`). */
  readonly runInstall?: (options: { path: string; fromScan: string; preset?: string }) => Promise<unknown>;
  /** Test seam: the stored token (default: `DEVAUDIT_USER_TOKEN`, then `devaudit auth login`'s cache). */
  readonly storedToken?: () => Promise<{ token: string; baseUrl: string } | null>;
}

export type AccountOutcome =
  | 'declined'
  | 'unavailable'
  | 'saved'
  | 'not-saved'
  | 'needs-login'
  | 'signed-in-failed';

/** A project slug from a folder name: lower-case words joined by single hyphens (words found by splitting, not by a pattern anchored at both ends). */
const slugOf = (name: string): string => name.toLowerCase().split(/[^a-z0-9]/).filter((w) => w !== '').join('-') || 'my-project';

async function validToken(token: string, baseUrl: string): Promise<boolean> {
  try {
    await new DevAuditClient({ token, baseUrl }).listProjects();
    return true;
  } catch {
    return false;
  }
}

interface DeviceStart {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly deviceCode: string;
  readonly interval: number;
  readonly expiresIn: number;
}

async function jsonOf(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const v = (await res.json()) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function startDevice(base: string, f: typeof fetch): Promise<DeviceStart | null> {
  let res: Response;
  try {
    res = await f(`${base}/api/auth/device`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machine_name: hostname() }) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = await jsonOf(res);
  if (!body) return null;
  const userCode = body['user_code'];
  const uri = body['verification_uri_complete'] ?? body['verification_uri'];
  const deviceCode = body['device_code'];
  if (typeof userCode !== 'string' || typeof uri !== 'string' || typeof deviceCode !== 'string') return null;
  return {
    userCode,
    verificationUri: uri,
    deviceCode,
    interval: typeof body['interval'] === 'number' && body['interval'] > 0 ? body['interval'] : 5,
    expiresIn: typeof body['expires_in'] === 'number' && body['expires_in'] > 0 ? body['expires_in'] : 600,
  };
}

type PollResult = { kind: 'token'; token: string } | { kind: 'denied' } | { kind: 'expired' };

async function pollDevice(base: string, start: DeviceStart, f: typeof fetch, sleep: (ms: number) => Promise<void>): Promise<PollResult> {
  let waited = 0;
  let interval = start.interval;
  while (waited < start.expiresIn) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(interval * 1000);
    waited += interval;
    let res: Response;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await f(`${base}/api/auth/device/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_code: start.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    } catch {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const body = await jsonOf(res);
    if (res.ok && body && typeof body['access_token'] === 'string') return { kind: 'token', token: body['access_token'] };
    const error = body?.['error'];
    if (error === 'access_denied') return { kind: 'denied' };
    if (error === 'expired_token') return { kind: 'expired' };
    // RFC 8628: slow_down means poll less often
    if (error === 'slow_down') interval += 5;
    // authorization_pending or a transient error: keep waiting
  }
  return { kind: 'expired' };
}

async function upload(base: string, projectId: string, token: string, body: string, f: typeof fetch): Promise<'saved' | 'unavailable' | 'rejected'> {
  let res: Response;
  try {
    res = await f(`${base}/api/projects/${encodeURIComponent(projectId)}/scan-reports`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-devaudit-token': token }, body });
  } catch {
    return 'unavailable';
  }
  if (res.ok) return 'saved';
  if (res.status === 404 || res.status === 405 || res.status === 501) return 'unavailable';
  return 'rejected';
}

/** The account step. Returns what happened; the caller has already decided the offer applies (a terminal, not `--local`, not `--ci`). */
export async function runAccountStep(input: AccountStepInput, deps: AccountStepDeps & { ask: AccountPrompts }): Promise<AccountOutcome> {
  const say = deps.say ?? (() => undefined);
  const f = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = input.baseUrl.replace(/\/$/, '');
  const stored = await (deps.storedToken ?? (async () => resolveToken()))();
  const onboardedSlug = (input.cfg?.['devaudit'] as { project_slug?: string } | undefined)?.project_slug;
  const body = await fs.readFile(input.cacheFile, 'utf-8');

  // ---- already onboarded: save to the existing project with the person's token --------------------------
  if (onboardedSlug) {
    if (!stored || !(await validToken(stored.token, stored.baseUrl))) {
      say(`Run \`devaudit auth login\` to save this report to ${onboardedSlug}.`);
      say('Next: `devaudit configure` to review your settings.');
      return 'needs-login';
    }
    if (!(await deps.ask.confirm(`Save this report to ${onboardedSlug}?`, true))) return 'declined';
    const project = await new DevAuditClient({ token: stored.token, baseUrl: stored.baseUrl }).getProjectBySlug(onboardedSlug);
    if (!project) {
      say(`${onboardedSlug} was not found on ${stored.baseUrl}; the report was not saved.`);
      return 'not-saved';
    }
    const r = await upload(stored.baseUrl.replace(/\/$/, ''), project.id, stored.token, body, f);
    say(r === 'saved' ? `Saved this report to ${onboardedSlug}.` : r === 'unavailable' ? 'Saving a report is not available on this portal yet.' : 'The portal did not accept the report (it may need project admin rights).');
    say('Next: `devaudit configure` to review your settings.');
    return r === 'saved' ? 'saved' : 'not-saved';
  }

  // ---- a new account and project ------------------------------------------------------------------------
  if (!(await deps.ask.confirm('Save this report and get help fixing it? Create your free DevAudit account', true))) {
    say(LOCAL_FIXES);
    return 'declined';
  }
  let token: string | null = null;
  let tokenBase = base;
  if (stored && (await validToken(stored.token, stored.baseUrl))) {
    token = stored.token;
    tokenBase = stored.baseUrl.replace(/\/$/, '');
  } else {
    const start = await startDevice(base, f);
    if (!start) {
      say('Creating an account from the command line is not available on this portal yet. Create one at https://devaudit.ai/ , run `devaudit auth login`, then `devaudit scan` again.');
      say(LOCAL_FIXES);
      return 'unavailable';
    }
    say(`Open ${start.verificationUri} in your browser and approve DevAudit on this machine. Your code: ${start.userCode}`);
    const polled = await pollDevice(base, start, f, sleep);
    if (polled.kind !== 'token') {
      say(polled.kind === 'denied' ? 'The sign-in was declined; nothing was created.' : 'The sign-in code expired; nothing was created. Run `devaudit scan` again to retry.');
      say(LOCAL_FIXES);
      return 'signed-in-failed';
    }
    token = polled.token;
    await writeAuth(token, base); // the same function `devaudit auth login` uses; never printed or logged
  }
  const client = new DevAuditClient({ token, baseUrl: tokenBase });
  const slug = slugOf(basename(input.repoRoot));
  let project = await client.getProjectBySlug(slug).catch(() => null);
  try {
    project ??= await client.createProject(slug, slug);
  } catch (err) {
    say(err instanceof DevAuditApiError && err.status === 403 ? 'The free plan allows one project and this account already has one; the report was not saved.' : 'The project could not be created; the report was not saved.');
    return 'not-saved';
  }
  try {
    const name = await viewerKeyName(input.repoRoot);
    const issued = await client.issueApiKey(project.id, name, 'viewer');
    await saveViewerKey(tokenBase, slug, { key: issued.plainTextKey, name, createdAt: new Date().toISOString() });
  } catch {
    say('Your own read-only viewer key could not be issued; run `devaudit join` later to get one.');
  }
  const saved = await upload(tokenBase, project.id, token, body, f);
  say(saved === 'saved' ? `Saved this report to the new project ${slug}.` : saved === 'unavailable' ? 'Saving a report is not available on this portal yet; the project was created.' : 'The portal did not accept the report.');

  // ---- hand-off to the guided install with the scan's answers -------------------------------------------
  const choice = await deps.ask.select('Set up the suggested preset now?', [
    { value: 'yes', label: 'Yes', hint: `preset ${input.report.suggestedPreset}` },
    { value: 'change', label: 'Change one thing' },
    { value: 'later', label: 'Not now' },
  ], 'yes');
  const install = deps.runInstall ?? (async (o) => (await import('../install/index.js')).runInstall({ path: o.path, fromScan: o.fromScan, ...(o.preset ? { preset: o.preset } : {}) }));
  if (choice === 'later') {
    say(`When you are ready: \`devaudit install --from-scan ${input.cacheFile}\``);
  } else {
    await install({ path: input.repoRoot, fromScan: input.cacheFile, ...(choice === 'yes' && input.report.suggestedPreset !== 'custom' ? { preset: input.report.suggestedPreset } : {}) });
  }
  return saved === 'saved' ? 'saved' : 'not-saved';
}

/** Whether a personal access token is available without signing in (used by tests and the caller). */
export async function hasStoredToken(): Promise<boolean> {
  return (await readAuth()) !== null || Boolean(process.env['DEVAUDIT_USER_TOKEN']);
}
