import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VALIDATOR = join(process.cwd(), 'scripts/validate-adapter.cjs');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync('node', [VALIDATOR, ...args], { encoding: 'utf-8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: Buffer; stderr?: Buffer };
    return {
      status: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

function writeAdapter(content: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'adapter-'));
  const file = join(dir, 'adapter.json');
  writeFileSync(file, JSON.stringify(content, null, 2));
  return file;
}

const MINIMAL_VALID = {
  name: 'demo',
  description: 'demo adapter for tests',
  manifest_file: 'package.json',
  hook_framework: 'husky',
  hook_install_dir: '.husky',
  install: 'npm ci',
  type_check: 'npx tsc --noEmit',
  sast: 'npx semgrep scan --config auto --json',
  dep_audit: 'npm audit --json',
  test: 'npm test',
  build: 'npm run build',
  evidence_paths: {
    sast: 'ci-evidence/sast-results.json',
    dep_audit: 'ci-evidence/dependency-audit.json',
    test: 'ci-evidence/e2e-results.json',
  },
  runtime_setup: {
    action: 'actions/setup-node@v4',
    with: { 'node-version': '20' },
  },
};

const MINIMAL_HOST_VALID = {
  name: 'demo-host',
  description: 'demo host adapter for tests',
  deploy_trigger: 'push_to_main',
  production_url_from: 'secret',
  production_url_secret_key: 'production_url_secret',
};

describe('validate-adapter.cjs', () => {
  describe('stack adapters', () => {
    it('accepts the bundled Node adapter via --all', () => {
      const result = run(['--all']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('OK   sdlc/files/stacks/node/adapter.json [stack]');
    });

    it('accepts a hand-rolled minimal valid adapter', () => {
      const file = writeAdapter(MINIMAL_VALID);
      try {
        const result = run(['--type', 'stack', file]);
        expect(result.status).toBe(0);
      } finally {
        rmSync(file, { force: true });
      }
    });

    it('rejects an adapter missing a required field', () => {
      const file = writeAdapter({ ...MINIMAL_VALID, sast: undefined });
      try {
        const result = run(['--type', 'stack', file]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/sast/);
      } finally {
        rmSync(file, { force: true });
      }
    });

    it('rejects an adapter with an invalid name pattern', () => {
      const file = writeAdapter({ ...MINIMAL_VALID, name: 'Bad-NAME-with-Capitals' });
      try {
        const result = run(['--type', 'stack', file]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/name/);
      } finally {
        rmSync(file, { force: true });
      }
    });

    it('rejects an adapter with an unknown additional property', () => {
      const file = writeAdapter({ ...MINIMAL_VALID, mystery_field: 42 });
      try {
        const result = run(['--type', 'stack', file]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/additional/i);
      } finally {
        rmSync(file, { force: true });
      }
    });

    it('rejects a malformed runtime_setup.action', () => {
      const file = writeAdapter({
        ...MINIMAL_VALID,
        runtime_setup: { action: 'not-a-valid-action-ref', with: {} },
      });
      try {
        const result = run(['--type', 'stack', file]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/action/);
      } finally {
        rmSync(file, { force: true });
      }
    });

    it('rejects when evidence_paths is missing a leg', () => {
      const file = writeAdapter({
        ...MINIMAL_VALID,
        evidence_paths: {
          sast: 'ci-evidence/sast.json',
          dep_audit: 'ci-evidence/dep.json',
        },
      });
      try {
        const result = run(['--type', 'stack', file]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/test/);
      } finally {
        rmSync(file, { force: true });
      }
    });
  });

  describe('host adapters', () => {
    it('accepts the bundled Railway adapter via --all', () => {
      const result = run(['--all']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('OK   sdlc/files/hosts/railway/adapter.json [host]');
    });

    it('accepts a hand-rolled minimal valid host adapter', () => {
      const file = writeAdapter(MINIMAL_HOST_VALID);
      try {
        const result = run(['--type', 'host', file]);
        expect(result.status).toBe(0);
      } finally {
        rmSync(file, { force: true });
      }
    });

    it('rejects production_url_from=secret without production_url_secret_key', () => {
      const file = writeAdapter({
        name: 'demo-host',
        description: 'd',
        deploy_trigger: 'push_to_main',
        production_url_from: 'secret',
      });
      try {
        const result = run(['--type', 'host', file]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/production_url_secret_key/);
      } finally {
        rmSync(file, { force: true });
      }
    });

    it('rejects production_url_from=static without production_url_static', () => {
      const file = writeAdapter({
        name: 'demo-host',
        description: 'd',
        deploy_trigger: 'manual',
        production_url_from: 'static',
      });
      try {
        const result = run(['--type', 'host', file]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/production_url_static/);
      } finally {
        rmSync(file, { force: true });
      }
    });

    it('rejects an invalid deploy_trigger', () => {
      const file = writeAdapter({
        ...MINIMAL_HOST_VALID,
        deploy_trigger: 'morse_code',
      });
      try {
        const result = run(['--type', 'host', file]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/deploy_trigger/);
      } finally {
        rmSync(file, { force: true });
      }
    });

    it('refuses to validate without a type hint when path is outside stacks/hosts', () => {
      const file = writeAdapter(MINIMAL_HOST_VALID);
      try {
        const result = run([file]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/Cannot determine kind/);
      } finally {
        rmSync(file, { force: true });
      }
    });
  });

  describe('skills', () => {
    function writeSkill(frontmatter: string, body: string = '# Test skill\nbody'): string {
      const dir = mkdtempSync(join(tmpdir(), 'skill-'));
      const file = join(dir, 'SKILL.md');
      writeFileSync(file, `---\n${frontmatter}\n---\n\n${body}\n`);
      return file;
    }

    it('accepts the bundled e2e-test-engineer skill via --all', () => {
      const result = run(['--all']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'OK   sdlc/files/_common/skills/e2e-test-engineer/SKILL.md [skill]',
      );
    });

    it('accepts a hand-rolled minimal valid skill', () => {
      const file = writeSkill(
        'name: my-test-skill\ndescription: A test skill that does test things when the user wants test things done in the test repository.',
      );
      try {
        const result = run(['--type', 'skill', file]);
        expect(result.status).toBe(0);
      } finally {
        rmSync(file, { force: true });
      }
    });

    it('rejects a skill with invalid name pattern', () => {
      const file = writeSkill(
        'name: Bad_Name_With_Underscores\ndescription: A test skill that does test things when the user wants test things done in the test repository.',
      );
      try {
        const result = run(['--type', 'skill', file]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/name/);
      } finally {
        rmSync(file, { force: true });
      }
    });

    it('rejects a skill with a too-short description', () => {
      const file = writeSkill('name: t-s\ndescription: too short');
      try {
        const result = run(['--type', 'skill', file]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/description/);
      } finally {
        rmSync(file, { force: true });
      }
    });

    it('rejects a skill missing frontmatter delimiters', () => {
      const dir = mkdtempSync(join(tmpdir(), 'skill-'));
      const file = join(dir, 'SKILL.md');
      writeFileSync(file, '# No frontmatter here\nJust body.\n');
      try {
        const result = run(['--type', 'skill', file]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/frontmatter/);
      } finally {
        rmSync(file, { force: true });
      }
    });
  });

  describe('usage', () => {
    it('exits with usage error when called with no arguments', () => {
      const result = run([]);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/Usage/);
    });

    it('exits with usage error on invalid --type value', () => {
      const file = writeAdapter(MINIMAL_VALID);
      try {
        const result = run(['--type', 'banana', file]);
        expect(result.status).toBe(2);
        expect(result.stderr).toMatch(/--type/);
      } finally {
        rmSync(file, { force: true });
      }
    });
  });
});
