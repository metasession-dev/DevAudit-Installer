import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { exists, isDir, ensureDir } from '../lib/fs-utils.js';
import { substituteTokens, substituteBlocks, stripServicesBlock } from '../lib/templates.js';
import { resolveTargets, type Target } from '../lib/sdlc-config.js';
import type { SyncContext, SectionResult } from './types.js';

const CI_TEMPLATES = [
  'ci.yml.template',
  'ci-status-fallback.yml.template',
  // DevAudit-Installer#280: same-SHA provenance check on PRs to main.
  // Verifies prior Quality Gates success without rerunning heavy CI.
  'quality-gates-provenance.yml.template',
  'compliance-validation.yml.template',
  'check-release-approval.yml.template',
  'post-deploy-prod.yml.template',
  'reconcile-deployment.yml.template',
  'compliance-evidence.yml.template',
  'feature-e2e.yml.template',
  'close-out-release.yml.template',
  'close-out-completion.yml.template',
  // DevAudit-Installer#98 WS3: quarterly cron → auto-PR with the
  // periodic-review.md regenerated from local stats.
  'periodic-review.yml.template',
  // DevAudit-Installer#98 WS4: fires on `label:incident` issue close →
  // auto-PR with the issue exported to compliance/governance/.
  'incident-export.yml.template',
  // DevAudit-Installer#210: enforces the `incident` label survives to
  // issue close so incident-export.yml fires and evidence lands on the portal.
  'label-retention.yml.template',
];

const OLD_WORKFLOWS_TO_REMOVE = ['test-on-pr.yml', 'check-uat-approval.yml'];

interface SdlcConfig {
  readonly project_slug: string;
  readonly production_url_secret: string;
  readonly integration_branch?: string;
  readonly release_branch?: string;
  readonly node_version?: string | number;
  readonly python_version?: string | number;
  readonly working_directory?: string;
  readonly runner: string;
  readonly source_dirs: string;
  readonly sast_baseline: number | string;
  readonly accepted_dep_risks: string;
  readonly database_service: string;
  readonly database_image: string;
  readonly database_port: string;
  readonly database_env?: Readonly<Record<string, string>>;
  readonly app_env?: Readonly<Record<string, string>>;
  readonly build_env?: Readonly<Record<string, string>>;
  readonly e2e_project: string;
  readonly e2e_start_command: string;
  // Optional pre-E2E setup command (foreground, blocking) run before the dev
  // server starts — e.g. `supabase start` + load schema + seed for a disposable
  // local database. Multi-line allowed. Absent → no setup step rendered.
  readonly e2e_setup_command?: string;
  // Authenticated e2e (report-only). Optional; absent → no extra step rendered.
  readonly e2e_seed_command?: string;
  readonly e2e_projects?: readonly string[];
  // Env applied to the E2E setup step, the (blocking) dev-server step, and the
  // blocking + report-only E2E test steps. Use it to point E2E at a local stack
  // (e.g. E2E_LOCAL=1 + local Supabase coords + a dummy email key), overriding
  // the job-level remote secrets so tests never touch production.
  readonly e2e_env?: Readonly<Record<string, string>>;
  readonly paths_ignore?: readonly string[];
  /** See #689/#690 — when present, sync runs once per target instead of once for the flat config. */
  readonly targets?: readonly Target[];
}

/**
 * Resolve a target's effective working directory, falling back to the flat
 * config's working_directory, treating '.' / empty as "repo root" (i.e. not a
 * scopeable subtree). Shared by the trigger-scoping logic in #693.
 */
function resolveTargetWorkingDir(target: Target, cfg: SdlcConfig): string {
  if (target.working_directory && target.working_directory !== '.') return target.working_directory;
  if (cfg.working_directory && cfg.working_directory !== '.') return cfg.working_directory;
  return '';
}

/**
 * Namespace a rendered workflow's filename and internal check/job names for a
 * given target, so two targets in one repo don't collide on `ci.yml` /
 * `Quality Gates` etc (#692). No-ops (returns content/name unchanged) when
 * there's only one target, so single-target consumers regenerate byte-for-byte
 * identical output.
 */
