/**
 * devaudit-installer#956 — small, pure, idempotent text edits that
 * `doctor --fix` applies to release tickets and the RTM. Each returns the new
 * content, or `null` when the content is already in the desired state (so the
 * caller can report "unchanged" and a second run changes nothing). CRLF
 * checkouts are preserved. Line anchors match release-tickets.ts.
 */

const INTENT_RE = /^- \*\*Release intent:\*\*/;
const PRED_RE = /^- \*\*Absorbed predecessor releases:\*\*/;

function split(content: string): { lines: string[]; eol: string; trailing: boolean } {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(content);
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (trailing) lines.pop();
  return { lines, eol, trailing };
}

function join(lines: string[], eol: string, trailing: boolean): string {
  return lines.join(eol) + (trailing ? eol : '');
}

/** Insert or replace `- **Release intent:** deferred-to-next — <reason>`. */
export function setReleaseIntent(content: string, reason: string): string | null {
  const clean = reason.replace(/\s+/g, ' ').trim();
  const line = `- **Release intent:** deferred-to-next${clean ? ` — ${clean}` : ''}`;
  const { lines, eol, trailing } = split(content);
  const at = lines.findIndex((l) => INTENT_RE.test(l));
  if (at >= 0) {
    if (lines[at] === line) return null;
    lines[at] = line;
    return join(lines, eol, trailing);
  }
  const pred = lines.findIndex((l) => PRED_RE.test(l));
  if (pred >= 0) lines.splice(pred + 1, 0, line);
  else {
    const heading = lines.findIndex((l) => /^##\s+Bundled Changes\b/.test(l));
    if (heading >= 0) lines.splice(heading + 1, 0, '', line);
    else lines.push('', line);
  }
  return join(lines, eol, true);
}

/** Remove the `Release intent` line (used after a portal resume). */
export function clearReleaseIntent(content: string): string | null {
  const { lines, eol, trailing } = split(content);
  const next = lines.filter((l) => !INTENT_RE.test(l));
  if (next.length === lines.length) return null;
  return join(next, eol, trailing);
}

/** Add `req` under `Absorbed predecessor releases` (replacing `None`). */
export function addPredecessor(content: string, req: string): string | null {
  const { lines, eol, trailing } = split(content);
  const at = lines.findIndex((l) => PRED_RE.test(l));
  if (at >= 0) {
    const l = lines[at] as string;
    if (new RegExp(`\\b${req}\\b(?![0-9])`).test(l)) return null;
    lines[at] = /\bNone\b/i.test(l)
      ? `- **Absorbed predecessor releases:** ${req}`
      : `${l.replace(/\s+$/, '')}, ${req}`;
    return join(lines, eol, trailing);
  }
  const line = `- **Absorbed predecessor releases:** ${req}`;
  const heading = lines.findIndex((l) => /^##\s+Bundled Changes\b/.test(l));
  if (heading >= 0) lines.splice(heading + 1, 0, '', line);
  else lines.push('', line);
  return join(lines, eol, true);
}

function cells(row: string): string[] {
  // split on unescaped pipes
  return row.split(/(?<!\\)\|/);
}

/**
 * Set the Status cell of `req`'s RTM row (header-aware, keeps a trailing
 * "(note)" like close-out-release.sh's update_rtm_status). `onlyFrom`, when
 * given, restricts the flip to rows whose current status word equals it.
 * Returns null when there is no such row or it already has the status.
 */
export function setRtmStatus(content: string, req: string, status: string, onlyFrom?: string): string | null {
  const { lines, eol, trailing } = split(content);
  let statusCol = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    if (!l.startsWith('|')) {
      statusCol = -1; // a new table starts after any non-table line
      continue;
    }
    const c = cells(l);
    if (c.some((x) => /^\s*status\s*$/i.test(x)) && !c.some((x) => new RegExp(`^\\s*${req}\\s*$`).test(x))) {
      statusCol = c.findIndex((x) => /^\s*status\s*$/i.test(x));
      continue;
    }
    if (statusCol < 0 || !new RegExp(`^\\|\\s*${req}\\s*\\|`).test(l)) continue;
    const cell = c[statusCol];
    if (cell === undefined) return null;
    const note = cell.match(/\(.*$/)?.[0]?.trim() ?? '';
    const word = cell.replace(/\(.*$/, '').trim();
    if (word === status) return null;
    if (onlyFrom !== undefined && word !== onlyFrom) return null;
    c[statusCol] = note ? ` ${status} ${note} ` : ` ${status} `;
    lines[i] = c.join('|');
    return join(lines, eol, trailing);
  }
  return null;
}
