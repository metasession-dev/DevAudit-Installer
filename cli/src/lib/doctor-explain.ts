import { findingToGap, type Gap, type GapExplanation } from '@metasession.co/devaudit-core';
import type { CheckResult, Finding } from './doctor-types.js';

/**
 * DevAudit-Installer#1116 WP4 — what each `devaudit doctor` check means, in plain words, and what to do
 * when it has no repair of its own. `doctor --json` turns every non-ok check into gaps with it, and
 * `doctor --explain` (a later work package) prints it. Every check doctor can emit has an entry; a test
 * fails when a new check has none.
 */
export const CHECK_EXPLANATIONS: Readonly<Record<string, GapExplanation>> = {
  // ---- required tools (gating) ----
  node: {
    title: 'Node.js is missing or too old',
    why: "DevAudit's command line and the generated hooks need Node.js 22 or newer.",
    guidance: 'Install Node.js 22 or newer (https://nodejs.org) and run `devaudit doctor` again.',
  },
  git: {
    title: 'git is missing',
    why: 'DevAudit reads your branches, commits and history with git.',
    guidance: 'Install git and make sure it is on your PATH, then run `devaudit doctor` again.',
  },
  gh: {
    title: 'The GitHub CLI is missing',
    why: 'DevAudit uses the GitHub CLI (`gh`) to read and set repository secrets, branch protection and workflow runs.',
    guidance: 'Install the GitHub CLI (https://cli.github.com), run `gh auth login`, then run `devaudit doctor` again.',
  },
  jq: {
    title: 'jq is missing',
    why: 'The generated CI scripts and the doctor use `jq` to read JSON.',
    guidance: 'Install jq (for example `brew install jq` or `apt install jq`) and run `devaudit doctor` again.',
  },
  curl: {
    title: 'curl is missing',
    why: 'The generated CI scripts and the post-deploy probe use `curl`.',
    guidance: 'Install curl and make sure it is on your PATH, then run `devaudit doctor` again.',
  },
  semgrep: {
    title: 'Semgrep is not installed on this machine',
    why: 'Local pre-commit security scans use Semgrep. CI installs its own copy, so only local scans are affected.',
    guidance: 'Install Semgrep (`pip install semgrep`) if you want the local scan; CI is not affected either way.',
  },

  // ---- release close-out ----
  releases: {
    title: 'A released release is still pending in the repository',
    why: "The portal says this release is released, but its ticket is still in `compliance/pending-releases/`, so the repository's records and the portal disagree.",
    guidance: 'Run `./scripts/close-out-release.sh <REQ>` for each release listed, or re-run the close-out workflow.',
  },

  // ---- onboarding checklist ----
  srs: {
    title: 'There is no software requirements specification',
    why: '`docs/SRS.md` is what changes are checked against for requirement drift, and nothing in the framework writes it for you.',
    guidance: 'Create `docs/SRS.md`; the `requirements-aligner` skill can bootstrap it from your code.',
  },
  rtm: {
    title: 'The requirements traceability matrix has no requirements',
    why: '`compliance/RTM.md` links each requirement to its tests and evidence; with no requirement row nothing can be traced.',
    guidance: 'Plan your first requirement (the `sdlc-implementer` skill adds its row to `compliance/RTM.md`).',
  },
  'e2e-regression': {
    title: 'The end-to-end regression setting and the Playwright config disagree',
    why: '`e2e_regression_enabled` and the Playwright `critical` and `regression` projects both declare whether the regression tiers exist; when they disagree the release gate runs the wrong thing, or nothing.',
    guidance: 'Make them agree: add the missing Playwright projects, or use `devaudit update --enable-e2e-regression` or `--disable-e2e-regression`.',
  },
  secrets: {
    title: 'A required GitHub secret is missing (or no longer used)',
    why: 'CI needs these repository secrets to upload evidence and to deploy; without them the workflows fail or skip.',
    guidance: 'Set each missing secret with `devaudit configure secret <NAME>`; `gh secret delete <NAME>` removes one that is no longer used.',
  },
  'pre-push-hook': {
    title: 'There is no pre-push hook',
    why: 'The pre-push hook is what enforces the `sdlc-implementer` rule before code leaves your machine.',
    guidance: 'Run `devaudit update` (it installs the hook), or add `.husky/pre-push` yourself.',
  },
  'reconcile-cli': {
    title: "The host's recovery command is not installed",
    why: "The webhook-loss recovery workflow needs the host's own command line on the runner; without it a missed deployment cannot be recovered automatically.",
    guidance: 'Install the command the check names, or accept that recovering a missed deployment is manual.',
  },
  'sync-conflicts': {
    title: 'A local edit is blocking a template update',
    why: 'A DevAudit-managed file was edited locally, so `devaudit update` left it alone and saved the new version beside it; until you resolve it the file is not on the current template.',
    guidance: 'Follow docs/sync-conflict-review.md for each file listed: keep your edit, take the new version, or merge.',
  },
  'patch-conflicts': {
    title: 'A local patch no longer applies',
    why: 'A patch in `.devaudit-patches/` could not be applied by the last `devaudit update`, so that file carries the unpatched upstream template.',
    guidance: 'Re-roll the patch against the current template, or remove it (docs/consuming-projects.md explains how).',
  },
  'accepted-exceptions': {
    title: 'An accepted exception needs review',
    why: 'An accepted end-to-end failure, accepted dependency risk or accepted vulnerability has no review date, a passed one, or expires soon; the CI gate fails on it again once it expires.',
    guidance: 'Review each exception listed: fix the cause, or renew it with a new `Review by:` date and a reason.',
  },
  'commitlint-config-shadowing': {
    title: 'An old commitlint config is hiding the managed one',
    why: "commitlint loads a legacy config before the managed `commitlint.config.mjs`, which silently disables the managed config's exemption for the sdlc-implementer sentinel.",
    guidance: 'Remove or merge the legacy commitlint config the check names, so the managed `commitlint.config.mjs` is the one loaded.',
  },
  'deploy-host': {
    title: 'The recorded deploy host does not match where production deploys',
    why: "`host` in `sdlc-config.json` decides which host-specific workflows and checks are generated; a wrong host gives you another provider's workflows.",
    guidance: 'Run `devaudit configure set host <host>` with the host the check names, then `devaudit update`.',
  },
  'production-url': {
    title: 'The production URL is not set up for the post-deploy probe',
    why: 'The post-deploy probe and smoke checks need the production URL secret, and a header when the production site is access-gated; without them the probe fails.',
    guidance: 'Set the secret the check names with `devaudit configure secret <NAME>` (and `DEVAUDIT_PROBE_HEADER` for a gated site).',
  },
  'custom-deploy': {
    title: 'The custom deploy settings are incomplete',
    why: 'With the `custom` host, `deploy-custom.yml` runs your `deploy_command` and needs its secrets; a missing piece makes the deploy fail or go unverified.',
    guidance: 'Set what the check names with `devaudit configure set <key> <value>` and `devaudit configure secret <NAME>`.',
  },
  'ci-runner': {
    title: 'The CI runner does not exist',
    why: 'Every workflow runs on the runner you configured; if no registered runner carries its label, the jobs queue forever.',
    guidance: 'Register a runner with that label, or change `runner` with `devaudit configure set runner <label>`.',
  },
  'e2e-release-gate': {
    title: 'The end-to-end release gate needs a look',
    why: 'The release gate decides which end-to-end tier must pass before a release can merge; the check found a setting that does not take effect, is invalid, or is too slow to be a gate.',
    guidance: 'Review the finding, then change the gate with `devaudit configure set release_gate_tier <none|smoke|critical|full>`.',
  },
  'test-tiers': {
    title: 'A test tier has no tests, or a requirement is not covered',
    why: 'A declared smoke, critical or full tier that finds no tests gates nothing, and an acceptance criterion with no test is not evidenced.',
    guidance: 'Add the missing tests (the `e2e-test-engineer` skill writes them) or fix the tier command with `devaudit configure set`.',
  },
  'pat-env': {
    title: 'Your personal access token is in an environment variable',
    why: 'Every process started from this shell, including AI agent sessions, inherits `DEVAUDIT_USER_TOKEN`, and an agent must never use your personal access token.',
    guidance: 'Run `devaudit auth login` (it keeps the token out of your shell environment) and unset `DEVAUDIT_USER_TOKEN`.',
  },
  credentials: {
    title: 'A DevAudit credential is in the wrong place or missing',
    why: 'The uploader key is for CI only, your viewer key is for reading the portal, and your personal access token stays out of files and environments; a key in the wrong place can leak or be misused.',
    guidance: 'Follow docs/credentials.md for the key the check names (`devaudit auth login`, `devaudit auth viewer-key set`).',
  },
  'agent-permissions': {
    title: 'The recommended agent protection rules are not all in place',
    why: 'Deny rules in your agent settings keep an AI session away from your personal access token and credential files.',
    guidance: 'Add the rules from docs/agent-permissions.md to your agent settings (a command that applies them arrives with the guided onboarding).',
  },

  // ---- release deferral ----
  'release-pr-closed': {
    title: 'A release PR was closed without releasing',
    why: 'The release pull request is closed unmerged but its portal release is still open and its ticket does not say it is deferred, so the ticket, the portal and `develop` disagree.',
    guidance: 'Decide in the portal and the ticket: defer the release, abandon it, or reopen the pull request.',
  },
  'deferred-will-ship': {
    title: 'A deferred requirement will ship unapproved',
    why: "A deferred requirement's commits are on `develop` and no pending release lists them as absorbed, so they will ship in the next release without an approval of their own.",
    guidance: "List the requirement under the shipping release's 'Absorbed predecessor releases', or revert its commits.",
  },
  'predecessors-none': {
    title: "A release says it absorbs nothing, but another release's commits are on develop",
    why: "The ticket says 'Absorbed predecessor releases: None' while another pending requirement has commits in the same range, so that requirement would ship without its own approval.",
    guidance: 'Add the other requirement to the ticket as an absorbed predecessor, or exclude its commits from the release.',
  },
  'bundle-members': {
    title: 'A bundled release member is out of step with its core',
    why: 'A co-tracked member of a declared bundle is still pending after the core release was archived or released, or has an orphan draft release on the portal.',
    guidance: "Close out or remove the member's ticket, and delete the orphan draft release in the portal.",
  },
  'deferred-portal-sync': {
    title: 'A release is deferred in the ticket but not on the portal',
    why: "The ticket declares the release deferred but the portal release is still in draft or review, so the portal's view of the release is wrong.",
    guidance: 'Defer the release on the portal (`devaudit doctor --fix` does it for you with your confirmation).',
  },
  'deferred-ticket-sync': {
    title: 'A release is deferred on the portal but not in the ticket',
    why: 'The portal release is deferred but the pending ticket does not say so. That may be an accidental deferral, so the repair is a decision, not a default.',
    guidance: 'Record the deferral in the ticket, resume the release on the portal, or leave it as it is.',
  },
  'deferral-age': {
    title: 'A deferral has been open too long',
    why: 'A release deferred longer than `deferral_max_age_days` (or past its review-by date) is probably forgotten work that is blocking nothing and shipping nothing.',
    guidance: 'Resume the release, extend the deferral with a new date, or abandon it.',
  },
  'preset-drift': {
    title: "The configuration no longer matches the project's preset",
    why: 'A preset is a set of settings chosen together. When one has been edited by hand the project no longer runs what its preset says it does, and the evidence and gaps described for that preset may not hold.',
    guidance: 'Set the differing keys back with `devaudit configure`, switch to the preset that fits with `devaudit configure`, or record the project as custom if the differences are deliberate.',
  },
  'standards-fit': {
    title: 'The standards you need do not fit your approval settings',
    why: 'SOC 2 and ISO 27001 expect a release to be approved by someone other than its author. When the author approves their own release the matching clauses show as not covered, and the standards on the portal may not match the ones in your configuration.',
    guidance: 'Choose an approval setting with a different approver (`devaudit configure`), keep the gap and prepare a compensating control, or correct the standards in sdlc-config.json or the portal.',
  },
  'approval-policy': {
    title: "The repository and the portal disagree about who may approve a release",
    why: "The repository's approval.mode and the project's approval policy on the portal decide who can approve a release. When they differ, either the author is blocked from a release the repository expects them to approve, or the portal does not enforce the different approver the repository expects.",
    guidance: "Change approval.mode with `devaudit configure`, or change the project's approval policy in the portal (it needs a project admin).",
  },
  'ci-values': {
    title: 'A secret or variable the workflows read is not visible to them',
    why: 'GitHub reads a `secrets.X` or `vars.X` that does not exist, or that exists only inside an environment, as an empty string and does not fail. The generated workflows read repository-level values only (no job sets `environment:`), so a configuration value such as an `e2e_env` entry that points at one starts the app without it, and the first symptom is a wait that times out far from the cause.',
    guidance: 'Define the named secret or variable at repository level (`gh secret set NAME` or `gh variable set NAME`, you are prompted for the value), or correct the name in `sdlc-config.json`. Write `${{ secrets.NAME || \'\' }}` for a value that may be empty.',
  },
  'test-data': {
    title: 'The test data is not fully declared',
    why: 'Tests that write data need a place to write it that cannot hurt anyone, a way to put it back, and a seed the tests can rely on. When any of that is missing or contradictory, a run can collide with people, leave data behind, or pass while hiding tests that skipped for lack of data.',
    guidance: 'Run `devaudit configure` to answer where the tests get their data, and use the `e2e-test-data` skill to create the seed, reset and checks.',
  },
  'test-data:isolation-unset': {
    title: 'The regression has no declared place for its data',
    why: 'The regression is enabled, but nothing says where its tests get their data (a fresh database, a shared environment, or none). Without that answer DevAudit cannot tell whether a run can collide with people or leave data behind.',
    guidance: 'Run `devaudit configure` (it asks), then use the `e2e-test-data` skill to create the seed and reset scripts.',
  },
  'test-data:shared-writes': {
    title: 'The regression writes to an environment other people use',
    why: 'With shared data, a run can collide with a person using the environment, and a run killed part-way leaves data dirty for the next one. It is recorded as a risk, not blocked.',
    guidance: 'Give the regression its own data (`e2e_data_isolation: ephemeral`), serialise its runs (`shared_serialised`), or leave it as it is and accept the risk.',
  },
  'test-data:shared-unattended': {
    title: 'An unattended regression runs against shared data',
    why: 'The full regression runs on a schedule or after every deploy with nobody watching, against data that is shared. A person using that environment at that time collides with the run, and a killed run leaves data dirty until someone resets it.',
    guidance: 'Change the isolation, turn the unattended run off, or leave it as it is; the `e2e-test-data` skill helps design an isolated seed.',
  },
  'test-data:seed-path-missing': {
    title: 'A declared seed path or script does not exist',
    why: 'The configuration names seed files or scripts that are not in the repository, so the seed step and the drift check cannot work.',
    guidance: 'Use the `e2e-test-data` skill to create the seed, or correct the paths with `devaudit configure set e2e_seed_paths <paths>`.',
  },
  'test-data:seed-paths-empty': {
    title: 'The seed command is set but its files are not listed',
    why: 'DevAudit hashes the files in `e2e_seed_paths` to tell when the seed changed; with none listed it cannot, and a changed seed goes unnoticed.',
    guidance: 'List the seed files or folders with `devaudit configure set e2e_seed_paths <paths>`.',
  },
  'test-data:serialised-no-group': {
    title: 'Runs against the shared environment are not serialised',
    why: 'The data is declared shared but only used by the tests, one run at a time, yet no concurrency group makes runs queue, so two runs can overlap.',
    guidance: 'Set `e2e_concurrency_group` with `devaudit configure set e2e_concurrency_group <name>`.',
  },
  'test-data:fixture-not-seeded': {
    title: 'Specs may refer to seed data that is not in the seed',
    why: 'This is a text heuristic and can be wrong: specs mention fixture names that do not appear in the seed files, which often means a test that skips or fails for lack of data.',
    guidance: 'Use the `e2e-test-data` skill to compare the seed with the specs (its drift check).',
  },
  'test-data:feature-destructive': {
    title: 'Feature runs include a project that changes shared data',
    why: 'Every feature pull request runs all Playwright projects, including `regression`, against a backend other people use, which can change or delete their data.',
    guidance: 'Limit the feature run with `devaudit configure set feature_e2e_projects smoke,critical`.',
  },
  'test-data:seed-changed-since-last-run': {
    title: 'The seed changed since the last regression ran',
    why: 'The last regression ran against an older seed, so its result does not tell you how the current seed behaves. This is advisory.',
    guidance: 'Review the seed change with the `e2e-test-data` skill and run the regression again.',
  },
  durations: {
    title: 'The run times of your CI jobs could not be measured',
    why: 'How long the smoke, critical and full test groups take decides which release gate is practical; the doctor measures them from your recent successful runs.',
    guidance: 'Install and sign in to the GitHub CLI (`gh auth login`); once the workflows have run successfully the times appear here.',
  },
};

