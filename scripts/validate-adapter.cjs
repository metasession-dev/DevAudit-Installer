#!/usr/bin/env node
/**
 * validate-adapter.cjs — Validate stack adapters, host adapters, and SDLC
 * skills against their schemas.
 *
 * Usage:
 *   node scripts/validate-adapter.cjs sdlc/files/stacks/node/adapter.json
 *   node scripts/validate-adapter.cjs sdlc/files/hosts/railway/adapter.json
 *   node scripts/validate-adapter.cjs sdlc/files/_common/skills/e2e-test-engineer/SKILL.md
 *   node scripts/validate-adapter.cjs --all   # every adapter + skill in the tree
 *
 * Kind (stack vs host vs skill) is auto-detected from the path:
 *   - sdlc/files/stacks/<name>/adapter.json    → stack
 *   - sdlc/files/hosts/<name>/adapter.json     → host
 *   - sdlc/files/_common/skills/<name>/SKILL.md → skill
 *   - sdlc/files/stacks/<name>/skills/<name>/SKILL.md → skill (stack-scoped)
 *
 * Exits 0 if valid, 1 if any input fails, 2 on usage error.
 *
 * For skills, the validator parses the YAML frontmatter (between the two
 * `---` lines at the top of SKILL.md) and validates that object against
 * skill.schema.json. The body of SKILL.md is not validated.
 *
 * Uses ajv if available (ajv 6 is transitively present via Next.js; ajv 8
 * via @sentry/nextjs). Both error-shape conventions are handled. Falls
 * back to a minimal hand-rolled required-field check if ajv is unresolvable.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const STACKS_DIR = path.join(REPO_ROOT, 'sdlc/files/stacks');
const HOSTS_DIR = path.join(REPO_ROOT, 'sdlc/files/hosts');
const COMMON_SKILLS_DIR = path.join(REPO_ROOT, 'sdlc/files/_common/skills');
const STACK_SCHEMA_PATH = path.join(STACKS_DIR, '_schema/adapter.schema.json');
const HOST_SCHEMA_PATH = path.join(HOSTS_DIR, '_schema/adapter.schema.json');
const SKILL_SCHEMA_PATH = path.join(COMMON_SKILLS_DIR, '_schema/skill.schema.json');

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to read ${filePath}: ${err.message}`);
  }
}

/**
 * Parse the YAML frontmatter of a SKILL.md (or any Markdown file with `---`
 * delimiters at the top). Returns the parsed object. Hand-rolled to avoid
 * pulling in a YAML dep — Skill frontmatter is always a flat object of
 * scalar / array values, so a minimal parser is enough.
 */
function parseSkillFrontmatter(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (!raw.startsWith('---')) {
    throw new Error('Skill file must start with YAML frontmatter (`---`)');
  }
  const close = raw.indexOf('\n---', 3);
  if (close === -1) {
    throw new Error('Skill frontmatter is not closed by a `---` line');
  }
  const yaml = raw.slice(3, close).replace(/^\n/, '');
  const obj = {};
  let currentKey = null;
  let buffer = '';
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^[a-zA-Z_][a-zA-Z0-9_-]*\s*:/.test(line)) {
      if (currentKey !== null) {
        obj[currentKey] = parseScalar(buffer.trim());
      }
      const idx = line.indexOf(':');
      currentKey = line.slice(0, idx).trim();
      buffer = line.slice(idx + 1);
    } else if (currentKey !== null) {
      buffer += ' ' + line.trim();
    }
  }
  if (currentKey !== null) {
    obj[currentKey] = parseScalar(buffer.trim());
  }
  return obj;
}