function namespaceForTarget(outputName: string, content: string, target: Target, multiTarget: boolean) {
  if (!multiTarget) return { outputName, content };
  const suffix = ` (${target.name})`;
  const namespacedName = outputName.replace(/\.yml$/, `-${target.name}.yml`);
  let namespacedContent = content;
  // "Quality Gates" is the one check name shared verbatim across ci.yml,
  // ci-status-fallback.yml, and quality-gates-provenance.yml (branch
  // protection matches on it, and the workflows cross-reference it by exact
  // string in --workflow-name/--label script args) — namespace every
  // occurrence so the three stay consistent for a given target. Do this
  // FIRST: it also covers the "name: Quality Gates" workflow/job title
  // lines, so the generic title regexes below must not re-suffix them.
  namespacedContent = namespacedContent.split('Quality Gates').join(`Quality Gates${suffix}`);
  const alreadySuffixed = (title: string) => title.endsWith(suffix);
  // Workflow-level `name:` (column 0 only — job/step names are indented).
  namespacedContent = namespacedContent.replace(/^name: (.+)$/m, (m: string, title: string) =>
    alreadySuffixed(title) ? m : `name: ${title}${suffix}`,
  );
  // Job-level `name:` (4-space indent, not a `- name:` step entry).
  namespacedContent = namespacedContent.replace(/^ {4}name: (.+)$/gm, (m: string, title: string) =>
    alreadySuffixed(title) ? m : `    name: ${title}${suffix}`,
  );
  return { outputName: namespacedName, content: namespacedContent };
}

function indentEnvBlock(env: Record<string, string>, indent: number): string {
  const pad = ' '.repeat(indent);
  return Object.entries(env)
    .map(([k, v]) => `${pad}${k}: ${v}`)
    .join('\n');
}

/**
 * Build the optional pre-E2E setup step (foreground, blocking) injected before
 * the dev server starts. Renders only when e2e_setup_command is set, so existing
 * projects regenerate an identical ci.yml. Carries e2e_env so the setup command
 * (e.g. `supabase start` + schema load + seed) sees the local-stack coords.
 * A multi-line command is emitted as a `run: |` block scalar.
 */
