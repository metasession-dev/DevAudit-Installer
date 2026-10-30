import { describe, expect, it } from 'vitest';
import { VALIDATORS, VALIDATOR_IDS, isValidBranchName, validate, validateAll } from '../src/index.js';

describe('the validators of the question registry', () => {
  it('there is a function for every id, and no other', () => {
    expect(Object.keys(VALIDATORS).sort()).toEqual([...VALIDATOR_IDS].sort());
    expect([...VALIDATOR_IDS].sort()).toEqual(
      ['branchesDiffer', 'cron5', 'existingDir', 'existingPath', 'hostAdapterExists', 'httpsUrl', 'nonEmpty', 'positiveInt', 'secretName', 'slug', 'tierHasTests'].sort(),
    );
  });

  it('slug: lower-case words joined by single hyphens', () => {
    for (const ok of ['my-app', 'app', 'a1-b2-c3', '2fast']) expect(validate('slug', ok), ok).toBeNull();
    for (const bad of ['', 'My-App', 'my_app', '-app', 'app-', 'my--app', 'my app', 'a'.repeat(65)]) expect(validate('slug', bad), bad).not.toBeNull();
    expect(validate('slug', 42)).not.toBeNull();
  });

  it('httpsUrl: an https address that is not local', () => {
    for (const ok of ['https://app.example.com', 'https://app.example.com/path?x=1', ' https://a.b ']) expect(validate('httpsUrl', ok), ok).toBeNull();
    for (const bad of ['', 'http://app.example.com', 'app.example.com', 'https://localhost:3000', 'https://127.0.0.1', 'https://app.localhost', 'ftp://x.y']) {
      expect(validate('httpsUrl', bad), bad).not.toBeNull();
    }
    expect(validate('httpsUrl', 'http://x.y')).toBe('must start with https://');
    expect(validate('httpsUrl', 'https://localhost')).toMatch(/not localhost/);
  });

  it('secretName: upper case, digits and underscores, starting with a letter', () => {
    for (const ok of ['EXAMPLE_APP_PROD_URL', 'A', 'A1_B2']) expect(validate('secretName', ok), ok).toBeNull();
    for (const bad of ['', 'lower', '1ABC', '_ABC', 'ABC-DEF', 'ABC DEF']) expect(validate('secretName', bad), bad).not.toBeNull();
  });

  it('cron5: exactly five fields, no quotes', () => {
    for (const ok of ['0 2 * * *', '*/15 * * * 1-5', '30 4 1,15 * *']) expect(validate('cron5', ok), ok).toBeNull();
    for (const bad of ['', '0 2 * *', '0 2 * * * *', '"0 2 * * *"', "0 2 * * *'x", 'a\nb c d e']) expect(validate('cron5', bad), bad).not.toBeNull();
  });

  it('existingDir: every named folder exists (a space-separated string or a list), the root always does', () => {
    const ctx = { existingDirs: ['app', 'lib', 'src/server'] };
    expect(validate('existingDir', 'app lib', ctx)).toBeNull();
    expect(validate('existingDir', ['app/', 'src/server'], ctx)).toBeNull();
    expect(validate('existingDir', '.', ctx)).toBeNull();
    expect(validate('existingDir', 'app docs', ctx)).toBe('these folders do not exist in the repository: docs');
    expect(validate('existingDir', '', ctx)).toBe('must name at least one folder');
    expect(validate('existingDir', 7, ctx)).not.toBeNull();
  });

  it('existingPath: every named file or folder exists', () => {
    const ctx = { existingPaths: ['scripts/seed.ts', 'e2e/fixtures'] };
    expect(validate('existingPath', ['scripts/seed.ts', 'e2e/fixtures/'], ctx)).toBeNull();
    expect(validate('existingPath', 'scripts/seed.ts e2e/missing', ctx)).toBe('these paths do not exist in the repository: e2e/missing');
    expect(validate('existingPath', [], ctx)).toBe('must name at least one file or folder');
  });

  it('a validator that needs the repository does not refuse what it cannot check', () => {
    expect(validate('existingDir', 'anything')).toBeNull();
    expect(validate('existingPath', 'anything')).toBeNull();
    expect(validate('hostAdapterExists', 'anything')).toBeNull();
    expect(validate('tierHasTests', 'full')).toBeNull();
  });

  it('branchesDiffer: two valid, different names', () => {
    expect(validate('branchesDiffer', { integration: 'develop', release: 'main' })).toBeNull();
    expect(validate('branchesDiffer', { integration: 'staging', release: 'production' })).toBeNull();
    expect(validate('branchesDiffer', { integration: 'main', release: 'main' })).toMatch(/different branches/);
    expect(validate('branchesDiffer', { integration: 'dev elop', release: 'main' })).toMatch(/integration branch name/);
    expect(validate('branchesDiffer', { integration: 'develop', release: '..' })).toMatch(/release branch name/);
    expect(validate('branchesDiffer', 'develop')).toMatch(/integration branch and the release branch/);
    expect(validate('branchesDiffer', { integration: 'develop' })).not.toBeNull();
  });

  it('isValidBranchName follows git', () => {
    for (const ok of ['main', 'develop', 'release/1.0', 'feature/1116-wp5', 'a-b_c.d']) expect(isValidBranchName(ok), ok).toBe(true);
    for (const bad of ['', '-x', '/x', 'x/', 'x.', 'a..b', 'a b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'a@{b', 'a//b', 'x.lock', '.hidden', 'a/.b', 'a\x01b']) {
      expect(isValidBranchName(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('tierHasTests: the group must exist, none always works', () => {
    const ctx = { testGroups: { smoke: true, critical: false, full: false } };
    expect(validate('tierHasTests', 'none', ctx)).toBeNull();
    expect(validate('tierHasTests', 'smoke', ctx)).toBeNull();
    expect(validate('tierHasTests', 'critical', ctx)).toBe('there are no critical tests to run; add some first, or choose a smaller group');
    expect(validate('tierHasTests', 'full', ctx)).toMatch(/no full tests/);
    expect(validate('tierHasTests', 'everything', ctx)).toBe('must be one of none, smoke, critical, full');
    expect(validate('tierHasTests', 3, ctx)).not.toBeNull();
  });

  it('hostAdapterExists: the host must be installed', () => {
    const ctx = { hosts: ['railway', 'vercel', 'custom'] };
    expect(validate('hostAdapterExists', 'vercel', ctx)).toBeNull();
    expect(validate('hostAdapterExists', 'heroku', ctx)).toBe('must be one of the installed hosts: railway, vercel, custom');
    expect(validate('hostAdapterExists', '', ctx)).toBe('must name a host');
  });

  it('nonEmpty and positiveInt', () => {
    expect(validate('nonEmpty', 'x')).toBeNull();
    for (const bad of ['', '   ', 0, null, undefined]) expect(validate('nonEmpty', bad), String(bad)).not.toBeNull();
    for (const ok of [1, 3000, '3000', ' 8080 ']) expect(validate('positiveInt', ok), String(ok)).toBeNull();
    for (const bad of [0, -1, 1.5, '0', '-3', '1.5', 'abc', '', null]) expect(validate('positiveInt', bad), String(bad)).not.toBeNull();
  });

  it('validateAll returns the first reason', () => {
    expect(validateAll(['nonEmpty', 'secretName'], 'lower')).toMatch(/secret name/);
    expect(validateAll(['nonEmpty', 'secretName'], '')).toBe('must not be empty');
    expect(validateAll(['nonEmpty', 'secretName'], 'OK_NAME')).toBeNull();
    expect(validateAll([], 'anything')).toBeNull();
  });
});
