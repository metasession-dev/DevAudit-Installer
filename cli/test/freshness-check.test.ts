import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// sdlc-implementer's Phase 0 freshness check: before touching the
// triggering issue, confirm the project is running the latest synced
// DevAudit-Installer templates, updating first if not (devaudit-installer#736
// follow-on — the "check for updates before implementing" feature).

const root = resolve(import.meta.dirname, '..', '..');
const readCommon = (relPath: string) =>
  readFileSync(resolve(root, 'sdlc/files/_common', relPath), 'utf8').replace(/\r\n/g, '\n');

describe('sdlc-implementer skill — Phase 0 freshness check', () => {
  const skill = readCommon('skills/sdlc-implementer/SKILL.md');

  it('runs before the issue is fetched, as Phase 0 step 0', () => {
    const zeroIdx = skill.indexOf('0. **Freshness check.**');
    const fetchIdx = skill.indexOf('1. **Fetch.**');
    expect(zeroIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(zeroIdx).toBeLessThan(fetchIdx);
  });

  it('reads the stamped version and compares against the published npm version', () => {
    expect(skill).toContain('devaudit_synced_version');
    expect(skill).toContain('npm view @metasession.co/devaudit-cli version');
  });

  it('runs devaudit update when stale, then drives the sync through the Lightweight housekeeping path before continuing', () => {
    expect(skill).toContain('npx @metasession.co/devaudit-cli update .');
    expect(skill).toContain('Lightweight path');
    expect(skill).toMatch(/chore:.*Lightweight path/);
  });

  it('degrades to a non-blocking warning when the registry is unreachable', () => {
    expect(skill).toContain('log a warning and proceed to step 1 without blocking');
  });
});

describe('SdlcConfig schema — devaudit_synced_version field', () => {
  const configSrc = readFileSync(resolve(root, 'cli/src/lib/sdlc-config.ts'), 'utf8');

  it('declares the field the freshness check reads', () => {
    expect(configSrc).toContain('devaudit_synced_version?: string');
  });
});
