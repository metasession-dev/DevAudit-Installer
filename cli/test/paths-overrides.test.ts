import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AUTH_FILE, CACHE_DIR, CLAUDE_HOME, CONFIG_DIR, PLUGINS_DIR } from '../src/lib/paths.js';

// DevAudit-Installer#1116 R32: the per-user folders are overridable, and the test setup points every
// worker at its own throwaway folders, so no test reads or writes the real ones.

describe('per-user folder overrides', () => {
  it('the test setup sets all three, and the paths follow them', () => {
    expect(process.env['DEVAUDIT_CONFIG_DIR']).toBeTruthy();
    expect(process.env['DEVAUDIT_CACHE_DIR']).toBeTruthy();
    expect(process.env['DEVAUDIT_CLAUDE_HOME']).toBeTruthy();
    expect(CONFIG_DIR).toBe(process.env['DEVAUDIT_CONFIG_DIR']);
    expect(CACHE_DIR).toBe(process.env['DEVAUDIT_CACHE_DIR']);
    expect(CLAUDE_HOME).toBe(process.env['DEVAUDIT_CLAUDE_HOME']);
    expect(AUTH_FILE).toBe(join(CONFIG_DIR, 'auth.json'));
    expect(PLUGINS_DIR).toBe(join(CONFIG_DIR, 'plugins'));
  });

  it('none of them is the real home folder or a real config folder', () => {
    expect(CLAUDE_HOME).not.toBe(homedir());
    expect(CONFIG_DIR.startsWith(homedir() + '/.config')).toBe(false);
  });
});
