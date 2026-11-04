import { promises as fs } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { execa } from 'execa';
import type { FrameworkFile, RepoReader, ScanContext } from '@metasession.co/devaudit-core';
import { extractEvidenceTypesFromContent } from './evidence-type-extractor.js';

/**
 * DevAudit-Installer#1116 WP10 — what `devaudit scan` needs from the local machine: the registry files, the
 * evidence types the repository's workflows upload, the starter templates bundled in this package, and the
 * date a file last changed in git. Reads only; nothing from the repository is ever run.
 */

/** The registry files: `<root>/frameworks` in the published package, `<root>/contracts/frameworks` in a checkout. */
export async function loadFrameworks(installerRoot: string): Promise<FrameworkFile[]> {
  for (const dir of [join(installerRoot, 'frameworks'), join(installerRoot, 'contracts', 'frameworks')]) {
    let names: string[];
    try {
      names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json') && n !== 'schema.json').sort();
    } catch {
      continue;
    }
    if (names.length === 0) continue;
    const out: FrameworkFile[] = [];
    for (const name of names) out.push(JSON.parse(await fs.readFile(join(dir, name), 'utf-8')) as FrameworkFile);
    return out;
  }
  throw new Error('Could not find the framework registry (frameworks/). Reinstall @metasession.co/devaudit-cli, or set DEVAUDIT_INSTALLER_ROOT to a DevAudit-Installer checkout.');
}

/** A reader that also knows when a file last changed in git (null when git or the history is unavailable). */
export function withGitDates(reader: RepoReader, repoRoot: string): RepoReader {
  return {
    list: (dir) => reader.list(dir),
    read: (path, maxBytes) => reader.read(path, maxBytes),
    async lastCommitDate(path) {
      const r = await execa('git', ['log', '-1', '--format=%cI', '--', path], { cwd: repoRoot, reject: false, timeout: 10_000 });
      if (r.exitCode !== 0 || r.stdout.trim() === '') return null;
      const d = new Date(r.stdout.trim());
      return Number.isNaN(d.getTime()) ? null : d;
    },
  };
}

async function workflowTypes(reader: RepoReader): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const entry of await reader.list('.github/workflows')) {
    if (entry.endsWith('/') || !/\.ya?ml$/.test(entry)) continue;
    const content = await reader.read(entry, 1_000_000);
    if (content === null) continue;
    for (const type of extractEvidenceTypesFromContent(content)) map.set(type, [...(map.get(type) ?? []), entry]);
  }
  return map;
}

async function walkFiles(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > 6) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walkFiles(p, out, depth + 1);
    else out.push(p);
  }
}

/** Starter contents for a file name, from `sdlc/files/_common` of the bundled templates. */
function starterLookup(installerRoot: string): (fileName: string) => Promise<readonly string[]> {
  let files: Promise<string[]> | undefined;
  return async (fileName) => {
    files ??= (async () => {
      const out: string[] = [];
      await walkFiles(resolve(installerRoot, 'sdlc', 'files', '_common'), out);
      return out;
    })();
    const hits = (await files).filter((p) => basename(p) === fileName || basename(p) === `${fileName}.template`);
    const contents: string[] = [];
    for (const p of hits) contents.push(await fs.readFile(p, 'utf-8'));
    return contents;
  };
}

export async function buildScanContext(reader: RepoReader, repoRoot: string, installerRoot: string): Promise<ScanContext> {
  const withDates = withGitDates(reader, repoRoot);
  let categories: Record<string, { category?: string }> = {};
  try {
    categories = (JSON.parse(await fs.readFile(join(installerRoot, 'contracts', 'evidence-types.json'), 'utf-8')) as { evidence_types: Record<string, { category?: string }> }).evidence_types;
  } catch {
    // the contract is not bundled in the package; categories are then unknown
  }
  return {
    reader: withDates,
    uploadedTypes: await workflowTypes(reader),
    categoryOf: (type) => categories[type]?.category,
    starterTemplates: starterLookup(installerRoot),
  };
}
