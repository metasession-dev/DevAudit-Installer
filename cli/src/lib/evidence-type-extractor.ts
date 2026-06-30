import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * devaudit-installer#247 — Extract evidence types from CI template files.
 *
 * Parses .yml.template files in sdlc/files/ci/ to find all evidence_type
 * values used in upload-evidence.sh invocations, EVTYPE= assignments,
 * and upload_project_doc calls. The extracted set is compared against
 * the shared contract (contracts/evidence-types.json from the portal)
 * to detect drift.
 *
 * Extraction patterns (ordered by specificity):
 * 1. upload-evidence.sh positional: `upload-evidence.sh <slug> <req> <TYPE> <file>`
 *    — The 3rd positional arg after the script name is the evidence type.
 * 2. EVTYPE=<type>; — case statement assignments in bash.
 * 3. upload_project_doc <file> <TYPE> — 2nd arg is the evidence type.
 */

const UPLOAD_EVIDENCE_RE = /bash\s+scripts\/upload-evidence\.sh\s+\S+\s+\S+\s+([a-z][a-z0-9_]*)/g;
const EVTYPE_RE = /EVTYPE=([a-z][a-z0-9_]*)/g;
const UPLOAD_PROJECT_DOC_RE = /upload_project_doc\s+\S+\s+([a-z][a-z0-9_]*)/g;

const TEMPLATE_EXTENSIONS = new Set(['.template']);

const BASH_KEYWORDS = new Set([
  'echo', 'then', 'else', 'fi', 'do', 'done', 'for', 'while', 'if',
  'local', 'shift', 'true', 'false', 'exit', 'continue', 'break',
  'return', 'eval', 'exec', 'export', 'unset', 'set', 'source',
  'chmod', 'mkdir', 'cp', 'mv', 'rm', 'cat', 'grep', 'sed', 'awk',
]);

function isLikelyEvidenceType(token: string): boolean {
  if (token.length < 2) return false;
  if (BASH_KEYWORDS.has(token)) return false;
  if (!/^[a-z][a-z0-9_]*$/.test(token)) return false;
  return true;
}

export interface ExtractedEvidenceTypes {
  readonly types: readonly string[];
  readonly byFile: Readonly<Record<string, readonly string[]>>;
}

/**
 * Extract all evidence types from a single template file's content.
 */
export function extractEvidenceTypesFromContent(content: string): Set<string> {
  const types = new Set<string>();
  const normalized = content.replace(/\\\n/g, ' ');
  let match: RegExpExecArray | null;
  UPLOAD_EVIDENCE_RE.lastIndex = 0;
  while ((match = UPLOAD_EVIDENCE_RE.exec(normalized)) !== null) {
    if (match[1] && isLikelyEvidenceType(match[1])) types.add(match[1]);
  }
  EVTYPE_RE.lastIndex = 0;
  while ((match = EVTYPE_RE.exec(normalized)) !== null) {
    if (match[1] && isLikelyEvidenceType(match[1])) types.add(match[1]);
  }
  UPLOAD_PROJECT_DOC_RE.lastIndex = 0;
  while ((match = UPLOAD_PROJECT_DOC_RE.exec(normalized)) !== null) {
    if (match[1] && isLikelyEvidenceType(match[1])) types.add(match[1]);
  }
  return types;
}

/**
 * Scan all .yml.template files in a directory and extract evidence types.
 *
 * @param ciDir — path to sdlc/files/ci/ (or a subdirectory)
 * @returns sorted list of unique evidence types + per-file breakdown
 */
export async function extractEvidenceTypesFromTemplates(
  ciDir: string,
): Promise<ExtractedEvidenceTypes> {
  const byFile: Record<string, string[]> = {};
  const allTypes = new Set<string>();
  await walkTemplates(ciDir, async (filePath, content) => {
    const types = extractEvidenceTypesFromContent(content);
    if (types.size > 0) {
      const sorted = Array.from(types).sort();
      byFile[filePath] = sorted;
      for (const t of sorted) {
        allTypes.add(t);
      }
    }
  });
  return {
    types: Array.from(allTypes).sort(),
    byFile,
  };
}

async function walkTemplates(
  dir: string,
  fn: (filePath: string, content: string) => Promise<void>,
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkTemplates(fullPath, fn);
    } else if (entry.isFile() && TEMPLATE_EXTENSIONS.has(extname(entry.name))) {
      const content = await fs.readFile(fullPath, 'utf-8');
      await fn(fullPath, content);
    }
  }
}
