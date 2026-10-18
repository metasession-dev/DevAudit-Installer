import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ManagedSyncState, writeManaged, removeManaged, type KnownFiles } from '../src/update/write-managed.js';
import { sha256 } from '../src/update/sync-manifest.js';

// devaudit-installer#988 — a path left in conflict must never be overwritten
// on a later sync just because its recorded hash matches the file on disk.
// Before the fix, an unknown-but-present file (first sync, conservative
// bootstrap) was recorded with the LOCAL hash, so the second `update` saw it
// as "unmodified" and replaced the consumer's edit with upstream.

const LOCAL = 'consumer customisation\n';
const UPSTREAM_V1 = 'upstream v1\n';
const UPSTREAM_V2 = 'upstream v2\n';

async function repo(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-wm-conflict-'));
  await fs.mkdir(join(dir, '.claude', 'skills', 'x'), { recursive: true });
  return dir;
}

async function sync(root: string, known: KnownFiles, content: string) {
  const state = new ManagedSyncState(root, known, false);
  const outcome = await writeManaged(state, join(root, '.claude/skills/x/SKILL.md'), content, { section: '2e-ii' });
  const manifest = await state.finalize('0.0.0', undefined);
  const next: KnownFiles = new Map(
    Object.entries(manifest.files).map(([k, v]) => [k, { sha256: v.sha256, section: v.section, conflict: v.conflict === true }]),
  );
  return { outcome, manifest, next };
}

describe('writeManaged conflict baseline (#988)', () => {
  it('keeps a pre-existing local edit across two syncs (no known baseline at first sync)', async () => {
    const root = await repo();
    const file = join(root, '.claude/skills/x/SKILL.md');
    await fs.writeFile(file, LOCAL);

    const first = await sync(root, new Map(), UPSTREAM_V1);
    expect(first.outcome).toBe('conflict');
    expect(await fs.readFile(file, 'utf8')).toBe(LOCAL);
    const entry = first.manifest.files['.claude/skills/x/SKILL.md']!;
    expect(entry.conflict).toBe(true);
    expect(entry.sha256).not.toBe(sha256(LOCAL)); // never the local hash

    const second = await sync(root, first.next, UPSTREAM_V2);
    expect(second.outcome).toBe('conflict');
    expect(await fs.readFile(file, 'utf8')).toBe(LOCAL);
    expect(await fs.readFile(`${file}.devaudit-new`, 'utf8')).toBe(UPSTREAM_V2);
  });

  it('protects manifests already committed with the local hash (legacy conflict entries)', async () => {
    const root = await repo();
    const file = join(root, '.claude/skills/x/SKILL.md');
    await fs.writeFile(file, LOCAL);
    const legacy: KnownFiles = new Map([
      ['.claude/skills/x/SKILL.md', { sha256: sha256(LOCAL), section: '2e-ii', conflict: true }],
    ]);
    const r = await sync(root, legacy, UPSTREAM_V2);
    expect(r.outcome).toBe('conflict');
    expect(await fs.readFile(file, 'utf8')).toBe(LOCAL);
  });

  it('resolves once the operator takes upstream, then syncs normally', async () => {
    const root = await repo();
    const file = join(root, '.claude/skills/x/SKILL.md');
    await fs.writeFile(file, LOCAL);
    const first = await sync(root, new Map(), UPSTREAM_V1);
    await fs.rename(`${file}.devaudit-new`, file); // operator takes upstream
    const second = await sync(root, first.next, UPSTREAM_V1);
    expect(second.outcome).toBe('identical');
    expect(second.manifest.files['.claude/skills/x/SKILL.md']!.conflict).toBeUndefined();
    const third = await sync(root, second.next, UPSTREAM_V2);
    expect(third.outcome).toBe('written');
    expect(await fs.readFile(file, 'utf8')).toBe(UPSTREAM_V2);
  });

  it('never removes a stale file that is still in conflict', async () => {
    const root = await repo();
    const file = join(root, '.claude/skills/x/SKILL.md');
    await fs.writeFile(file, LOCAL);
    const state = new ManagedSyncState(
      root,
      new Map([['.claude/skills/x/SKILL.md', { sha256: sha256(LOCAL), section: '2e-ii', conflict: true }]]),
      false,
    );
    expect(await removeManaged(state, file, { section: '2e-ii' })).toBe('kept-conflict');
    expect(await fs.readFile(file, 'utf8')).toBe(LOCAL);
  });
});

describe('identical content still gets the requested mode (#1024 validation finding)', () => {
  it('chmods a 0644 file whose content already matches a script synced with mode 0755', async () => {
    if (process.platform === 'win32') return;
    const { promises: fsp } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { ManagedSyncState, writeManaged } = await import('../src/update/write-managed.js');
    const dir = await fsp.mkdtemp(join(tmpdir(), 'cli-mode-'));
    try {
      const file = join(dir, 'scripts', 'x.sh');
      await fsp.mkdir(join(dir, 'scripts'), { recursive: true });
      await fsp.writeFile(file, '#!/usr/bin/env bash\necho hi\n');
      await fsp.chmod(file, 0o644);
      const state = new ManagedSyncState(dir, new Map(), false);
      expect(await writeManaged(state, file, '#!/usr/bin/env bash\necho hi\n', { section: '2d', mode: 0o755 })).toBe('identical');
      expect((await fsp.stat(file)).mode & 0o777).toBe(0o755);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
