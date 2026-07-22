import { Command, Option } from 'commander';
import { configureLogger } from './lib/logger.js';
import { CLI_VERSION } from './lib/version.js';
import { runDoctor } from './commands/doctor.js';
import { runAuthLogin } from './commands/auth/login.js';
import { runAuthLogout } from './commands/auth/logout.js';
import { runAuthStatus } from './commands/auth/status.js';
import { runStatus } from './commands/status.js';
import { runPush } from './commands/push.js';
import { runInstallCommand } from './commands/install.js';
import { runJoinCommand } from './commands/join.js';
import { runUpdate } from './commands/update.js';
import { runBootstrapGovernance } from './commands/bootstrap-governance.js';
import { makeStub } from './commands/stub.js';
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
    .action(
      async (
        path: string | undefined,
        cmdOpts: { token?: string; baseUrl?: string; forceTeamConfig?: boolean },
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
      await runUpdate({
        version: resolvedVersion ?? CLI_VERSION,
        paths: resolvedPaths,
        ...(globals.dryRun !== undefined ? { dryRun: Boolean(globals.dryRun) } : {}),
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
    .description('Verify the local install: required tools on PATH (node>=22, git, gh, jq, curl) + a release close-out drift check')
    .action(runDoctor);
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
    .option('--base-url <url>', 'override portal base URL', 'https://devaudit.metasession.co')
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
