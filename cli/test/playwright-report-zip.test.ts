import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findConfigKey, validateConfigKeyValue } from '../src/lib/repo-config-keys.js';

// DevAudit-Installer#1275 / #1271 — the Playwright report zip leaves out traces and videos, and a
// failed upload of the report does not fail the CI Pipeline evidence job.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => fs.readFile(join(ROOT, rel), 'utf-8');

describe('Playwright report zip (#1275)', () => {
  it('every workflow builds the zip through the helper, never an inline zip of the report', async () => {
    for (const rel of [
      'sdlc/files/ci/ci.yml.template',
      'sdlc/files/ci/feature-e2e.yml.template',
      'sdlc/files/ci/compliance-evidence.yml.template',
    ]) {
      const text = await read(rel);
      expect(text, rel).toContain('playwright-report-evidence.sh');
      expect(text, rel).not.toMatch(/zip -qr playwright-report\.zip/);
    }
  });

  it('the helper excludes the trace viewer, trace zips and videos unless e2e_report_include_traces is true', async () => {
    const text = await read('sdlc/files/_common/scripts/playwright-report-evidence.sh');
    expect(text).toContain("playwright-report/trace/*");
    expect(text).toContain("playwright-report/data/*.zip");
    expect(text).toContain("*.webm");
    expect(text).toContain('e2e_report_include_traces');
  });

  it('e2e_report_include_traces is a boolean key that defaults to off and regenerates nothing', () => {
    const spec = findConfigKey('e2e_report_include_traces');
    expect(spec).toBeDefined();
    expect(spec!.type).toBe('boolean');
    expect(spec!.affects).toEqual([]);
    expect(validateConfigKeyValue('e2e_report_include_traces', 'true')).toEqual({ value: true });
    expect(validateConfigKeyValue('e2e_report_include_traces', 'false')).toEqual({ value: false });
    expect(validateConfigKeyValue('e2e_report_include_traces', 'maybe').error).toBeDefined();
  });

  it('the example config documents the key with the default off', async () => {
    const example = JSON.parse(await read('sdlc/files/sdlc-config.example.json')) as Record<string, unknown>;
    expect(example['e2e_report_include_traces']).toBe(false);
    expect(example['_comment_e2e_report_include_traces']).toEqual(expect.any(String));
  });
});

describe('CI Pipeline report upload is non-blocking when the results file exists (#1271)', () => {
  it('uploads the report outside the failure counter when e2e-results.json exists', async () => {
    const text = await read('sdlc/files/ci/ci.yml.template');
    const start = text.indexOf('Playwright HTML report upload failed');
    expect(start).toBeGreaterThan(0);
    const block = text.slice(text.lastIndexOf('if [ -f ci-evidence/playwright-report.zip ]', start), start + 200);
    expect(block).toContain('if [ -f ci-evidence/e2e-results.json ]');
    expect(block).toContain('::warning::Playwright HTML report upload failed');
    // The failing path of that branch must not bump the failure counter.
    const warnLine = text.slice(start - 200, start + 120);
    expect(warnLine).not.toContain('UPLOAD_FAILURES');
  });

  it('still counts a failed report upload when there is no results file', async () => {
    const text = await read('sdlc/files/ci/ci.yml.template');
    const idx = text.indexOf('if [ -f ci-evidence/playwright-report.zip ]');
    const block = text.slice(idx, idx + 1400);
    expect(block).toContain('else\n                upload playwright-report.zip');
  });
});
