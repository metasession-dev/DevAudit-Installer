// Copies the SDLC template snapshot into the CLI package so the published npm
// tarball is self-contained — the CLI no longer needs a DevAudit-Installer
// checkout at runtime (see src/lib/installer-root.ts).
//
// Runs on `prepack` (npm pack / npm publish). The copied `sdlc/` directory is a
// git-ignored snapshot, regenerated from the repo root each
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
// DevAudit-Installer#1116 WP9 — the open framework registry is published in the package too.
await bundle('contracts/frameworks', 'frameworks');
// devaudit-installer#1082 — upload-evidence.sh ships inside sdlc/files/_common/scripts/;
// the old repo-root copy bundled here was stale and is gone. Remove a leftover snapshot.
await fs.rm(resolve(cliRoot, 'scripts'), { recursive: true, force: true });
console.log('template bundle complete');
