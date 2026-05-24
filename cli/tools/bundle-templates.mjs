// Copies the SDLC template snapshot into the CLI package so the published npm
// tarball is self-contained — the CLI no longer needs a DevAudit-Installer
// checkout at runtime (see src/lib/installer-root.ts).
//
// Runs on `prepack` (npm pack / npm publish). The copied `sdlc/` and `scripts/`
// directories are git-ignored snapshots, regenerated from the repo root each
// time the package is packed.
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)); // cli/tools
const cliRoot = resolve(here, '..'); // cli/
const repoRoot = resolve(cliRoot, '..'); // DevAudit-Installer/

async function bundle(srcRel, destRel) {
  const src = resolve(repoRoot, srcRel);
  const dest = resolve(cliRoot, destRel);
  await fs.access(src).catch(() => {
    throw new Error(`bundle-templates: source not found: ${srcRel}`);
  });
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dirname(dest), { recursive: true });
  await fs.cp(src, dest, { recursive: true });
  console.log(`bundled ${srcRel} -> cli/${destRel}`);
}

await bundle('sdlc', 'sdlc');
await bundle('scripts/upload-evidence.sh', 'scripts/upload-evidence.sh');
console.log('template bundle complete');
