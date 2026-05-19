import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/manifest.js';

function baseValidSource(extras: Record<string, unknown> = {}): unknown {
  return {
    name: 'devaudit-plugin-fixture',
    version: '0.0.1',
    main: './dist/plugin.js',
    devaudit: {
      apiVersion: '1',
      ...extras,
    },
  };
}

describe('validateManifest', () => {
  it('accepts a minimal valid manifest', () => {
    const result = validateManifest(baseValidSource());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.packageName).toBe('devaudit-plugin-fixture');
      expect(result.packageVersion).toBe('0.0.1');
      expect(result.main).toBe('./dist/plugin.js');
      expect(result.manifest.apiVersion).toBe('1');
    }
  });

  it('rejects non-object input', () => {
    const result = validateManifest('a string');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]).toMatch(/must be an object/);
  });

  it('rejects missing package.json fields', () => {
    const result = validateManifest({ devaudit: { apiVersion: '1' } });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.find((e) => e.includes("'name'"))).toBeDefined();
      expect(result.errors.find((e) => e.includes("'version'"))).toBeDefined();
      expect(result.errors.find((e) => e.includes("'main'"))).toBeDefined();
    }
  });

  it('rejects missing devaudit field', () => {
    const result = validateManifest({ name: 'x', version: '0.0.1', main: './p.js' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]).toMatch(/must include a top-level `devaudit` object/);
  });

  it('rejects unsupported apiVersion', () => {
    const result = validateManifest({
      name: 'x',
      version: '0.0.1',
      main: './p.js',
      devaudit: { apiVersion: '99' },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]).toMatch(/apiVersion '99' is not supported/);
  });

  it('accepts commands and hooks; preserves them in manifest', () => {
    const result = validateManifest(
      baseValidSource({
        displayName: 'Fixture plugin',
        commands: [{ name: 'do-thing', description: 'Does a thing' }],
        hooks: ['afterUpdate', 'beforeInstall'],
      }),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.manifest.displayName).toBe('Fixture plugin');
      expect(result.manifest.commands).toEqual([{ name: 'do-thing', description: 'Does a thing' }]);
      expect(result.manifest.hooks).toEqual(['afterUpdate', 'beforeInstall']);
    }
  });

  it('rejects invalid command names', () => {
    const result = validateManifest(
      baseValidSource({ commands: [{ name: 'BadCamel', description: 'x' }] }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]).toMatch(/must match \/\^\[a-z\]/);
  });

  it('rejects unknown hook names', () => {
    const result = validateManifest(baseValidSource({ hooks: ['onZombieApocalypse'] }));
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors[0]).toMatch(/'onZombieApocalypse' is not a recognised lifecycle hook/);
  });
});
