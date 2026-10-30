import type { PresetId } from './presets.js';
import type { ValidatorId } from './validators.js';

/**
 * The question registry as data (DevAudit-Installer#1116 section 5). `devaudit install`, `devaudit
 * configure` and the portal's web onboarding all render these questions, so a question reads the same
 * everywhere and the portal never needs the CLI's code.
 */

export type QuestionKind = 'select' | 'multiselect' | 'text' | 'confirm';

/** Where a default comes from: D detected, P the chosen preset, F a safe fallback. Detection wins on facts, the preset on policy. */
export type DefaultRule = 'D' | 'P' | 'F';

export interface QuestionChoice {
  readonly value: string;
  readonly label: string;
  /** What choosing it means, in plain words. */
  readonly consequence: string;
}

export interface QuestionDefault {
  readonly rule: DefaultRule;
  readonly source: string;
}

/** A condition, by id, so the data can be read by code that is not the CLI. See {@link conditionHolds}. */
export type ConditionId = 'always' | 'tests-exist' | 'data-needs-reset' | 'preset-needs-data';

export interface QuestionPart {
  readonly id: string;
  readonly prompt: string;
  readonly kind: QuestionKind;
  readonly choices?: readonly QuestionChoice[];
  readonly validators: readonly ValidatorId[];
  readonly writes: readonly string[];
}

export interface Question {
  readonly id: string;
  readonly group: 'project' | 'production' | 'tests' | 'data' | 'ci' | 'approval' | 'standards' | 'access' | 'code';
  readonly prompt: string;
  /** Why the question is asked, in one plain sentence. */
  readonly why: string;
  readonly kind: QuestionKind;
  readonly choices?: readonly QuestionChoice[];
  /** Set when the choices are worked out from the repository (the text says from what). */
  readonly dynamicChoices?: string;
  /** Further steps of a question that has more than one input (a choice, then a label). */
  readonly parts?: readonly QuestionPart[];
  /** In order: the first that applies wins. */
  readonly defaults: readonly QuestionDefault[];
  readonly validators: readonly ValidatorId[];
  /**
   * What an answer writes: configuration keys (dotted for a nested one), `portal:<setting>` for a
   * change on the portal (always a tier B action) and `secret:<name>` / `variable:<NAME>` for a
   * repository secret or variable set through `gh`.
   */
  readonly writes: readonly string[];
  /** Asked on the express path. */
  readonly express: boolean;
  /** Asked on the express path only when this holds (for a question that is otherwise skipped there). */
  readonly expressWhen?: ConditionId;
  readonly askWhen: ConditionId;
  /** How to change the answer later. */
  readonly changeLater: string;
}

const CONFIGURE = 'devaudit configure';

