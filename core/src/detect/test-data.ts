import { joinRepoPath, listFileNames, readJson, readText, type RepoReader } from '../repo-reader.js';
import { PLAYWRIGHT_CONFIGS } from './test-runners.js';

/**
 * Facts for the test-data questions Q19 and Q21 (DevAudit-Installer#1116 WP3): what already looks
 * like a seed, and which Playwright projects depend on another project (a login). Read-only. A
 * Playwright config is a program, so it is read as text and never executed: when its `projects` list
 * cannot be read simply, the answer is "none", never a guess.
 */

export interface TestDataFacts {
  /** `npm run <script>` for each package.json script whose name contains "seed", then `scripts/seed*` files. */
  readonly seedScripts: string[];
  /** Playwright projects whose `dependencies` list is not empty (for Q21). */
  readonly dependentProjects: string[];
}

/** The seed commands and files found in `dir` (the repository root by default). */
export async function detectSeedScripts(reader: RepoReader, dir = ''): Promise<string[]> {
  const out: string[] = [];
  const parsed = await readJson(reader, joinRepoPath(dir, 'package.json'));
  const scripts = parsed !== null && typeof parsed === 'object' ? (parsed as { scripts?: unknown }).scripts : undefined;
  if (scripts !== null && typeof scripts === 'object' && !Array.isArray(scripts)) {
    for (const name of Object.keys(scripts as Record<string, unknown>).sort()) {
      if (/seed/i.test(name)) out.push(`npm run ${name}`);
    }
  }
  const scriptsDir = joinRepoPath(dir, 'scripts');
  for (const name of (await listFileNames(reader, scriptsDir)).sort()) {
    if (/^seed/i.test(name)) out.push(joinRepoPath(scriptsDir, name));
  }
  return out;
}

// ---- a small reader for the `projects: [...]` array of a Playwright config -------------------------------

/** The text with comments blanked out (same length, newlines kept); string contents are kept. */
function blankComments(text: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (quote) {
      out += c;
      if (c === '\\' && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') {
        out += ' ';
        i += 1;
      }
    } else if (c === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < text.length) {
        out += '  ';
        i += 2;
      }
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

const CLOSERS: Record<string, string> = { '[': ']', '{': '}', '(': ')' };

/** Index of the bracket that closes the one at `open`; null when the text is unbalanced. Strings are skipped. */
function matchBracket(text: string, open: number): number | null {
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c in CLOSERS) stack.push(CLOSERS[c]!);
    else if (c === ']' || c === '}' || c === ')') {
      if (stack.pop() !== c) return null;
      if (stack.length === 0) return i;
    }
  }
  return null;
}

/** Split on commas that are not inside brackets or strings. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '[' || c === '{' || c === '(') depth += 1;
    else if (c === ']' || c === '}' || c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

interface ProjectEntry {
  readonly name: string;
  readonly dependsOnAnother: boolean;
}

/** The projects of a Playwright config's text, or null when the list cannot be read simply. */
function readProjects(configText: string): ProjectEntry[] | null {
  const text = blankComments(configText);
  const found = /\bprojects\s*:\s*\[/.exec(text);
  if (!found) return null;
  const open = found.index + found[0].length - 1;
  const close = matchBracket(text, open);
  if (close === null) return null;
  const projects: ProjectEntry[] = [];
  for (const element of splitTopLevel(text.slice(open + 1, close))) {
    const trimmed = element.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue; // a spread or a variable: not read
    let name: string | null = null;
    let dependsOnAnother = false;
    for (const property of splitTopLevel(trimmed.slice(1, -1))) {
      const m = /^\s*['"]?(\w+)['"]?\s*:/.exec(property);
      if (!m) continue;
      const key = m[1];
      const value = property.slice(m[0].length).trim();
      if (key === 'name') {
        const literal = /^(['"`])([^'"`]*)\1$/.exec(value ?? '');
        if (literal) name = literal[2] ?? null;
      } else if (key === 'dependencies' && (value ?? '').startsWith('[')) {
        dependsOnAnother = (value ?? '').slice(1, -1).trim() !== '';
      }
    }
    if (name !== null) projects.push({ name, dependsOnAnother });
  }
  return projects;
}

/** Names of the projects in a Playwright config text that list a `dependencies` entry. Empty when unreadable. */
export function dependentProjectsFromConfig(configText: string): string[] {
  const projects = readProjects(configText) ?? [];
  const names: string[] = [];
  for (const p of projects) {
    if (p.dependsOnAnother && !names.includes(p.name)) names.push(p.name);
  }
  return names;
}

/** The dependent Playwright projects of the config in `dir` (the repository root by default). */
export async function detectDependentProjects(reader: RepoReader, dir = ''): Promise<string[]> {
  for (const name of PLAYWRIGHT_CONFIGS) {
    const text = await readText(reader, joinRepoPath(dir, name));
    if (text !== '') return dependentProjectsFromConfig(text);
  }
  return [];
}

export async function detectTestData(reader: RepoReader, dir = ''): Promise<TestDataFacts> {
  return { seedScripts: await detectSeedScripts(reader, dir), dependentProjects: await detectDependentProjects(reader, dir) };
}
