import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * devaudit#247 — Installer-side evidence-type contract test.
 *
 * Extracts every evidence_type the CI templates can send and verifies
 * each one exists in the shared contract file. This would have caught
 * `coverage_report` and `bundled_changes` being sent by CI but missing
 * from the portal's EvidenceType union (devaudit#539).
 *
 * The contract file lives in the portal repo at
 * contracts/evidence-types.json. For local development and CI, we read
 * a local copy if available, otherwise fetch from raw.githubusercontent.com.
 * In this test we read the local copy committed alongside the test
 * (contracts/evidence-types.json) — kept in sync by the cross-repo
 * contract check workflow.
 *
 * Test direction: only fails on "installer sends types the portal doesn't
 * accept". Portal having extra types is forward compatibility, not drift.
 */

// CI runs vitest from the cli/ directory, so use __dirname to locate
// the repo root rather than process.cwd().
const REPO_ROOT = resolve(__dirname, '..', '..');
const CONTRACT_PATH = resolve(REPO_ROOT, 'contracts/evidence-types.json');
const CI_DIR = resolve(REPO_ROOT, 'sdlc/files/ci');

interface ContractEntry {
  category: string;
  description: string;
  clause_predicates?: string[];
  gate?: boolean;
  ac_proof?: boolean;
  test_cycle_scoped?: boolean;
}

interface Contract {
  version: string;
  evidence_types: Record<string, ContractEntry>;
  evidence_categories: string[];
  release_shapes: Record<string, unknown>;
}

function loadContract(): Contract {
  if (!existsSync(CONTRACT_PATH)) {
    throw new Error(
      `Contract file not found at ${CONTRACT_PATH}. ` +
        'Copy it from the portal repo (contracts/evidence-types.json) or run the contract sync workflow.',
    );
  }
  return JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
}

/**
 * Pre-process template content for reliable regex extraction:
 * 1. Join line continuations — replace `\` + newline with a space so
 *    multi-line shell commands become single lines. Without this, `\S+`
 *    matches the backslash, throwing off positional argument counting.
 * 2. Strip full-line comments — lines whose first non-whitespace char is
 *    `#`. This prevents regexes from matching English words in comments
 *    (e.g. "upload the results so the portal can ...").
 */
function preprocess(content: string): string {
  // Normalize CRLF to LF so regexes work consistently on Windows.
  const normalized = content.replace(/\r\n/g, '\n');
  const joined = normalized.replace(/\\\n\s*/g, ' ');
  return joined
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('#');
    })
    .join('\n');
}

/**
 * Recursively collect all .yml.template and .yml files from a directory
 * and its subdirectories (e.g. the python/ subdirectory).
 */
function collectTemplateFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTemplateFiles(fullPath));
    } else if (entry.name.endsWith('.yml.template') || entry.name.endsWith('.yml')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Extract evidence_type strings from CI template files.
 *
 * Three patterns:
 * 1. `upload-evidence.sh ... <TYPE> <file>` — positional arg 3
 *    Matches: `bash scripts/upload-evidence.sh SLUG _compliance-docs sast_report file`
 *    Also matches the `upload` wrapper: `upload file SLUG _compliance-docs sast_report file`
 * 2. `EVTYPE=<type>;` — case statement assignments
 *    Matches: `EVTYPE=test_report; EVCAT=test_report ;;`
 * 3. `upload_project_doc ... <type>` — function call with type as last arg
 *    Matches: `upload_project_doc compliance/RTM.md rtm`
 */
function extractEvidenceTypes(dir: string): Set<string> {
  const types = new Set<string>();
  const files = collectTemplateFiles(dir);

  // Pattern 1: positional arg to upload-evidence.sh or `upload` wrapper
  // The 3rd positional arg after the slug is the evidence type.
  // [^\s|;&()]+ excludes shell operators (||, &&, ;) and parens so we
  // don't capture `true` from `|| true` or `echo` from `; then echo`.
  // [ \t]+ (not \s+) prevents matching across line boundaries.
  const uploadEvidencePattern =
    /upload-evidence\.sh[ \t]+[^\s|;&()]+[ \t]+[^\s|;&()]+[ \t]+([a-z_][a-z_0-9]*)[ \t]/g;
  const uploadWrapperPattern =
    /\bupload[ \t]+[^\s|;&()]+[ \t]+[^\s|;&()]+[ \t]+[^\s|;&()]+[ \t]+([a-z_][a-z_0-9]*)[ \t]/g;

  // Pattern 2: EVTYPE=<type>;
  const evtypePattern = /EVTYPE=([a-z_][a-z_0-9]*)/g;

  // Pattern 3: upload_project_doc ... <type> (last arg on the line)
  const uploadDocPattern = /upload_project_doc[ \t]+[^\s|;&()]+[ \t]+([a-z_][a-z_0-9]*)/g;

  for (const file of files) {
    const content = preprocess(readFileSync(file, 'utf-8'));

    let m: RegExpExecArray | null;
    while ((m = uploadEvidencePattern.exec(content)) !== null) {
      if (m[1]) types.add(m[1]);
    }
    while ((m = uploadWrapperPattern.exec(content)) !== null) {
      if (m[1]) types.add(m[1]);
    }
    while ((m = evtypePattern.exec(content)) !== null) {
      if (m[1]) types.add(m[1]);
    }
    while ((m = uploadDocPattern.exec(content)) !== null) {
      if (m[1]) types.add(m[1]);
    }
  }

  return types;
}

describe('evidence-type contract (devaudit#247)', () => {
  const contract = loadContract();
  const contractTypes = new Set(Object.keys(contract.evidence_types));

  describe('contract file', () => {
    it('exists and is valid JSON', () => {
      expect(contract).toBeDefined();
      expect(typeof contract.version).toBe('string');
    });

    it('has evidence_types object', () => {
      expect(Object.keys(contract.evidence_types).length).toBeGreaterThan(0);
    });
  });

  describe('CI template extraction', () => {
    const extractedTypes = extractEvidenceTypes(CI_DIR);

    it('extracts a non-empty set of types', () => {
      expect(extractedTypes.size).toBeGreaterThan(0);
    });

    it('every extracted type exists in the contract', () => {
      const missing: string[] = [];
      for (const type of extractedTypes) {
        if (!contractTypes.has(type)) {
          missing.push(type);
        }
      }
      expect(
        missing,
        `CI templates send types not in the contract: ${missing.join(', ')}. ` +
          'Add them to contracts/evidence-types.json and the portal\'s EVIDENCE_TYPE_REGISTRY.',
      ).toEqual([]);
    });

    it('includes known gate evidence types', () => {
      for (const type of ['sast_report', 'dependency_audit', 'gate_outcome']) {
        expect(
          extractedTypes.has(type),
          `Expected CI templates to send "${type}"`,
        ).toBe(true);
      }
    });

    it('includes release_registration', () => {
      expect(extractedTypes.has('release_registration')).toBe(true);
    });

    it('includes bundled_changes', () => {
      expect(extractedTypes.has('bundled_changes')).toBe(true);
    });

    it('includes coverage_report', () => {
      expect(extractedTypes.has('coverage_report')).toBe(true);
    });
  });

  describe('contract ↔ installer drift detection', () => {
    it('contract types the installer does not send are informational only', () => {
      const extracted = extractEvidenceTypes(CI_DIR);
      const contractOnly = [...contractTypes].filter(
        (t) => !extracted.has(t),
      );
      // These are forward-compatibility types the portal accepts but the
      // installer doesn't currently send. This is NOT a failure — just
      // informational. We log them for visibility.
      if (contractOnly.length > 0) {
        console.log(
          `[contract] Portal-only types (forward compatibility, not drift): ${contractOnly.join(', ')}`,
        );
      }
      expect(contractOnly.length).toBeGreaterThanOrEqual(0);
    });
  });
});
