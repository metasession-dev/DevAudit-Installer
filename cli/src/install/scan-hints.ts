import { promises as fs } from 'node:fs';
import { InstallRefusal } from './refusal.js';
import { parsePresetFlag, type PresetChoice } from './guided.js';

/** What `install --from-scan` takes from a scan report: the suggested preset and the standards the scan was asked about. */
export interface ScanHints {
  readonly preset?: PresetChoice;
  readonly frameworks?: readonly string[];
}

const REPORT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BYTES = 2_000_000;

/**
 * Read `--from-scan <file|report-id>`. A report id refers to a portal feature that is not available
 * yet, so it is refused with a message that names the alternative; an unreadable or malformed file is
 * refused too. Both exit with code 2 (see {@link InstallRefusal}).
 */
export async function readScanHints(arg: string): Promise<ScanHints> {
  let raw: string;
  try {
    const stat = await fs.stat(arg);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('not a readable file');
    raw = await fs.readFile(arg, 'utf-8');
  } catch {
    if (REPORT_ID.test(arg)) {
      throw new InstallRefusal('Reading a scan report by its id is a portal feature that is not available yet; pass the report file instead (devaudit install --from-scan <file>).');
    }
    throw new InstallRefusal(`Cannot read the scan report "${arg}": it is not a readable file. Pass the file that \`devaudit scan\` wrote.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InstallRefusal(`Cannot read the scan report "${arg}": it is not valid JSON.`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InstallRefusal(`Cannot read the scan report "${arg}": expected a JSON object.`);
  }
  const report = parsed as Record<string, unknown>;
  const suggested = report['suggestedPreset'];
  const preset = typeof suggested === 'string' ? parsePresetFlag(suggested) : null;
  const frameworks = Array.isArray(report['frameworks']) ? report['frameworks'].filter((f): f is string => typeof f === 'string') : undefined;
  return { ...(preset !== null ? { preset } : {}), ...(frameworks !== undefined ? { frameworks } : {}) };
}
