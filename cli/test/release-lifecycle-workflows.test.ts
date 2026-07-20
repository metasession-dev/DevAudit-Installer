import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const template = (name: string) =>
  readFileSync(resolve(root, 'sdlc/files/ci', name), 'utf8').replace(/\r\n/g, '\n');

describe('authoritative release lifecycle workflow templates (#405)', () => {
  it('records quality-gate lifecycle around execution and uses the upstream job result', () => {
    const source = template('ci.yml.template');
    expect(source).toContain('quality-gates:\n    name: Quality Gates\n    needs: [register-release]');
    expect(source.indexOf('Start authoritative quality-gate cycle')).toBeLessThan(
      source.indexOf('- name: TypeScript Check'),
    );
    expect(source).toContain('case "${{ needs.quality-gates.result }}" in');
    expect(source).toContain('--environment ci');
    expect(source).not.toContain('case "${{ job.status }}" in');
  });

  it('records E2E outcome and timestamps from the triggering workflow, not artifact upload', () => {
    const source = template('compliance-evidence.yml.template');
    expect(source).toContain('case "${{ github.event.workflow_run.conclusion }}" in');
    expect(source).toContain('--started-at "${{ github.event.workflow_run.run_started_at }}"');
    expect(source).toContain('--completed-at "${{ github.event.workflow_run.updated_at }}"');
    expect(source).toContain('artifactUploadFailures');
    expect(source).not.toContain('if [ "$REQ_FAILURES" -gt 0 ]; then\n              REQ_OUTCOME=failed');
  });

  it('records deployment and smoke as distinct always-finalized production cycles', () => {
    const source = template('post-deploy-prod.yml.template');
    expect(source.indexOf('Start production deployment cycles')).toBeLessThan(
      source.indexOf('Wait for production deployment'),
    );
    expect(source).toContain('Complete production deployment cycles\n        if: always()');
    expect(source).toContain('--cycle-kind deployment');
    expect(source).toContain('--cycle-kind smoke');
    expect(source).toContain('Complete production smoke cycles\n        if: always()');
    expect(source).toContain("if: steps.production_smoke.outcome == 'success'");
    expect(source).toContain('Production Evidence Completeness');
  });

  it('only fans out E2E JSON to requirements whose tests executed in that result', () => {
    const source = template('ci.yml.template');
    expect(source).toContain('has_req_tagged_e2e_result()');
    expect(source).toContain('has_req_tagged_e2e_result "$REQ_ID" ci-evidence/e2e-results.json');
    expect(source).toContain('Not attaching generic E2E JSON to ${REQ_ID}');
    expect(source).toContain('Run-level evidence remains on _compliance-docs');
    expect(source).toContain("result.get('status') not in {'skipped', 'interrupted'}");
  });
});
