import { Command, Option } from 'commander';
import { configureLogger } from './lib/logger.js';
import { CLI_VERSION } from './lib/version.js';
import { runDoctor } from './commands/doctor.js';
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
    .description('Interactive onboarding for a consumer project (ports sdlc-onboard.sh)')
    .action(
      makeStub({
        command: 'install',
        summary: 'Port of scripts/sdlc-onboard.sh. The bash script still works in the meantime.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  program
    .command('update [path]')
    .description('Sync framework templates into an existing consumer (ports sync-sdlc.sh)')
    .action(
      makeStub({
        command: 'update',
        summary: 'Port of scripts/sync-sdlc.sh. The bash script still works in the meantime.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  program
    .command('push <kind>')
    .description('Upload an artefact to the DevAudit portal (evidence | audit | compliance)')
    .action(
      makeStub({
        command: 'push',
        summary: 'Port of scripts/upload-evidence.sh. The bash script still works in the meantime.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  program
    .command('doctor')
    .description('Verify the local install: required tools on PATH, auth state, config validity')
    .action(runDoctor);
  program
    .command('status [path]')
    .description("Show the consumer project's framework state")
    .action(
      makeStub({
        command: 'status',
        summary: 'Reads sdlc-config.json, prints stack/host, last sync version, pending REQs.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
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
    .option('--provider <name>', 'github | gitlab (default: detect)')
    .description('Sign in via browser OAuth or PAT paste; stores token in ~/.config/devaudit/')
    .action(
      makeStub({
        command: 'auth login',
        summary:
          'PAT paste flow first (works against the portal today). Browser OAuth lands when /cli-auth ships (workstream B).',
        trackedIn: TRACKING_ISSUE,
      }),
    );
  authCmd
    .command('logout')
    .description('Delete the cached token at ~/.config/devaudit/auth.json')
    .action(makeStub({ command: 'auth logout', summary: 'Wipes the cached PAT.', trackedIn: TRACKING_ISSUE }));
  authCmd
    .command('status')
    .description('Show current auth state (no token logged)')
    .action(
      makeStub({
        command: 'auth status',
        summary: 'Reads the cached token, calls GET /api/projects to verify, prints user info.',
        trackedIn: TRACKING_ISSUE,
      }),
    );
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
