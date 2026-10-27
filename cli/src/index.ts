import { Command, Option } from 'commander';
import { configureLogger } from './lib/logger.js';
import { CLI_VERSION } from './lib/version.js';
import { runDoctor } from './commands/doctor.js';
import { runFleetDoctor } from './commands/fleet.js';
import { runReleaseCheck } from './commands/release-check.js';
import { runAuthLogin } from './commands/auth/login.js';
import { runAuthLogout } from './commands/auth/logout.js';
import { runAuthStatus } from './commands/auth/status.js';
import { runStatus } from './commands/status.js';
import { runPush } from './commands/push.js';
import { runInstallCommand } from './commands/install.js';
import { runUninstallCommand } from './commands/uninstall.js';
import { runJoinCommand } from './commands/join.js';
import { runUpdate } from './commands/update.js';
import { runBootstrapGovernance } from './commands/bootstrap-governance.js';
import { makeStub } from './commands/stub.js';
import { runConfigureList, runConfigureGet, runConfigureSet, runConfigureSecret } from './commands/configure.js';
import { discoverPlugins, registerPluginCommands } from './lib/plugin/index.js';
import { runPluginList } from './commands/plugin/list.js';
import { runPluginInstall } from './commands/plugin/install.js';
import { runPluginRemove } from './commands/plugin/remove.js';
import { runPluginUpdate } from './commands/plugin/update.js';
import { logger } from './lib/logger.js';

const TRACKING_ISSUE = 'https://github.com/metasession-dev/DevAudit-Installer/issues/1';

function applyCommonFlags(program: Command): void {
  program.addOption(new Option('--json', 'machine-readable output'));
  program.addOption(new Option('-y, --yes', 'accept all interactive defaults (CI-friendly)'));
  program.addOption(new Option('--dry-run', "preview, don't mutate"));
  program.addOption(new Option('-v, --verbose', 'extra detail'));
  program.addOption(new Option('--no-color', 'strip ANSI'));
  program.addOption(new Option('--org <slug>', 'override active org context for this invocation'));
  program.hook('preAction', (cmd) => {
    const opts = cmd.optsWithGlobals();
    configureLogger({
      json: Boolean(opts.json),
      verbose: Boolean(opts.verbose),
      noColor: opts.color === false,
    });
  });
}

