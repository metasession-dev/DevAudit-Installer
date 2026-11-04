export type StepStatus = 'ok' | 'warn' | 'skipped' | 'fail' | 'planned';

export interface StepResult {
  readonly step: string;
  readonly status: StepStatus;
  readonly message?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * Whether the current `install` invocation is the **operator** setting up a
 * fresh (or rotating an existing) project, or a **developer** joining an
 * already-onboarded one. In `'developer'` mode the destructive steps (write
 * sdlc-config, issue API key, set GitHub secrets, apply branch protection)
 * skip themselves to avoid silently rotating the team's CI token / re-issuing
 * keys / re-applying branch protection.
 *
 * Auto-detected after the project + key probes (find-or-create + issueApiKey)
 * — see `detectInstallMode()` in `index.ts`. Overridable via
 * `RunInstallOptions.mode` (used by the `devaudit join` subcommand) or forced
 * back to `'operator'` via `RunInstallOptions.forceTeamConfig`.
 */
export type InstallMode = 'operator' | 'developer';

export interface InstallContext {
  readonly projectPath: string;
  /**
   * The git repository's top-level directory — `projectPath` itself for a
   * single-target repo, but its parent (or further up) for a target living
   * in a polyglot-monorepo subdirectory (#689). Steps that write files an
   * external tool reads from a fixed repo-root-relative location
   * (`.github/workflows`, `.github/ISSUE_TEMPLATE`, `.husky`,
   * `.pre-commit-config.yaml`, `.devin/workflows`) must use this, not
   * `projectPath`. See `resolveRepoRoot()`.
   */
  readonly repoRoot: string;
  readonly projectName: string;
  readonly installerRoot: string;
  readonly token: string;
  readonly baseUrl: string;
  readonly dryRun: boolean;
  readonly nonInteractive: boolean;
  /**
   * When the repo already has an `sdlc-config.json` describing a *different*
   * target (different working directory / project slug — a polyglot
   * monorepo scenario, see #689), `writeSdlcConfig` normally refuses rather
   * than clobbering it. Passing `--add-target` appends the new target
   * instead. Re-running install against the *same* target (rotation) is
   * unaffected either way.
   *
   * DEPRECATED (see docs/onboarding.md's "Polyglot monorepos" section):
   * `writeSdlcConfig` now also refuses `--add-target` outright when the
   * existing config doesn't already have a real `targets` array — no new
   * adoption of this mechanic, only continued use by the one consumer
   * (`example-monorepo`) still on it.
   */
  readonly addTarget: boolean;
  /**
   * Issue the person's own read-only, project-scoped `viewer`-role API key and
   * save it to `~/.config/devaudit/viewer-keys.json` (devaudit-installer#1099).
   * On by default; `--no-viewer-key` opts out. Never written to the repo or a
   * repo secret, and never granted upload or approval rights.
   */
  readonly issueViewerKey: boolean;
  /** Print the viewer key once at the end of the run (`--print-viewer-key`). */
  readonly printViewerKey: boolean;
  /**
   * Host adapter requested with `--host` (devaudit-installer#1022). Undefined
   * means: keep the host already in `sdlc-config.json`, else the default.
   */
  readonly host?: string;
  /**
   * Test tier / release gate flags by `sdlc-config.json` key (devaudit-installer#1059,
   * #1060). Raw strings, validated like `devaudit configure set`; absent keys are
   * never written.
   */
  readonly testOptions?: Readonly<Record<string, string>>;
  /** `--preset <A|B|C|D|custom>` (devaudit-installer#1116 WP6); validated before anything is touched. */
  readonly preset?: string;
  /** `--from-scan <file|report-id>`: a scan report to take the suggested preset and standards from. */
  readonly fromScan?: string;
  /** The parsed `--from-scan` report (validated before anything is touched). */
  readonly scanHints?: import('./scan-hints.js').ScanHints;
  /** `devaudit join`: no registry question is asked and no policy or preset is written. */
  readonly joining?: boolean;
  /**
   * Set to `'developer'` only AFTER the orchestrator's mode-detection runs
   * (between step 6 and step 7); the steps that run before that point (1–6)
   * see `'operator'` and proceed as usual. The destructive steps (7, 9) and
   * the done report (11) consult this to decide whether to skip + which copy
   * to print.
   */
  readonly installMode: InstallMode;
}

export interface InstallPlan {
  stack: 'node' | 'python';
  /** A host adapter name under `sdlc/files/hosts/` (railway, vercel, custom, ...). */
  host: string;
  projectSlug: string;
  runtimeVersion: string;
  sourceDirs: string;
  workingDirectory: string;
  prodUrlSecretName: string;
  prodUrlValue: string;
  /**
   * Name of the GitHub repo secret this target's DevAudit API key is stored
   * under. Defaults to `'DEVAUDIT_API_KEY'` for the single-target case
   * (unchanged from pre-#689 behaviour). For `--add-target`, GitHub repo
   * secrets are repo-scoped (not per-directory), so a second target reusing
   * that literal name would silently overwrite the first target's key —
   * `collectPlan` derives a collision-free name from the new target's slug
   * instead. See #694.
   */
  apiKeySecretName: string;
  projectId?: string;
  apiKey?: string;
  /**
   * A viewer-key repo secret name already recorded in `sdlc-config.json`
   * (`viewer_api_key_secret`). Only carried through so an existing value is
   * not dropped on a rewrite: no new one is created and nothing writes the
   * secret (#1099; no CI workflow reads it).
   */
  viewerApiKeySecretName?: string;
  viewerApiKey?: string;
  /**
   * Test tier / release gate keys to write (from flags or confirmed prompts).
   * Empty or absent means: leave the existing config and today's defaults alone.
   */
  testConfig?: Record<string, unknown>;
  /** Things to tell the operator about the test tier choices (printed in the summary). */
  testNotes?: readonly string[];
  /** What the guided onboarding decided (devaudit-installer#1116 WP6); absent when no preset or registry answer applies. */
  onboarding?: OnboardingPlan;
}

export interface OnboardingPlan {
  /** Recorded as `onboarding_preset`; null when none was chosen and the config is kept. */
  readonly preset: string | null;
  /** Dotted config keys to write on top of the existing config. */
  readonly config: Readonly<Record<string, unknown>>;
  /** Dotted config keys of other presets to remove. */
  readonly removeKeys: readonly string[];
  /** The approval policy to set on the portal (tier B). */
  readonly policyToSet: 'independent' | 'self_allowed_with_gap' | null;
  /** The standards the person needs evidence for. */
  readonly frameworks: readonly string[];
  /** The standards the portal already lists for the project; null when it cannot say. */
  readonly portalStandards: readonly string[] | null;
  /** The label of the self-hosted runner, written as the `CI_RUNNER_LABEL` repository variable. */
  readonly runnerLabel?: string;
  /** No smoke tests were found: the closing lines describe the way to a gated release. */
  readonly noSmokeTests?: boolean;
  /** Preset A could be offered (a portal that allows a solo approver); false names `custom` in the closing lines. */
  readonly presetAOffered?: boolean;
}

export interface DetectedStack {
  readonly stack: 'node' | 'python';
  readonly workingDirectory: string;
}
