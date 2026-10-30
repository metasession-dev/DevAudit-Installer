import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  ENV_FILE_READ_RULES,
  agentPermissionsReport,
  applyAgentPermissions,
  claudeCodeDenyRules,
  offerDeclinedForever,
  planApply,
  rememberOfferNever,
  settingsPathFor,
} from '../src/lib/agent-permissions.js';
import { offerAgentPermissions, runAgentPermissionsApply } from '../src/commands/agent-permissions.js';

// DevAudit-Installer#1116 WP13 (#1127) — `devaudit agent-permissions apply`, its merge, backup and
// idempotency, the interactive-or-`--yes` rule, the one-time offer and the opt-in env-files group.

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(join(tmpdir(), 'cli-agent-perms-'));
  dirs.push(d);
  return d;
}

const RULES = claudeCodeDenyRules();
const read = async (p: string): Promise<Record<string, any>> => JSON.parse(await fs.readFile(p, 'utf-8')) as Record<string, any>;
const backups = async (dir: string): Promise<string[]> => (await fs.readdir(dir)).filter((f) => f.includes('.devaudit-backup-'));

describe('the merge', () => {
  it('appends only missing rules, keeps existing entries in order and every other key', async () => {
    const dir = await tmp();
    const path = join(dir, 'settings.json');
    const original = {
      theme: 'dark',
      permissions: { allow: ['Bash(ls)'], ask: ['Bash(git push *)'], deny: ['Bash(rm -rf *)', RULES[2]!] },
      hooks: { PreToolUse: [] },
    };
    await fs.writeFile(path, JSON.stringify(original, null, 2));
    const r = await applyAgentPermissions(path, false);
    expect(r.status).toBe('applied');
    const after = await read(path);
    expect(after['theme']).toBe('dark');
    expect(after['hooks']).toEqual({ PreToolUse: [] });
    expect(after['permissions'].allow).toEqual(['Bash(ls)']);
    expect(after['permissions'].ask).toEqual(['Bash(git push *)']);
    const deny = after['permissions'].deny as string[];
    expect(deny.slice(0, 2)).toEqual(['Bash(rm -rf *)', RULES[2]]);
    expect(new Set(deny).size).toBe(deny.length);
    expect(RULES.every((rule) => deny.includes(rule))).toBe(true);
    expect(r.added).toHaveLength(RULES.length - 1);
  });

  it('writes a backup of the original bytes beside the file, only when it changes something', async () => {
    const dir = await tmp();
    const path = join(dir, 'settings.json');
    const bytes = '{\n  "model": "x"\n}\n';
    await fs.writeFile(path, bytes);
    const r = await applyAgentPermissions(path, false, new Date('2026-10-30T10:00:00Z'));
    expect(r.backup).toBeDefined();
    expect(await fs.readFile(r.backup!, 'utf-8')).toBe(bytes);
    expect((await backups(dir)).length).toBe(1);
    expect(await fs.readdir(dir)).not.toContain(expect.stringMatching(/\.tmp$/));
  });

  it('is idempotent: a second run writes nothing and makes no second backup', async () => {
    const dir = await tmp();
    const path = join(dir, 'settings.json');
    await fs.writeFile(path, '{}');
    await applyAgentPermissions(path, false);
    const before = await fs.readFile(path, 'utf-8');
    const stat = await fs.stat(path);
    const again = await applyAgentPermissions(path, false);
    expect(again.status).toBe('already-present');
    expect(await fs.readFile(path, 'utf-8')).toBe(before);
    expect((await fs.stat(path)).mtimeMs).toBe(stat.mtimeMs);
    expect((await backups(dir)).length).toBe(1); // the first run's backup only
  });

  it('creates the file and its folder when missing, with no backup', async () => {
    const dir = await tmp();
    const path = join(dir, 'nested', '.claude', 'settings.json');
    const r = await applyAgentPermissions(path, false);
    expect(r.status).toBe('applied');
    expect(r.backup).toBeUndefined();
    expect((await read(path))['permissions'].deny).toEqual(RULES);
  });

  it.skipIf(process.platform === 'win32')('keeps the file mode', async () => {
    const dir = await tmp();
    const path = join(dir, 'settings.json');
    await fs.writeFile(path, '{}', { mode: 0o640 });
    await fs.chmod(path, 0o640);
    await applyAgentPermissions(path, false);
    expect((await fs.stat(path)).mode & 0o777).toBe(0o640);
  });

  it('refuses a file that is not valid JSON, or has the wrong shape, and leaves it untouched', async () => {
    const dir = await tmp();
    for (const [name, content] of [
      ['bad.json', '{ not json'],
      ['array.json', '[]'],
      ['perm.json', '{"permissions": 5}'],
      ['deny.json', '{"permissions": {"deny": "x"}}'],
    ] as const) {
      const path = join(dir, name);
      await fs.writeFile(path, content);
      const r = await applyAgentPermissions(path, false);
      expect(r.status, name).toBe('refused');
      expect(await fs.readFile(path, 'utf-8'), name).toBe(content);
    }
    expect(await backups(dir)).toEqual([]);
  });
});

