import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CREDENTIAL_STORE_READ_RULES,
  PAT_COMMAND_PATTERNS,
  agentPermissionsReport,
  claudeCodeDenyRules,
  claudeCodeSettingsSnippet,
  patCommandRules,
} from '../src/lib/agent-permissions.js';

// devaudit-installer#1098 — recommended agent permission rules (layer 4 of the credential model).
// The real-agent proof is scripts/agent-permissions-smoke.sh (manual: it starts headless sessions).

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

describe('recommended Claude Code deny rules', () => {
  it('cover every PAT command, bare and with global flags first, under devaudit and npx', () => {
    const rules = patCommandRules();
    for (const sub of PAT_COMMAND_PATTERNS) {
      expect(rules).toContain(`Bash(devaudit ${sub})`);
      expect(rules).toContain(`Bash(devaudit * ${sub})`);
      expect(rules).toContain(`Bash(npx *devaudit-cli ${sub})`);
      expect(rules).toContain(`Bash(npx *devaudit-cli * ${sub})`);
    }
    expect(rules).toHaveLength(PAT_COMMAND_PATTERNS.length * 4);
  });

  it('name what an agent must never run: install, join, uninstall, auth, doctor --fix, doctor --fleet', () => {
    expect([...PAT_COMMAND_PATTERNS]).toEqual(['install*', 'join*', 'uninstall*', 'auth *', 'doctor *--fix*', 'doctor *--fleet*']);
  });

  it('never deny what an agent legitimately runs: doctor, release status/check, update, push', () => {
    const rules = claudeCodeDenyRules().join('\n');
    for (const allowed of ['doctor --json', 'release status', 'release check', 'update', 'push', 'auth']) {
      // `auth ` (with the space) is denied; the others must not be matched by any rule's literal text.
      if (allowed === 'auth') continue;
      expect(rules).not.toContain(`devaudit ${allowed}`);
    }
    expect(rules).not.toMatch(/Bash\(devaudit \*\)/);
  });

  it('protect the credential store on Linux, macOS and Windows with Read rules (which also stop Edit and Write)', () => {
    expect([...CREDENTIAL_STORE_READ_RULES]).toEqual([
      'Read(~/.config/devaudit/**)',
      'Read(~/Library/Preferences/devaudit/**)',
      'Read(//**/AppData/Roaming/devaudit/**)',
    ]);
  });

  it('are one stable, duplicate-free list, shaped as a settings.json object', () => {
    const rules = claudeCodeDenyRules();
    expect(new Set(rules).size).toBe(rules.length);
    expect(claudeCodeSettingsSnippet()).toEqual({ permissions: { deny: rules } });
    expect(claudeCodeDenyRules()).toEqual(rules);
  });
});

describe('docs/agent-permissions.md carries exactly the rules the code defines', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'agent-permissions.md'), 'utf-8');

  it('has the ready-to-paste snippet, equal to claudeCodeSettingsSnippet()', () => {
    const blocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1] as string);
    const snippet = blocks.find((b) => b.includes('"deny"'));
    expect(snippet).toBeDefined();
    expect(JSON.parse(snippet as string)).toEqual(claudeCodeSettingsSnippet());
  });

  it('states the limits honestly', () => {
    expect(doc).toMatch(/not a sandbox/i);
    expect(doc).toContain('/usr/bin/devaudit');
    expect(doc).toContain("sh -c");
    expect(doc).toContain('agent-permissions-smoke.sh');
  });
});

describe('agentPermissionsReport (read-only)', () => {
  const REPO = '/repo';
  const HOME = '/home/u';
  const files = (map: Record<string, unknown>) => async (path: string): Promise<string | null> => (path in map ? JSON.stringify(map[path]) : null);
  const settings = (deny: string[]) => ({ permissions: { deny } });
  const all = claudeCodeDenyRules();

  it('reports no settings file at all', async () => {
    const r = await agentPermissionsReport({ repoRoot: REPO, home: HOME, readFile: files({}) });
    expect(r).toMatchObject({ files: [], present: 0, total: all.length, missingGroups: ['pat-commands', 'credential-store'] });
  });

  it('is complete when the user settings hold every rule', async () => {
    const r = await agentPermissionsReport({ repoRoot: REPO, home: HOME, readFile: files({ [join(HOME, '.claude', 'settings.json')]: settings(all) }) });
    expect(r).toMatchObject({ present: all.length, total: all.length, missingGroups: [] });
    expect(r.files).toEqual([join(HOME, '.claude', 'settings.json')]);
  });

  it('unions the project, local and user files: a deny at any scope applies', async () => {
    const pat = patCommandRules();
    const store = [...CREDENTIAL_STORE_READ_RULES];
    const r = await agentPermissionsReport({
      repoRoot: REPO,
      home: HOME,
      readFile: files({
        [join(REPO, '.claude', 'settings.json')]: settings(pat),
        [join(HOME, '.claude', 'settings.json')]: settings(store),
      }),
    });
    expect(r.missingGroups).toEqual([]);
    expect(r.files).toHaveLength(2);
  });

  it('names the group that is missing', async () => {
    const r = await agentPermissionsReport({ repoRoot: REPO, home: HOME, readFile: files({ [join(REPO, '.claude', 'settings.json')]: settings(patCommandRules()) }) });
    expect(r.missingGroups).toEqual(['credential-store']);
    const r2 = await agentPermissionsReport({ repoRoot: REPO, home: HOME, readFile: files({ [join(REPO, '.claude', 'settings.json')]: settings([...CREDENTIAL_STORE_READ_RULES]) }) });
    expect(r2.missingGroups).toEqual(['pat-commands']);
  });

  it('one missing PAT rule is enough to report the group', async () => {
    const r = await agentPermissionsReport({ repoRoot: REPO, home: HOME, readFile: files({ [join(HOME, '.claude', 'settings.json')]: settings(all.slice(1)) }) });
    expect(r.missingGroups).toEqual(['pat-commands']);
    expect(r.present).toBe(all.length - 1);
  });

  it('treats unparsable or rule-less files as having no rules, and never throws', async () => {
    const read = async (path: string): Promise<string | null> => (path.includes(HOME) ? '{ not json' : JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }));
    const r = await agentPermissionsReport({ repoRoot: REPO, home: HOME, readFile: read });
    expect(r.present).toBe(0);
    expect(r.missingGroups).toHaveLength(2);
  });
});
