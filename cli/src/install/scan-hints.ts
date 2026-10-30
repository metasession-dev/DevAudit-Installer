import { promises as fs } from 'node:fs';
import { InstallRefusal } from './refusal.js';
import { parsePresetFlag, type PresetChoice } from './guided.js';
import { resolveViewerKey } from '../lib/viewer-keys.js';
import type { FetchLike } from '../lib/onboarding-portal.js';

/** What `install --from-scan` takes from a scan report: the suggested preset and the standards the scan was asked about. */
export interface ScanHints {
  readonly preset?: PresetChoice;
  readonly frameworks?: readonly string[];
}

const REPORT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_BYTES = 2_000_000;

/** Where a saved report is read from: the portal, with the person's viewer key for the project that holds it. */
export interface ScanReportSource {
  readonly baseUrl: string;
  readonly repoRoot: string;
  /** The project named in the repository's `sdlc-config.json` (`devaudit.project_slug`), used when the argument is a bare id. */
  readonly configuredSlug?: string;
  readonly fetchImpl?: FetchLike;
}

/** `<report-id>` or `<project-slug>/<report-id>`; null when the argument is neither (so it is treated as a file path). */
export function parseReportRef(arg: string): { slug: string | null; id: string } | null {
  const parts = arg.split('/');
  if (parts.length === 1 && REPORT_ID.test(parts[0]!)) return { slug: null, id: parts[0]! };
  if (parts.length === 2 && SLUG.test(parts[0]!) && REPORT_ID.test(parts[1]!)) return { slug: parts[0]!, id: parts[1]! };
  return null;
}

async function isReadableFile(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile() && stat.size <= MAX_BYTES;
  } catch {
    return false;
  }
}

/** True when `install --from-scan` should read a saved report from the portal (the argument is a report reference and no such file exists). */
export async function isPortalReportRef(arg: string): Promise<boolean> {
  return parseReportRef(arg) !== null && !(await isReadableFile(arg));
}

async function fetchReport(ref: { slug: string | null; id: string }, source: ScanReportSource): Promise<string> {
  const slug = ref.slug ?? source.configuredSlug ?? null;
  if (!slug) {
    throw new InstallRefusal(`Cannot tell which project holds the scan report "${ref.id}": this repository has no devaudit.project_slug. Pass <project-slug>/${ref.id}, or the report file.`);
  }
  const key = (await resolveViewerKey({ repoRoot: source.repoRoot, baseUrl: source.baseUrl, slug }))?.key ?? null;
  if (!key) {
    throw new InstallRefusal(`Reading the scan report "${ref.id}" needs your viewer key for ${slug}. Run \`devaudit join\` to issue one, or pass the report file.`);
  }
  const doFetch: FetchLike = source.fetchImpl ?? ((u, init) => fetch(u, init));
  const url = `${source.baseUrl.replace(/\/$/, '')}/api/ci/projects/${encodeURIComponent(slug)}/scan-reports/${encodeURIComponent(ref.id)}`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(url, { headers: { Authorization: `Bearer ${key}` } });
  } catch {
    throw new InstallRefusal(`Cannot reach the portal to read the scan report "${ref.id}". Try again, or pass the report file.`);
  }
  if (res.status === 404 || res.status === 405 || res.status === 501) {
    throw new InstallRefusal(`The portal has no scan report "${ref.id}" for ${slug} (or this portal cannot serve saved reports yet). Pass the report file instead (devaudit install --from-scan <file>).`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new InstallRefusal(`Your key for ${slug} was not accepted for the scan report "${ref.id}". Run \`devaudit join\` to issue a new one, or pass the report file.`);
  }
  if (!res.ok) {
    throw new InstallRefusal(`The portal could not return the scan report "${ref.id}" (status ${res.status}). Pass the report file instead.`);
  }
  try {
    return JSON.stringify(await res.json());
  } catch {
    throw new InstallRefusal(`The portal returned the scan report "${ref.id}" in a form that is not JSON. Pass the report file instead.`);
  }
}

/**
 * Read `--from-scan <file|report-id>`. A file is read from disk. A report id (or `<project-slug>/<report-id>`) that is
 * not a file is read from the portal with the person's viewer key (`GET /api/ci/projects/{slug}/scan-reports/{id}`,
 * metasession-dev/devaudit#926); a portal that cannot serve it is refused with a message naming the alternative. An
 * unreadable or malformed report is refused too. All exit with code 2 (see {@link InstallRefusal}).
 */
export async function readScanHints(arg: string, source?: ScanReportSource): Promise<ScanHints> {
  let raw: string;
  let origin = arg;
  if (await isReadableFile(arg)) {
    raw = await fs.readFile(arg, 'utf-8');
  } else {
    const ref = parseReportRef(arg);
    if (ref === null) {
      throw new InstallRefusal(`Cannot read the scan report "${arg}": it is not a readable file. Pass the file that \`devaudit scan\` wrote.`);
    }
    if (!source) {
      throw new InstallRefusal('Reading a scan report by its id needs the portal address; pass the report file instead (devaudit install --from-scan <file>).');
    }
    raw = await fetchReport(ref, source);
    origin = `${ref.slug ?? source.configuredSlug ?? ''}/${ref.id}`.replace(/^\//, '');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InstallRefusal(`Cannot read the scan report "${origin}": it is not valid JSON.`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InstallRefusal(`Cannot read the scan report "${origin}": expected a JSON object.`);
  }
  const report = parsed as Record<string, unknown>;
  const suggested = report['suggestedPreset'];
  const preset = typeof suggested === 'string' ? parsePresetFlag(suggested) : null;
  // The report's `frameworks` is a list of `{ code, clauses }` (contracts/scan-report.schema.json); a bare list of codes is accepted too.
  const frameworks = Array.isArray(report['frameworks'])
    ? report['frameworks'].flatMap((f): string[] => {
        if (typeof f === 'string') return [f];
        const code = f !== null && typeof f === 'object' ? (f as { code?: unknown }).code : undefined;
        return typeof code === 'string' ? [code] : [];
      })
    : undefined;
  return { ...(preset !== null ? { preset } : {}), ...(frameworks !== undefined ? { frameworks } : {}) };
}
