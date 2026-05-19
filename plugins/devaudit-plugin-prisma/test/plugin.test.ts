import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PluginContext, PluginEvent } from '@metasession-dev/devaudit-plugin-sdk';

interface ExecaCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

const execaCalls: ExecaCall[] = [];

vi.mock('execa', () => ({
  execa: async (file: string, args: readonly string[] = [], opts: { cwd?: string } = {}) => {
    execaCalls.push({ file, args, ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}) });
    if (file === 'npx' && args[0] === 'prisma' && args[1] === 'migrate' && args[2] === 'status') {
      return { exitCode: 0, stdout: 'Database schema is up to date!\n', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  },
}));

interface LoggerCapture {
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
  readonly debug: string[];
}

function makeLogger(): { logger: PluginContext['logger']; capture: LoggerCapture } {
  const capture: LoggerCapture = { info: [], warn: [], error: [], debug: [] };
  return {
    capture,
    logger: {
      info: (m: string) => capture.info.push(m),
      warn: (m: string) => capture.warn.push(m),
      error: (m: string) => capture.error.push(m),
      debug: (m: string) => capture.debug.push(m),
    },
  };
}

function makeContext(projectPath: string, events: PluginEvent[] = []): PluginContext {
  const { logger } = makeLogger();
  return {
    projectPath,
    sdlcConfig: { project_slug: 'fixture' },
    logger,
    apiVersion: '1',
    emit: (e) => events.push(e),
  };
}

function makeContextWithCapture(projectPath: string, events: PluginEvent[] = []): {
  ctx: PluginContext;
  capture: LoggerCapture;
} {
  const { logger, capture } = makeLogger();
  const ctx: PluginContext = {
    projectPath,
    sdlcConfig: { project_slug: 'fixture' },
    logger,
    apiVersion: '1',
    emit: (e) => events.push(e),
  };
  return { ctx, capture };
}

async function buildEmptyFixture(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), 'prisma-plugin-empty-'));
}

async function buildPrismaFixture(opts: { schema?: boolean; migrations?: readonly string[] } = {}): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'prisma-plugin-'));
  if (opts.schema ?? true) {
    await fs.mkdir(join(dir, 'prisma'), { recursive: true });
    await fs.writeFile(join(dir, 'prisma', 'schema.prisma'), 'generator client { provider = "prisma-client-js" }\n');
  }
  if (opts.migrations) {
    for (const name of opts.migrations) {
      const migrationDir = join(dir, 'prisma', 'migrations', name);
      await fs.mkdir(migrationDir, { recursive: true });
      await fs.writeFile(join(migrationDir, 'migration.sql'), '-- noop\n');
    }
  }
  return dir;
}

beforeAll(() => {
  process.env['NO_COLOR'] = '1';
});
afterAll(() => {
  delete process.env['NO_COLOR'];
});
afterEach(() => {
  execaCalls.length = 0;
});

describe('migrate-status command', () => {
  it('skips with a clear warning when no schema file is present', async () => {
    const { migrateStatus } = await import('../src/commands/migrate-status.js');
    const dir = await buildEmptyFixture();
    const { ctx, capture } = makeContextWithCapture(dir);
    try {
      await migrateStatus(ctx);
      expect(capture.warn[0]).toMatch(/No prisma\/schema\.prisma/);
      expect(execaCalls).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('shells out to `npx prisma migrate status` when schema exists', async () => {
    const { migrateStatus } = await import('../src/commands/migrate-status.js');
    const dir = await buildPrismaFixture();
    try {
      await migrateStatus(makeContext(dir));
      const call = execaCalls.find((c) => c.file === 'npx');
      expect(call?.args).toEqual(['prisma', 'migrate', 'status']);
      expect(call?.cwd).toBe(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('pending command', () => {
  it('warns when prisma/migrations/ is absent', async () => {
    const { pending } = await import('../src/commands/pending.js');
    const dir = await buildPrismaFixture({ schema: true });
    try {
      const { ctx, capture } = makeContextWithCapture(dir);
      await pending(ctx);
      expect(capture.warn[0]).toMatch(/No prisma\/migrations/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('lists migration directories sorted by name', async () => {
    const { pending } = await import('../src/commands/pending.js');
    const dir = await buildPrismaFixture({
      schema: true,
      migrations: ['20260101000000_initial', '20260201000000_followup'],
    });
    try {
      const events: PluginEvent[] = [];
      const { ctx, capture } = makeContextWithCapture(dir, events);
      await pending(ctx);
      expect(capture.info.join('\n')).toContain('20260101000000_initial');
      expect(capture.info.join('\n')).toContain('20260201000000_followup');
      expect(events.find((e) => e.type === 'prisma-migrations')).toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('afterUpdate hook', () => {
  it('is a no-op without a prisma schema', async () => {
    const { afterUpdate } = await import('../src/hooks/after-update.js');
    const dir = await buildEmptyFixture();
    try {
      const { ctx, capture } = makeContextWithCapture(dir);
      await afterUpdate(ctx);
      expect(capture.info).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('emits a reminder when prisma schema is present', async () => {
    const { afterUpdate } = await import('../src/hooks/after-update.js');
    const dir = await buildPrismaFixture();
    try {
      const { ctx, capture } = makeContextWithCapture(dir);
      await afterUpdate(ctx);
      expect(capture.info[0]).toMatch(/prisma migrate deploy/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('onDoctor hook', () => {
  it('debug-skips when no prisma artifacts exist', async () => {
    const { onDoctor } = await import('../src/hooks/on-doctor.js');
    const dir = await buildEmptyFixture();
    try {
      const { ctx, capture } = makeContextWithCapture(dir);
      await onDoctor(ctx);
      expect(capture.debug[0]).toMatch(/No Prisma artifacts/);
      expect(capture.warn).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('warns when schema is present but migrations dir is missing', async () => {
    const { onDoctor } = await import('../src/hooks/on-doctor.js');
    const dir = await buildPrismaFixture({ schema: true });
    try {
      const { ctx, capture } = makeContextWithCapture(dir);
      await onDoctor(ctx);
      expect(capture.warn[0]).toMatch(/migrations\/ is missing/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reports healthy when both schema and migrations exist', async () => {
    const { onDoctor } = await import('../src/hooks/on-doctor.js');
    const dir = await buildPrismaFixture({ schema: true, migrations: ['20260101000000_initial'] });
    try {
      const { ctx, capture } = makeContextWithCapture(dir);
      await onDoctor(ctx);
      expect(capture.info[0]).toMatch(/looks healthy/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
