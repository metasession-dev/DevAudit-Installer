import { describe, it, expect, beforeAll } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAll } from './helpers/render-workflows.js';

// DevAudit-Installer#1116 WP2 (R20): every generated workflow takes its branches from
// `integration_branch` / `release_branch`. Four templates used to hard-code `main` or `develop`, so
// with other branch names (Q10 offers them) they would never have run.

const HERE = dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  process.env['DEVAUDIT_INSTALLER_ROOT'] = resolve(HERE, '..', '..');
});

/**
 * The workflow without comments and URLs. A comment is not something the workflow does, and a URL
 * (for example a link to this repository's own docs on its `main` branch) names a branch of another
 * repository. Everything else, including `origin/main` and the words in messages, must follow the
 * configured branches.
 */
const withoutCommentsAndUrls = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/https?:\/\/[^\s"')>]+/g, '').replace(/(^|\s)#.*$/, ''))
    .join('\n');

const BRANCH_WORD = /\b(main|develop)\b/;

describe('custom branch names reach every generated workflow (R20)', { timeout: 180_000 }, () => {
  for (const stack of ['node', 'python'] as const) {
    it(`${stack}: with release_branch production and integration_branch staging no workflow names main or develop`, async () => {
      const workflows = await renderAll(stack, { release_branch: 'production', integration_branch: 'staging' });
      const offenders: string[] = [];
      for (const [name, text] of Object.entries(workflows)) {
        withoutCommentsAndUrls(text)
          .split('\n')
          .forEach((line, index) => {
            if (BRANCH_WORD.test(line)) offenders.push(`${name}:${index + 1}: ${line.trim()}`);
          });
      }
      expect(offenders).toEqual([]);
    });
  }

  it('the four templates that used to hard-code a branch now use the configured ones', async () => {
    const wf = await renderAll('node', { release_branch: 'production', integration_branch: 'staging' });
    expect(wf['compliance-validation.yml']).toContain('pull_request:\n    branches: [production]');
    expect(wf['compliance-validation.yml']).toContain('validate-compliance-artifacts.sh origin/production');
    expect(wf['compliance-validation.yml']).toContain('validate-test-summary.sh origin/production');
    expect(wf['compliance-validation.yml']).toContain('validate-commits.sh origin/production');
    expect(wf['compliance-evidence.yml']).toContain('branches: [staging]');
    expect(wf['ci-status-fallback.yml']).toContain('branches: [staging]');
    expect(wf['close-out-completion.yml']).toContain('branches: [staging]');
  });

  it('the default branches are unchanged: main for the release branch, develop for the integration branch', async () => {
    const wf = await renderAll('node');
    expect(wf['compliance-validation.yml']).toContain('branches: [main]');
    expect(wf['compliance-validation.yml']).toContain('validate-commits.sh origin/main');
    expect(wf['compliance-evidence.yml']).toContain('branches: [develop]');
    expect(wf['ci-status-fallback.yml']).toContain('branches: [develop]');
    expect(wf['close-out-completion.yml']).toContain('branches: [develop]');
  });
});
