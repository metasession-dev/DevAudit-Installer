/**
 * devaudit-installer#1040 — the `sdlc-config.json` keys `devaudit configure`
 * can read and change, with the type, allowed values and validation each one
 * needs. Only keys a generated workflow or skill actually reads are listed;
 * anything else is refused by `configure set` (hand-edit it, knowingly).
 *
 * `affects` names the generated files `devaudit update` rewrites when the key
 * changes, so `configure set --dry-run` can say what the change will touch.
 */

export type ConfigKeyType = 'string' | 'integer' | 'boolean' | 'string[]' | 'object';

export interface ConfigKeySpec {
  readonly key: string;
  readonly type: ConfigKeyType;
  readonly description: string;
  /** Fixed allowed values. `host` is validated against the shipped adapters instead. */
  readonly enum?: readonly string[];
  /** Extra validation; returns an error message or null. */
  readonly validate?: (value: unknown) => string | null;
  readonly affects: readonly string[];
  /** Only meaningful for these hosts (shown in `configure list`, warned on set). */
  readonly hosts?: readonly string[];
  /** Refuse `configure set` and point at the command that owns this key. */
  readonly ownedBy?: string;
}

export const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;

const secretName = (value: unknown): string | null =>
  typeof value === 'string' && SECRET_NAME.test(value)
    ? null
    : 'must be a GitHub secret name: upper case letters, digits and underscores, starting with a letter';

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? null : 'must not be empty';

const httpsUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || value === '') return null;
  try {
    return new URL(value).protocol === 'https:' ? null : 'must be an https:// URL';
  } catch {
    return 'must be an absolute https:// URL';
  }
};

const nonNegative = (value: unknown): string | null =>
  typeof value === 'number' && value >= 0 ? null : 'must be 0 or more';

const positive = (value: unknown): string | null =>
  typeof value === 'number' && value > 0 ? null : 'must be greater than 0';

/** One shell command for a test tier: single line, at most 500 characters. */
const shellCommand = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.trim() === '') return 'must not be empty';
  if (/[\r\n]/.test(value)) return 'must be a single line';
  if (value.length > 500) return 'must be at most 500 characters';
  return null;
};