export const QUESTIONS: readonly Question[] = [
  {
    id: 'Q0a',
    group: 'project',
    prompt: 'What is the project called on DevAudit?',
    why: 'This short lower-case name identifies the project on the portal and names its secrets.',
    kind: 'text',
    defaults: [{ rule: 'D', source: 'the repository name' }],
    validators: ['slug'],
    writes: ['project_slug'],
    express: false,
    askWhen: 'always',
    changeLater: 'Not changed here: the name identifies the project on the portal.',
  },
  {
    id: 'Q0b',
    group: 'project',
    prompt: 'Which Node.js (or Python) version should CI use?',
    why: 'CI installs and tests your code with this version.',
    kind: 'select',
    dynamicChoices: 'the detected major version plus the two previous LTS majors',
    defaults: [
      { rule: 'D', source: 'engines in package.json, .nvmrc or .python-version' },
      { rule: 'F', source: "today's defaults" },
    ],
    validators: ['nonEmpty'],
    writes: ['node_version', 'python_version'],
    express: false,
    askWhen: 'always',
    changeLater: `${CONFIGURE} set node_version <version> (or python_version)`,
  },
  {
    id: 'Q0c',
    group: 'project',
    prompt: 'Where does the app live in this repository?',
    why: 'Workflows run their commands from this folder.',
    kind: 'select',
    dynamicChoices: 'the folders that look like an app, and "the repository root"',
    defaults: [
      { rule: 'D', source: 'the folder with the stack marker files' },
      { rule: 'F', source: '.' },
    ],
    validators: ['existingDir'],
    writes: ['working_directory'],
    express: false,
    askWhen: 'always',
    changeLater: `${CONFIGURE} set working_directory <folder>`,
  },
  {
    id: 'Q1',
    group: 'production',
    prompt: 'Where does production run?',
    why: 'The host decides which deploy and recovery workflows are generated for you.',
    kind: 'select',
    dynamicChoices: 'the host adapters installed (railway, vercel, custom, and any others)',
    defaults: [
      { rule: 'D', source: 'who creates the production deployments, then committed host files (cli/src/lib/deploy-detect.ts)' },
      { rule: 'F', source: 'custom' },
    ],
    validators: ['hostAdapterExists'],
    writes: ['host'],
    express: true,
    askWhen: 'always',
    changeLater: `${CONFIGURE} set host <host>, then devaudit update`,
  },
  {
    id: 'Q2',
    group: 'production',
    prompt: 'What is the production web address?',
    why: 'After a deploy, DevAudit checks that this address answers.',
    kind: 'text',
    choices: [
      { value: 'not-yet', label: 'I do not have one yet', consequence: 'The post-deploy check is skipped until you set it; doctor reminds you.' },
    ],
    defaults: [
      { rule: 'D', source: 'the latest production deployment URL GitHub records' },
      { rule: 'F', source: 'not yet' },
    ],
    validators: ['httpsUrl'],
    writes: ['secret:production_url'],
    express: true,
    askWhen: 'always',
    changeLater: `${CONFIGURE} secret <NAME> (the value is never shown or stored by devaudit)`,
  },
  {
    id: 'Q3',
    group: 'production',
    prompt: 'What is the name of the secret that holds that address?',
    why: 'The address is kept as a repository secret so it is never committed.',
    kind: 'text',
    defaults: [{ rule: 'D', source: '<SLUG>_PROD_URL' }],
    validators: ['secretName'],
    writes: ['production_url_secret'],
    express: false,
    askWhen: 'always',
    changeLater: `${CONFIGURE} set production_url_secret <NAME>`,
  },
  {
    id: 'Q4',
    group: 'tests',
    prompt: 'Does the project have automated end-to-end tests?',
    why: 'The test groups that gate a release come from your tests; without any, only the smaller presets fit.',
    kind: 'select',
    choices: [
      { value: 'playwright', label: 'Yes, Playwright', consequence: 'The groups are the Playwright projects named smoke, critical and regression.' },
      { value: 'pytest', label: 'Yes, pytest', consequence: 'The groups are pytest markers or the commands you give.' },
      { value: 'not-yet', label: 'Not yet', consequence: 'No test gates are set up. Preset A is suggested; docs/onboarding.md explains how to start with no tests.' },
    ],
    defaults: [{ rule: 'D', source: 'the test runners found (cli/src/lib/test-runner-detect.ts)' }],
    validators: [],
    writes: ['test_runner'],
    express: true,
    askWhen: 'always',
    changeLater: `${CONFIGURE} set test_runner <playwright|pytest>`,
  },
  {
    id: 'Q5',
    group: 'tests',
    prompt: 'Which tests are the quick "does it start" check?',
    why: 'These smoke tests run on every pull request and block a merge that breaks the app.',
    kind: 'select',
    dynamicChoices: 'the detected Playwright project or test tag, and "type a command"',
    defaults: [{ rule: 'D', source: 'a Playwright project named smoke, or e2e_project' }],
    validators: ['nonEmpty'],
    writes: ['e2e_project', 'test_tier_smoke'],
    express: false,
    askWhen: 'tests-exist',
    changeLater: `${CONFIGURE} set e2e_project <project> (or test_tier_smoke "<command>")`,
  },
  {
    id: 'Q6',
    group: 'tests',
    prompt: 'Which tests cover your most important journeys?',
    why: 'These critical tests can gate a release without waiting for the whole pack.',
    kind: 'select',
    dynamicChoices: 'the detected critical project or tag',
    choices: [{ value: 'use-smoke', label: 'No, use smoke', consequence: 'A release gate of "critical" falls back to the smoke tests, and the summary says so.' }],
    defaults: [{ rule: 'D', source: 'a Playwright project named critical' }],
    validators: ['nonEmpty'],
    writes: ['test_tier_critical'],
    express: false,
    askWhen: 'tests-exist',
    changeLater: `${CONFIGURE} set test_tier_critical "<command>"`,
  },
  {
    id: 'Q7',
    group: 'tests',
    prompt: 'Is there a full test pack?',
    why: 'The full pack is what presets C and D gate on, and what runs nightly in B, C and D.',
    kind: 'select',
    dynamicChoices: 'the detected regression project or command',
    choices: [{ value: 'no', label: 'No', consequence: 'Presets C and D are not offered; B is the strongest preset.' }],
    defaults: [{ rule: 'D', source: 'a Playwright project named regression' }],
    validators: ['nonEmpty'],
    writes: ['test_tier_full'],
    express: false,
    askWhen: 'tests-exist',
    changeLater: `${CONFIGURE} set test_tier_full "<command>"`,
  },
  {
    id: 'Q8',
    group: 'tests',
    prompt: 'When should the bigger test groups run?',
    why: 'Running more tests before a release catches more but takes longer; running them after catches problems later.',
    kind: 'select',
    parts: [
      {
        id: 'release-pr',
        prompt: 'On the release pull request, which group must pass?',
        kind: 'select',
        choices: [
          { value: 'none', label: 'None', consequence: 'No end-to-end gate on the release pull request.' },
          { value: 'smoke', label: 'Smoke', consequence: 'Only the quick check blocks a release.' },
          { value: 'critical', label: 'Critical', consequence: 'The important journeys block a release.' },
          { value: 'full', label: 'Full', consequence: 'The whole pack blocks a release; the slowest and safest.' },
        ],
        validators: ['tierHasTests'],
        writes: ['e2e_regression_enabled', 'release_gate_tier'],
      },
      {
        id: 'after-deploy',
        prompt: 'After a deploy, run the full pack once?',
        kind: 'select',
        choices: [
          { value: 'full', label: 'Yes, once', consequence: 'Recorded as evidence; it never blocks.' },
          { value: 'nothing', label: 'No', consequence: 'Nothing runs after the deploy; use this when the full pack already gated the release.' },
        ],
        validators: [],
        writes: ['post_deploy_full_regression'],
      },
      {
        id: 'nightly',
        prompt: 'Run the full pack every night?',
        kind: 'select',
        choices: [
          { value: 'off', label: 'Off', consequence: 'No scheduled run.' },
          { value: '0 1 * * *', label: '01:00 UTC', consequence: 'Runs on the integration branch; never blocks; not release evidence.' },
          { value: '0 2 * * *', label: '02:00 UTC', consequence: 'Runs on the integration branch; never blocks; not release evidence.' },
          { value: '0 3 * * *', label: '03:00 UTC', consequence: 'Runs on the integration branch; never blocks; not release evidence.' },
          { value: '0 4 * * *', label: '04:00 UTC', consequence: 'Runs on the integration branch; never blocks; not release evidence.' },
          { value: 'custom', label: 'A cron expression of your own', consequence: 'You type five space-separated fields.' },
        ],
        validators: ['cron5'],
        writes: ['scheduled_full_regression'],
      },
    ],
    defaults: [{ rule: 'P', source: 'the chosen preset' }],
    validators: [],
    writes: ['e2e_regression_enabled', 'release_gate_tier', 'post_deploy_full_regression', 'scheduled_full_regression'],
    express: true,
    askWhen: 'tests-exist',
    changeLater: `${CONFIGURE} (the same questions with your answers as defaults), or ${CONFIGURE} set release_gate_tier <tier>`,
  },
  {
    id: 'Q9',
    group: 'ci',
    prompt: 'Where do tests and builds run?',
    why: "Workflows need a machine to run on: GitHub's, or your own.",
    kind: 'select',
    choices: [
      { value: 'github', label: "GitHub's machines", consequence: 'Workflows run on ubuntu-latest; nothing else to set up.' },
      {
        value: 'self-hosted',
        label: 'Our own machines',
        consequence: 'Workflows run on a self-hosted runner whose label is the CI_RUNNER_LABEL repository variable (set through gh; needs an account allowed to set repository variables, otherwise the exact command is printed).',
      },
    ],
    parts: [
      {
        id: 'runner-label',
        prompt: 'What is the label of your runner?',
        kind: 'text',
        validators: ['nonEmpty'],
        writes: ['variable:CI_RUNNER_LABEL'],
      },
    ],
    defaults: [
      { rule: 'D', source: 'the runs-on of your existing workflows' },
      { rule: 'F', source: "GitHub's machines" },
    ],
    validators: [],
    writes: ['runner', 'variable:CI_RUNNER_LABEL'],
    express: true,
    askWhen: 'always',
    changeLater: `${CONFIGURE} set runner <label>`,
  },
  {
    id: 'Q10',
    group: 'ci',
    prompt: 'What are your branches called?',
    why: 'Every generated workflow takes its branches from these two names.',
    kind: 'text',
    parts: [
      { id: 'integration', prompt: 'Integration branch (where changes land)', kind: 'text', validators: ['nonEmpty'], writes: ['integration_branch'] },
      { id: 'release', prompt: 'Release branch (production)', kind: 'text', validators: ['nonEmpty'], writes: ['release_branch'] },
    ],
    defaults: [
      { rule: 'D', source: 'the branches git has (develop, main)' },
      { rule: 'F', source: 'develop / main' },
    ],
    validators: ['branchesDiffer'],
    writes: ['integration_branch', 'release_branch'],
    express: false,
    askWhen: 'always',
    changeLater: `${CONFIGURE} set integration_branch <name> (and release_branch)`,
  },
  {
    id: 'Q11',
    group: 'approval',
    prompt: 'Who approves a release?',
    why: 'A release is approved by a person; whether that may be its author decides what an auditor sees.',
    kind: 'select',
    choices: [
      {
        value: 'different-person',
        label: 'A different person',
        consequence: 'The approver must differ from the author (enforced). Needs a second admin on the portal. Satisfies the change-management segregation-of-duties clauses.',
      },
      {
        value: 'solo',
        label: 'I approve my own; the gap is recorded',
        consequence: 'Needs a portal that allows a solo approver. The release branch then requires 0 reviews. SOC 2 CC8.1 and ISO 27001 A.8.32 show as not covered, and an auditor will ask for a compensating control.',
      },
    ],
    defaults: [{ rule: 'P', source: 'the chosen preset' }],
    validators: [],
    writes: ['approval.mode', 'release_branch_required_reviews', 'portal:approval_policy'],
    express: true,
    askWhen: 'always',
    changeLater: `${CONFIGURE} set approval.mode <dual_actor|solo_with_gap> (the portal policy is a separate portal action)`,
  },
  {
    id: 'Q12',
    group: 'approval',
    prompt: 'After a deploy, should a person confirm production?',
    why: 'A confirmation gives an explicit record that production was checked; skipping it completes the release automatically.',
    kind: 'select',
    choices: [
      { value: 'yes', label: 'Yes (two recorded clicks)', consequence: 'The release waits for Approve Production and Mark as Released in the portal.' },
      { value: 'no', label: 'No (automatic)', consequence: 'The release completes by itself once the production evidence is in.' },
    ],
    defaults: [{ rule: 'P', source: 'the chosen preset' }],
    validators: [],
    writes: ['production_review.terminal_status'],
    express: true,
    askWhen: 'always',
    changeLater: `${CONFIGURE} set production_review.terminal_status <prod_review|released>`,
  },
  {
    id: 'Q13',
    group: 'standards',
    prompt: 'Which standards do you need evidence for?',
    why: 'The standards you pick decide which preset is suggested and which gaps matter to you.',
    kind: 'multiselect',
    choices: [
      { value: 'none', label: 'None yet', consequence: 'No standard is claimed; you can claim some later.' },
      { value: 'soc-2', label: 'SOC 2', consequence: 'Preset C or D is suggested when a full test pack exists.' },
      { value: 'iso-27001', label: 'ISO 27001', consequence: 'Preset C or D is suggested when a full test pack exists.' },
      { value: 'iso-29119', label: 'ISO 29119', consequence: 'Software testing evidence is tracked against this standard.' },
      { value: 'gdpr', label: 'GDPR', consequence: 'Privacy documents (RoPA, DPIA) are tracked against this standard.' },
      { value: 'eu-ai-act', label: 'EU AI Act', consequence: 'AI-involvement disclosure is tracked against this standard.' },
    ],
    defaults: [
      { rule: 'D', source: 'the standards the portal says the project claims (when reachable)' },
      { rule: 'F', source: 'none yet' },
    ],
    validators: [],
    writes: ['compliance_frameworks', 'portal:claimed_standards'],
    express: true,
    askWhen: 'always',
    changeLater: `${CONFIGURE} set compliance_frameworks <list>`,
  },
  {
    id: 'Q14',
    group: 'access',
    prompt: 'Who else needs portal access?',
    why: 'Each person reads the portal with their own viewer key, so nobody shares credentials.',
    kind: 'confirm',
    defaults: [],
    validators: [],
    writes: [],
    express: false,
    askWhen: 'always',
    changeLater: 'Invite people in the portal; each runs `devaudit join` (docs/credentials.md).',
  },
  {
    id: 'Q15',
    group: 'code',
    prompt: 'Which folders hold your code?',
    why: 'Security scans and requirement checks look only in these folders.',
    kind: 'text',
    dynamicChoices: 'the folders that exist',
    defaults: [{ rule: 'D', source: 'the source folders found' }],
    validators: ['existingDir'],
    writes: ['source_dirs'],
    express: false,
    askWhen: 'always',
    changeLater: `${CONFIGURE} set source_dirs "<folders>"`,
  },
  {
    id: 'Q16',
    group: 'code',
    prompt: 'Are there known security findings today?',
    why: 'Existing findings can be accepted once so that only new ones fail the gate.',
    kind: 'select',
    choices: [
      { value: 'clean', label: 'Start clean', consequence: 'Any finding fails the gate.' },
      { value: 'accept', label: "Accept today's count", consequence: 'The current number of findings is recorded as accepted; only new ones fail.' },
    ],
    defaults: [{ rule: 'F', source: 'start clean' }],
    validators: [],
    writes: ['sast_baseline'],
    express: false,
    askWhen: 'always',
    changeLater: `${CONFIGURE} set sast_baseline <number>`,
  },
  {
    id: 'Q17',
    group: 'tests',
    prompt: 'How do the tests start your app?',
    why: 'End-to-end tests need the app running; this is the command that starts it and the port it listens on.',
    kind: 'text',
    parts: [
      { id: 'command', prompt: 'Command that starts the app', kind: 'text', validators: ['nonEmpty'], writes: ['e2e_start_command'] },
      { id: 'port', prompt: 'Port the app listens on', kind: 'text', validators: ['positiveInt'], writes: ['e2e_port'] },
    ],
    defaults: [{ rule: 'D', source: 'the dev script in package.json, and the port in the Playwright config' }],
    validators: ['nonEmpty'],
    writes: ['e2e_start_command', 'e2e_port'],
    express: false,
    askWhen: 'tests-exist',
    changeLater: `${CONFIGURE} set e2e_start_command "<command>" (and e2e_port)`,
  },
  {
    id: 'Q18',
    group: 'data',
    prompt: 'Where do the tests get their data?',
    why: 'Tests that write data need a place to write it that cannot hurt anyone; the answer decides how safely the regression runs.',
    kind: 'select',
    choices: [
      { value: 'none', label: 'They need no data', consequence: 'No data steps are needed.' },
      { value: 'ephemeral', label: 'A fresh database made for each run', consequence: 'The safest choice: nothing is shared and nothing is left behind.' },
      {
        value: 'shared_serialised',
        label: 'A shared test environment only our tests use, one run at a time',
        consequence: 'Runs queue behind each other (a concurrency group is set), but a person using that environment can still collide with a run.',
      },
      {
        value: 'shared',
        label: 'A shared environment other people also use',
        consequence: 'Recorded as a risk: a run can collide with people, and a killed run can leave data behind. A scheduled or post-deploy regression against it is reported.',
      },
      { value: 'unknown', label: 'I do not know yet', consequence: 'Nothing is written and today\'s behaviour is kept; doctor reports it as a gap you can leave as it is.' },
    ],
    defaults: [
      { rule: 'D', source: 'ephemeral when database_service or e2e_setup_command is set' },
      { rule: 'F', source: 'I do not know yet' },
    ],
    validators: [],
    writes: ['e2e_data_isolation', 'e2e_concurrency_group'],
    express: false,
    expressWhen: 'preset-needs-data',
    askWhen: 'tests-exist',
    changeLater: `${CONFIGURE} set e2e_data_isolation <value>`,
  },
  {
    id: 'Q19',
    group: 'data',
    prompt: 'What command puts the test data in place before a run, and which files hold it?',
    why: 'DevAudit runs your seed command so the tests start from known data, and hashes the files so it can tell when the seed changed.',
    kind: 'text',
    choices: [{ value: 'none', label: 'There is none', consequence: 'No seed step is run.' }],
    parts: [
      { id: 'command', prompt: 'Seed command', kind: 'text', validators: ['nonEmpty'], writes: ['e2e_seed_command'] },
      { id: 'paths', prompt: 'Seed files or folders', kind: 'text', validators: ['existingPath'], writes: ['e2e_seed_paths'] },
    ],
    defaults: [{ rule: 'D', source: 'package.json scripts with "seed" in the name, and scripts/seed* files' }],
    validators: ['nonEmpty'],
    writes: ['e2e_seed_command', 'e2e_seed_paths'],
    express: false,
    askWhen: 'tests-exist',
    changeLater: `${CONFIGURE} set e2e_seed_command "<command>" (and e2e_seed_paths)`,
  },
  {
    id: 'Q20',
    group: 'data',
    prompt: 'What command puts the data back after a run, or clears it before the next one?',
    why: 'A run that is killed part-way leaves shared data dirty; a reset makes the next run start clean.',
    kind: 'text',
    choices: [{ value: 'self-cleaning', label: 'Tests clean up after themselves', consequence: 'No reset step is run; a killed run can leave data behind.' }],
    defaults: [{ rule: 'F', source: 'tests clean up after themselves' }],
    validators: ['nonEmpty'],
    writes: ['e2e_reset_command'],
    express: false,
    askWhen: 'data-needs-reset',
    changeLater: `${CONFIGURE} set e2e_reset_command "<command>"`,
  },
  {
    id: 'Q21',
    group: 'data',
    prompt: 'Do any tests need a logged-in test user?',
    why: 'Tests that log in run in a separate, report-only step so a flaky login never blocks a merge.',
    kind: 'select',
    choices: [
      { value: 'yes', label: 'Yes', consequence: 'You choose which Playwright projects need the login; the project that signs in runs as their dependency and is not listed.' },
      { value: 'no', label: 'No', consequence: 'No authenticated step is run.' },
    ],
    parts: [{ id: 'projects', prompt: 'Which Playwright projects need the login?', kind: 'multiselect', validators: ['nonEmpty'], writes: ['e2e_projects'] }],
    defaults: [
      { rule: 'D', source: 'the Playwright projects that declare a dependencies entry on a setup project' },
      { rule: 'F', source: 'no' },
    ],
    validators: [],
    writes: ['e2e_projects'],
    express: false,
    askWhen: 'tests-exist',
    changeLater: `${CONFIGURE} set e2e_projects <list>`,
  },
];

