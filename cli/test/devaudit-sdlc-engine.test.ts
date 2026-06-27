import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execa } from 'execa';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Tests for the v0.2.0 SDLC CLI engine (devaudit-sdlc.js).
 *
 * The engine is a standalone CommonJS Node script that:
 * - Parses --phase=<1-5|issue> and --view flags
 * - Reads blueprint files from sdlc/src/blueprints/*.raw.md
 * - Writes/appends a JSON array of phase records to .sdlc-implementer-invoked
 * - Outputs blueprint content to stdout
 *
 * Tests invoke the script via `node <path>` from a sandbox directory
 * so the sentinel file is written to a throwaway location.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_PATH = resolve(HERE, '..', '..', 'sdlc', 'src', 'bin', 'devaudit-sdlc.js');
const BLUEPRINTS_DIR = resolve(HERE, '..', '..', 'sdlc', 'src', 'blueprints');

const PHASE_MAP: Record<string, string> = {
  '1': '1-plan-requirement.raw.md',
  '2': '2-implement-and-test.raw.md',
  '3': '3-compile-evidence.raw.md',
  '4': '4-submit-for-review.raw.md',
  '5': '5-deploy-main.raw.md',
  'issue': 'implementing-an-sdlc-issue.raw.md',
};

let sandbox: string;

async function makeSandbox(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'devaudit-sdlc-test-'));
  return dir;
}

async function runEngine(args: readonly string[], cwd: string) {
  return execa('node', [ENGINE_PATH, ...args], {
    cwd,
    reject: false,
  });
}

async function readSentinel(cwd: string): Promise<unknown> {
  const sentinelPath = join(cwd, '.sdlc-implementer-invoked');
  const content = await fs.readFile(sentinelPath, 'utf8');
  return JSON.parse(content);
}

async function sentinelExists(cwd: string): Promise<boolean> {
  try {
    await fs.access(join(cwd, '.sdlc-implementer-invoked'));
    return true;
  } catch {
    return false;
  }
}

async function cleanupSentinel(cwd: string): Promise<void> {
  try {
    await fs.unlink(join(cwd, '.sdlc-implementer-invoked'));
  } catch {
    // ignore
  }
}

describe('devaudit-sdlc CLI engine', () => {
  beforeAll(async () => {
    sandbox = await makeSandbox();
  });

  afterAll(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await cleanupSentinel(sandbox);
  });

  describe('phase argument parsing', () => {
    for (const phase of Object.keys(PHASE_MAP)) {
      it(`--phase=${phase} resolves and exits 0`, async () => {
        const res = await runEngine([`--phase=${phase}`], sandbox);
        expect(res.exitCode).toBe(0);
        expect(res.stdout).toContain('SDLC Gateway Initialized');
      });

      it(`--phase ${phase} (space syntax) resolves and exits 0`, async () => {
        const res = await runEngine(['--phase', phase], sandbox);
        expect(res.exitCode).toBe(0);
        expect(res.stdout).toContain('SDLC Gateway Initialized');
      });
    }
  });

  describe('--view flag', () => {
    for (const phase of Object.keys(PHASE_MAP)) {
      it(`--phase=${phase} --view outputs blueprint content without writing sentinel`, async () => {
        const res = await runEngine([`--phase=${phase}`, '--view'], sandbox);
        expect(res.exitCode).toBe(0);
        // Blueprint content should be in stdout
        const blueprintPath = join(BLUEPRINTS_DIR, PHASE_MAP[phase]!);
        const blueprintContent = await fs.readFile(blueprintPath, 'utf8');
        expect(res.stdout).toContain(blueprintContent.trim().slice(0, 100));
        // Sentinel must NOT exist
        expect(await sentinelExists(sandbox)).toBe(false);
      });
    }

    it('--view on a phase whose blueprint does not exist exits 1', async () => {
      // Temporarily rename a blueprint to simulate missing file
      const bpPath = join(BLUEPRINTS_DIR, '1-plan-requirement.raw.md');
      const tmpPath = bpPath + '.bak';
      await fs.rename(bpPath, tmpPath);
      try {
        const res = await runEngine(['--phase=1', '--view'], sandbox);
        expect(res.exitCode).toBe(1);
        expect(res.stderr).toContain('blueprint could not be resolved');
      } finally {
        await fs.rename(tmpPath, bpPath);
      }
    });
  });

  describe('missing phase argument', () => {
    it('exits 1 with the exact error message', async () => {
      const res = await runEngine([], sandbox);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('Missing required configuration property');
      expect(res.stderr).toContain('devaudit-sdlc --phase=<1-5|issue>');
    });
  });

  describe('invalid phase argument', () => {
    it('exits 1 with error message containing the invalid value', async () => {
      const res = await runEngine(['--phase=99'], sandbox);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('Invalid phase argument');
      expect(res.stderr).toContain('99');
      expect(res.stderr).toContain('Supported options: 1, 2, 3, 4, 5, issue');
    });
  });

  describe('sentinel JSON payload — single invocation', () => {
    for (const phase of Object.keys(PHASE_MAP)) {
      it(`--phase=${phase} writes a JSON array with one record having 4 correct keys`, async () => {
        await runEngine([`--phase=${phase}`], sandbox);
        const sentinel = await readSentinel(sandbox) as Array<Record<string, string>>;

        expect(Array.isArray(sentinel)).toBe(true);
        expect(sentinel).toHaveLength(1);

        const record = sentinel[0]!;
        expect(Object.keys(record).sort()).toEqual(
          ['activatedAt', 'currentPhase', 'initializedBy', 'status'].sort(),
        );
        expect(record.currentPhase).toBe(phase);
        expect(record.initializedBy).toBe('devaudit-cli-engine');
        expect(record.status).toBe('active');
        // activatedAt should be a valid ISO 8601 string
        expect(() => new Date(record.activatedAt!).toISOString()).not.toThrow();
      });
    }
  });

  describe('sentinel JSON payload — append behaviour', () => {
    it('two consecutive invocations with different phases produce a 2-element array in order', async () => {
      await runEngine(['--phase=1'], sandbox);
      await runEngine(['--phase=2'], sandbox);

      const sentinel = await readSentinel(sandbox) as Array<Record<string, string>>;
      expect(Array.isArray(sentinel)).toBe(true);
      expect(sentinel).toHaveLength(2);
      expect(sentinel[0]!.currentPhase).toBe('1');
      expect(sentinel[1]!.currentPhase).toBe('2');
    });

    it('three consecutive invocations produce a 3-element array in order', async () => {
      await runEngine(['--phase=1'], sandbox);
      await runEngine(['--phase=2'], sandbox);
      await runEngine(['--phase=3'], sandbox);

      const sentinel = await readSentinel(sandbox) as Array<Record<string, string>>;
      expect(sentinel).toHaveLength(3);
      expect(sentinel[0]!.currentPhase).toBe('1');
      expect(sentinel[1]!.currentPhase).toBe('2');
      expect(sentinel[2]!.currentPhase).toBe('3');
    });
  });

  describe('sentinel does not duplicate phases', () => {
    it('running the same phase twice appends two records (no deduplication)', async () => {
      await runEngine(['--phase=1'], sandbox);
      await runEngine(['--phase=1'], sandbox);

      const sentinel = await readSentinel(sandbox) as Array<Record<string, string>>;
      expect(sentinel).toHaveLength(2);
      expect(sentinel[0]!.currentPhase).toBe('1');
      expect(sentinel[1]!.currentPhase).toBe('1');
    });
  });

  describe('blueprint output', () => {
    it('running without --view prints blueprint content to stdout', async () => {
      const res = await runEngine(['--phase=1'], sandbox);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('PHASE EXECUTION MANIFEST');

      const blueprintPath = join(BLUEPRINTS_DIR, '1-plan-requirement.raw.md');
      const blueprintContent = await fs.readFile(blueprintPath, 'utf8');
      expect(res.stdout).toContain(blueprintContent.trim().slice(0, 100));
    });
  });

  describe('corrupt sentinel recovery', () => {
    it('corrupt JSON in sentinel is overwritten with a fresh array containing the new record', async () => {
      const sentinelPath = join(sandbox, '.sdlc-implementer-invoked');
      await fs.writeFile(sentinelPath, 'CORRUPT DATA', 'utf8');

      const res = await runEngine(['--phase=1'], sandbox);
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toContain('corrupt');

      const sentinel = await readSentinel(sandbox) as Array<Record<string, string>>;
      expect(Array.isArray(sentinel)).toBe(true);
      expect(sentinel).toHaveLength(1);
      expect(sentinel[0]!.currentPhase).toBe('1');
    });

    it('legacy plain-text sentinel is overwritten with fresh array', async () => {
      const sentinelPath = join(sandbox, '.sdlc-implementer-invoked');
      await fs.writeFile(sentinelPath, 'INVOKED 2026-01-01T00:00:00Z', 'utf8');

      const res = await runEngine(['--phase=2'], sandbox);
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toContain('corrupt');

      const sentinel = await readSentinel(sandbox) as Array<Record<string, string>>;
      expect(sentinel).toHaveLength(1);
      expect(sentinel[0]!.currentPhase).toBe('2');
    });

    it('legacy single-object JSON sentinel is migrated into an array', async () => {
      const sentinelPath = join(sandbox, '.sdlc-implementer-invoked');
      const legacyObject = JSON.stringify({
        activatedAt: '2026-01-01T00:00:00.000Z',
        currentPhase: '1',
        initializedBy: 'devaudit-cli-engine',
        status: 'active',
      });
      await fs.writeFile(sentinelPath, legacyObject, 'utf8');

      const res = await runEngine(['--phase=2'], sandbox);
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toContain('legacy single-object');

      const sentinel = await readSentinel(sandbox) as Array<Record<string, string>>;
      expect(Array.isArray(sentinel)).toBe(true);
      expect(sentinel).toHaveLength(2);
      expect(sentinel[0]!.currentPhase).toBe('1');
      expect(sentinel[1]!.currentPhase).toBe('2');
    });
  });

  describe('phase history output', () => {
    it('stdout shows phase history after multiple invocations', async () => {
      await runEngine(['--phase=1'], sandbox);
      await runEngine(['--phase=2'], sandbox);
      const res = await runEngine(['--phase=3'], sandbox);

      expect(res.stdout).toContain('Phase history:');
      expect(res.stdout).toContain('1 → 2 → 3');
    });
  });
});
