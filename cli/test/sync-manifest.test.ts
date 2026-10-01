import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { syncProject } from '../src/update/index.js';
import { readManifest, writeManifest, sha256, type SyncManifest } from '../src/update/sync-manifest.js';
import { buildBaseline, baselineRunnerEnv, type BaselineRunner } from '../src/update/manifest-bootstrap.js';
import type { SyncContext } from '../src/update/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');

async function buildFixture(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-sync-manifest-fixture-'));
  await fs.writeFile(
    join(dir, 'sdlc-config.json'),
    JSON.stringify({
      project_slug: 'fixture-app',
      stack: 'node',
      host: 'railway',
      node_version: '20',
      runner: 'ubuntu-latest',
      working_directory: '.',
      source_dirs: 'app/ lib/',
      sast_baseline: 0,
      accepted_dep_risks: '',
      production_url_secret: 'FIXTURE_PROD_URL',
      database_service: '',
      database_image: '',
      database_port: '',
      database_env: {},
      app_env: {},
      build_env: {},
      e2e_project: 'chromium',
      e2e_start_command: 'npm run dev',
      paths_ignore: ['SDLC/**', 'compliance/**'],
      // unknown/custom keys that must survive every sync untouched
      custom_operator_note: 'do not remove',
      custom_nested: { keepMe: true, list: [1, 2, 3] },
    }),
  );
  await fs.writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'fixture-app',
      private: true,
      version: '0.0.0',
      devDependencies: {
        husky: '*',
        '@commitlint/cli': '*',
        '@commitlint/config-conventional': '*',
        'lint-staged': '*',
        prettier: '*',
        eslint: '*',
        typescript: '*',
        '@playwright/test': '*',
      },
    }),
  );
  await fs.mkdir(join(dir, '.husky'), { recursive: true });
  await fs.mkdir(join(dir, 'scripts'), { recursive: true });
  await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  return dir;
}

