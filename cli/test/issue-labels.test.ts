import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const calls: string[][] = [];
let existing = '';
let listExit = 0;
let failCreate = false;

vi.mock('execa', () => ({
  execa: async (file: string, args: readonly string[]) => {
    calls.push([file, ...args]);
    if (file === 'gh' && args[0] === 'label' && args[1] === 'list') {
      if (listExit === 127) throw new Error('spawn gh ENOENT');
      return { exitCode: listExit, stdout: existing, stderr: '' };
    }
    if (file === 'gh' && args[1] === 'create') {
      return { exitCode: failCreate ? 1 : 0, stdout: '', stderr: failCreate ? 'nope' : '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  },
}));

import {
  ensureIssueTemplateLabels,
  collectTemplateLabels,
  parseTemplateLabels,
} from '../src/update/issue-labels.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

beforeEach(() => {
  calls.length = 0;
  existing = '';
  listExit = 0;
  failCreate = false;
});

describe('issue-template label seeding (#970)', () => {
  it('parses labels from an issue form', () => {
    expect(parseTemplateLabels('name: x\nlabels: ["bug", \'needs-triage\']\nbody: []')).toEqual([
      'bug',
      'needs-triage',
    ]);
    expect(parseTemplateLabels('name: x')).toEqual([]);
  });

  it('collects every label declared by the real templates', async () => {
    const labels = await collectTemplateLabels(ROOT);
    for (const l of ['bug', 'requirement', 'needs-triage', 'task', 'chore', 'srs-bootstrap', 'documentation', 'accepted-e2e-failure', 'accepted-dependency-risk']) {
      expect(labels).toContain(l);
    }
  });

  it('creates only the missing labels with --force', async () => {
    existing = 'bug\nrequirement\n';
    const r = await ensureIssueTemplateLabels('/repo', ROOT);
    const creates = calls.filter((c) => c[2] === 'create');
    expect(creates.map((c) => c[3])).toContain('needs-triage');
    expect(creates.map((c) => c[3])).not.toContain('bug');
    expect(creates.every((c) => c.includes('--force'))).toBe(true);
    expect(r.created).toContain('needs-triage');
  });

  it('is a no-op when everything exists (idempotent)', async () => {
    existing = (await collectTemplateLabels(ROOT)).join('\n');
    const r = await ensureIssueTemplateLabels('/repo', ROOT);
    expect(r.created).toEqual([]);
    expect(calls.some((c) => c[2] === 'create')).toBe(false);
  });

  it('makes no gh calls in dry-run', async () => {
    const r = await ensureIssueTemplateLabels('/repo', ROOT, { dryRun: true });
    expect(calls).toEqual([]);
    expect(r.skipped).toBe('dry-run');
  });

  it('degrades gracefully when gh fails, is missing, or create fails', async () => {
    listExit = 1;
    expect((await ensureIssueTemplateLabels('/repo', ROOT)).skipped).toBeDefined();
    listExit = 127;
    expect((await ensureIssueTemplateLabels('/repo', ROOT)).skipped).toBeDefined();
    listExit = 0;
    failCreate = true;
    await expect(ensureIssueTemplateLabels('/repo', ROOT)).resolves.toEqual({ created: [] });
  });
});
