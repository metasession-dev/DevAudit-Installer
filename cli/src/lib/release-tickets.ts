import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/**
 * devaudit-installer#956 — read-only ticket-field parsing for `doctor`.
 * Ports of extract_release_intent / extract_explicit_predecessors /
 * extract_ticket_pr in sdlc/files/_common/scripts/generate-bundled-changes.sh.
 * Line anchors match the bash greps (`^- **Field:**`); CRLF is normalised
 * because Windows checkouts convert templates.
 */

export interface PendingTicket {
  readonly version: string;
  readonly path: string;
  /** Raw `Release intent` value; null when the field is absent. */
  readonly intent: string | null;
  readonly deferred: boolean;
  readonly predecessorsFieldPresent: boolean;
  /** Versions listed under `Absorbed predecessor releases` (empty for `None`/absent). */
  readonly predecessors: readonly string[];
  /** PR number from the ticket's `**PR:**` line, if any. */
  readonly prNumber: number | null;
}

export interface BundleManifest {
  readonly core: string;
  readonly coTracked: readonly string[];
}

const TICKET_RE = /^RELEASE-TICKET-(.+)\.md$/;

export function parseTicket(version: string, path: string, content: string): PendingTicket {
  const lines = content.replace(/\r/g, '').split('\n');
  const find = (re: RegExp): string | undefined => lines.find((l) => re.test(l));
  const intentLine = find(/^- \*\*Release intent:\*\*/);
  const intent = intentLine ? intentLine.replace(/^- \*\*Release intent:\*\*/, '').trim() : null;
  const predLine = find(/^- \*\*Absorbed predecessor releases:\*\*/);
  const predecessors =
    predLine && !/\bNone\b/i.test(predLine)
      ? (predLine.match(/REQ-[0-9]+|v[0-9]{4}\.[0-9]{2}\.[0-9]{2}(?:\.[0-9]+)?/g) ?? [])
      : [];
  const prLine = find(/^\*\*PR:\*\*/);
  const prMatch = prLine?.match(/#([0-9]+)/) ?? prLine?.match(/\/pull\/([0-9]+)/);
  return {
    version,
    path,
    intent,
    deferred: intent !== null && intent.startsWith('deferred-to-next'),
    predecessorsFieldPresent: predLine !== undefined,
    predecessors: [...new Set(predecessors)],
    prNumber: prMatch?.[1] ? Number.parseInt(prMatch[1], 10) : null,
  };
}

export async function readPendingTickets(repoRoot: string): Promise<readonly PendingTicket[] | null> {
  const dir = join(repoRoot, 'compliance', 'pending-releases');
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  const tickets: PendingTicket[] = [];
  for (const f of entries.sort()) {
    const m = f.match(TICKET_RE);
    if (!m?.[1]) continue;
    try {
      tickets.push(parseTicket(m[1], join(dir, f), await fs.readFile(join(dir, f), 'utf-8')));
    } catch {
      // unreadable ticket — skip it, never throw
    }
  }
  return tickets;
}

/** Declared-bundle manifests (`BUNDLED-CHANGES-<core>.json`) with their `co_tracked` members. */
export async function readBundleManifests(repoRoot: string): Promise<readonly BundleManifest[]> {
  const dir = join(repoRoot, 'compliance', 'pending-releases');
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: BundleManifest[] = [];
  for (const f of entries.sort()) {
    const m = f.match(/^BUNDLED-CHANGES-(REQ-[0-9]+)\.json$/);
    if (!m?.[1]) continue;
    try {
      const json = JSON.parse(await fs.readFile(join(dir, f), 'utf-8')) as {
        members?: Array<{ version?: string; role?: string }>;
      };
      const coTracked = (json.members ?? [])
        .filter((x) => x.role === 'co_tracked' && typeof x.version === 'string')
        .map((x) => x.version as string);
      out.push({ core: m[1], coTracked });
    } catch {
      // malformed manifest — ignore
    }
  }
  return out;
}

/** Where a ticket lives other than pending-releases/ (null when nowhere). */
export async function archivedTicketDir(
  repoRoot: string,
  version: string,
): Promise<'approved-releases' | 'superseded-releases' | null> {
  for (const dir of ['approved-releases', 'superseded-releases'] as const) {
    try {
      await fs.access(join(repoRoot, 'compliance', dir, `RELEASE-TICKET-${version}.md`));
      return dir;
    } catch {
      // next
    }
  }
  return null;
}