/** Keys in `sdlc-config.json` that no question writes, each with the reason. Every other key is written by a question. */
export const NOT_ASKED: Readonly<Record<string, string>> = {
  onboarding_preset: 'written by choosing a preset (or custom), not by a question',
  deploy_command: 'custom host only; set by `configure set` when host custom asks for it (`doctor` names what is missing)',
  deploy_secrets: 'custom host only; set by `configure set` (`doctor` names what is missing)',
  deployed_sha_url: 'custom host only; set by `configure set`',
  deployed_sha_jq: 'custom host only; set by `configure set`',
  deploy_trigger: 'custom host only; set by `configure set`',
  install_flags: 'advanced; set by `configure set` when a lockfile needs special npm flags',
  database_service: 'advanced; Q18 reads it as a signal that the tests use a disposable database; set by `configure set`',
  database_image: 'advanced; set by `configure set` together with database_service',
  database_port: 'advanced; set by `configure set` together with database_service',
  database_env: 'advanced; set by `configure set` together with database_service',
  app_env: 'advanced; environment values are set by `configure set`',
  build_env: 'advanced; environment values are set by `configure set`',
  typescript_check_env: 'advanced; set by `configure set`',
  e2e_setup_command: 'advanced; the command that stands up a disposable database; Q18 reads it as a signal; set by `configure set`',
  e2e_env: 'advanced; environment values are set by `configure set`',
  e2e_regression_timeout_minutes: 'advanced; set by `configure set`',
  e2e_concurrency_cancel_in_progress: 'advanced; set by `configure set`',
  test_feature_command: 'advanced; set by `configure set`',
  paths_ignore: 'advanced; set by `configure set`',
  e2e_preflight_command: 'set by `configure set`; advanced',
  e2e_leak_check_command: 'set by `configure set`; advanced',
  e2e_max_skipped: 'set by `configure set`; advanced',
  feature_e2e_projects: 'set by `configure set`; advanced',
};

