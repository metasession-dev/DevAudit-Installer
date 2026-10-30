import type { TestGroups } from './detect/facts.js';

/**
 * The validators of the question registry (DevAudit-Installer#1116 section 5). Each is a pure function:
 * it returns a reason the answer cannot work, or null. The registry stores only the validator ids, so
 * the portal can render the same questions from data and call the same functions.
 *
 * A validator that needs to know about the repository (which folders exist, which host adapters are
 * installed, which test groups were found) reads it from a {@link ValidationContext} the caller fills
 * in. When the caller leaves out what a validator needs, it cannot check that part and does not refuse
 * on it: the registry's callers (install, configure, the portal form) always supply it.
 */

export const VALIDATOR_IDS = [
  'slug',
  'httpsUrl',
  'secretName',
  'cron5',
  'existingDir',
  'existingPath',
  'branchesDiffer',
  'tierHasTests',
  'hostAdapterExists',
  'nonEmpty',
  'positiveInt',
] as const;

export type ValidatorId = (typeof VALIDATOR_IDS)[number];

export interface ValidationContext {
  /** Directories that exist, as repository paths without a trailing slash (`.` is the root). For `existingDir`. */
  readonly existingDirs?: readonly string[];
  /** Files and directories that exist, as repository paths. For `existingPath`. */
  readonly existingPaths?: readonly string[];
  /** The host adapters installed. For `hostAdapterExists`. */
  readonly hosts?: readonly string[];
  /** The test groups found. For `tierHasTests`. */
  readonly testGroups?: Partial<TestGroups>;
}

export type Validator = (value: unknown, ctx: ValidationContext) => string | null;

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A string, or the entries of a list of strings, or the words of a space-separated string. */
function entriesOf(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.every((v) => typeof v === 'string') ? (value as string[]) : null;
  if (typeof value === 'string') return value.split(/\s+/).filter((v) => v !== '');
  return null;
}

const trimSlash = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** Lower-case letters and digits in words joined by single hyphens, the form `defaultSlug` produces. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 64;

export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

/** A branch name git accepts (the part of `git check-ref-format` that matters for a name we create). */
export function isValidBranchName(name: string): boolean {
  if (name === '' || name.length > 200) return false;
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false;
  if (/[\s~^:?*[\\\x00-\x1f\x7f]|\.\.|@\{|\/\//.test(name)) return false;
  return name.split('/').every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'));
}

export const VALIDATORS: Readonly<Record<ValidatorId, Validator>> = {
  slug(value) {
    const v = asString(value);
    if (v === null || v === '') return 'must not be empty';
    if (v.length > SLUG_MAX) return `must be at most ${SLUG_MAX} characters`;
    return SLUG.test(v) ? null : 'must be lower-case letters and digits in words joined by single hyphens, for example my-app';
  },

  httpsUrl(value) {
    const v = asString(value);
    if (v === null || v.trim() === '') return 'must be a web address starting with https://';
    let url: URL;
    try {
      url = new URL(v.trim());
    } catch {
      return 'must be an absolute https:// address, for example https://app.example.com';
    }
    if (url.protocol !== 'https:') return 'must start with https://';
    if (LOCAL_HOSTS.has(url.hostname.toLowerCase()) || url.hostname.toLowerCase().endsWith('.localhost')) {
      return 'must be the production address, not localhost';
    }
    return null;
  },

  secretName(value) {
    const v = asString(value);
    return v !== null && SECRET_NAME_PATTERN.test(v)
      ? null
      : 'must be a GitHub secret name: upper-case letters, digits and underscores, starting with a letter';
  },

  cron5(value) {
    const v = asString(value);
    if (v === null || v.trim() === '') return 'must be a cron expression with five space-separated fields, for example 0 3 * * *';
    if (/['"\r\n]/.test(v)) return 'must not contain quotes or line breaks';
    return /^\S+(\s+\S+){4}$/.test(v.trim()) ? null : 'must have exactly five space-separated fields, for example 0 3 * * *';
  },

  existingDir(value, ctx) {
    const entries = entriesOf(value);
    if (entries === null || entries.length === 0) return 'must name at least one folder';
    if (ctx.existingDirs === undefined) return null;
    const known = new Set(ctx.existingDirs.map(trimSlash));
    const missing = entries.map(trimSlash).filter((dir) => dir !== '.' && !known.has(dir));
    return missing.length === 0 ? null : `these folders do not exist in the repository: ${missing.join(', ')}`;
  },

  existingPath(value, ctx) {
    const entries = entriesOf(value);
    if (entries === null || entries.length === 0) return 'must name at least one file or folder';
    if (ctx.existingPaths === undefined) return null;
    const known = new Set(ctx.existingPaths.map(trimSlash));
    const missing = entries.map(trimSlash).filter((path) => !known.has(path));
    return missing.length === 0 ? null : `these paths do not exist in the repository: ${missing.join(', ')}`;
  },

  branchesDiffer(value) {
    if (value === null || typeof value !== 'object') return 'must give the integration branch and the release branch';
    const { integration, release } = value as { integration?: unknown; release?: unknown };
    if (typeof integration !== 'string' || typeof release !== 'string') return 'must give the integration branch and the release branch';
    for (const [label, name] of [['integration', integration], ['release', release]] as const) {
      if (!isValidBranchName(name)) return `the ${label} branch name \`${name}\` is not a name git accepts`;
    }
    return integration === release ? 'the integration branch and the release branch must be different branches' : null;
  },

  tierHasTests(value, ctx) {
    const v = asString(value);
    if (v === null) return 'must be one of none, smoke, critical, full';
    if (v === 'none') return null;
    if (v !== 'smoke' && v !== 'critical' && v !== 'full') return 'must be one of none, smoke, critical, full';
    if (ctx.testGroups === undefined) return null;
    return ctx.testGroups[v] === true ? null : `there are no ${v} tests to run; add some first, or choose a smaller group`;
  },

  hostAdapterExists(value, ctx) {
    const v = asString(value);
    if (v === null || v === '') return 'must name a host';
    if (ctx.hosts === undefined) return null;
    return ctx.hosts.includes(v) ? null : `must be one of the installed hosts: ${ctx.hosts.join(', ')}`;
  },

  nonEmpty(value) {
    return typeof value === 'string' && value.trim() !== '' ? null : 'must not be empty';
  },

  positiveInt(value) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
    return Number.isInteger(n) && n > 0 ? null : 'must be a whole number greater than 0';
  },
};

/** Run one validator by id. */
export function validate(id: ValidatorId, value: unknown, ctx: ValidationContext = {}): string | null {
  return VALIDATORS[id](value, ctx);
}

/** Run several validators; the first reason wins. */
export function validateAll(ids: readonly ValidatorId[], value: unknown, ctx: ValidationContext = {}): string | null {
  for (const id of ids) {
    const reason = validate(id, value, ctx);
    if (reason !== null) return reason;
  }
  return null;
}
