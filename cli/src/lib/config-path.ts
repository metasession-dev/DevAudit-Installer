/**
 * DevAudit-Installer#1116 WP2 — read and write `sdlc-config.json` values by a dotted path.
 *
 * `approval.mode` is `cfg.approval.mode`. Every helper returns a new object and keeps the
 * order of the keys already present, and a write keeps the siblings of the last segment
 * (`approval.auto_low_risk_threshold` survives `set approval.mode`). A key with no dot is a
 * plain top-level key, so existing keys behave exactly as before.
 */

export type ConfigRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is ConfigRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const segmentsOf = (path: string): string[] => path.split('.');

/** The value at `path`, or undefined when any segment is missing or not an object. */
export function getConfigPath(cfg: ConfigRecord, path: string): unknown {
  let node: unknown = cfg;
  for (const segment of segmentsOf(path)) {
    if (!isRecord(node) || !Object.prototype.hasOwnProperty.call(node, segment)) return undefined;
    node = node[segment];
  }
  return node;
}

/** A copy of `cfg` with `value` at `path`. Missing (or non-object) parents are created. */
export function setConfigPath(cfg: ConfigRecord, path: string, value: unknown): ConfigRecord {
  const [head, ...rest] = segmentsOf(path);
  if (head === undefined) return { ...cfg };
  if (rest.length === 0) return { ...cfg, [head]: value };
  const child = isRecord(cfg[head]) ? (cfg[head] as ConfigRecord) : {};
  return { ...cfg, [head]: setConfigPath(child, rest.join('.'), value) };
}

/**
 * A copy of `cfg` without the value at `path`. An object left empty by the removal is removed
 * too, so removing the only key of a section does not leave `"approval": {}` behind.
 */
export function deleteConfigPath(cfg: ConfigRecord, path: string): ConfigRecord {
  const [head, ...rest] = segmentsOf(path);
  if (head === undefined || !Object.prototype.hasOwnProperty.call(cfg, head)) return { ...cfg };
  if (rest.length === 0) {
    const { [head]: _removed, ...remaining } = cfg;
    return remaining;
  }
  const child = cfg[head];
  if (!isRecord(child)) return { ...cfg };
  const next = deleteConfigPath(child, rest.join('.'));
  if (Object.keys(next).length === 0) {
    const { [head]: _removed, ...remaining } = cfg;
    return remaining;
  }
  return { ...cfg, [head]: next };
}
