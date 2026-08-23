import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';
import { detectStack } from '../src/install/detect-stack.js';
import type { InstallContext } from '../src/install/types.js';

function baseCtx(overrides: Partial<InstallContext>): InstallContext {
  return {
    projectPath: '',
    repoRoot: '',
    projectName: 'fixture',
    installerRoot: '/dev/null',
    token: 'tok',
    baseUrl: 'https://devaudit.test',
    dryRun: false,
    nonInteractive: true,
    addTarget: false,
    installMode: 'operator',
    ...overrides,
  };
}

const dirs: string[] = [];
async function mkdtemp(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'detect-stack-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

// #689 follow-up: working_directory describes a target's location relative
// to the git REPO ROOT (what CI templates `cd` into) — never relative to
// wherever `devaudit install` happened to be invoked from. Without this,
// running install from inside a monorepo subdirectory (the whole point of
// --add-target) silently wrote working_directory: "." for a target that
// isn't actually at the repo root, breaking every repo-root-relative step
// downstream. Discovered onboarding mission-control (metasession-dev/META-AGENT).
describe('detectStack — working_directory is repo-root-relative (#689)', () => {
  it('single-target repo: repoRoot === projectPath, working_directory stays "."', async () => {
    const dir = await mkdtemp();
    await fs.writeFile(join(dir, 'package.json'), '{}');
    const { detected } = await detectStack(baseCtx({ projectPath: dir, repoRoot: dir }));
    expect(detected).toEqual({ stack: 'node', workingDirectory: '.' });
  });

  it('Node target in a monorepo subdirectory: working_directory is the subdirectory name, not "."', async () => {
    const repoRoot = await mkdtemp();
    await execa('git', ['init', '-q'], { cwd: repoRoot });
    const targetDir = join(repoRoot, 'mission-control');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(join(targetDir, 'package.json'), '{}');

    const { detected } = await detectStack(baseCtx({ projectPath: targetDir, repoRoot }));
    expect(detected).toEqual({ stack: 'node', workingDirectory: 'mission-control' });
  });

  it('Python target in a monorepo subdirectory: working_directory is the subdirectory name', async () => {
    const repoRoot = await mkdtemp();
    await execa('git', ['init', '-q'], { cwd: repoRoot });
    const targetDir = join(repoRoot, 'mission-control-api');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(join(targetDir, 'pyproject.toml'), '[project]\nname = "api"\n');

    const { detected } = await detectStack(baseCtx({ projectPath: targetDir, repoRoot }));
    expect(detected).toEqual({ stack: 'python', workingDirectory: 'mission-control-api' });
  });

  it('Python target found via nested search below projectPath, itself inside a monorepo subdirectory', async () => {
    const repoRoot = await mkdtemp();
    await execa('git', ['init', '-q'], { cwd: repoRoot });
    // install runs from mission-control-api/, and the actual pyproject.toml
    // is one level further down (src/) — the returned working_directory
    // must be relative to repoRoot, combining both hops.
    const targetDir = join(repoRoot, 'mission-control-api');
    const nestedDir = join(targetDir, 'src');
    await fs.mkdir(nestedDir, { recursive: true });
    await fs.writeFile(join(nestedDir, 'pyproject.toml'), '[project]\nname = "api"\n');

    const { detected } = await detectStack(baseCtx({ projectPath: targetDir, repoRoot }));
    expect(detected).toEqual({ stack: 'python', workingDirectory: 'mission-control-api/src' });
  });

  it('outside a git repo: falls back to projectPath as the root, working_directory stays "."', async () => {
    const dir = await mkdtemp();
    await fs.writeFile(join(dir, 'package.json'), '{}');
    // repoRoot === projectPath here simulates resolveRepoRoot()'s fallback
    // when projectPath isn't inside a git repository at all.
    const { detected } = await detectStack(baseCtx({ projectPath: dir, repoRoot: dir }));
    expect(detected.workingDirectory).toBe('.');
  });
});
