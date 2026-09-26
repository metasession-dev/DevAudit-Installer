import { execa } from 'execa';
import { resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import { resolveToken } from '../lib/auth.js';
import { DevAuditClient, DevAuditApiError, type DevAuditProject } from '../lib/devaudit-api.js';
import { logger, isJsonMode, emitJsonResult } from '../lib/logger.js';

/**
 * devaudit-installer#861 — generalizes the fleet sweep beyond Metasession's
 * own operator tooling. Any org can run `devaudit doctor --fleet` against
 * whatever projects their own DEVAUDIT_USER_TOKEN can see. Tenant isolation
 * is enforced by the portal's own `GET /api/projects` (org membership /
 * access grants — see lib/authz in the devaudit repo), not by anything in
 * this command: this command is read-only and never files issues, opens
 * branches, or otherwise acts on a repo on the caller's behalf. Automated
 * write actions stay a deliberate, org-specific choice (see the
 * `fleet-doctor` Claude skill, which layers write-phase logic for
 * Metasession's own fleet on top of this command's discovery+collection).
 */

export interface FleetDoctorOptions {
  /** Directory to resolve sibling checkouts relative to. Defaults to cwd. */
  readonly baseDir?: string;
  /**
   * Injectable for tests: runs `devaudit doctor --json` against one local
   * checkout and returns its parsed JSON output plus exit status. Defaults
   * to shelling out to this same CLI binary in a subprocess, matching how
   * an individual consumer's operator would run it by hand.
   */
  readonly runDoctorJson?: (dir: string) => Promise<{ exitCode: number; json: unknown }>;
}

interface FleetProjectResult {
  readonly slug: string;
  readonly repo_url: string | null;
  readonly status: 'ok' | 'issues' | 'skipped' | 'error';
  readonly reason?: string;
  readonly local_dir?: string;
  readonly doctor?: unknown;
}

/** Derives a plausible checkout directory name from a repo_url, e.g.
 * `https://github.com/org/my-repo.git` -> `my-repo`. */
export function repoNameFromUrl(repoUrl: string): string | null {
  const trimmed = repoUrl.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const match = trimmed.match(/\/([^/]+)$/);
  return match?.[1] || null;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Sibling-directory convention (matches fleet-doctor's existing Phase 1,
 * `sdlc/CLAUDE.md`'s own fan-out convention): a project's checkout is
 * expected either alongside baseDir (`../<repo-name>`) or, less commonly,
 * directly inside it. Not found on disk is a skip, not a failure — the
 * caller may simply not have every one of their projects checked out here.
 */
async function findLocalCheckout(baseDir: string, repoName: string): Promise<string | null> {
  const candidates = [resolve(baseDir, '..', repoName), resolve(baseDir, repoName)];
  for (const candidate of candidates) {
    if (await isDirectory(candidate)) return candidate;
  }
  return null;
}

function normalizeRemote(url: string): string {
  return url
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .toLowerCase();
}

/**
 * Defense-in-depth, not the authorization boundary (see module docstring):
 * `repo_url` is an unverified string on the portal, so before running
 * doctor against a directory that merely *matches the expected name*,
 * confirm its own git remote actually points at the same repo. A mismatch
 * is skipped, not failed — it just means the local directory isn't the
 * project it was guessed to be.
 */
async function localRemoteMatches(dir: string, repoUrl: string): Promise<boolean> {
  const result = await execa('git', ['-C', dir, 'remote', 'get-url', 'origin'], { reject: false });
  const remote = result.stdout?.trim();
  if (!remote) return true; // no origin configured locally — don't block on this
  return normalizeRemote(remote) === normalizeRemote(repoUrl);
}

async function defaultRunDoctorJson(dir: string): Promise<{ exitCode: number; json: unknown }> {
  const entry = process.argv[1] as string;
  const proc = await execa(process.execPath, [entry, 'doctor', '--json'], { cwd: dir, reject: false });
  let json: unknown;
  try {
    json = JSON.parse(proc.stdout);
  } catch {
    json = { parseError: true, stdout: proc.stdout, stderr: proc.stderr };
  }
  return { exitCode: proc.exitCode ?? 1, json };
}

export async function runFleetDoctor(options: FleetDoctorOptions = {}): Promise<void> {
  const log = logger();
  const jsonMode = isJsonMode();
  const baseDir = resolve(options.baseDir ?? process.cwd());
  const runDoctorJson = options.runDoctorJson ?? defaultRunDoctorJson;

  const resolved = await resolveToken();
  if (!resolved) {
    if (jsonMode) emitJsonResult({ ok: false, reason: 'not_logged_in' });
    else log.error('Not logged in. Run `devaudit auth login` or set DEVAUDIT_USER_TOKEN.');
    process.exit(3);
    return;
  }

  let projects: readonly DevAuditProject[];
  try {
    const client = new DevAuditClient({ token: resolved.token, baseUrl: resolved.baseUrl });
    projects = await client.listProjects();
  } catch (err) {
    if (err instanceof DevAuditApiError) {
      if (jsonMode) emitJsonResult({ ok: false, reason: 'portal_rejected', status: err.status });
      else log.error(`Portal rejected the token (HTTP ${err.status}). Re-run \`devaudit auth login\`.`);
      process.exit(3);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) emitJsonResult({ ok: false, reason: 'portal_error', message });
    else log.error(`Could not fetch your projects from the portal: ${message}`);
    process.exit(1);
    return;
  }

  if (!jsonMode) {
    log.info(`Sweeping ${projects.length} project(s) visible to your account (${resolved.baseUrl})...`);
    log.log('');
  }

  const results: FleetProjectResult[] = [];
  let anyIssues = false;
  let anyChecked = false;

  for (const project of projects) {
    const repoUrl = project.repo_url ?? null;
    if (!repoUrl) {
      results.push({ slug: project.slug, repo_url: null, status: 'skipped', reason: 'project has no repo_url set' });
      continue;
    }
    const repoName = repoNameFromUrl(repoUrl);
    if (!repoName) {
      results.push({ slug: project.slug, repo_url: repoUrl, status: 'skipped', reason: 'could not derive a directory name from repo_url' });
      continue;
    }
    const localDir = await findLocalCheckout(baseDir, repoName);
    if (!localDir) {
      results.push({
        slug: project.slug,
        repo_url: repoUrl,
        status: 'skipped',
        reason: `not checked out locally (looked for ../${repoName})`,
      });
      continue;
    }
    if (!(await localRemoteMatches(localDir, repoUrl))) {
      results.push({
        slug: project.slug,
        repo_url: repoUrl,
        status: 'skipped',
        local_dir: localDir,
        reason: `${localDir} exists but its git remote doesn't match this project's repo_url — skipped for safety`,
      });
      continue;
    }

    anyChecked = true;
    if (!jsonMode) log.info(`  → ${project.slug}  (${localDir})`);
    try {
      const { exitCode, json } = await runDoctorJson(localDir);
      if (exitCode !== 0) anyIssues = true;
      results.push({
        slug: project.slug,
        repo_url: repoUrl,
        status: exitCode === 0 ? 'ok' : 'issues',
        local_dir: localDir,
        doctor: json,
      });
    } catch (err) {
      anyIssues = true;
      results.push({
        slug: project.slug,
        repo_url: repoUrl,
        status: 'error',
        local_dir: localDir,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (jsonMode) {
    emitJsonResult({ ok: !anyIssues, checked: anyChecked, results });
    return;
  }

  log.log('');
  for (const r of results) {
    if (r.status === 'ok') log.success(`${r.slug} — clean`);
    else if (r.status === 'issues') log.warn(`${r.slug} — findings (see \`devaudit doctor\` inside ${r.local_dir})`);
    else if (r.status === 'error') log.error(`${r.slug} — ${r.reason}`);
    else log.log(`  ⏭  ${r.slug} — ${r.reason}`);
  }
  log.log('');
  if (!anyChecked) {
    log.warn('No projects visible to your account were found checked out locally next to this directory.');
  } else if (anyIssues) {
    log.warn('One or more projects have findings — see above. This command only reports; nothing was changed.');
  } else {
    log.success('All locally-available projects are clean.');
  }
}
