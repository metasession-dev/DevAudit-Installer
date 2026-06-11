import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Built-binary smoke coverage (#162 follow-up). Every command is invoked through
 * the real `bin/devaudit.js` so commander's action arg-binding is exercised —
 * the gap that let the `update` crash (`cmd.optsWithGlobals is not a function`)
 * ship in 0.1.56/0.1.57. The `runUpdate`/`runPush`/etc. unit tests call the
 * action functions directly and never catch wiring bugs.
 *
 * Runs the BUILT output (`bin/` -> `dist/`), so `npm run build` must precede it
 * locally; CI (`cli.yml`) builds before `npm test`.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'devaudit.js');

// No command may ever fail with a commander/module wiring crash.
const WIRING_CRASH = /optsWithGlobals|is not a function|TypeError|ReferenceError|Cannot find module/;

let SB: string; // sandbox config home — auth/plugin must never touch real ~/.config
let FIX: string; // a throwaway "consumer" dir (package.json only)
let FILE: string; // a throwaway evidence file

beforeAll(async () => {
  SB = await fs.mkdtemp(join(tmpdir(), 'devaudit-smoke-home-'));
  FIX = await fs.mkdtemp(join(tmpdir(), 'devaudit-smoke-fix-'));
  await fs.writeFile(join(FIX, 'package.json'), JSON.stringify({ name: 'smoke', version: '0.0.0' }));
  FILE = join(FIX, 'evidence.txt');
  await fs.writeFile(FILE, 'evidence');
});

afterAll(async () => {
  await fs.rm(SB, { recursive: true, force: true });
  await fs.rm(FIX, { recursive: true, force: true });
});

/**
 * Invoke the built binary with a hermetic env: config dirs redirected to the
 * sandbox (HOME/USERPROFILE/XDG/APPDATA cover linux/macos/windows), and no
 * portal token/base so token-gated commands fail fast *before* any network.
 */
function run(args: readonly string[]) {
  return execa('node', [BIN, ...args], {
    reject: false,
    env: {
      HOME: SB,
      USERPROFILE: SB,
      XDG_CONFIG_HOME: SB,
      APPDATA: SB,
      LOCALAPPDATA: SB,
      DEVAUDIT_USER_TOKEN: '',
      DEVAUDIT_API_KEY: '',
      DEVAUDIT_BASE_URL: '',
    },
  });
}

describe('CLI smoke — every command boots through commander (#162 follow-up)', () => {
  it('--version exits 0', async () => {
    const res = await run(['--version']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('--help lists the commands', async () => {
    const res = await run(['--help']);
    expect(res.exitCode).toBe(0);
    for (const c of ['install', 'update', 'join', 'push', 'auth', 'plugin']) {
      expect(res.stdout).toContain(c);
    }
  });

  // [label, argv, expectedExit, marker]. The marker proves the action body ran
  // (reached the right place), not just "didn't crash". args are templated:
  // __FIX__ -> consumer dir, __FILE__ -> evidence file.
  const cases: ReadonlyArray<readonly [string, readonly string[], number, RegExp]> = [
    // No token + sandboxed config -> fails at token resolution, before any network.
    ['install', ['install', '--dry-run', '__FIX__'], 1, /No DevAudit token found/i],
    // Not onboarded (distinct exit 7).
    ['join', ['join', '__FIX__'], 7, /hasn't been onboarded|run .*devaudit install/i],
    // Dry-run short-circuits the sync — no network, no writes.
    ['update', ['update', '--dry-run', '__FIX__'], 0, /Dry run complete/i],
    // Dry-run collects + previews, no upload.
    ['push', ['push', 'slug', 'REQ-001', 'test_report', '__FILE__', '--dry-run'], 0, /Would upload/i],
    // Read-only; sandboxed config means "not logged in" (exit 3).
    ['auth status', ['auth', 'status'], 3, /Not logged in/i],
    // Read-only; sandboxed plugin store is empty.
    ['plugin list', ['plugin', 'list'], 0, /no plugins installed/i],
  ];

  for (const [label, argv, expectedExit, marker] of cases) {
    it(`${label} boots without a wiring crash`, async () => {
      const a = argv.map((x) => (x === '__FIX__' ? FIX : x === '__FILE__' ? FILE : x));
      const res = await run(a);
      const out = `${res.stdout}\n${res.stderr}`;
      expect(out).not.toMatch(WIRING_CRASH);
      expect(res.exitCode).toBe(expectedExit);
      expect(out).toMatch(marker);
    });
  }
});
