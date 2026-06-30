import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensurePostinstallScript } from '../src/update/stack-deps.js';

const PLAYWRIGHT_DEP = '@playwright/test';
const REQUIRED_WITH_PW = [PLAYWRIGHT_DEP, 'typescript', 'eslint'];
const REQUIRED_WITHOUT_PW = ['typescript', 'eslint'];

async function writePkg(
  dir: string,
  scripts?: Record<string, string>,
): Promise<string> {
  const pkgPath = join(dir, 'package.json');
  const pkg: Record<string, unknown> = {
    name: 'test-fixture',
    version: '0.0.0',
    devDependencies: Object.fromEntries(
      REQUIRED_WITH_PW.map((d) => [d, '*']),
    ),
  };
  if (scripts) {
    pkg['scripts'] = scripts;
  }
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return pkgPath;
}

async function readPkg(pkgPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
}

describe('ensurePostinstallScript — devaudit-installer#245', () => {
  let dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d: string) => fs.rm(d, { recursive: true, force: true })));
    dirs = [];
  });

  it('adds postinstall script when none exists', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'postinstall-add-'));
    dirs.push(dir);
    const pkgPath = await writePkg(dir);
    const added = await ensurePostinstallScript(pkgPath, REQUIRED_WITH_PW);
    expect(added).toBe(true);
    const pkg = await readPkg(pkgPath);
    expect(pkg['scripts']).toBeDefined();
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['postinstall']).toBe('playwright install chromium');
  });

  it('leaves existing postinstall that mentions playwright', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'postinstall-pw-'));
    dirs.push(dir);
    const pkgPath = await writePkg(dir, {
      postinstall: 'npx playwright install --with-deps',
    });
    const added = await ensurePostinstallScript(pkgPath, REQUIRED_WITH_PW);
    expect(added).toBe(false);
    const pkg = await readPkg(pkgPath);
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['postinstall']).toBe('npx playwright install --with-deps');
  });

  it('does not overwrite existing postinstall without playwright', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'postinstall-other-'));
    dirs.push(dir);
    const pkgPath = await writePkg(dir, {
      postinstall: 'echo build step',
    });
    const added = await ensurePostinstallScript(pkgPath, REQUIRED_WITH_PW);
    expect(added).toBe(false);
    const pkg = await readPkg(pkgPath);
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['postinstall']).toBe('echo build step');
  });

  it('returns false when @playwright/test is not in required deps', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'postinstall-no-pw-'));
    dirs.push(dir);
    const pkgPath = await writePkg(dir);
    const added = await ensurePostinstallScript(pkgPath, REQUIRED_WITHOUT_PW);
    expect(added).toBe(false);
    const pkg = await readPkg(pkgPath);
    const scripts = pkg['scripts'] as Record<string, string> | undefined;
    expect(scripts?.['postinstall']).toBeUndefined();
  });

  it('preserves existing scripts when adding postinstall', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'postinstall-preserve-'));
    dirs.push(dir);
    const pkgPath = await writePkg(dir, {
      build: 'tsc',
      test: 'vitest run',
    });
    const added = await ensurePostinstallScript(pkgPath, REQUIRED_WITH_PW);
    expect(added).toBe(true);
    const pkg = await readPkg(pkgPath);
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['build']).toBe('tsc');
    expect(scripts['test']).toBe('vitest run');
    expect(scripts['postinstall']).toBe('playwright install chromium');
  });
});