/** Five space-separated cron fields, or empty to turn the schedule off. */
const cronOrEmpty = (value: unknown): string | null => {
  if (typeof value !== 'string') return 'must be a cron expression';
  if (value.trim() === '') return null;
  if (/['"\r\n]/.test(value)) return 'must not contain quotes or line breaks';
  return /^\S+(\s+\S+){4}$/.test(value.trim()) ? null : 'must be a cron expression with five space-separated fields, e.g. "0 3 * * *"';
};

const featureCommand = (value: unknown): string | null =>
  shellCommand(value) ?? (String(value).includes('{REQ}') ? null : 'must contain the {REQ} placeholder');

const ALL_WORKFLOWS = ['.github/workflows/*.yml'];
const CI = ['.github/workflows/ci.yml'];
const E2E = ['.github/workflows/ci.yml', '.github/workflows/e2e-regression.yml'];
const RELEASE_GATE = [
  '.github/workflows/e2e-regression.yml',
  '.github/workflows/compliance-evidence.yml',
  '.github/workflows/check-release-approval.yml',
];
const TIERS = [
  '.github/workflows/ci.yml',
  '.github/workflows/feature-e2e.yml',
  '.github/workflows/e2e-regression.yml',
];

export const CONFIG_KEYS: readonly ConfigKeySpec[] = [
  {
    key: 'host',
    type: 'string',
    description:
      'Where production deploys (a shipped host adapter: railway, vercel, custom). Decides the host-specific workflows and checks.',
    affects: ['.github/workflows/reconcile-deployment.yml', '.github/workflows/deploy-custom.yml', '.github/workflows/post-deploy-prod.yml'],
  },
  {
    key: 'production_url_secret',
    type: 'string',
    description: 'Name of the repo secret holding the production base URL used by the post-deploy health probe and smoke checks.',
    validate: secretName,
    affects: ['.github/workflows/post-deploy-prod.yml', '.github/workflows/reconcile-deployment.yml', '.github/workflows/deploy-custom.yml'],
  },
  {
    key: 'runner',
    type: 'string',
    description:
      '"self-hosted" resolves the runner at run time from the CI_RUNNER_LABEL variable (github-ci = ubuntu-latest); any other value is a fixed runs-on label.',
    validate: nonEmpty,
    affects: ALL_WORKFLOWS,
  },
  {
    key: 'deploy_command',
    type: 'string',
    description: 'Command deploy-custom.yml runs to deploy (DEPLOY_SHA, DEPLOY_ENVIRONMENT and PROD_URL are set).',
    validate: nonEmpty,
    hosts: ['custom'],
    affects: ['.github/workflows/deploy-custom.yml'],
  },
  {
    key: 'deploy_secrets',
    type: 'string[]',
    description: 'Repo secrets passed to deploy_command as environment variables (cloud credentials, SSH key).',
    validate: (value) =>
      Array.isArray(value) && value.every((v) => typeof v === 'string' && SECRET_NAME.test(v))
        ? null
        : 'every entry must be a GitHub secret name (upper case, digits, underscores)',
    hosts: ['custom'],
    affects: ['.github/workflows/deploy-custom.yml'],
  },
  {
    key: 'deployed_sha_url',
    type: 'string',
    description: 'Endpoint returning the running commit SHA; deploy-custom.yml checks it equals the deployed SHA. Empty falls back to a health check.',
    validate: httpsUrl,
    hosts: ['custom'],
    affects: ['.github/workflows/deploy-custom.yml'],
  },
  {
    key: 'deployed_sha_jq',
    type: 'string',
    description: 'jq path to the SHA in the deployed_sha_url response (e.g. .commit); empty when the response is the SHA itself.',
    hosts: ['custom'],
    affects: ['.github/workflows/deploy-custom.yml'],
  },
  {
    key: 'deploy_trigger',
    type: 'string',
    description: 'When deploy-custom.yml deploys: push_to_main (default), git_tag (v* tags) or manual (workflow_dispatch only).',
    enum: ['push_to_main', 'git_tag', 'manual'],
    hosts: ['custom'],
    affects: ['.github/workflows/deploy-custom.yml'],
  },
  {
    key: 'integration_branch',
    type: 'string',
    description: 'Branch implementation PRs land on (GitFlow develop).',
    validate: nonEmpty,
    affects: ALL_WORKFLOWS,
  },
  {
    key: 'release_branch',
    type: 'string',
    description: 'Protected production branch the integration branch is promoted to.',
    validate: nonEmpty,
    affects: ALL_WORKFLOWS,
  },
  { key: 'node_version', type: 'string', description: 'Node.js version for CI.', validate: nonEmpty, affects: CI },
  { key: 'python_version', type: 'string', description: 'Python version for CI (stack python).', validate: nonEmpty, affects: CI },
  { key: 'working_directory', type: 'string', description: 'Directory the app lives in, relative to the repo root.', validate: nonEmpty, affects: ALL_WORKFLOWS },
  { key: 'source_dirs', type: 'string', description: 'Space-separated source directories scanned by SAST and the requirement checks.', validate: nonEmpty, affects: CI },
  { key: 'sast_baseline', type: 'integer', description: 'Number of accepted pre-existing SAST findings.', validate: nonNegative, affects: CI },
  { key: 'install_flags', type: 'string', description: 'Flags appended to npm ci (e.g. --legacy-peer-deps).', affects: CI },
  { key: 'database_service', type: 'string', description: 'CI service container for tests (e.g. mongodb, postgres); empty for none.', affects: CI },
  { key: 'database_image', type: 'string', description: 'Image for the CI database service.', affects: CI },
  { key: 'database_port', type: 'string', description: 'Port of the CI database service.', affects: CI },
  { key: 'database_env', type: 'object', description: 'Env for the CI database service.', affects: CI },
  { key: 'app_env', type: 'object', description: 'Env for tests and the app in CI.', affects: CI },
  { key: 'build_env', type: 'object', description: 'Env for the CI build step.', affects: CI },
  { key: 'typescript_check_env', type: 'object', description: 'Env for the TypeScript check step only.', affects: CI },
  { key: 'e2e_project', type: 'string', description: 'Playwright project for the blocking smoke gate.', validate: nonEmpty, affects: E2E },
  { key: 'e2e_start_command', type: 'string', description: 'Command that starts the dev server for E2E.', validate: nonEmpty, affects: E2E },
  { key: 'e2e_setup_command', type: 'string', description: 'Command run before the dev server (e.g. a disposable local database).', affects: E2E },
  { key: 'e2e_seed_command', type: 'string', description: 'Command that seeds fixtures before authenticated E2E.', affects: E2E },
  { key: 'e2e_port', type: 'integer', description: 'Port the E2E dev server listens on (default 3000).', validate: positive, affects: E2E },
  { key: 'e2e_projects', type: 'string[]', description: 'Playwright projects that need a logged-in session (report-only gate).', affects: E2E },
  { key: 'e2e_env', type: 'object', description: 'Env for E2E setup, dev server and tests.', affects: E2E },
  {
    key: 'e2e_regression_enabled',
    type: 'boolean',
    description: 'Generates the three-tier e2e-regression.yml.',
    ownedBy: 'devaudit update --enable-e2e-regression <path> / --disable-e2e-regression',
    affects: ['.github/workflows/e2e-regression.yml', '.github/workflows/compliance-evidence.yml'],
  },
  {
    key: 'e2e_regression_timeout_minutes',
    type: 'integer',
    description: 'Job timeout for e2e-regression.yml (default 55).',
    validate: positive,
    affects: ['.github/workflows/e2e-regression.yml'],
  },
  {
    key: 'e2e_concurrency_group',
    type: 'string',
    description: 'Fixed concurrency group for e2e-regression.yml when specs mutate a shared backend; empty for the default.',
    affects: ['.github/workflows/e2e-regression.yml'],
  },
  {
    key: 'e2e_concurrency_cancel_in_progress',
    type: 'boolean',
    description: 'cancel-in-progress for the fixed e2e concurrency group (default false).',
    affects: ['.github/workflows/e2e-regression.yml'],
  },
  {
    key: 'test_tier_smoke',
    type: 'string',
    description: 'Command for the smoke tier, run from the working directory. Unset runs the Playwright project in e2e_project (pytest -m smoke for test_runner pytest).',
    validate: shellCommand,
    affects: TIERS,
  },
  {
    key: 'test_tier_critical',
    type: 'string',
    description: 'Command for the critical tier (smoke plus must-not-break journeys). Unset runs the critical Playwright project, falling back to smoke.',
    validate: shellCommand,
    affects: TIERS,
  },
  {
    key: 'test_tier_full',
    type: 'string',
    description: 'Command for the full tier (everything in the integration/E2E suite). Unset runs the regression Playwright project.',
    validate: shellCommand,
    affects: TIERS,
  },
  {
    key: 'test_feature_command',
    type: 'string',
    description: 'Command for the feature scope (tests tagged with the branch requirement); {REQ} is replaced with the id. Unset greps Playwright specs for the id.',
    validate: featureCommand,
    affects: ['.github/workflows/feature-e2e.yml'],
  },
  {
    key: 'test_runner',
    type: 'string',
    description: 'Runner the tier defaults come from: playwright (default) or pytest.',
    enum: ['playwright', 'pytest'],
    affects: TIERS,
  },
  {
    key: 'release_gate_tier',
    type: 'string',
    description: 'E2E tier that must pass on the PR into the release branch: none, smoke, critical or full. Unset keeps critical when e2e_regression_enabled. Setting it also reports the gate to the portal.',
    enum: ['none', 'smoke', 'critical', 'full'],
    affects: RELEASE_GATE,
  },
  {
    key: 'post_deploy_full_regression',
    type: 'boolean',
    description: 'Run the full regression after a successful production deployment (default true when e2e_regression_enabled).',
    affects: ['.github/workflows/e2e-regression.yml'],
  },
  {
    key: 'scheduled_full_regression',
    type: 'string',
    description: 'Cron expression (five fields) that runs the full regression on the integration branch; empty for no schedule. A scheduled run is not release evidence and never blocks approval.',
    validate: cronOrEmpty,
    affects: ['.github/workflows/e2e-regression.yml'],
  },
  { key: 'paths_ignore', type: 'string[]', description: 'Paths that do not trigger CI on push.', affects: CI },
];

export function findConfigKey(key: string): ConfigKeySpec | undefined {
  return CONFIG_KEYS.find((spec) => spec.key === key);
}

/**
 * Parse and validate a raw value for a key exactly as `devaudit configure set`
 * does (type, allowed values, per-key rules), without the repo-evidence checks.
 * Used by `devaudit install` flags.
 */
export function validateConfigKeyValue(key: string, raw: string): { value?: unknown; error?: string } {
  const spec = findConfigKey(key);
  if (!spec) return { error: `unknown key \`${key}\`` };
  const parsed = parseConfigValue(spec, raw);
  if (parsed.error !== undefined) return { error: parsed.error };
  if (spec.enum && !spec.enum.includes(String(parsed.value))) return { error: `must be one of ${spec.enum.join(', ')}` };
  const problem = spec.validate?.(parsed.value);
  if (problem) return { error: problem };
  return { value: parsed.value };
}

/**
 * Parse a command-line value into the key's type. `string[]` accepts a JSON
 * array or a comma-separated list; `object` needs a JSON object.
 */
export function parseConfigValue(spec: ConfigKeySpec, raw: string): { value?: unknown; error?: string } {
  switch (spec.type) {
    case 'string':
      return { value: raw };
    case 'integer': {
      if (!/^-?\d+$/.test(raw.trim())) return { error: 'must be a whole number' };
      return { value: Number(raw.trim()) };
    }
    case 'boolean': {
      const v = raw.trim().toLowerCase();
      if (v === 'true') return { value: true };
      if (v === 'false') return { value: false };
      return { error: 'must be true or false' };
    }
    case 'string[]': {
      const t = raw.trim();
      if (t.startsWith('[')) {
        try {
          const parsed: unknown = JSON.parse(t);
          if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) return { value: parsed };
        } catch {
          // fall through
        }
        return { error: 'must be a JSON array of strings, or a comma-separated list' };
      }
      return { value: t === '' ? [] : t.split(',').map((v) => v.trim()).filter((v) => v !== '') };
    }
    case 'object': {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { value: parsed };
      } catch {
        // fall through
      }
      return { error: 'must be a JSON object, e.g. {"NODE_ENV":"test"}' };
    }
  }
}
