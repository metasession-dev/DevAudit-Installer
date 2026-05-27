import { execa } from 'execa';
import { resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import { logger } from '../lib/logger.js';
import { discoverPlugins, buildPluginContext, runHook, type LoadedPlugin } from '../lib/plugin/index.js';

export interface DoctorOptions {
  readonly plugins?: readonly LoadedPlugin[];
}

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

async function checkCommand(name: string, args: readonly string[]): Promise<CheckResult> {
  try {
    const result = await execa(name, args, { reject: false });
    const ok = result.exitCode === 0;
    const firstLine = result.stdout.split('\n')[0] ?? '';
    return { name, ok, detail: ok ? firstLine : `exited ${result.exitCode}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name, ok: false, detail: message };
  }
}

async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.versions.node;
  const major = Number.parseInt(version.split('.')[0] ?? '0', 10);
  const ok = major >= 22;
  return { name: 'node', ok, detail: `v${version} (require >=22)` };
}

/**
 * Reconciliation safety-net (DevAudit-Installer#60): flag any release ticket
 * still in compliance/pending-releases/ whose portal release is already
 * `released` — i.e. a close-out that was missed (e.g. a dropped dispatch).
 * Non-fatal: a warning, not a tool-gate failure. Skips gracefully when not in
 * a consumer project or when no portal credentials are available.
 */
async function checkReleaseCloseoutDrift(): Promise<CheckResult> {
  const name = 'releases';
  let cfg: { project_slug?: string; devaudit?: { project_slug?: string; base_url?: string } };
  try {
    cfg = JSON.parse(await fs.readFile('sdlc-config.json', 'utf-8'));
  } catch {
    return { name, ok: true, detail: 'skipped (not a consumer project)' };
  }
  let entries: string[];
  try {
    entries = await fs.readdir('compliance/pending-releases');
  } catch {
    return { name, ok: true, detail: 'no pending-releases/' };
  }
  const reqs = entries
    .filter((f) => /^RELEASE-TICKET-REQ-\d+\.md$/.test(f))
    .map((f) => f.replace(/^RELEASE-TICKET-/, '').replace(/\.md$/, ''));
  if (reqs.length === 0) return { name, ok: true, detail: 'no pending release tickets' };

  const slug = cfg.devaudit?.project_slug ?? cfg.project_slug;
  const base = (cfg.devaudit?.base_url ?? '').replace(/\/$/, '');
  const apiKey = process.env['DEVAUDIT_API_KEY'];
  if (!slug || !base || !apiKey) {
    return {
      name,
      ok: true,
      detail: `${reqs.length} pending ticket(s); portal drift check skipped (set DEVAUDIT_API_KEY + devaudit.base_url)`,
    };
  }

  const drifted: string[] = [];
  for (const req of reqs) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(
        `${base}/api/ci/releases/resolve?projectSlug=${encodeURIComponent(slug)}&versionPrefix=${encodeURIComponent(req)}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: ctrl.signal },
      );
      clearTimeout(timer);
      if (!res.ok) continue;
      const body = (await res.json()) as { latest?: { status?: string } };
      if (body.latest?.status === 'released') drifted.push(req);
    } catch {
      // network/timeout — leave as a skip for this REQ
    }
  }
  if (drifted.length > 0) {
    return {
      name,
      ok: false,
      detail: `released on the portal but still in pending-releases/: ${drifted.join(', ')} — run ./scripts/close-out-release.sh <REQ>`,
    };
  }
  return { name, ok: true, detail: `${reqs.length} pending ticket(s); none released on the portal` };
}

export async function runDoctor(options: DoctorOptions = {}): Promise<void> {
  const log = logger();
  log.info('Running devaudit doctor — checking required tools...\n');
  const checks: readonly CheckResult[] = [
    await checkNodeVersion(),
    await checkCommand('git', ['--version']),
    await checkCommand('gh', ['--version']),
    await checkCommand('jq', ['--version']),
    await checkCommand('curl', ['--version']),
  ];
  let allOk = true;
  for (const check of checks) {
    const marker = check.ok ? '✓' : '✗';
    if (!check.ok) allOk = false;
    log.log(`  ${marker} ${check.name.padEnd(8)} ${check.detail}`);
  }
  // Reconciliation safety-net — reported but does not gate the tool check (#60).
  const closeout = await checkReleaseCloseoutDrift();
  const closeoutMarker = closeout.ok ? '✓' : '⚠';
  log.log(`  ${closeoutMarker} ${closeout.name.padEnd(8)} ${closeout.detail}`);
  log.log('');
  if (!closeout.ok) {
    log.warn('Release close-out drift detected — see above. (Does not affect the tool check.)');
  }
  const plugins = options.plugins ?? (await discoverPlugins()).loaded;
  if (plugins.length > 0) {
    const ctx = await buildPluginContext({ projectPath: resolve(process.cwd()) });
    await runHook(plugins, 'onDoctor', ctx);
  }
  if (allOk) {
    log.success('All required tools present.');
    process.exit(0);
  } else {
    log.error('One or more required tools are missing. Install them and re-run `devaudit doctor`.');
    process.exit(6);
  }
}
