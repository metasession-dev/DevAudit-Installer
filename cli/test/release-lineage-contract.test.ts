import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  RELEASE_LINEAGE_IDEMPOTENCY_KEY_PATTERN,
  isValidReleaseLineageIdempotencyKey,
  renderEvidenceLineageFields,
} from '../src/lib/release-lineage-contract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CONTRACT_PATH = resolve(REPO_ROOT, 'contracts/release-lineage-contract.json');

interface ContractDocument {
  version: string;
  $defs?: Record<string, unknown>;
  payloads: Record<
    string,
    {
      schema: Record<string, unknown>;
      example?: Record<string, unknown>;
      examples?: Record<string, unknown>[];
    }
  >;
}

function loadContract(): ContractDocument {
  return JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as ContractDocument;
}

function compilePayloadSchema(
  ajv: Ajv2020,
  contract: ContractDocument,
  name: keyof ContractDocument['payloads'],
) {
  return ajv.compile({
    ...(contract.payloads[name]!.schema as Record<string, unknown>),
    ...(contract.$defs ? { $defs: contract.$defs } : {}),
  });
}

describe('release-lineage contract (#391)', () => {
  const contract = loadContract();
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    formats: {
      'date-time': true,
      uri: true,
      uuid: true,
    },
  });
  ajv.addSchema(contract as unknown as Record<string, unknown>, 'release-lineage-contract');

  it('exists and exposes a versioned contract payload set', () => {
    expect(contract.version).toBe('1.0.0');
    expect(Object.keys(contract.payloads)).toEqual(
      expect.arrayContaining([
        'test_cycle_started',
        'test_cycle_completed',
        'test_cycle_reconciled',
        'evidence_lineage_fields',
        'bundle_manifest',
      ]),
    );
  });

  it('accepts the documented test cycle started example', () => {
    const validate = compilePayloadSchema(ajv, contract, 'test_cycle_started');
    expect(validate(contract.payloads['test_cycle_started']!.example)).toBe(true);
  });

  it('accepts the documented test cycle completed example', () => {
    const validate = compilePayloadSchema(ajv, contract, 'test_cycle_completed');
    expect(validate(contract.payloads['test_cycle_completed']!.example)).toBe(true);
  });

  it('rejects invalid enum values and malformed idempotency keys', () => {
    const validate = compilePayloadSchema(ajv, contract, 'test_cycle_completed');
    const invalid = {
      ...contract.payloads['test_cycle_completed']!.example,
      environment: 'staging',
      idempotencyKey: 'bad-key',
    };
    expect(validate(invalid)).toBe(false);
  });

  it('rejects running as a terminal cycle outcome', () => {
    const validate = compilePayloadSchema(ajv, contract, 'test_cycle_completed');
    const invalid = {
      ...contract.payloads['test_cycle_completed']!.example,
      outcome: 'running',
    };
    expect(validate(invalid)).toBe(false);
  });

  it('accepts the documented evidence-lineage examples', () => {
    const validate = compilePayloadSchema(ajv, contract, 'evidence_lineage_fields');
    for (const example of contract.payloads['evidence_lineage_fields']!.examples ?? []) {
      expect(validate(example)).toBe(true);
    }
  });

  it('rejects a cycle record id when the scope is not cycle', () => {
    const validate = compilePayloadSchema(ajv, contract, 'evidence_lineage_fields');
    expect(
      validate({
        evidenceScope: 'release',
        testCycleRecordId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toBe(false);
  });

  it('accepts the documented bundle manifest example', () => {
    const validate = compilePayloadSchema(ajv, contract, 'bundle_manifest');
    expect(validate(contract.payloads['bundle_manifest']!.example)).toBe(true);
  });

  it('accepts a non-release-only bundle manifest with zero release members', () => {
    const validate = compilePayloadSchema(ajv, contract, 'bundle_manifest');
    expect(
      validate({
        schemaVersion: 1,
        approvalRelease: { version: 'REQ-093' },
        coreRelease: { version: 'REQ-093' },
        members: [],
        nonReleaseWorkItems: [
          {
            kind: 'housekeeping_commit',
            title: 'docs: refresh bundled release guidance',
            reference: 'abc1234',
          },
        ],
        manifestHash: 'sha256:test',
        generator: { name: 'devaudit-installer', version: '0.3.12' },
      }),
    ).toBe(true);
  });

  it('rejects invalid bundle member relationships', () => {
    const validate = compilePayloadSchema(ajv, contract, 'bundle_manifest');
    const invalid = {
      ...contract.payloads['bundle_manifest']!.example,
      members: [
        {
          version: 'REQ-090',
          role: 'predecessor',
          relationship: 'wrong',
        },
      ],
    };
    expect(validate(invalid)).toBe(false);
  });

  it('validates the canonical idempotency key shape', () => {
    expect(
      isValidReleaseLineageIdempotencyKey(
        'github:metasession-dev/wawagardenbar-app:Quality-Gates:12345:attempt:2:stage:2:REQ-093',
      ),
    ).toBe(true);
    expect(RELEASE_LINEAGE_IDEMPOTENCY_KEY_PATTERN.test('github:too-short')).toBe(false);
  });

  it('renders legacy-compatible evidence lineage for old portals', () => {
    expect(
      renderEvidenceLineageFields(
        {
          evidenceScope: 'cycle',
          testCycleRecordId: '11111111-1111-4111-8111-111111111111',
          testCycleId: '12345',
        },
        { supportsFirstClassCycleApi: false },
      ),
    ).toEqual({ testCycleId: '12345' });
  });

  it('renders dual-write evidence lineage when the portal supports first-class cycle APIs', () => {
    expect(
      renderEvidenceLineageFields(
        {
          evidenceScope: 'cycle',
          testCycleRecordId: '11111111-1111-4111-8111-111111111111',
          testCycleId: '12345',
        },
        { supportsFirstClassCycleApi: true },
      ),
    ).toEqual({
      evidenceScope: 'cycle',
      testCycleRecordId: '11111111-1111-4111-8111-111111111111',
      testCycleId: '12345',
    });
  });
});
