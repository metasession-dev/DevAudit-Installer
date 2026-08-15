import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { formatSyncedFiles } from '../src/update/format-sync.js';
import type { SyncContext } from '../src/update/types.js';

// A stand-in for a real `prettier` binary: reads the file paths passed after
// `--write` and replaces every double quote with a single quote — enough to
// prove the subprocess actually ran against the right files and rewrote them
// on disk, without depending on a real prettier install being resolvable in
// the test environment (DevAudit-Installer#663).
const FAKE_PRETTIER = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const files = args.filter((a) => a !== '--write');
if (process.env.FAKE_PRETTIER_LOG) {
  fs.appendFileSync(process.env.FAKE_PRETTIER_LOG, files.join(',') + '\\n');
}
if (process.env.FAKE_PRETTIER_FAIL) {
  process.stderr.write('fake prettier failure\\n');
  process.exit(1);
}
for (const f of files) {
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/"/g, "'"));
}
`;

async function installFakePrettier(projectPath: string): Promise<void> {
  const binDir = join(projectPath, 'node_modules', '.bin');
  await fs.mkdir(binDir, { recursive: true });
  const binPath = join(binDir, 'prettier');
  await fs.writeFile(binPath, FAKE_PRETTIER);
  await fs.chmod(binPath, 0o755);
}

function makeCtx(projectPath: string, stack = 'node'): SyncContext {
  return { installerRoot: '/unused', projectPath, projectName: 'fixture', stack, host: 'railway' };
}

const dirs: string[] = [];
async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('formatSyncedFiles', () => {
  it('re-formats synced files in place using the consumer local prettier binary', async () => {
    const dir = await makeTmpDir('format-sync-basic-');
    await installFakePrettier(dir);
    const ymlPath = join(dir, 'srs-bootstrap.yml');
    await fs.writeFile(ymlPath, 'title: "hello"\n');
    const shPath = join(dir, 'upload-evidence.sh');
    await fs.writeFile(shPath, '#!/bin/sh\necho "hi"\n');

    const result = await formatSyncedFiles(makeCtx(dir), [ymlPath, shPath]);

    expect(result.skipped).toBeFalsy();
    // .sh isn't in the prettier-only extension set, so only the yml counts.
    expect(result.filesSynced).toBe(1);
    expect(await fs.readFile(ymlPath, 'utf8')).toBe("title: 'hello'\n");
    // Untouched: not passed to the fake binary at all.
    expect(await fs.readFile(shPath, 'utf8')).toBe('#!/bin/sh\necho "hi"\n');
  });

  it('skips entirely for non-node stacks', async () => {
    const dir = await makeTmpDir('format-sync-nonnode-');
    await installFakePrettier(dir);
    const ymlPath = join(dir, 'srs-bootstrap.yml');
    await fs.writeFile(ymlPath, 'title: "hello"\n');

    const result = await formatSyncedFiles(makeCtx(dir, 'python'), [ymlPath]);

    expect(result.skipped).toBe(true);
    expect(await fs.readFile(ymlPath, 'utf8')).toBe('title: "hello"\n');
  });

  it('skips when none of the synced files have a formattable extension', async () => {
    const dir = await makeTmpDir('format-sync-noext-');
    await installFakePrettier(dir);

    const result = await formatSyncedFiles(makeCtx(dir), [
      join(dir, 'upload-evidence.sh'),
      join(dir, 'SDLC', 'bin', 'devaudit-sdlc.js'),
    ]);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain('no formattable files synced');
  });

  it('deduplicates repeated paths before invoking prettier', async () => {
    const dir = await makeTmpDir('format-sync-dedupe-');
    await installFakePrettier(dir);
    const logPath = join(dir, 'invocations.log');
    const ymlPath = join(dir, 'srs-bootstrap.yml');
    await fs.writeFile(ymlPath, 'title: "hello"\n');

    const prevLog = process.env['FAKE_PRETTIER_LOG'];
    process.env['FAKE_PRETTIER_LOG'] = logPath;
    try {
      const result = await formatSyncedFiles(makeCtx(dir), [ymlPath, ymlPath]);
      expect(result.filesSynced).toBe(1);
      const log = await fs.readFile(logPath, 'utf8');
      expect(log.trim().split(',')).toEqual([ymlPath]);
    } finally {
      if (prevLog === undefined) delete process.env['FAKE_PRETTIER_LOG'];
      else process.env['FAKE_PRETTIER_LOG'] = prevLog;
    }
  });

  it('reports a warning instead of throwing when prettier fails', async () => {
    const dir = await makeTmpDir('format-sync-fail-');
    await installFakePrettier(dir);
    const ymlPath = join(dir, 'srs-bootstrap.yml');
    await fs.writeFile(ymlPath, 'title: "hello"\n');

    const prevFail = process.env['FAKE_PRETTIER_FAIL'];
    process.env['FAKE_PRETTIER_FAIL'] = '1';
    try {
      const result = await formatSyncedFiles(makeCtx(dir), [ymlPath]);
      expect(result.filesSynced).toBe(0);
      expect(result.warning).toContain('prettier --write failed');
      // Left as originally synced — no worse than before this fix.
      expect(await fs.readFile(ymlPath, 'utf8')).toBe('title: "hello"\n');
    } finally {
      if (prevFail === undefined) delete process.env['FAKE_PRETTIER_FAIL'];
      else process.env['FAKE_PRETTIER_FAIL'] = prevFail;
    }
  });
});
