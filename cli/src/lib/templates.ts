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
 */
export function substituteBlocks(content: string, blocks: TokenMap): string {
  if (Object.keys(blocks).length === 0) return content;
  const tokenList = Object.keys(blocks).map((k) => `{{${k}}}`);
  return content
    .split('\n')
    .map((line) => {
      for (const [key, replacement] of Object.entries(blocks)) {
        const needle = `{{${key}}}`;
        if (line.includes(needle)) return replacement;
      }
      return line;
    })
    .join('\n');
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
