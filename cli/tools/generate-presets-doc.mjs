#!/usr/bin/env node
/**
 * Writes docs/presets.md from the preset data in @metasession.co/devaudit-core
 * (DevAudit-Installer#1116 WP5). The text comes from `renderPresetsMarkdown()`, which a test compares
 * with the committed file, so the document cannot drift from the data.
 *
 *   npm run docs:presets            write docs/presets.md
 *   npm run docs:presets -- --check exit 1 when the committed file differs (nothing is written)
 *
 * Needs @metasession.co/devaudit-core built (`npm run build` in core/).
 */
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPresetsMarkdown } from '@metasession.co/devaudit-core';

const target = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'presets.md');
const text = renderPresetsMarkdown();

if (process.argv.includes('--check')) {
  const current = (await fs.readFile(target, 'utf-8').catch(() => null))?.replace(/\r\n/g, '\n') ?? null;
  if (current !== text) {
    console.error('docs/presets.md is out of date: run `npm run docs:presets` in cli/ and commit the result.');
    process.exit(1);
  }
  console.log('docs/presets.md is up to date.');
} else {
  await fs.writeFile(target, text);
  console.log(`wrote ${target}`);
}