function parseScalar(raw) {
  if (raw === '' || raw === '~' || raw.toLowerCase() === 'null') return null;
  if (raw.toLowerCase() === 'true') return true;
  if (raw.toLowerCase() === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  // Inline array: [a, b, c] or ["a", "b"]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => parseScalar(s.trim()));
  }
  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function buildValidator(schema) {
  try {
    const Ajv = require('ajv');
    const ajv = new Ajv({ allErrors: true, strict: false });
    return ajv.compile(schema);
  } catch {
    return fallbackValidator(schema);
  }
}

function fallbackValidator(schema) {
  const required = schema.required || [];
  return function (data) {
    const errors = [];
    for (const key of required) {
      if (data[key] === undefined) {
        errors.push({ instancePath: `/${key}`, message: 'is required' });
      }
    }
    fallbackValidator.errors = errors.length > 0 ? errors : null;
    return errors.length === 0;
  };
}

function listAdapterPaths(parentDir) {
  if (!fs.existsSync(parentDir)) return [];
  return fs
    .readdirSync(parentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => path.join(parentDir, entry.name, 'adapter.json'))
    .filter((p) => fs.existsSync(p));
}

function listSkillPaths(parentDir) {
  if (!fs.existsSync(parentDir)) return [];
  return fs
    .readdirSync(parentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => path.join(parentDir, entry.name, 'SKILL.md'))
    .filter((p) => fs.existsSync(p));
}

function listAllPaths() {
  const stackSkills = [];
  if (fs.existsSync(STACKS_DIR)) {
    for (const entry of fs.readdirSync(STACKS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('_')) {
        stackSkills.push(...listSkillPaths(path.join(STACKS_DIR, entry.name, 'skills')));
      }
    }
  }
  return [
    ...listAdapterPaths(STACKS_DIR),
    ...listAdapterPaths(HOSTS_DIR),
    ...listSkillPaths(COMMON_SKILLS_DIR),
    ...stackSkills,
  ];
}

function resolveKindForPath(targetPath, forcedKind) {
  if (forcedKind) {
    const schemaPath = {
      stack: STACK_SCHEMA_PATH,
      host: HOST_SCHEMA_PATH,
      skill: SKILL_SCHEMA_PATH,
    }[forcedKind];
    return { schemaPath, kind: forcedKind };
  }
  const normalized = path.resolve(targetPath);
  if (normalized.endsWith('SKILL.md')) {
    return { schemaPath: SKILL_SCHEMA_PATH, kind: 'skill' };
  }
  if (normalized.startsWith(STACKS_DIR + path.sep) && normalized.endsWith('adapter.json')) {
    return { schemaPath: STACK_SCHEMA_PATH, kind: 'stack' };
  }
  if (normalized.startsWith(HOSTS_DIR + path.sep) && normalized.endsWith('adapter.json')) {
    return { schemaPath: HOST_SCHEMA_PATH, kind: 'host' };
  }
  throw new Error(
    `Cannot determine kind for ${targetPath}: stacks/<name>/adapter.json, hosts/<name>/adapter.json, or .../skills/<name>/SKILL.md (or pass --type stack|host|skill)`,
  );
}

function formatErrors(errors) {
  return errors
    .map((err) => {
      const rawPath = err.instancePath || err.dataPath || '';
      const where = rawPath || '/';
      const missing = err.params && err.params.missingProperty;
      const detail = missing ? `${err.message} (missing: ${missing})` : err.message;
      return `  • ${where}: ${detail}`;
    })
    .join('\n');
}

function parseArgs(argv) {
  let forcedKind = null;
  const positional = [];
  let all = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') {
      all = true;
    } else if (a === '--type') {
      const next = argv[i + 1];
      if (!['stack', 'host', 'skill'].includes(next)) {
        throw new Error(`--type must be 'stack', 'host', or 'skill' (got: ${next ?? '<missing>'})`);
      }
      forcedKind = next;
      i += 1;
    } else if (a.startsWith('--type=')) {
      const value = a.slice('--type='.length);
      if (!['stack', 'host', 'skill'].includes(value)) {
        throw new Error(`--type must be 'stack', 'host', or 'skill' (got: ${value})`);
      }
      forcedKind = value;
    } else {
      positional.push(a);
    }
  }
  return { all, forcedKind, positional };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const paths = args.all ? listAllPaths() : args.positional;
  if (paths.length === 0) {
    console.error(
      'Usage: validate-adapter.cjs [--type stack|host|skill] <path> [...] | --all',
    );
    process.exit(2);
  }
  const validatorCache = new Map();
  let failed = 0;
  for (const p of paths) {
    let kind;
    let validate;
    try {
      const resolved = resolveKindForPath(p, args.forcedKind);
      kind = resolved.kind;
      if (!validatorCache.has(resolved.schemaPath)) {
        validatorCache.set(resolved.schemaPath, buildValidator(loadJson(resolved.schemaPath)));
      }
      validate = validatorCache.get(resolved.schemaPath);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${path.relative(REPO_ROOT, p)}`);
      console.error(`  • /: ${err.message}`);
      continue;
    }
    let data;
    try {
      data = kind === 'skill' ? parseSkillFrontmatter(p) : loadJson(p);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${path.relative(REPO_ROOT, p)} [${kind}]`);
      console.error(`  • /: ${err.message}`);
      continue;
    }
    const ok = validate(data);
    const rel = path.relative(REPO_ROOT, p);
    if (ok) {
      console.log(`OK   ${rel} [${kind}]`);
    } else {
      failed += 1;
      const errs = validate.errors || fallbackValidator.errors || [];
      console.error(`FAIL ${rel} [${kind}]`);
      console.error(formatErrors(errs));
    }
  }
  process.exit(failed === 0 ? 0 : 1);
}

main();
