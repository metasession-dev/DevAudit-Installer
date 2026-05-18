import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'devaudit.js');

describe('devaudit --help', () => {
  it('prints usage + version', async () => {
    const result = await execa('node', [BIN, '--help'], { reject: false });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('devaudit');
    expect(result.stdout).toContain('install');
    expect(result.stdout).toContain('doctor');
  }, 30_000);
});

describe('devaudit --version', () => {
  it('prints a semver-shaped version', async () => {
    const result = await execa('node', [BIN, '--version'], { reject: false });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+$/);
  }, 30_000);
});

describe('devaudit doctor', () => {
  it('runs without crashing (exit code 0 or 6 depending on environment)', async () => {
    const result = await execa('node', [BIN, 'doctor'], { reject: false });
    // Pass if all tools are present (0); also acceptable in CI if something's
    // missing — we exit 6 with a clear diagnostic.
    expect([0, 6]).toContain(result.exitCode);
    expect(result.stdout + result.stderr).toContain('node');
  }, 30_000);
});

describe('stubbed commands', () => {
  it('exits non-zero with a "not implemented yet" message', async () => {
    const result = await execa('node', [BIN, 'install'], { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('not implemented yet');
  }, 30_000);
});
