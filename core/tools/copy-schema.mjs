// Ships contracts/scan-report.schema.json inside the core package (dist/), so the portal and the CLI
// validate a scan report against the same file (DevAudit-Installer#1116 WP10).
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', '..', 'contracts', 'scan-report.schema.json');
const dest = resolve(here, '..', 'dist', 'scan-report.schema.json');
await mkdir(dirname(dest), { recursive: true });
await copyFile(src, dest);
console.log('copied scan-report.schema.json -> core/dist');