describe('sync manifest + writeManaged (devaudit-installer#930)', () => {
  it('records an unmodified file silently and updates it on a config change, no conflict', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    try {
      await syncProject(dir);
      const manifest1 = await readManifest(dir);
      expect(manifest1?.files['SDLC/Test_Policy.md']).toBeTruthy();
      expect(manifest1?.files['SDLC/Test_Policy.md']?.conflict).toBeFalsy();

      // Second sync, nothing touched by hand — must update silently (no
      // conflicts) even though the file's on-disk content is regenerated.
      const report2 = await syncProject(dir);
      const conflictWarning = report2.warnings.find((w) => w.includes('local modifications'));
      expect(conflictWarning).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('preserves a hand-edited CI workflow byte-for-byte, writes upstream to .devaudit-new, and reports a conflict', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    try {
      await syncProject(dir);
      const ciPath = join(dir, '.github', 'workflows', 'ci.yml');
      const original = await fs.readFile(ciPath, 'utf-8');
      const handEdited = original + '\n# hand-edited by the consumer\n';
      await fs.writeFile(ciPath, handEdited);

      const report = await syncProject(dir);

      // Local content untouched, byte-for-byte.
      expect(await fs.readFile(ciPath, 'utf-8')).toBe(handEdited);
      // Upstream content landed in the sibling .devaudit-new instead.
      const newContent = await fs.readFile(`${ciPath}.devaudit-new`, 'utf-8');
      expect(newContent).not.toBe(handEdited);
      expect(newContent).toContain('fixture-app');
      // Manifest records the conflict.
      const manifest = await readManifest(dir);
      expect(manifest?.files['.github/workflows/ci.yml']?.conflict).toBe(true);
      expect(manifest?.files['.github/workflows/ci.yml']?.pending_upstream_sha256).toBe(sha256(newContent));
      // Sync-level warning surfaced.
      expect(report.warnings.some((w) => w.includes('.github/workflows/ci.yml'))).toBe(true);
      // Exit is still success (dry-run/exit-code contract: conflicts don't fail the sync).
      expect(report.totalFilesSynced).toBeGreaterThan(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('preserves a hand-edited scripts/*.sh file and a hand-edited .husky/pre-commit hook', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    try {
      await syncProject(dir);
      const scriptPath = join(dir, 'scripts', 'upload-evidence.sh');
      const hookPath = join(dir, '.husky', 'pre-commit');
      const scriptEdited = (await fs.readFile(scriptPath, 'utf-8')) + '\necho "local customization"\n';
      const hookEdited = (await fs.readFile(hookPath, 'utf-8')) + '\necho "local hook customization"\n';
      await fs.writeFile(scriptPath, scriptEdited);
      await fs.writeFile(hookPath, hookEdited);

      await syncProject(dir);

      expect(await fs.readFile(scriptPath, 'utf-8')).toBe(scriptEdited);
      expect(await fs.readFile(hookPath, 'utf-8')).toBe(hookEdited);
      expect(await fs.stat(`${scriptPath}.devaudit-new`)).toBeTruthy();
      expect(await fs.stat(`${hookPath}.devaudit-new`)).toBeTruthy();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('resolves a conflict once the operator takes .devaudit-new, clearing the flag on the next sync', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    try {
      await syncProject(dir);
      const ciPath = join(dir, '.github', 'workflows', 'ci.yml');
      await fs.writeFile(ciPath, (await fs.readFile(ciPath, 'utf-8')) + '\n# edit\n');
      await syncProject(dir);
      let manifest = await readManifest(dir);
      expect(manifest?.files['.github/workflows/ci.yml']?.conflict).toBe(true);

      // Operator resolves: take upstream.
      await fs.copyFile(`${ciPath}.devaudit-new`, ciPath);
      await fs.rm(`${ciPath}.devaudit-new`);

      const report = await syncProject(dir);
      manifest = await readManifest(dir);
      expect(manifest?.files['.github/workflows/ci.yml']?.conflict).toBeFalsy();
      expect(report.warnings.some((w) => w.includes('.github/workflows/ci.yml'))).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('a consumer-added file inside .claude/skills/<name>/ survives every sync', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    try {
      await syncProject(dir);
      const skillDirs = await fs.readdir(join(dir, '.claude', 'skills'));
      expect(skillDirs.length).toBeGreaterThan(0);
      const anySkill = skillDirs[0]!;
      const consumerFile = join(dir, '.claude', 'skills', anySkill, 'CONSUMER-NOTES.md');
      await fs.writeFile(consumerFile, 'consumer-owned, not from upstream\n');

      await syncProject(dir);
      await syncProject(dir);

      expect(await fs.readFile(consumerFile, 'utf-8')).toBe('consumer-owned, not from upstream\n');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('an unmodified stale workflow is removed; a locally-modified stale one is kept and reported', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    try {
      await syncProject(dir);
      const workflowsDir = join(dir, '.github', 'workflows');
      // Simulate two stale files as if a prior devaudit version wrote them,
      // one left untouched, one hand-edited since.
      await fs.writeFile(join(workflowsDir, 'test-on-pr.yml'), 'name: stale unmodified\n');
      await fs.writeFile(join(workflowsDir, 'check-uat-approval.yml'), 'name: stale modified\n');
      const manifest = (await readManifest(dir))!;
      await writeManifest(dir, {
        ...manifest,
        files: {
          ...manifest.files,
          '.github/workflows/test-on-pr.yml': { sha256: sha256('name: stale unmodified\n'), section: '2f' },
          '.github/workflows/check-uat-approval.yml': { sha256: sha256('name: DIFFERENT original content\n'), section: '2f' },
        },
      });

      await syncProject(dir);

      const files = await fs.readdir(workflowsDir);
      expect(files).not.toContain('test-on-pr.yml');
      expect(files).toContain('check-uat-approval.yml');
      const finalManifest = await readManifest(dir);
      expect(finalManifest?.files['.github/workflows/check-uat-approval.yml']?.conflict).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('a pre-existing, untracked file at a devaudit-managed path is kept as a conflict on first sync (onboarding)', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    try {
      // No manifest, no devaudit_synced_version — a genuinely fresh
      // onboarding. A pre-existing .prettierrc.json is the consumer's own.
      const preExisting = '{ "singleQuote": false }\n';
      await fs.writeFile(join(dir, '.prettierrc.json'), preExisting);

      await syncProject(dir);

      expect(await fs.readFile(join(dir, '.prettierrc.json'), 'utf-8')).toBe(preExisting);
      expect(await fs.stat(join(dir, '.prettierrc.json.devaudit-new'))).toBeTruthy();
      const manifest = await readManifest(dir);
      expect(manifest?.files['.prettierrc.json']?.conflict).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('a patch-carrying CI file updates cleanly with no conflict (manifest recorded post-patch)', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    try {
      await syncProject(dir);
      const ciPath = join(dir, '.github', 'workflows', 'ci.yml');
      const upstream = await fs.readFile(ciPath, 'utf-8');
      const patched = upstream.replace('name: Quality Gates', 'name: Quality Gates (patched)');
      expect(patched).not.toBe(upstream);

      await execa('git', ['init', '-q'], { cwd: dir });
      await execa('git', ['add', '-A'], { cwd: dir });
      await execa('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });
      await fs.writeFile(ciPath, patched);
      const diff = await execa('git', ['diff', '--', '.github/workflows/ci.yml'], { cwd: dir });
      await fs.mkdir(join(dir, '.devaudit-patches'), { recursive: true });
      await fs.writeFile(join(dir, '.devaudit-patches', 'ci.yml.patch'), diff.stdout + '\n');
      await fs.writeFile(
        join(dir, '.devaudit-patches', 'ci.yml.patch.json'),
        JSON.stringify({ upstream_issue: 'https://github.com/x/y/issues/1' }),
      );
      // Revert the working tree file back to upstream so the next sync's
      // write is "unmodified" and the patch re-applies cleanly on top.
      await fs.writeFile(ciPath, upstream);

      const report = await syncProject(dir);

      expect(await fs.readFile(ciPath, 'utf-8')).toContain('Quality Gates (patched)');
      const manifest = await readManifest(dir);
      expect(manifest?.files['.github/workflows/ci.yml']?.conflict).toBeFalsy();
      expect(manifest?.files['.github/workflows/ci.yml']?.sha256).toBe(sha256(await fs.readFile(ciPath)));
      expect(report.warnings.some((w) => w.includes('local modifications'))).toBe(false);

      // Re-running again must still be clean — the patched content is now
      // "unmodified" relative to the manifest recorded post-patch.
      const report2 = await syncProject(dir);
      expect(report2.warnings.some((w) => w.includes('local modifications'))).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('preserves unknown/custom top-level and nested sdlc-config.json keys across update', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    try {
      await syncProject(dir);
      const cfg = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      expect(cfg.custom_operator_note).toBe('do not remove');
      expect(cfg.custom_nested).toEqual({ keepMe: true, list: [1, 2, 3] });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('--dry-run reports conflicts without writing anything (classification only)', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    try {
      await syncProject(dir);
      const ciPath = join(dir, '.github', 'workflows', 'ci.yml');
      const handEdited = (await fs.readFile(ciPath, 'utf-8')) + '\n# edit\n';
      await fs.writeFile(ciPath, handEdited);
      const before = await fs.readFile(ciPath, 'utf-8');

      const report = await syncProject(dir, { dryRun: true });

      expect(await fs.readFile(ciPath, 'utf-8')).toBe(before);
      await expect(fs.stat(`${ciPath}.devaudit-new`)).rejects.toThrow();
      expect(report.warnings.some((w) => w.includes('.github/workflows/ci.yml'))).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('manifest bootstrap (devaudit-installer#930)', () => {
  it('falls back to a conservative empty baseline with no devaudit_synced_version recorded, and never deletes', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    const ctx: SyncContext = {
      installerRoot: INSTALLER_ROOT,
      projectPath: dir,
      repoRoot: dir,
      projectName: 'fixture-app',
      stack: 'node',
      host: 'railway',
    };
    try {
      const result = await buildBaseline(ctx);
      expect(result.fellBack).toBe(true);
      expect(result.known.size).toBe(0);
      expect(result.warning).toContain('conservative mode');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('reconstructs a baseline via an injectable runner when devaudit_synced_version + git are present', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    try {
      const cfg = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      cfg.devaudit_synced_version = '1.0.0';
      await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(cfg));
      await execa('git', ['init', '-q'], { cwd: dir });
      await execa('git', ['add', '-A'], { cwd: dir });
      await execa('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });

      const stubRunner: BaselineRunner = async ({ worktreeDir }) => {
        await fs.mkdir(join(worktreeDir, 'SDLC'), { recursive: true });
        await fs.writeFile(join(worktreeDir, 'SDLC', 'Test_Policy.md'), 'stub baseline content\n');
      };

      const ctx: SyncContext = {
        installerRoot: INSTALLER_ROOT,
        projectPath: dir,
        repoRoot: dir,
        projectName: 'fixture-app',
        stack: 'node',
        host: 'railway',
      };
      const result = await buildBaseline(ctx, stubRunner);
      expect(result.fellBack).toBe(false);
      expect(result.known.get('SDLC/Test_Policy.md')?.sha256).toBeTruthy();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  // devaudit-installer#932's pre-release validation gate (cloned real
  // consumers, not fixtures) caught this: DEVAUDIT_INSTALLER_ROOT set for
  // the *current* CLI invocation was leaking into the `npx @metasession.co/
  // devaudit-cli@<old-version>` child process, which resolved the CURRENT
  // (unreleased) templates instead of its own bundled ones — silently
  // reconstructing a baseline that matched today's output rather than what
  // was actually synced historically, defeating reconstruction entirely. A
  // fixture-only test suite never caught this because fixtures don't
  // exercise a real npx subprocess against a real historical version.
  it('never leaks DEVAUDIT_INSTALLER_ROOT into the env defaultBaselineRunner passes its child (#930 validation-gate finding)', () => {
    // Spawning a real subprocess (fake npx on PATH) to prove this is
    // platform-fragile — a Unix shebang script isn't executable on Windows,
    // where PATH resolution and script execution work differently, and
    // that fragility caused this exact test to hang/time out in Windows CI
    // rather than fail on the real assertion. `baselineRunnerEnv` is pulled
    // out specifically so the omission can be verified directly and
    // deterministically, on every OS, with no subprocess involved.
    const sourceEnv = { DEVAUDIT_INSTALLER_ROOT: INSTALLER_ROOT, PATH: process.env['PATH'] ?? '' };
    const cleanEnv = baselineRunnerEnv(sourceEnv);
    expect(cleanEnv['DEVAUDIT_INSTALLER_ROOT']).toBeUndefined();
    expect(cleanEnv['PATH']).toBe(sourceEnv['PATH']); // everything else survives untouched
    expect(sourceEnv['DEVAUDIT_INSTALLER_ROOT']).toBe(INSTALLER_ROOT); // the input itself isn't mutated
  });

  // devaudit-installer#932's validation gate caught this too: a git worktree
  // never has node_modules (git doesn't track it), so the consumer's own
  // prettier at node_modules/.bin/prettier silently failed to resolve
  // inside the baseline reconstruction, leaving anything prettier
  // normalizes (markdown tables, YAML quote style) unformatted in the
  // baseline while the real sync (which does have node_modules) formats
  // correctly — a spurious mismatch for a file nobody touched.
  it('symlinks the real repo node_modules into the baseline worktree so the consumer formatter actually normalizes baseline content', async () => {
    const dir = await buildFixture();
    try {
      // A fake "prettier" instead of a real npm install: deterministic,
      // fast on every OS, and avoids a real install's network/CI-runner
      // variance entirely — all this test needs is *some* observable
      // transformation that only happens if the binary under
      // node_modules/.bin/ actually resolves and runs inside the worktree.
      // Mirrors the real npm bin-shim shape (a `#!/usr/bin/env node`
      // shebang script, executable bit set) that execa/cross-spawn already
      // knows how to invoke cross-platform for any real npm package.
      const binDir = join(dir, 'node_modules', '.bin');
      await fs.mkdir(binDir, { recursive: true });
      const fakePrettier = join(binDir, 'prettier');
      await fs.writeFile(
        fakePrettier,
        [
          '#!/usr/bin/env node',
          'const fs = require("fs");',
          'const path = process.argv[process.argv.length - 1];',
          'fs.writeFileSync(path, fs.readFileSync(path, "utf-8").replace(/"/g, "\'"));',
        ].join('\n'),
      );
      await fs.chmod(fakePrettier, 0o755);

      const cfg = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      cfg.devaudit_synced_version = '1.0.0';
      await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(cfg));
      await execa('git', ['init', '-q'], { cwd: dir });
      await execa('git', ['add', '-A'], { cwd: dir });
      await execa('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });

      const stubRunner: BaselineRunner = async ({ worktreeDir }) => {
        await fs.mkdir(join(worktreeDir, 'SDLC'), { recursive: true });
        // Double-quoted — the fake prettier above rewrites " to ' only if
        // it actually runs; if node_modules didn't resolve inside the
        // worktree, this would be hashed completely unrewritten instead.
        await fs.writeFile(join(worktreeDir, 'SDLC', 'Test_Policy.md'), '"raw"\n');
      };
      const ctx: SyncContext = {
        installerRoot: INSTALLER_ROOT,
        projectPath: dir,
        repoRoot: dir,
        projectName: 'fixture-app',
        stack: 'node',
        host: 'railway',
      };
      const result = await buildBaseline(ctx, stubRunner);
      expect(result.fellBack).toBe(false);
      const baselineHash = result.known.get('SDLC/Test_Policy.md')?.sha256;
      expect(baselineHash).toBe(sha256("'raw'\n"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('collects nested managed files (skills subdirectories, SDLC/blueprints/, SDLC/bin/) recursively for both hashing and formatting', async () => {
    const dir = await buildFixture();
    try {
      const cfg = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8'));
      cfg.devaudit_synced_version = '1.0.0';
      await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(cfg));
      await execa('git', ['init', '-q'], { cwd: dir });
      await execa('git', ['add', '-A'], { cwd: dir });
      await execa('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });

      const stubRunner: BaselineRunner = async ({ worktreeDir }) => {
        await fs.mkdir(join(worktreeDir, '.claude', 'skills', 'sdlc-implementer', 'references'), { recursive: true });
        await fs.writeFile(join(worktreeDir, '.claude', 'skills', 'sdlc-implementer', 'SKILL.md'), '# nested\n');
        await fs.writeFile(
          join(worktreeDir, '.claude', 'skills', 'sdlc-implementer', 'references', 'call-graph.md'),
          '# deeper\n',
        );
        await fs.mkdir(join(worktreeDir, 'SDLC', 'blueprints'), { recursive: true });
        await fs.writeFile(join(worktreeDir, 'SDLC', 'blueprints', '1-plan-requirement.raw.md'), '# blueprint\n');
      };
      const ctx: SyncContext = {
        installerRoot: INSTALLER_ROOT,
        projectPath: dir,
        repoRoot: dir,
        projectName: 'fixture-app',
        stack: 'node',
        host: 'railway',
      };
      const result = await buildBaseline(ctx, stubRunner);
      expect(result.fellBack).toBe(false);
      expect(result.known.get('.claude/skills/sdlc-implementer/SKILL.md')?.sha256).toBeTruthy();
      expect(result.known.get('.claude/skills/sdlc-implementer/references/call-graph.md')?.sha256).toBeTruthy();
      expect(result.known.get('SDLC/blueprints/1-plan-requirement.raw.md')?.sha256).toBeTruthy();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('reports filePaths for synced skill files and blueprint files, so section 2l formats them (#930 validation-gate finding)', async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    const dir = await buildFixture();
    try {
      const report = await syncProject(dir);
      const skillsSection = report.sections.find((s) => s.name === 'Claude Code skills');
      const engineSection = report.sections.find((s) => s.name === 'SDLC CLI engine');
      // Without this, section 2l's formatter never sees these files at all,
      // and the baseline reconstruction (which does list them, recursively)
      // permanently disagrees with what the real sync ever formats —
      // every skill/blueprint markdown file would read as a false-positive
      // conflict on every subsequent sync.
      expect(skillsSection?.filePaths?.length ?? 0).toBeGreaterThan(0);
      expect(engineSection?.filePaths?.length ?? 0).toBeGreaterThan(0);
      expect(skillsSection?.filePaths?.some((p) => p.endsWith('SKILL.md'))).toBe(true);
      expect(engineSection?.filePaths?.some((p) => p.endsWith('.raw.md'))).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
