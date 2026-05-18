import { Command, Option } from 'commander';
import { configureLogger } from './lib/logger.js';
import { CLI_VERSION } from './lib/version.js';
import { runDoctor } from './commands/doctor.js';
import { runAuthLogin } from './commands/auth/login.js';
import { runAuthLogout } from './commands/auth/logout.js';
import { runAuthStatus } from './commands/auth/status.js';
import { runStatus } from './commands/status.js';
import { runPush } from './commands/push.js';
import { runInstall } from './commands/install.js';
import { runUpdate } from './commands/update.js';
import { makeStub } from './commands/stub.js';

const TRACKING_ISSUE = 'https://github.com/metasession-dev/DevAudit-Installer/issues/1';

function applyCommonFlags(program: Command): void {
  program.addOption(new Option('--json', 'machine-readable output'));
  program.addOption(new Option('--yes, -y', 'accept all interactive defaults (CI-friendly)'));
  program.addOption(new Option('--dry-run', "preview, don't mutate"));
  program.addOption(new Option('--verbose, -v', 'extra detail'));
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

export function main(argv: readonly string[]): void {
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
    .description('Interactive onboarding for a consumer project (v0: wraps sdlc-onboard.sh)')
    .action(async (path?: string) => {
      await runInstall({ path });
    });
  program
    .command('update <version> <paths...>')
    .description('Sync framework templates into existing consumer(s) (native TS implementation)')
    .action(async (version: string, paths: string[]) => {
      await runUpdate({ version, paths });
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
    .option('--branch <name>', 'attached to metadata.branch')
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
          baseUrl?: string;
          apiKey?: string;
        },
      ) => {
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
          ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        });
      },
    );
  program
    .command('doctor')
    .description('Verify the local install: required tools on PATH, auth state, config validity')
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
    .description('List installed and available plugins')
    .action(
      makeStub({
        command: 'plugin list',
        summary: 'Reads the local plugin set + the portal plugin registry.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  pluginCmd
    .command('install <name>')
    .description('Install a plugin from the registry or a Git URL')
    .action(
      makeStub({
        command: 'plugin install',
        summary: 'Resolves against the portal /plugins registry; supports private Git URLs.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  pluginCmd
    .command('remove <name>')
    .description('Remove a locally installed plugin')
    .action(
      makeStub({
        command: 'plugin remove',
        summary: 'Removes the plugin from ~/.config/devaudit/plugins/.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  pluginCmd
    .command('update')
    .description('Update all installed plugins')
    .action(
      makeStub({
        command: 'plugin update',
        summary: 'Refreshes installed plugins to their latest compatible versions.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
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
  program.parse(argv);
}

main(process.argv);
