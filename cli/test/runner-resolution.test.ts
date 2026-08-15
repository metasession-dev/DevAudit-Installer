import { describe, it, expect } from 'vitest';

/**
 * Pins down the truth table from DevAudit-Installer#664 / DevAudit#803 for
 * the dynamic runner-resolution expression emitted by `resolveRunner()`
 * (cli/src/update/ci-templates.ts) when `sdlc-config.json` has
 * `runner: "self-hosted"`:
 *
 *   ${{ (inputs.runner_label || vars.CI_RUNNER_LABEL || 'github-ci')
 *         == 'github-ci' && 'ubuntu-latest'
 *         || (inputs.runner_label || vars.CI_RUNNER_LABEL || 'github-ci') }}
 *
 * GitHub Actions expressions can't run outside a real workflow, so this
 * reimplements the same short-circuit semantics in JS (empty string /
 * undefined are falsy, `&&` binds tighter than `||`, exactly as in GitHub's
 * expression grammar) and exercises it against every case in the issue's
 * required-interface table, plus the safe-fallback and pass-through cases.
 */
function resolveEffectiveRunner(runnerLabelInput: string | undefined, ciRunnerLabelVar: string | undefined): string {
  const value = runnerLabelInput || ciRunnerLabelVar || 'github-ci';
  return (value === 'github-ci' && 'ubuntu-latest') || value;
}

describe('dynamic runner resolution expression (DevAudit-Installer#664)', () => {
  it('maps the logical github-ci selector to the real GitHub-hosted label', () => {
    expect(resolveEffectiveRunner(undefined, 'github-ci')).toBe('ubuntu-latest');
  });

  it('passes through an explicit Ostendo label unchanged', () => {
    expect(resolveEffectiveRunner(undefined, 'ostendo-workhorse-ci')).toBe('ostendo-workhorse-ci');
    expect(resolveEffectiveRunner(undefined, 'ostendo-laptop2-ci')).toBe('ostendo-laptop2-ci');
  });

  it('falls back safely to ubuntu-latest when CI_RUNNER_LABEL is missing or blank', () => {
    expect(resolveEffectiveRunner(undefined, undefined)).toBe('ubuntu-latest');
    expect(resolveEffectiveRunner(undefined, '')).toBe('ubuntu-latest');
    // Never the literal 'self-hosted' label — that would hang the job
    // waiting for a runner that may not exist.
    expect(resolveEffectiveRunner(undefined, undefined)).not.toBe('self-hosted');
  });

  it('a manual workflow_dispatch runner_label input takes precedence over the repository variable', () => {
    expect(resolveEffectiveRunner('ostendo-laptop2-ci', 'github-ci')).toBe('ostendo-laptop2-ci');
    expect(resolveEffectiveRunner('github-ci', 'ostendo-workhorse-ci')).toBe('ubuntu-latest');
  });
});
