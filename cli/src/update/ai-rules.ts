import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { exists } from '../lib/fs-utils.js';
import type { SyncContext, SectionResult } from './types.js';

const CURSOR_POINTER = `# Cursor Rules

All project rules, architectural standards, and development workflows are consolidated in:
👉 **[INSTRUCTIONS.md](./INSTRUCTIONS.md)**

Please refer to \`INSTRUCTIONS.md\` as the **Single Source of Truth** for all development standards in this repository.
`;

const WINDSURF_POINTER = `# Windsurf Rules

All project rules, architectural standards, and development workflows are consolidated in:
👉 **[INSTRUCTIONS.md](./INSTRUCTIONS.md)**

Please refer to \`INSTRUCTIONS.md\` as the **Single Source of Truth** for all development standards in this repository.
`;

const GEMINI_POINTER = `# GEMINI.md

This file provides guidance to Gemini CLI when working in this repository.

## Context

**Project Standards:** See **[./INSTRUCTIONS.md](./INSTRUCTIONS.md)** for project rules, architecture, and development standards.

Please adhere to the instructions in \`INSTRUCTIONS.md\` as the **Single Source of Truth**.
`;

const CLAUDE_POINTER_TAIL = `
## Project Standards

All project rules, architectural standards, and development workflows are consolidated in:
👉 **[INSTRUCTIONS.md](./INSTRUCTIONS.md)**

Please refer to \`INSTRUCTIONS.md\` as the **Single Source of Truth** for:
- Tech Stack & Architecture
- Code Style & Formatting
- Security & Compliance
- SDLC Development Process & Quality Gates
`;

const CLAUDE_NEW = `# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.
${CLAUDE_POINTER_TAIL}`;

const SDLC_HEADER = '## SDLC Compliance Process (MANDATORY)';

async function writePointerFile(path: string, content: string): Promise<void> {
  await fs.writeFile(path, content);
}

async function updateClaudeFile(target: string): Promise<void> {
  if (!(await exists(target))) {
    await fs.writeFile(target, CLAUDE_NEW);
    return;
  }
  let body = await fs.readFile(target, 'utf-8');
  const sdlcIdx = body.indexOf(SDLC_HEADER);
  if (sdlcIdx >= 0) {
    body = body.slice(0, sdlcIdx).trimEnd() + '\n';
  }
  if (!body.includes('INSTRUCTIONS.md')) {
    body = body.trimEnd() + '\n' + CLAUDE_POINTER_TAIL;
  }
  await fs.writeFile(target, body);
}

async function updateInstructionsFile(target: string, sdlcContent: string): Promise<void> {
  if (!(await exists(target))) {
    const body =
      '# Project Instructions & Standards (Single Source of Truth)\n' +
      '\n' +
      'This document serves as the primary reference for all development in this repository.\n' +
      '\n' +
      sdlcContent;
    await fs.writeFile(target, body);
    return;
  }
  let existing = await fs.readFile(target, 'utf-8');
  const sdlcIdx = existing.indexOf(SDLC_HEADER);
  if (sdlcIdx >= 0) {
    existing = existing.slice(0, sdlcIdx).replace(/\n*$/u, '\n');
  } else {
    existing = existing.replace(/\n*$/u, '\n');
  }
  const next = existing + '\n' + sdlcContent;
  await fs.writeFile(target, next);
}

/**
 * Section 2b: AI rule files (single source of truth pattern).
 * - .cursorrules / .windsurfrules / GEMINI.md → pointer files (overwritten)
 * - CLAUDE.md → preserve project header, append pointer if missing,
 *   strip any prior SDLC section
 * - INSTRUCTIONS.md → preserve project section, append/replace SDLC section
 *   from sdlc/ai-rules/INSTRUCTIONS-SDLC.md
 */
export async function syncAiRules(ctx: SyncContext): Promise<SectionResult> {
  const sdlcSource = join(ctx.installerRoot, 'sdlc', 'ai-rules', 'INSTRUCTIONS-SDLC.md');
  if (!(await exists(sdlcSource))) {
    return { name: 'AI rule pointers + INSTRUCTIONS.md', filesSynced: 0, skipped: true, message: 'INSTRUCTIONS-SDLC.md not found' };
  }
  const sdlcContent = await fs.readFile(sdlcSource, 'utf-8');
  await writePointerFile(join(ctx.projectPath, '.cursorrules'), CURSOR_POINTER);
  await writePointerFile(join(ctx.projectPath, '.windsurfrules'), WINDSURF_POINTER);
  await writePointerFile(join(ctx.projectPath, 'GEMINI.md'), GEMINI_POINTER);
  await updateClaudeFile(join(ctx.projectPath, 'CLAUDE.md'));
  await updateInstructionsFile(join(ctx.projectPath, 'INSTRUCTIONS.md'), sdlcContent);
  return { name: 'AI rule pointers + INSTRUCTIONS.md', filesSynced: 5, message: 'synced' };
}
