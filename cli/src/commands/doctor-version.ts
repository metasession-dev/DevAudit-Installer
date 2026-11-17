import type { Remediation } from '@metasession.co/devaudit-core';
import type { CheckResult, Finding } from '../lib/doctor-types.js';
import { CLI_VERSION } from '../lib/version.js';

/**
 * DevAudit-Installer#1265 — `cli-version`: a stale global install passes `doctor` and quietly syncs
 * outdated templates on `update`. This check reads the latest published `@metasession.co/devaudit-cli`
 * from the npm registry with a short timeout and compares it with the running CLI and with the
 * project's `devaudit_synced_version`. Non-gating: a CLI or a sync that is behind is a finding with
 * the fix, never a failure. Offline, slow, an unreadable answer, or `DEVAUDIT_SKIP_VERSION_CHECK=1`
 * means skipped, with no finding and no failure. It adds at most the timeout to a doctor run.
 */

export const LATEST_URL = 'https://registry.npmjs.org/@metasession.co%2Fdevaudit-cli/latest';
export const VERSION_CHECK_TIMEOUT_MS = 3000;

export interface CliVersionDeps {
  /** Test seam: the latest published version, or null when it cannot be read. */
  readonly fetchLatest?: () => Promise<string | null>;
  /** Test seam: the running CLI's version. */
  readonly cliVersion?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** The latest published version from the npm registry; null on any failure or timeout. */
export async function fetchLatestCliVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(LATEST_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(VERSION_CHECK_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' && parseVersion(body.version) !== null ? body.version : null;
  } catch {
    return null;
  }
}

interface Parsed {
  readonly core: readonly [number, number, number];
  readonly pre: readonly string[];
}

/** `1.14.0`, `v1.14.0`, `1.15.0-beta.1`; null for anything else. Build metadata is ignored. */
export function parseVersion(text: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** Negative when `a` is older than `b`, 0 when equal, positive when newer (semver precedence); NaN when either is not a version. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return Number.NaN;
  for (let i = 0; i < 3; i += 1) {
    const d = x.core[i]! - y.core[i]!;
    if (d !== 0) return d;
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1; // a release is newer than its prerelease
  if (y.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (Number(p) !== Number(q)) return Number(p) - Number(q);
    } else if (pn !== qn) {
      return pn ? -1 : 1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}

const guidance = (id: string, summary: string, plan: string[]): Remediation => ({ id, tier: 'C', summary, plan, needsPortal: false });

export async function cliVersionCheck(consumer: { readonly cfg: Record<string, unknown> } | null, deps: CliVersionDeps = {}): Promise<CheckResult> {
  const name = 'cli-version';
  const env = deps.env ?? process.env;
  if (env['DEVAUDIT_SKIP_VERSION_CHECK'] === '1') {
    return { name, ok: true, detail: 'skipped (DEVAUDIT_SKIP_VERSION_CHECK is set)', suspectedOrigin: 'unknown' };
  }
  const latest = await (deps.fetchLatest ?? (() => fetchLatestCliVersion()))();
  if (latest === null) {
    return { name, ok: true, detail: 'skipped (the npm registry could not be read: offline, slow, or an unexpected answer)', suspectedOrigin: 'unknown' };
  }
  const running = deps.cliVersion ?? CLI_VERSION;
  const synced = typeof consumer?.cfg['devaudit_synced_version'] === 'string' ? (consumer.cfg['devaudit_synced_version'] as string) : null;
  const findings: Finding[] = [];
  const cliBehind = compareVersions(running, latest) < 0;
  if (cliBehind) {
    findings.push({
      subject: 'installed-cli',
      detail: `this devaudit CLI is ${running}; the latest published is ${latest}. An \`update\` from an older CLI syncs older templates and scripts.`,
      remediation: guidance('upgrade-cli', `Use devaudit ${latest}`, [
        'npx @metasession.co/devaudit-cli@latest update   (runs the latest without installing it)',
        'or: npm install -g @metasession.co/devaudit-cli@latest',
      ]),
    });
  }
  const syncBehind = synced !== null && compareVersions(synced, latest) < 0;
  if (syncBehind) {
    findings.push({
      subject: 'synced-version',
      detail: `this project's templates were synced by ${synced}; the latest published is ${latest}.`,
      remediation: guidance('update-synced-templates', `Sync the templates from ${latest}`, [
        cliBehind ? 'npx @metasession.co/devaudit-cli@latest update   (on a fix branch; this CLI is behind too)' : 'devaudit update   (on a fix branch)',
      ]),
    });
  }
  if (findings.length === 0) {
    const where = synced !== null ? `; templates synced by ${synced}` : '';
    return { name, ok: true, detail: `devaudit ${running} is current (latest published ${latest})${where}`, suspectedOrigin: 'consumer-drift' };
  }
  // Informational: a stale CLI is guidance, never a failed run.
  const what = [cliBehind ? `CLI ${running}` : null, syncBehind ? `templates ${synced}` : null].filter((s): s is string => s !== null).join(' and ');
  return { name, ok: true, detail: `behind the latest published ${latest}: ${what}`, suspectedOrigin: 'consumer-drift', findings };
}
