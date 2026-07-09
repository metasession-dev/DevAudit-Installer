import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execa } from 'execa';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

/**
 * Tests for the v0.2.0 SDLC CLI engine (devaudit-sdlc.js).
 *
 * The engine is a standalone CommonJS Node script that:
 * - Parses --phase=<1-5|issue> and --view flags
 * - Parses --watch-pr=<number> and runs a bounded PR polling/resume loop
 * - Reads blueprint files from sdlc/src/blueprints/*.raw.md
 * - Writes/appends a JSON array of phase records to .sdlc-implementer-invoked
 * - Persists PR watcher retry state to .sdlc-pr-watch.json
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
  return execa(process.execPath, [ENGINE_PATH, ...args], {
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

async function cleanupWatchState(cwd: string): Promise<void> {
  try {
    await fs.unlink(join(cwd, '.sdlc-pr-watch.json'));
  } catch {
    // ignore
  }
}

async function writeMockGh(cwd: string): Promise<string> {
  const binDir = join(cwd, 'mock-bin');
  const ghPath = join(binDir, 'gh');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    ghPath,
    `#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="\${MOCK_GH_LOG:-}"
if [ -n "$LOG_FILE" ]; then
  printf '%s\\n' "$*" >> "$LOG_FILE"
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  if [ -n "\${GH_PR_VIEW_JSON:-}" ]; then
    printf '%s' "$GH_PR_VIEW_JSON"
  else
    printf '%s' '{"state":"OPEN","isDraft":false,"reviewDecision":"APPROVED"}'
  fi
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "checks" ]; then
  if [ -n "\${GH_PR_CHECKS_JSON:-}" ]; then
    printf '%s' "$GH_PR_CHECKS_JSON"
  else
    printf '%s' '[]'
  fi
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  if [ -n "\${GH_REPO_VIEW_JSON:-}" ]; then
    printf '%s' "$GH_REPO_VIEW_JSON"
  else
    printf '%s' '{"nameWithOwner":"metasession-dev/fixture"}'
  fi
  exit 0
fi
if [ "$1" = "run" ] && [ "$2" = "rerun" ]; then
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`,
    { mode: 0o755 },
  );
  return binDir;
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
    await cleanupWatchState(sandbox);
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
      expect(res.stderr).toContain('devaudit-sdlc --phase=<1-5|issue> | --watch-pr=<number>');
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
          ['activatedAt', 'agentType', 'currentPhase', 'initializedBy', 'reqId', 'status'].sort(),
        );
        expect(record.currentPhase).toBe(phase);
        expect(record.initializedBy).toBe('cli');
        expect(record.status).toBe('active');
        expect(record.agentType).toBe('manual');
        expect(record.reqId).toBe(null);
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
        reqId: null,
        agentType: 'manual',
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

  describe('reqId and agent type detection (devaudit-installer#278)', () => {
    it('--req=XXX passes reqId into the sentinel record', async () => {
      await runEngine(['--phase=1', '--req=042'], sandbox);
      const sentinel = await readSentinel(sandbox) as Array<Record<string, unknown>>;
      expect(sentinel[0]!.reqId).toBe('042');
    });

    it('DEVAUDIT_REQ_ID env var is picked up when --req is absent', async () => {
      const res = await execa(process.execPath, [ENGINE_PATH, '--phase=1'], {
        cwd: sandbox,
        reject: false,
        env: { ...process.env, DEVAUDIT_REQ_ID: '099' },
      });
      expect(res.exitCode).toBe(0);
      const sentinel = await readSentinel(sandbox) as Array<Record<string, unknown>>;
      expect(sentinel[0]!.reqId).toBe('099');
    });

    it('DEVAUDIT_SKILL_NAME env var sets initializedBy to "skill"', async () => {
      const res = await execa(process.execPath, [ENGINE_PATH, '--phase=1'], {
        cwd: sandbox,
        reject: false,
        env: { ...process.env, DEVAUDIT_SKILL_NAME: 'sdlc-implementer' },
      });
      expect(res.exitCode).toBe(0);
      const sentinel = await readSentinel(sandbox) as Array<Record<string, unknown>>;
      expect(sentinel[0]!.initializedBy).toBe('skill');
      expect(sentinel[0]!.agentType).toBe('sdlc-implementer');
    });

    it('DEVAUDIT_AGENT env var sets initializedBy to "native-agent"', async () => {
      const res = await execa(process.execPath, [ENGINE_PATH, '--phase=2'], {
        cwd: sandbox,
        reject: false,
        env: { ...process.env, DEVAUDIT_AGENT: 'cursor' },
      });
      expect(res.exitCode).toBe(0);
      const sentinel = await readSentinel(sandbox) as Array<Record<string, unknown>>;
      expect(sentinel[0]!.initializedBy).toBe('native-agent');
      expect(sentinel[0]!.agentType).toBe('cursor');
    });

    it('stdout shows "Initialized by" line with agent type', async () => {
      const res = await runEngine(['--phase=1', '--req=055'], sandbox);
      expect(res.stdout).toContain('Initialized by: cli (REQ-055)');
    });
  });

  describe('PR watch loop (devaudit-installer#304)', () => {
    it('--watch-pr --once marks an approved green PR as ready and writes watch state', async () => {
      const mockBin = await writeMockGh(sandbox);
      const res = await execa(process.execPath, [ENGINE_PATH, '--watch-pr=42', '--repo=metasession-dev/example', '--once'], {
        cwd: sandbox,
        reject: false,
        env: {
          ...process.env,
          PATH: `${mockBin}:${process.env.PATH}`,
          GH_PR_VIEW_JSON: JSON.stringify({ state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED' }),
          GH_PR_CHECKS_JSON: JSON.stringify([
            { name: 'Quality Gates', workflow: 'CI', state: 'SUCCESS', bucket: 'pass', link: 'https://github.com/x/actions/runs/101' },
          ]),
        },
      });

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Ready for merge');

      const watchState = JSON.parse(await fs.readFile(join(sandbox, '.sdlc-pr-watch.json'), 'utf8')) as {
        watches: Record<string, { lastClassification: string; pollCount: number }>;
      };
      expect(watchState.watches['metasession-dev/example#42']).toBeTruthy();
      expect(watchState.watches['metasession-dev/example#42']!.lastClassification).toBe('ready');
      expect(watchState.watches['metasession-dev/example#42']!.pollCount).toBe(1);
    });

    it('--watch-pr auto-reruns a flaky failing workflow and persists rerun counts', async () => {
      const mockBin = await writeMockGh(sandbox);
      const logFile = join(sandbox, 'gh.log');
      const res = await execa(process.execPath, [ENGINE_PATH, '--watch-pr=77', '--repo=metasession-dev/example', '--once'], {
        cwd: sandbox,
        reject: false,
        env: {
          ...process.env,
          PATH: `${mockBin}:${process.env.PATH}`,
          MOCK_GH_LOG: logFile,
          GH_PR_VIEW_JSON: JSON.stringify({ state: 'OPEN', isDraft: false, reviewDecision: 'REVIEW_REQUIRED' }),
          GH_PR_CHECKS_JSON: JSON.stringify([
            { name: 'E2E Regression', workflow: 'CI', state: 'FAILURE', bucket: 'fail', link: 'https://github.com/x/actions/runs/28951684677' },
          ]),
        },
      });

      expect(res.exitCode).toBe(4);
      expect(res.stdout).toContain('Detected likely flaky failure');
      const ghLog = await fs.readFile(logFile, 'utf8');
      expect(ghLog).toContain('run rerun 28951684677 --repo metasession-dev/example');

      const watchState = JSON.parse(await fs.readFile(join(sandbox, '.sdlc-pr-watch.json'), 'utf8')) as {
        watches: Record<string, { reruns: Record<string, number> }>;
      };
      expect(watchState.watches['metasession-dev/example#77']!.reruns['CI / E2E Regression']).toBe(1);
    });

    it('--watch-pr re-runs the release gate when the portal is already approved', async () => {
      const mockBin = await writeMockGh(sandbox);
      const logFile = join(sandbox, 'release-gate.log');
      const server = createServer((req, res) => {
        if (req.url?.includes('/api/ci/releases/resolve')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ latest: { status: 'uat_approved' } }));
          return;
        }
        res.writeHead(404).end();
      });
      await new Promise<void>((resolveServer) => server.listen(0, '127.0.0.1', () => resolveServer()));
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const res = await execa(
          process.execPath,
          [
            ENGINE_PATH,
            '--watch-pr=88',
            '--repo=metasession-dev/example',
            '--once',
            '--release=REQ-090',
            '--project-slug=wawagardenbar-app',
            `--base-url=http://127.0.0.1:${port}`,
          ],
          {
            cwd: sandbox,
            reject: false,
            env: {
              ...process.env,
              PATH: `${mockBin}:${process.env.PATH}`,
              MOCK_GH_LOG: logFile,
              DEVAUDIT_API_KEY: 'test-key',
              GH_PR_VIEW_JSON: JSON.stringify({ state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED' }),
              GH_PR_CHECKS_JSON: JSON.stringify([
                { name: 'DevAudit Release Approval', workflow: 'Release Approval Gate', state: 'FAILURE', bucket: 'fail', link: 'https://github.com/x/actions/runs/28951828749' },
              ]),
            },
          },
        );

        expect(res.exitCode).toBe(4);
        expect(res.stdout).toContain('Release approval is already uat_approved');
        const ghLog = await fs.readFile(logFile, 'utf8');
        expect(ghLog).toContain('run rerun 28951828749 --repo metasession-dev/example');

        const watchState = JSON.parse(await fs.readFile(join(sandbox, '.sdlc-pr-watch.json'), 'utf8')) as {
          watches: Record<string, { releaseGateReruns: number; lastPortalStatus: string }>;
        };
        expect(watchState.watches['metasession-dev/example#88']!.releaseGateReruns).toBe(1);
        expect(watchState.watches['metasession-dev/example#88']!.lastPortalStatus).toBe('uat_approved');
      } finally {
        await new Promise<void>((resolveServer, rejectServer) => server.close((err) => err ? rejectServer(err) : resolveServer()));
      }
    });
  });
});