export function questionById(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}

/** Every configuration key a question writes (not the portal settings, secrets and variables). */
export function askedConfigKeys(): string[] {
  const keys = new Set<string>();
  for (const q of QUESTIONS) {
    for (const w of q.writes) if (!w.includes(':')) keys.add(w);
    for (const part of q.parts ?? []) for (const w of part.writes) if (!w.includes(':')) keys.add(w);
  }
  return [...keys];
}

/** What a condition looks at. */
export interface ConditionState {
  /** Q4 is not "not yet": the project has automated end-to-end tests. */
  readonly testsExist: boolean;
  /** The answer to Q18 (or the configured `e2e_data_isolation`), if any. */
  readonly dataIsolation?: string | undefined;
  /** The preset chosen so far. */
  readonly preset?: PresetId | 'custom' | undefined;
}

/** Whether a question's condition holds for the answers so far. */
export function conditionHolds(id: ConditionId, state: ConditionState): boolean {
  switch (id) {
    case 'always':
      return true;
    case 'tests-exist':
      return state.testsExist;
    case 'data-needs-reset':
      return state.testsExist && state.dataIsolation !== undefined && state.dataIsolation !== 'none' && state.dataIsolation !== 'ephemeral' && state.dataIsolation !== 'unknown';
    case 'preset-needs-data':
      return state.testsExist && (state.preset === 'B' || state.preset === 'C' || state.preset === 'D') && (state.dataIsolation === undefined || state.dataIsolation === 'unknown');
  }
}

/** The questions to ask for the answers so far, in order; `express` limits them to the express path. */
export function questionsToAsk(state: ConditionState, options: { readonly express?: boolean } = {}): Question[] {
  return QUESTIONS.filter((q) => {
    if (!conditionHolds(q.askWhen, state)) return false;
    if (!options.express) return true;
    return q.express || (q.expressWhen !== undefined && conditionHolds(q.expressWhen, state));
  });
}