describe('scopes', () => {
  it('maps each scope to its one path', () => {
    expect(settingsPathFor('user', '/repo', '/home/u')).toBe(join('/home/u', '.claude', 'settings.json'));
    expect(settingsPathFor('project', '/repo', '/home/u')).toBe(join('/repo', '.claude', 'settings.json'));
    expect(settingsPathFor('local', '/repo', '/home/u')).toBe(join('/repo', '.claude', 'settings.local.json'));
  });
});

describe('the opt-in env-files group', () => {
  it('is absent unless asked for, and not counted by doctor unless applied', async () => {
    const dir = await tmp();
    const path = join(dir, 'settings.json');
    expect((await planApply(path, false)).toAdd).toEqual(RULES);
    expect((await planApply(path, true)).toAdd).toEqual([...RULES, ...ENV_FILE_READ_RULES]);
    await applyAgentPermissions(path, false);
    expect((await read(path))['permissions'].deny).not.toContain(ENV_FILE_READ_RULES[0]);
    await applyAgentPermissions(path, true);
    expect((await read(path))['permissions'].deny).toEqual(expect.arrayContaining([...ENV_FILE_READ_RULES]));
    // the doctor report counts only the default 27
    const home = dir;
    await fs.mkdir(join(home, '.claude'), { recursive: true });
    await fs.copyFile(path, join(home, '.claude', 'settings.json'));
    const report = await agentPermissionsReport({ repoRoot: join(dir, 'repo'), home });
    expect(report.total).toBe(RULES.length);
    expect(report.present).toBe(RULES.length);
    expect(report.missingGroups).toEqual([]);
  });
});

describe('the command', () => {
  const noTerminal = { nonInteractiveReason: () => 'no TTY', confirm: async () => null };

  it('without a terminal and without --yes it is not applied (exit 8) and writes nothing', async () => {
    const home = await tmp();
    const code = await runAgentPermissionsApply({}, { home, cwd: home, ask: noTerminal as any, say: () => undefined });
    expect(code).toBe(8);
    await expect(fs.stat(join(home, '.claude', 'settings.json'))).rejects.toThrow();
  });

  it('with --yes it applies without asking; a second run reports "already present"', async () => {
    const home = await tmp();
    expect(await runAgentPermissionsApply({ yes: true }, { home, cwd: home, ask: noTerminal as any, say: () => undefined })).toBe(0);
    expect((await read(join(home, '.claude', 'settings.json')))['permissions'].deny).toEqual(RULES);
    expect(await runAgentPermissionsApply({ yes: true }, { home, cwd: home, ask: noTerminal as any, say: () => undefined })).toBe(0);
    expect(await backups(join(home, '.claude'))).toEqual([]);
  });

  it('asks at a terminal and a declined confirmation exits 8', async () => {
    const home = await tmp();
    const asked: string[] = [];
    const ask = { nonInteractiveReason: () => null, confirm: async (q: string) => (asked.push(q), false) };
    expect(await runAgentPermissionsApply({}, { home, cwd: home, ask: ask as any, say: () => undefined })).toBe(8);
    expect(asked).toHaveLength(1);
    const yes = { nonInteractiveReason: () => null, confirm: async () => true };
    expect(await runAgentPermissionsApply({}, { home, cwd: home, ask: yes as any, say: () => undefined })).toBe(0);
  });

  it('an unparsable settings file exits 1 and is left untouched', async () => {
    const home = await tmp();
    await fs.mkdir(join(home, '.claude'), { recursive: true });
    await fs.writeFile(join(home, '.claude', 'settings.json'), '{ nope');
    expect(await runAgentPermissionsApply({ yes: true }, { home, cwd: home, say: () => undefined })).toBe(1);
    expect(await fs.readFile(join(home, '.claude', 'settings.json'), 'utf-8')).toBe('{ nope');
  });

  it('an invalid --scope exits 2 (through the real command line too)', async () => {
    expect(await runAgentPermissionsApply({ scope: 'machine' }, { say: () => undefined })).toBe(2);
    const r = await execa('node', [join(__dirname, '..', 'bin', 'devaudit.js'), 'agent-permissions', 'apply', '--scope', 'machine'], { reject: false });
    expect(r.exitCode).toBe(2);
  });

  it('project and local scopes write inside the repository', async () => {
    const repo = await tmp();
    await execa('git', ['init', '-q'], { cwd: repo });
    expect(await runAgentPermissionsApply({ scope: 'project', yes: true }, { cwd: repo, say: () => undefined })).toBe(0);
    expect(await runAgentPermissionsApply({ scope: 'local', yes: true }, { cwd: repo, say: () => undefined })).toBe(0);
    expect((await read(join(repo, '.claude', 'settings.json')))['permissions'].deny).toEqual(RULES);
    expect((await read(join(repo, '.claude', 'settings.local.json')))['permissions'].deny).toEqual(RULES);
  });
});