export async function main(argv: readonly string[]): Promise<void> {
  const program = new Command();
  program
    .name('devaudit')
    .description(
      'DevAudit CLI — installs, syncs, and operates the Metasession SDLC across consumer projects.',
    )
    .version(CLI_VERSION, '-V, --version');
  applyCommonFlags(program);
  program
    .command('install [path]')
    .description('Interactive onboarding for a consumer project (operator flow). On an already-onboarded project a second dev auto-routes to developer mode; use `devaudit join` for the explicit second-dev entry point.')
    .option('--token <token>', 'PAT to use (otherwise reads DEVAUDIT_USER_TOKEN env or ~/.config/devaudit/auth.json)')
    .option('--base-url <url>', 'override portal URL (defaults to DEVAUDIT_BASE_URL env or production)')
    .option('--force-team-config', 'Re-run the destructive steps (write sdlc-config, issue API key, set GH secrets, apply branch protection) even when dev-mode detection would have skipped them. The operator-only rotation lane.')
    .option(
      '--add-target',
      'DEPRECATED, scheduled for removal: append this install as a new target in an already-configured (polyglot monorepo) repo. Refuses for any repo that does not already have a `targets` array — no new adoption. See docs/onboarding.md#polyglot-monorepos-multiple-targets-in-one-repo--deprecated.',
    )
    .option(
      '--with-viewer-key',
      'Also issue a read-only viewer-role API key (DEVAUDIT_VIEWER_API_KEY) for agent/CI read-back queries against release/check/cycle state. Never grants upload or approval rights. See #867.',
    )
    .option(
      '--host <name>',
      'Deploy host adapter: railway (default), vercel, custom (AWS / self-hosted / anything), or any adapter under sdlc/files/hosts/. Defaults to the host already in sdlc-config.json. See docs/adding-a-host.md.',
    )
    .option(
      '--release-gate-tier <tier>',
      'E2E tier that must pass on the PR into the release branch: none, smoke, critical or full. Omit to keep today\'s behaviour (critical). Needs e2e_regression_enabled. See docs/e2e-test-tiers.md.',
    )
    .option(
      '--post-deploy-full-regression <true|false>',
      'Run the full regression after a successful production deployment (default true when e2e_regression_enabled).',
    )
    .option(
      '--scheduled-full-regression <cron>',
      'Cron expression (five fields) for a scheduled full regression on the integration branch, e.g. "0 3 * * *".',
    )
    .option('--test-runner <runner>', 'Runner the test tier defaults come from: playwright (default) or pytest.')
    .option('--test-tier-smoke <command>', 'Command for the smoke tier (single line). Omit to keep the runner default.')
    .option('--test-tier-critical <command>', 'Command for the critical tier (single line). Omit to keep the runner default.')
    .option('--test-tier-full <command>', 'Command for the full tier (single line). Omit to keep the runner default.')
    .option('--test-feature-command <command>', 'Command for the feature scope; {REQ} is replaced with the requirement id.')
    .action(
      async (
        path: string | undefined,
        cmdOpts: {
          token?: string;
          baseUrl?: string;
          forceTeamConfig?: boolean;
          addTarget?: boolean;
          withViewerKey?: boolean;
          host?: string;
          releaseGateTier?: string;
          postDeployFullRegression?: string;
          scheduledFullRegression?: string;
          testRunner?: string;
          testTierSmoke?: string;
          testTierCritical?: string;
          testTierFull?: string;
          testFeatureCommand?: string;
        },
        cmd,
      ) => {
        const globals = cmd.optsWithGlobals();
        await runInstallCommand({
          ...(path !== undefined ? { path } : {}),
          ...(cmdOpts.token !== undefined ? { token: cmdOpts.token } : {}),
          ...(cmdOpts.baseUrl !== undefined ? { baseUrl: cmdOpts.baseUrl } : {}),
          ...(cmdOpts.forceTeamConfig !== undefined
            ? { forceTeamConfig: Boolean(cmdOpts.forceTeamConfig) }
            : {}),
          ...(cmdOpts.addTarget !== undefined ? { addTarget: Boolean(cmdOpts.addTarget) } : {}),
          ...(cmdOpts.withViewerKey !== undefined
            ? { withViewerKey: Boolean(cmdOpts.withViewerKey) }
            : {}),
          ...(cmdOpts.host !== undefined ? { host: cmdOpts.host } : {}),
          testOptions: {
            ...(cmdOpts.releaseGateTier !== undefined ? { release_gate_tier: cmdOpts.releaseGateTier } : {}),
            ...(cmdOpts.postDeployFullRegression !== undefined ? { post_deploy_full_regression: cmdOpts.postDeployFullRegression } : {}),
            ...(cmdOpts.scheduledFullRegression !== undefined ? { scheduled_full_regression: cmdOpts.scheduledFullRegression } : {}),
            ...(cmdOpts.testRunner !== undefined ? { test_runner: cmdOpts.testRunner } : {}),
            ...(cmdOpts.testTierSmoke !== undefined ? { test_tier_smoke: cmdOpts.testTierSmoke } : {}),
            ...(cmdOpts.testTierCritical !== undefined ? { test_tier_critical: cmdOpts.testTierCritical } : {}),
            ...(cmdOpts.testTierFull !== undefined ? { test_tier_full: cmdOpts.testTierFull } : {}),
            ...(cmdOpts.testFeatureCommand !== undefined ? { test_feature_command: cmdOpts.testFeatureCommand } : {}),
          },
          ...(globals.dryRun !== undefined ? { dryRun: Boolean(globals.dryRun) } : {}),
          ...(globals.yes !== undefined ? { yes: Boolean(globals.yes) } : {}),
        });
      },
    );
  program
    .command('uninstall [path]')
    .description(
      "Disconnect a repo from a DevAudit project: revokes its API key(s), deletes the GitHub secrets/variables `install` wrote, and removes it from sdlc-config.json. Leaves branch protection and synced CI/SDLC files in place (now inert) — clean those up manually or re-run `devaudit install` to onboard a fresh project.",
    )
    .option(
      '--token <token>',
      'PAT to use (otherwise reads DEVAUDIT_USER_TOKEN env or ~/.config/devaudit/auth.json)',
    )
    .option(
      '--base-url <url>',
      "override portal URL (defaults to the target's stored devaudit.base_url, then production)",
    )
    .option(
      '--target <name>',
      'which target to disconnect, when sdlc-config.json configures more than one (polyglot monorepo, #689)',
    )
    .action(
      async (
        path: string | undefined,
        cmdOpts: { token?: string; baseUrl?: string; target?: string },
        cmd,
      ) => {
        const globals = cmd.optsWithGlobals();
        await runUninstallCommand({
          ...(path !== undefined ? { path } : {}),
          ...(cmdOpts.token !== undefined ? { token: cmdOpts.token } : {}),
          ...(cmdOpts.baseUrl !== undefined ? { baseUrl: cmdOpts.baseUrl } : {}),
          ...(cmdOpts.target !== undefined ? { target: cmdOpts.target } : {}),
          ...(globals.dryRun !== undefined ? { dryRun: Boolean(globals.dryRun) } : {}),
          ...(globals.yes !== undefined ? { yes: Boolean(globals.yes) } : {}),
        });
      },
    );
  program
    .command('join [path]')
    .description(
      'Second-developer entry point: re-sync framework templates + run hook bootstrap locally on an already-onboarded project. Skips the operator-only steps (sdlc-config write, API key issuance, GitHub secret writes, branch protection) so the team CI token is never rotated. See SDLC/joining-an-existing-project.md.',
    )
    .option(
      '--token <token>',
      'PAT to use (otherwise reads DEVAUDIT_USER_TOKEN env or ~/.config/devaudit/auth.json)',
    )
    .option(
      '--base-url <url>',
      'override portal URL (defaults to DEVAUDIT_BASE_URL env or production)',
    )
    .action(async (path: string | undefined, cmdOpts: { token?: string; baseUrl?: string }, cmd) => {
      const globals = cmd.optsWithGlobals();
      await runJoinCommand({
        ...(path !== undefined ? { path } : {}),
        ...(cmdOpts.token !== undefined ? { token: cmdOpts.token } : {}),
        ...(cmdOpts.baseUrl !== undefined ? { baseUrl: cmdOpts.baseUrl } : {}),
        ...(globals.dryRun !== undefined ? { dryRun: Boolean(globals.dryRun) } : {}),
        ...(globals.yes !== undefined ? { yes: Boolean(globals.yes) } : {}),
      });
    });
  program
    .command('update [version] [paths...]')
    .description(
      'Sync framework templates into existing consumer(s). Both args are optional: ' +
        'paths default to the current directory, and version is a cosmetic label ' +
        '(defaults to the running CLI version). So a bare `devaudit update` syncs ' +
        'the current project.',
    )
    .option(
      '--enable-e2e-regression',
      'set e2e_regression_enabled: true in sdlc-config.json before syncing (devaudit-installer#876)',
    )
    .option(
      '--disable-e2e-regression',
      'set e2e_regression_enabled: false in sdlc-config.json before syncing (devaudit-installer#876)',
    )
    // commander passes (…declared-args, optionsObject, command). `update` has
    // two declared args, so the Command is the FOURTH parameter — the options
    // object sits third. Binding `cmd` to the third param made
    // `cmd.optsWithGlobals()` throw (DevAudit-Installer#162).
    .action(async (version: string | undefined, paths: string[] | undefined, _options, cmd) => {
      // `version` is purely informational. Disambiguate the single-arg case so
      // `devaudit update <path>` treats a path-like token as a path, not a label.
      let resolvedVersion = version;
      let resolvedPaths = paths ?? [];
      const looksLikeVersion = (s: string): boolean => /^v?\d+(\.\d+)/.test(s);
      if (resolvedVersion && resolvedPaths.length === 0 && !looksLikeVersion(resolvedVersion)) {
        resolvedPaths = [resolvedVersion];
        resolvedVersion = undefined;
      }
      if (resolvedPaths.length === 0) resolvedPaths = ['.'];
      const globals = cmd.optsWithGlobals();
      // Mutual-exclusion + config-flip validation lives in runUpdate itself
      // (mirrors runPush's own validation style), not here — so it's
      // exercised the same way whether invoked via commander or directly.
      await runUpdate({
        version: resolvedVersion ?? CLI_VERSION,
        paths: resolvedPaths,
        ...(globals.dryRun !== undefined ? { dryRun: Boolean(globals.dryRun) } : {}),
        ...(globals.enableE2eRegression !== undefined
          ? { enableE2eRegression: Boolean(globals.enableE2eRegression) }
          : {}),
        ...(globals.disableE2eRegression !== undefined
          ? { disableE2eRegression: Boolean(globals.disableE2eRegression) }
          : {}),
      });
    });
  program
    .command('push <project-slug> <requirement-id> <evidence-type> <file>')
    .description('Upload evidence file(s) to DevAudit (port of scripts/upload-evidence.sh)')
    .option('--release <version>', 'release version (e.g. v1.0.0)')
    .option('--create-release-if-missing', "auto-create the release as 'draft' if absent")
    .option('--environment <env>', 'uat | production')
    .option('--category <cat>', 'ci_pipeline | local_dev | planning | test_report | security_scan | release_artifact')
    .option('--git-sha <sha>', 'attached to metadata.gitSha')
    .option('--ci-run-id <id>', 'attached to metadata.ciRunId')
    .option('--branch <name>', 'git branch — sent as releaseBranch + metadata.branch')
    .option('--release-title <text>', 'human title for the release row (releaseTitle; portal no-clobbers)')
    .option('--release-summary <text>', 'reviewer-facing short description (releaseSummary; portal no-clobbers)')
    .option('--change-type <type>', 'conventional-commit prefix for the release row (changeType)')
    .option('--gate-status <status>', 'passed | failed | skipped (gateStatus)')
    .option('--sdlc-stage <stage>', 'SDLC stage 1-5 (sdlcStage)')
    .option('--test-execution <id>', 'test execution identifier (typically the CI run ID)')
    .option('--evidence-scope <scope>', 'release | stage | execution | approval (evidenceScope)')
    .option('--test-execution-record-id <id>', 'first-class portal test execution UUID (requires --evidence-scope execution)')
    .option(
      '--meta-key <pair>',
      'repeatable key=value merged into the metadata JSON',
      (val: string, acc: string[]) => [...acc, val],
      [] as string[],
    )
    .option('--base-url <url>', 'override portal URL (defaults to DEVAUDIT_BASE_URL env or production)')
    .option('--api-key <key>', 'override DEVAUDIT_API_KEY env var')
    .action(
      async (
        projectSlug: string,
        requirementId: string,
        evidenceType: string,
        file: string,
        opts: {
          release?: string;
          createReleaseIfMissing?: boolean;
          environment?: string;
          category?: string;
          gitSha?: string;
          ciRunId?: string;
          branch?: string;
          releaseTitle?: string;
        releaseSummary?: string;
          changeType?: string;
          gateStatus?: string;
          sdlcStage?: string;
          testExecution?: string;
          evidenceScope?: 'release' | 'stage' | 'execution' | 'approval';
          testExecutionRecordId?: string;
          metaKey?: string[];
          baseUrl?: string;
          apiKey?: string;
        },
        cmd,
      ) => {
        const globals = cmd.optsWithGlobals();
        await runPush({
          projectSlug,
          requirementId,
          evidenceType,
          filePath: file,
          ...(opts.release !== undefined ? { release: opts.release } : {}),
          ...(opts.createReleaseIfMissing !== undefined
            ? { createReleaseIfMissing: opts.createReleaseIfMissing }
            : {}),
          ...(opts.environment !== undefined ? { environment: opts.environment } : {}),
          ...(opts.category !== undefined ? { category: opts.category } : {}),
          ...(opts.gitSha !== undefined ? { gitSha: opts.gitSha } : {}),
          ...(opts.ciRunId !== undefined ? { ciRunId: opts.ciRunId } : {}),
          ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
          ...(opts.releaseTitle !== undefined ? { releaseTitle: opts.releaseTitle } : {}),
      ...(opts.releaseSummary !== undefined ? { releaseSummary: opts.releaseSummary } : {}),
          ...(opts.changeType !== undefined ? { changeType: opts.changeType } : {}),
          ...(opts.gateStatus !== undefined ? { gateStatus: opts.gateStatus } : {}),
          ...(opts.sdlcStage !== undefined ? { sdlcStage: opts.sdlcStage } : {}),
          ...(opts.testExecution !== undefined ? { testExecutionId: opts.testExecution } : {}),
          ...(opts.evidenceScope !== undefined ? { evidenceScope: opts.evidenceScope } : {}),
          ...(opts.testExecutionRecordId !== undefined
            ? { testExecutionRecordId: opts.testExecutionRecordId }
            : {}),
          ...(opts.metaKey !== undefined && opts.metaKey.length > 0 ? { metaKeys: opts.metaKey } : {}),
          ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
          ...(globals.dryRun !== undefined ? { dryRun: Boolean(globals.dryRun) } : {}),
        });
      },
    );
  program
    .command('bootstrap-governance [path]')
    .description(
      'Copy governance starter templates (ropa, dpia, ai-disclosure, periodic-review, incident-report) into compliance/governance/. Opt-in since v0.1.36 — auto-seed during install was removed because the placeholders auto-uploaded as evidence on first CI push.',
    )
    .action(async (path?: string, _opts?: unknown, cmd?: Command) => {
      const opts = (cmd?.optsWithGlobals() ?? {}) as { dryRun?: boolean };
      await runBootstrapGovernance({ path, dryRun: opts.dryRun });
    });
  program
    .command('doctor')
    .description('Verify the local install: required tools on PATH (node>=22, git, gh, jq, curl), a release close-out drift check, and onboarding-checklist invariants (SRS/RTM/secrets/pre-push hook), and whether sdlc-config.json matches the real deploy host, production URL, custom deploy and CI runner setup of the repo. Use --json for machine-readable output (consumed by the fleet-doctor skill).')
    .option(
      '--fleet',
      'Sweep every project your DEVAUDIT_USER_TOKEN can see on the portal, checked out locally as siblings of the current directory, running doctor against each. Read-only — never files issues or changes anything. See docs/doctor.md.',
    )
    .option(
      '--fix',
      'Propose and (after confirmation) apply fixes for release-deferral findings and a deploy-host mismatch (sets host in sdlc-config.json, tier A). Tier A local edits (ticket Release intent, RTM DEFERRED, predecessor lines) are confirmed or accepted with --yes; tier B portal defer/resume needs your PAT (DEVAUDIT_USER_TOKEN), a reason and confirmation (never --yes alone); tier C is printed, never run. Exits 8 when proposals remain unapplied. Not available with --fleet. See docs/doctor.md.',
    )
    .option('--reason <text>', 'Reason recorded for a portal defer/resume under --fix (required with --yes in non-interactive runs).')
    .action(async (cmdOpts: { fleet?: boolean; fix?: boolean; reason?: string }, cmd: Command) => {
      const globals = cmd.optsWithGlobals() as { yes?: boolean; dryRun?: boolean };
      if (cmdOpts.fleet && (cmdOpts.fix || cmdOpts.reason !== undefined)) {
        logger().error('--fleet is read-only and never forwards --fix or --reason. Run `devaudit doctor --fix` inside one project instead.');
        process.exit(2);
      }
      if (cmdOpts.reason !== undefined && !cmdOpts.fix) {
        logger().error('--reason is only used with --fix.');
        process.exit(2);
      }
      if (cmdOpts.fleet) {
        await runFleetDoctor();
        return;
      }
      if (cmdOpts.fix) {
        await runDoctor({
          fix: {
            yes: Boolean(globals.yes),
            ...(cmdOpts.reason !== undefined ? { reason: cmdOpts.reason } : {}),
            dryRun: Boolean(globals.dryRun),
          },
        });
        return;
      }
      await runDoctor();
    });
  const releaseCmd = program.command('release').description('Read-only release readiness (no portal writes)');
  releaseCmd
    .command('check [version]')
    .description('Check the release is ready to submit for UAT review: clean working tree, integration branch up to date with origin, CI green on its head, the release ticket exists, and the portal release is draft (read with your viewer key; never the PAT). Prints each result with the fix; exits 0 only when ready. Submitting stays a portal action.')
    .action(async (version: string | undefined, _opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals() as { json?: boolean };
      process.exit(await runReleaseCheck({ ...(version ? { version } : {}), json: Boolean(globals.json) }));
    });
  const configureCmd = program
    .command('configure')
    .description(
      "Read and change this repo's sdlc-config.json with validation: deploy host, production URL secret, custom deploy settings, runner and CI keys. Changes the repo's evidence contradicts need confirmation or --reason. See docs/configure.md.",
    );
  configureCmd
    .command('list')
    .description('Every key `configure` manages, with its current value (keys for other hosts hidden). --json lists all, with types and allowed values.')
    .action(async () => {
      await runConfigureList();
    });
  configureCmd
    .command('get <key>')
    .description('Show one key: value, meaning, allowed values, and whether the host requires it.')
    .action(async (key: string) => {
      await runConfigureGet(key);
    });
  configureCmd
    .command('set <key> <value>')
    .description(
      'Validate and set one key. Shows what the next `devaudit update` regenerates and what is still to do. --dry-run writes nothing; --reason records why a value the repo evidence contradicts is right; --yes skips the confirmation for an uncontradicted change.',
    )
    .option('--reason <text>', 'Why this repo differs from its evidence (needed non-interactively when the evidence contradicts the value).')
    .action(async (key: string, value: string, cmdOpts: { reason?: string }, cmd: Command) => {
      const globals = cmd.optsWithGlobals() as { yes?: boolean; dryRun?: boolean };
      const code = await runConfigureSet(key, value, {
        ...(cmdOpts.reason !== undefined ? { reason: cmdOpts.reason } : {}),
        yes: Boolean(globals.yes),
        dryRun: Boolean(globals.dryRun),
      });
      process.exit(code);
    });
  configureCmd
    .command('secret <name>')
    .description(
      "Set a repo secret through `gh secret set <name>`'s masked prompt; devaudit explains what the secret is for and never sees the value. Interactive only.",
    )
    .action(async (name: string, _opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals() as { dryRun?: boolean };
      process.exit(await runConfigureSecret(name, { dryRun: Boolean(globals.dryRun) }));
    });
  program
    .command('status [path]')
    .description("Show the consumer project's framework state")
    .action(async (path?: string) => {
      await runStatus({ path });
    });
  program
    .command('upgrade')
    .description('Update the devaudit CLI itself to the latest release')
    .action(
      makeStub({
        command: 'upgrade',
        summary: 'Self-update via npm or the platform package manager. Workstream A milestone 8.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  const authCmd = program.command('auth').description('Authentication management');
  authCmd
    .command('login')
    .option('--token <token>', 'PAT to use (skips the interactive prompt)')
    .option('--base-url <url>', 'override portal base URL', 'https://devaudit.ai')
    .description('Sign in via PAT paste; stores token in ~/.config/devaudit/auth.json')
    .action(async (opts: { token?: string; baseUrl?: string }) => {
      await runAuthLogin({ token: opts.token, baseUrl: opts.baseUrl });
    });
  authCmd
    .command('logout')
    .description('Delete the cached token at ~/.config/devaudit/auth.json')
    .action(runAuthLogout);
  authCmd
    .command('status')
    .description('Show current auth state and verify the cached token')
    .action(runAuthStatus);
  const orgCmd = program.command('org').description('Organisation management (workstream B prereq)');
  orgCmd
    .command('list')
    .description('List orgs the user belongs to')
    .action(makeStub({ command: 'org list', summary: 'Needs portal RBAC + org endpoints.', trackedIn: TRACKING_ISSUE }));
  orgCmd
    .command('switch <slug>')
    .description('Switch active org context')
    .action(
      makeStub({ command: 'org switch', summary: 'Updates ~/.config/devaudit/config.json.', trackedIn: TRACKING_ISSUE }),
    );
  const orgPolicyCmd = orgCmd.command('policy').description('Org policy management');
  orgPolicyCmd
    .command('list')
    .description("Show the active org's policy baselines")
    .action(
      makeStub({
        command: 'org policy list',
        summary: 'Reads from the portal policy engine (workstream B).',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  orgPolicyCmd
    .command('apply [path]')
    .description('Apply org policy to a project (or all org projects)')
    .action(
      makeStub({
        command: 'org policy apply',
        summary: 'Evaluates sdlc-config.json + CI evidence against org policy bundle.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  orgCmd
    .command('report')
    .option('--format <fmt>', 'html | json | csv', 'html')
    .description('Generate an org-wide compliance report')
    .action(
      makeStub({
        command: 'org report',
        summary: 'Aggregates per-project compliance state across the org.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  const pluginCmd = program.command('plugin').description('Plugin management');
  pluginCmd
    .command('list')
    .description('List installed plugins in ~/.config/devaudit/plugins/')
    .action(runPluginList);
  pluginCmd
    .command('install <source>')
    .description('Install a plugin from a Git URL (portal registry resolution is pending)')
    .action(async (source: string) => {
      await runPluginInstall({ source });
    });
  pluginCmd
    .command('remove <name>')
    .description('Remove a locally installed plugin by package or directory name')
    .action(async (name: string) => {
      await runPluginRemove({ name });
    });
  pluginCmd
    .command('update')
    .description('Update all installed plugins (git pull + npm install)')
    .action(runPluginUpdate);
  const configCmd = program.command('config').description('CLI configuration (telemetry, default org, etc.)');
  configCmd
    .command('get <key>')
    .description('Read a CLI config value')
    .action(
      makeStub({ command: 'config get', summary: 'Reads ~/.config/devaudit/config.json.', trackedIn: TRACKING_ISSUE }),
    );
  configCmd
    .command('set <key> <value>')
    .description('Write a CLI config value')
    .action(
      makeStub({
        command: 'config set',
        summary: 'Writes to ~/.config/devaudit/config.json (mode 0600).',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  configCmd
    .command('list')
    .description('Print all CLI config values')
    .action(
      makeStub({
        command: 'config list',
        summary: 'Lists all CLI config keys with their current values.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  const discovery = await discoverPlugins();
  if (discovery.failures.length > 0) {
    const log = logger();
    for (const f of discovery.failures) {
      log.warn(`Plugin at ${f.dir} failed to load: ${f.reason}`);
    }
  }
  registerPluginCommands(program, discovery.loaded);
  program.parse(argv);
}

main(process.argv).catch((err: unknown) => {
  const log = logger();
  log.error((err as Error).message);
  process.exit(1);
});
