import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensurePostinstallScript } from '../src/update/stack-deps.js';

const PLAYWRIGHT_DEP = '@playwright/test';
const REQUIRED_NODE_DEPS = [
  'husky',
  '@commitlint/cli',
  '@commitlint/config-conventional',
  'lint-staged',
  'prettier',
  'eslint',
  'typescript',
  PLAYWRIGHT_DEP,
];

async function writePkg(dir: string, pkg: Record<string, unknown>): Promise<string> {
  const pkgPath = join(dir, 'package.json');
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  return pkgPath;
}

async function readPkg(pkgPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
}

describe('ensurePostinstallScript — DevAudit-Installer#245', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'postinstall-test-'));
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('adds postinstall when @playwright/test is in required deps and no postinstall exists', async () => {
    const pkgPath = await writePkg(dir, {
      name: 'test-app',
      version: '0.0.0',
      devDependencies: { [PLAYWRIGHT_DEP]: '*' },
    });

    const added = await ensurePostinstallScript(pkgPath, REQUIRED_NODE_DEPS);
    expect(added).toBe(true);

    const updated = await readPkg(pkgPath) as { scripts?: Record<string, string> };
    expect(updated.scripts?.['postinstall']).toBe('playwright install chromium');
  });

  it('does not add postinstall when @playwright/test is not in required deps', async () => {
    const subDir = join(dir, 'no-playwright');
    await fs.mkdir(subDir, { recursive: true });
    const pkgPath = await writePkg(subDir, {
      name: 'test-app-no-pw',
      version: '0.0.0',
      devDependencies: { eslint: '*' },
    });

    const added = await ensurePostinstallScript(pkgPath, ['husky', 'eslint', 'typescript']);
    expect(added).toBe(false);

    const updated = await readPkg(pkgPath) as { scripts?: Record<string, string> };
    expect(updated.scripts?.['postinstall']).toBeUndefined();
  });

  it('is idempotent — does not re-add when postinstall already matches', async () => {
    const pkgPath = await writePkg(dir, {
      name: 'test-app-idempotent',
      version: '0.0.0',
      devDependencies: { [PLAYWRIGHT_DEP]: '*' },
      scripts: { postinstall: 'playwright install chromium' },
    });

    const added = await ensurePostinstallScript(pkgPath, REQUIRED_NODE_DEPS);
    expect(added).toBe(false);

    const updated = await readPkg(pkgPath) as { scripts?: Record<string, string> };
    expect(updated.scripts?.['postinstall']).toBe('playwright install chromium');
  });

  it('does not overwrite an existing postinstall that does not mention playwright', async () => {
    const pkgPath = await writePkg(dir, {
      name: 'test-app-custom-postinstall',
      version: '0.0.0',
      devDependencies: { [PLAYWRIGHT_DEP]: '*' },
      scripts: { postinstall: 'husky install' },
    });

    const added = await ensurePostinstallScript(pkgPath, REQUIRED_NODE_DEPS);
    expect(added).toBe(false);

    const updated = await readPkg(pkgPath) as { scripts?: Record<string, string> };
    expect(updated.scripts?.['postinstall']).toBe('husky install');
  });

  it('overwrites an existing postinstall that mentions playwright but differs', async () => {
    const pkgPath = await writePkg(dir, {
      name: 'test-app-pw-variant',
      version: '0.0.0',
      devDependencies: { [PLAYWRIGHT_DEP]: '*' },
      scripts: { postinstall: 'playwright install chromium --with-deps' },
    });

    const added = await ensurePostinstallScript(pkgPath, REQUIRED_NODE_DEPS);
    expect(added).toBe(true);

    const updated = await readPkg(pkgPath) as { scripts?: Record<string, string> };
    expect(updated.scripts?.['postinstall']).toBe('playwright install chromium');
  });
});
