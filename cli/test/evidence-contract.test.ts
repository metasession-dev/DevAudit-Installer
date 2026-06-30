import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractEvidenceTypesFromTemplates } from '../src/lib/evidence-type-extractor.js';

/**
 * devaudit-installer#247 — Installer-side evidence-type contract test.
 *
 * Verifies that every evidence type emitted by the CI templates in
 * sdlc/files/ci/ exists in the shared contract file
 * (contracts/evidence-types.json from the portal repo, copied here
 * during sync). This prevents silent drift: if a template starts
 * sending a new evidence_type the portal doesn't know about, the
 * portal's evidence validator will reject the upload at runtime.
 *
 * The contract file is fetched from the portal repo via the
 * sync-evidence-contract.yml workflow (repository_dispatch) and
 * committed to this repo at contracts/evidence-types.json.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const CONTRACT_PATH = resolve(INSTALLER_ROOT, 'contracts', 'evidence-types.json');
const CI_DIR = resolve(INSTALLER_ROOT, 'sdlc', 'files', 'ci');

interface ContractFile {
  readonly version: string;
  readonly evidence_types: Readonly<Record<string, unknown>>;
  readonly evidence_categories: readonly string[];
}

function loadContract(): ContractFile {
  const raw = readFileSync(CONTRACT_PATH, 'utf-8');
  return JSON.parse(raw) as ContractFile;
}

describe('evidence-type contract — devaudit-installer#247', () => {
  const contract = loadContract();
  const contractTypes = new Set(Object.keys(contract.evidence_types));

  it('contract file exists and is parseable', () => {
    expect(contract).toBeDefined();
    expect(contract.version).toBeTruthy();
    expect(Object.keys(contract.evidence_types).length).toBeGreaterThan(0);
  });

  it('extracts evidence types from CI templates', async () => {
    const result = await extractEvidenceTypesFromTemplates(CI_DIR);
    expect(result.types.length).toBeGreaterThan(0);
  });

  it('every type emitted by CI templates exists in the contract', async () => {
    const result = await extractEvidenceTypesFromTemplates(CI_DIR);
    const unknown = result.types.filter((t) => !contractTypes.has(t));
    expect(
      unknown,
      `CI templates emit evidence types not in contract: ${unknown.join(', ')}. ` +
        'Add them to contracts/evidence-types.json in the portal repo.',
    ).toEqual([]);
  });

  it('contract types are a superset of installer-emitted types', async () => {
    const result = await extractEvidenceTypesFromTemplates(CI_DIR);
    const installerSet = new Set(result.types);
    // Every installer type must be in the contract
    for (const t of result.types) {
      expect(
        contractTypes.has(t),
        `Installer type "${t}" missing from contract`,
      ).toBe(true);
    }
    // Contract may have types the installer doesn't emit yet (e.g.
    // manual_upload, playwright_report_bundle) — that's fine.
    const contractOnly = Array.from(contractTypes).filter((t) => !installerSet.has(t));
    // Just verify the contract has at least as many types as the installer
    expect(contractTypes.size).toBeGreaterThanOrEqual(installerSet.size);
    // Log contract-only types for visibility (not a failure)
    if (contractOnly.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[contract] Types in contract but not emitted by installer: ${contractOnly.join(', ')}`,
      );
    }
  });
});
