/**
 * Token substitution for CI workflow templates. The bash version uses sed for
 * scalar tokens and awk for block tokens (multi-line replacements). We do both
 * with plain string operations.
 */

export type TokenMap = Readonly<Record<string, string>>;

/**
 * Replace `{{TOKEN}}` occurrences with `tokens[TOKEN]`. Performs simple text
 * replacement (not regex), so tokens with reserved regex characters are safe.
 */
export function substituteTokens(content: string, tokens: TokenMap): string {
  let out = content;
  for (const [key, value] of Object.entries(tokens)) {
    const needle = `{{${key}}}`;
    out = out.split(needle).join(value);
  }
  return out;
}

/**
 * Replace lines that contain `{{TOKEN}}` with the given block (multi-line).
 * Matches the bash `replace_block` awk helper: a line containing the token
 * is replaced wholesale with the block content (the original line is dropped).
 *
 * When the replacement is the empty string, the line is dropped entirely
 * rather than leaving a blank line. Otherwise an empty `{{DATABASE_ENV}}`
 * substitution leaves a stray newline inside `env:` blocks that YAML
 * parsers reject (prettier flagged this on WGB v0.1.34 update).
 */
export function substituteBlocks(content: string, blocks: TokenMap): string {
  if (Object.keys(blocks).length === 0) return content;
  const out: string[] = [];
  for (const line of content.split('\n')) {
    let matched = false;
    for (const [key, replacement] of Object.entries(blocks)) {
      const needle = `{{${key}}}`;
      if (line.includes(needle)) {
        matched = true;
        if (replacement.length > 0) out.push(replacement);
        // empty replacement → drop the line entirely
        break;
      }
    }
    if (!matched) out.push(line);
  }
  return out.join('\n');
}

/**
 * Strip the `services:` block from a workflow file. Used when the consumer
 * project has no database service configured — the template ships with a
 * `services:` block that would otherwise reference an empty service name.
 *
 * Matches bash: `sed -i '/^    services:/,/^$/d' "$OUTPUT_PATH"`.
 */
export function stripServicesBlock(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let inServices = false;
  for (const line of lines) {
    if (!inServices && /^ {4}services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices) {
      if (line.trim() === '') {
        inServices = false;
        continue;
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * devaudit-installer#869 — compliance-evidence.yml.template's `workflow_run`
 * trigger and its `upload-e2e-regression-evidence` job only ever fire in
 * response to a consumer's own `E2E Regression` workflow completing, but
 * that workflow is itself conditionally generated (opt-in via
 * `e2e_regression_enabled`, devaudit-installer#821) — without this strip, a
 * consumer that never opted in gets a permanently-dead trigger + job
 * referencing a workflow that will never exist in their repo.
 *
 * Specific to this one template's current structure, not a generic
 * multi-purpose stripper: the `upload-e2e-regression-evidence` job is
 * assumed to be the last job in the file (drops everything from its
 * comment header through EOF), and the `workflow_run:` trigger is assumed
 * to be the last entry under `on:` before the blank line separating it
 * from `concurrency:`. Revisit this function if the template's job order
 * or trigger placement ever changes.
 */
export function stripE2eRegressionListener(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (/^ {2}workflow_run:\s*$/.test(line)) {
      while (out.length > 0 && /^ {2}#/.test(out[out.length - 1] ?? '')) out.pop();
      i += 1;
      while (i < lines.length && /^ {4}\S/.test(lines[i] ?? '')) i += 1;
      continue;
    }
    if (/^ {2}upload-e2e-regression-evidence:\s*$/.test(line)) {
      while (out.length > 0 && /^ {2}#/.test(out[out.length - 1] ?? '')) out.pop();
      break;
    }
    out.push(line);
    i += 1;
  }
  return out.join('\n');
}