describe('the one-time offer', () => {
  const terminal = (answer: string) => ({ nonInteractiveReason: () => null, select: async () => answer });

  it('"never" is remembered in the config folder file, other keys kept, and silences the offer', async () => {
    const dir = await tmp();
    const configFile = join(dir, 'config.json');
    await fs.writeFile(configFile, JSON.stringify({ other: 1 }));
    const home = await tmp();
    expect(await offerAgentPermissions({ cwd: home }, { home, configFile, ask: terminal('never') as any, say: () => undefined })).toBe('never');
    expect(await read(configFile)).toEqual({ other: 1, agentPermissionsOffer: 'never' });
    expect(await offerDeclinedForever(configFile)).toBe(true);
    expect(await offerAgentPermissions({ cwd: home }, { home, configFile, ask: terminal('yes') as any, say: () => undefined })).toBe('skipped');
  });

  it('is silent with no terminal, in a dry run, and when every rule is already present', async () => {
    const home = await tmp();
    const configFile = join(await tmp(), 'config.json');
    const none = { nonInteractiveReason: () => 'no TTY', select: async () => 'yes' };
    expect(await offerAgentPermissions({ cwd: home }, { home, configFile, ask: none as any })).toBe('skipped');
    expect(await offerAgentPermissions({ cwd: home, dryRun: true }, { home, configFile, ask: terminal('yes') as any })).toBe('skipped');
    await applyAgentPermissions(settingsPathFor('user', home, home), false);
    expect(await offerAgentPermissions({ cwd: home }, { home, configFile, ask: terminal('yes') as any })).toBe('skipped');
  });

  it('writes nothing without a yes, and applies to the user settings on yes', async () => {
    const home = await tmp();
    const configFile = join(await tmp(), 'config.json');
    expect(await offerAgentPermissions({ cwd: home }, { home, configFile, ask: terminal('no') as any, say: () => undefined })).toBe('declined');
    await expect(fs.stat(join(home, '.claude', 'settings.json'))).rejects.toThrow();
    expect(await offerAgentPermissions({ cwd: home }, { home, configFile, ask: terminal('yes') as any, say: () => undefined })).toBe('applied');
    expect((await read(join(home, '.claude', 'settings.json')))['permissions'].deny).toEqual(RULES);
    await rememberOfferNever(configFile);
    expect(await offerDeclinedForever(configFile)).toBe(true);
  });
});

describe('doctor --guided offers the apply as a tier A option', () => {
  it('adds one option to the agent-permissions gap and leaves the tier C guidance', async () => {
    const { withAgentPermissionsOption } = await import('../src/commands/doctor.js');
    const gap = {
      id: 'doctor:agent-permissions:agent-permissions',
      source: 'doctor' as const,
      check: 'agent-permissions',
      subject: 'agent-permissions',
      title: 't',
      why: 'w'.repeat(40),
      controls: [],
      options: [{ id: 'add-agent-permission-rules', label: 'guidance', tier: 'C' as const, consequence: 'c' }],
    };
    const [out] = withAgentPermissionsOption([gap]);
    expect(out!.options.map((o) => `${o.id}:${o.tier}`)).toEqual(['apply-agent-permissions:A', 'add-agent-permission-rules:C']);
    expect(out!.options[0]!.remediation?.data).toEqual({ scope: 'user' });
    expect(withAgentPermissionsOption([out!])[0]!.options).toHaveLength(2);
    const other = { ...gap, check: 'srs' };
    expect(withAgentPermissionsOption([other])[0]).toBe(other);
  });
});
