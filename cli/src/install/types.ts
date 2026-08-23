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
   */
  readonly addTarget: boolean;
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
  host: 'railway';
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
}

export interface DetectedStack {
  readonly stack: 'node' | 'python';
  readonly workingDirectory: string;
}