function buildE2eSetupStep(cfg: SdlcConfig): string {
  const cmd = (cfg.e2e_setup_command ?? '').trim();
  if (!cmd) return '';
  const env = cfg.e2e_env ?? {};
  const lines = ['      - name: E2E setup'];
  if (Object.keys(env).length > 0) lines.push('        env:', indentEnvBlock({ ...env }, 10));
  if (cmd.includes('\n')) {
    lines.push('        run: |');
    for (const l of cmd.split('\n')) lines.push(`          ${l}`);
  } else {
    lines.push(`        run: ${cmd}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Build the blocking "Start dev server" step. Rebuilt in code (rather than left
 * inline in the template) so e2e_env can be threaded onto the dev-server process
 * — overriding the job-level remote secrets so the server talks to the local
 * stack. With no e2e_env the output is identical to the previous inline step.
 */
function buildE2eDevServerStep(cfg: SdlcConfig): string {
  const env = cfg.e2e_env ?? {};
  const lines = ['      - name: Start dev server'];
  if (Object.keys(env).length > 0) lines.push('        env:', indentEnvBlock({ ...env }, 10));
  // e2e_start_command is '' on every fresh install (no prompt collects it —
  // it's a deliberate post-install manual edit) — `run: <empty> &` is a bare
  // `&`, which YAML parses as the start of an anchor name and rejects as
  // invalid (anchor cannot be empty), breaking ci.yml for every consumer
  // before they've configured it. Fall back to a harmless no-op so the
  // workflow stays valid YAML (it'll just fail the "Wait for dev server"
  // step below at runtime, same as any other misconfiguration, instead of
  // never parsing at all).
  const startCommand = (cfg.e2e_start_command ?? '').trim() || 'true';
  lines.push(`        run: ${startCommand} &`);
  return lines.join('\n');
}

/**
 * Build the blocking "E2E Tests" step. Rebuilt in code so e2e_env can be threaded
 * onto the Playwright process (specs read it to reach the local stack directly).
 * With no e2e_env the output is identical to the previous inline step, comment
 * and all.
 */
function buildE2eTestStep(cfg: SdlcConfig): string {
  const env = cfg.e2e_env ?? {};
  const lines = [
    '      - name: E2E Tests',
    '        env:',
    '          # PLAYWRIGHT_JSON_OUTPUT_NAME makes the json reporter write straight',
    '          # to the file. Capturing stdout (`> e2e-results.json`) instead mixed',
    '          # the html reporter\'s "To open report" line in after the JSON blob',
    '          # and produced an unparseable file (DevAudit #48). html report still',
    '          # lands in playwright-report/.',
    '          PLAYWRIGHT_HTML_REPORTER_OPEN: never',
    '          PLAYWRIGHT_JSON_OUTPUT_NAME: e2e-results.json',
  ];
  if (Object.keys(env).length > 0) lines.push(indentEnvBlock({ ...env }, 10));
  lines.push(`        run: npx playwright test --project=${cfg.e2e_project} --reporter=json,html`);
  return lines.join('\n');
}

/**
 * Build the optional "authenticated e2e" steps injected after the blocking
 * smoke e2e gate. Report-only by design (continue-on-error): authenticated
 * flows (auth-setup + seeded fixtures) are flakier than smoke, so failures
 * surface as evidence without blocking the merge until proven stable. Renders
 * empty (no step) unless the consumer configures e2e_projects and/or
 * e2e_seed_command — so existing projects regenerate to an identical ci.yml.
 */
function buildAuthenticatedE2eStep(cfg: SdlcConfig): string {
  const projects = cfg.e2e_projects ?? [];
  const seed = (cfg.e2e_seed_command ?? '').trim();
  if (projects.length === 0 && !seed) return '';
  const env = cfg.e2e_env ?? {};
  const envBlock = Object.keys(env).length > 0 ? indentEnvBlock({ ...env }, 10) : '';
  const lines: string[] = [];
  if (seed) {
    lines.push(
      '',
      '      - name: Seed E2E test data (report-only)',
      '        if: always()',
      '        continue-on-error: true',
    );
    if (envBlock) lines.push('        env:', envBlock);
    lines.push(`        run: ${seed}`);
  }
  if (projects.length > 0) {
    const flags = projects.map((p) => `--project=${p}`).join(' ');
    lines.push(
      '',
      '      - name: Authenticated E2E (report-only)',
      '        if: always()',
      '        continue-on-error: true',
      '        env:',
      '          PLAYWRIGHT_HTML_REPORTER_OPEN: never',
      '          PLAYWRIGHT_JSON_OUTPUT_NAME: e2e-auth-results.json',
    );
    if (envBlock) lines.push(envBlock);
    lines.push(`        run: npx playwright test ${flags} --reporter=json,html`);
  }
  return lines.join('\n');
}

/**
 * Build the "Run in-scope E2E" step for feature-e2e.yml. Mirrors
 * buildE2eTestStep (same env wiring for e2e_env + JSON reporter) but uses
 * `--grep "$REQ_ID"` to run only the specs tagged with the branch's REQ,
 * instead of `--project=` which runs the full suite. The REQ_ID shell
 * variable is populated from the detect-req job output at runtime.
 */
function buildFeatureE2eTestStep(cfg: SdlcConfig): string {
  const env = cfg.e2e_env ?? {};
  const lines = [
    '      - name: Run in-scope E2E',
    '        env:',
    '          PLAYWRIGHT_HTML_REPORTER_OPEN: never',
    '          PLAYWRIGHT_JSON_OUTPUT_NAME: e2e-results.json',
  ];
  if (Object.keys(env).length > 0) lines.push(indentEnvBlock({ ...env }, 10));
  lines.push('        run: |');
  lines.push('          REQ_ID="${{ needs.detect-req.outputs.req_id }}"');
  lines.push('          npx playwright test --grep "$REQ_ID" --reporter=json,html');
  return lines.join('\n');
}

function buildDbUriStep(dbService: string, dbPort: string): string {
  if (dbService !== 'mongodb') return '';
  return [
    '      - name: Set database URI from dynamic port',
    '        run: |',
    `          DB_PORT="\${{ job.services.${dbService}.ports['${dbPort}'] }}"`,
    '          echo "MONGODB_WAWAGARDENBAR_APP_URI=mongodb://localhost:${DB_PORT}" >> "$GITHUB_ENV"',
    '          echo "Database on port: ${DB_PORT}"',
  ].join('\n');
}

/**
 * `runner: "self-hosted"` in sdlc-config.json is the local opt-in to
 * runtime, GitHub-Actions-variable-driven runner selection (the name
 * predates DevAudit#803's github-ci/ostendo-* taxonomy — it now means
 * "resolve dynamically", not literally "always self-hosted"). Any other
 * `runner` value is a static, config-owned override and bypasses
 * CI_RUNNER_LABEL entirely, per the config-is-source-of-truth contract in
 * docs/articles/sdlc-config-ci-persistence-long-form.md.
 *
 * The dynamic branch implements the DevAudit-Installer#664 / DevAudit#803
 * runner interface: CI_RUNNER_LABEL's effective value (repo variable, or
 * organization variable if the repo one is unset, or the system default
 * `github-ci` if neither is set — precedence resolved natively by GitHub
 * Actions, including personal-account repos with no organization tier) is
 * mapped through this table:
 *
 *   github-ci              -> ubuntu-latest   (logical selector)
 *   ostendo-workhorse-ci   -> ostendo-workhorse-ci   (passed through)
 *   ostendo-laptop2-ci     -> ostendo-laptop2-ci     (passed through)
 *   (missing/blank)        -> ubuntu-latest   (safe fallback — NOT the
 *                              literal 'self-hosted' label, which would
 *                              hang the job waiting for a runner that may
 *                              not exist)
 */
function resolveRunner(cfg: SdlcConfig): string {
  if (cfg.runner !== 'self-hosted') return cfg.runner;
  const label = "(inputs.runner_label || vars.CI_RUNNER_LABEL || 'github-ci')";
  return `\${{ ${label} == 'github-ci' && 'ubuntu-latest' || ${label} }}`;
}

/**
 * Section 2f: Generate CI workflows from templates + sdlc-config.json.
 *
 * Skipped if the consumer has no sdlc-config.json or no .github/workflows/.
 */
export async function syncCiTemplates(ctx: SyncContext): Promise<SectionResult> {
  const configPath = join(ctx.projectPath, 'sdlc-config.json');
  // GitHub Actions only reads .github/workflows/ from the repo root, never
  // from a target's own subdirectory — repoRoot === projectPath for a
  // single-target repo, so this is unchanged there. See #689 follow-up.
  const workflowsDir = join(ctx.repoRoot, '.github', 'workflows');
  if (!(await exists(configPath))) {
    return { name: 'CI workflows', filesSynced: 0, skipped: true, message: 'no sdlc-config.json' };
  }
  if (!(await isDir(workflowsDir))) {
    return { name: 'CI workflows', filesSynced: 0, skipped: true, message: '.github/workflows/ not found' };
  }
  await ensureDir(workflowsDir);
  const cfg = JSON.parse(await fs.readFile(configPath, 'utf-8')) as SdlcConfig;
  for (const oldName of OLD_WORKFLOWS_TO_REMOVE) {
    const oldPath = join(workflowsDir, oldName);
    if (await exists(oldPath)) await fs.rm(oldPath);
  }

  const targets = resolveTargets(cfg);
  const multiTarget = targets.length > 1;
  let count = 0;
  const filePaths: string[] = [];

  // Each target's own working_directory, in target order — used below to scope
  // out *other* targets' subtrees from a target's triggers (#693), so an
  // unrelated target's commit doesn't fire this target's pipeline. Root/empty
  // working directories are left out: a root target can't be meaningfully
  // path-scoped away from (it would have to exclude everything), so any target
  // sharing a repo with a root target keeps unscoped triggers against it.
  const allWorkingDirs = targets.map((t) => resolveTargetWorkingDir(t, cfg));

  for (let targetIdx = 0; targetIdx < targets.length; targetIdx += 1) {
    const target = targets[targetIdx]!;
    const projectSlug = target.devaudit?.project_slug ?? cfg.project_slug;
    const productionUrlSecret = target.production_url_secret ?? cfg.production_url_secret;
    const workingDirectory = allWorkingDirs[targetIdx]!;
    const workingDirPrefix = workingDirectory ? `${workingDirectory.replace(/\/$/, '')}/` : '';
    // Other targets' directories to scope this target's triggers away from.
    // Only meaningful when this target itself has a real (non-root) working
    // directory — see comment on allWorkingDirs above.
    const otherTargetDirs =
      multiTarget && workingDirectory
        ? allWorkingDirs.filter((d, i) => i !== targetIdx && d !== '').map((d) => `${d.replace(/\/$/, '')}/**`)
        : [];
    const sourceDirs = target.source_dirs ?? cfg.source_dirs;
    const stack = target.stack ?? ctx.stack;

    const tokens: Record<string, string> = {
      PROJECT_SLUG: projectSlug,
      PRODUCTION_URL_SECRET: productionUrlSecret,
      INTEGRATION_BRANCH: cfg.integration_branch ?? 'develop',
      RELEASE_BRANCH: cfg.release_branch ?? 'main',
      NODE_VERSION: String(cfg.node_version ?? ''),
      PYTHON_VERSION: String(cfg.python_version ?? ''),
      WORKING_DIRECTORY: workingDirectory || '.',
      WORKING_DIR_PREFIX: workingDirPrefix,
      RUNNER: resolveRunner(cfg),
      SOURCE_DIRS: sourceDirs,
      SAST_BASELINE: String(cfg.sast_baseline),
      ACCEPTED_DEP_RISKS: cfg.accepted_dep_risks,
      DATABASE_SERVICE: cfg.database_service,
      DATABASE_IMAGE: cfg.database_image,
      DATABASE_PORT: cfg.database_port,
      E2E_PROJECT: cfg.e2e_project,
      E2E_START_COMMAND: cfg.e2e_start_command,
    };
    // otherTargetDirs is appended here (not just to PATHS_IGNORE's push
    // consumer) because ci-status-fallback.yml.template reuses the exact same
    // {{PATHS_IGNORE}} block as its *inclusion* `paths:` filter (it fires on
    // exactly what ci.yml's push ignores, to satisfy branch protection on
    // docs-only commits) — extending the shared list keeps both templates'
    // triggers consistent for a given target without touching that template.
    const pathsIgnoreBlock = [...(cfg.paths_ignore ?? []), ...otherTargetDirs]
      .map((p) => `      - '${p}'`)
      .join('\n');
    // pull_request had no paths filter at all before #693 — only emit one
    // when this target actually has other targets' subtrees to scope away
    // from, so single-target repos (and multi-target repos where every other
    // target has already been filtered out above) regenerate byte-identical.
    const prPathsIgnoreBlock =
      otherTargetDirs.length > 0 ? `    paths-ignore:\n${otherTargetDirs.map((p) => `      - '${p}'`).join('\n')}` : '';
    const blocks: Record<string, string> = {
      PATHS_IGNORE: pathsIgnoreBlock,
      PR_PATHS_IGNORE: prPathsIgnoreBlock,
      DATABASE_ENV: cfg.database_env ? indentEnvBlock({ ...cfg.database_env }, 6) : '',
      APP_ENV: cfg.app_env ? indentEnvBlock({ ...cfg.app_env }, 6) : '',
      // Unlike DATABASE_ENV/APP_ENV (both followed by more hardcoded env
      // lines in the job-level `env:` block, so an empty result there is
      // harmless), the Build Check step's `env:` key has ONLY this block as
      // content — the template no longer hardcodes `env:` above it, so this
      // must supply its own header, and only when there's something to put
      // under it, or `env:` with nothing after is invalid YAML.
      BUILD_ENV:
        cfg.build_env && Object.keys(cfg.build_env).length > 0
          ? `        env:\n${indentEnvBlock({ ...cfg.build_env }, 10)}`
          : '',
      DATABASE_URI_STEP: buildDbUriStep(cfg.database_service, cfg.database_port),
      E2E_SETUP_STEP: buildE2eSetupStep(cfg),
      E2E_DEV_SERVER_STEP: buildE2eDevServerStep(cfg),
      E2E_TEST_STEP: buildE2eTestStep(cfg),
      E2E_FEATURE_TEST_STEP: buildFeatureE2eTestStep(cfg),
      E2E_AUTHENTICATED_STEP: buildAuthenticatedE2eStep(cfg),
    };

    for (const tmpl of CI_TEMPLATES) {
      const stackTmpl = join(ctx.installerRoot, 'sdlc', 'files', 'ci', stack, tmpl);
      const defaultTmpl = join(ctx.installerRoot, 'sdlc', 'files', 'ci', tmpl);
      let tmplPath: string;
      if (await exists(stackTmpl)) {
        tmplPath = stackTmpl;
      } else if (await exists(defaultTmpl)) {
        tmplPath = defaultTmpl;
      } else {
        continue;
      }
      let content = await fs.readFile(tmplPath, 'utf-8');
      content = substituteTokens(content, tokens);
      content = substituteBlocks(content, blocks);
      if (!cfg.database_service) {
        content = stripServicesBlock(content);
      }
      const baseOutputName = tmpl.replace(/\.template$/, '');
      const namespaced = namespaceForTarget(baseOutputName, content, target, multiTarget);
      const outputPath = join(workflowsDir, namespaced.outputName);
      await fs.writeFile(outputPath, namespaced.content);
      filePaths.push(outputPath);
      count += 1;
    }
  }
  return { name: 'CI workflows', filesSynced: count, message: `${count} generated`, filePaths };
}