/** Checks that are re-run after a fix because they read what the fixed check read (a dependent runs after the check it depends on). */
export const CHECK_DEPENDENTS: Readonly<Record<string, readonly string[]>> = {
  'test-tiers': ['test-data'],
  'preset-drift': ['test-data'],
};

/** Every check name doctor can emit that has an explanation. */
export const EXPLAINED_CHECKS: readonly string[] = Object.keys(CHECK_EXPLANATIONS);

/** The explanation for a check, or undefined for a name this table does not know. */
export function explanationFor(check: string): GapExplanation | undefined {
  return CHECK_EXPLANATIONS[check];
}

/**
 * The gaps behind one check result: one per finding when it lists findings, even when the check as a
 * whole is ok (an informational check such as `agent-permissions` reports a repair without failing);
 * otherwise one for the check as a whole when it is not ok; otherwise none.
 */
export function gapsFromCheck(check: CheckResult): Gap[] {
  const explanation = explanationFor(check.name);
  if (check.findings && check.findings.length > 0) {
    return check.findings.map((finding) => {
      // A finding may carry its own explanation, keyed `<check>:<subject>` (the test-data findings do).
      const gap = findingToGap(check.name, finding, CHECK_EXPLANATIONS[`${check.name}:${finding.subject}`] ?? explanation);
      if (!finding.alternatives || finding.alternatives.length === 0) return gap;
      const extra = finding.alternatives.map((alt) => findingToGap(check.name, { ...finding, remediation: alt }, explanation).options[0]!);
      return { ...gap, options: [...gap.options, ...extra] };
    });
  }
  if (check.ok) return [];
  return [findingToGap(check.name, { subject: check.name, detail: check.detail }, explanation)];
}

export function gapsFromChecks(checks: readonly CheckResult[]): Gap[] {
  return checks.flatMap(gapsFromCheck);
}

/**
 * The gaps of the close-out check: one per release that is released on the portal but still pending
 * locally (each with its repair), otherwise the check as a whole.
 */
export function gapsFromCloseout(closeout: CheckResult, drifted: readonly Finding[]): Gap[] {
  if (closeout.ok) return [];
  if (drifted.length === 0) return gapsFromCheck(closeout);
  const explanation = explanationFor(closeout.name);
  return drifted.map((finding) => findingToGap(closeout.name, finding, explanation));
}
