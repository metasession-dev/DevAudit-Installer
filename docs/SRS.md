# Software Requirements Specification — DevAudit-Installer (CLI + Framework, E2E-oriented)

> **Status:** Living document. Reverse-engineered from the codebase at `origin/main` (`a0f7b0f`, 2026-06).
> **Audience:** CLI/framework developers and Claude Code's `e2e-test-engineer` skill.
> **Purpose:** A single black-box description of the two deliverables this repo ships — the `devaudit` CLI and the SDLC framework templates — so any developer (or agent) can pick a command, template, or skill and write a passing E2E / integration test **without re-reading the source**.

## 0. About this document

This repo carries **two** observable surfaces, both specified here:

1. **The `devaudit` CLI** (`cli/`, `plugin-sdk/`, `plugins/*`) — a published npm package. Each command is testable from the outside via `bin/devaudit.js` invocation → **stdout/stderr + exit code + filesystem deltas in the consumer repo + HTTP calls to the portal**.
2. **The framework templates** (`sdlc/files/`) — stage docs, six skills, CI workflow templates, and per-stack/per-host adapters. Their observable behaviour is **"the files rendered into a consumer on `install`/`update` contain what that consumer's CI + AI agents expect."**

**Conventions**

- **Requirement IDs:** `REQ-CLI-<COMMAND>-NNN` for CLI behaviour; `REQ-SKILL-<NAME>-NNN` for skills; `REQ-FRAMEWORK-<AREA>-NNN` for templates/adapters/rule-files. IDs are stable — append, never renumber.
- **Acceptance criteria:** Given / When / Then against observable state (stdout text, exit code, files written/changed, HTTP calls, rendered file content).
- **Priority (MoSCoW):** `Must` (smoke suite) · `Should` (critical suite) · `Could` (regression) · `Won't` (excluded this cycle — e.g. unbuilt `org`/`config`/`upgrade` stubs). Priority also signals suggested test order.
- **Source:** each requirement cites the file(s)/function(s) it derives from — where to look when a test fails, not part of the contract.
- **Ambiguities & likely-unintended behaviour** are in **Appendix A** and per-area at the end of each §4 subsection — flagged, never papered over. Where a requirement documents current-but-suspect behaviour, the Given/When/Then describes _what the code does today_.

**How this was produced.** Inventory first (this section), the test stack identified by inspection (§2), then requirements extracted per command/template/skill against the live source. No requirement is invented; unsupported intent is an assumption, not a requirement.

---

## 1. Codebase Inventory

### 1.1 Stack

| Concern          | Technology                                                         | Notes                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI package      | **`@metasession.co/devaudit-cli` v0.1.54**, ESM, **Node ≥ 22**     | `bin: { devaudit: ./bin/devaudit.js }`; the bin `import()`s built `dist/`                                                                                                        |
| Command parser   | **commander**                                                      | global flags + nested command groups (`auth`, `plugin`, `org`, `config`)                                                                                                         |
| Prompts / output | **@clack/prompts**, **consola**                                    | interactive onboarding + logging                                                                                                                                                 |
| Process / paths  | **execa** (shelling out to `git`, `gh`, `npm`), **env-paths**      | `~/.config/devaudit/` for auth + plugins                                                                                                                                         |
| Plugins          | **`@metasession.co/devaudit-plugin-sdk` v0.1.54**                  | lifecycle hooks: `beforeSync`/`afterSync`, `beforePush`/`afterPush`, `onDoctor`; first-party plugins: `devaudit-plugin-prisma`, `devaudit-plugin-evidence-export` (both v0.1.54) |
| Build            | **tsup** (`prepack` = `build` + `bundle:templates`)                | `bundle:templates` snapshots `sdlc/files/` into the published tarball                                                                                                            |
| Tests            | **vitest 4.1.x** (`cli/test/*.test.ts`), **msw 2.x** (portal HTTP) | unit/integration only — see §2                                                                                                                                                   |
| Templates        | `sdlc/files/` — stage docs, skills, CI templates, adapters         | resolved at runtime via `DEVAUDIT_INSTALLER_ROOT` override or the bundled snapshot                                                                                               |

### 1.2 CLI command surface (`cli/src/commands/*`, registered in `cli/src/index.ts`)

| Command                                      | Status                                                  | Source                                 |
| -------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| `install [path]`                             | **operator onboarding** (11-step)                       | `commands/install.ts` + `install/*`    |
| `join [path]`                                | second-dev entry (skips destructive steps)              | `commands/join.ts`                     |
| `update [version] [paths...]`                | multi-consumer template sync                            | `commands/update.ts` + `update/*`      |
| `push <slug> <req> <type> <file>`            | evidence upload (port of `scripts/upload-evidence.sh`)  | `commands/push.ts`, `lib/ci-upload.ts` |
| `auth login \| logout \| status`             | PAT cache at `~/.config/devaudit/auth.json` (mode 0600) | `lib/auth.ts`                          |
| `plugin install \| list \| remove \| update` | plugin store at `~/.config/devaudit/plugins/`           | plugin commands                        |
| `bootstrap-governance [path]`                | opt-in governance starter drop (v0.1.36+)               | `install/bootstrap-governance.ts`      |
| `doctor`                                     | environment check (tools on PATH)                       | `commands/doctor.ts`                   |
| `status [path]`                              | sdlc-config + framework-file presence                   | `commands/status.ts`                   |
| `upgrade`                                    | **stub** (prints "not implemented" → exit 1)            | `commands/stub.ts`                     |
| `org …`, `config …`                          | **stubs** (workstream B; tracked-in message)            | `commands/stub.ts`                     |

**Global flags** (`--json`, `-y/--yes`, `--dry-run`, `-v/--verbose`, `--no-color`, `--org <slug>`) are registered on the root program; `--org` is currently parse-only/inert.

### 1.3 Framework template surface (`sdlc/files/`)

- **Six skills** (`_common/skills/*/SKILL.md`): `sdlc-implementer` (orchestrator, stages 1–5), `e2e-test-engineer`, `governance-doc-author`, `requirements-aligner`, `adr-author`, `risk-register-keeper`. Synced to the consumer's `.claude/skills/`.
- **CI workflow templates** (`ci/*.yml.template`): the five core — `ci.yml`, `compliance-evidence.yml`, `compliance-validation.yml`, `check-release-approval.yml`, `post-deploy-prod.yml` — plus secondary `ci-status-fallback`, `close-out-release`, `incident-export`, `label-retention` (incident label enforcement, #210), `periodic-review`, `feature-e2e` (feature-branch in-scope E2E, issue #174), and a `ci/python/` override.
- **Adapters:** stacks `node` + `python` (`adapter.json` + `hooks/` + node `scripts/`), host `railway` (`adapter.json`). `_schema/adapter.schema.json` enforced at runtime via Ajv (`cli/src/lib/adapter.ts`).
- **Governance starters** (`_common/governance/*.md.template`): `ai-disclosure`, `dpia`, `incident-report`, `nil-incident-report` (per-release "no incidents" attestation, #210), `periodic-review`, `risk-register`, `ropa` — opt-in via `bootstrap-governance`.
- **Single-source-of-truth AI rule files** synced per agent: `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `GEMINI.md`, `INSTRUCTIONS.md` — content sourced from `sdlc/ai-rules/INSTRUCTIONS-SDLC.md` (the canonical `INSTRUCTIONS.md` holds the content; the others point to it).
- **Stage + Tier-1 docs:** `_common/0-project-setup.md … 5-deploy-main.md`, `Test_Policy.md`, `Test_Strategy.md`, `Test_Architecture.md`, `Periodic_Security_Review_Schedule.md` — synced verbatim.

### 1.4 External dependencies an E2E run must stand up, seed, or stub

| Dependency                                                                                                                                                               | Used by                                              | E2E strategy                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| DevAudit **portal HTTP API** (PAT validation `GET /api/projects`, project create, CI-key issuance, evidence `POST /api/evidence/upload`, `GET /api/ci/releases/resolve`) | `install`, `push`, `auth`, `doctor`, CI templates    | **msw** stub (unit) or a local HTTP stub at `DEVAUDIT_BASE_URL` (CLI-E2E)               |
| **`gh`** CLI                                                                                                                                                             | `install`/`join` (GitHub secrets, branch protection) | `vi.mock('execa')` (unit) or an on-disk `gh` shim on `PATH` (CLI-E2E)                   |
| **`git`**                                                                                                                                                                | most commands (repo detection, provider)             | real `git init` fixture repo or execa mock                                              |
| **`npm`**                                                                                                                                                                | `update` (stack dev-deps), `plugin update`           | mock or allow in a sandboxed fixture                                                    |
| **husky** (node) / **pre-commit** (python)                                                                                                                               | `hooks-bootstrap`, stack hooks                       | assert installed hook files exist                                                       |
| Bundled `sdlc/files/`                                                                                                                                                    | `install`/`update`/`bootstrap-governance`            | set `DEVAUDIT_INSTALLER_ROOT` to the repo root, or run `npm run bundle:templates` first |

### 1.5 Existing test setup (summary — full detail in §2)

- **Unit/integration:** **vitest 4.1.x**, `cli/test/*.test.ts` (10 files). 8 import the action function directly (`runInstall`, `syncProject`, …) and assert a returned report + the fixture filesystem; `status.test.ts` + `doctor.test.ts` spawn the real `bin/devaudit.js` via **execa** (requires a prior `npm run build`). Portal HTTP is stubbed with **msw** (`DEVAUDIT_BASE_URL` → mock); `gh`/`git` via `vi.mock('execa')` or an injected fake provider; fixtures are `fs.mkdtemp` temp repos; templates resolve via `DEVAUDIT_INSTALLER_ROOT`.
- **CI:** `.github/workflows/cli.yml` — matrix `{ubuntu, macos, windows} × node 22`: build `plugin-sdk` → install → `tsc --noEmit` → `npm run build` → `npm test` → `--help`/`--version` smoke. `release.yml` — tag-triggered; publishes the four packages in dependency order; `prepack` makes the CLI tarball self-contained.
- **No true CLI-E2E layer exists** in this repo. The "real `install`/`update` against the wgb / META-JOBS consumers" coverage is **manual/external**, not encoded here. `docs/e2e-local-db-ci.md` concerns the E2E gate the CLI _generates inside consumers_, not the binary's own tests. §2 records the truth and a recommended CLI-E2E approach.

---

## 2. E2E Testing Stack

This section documents the test stack for the `devaudit` CLI as it actually exists
in the repo (`cli/`), so a developer or Claude Code's `e2e-test-engineer` can add a
new CLI test that matches the established conventions. Everything below was confirmed
from source; file paths are absolute under
`/home/william/Documents/SoftwareProjects/Metasession/DevAudit-Installer`.

### Frameworks & versions

The CLI test stack is **Vitest-based** — there is no Jest, Playwright, or Cucumber in
the CLI package (those belong to the _consumer_ projects the CLI onboards, not to the
CLI itself).

| Tool         | Range (`cli/package.json`) | Locked (`cli/package-lock.json`) | Role                                                                            |
| ------------ | -------------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| `vitest`     | `^4.1.6`                   | **4.1.6**                        | unit/integration test runner (`test = vitest run`)                              |
| `msw`        | `^2.7.0`                   | **2.14.6**                       | HTTP mocking of the DevAudit portal API (`msw/node` `setupServer`)              |
| `tsup`       | `^8.3.5`                   | **8.5.1**                        | bundler — `build` emits `dist/index.js` (ESM, `target: node22`, shebang banner) |
| `execa`      | `^9.5.1` (runtime dep)     | **9.6.1**                        | child-process exec; mocked in unit tests, used for real in subprocess tests     |
| `typescript` | `^5.7.2`                   | **5.9.3**                        | `typecheck = tsc --noEmit`                                                      |
| node engine  | `>=22` (`engines.node`)    | —                                | CI runs node `22` only                                                          |

- There is **no `tsx`** dependency in `cli/package.json` (it appears transitively in
  the lockfile only). Tests are TypeScript (`test/**/*.test.ts`) and Vitest transpiles
  them in-process — they are **not** pre-compiled.
- Config files: `cli/vitest.config.ts` (`environment: 'node'`, `include: ['test/**/*.test.ts']`,
  coverage over `src/**/*.ts`), `cli/tsup.config.ts`, `cli/tsconfig.json`.
- `plugin-sdk/`, `plugins/devaudit-plugin-prisma/`, and `plugins/devaudit-plugin-evidence-export/`
  use the **same** stack (`test = vitest run`, `vitest@^4.1.6`, `tsup`) with their own
  `test/*.test.ts` suites (e.g. `plugin-sdk/test/{lifecycle,manifest,types}.test.ts`).

### How tests are structured today

There are **10 test files** in `cli/test/`. The dominant convention is **direct
import of the action/handler function** (not a subprocess), with `execa` and the portal
mocked. Only two files spawn the real binary.

| Test file                    | Invocation style                                                                                                                                       | What it covers                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `install.test.ts`            | direct: `await import('../src/install/index.js')` → `runInstall(opts)`                                                                                 | full install flow, dry-run, dev-mode detection, 401 handling, config preservation          |
| `update.test.ts`             | direct: `import { syncProject } from '../src/update/index.js'`                                                                                         | template sync, idempotency, CI `ci.yml` rendering, e2e step injection, unknown-stack error |
| `join.test.ts`               | direct: `await import('../src/commands/join.js')` → `runJoinCommand(opts)`                                                                             | second-dev gating (`exit 7` when no `sdlc-config.json`)                                    |
| `flag-polish.test.ts`        | direct: `runAuthStatus` / `runStatus` / `runPush` from `../src/commands/...`                                                                           | `--json` output shape, `--dry-run`, `not_onboarded` exit 7                                 |
| `plugin.test.ts`             | direct: `discoverPlugins`, `loadPluginFromDir`, `runHook`, `registerPluginCommands` from `../src/lib/plugin/index.js`                                  | plugin discovery, hook isolation, command registration                                     |
| `plugin-commands.test.ts`    | direct: `runPluginList/Install/Remove/Update` from `../src/commands/plugin/*.js`                                                                       | plugin lifecycle commands (clone/pull/remove)                                              |
| `git-provider.test.ts`       | direct: `GitHubProvider` from `../src/lib/git-provider/github.js` + `classifyRemoteUrl`                                                                | `gh`-CLI-preferred path + REST fallback                                                    |
| `evidence-shot-core.test.ts` | direct: pure functions imported from the **shipped skill reference** `../../sdlc/files/_common/skills/e2e-test-engineer/references/evidence-shot-core` | input validation, filename composition                                                     |
| **`status.test.ts`**         | **subprocess: `execa('node', [BIN, 'status', dir], { reject: false })`**                                                                               | end-to-end binary smoke against `bin/devaudit.js`                                          |
| **`doctor.test.ts`**         | **subprocess: `execa('node', [BIN, ...], { reject: false })`**                                                                                         | `--help`, `--version`, `doctor`, stubbed `org list`                                        |

So the repo already contains a thin **CLI-subprocess layer** in `status.test.ts` and
`doctor.test.ts`. They compute the binary path the same way:

```ts
const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, "..", "bin", "devaudit.js");
// ...
const result = await execa("node", [BIN, "status", fixtureDir], {
  reject: false,
});
expect(result.exitCode).toBe(0);
expect(result.stdout + result.stderr).toContain("fixture-app");
```

Note `bin/devaudit.js` simply `import()`s `../dist/index.js` — so **any subprocess
test requires `npm run build` to have run first** (CI builds before `npm test`; see
below). Assertions on the subprocess path consistently check `result.exitCode` plus
`result.stdout + result.stderr` substring matches (stderr is folded in because Consola
logs to stderr). Specific exit codes are load-bearing and asserted: `7` = not onboarded
(`status`/`join`), `6` = doctor tool-gate failure, `2` = plugin-not-found.

The dominant **direct-import** convention reads, e.g. (`install.test.ts:166`):

```ts
it("full run writes sdlc-config.json, creates project, issues key, sets secrets, syncs", async () => {
  const { runInstall } = await import("../src/install/index.js");
  const dir = await buildNodeFixture();
  await fs.writeFile(
    join(dir, "sdlc-config.json"),
    JSON.stringify({
      project_slug: "fixture-app",
      stack: "node",
      host: "railway",
      node_version: "20",
    }),
  );
  const report = await runInstall({
    path: dir,
    dryRun: false,
    nonInteractive: true,
    provider: makeFakeProvider(),
  });
  const stepByStart = (s: string) =>
    report.steps.find((x) => x.step.startsWith(s));
  expect(stepByStart("4/")?.status).toBe("ok");
  const written = JSON.parse(
    await fs.readFile(join(dir, "sdlc-config.json"), "utf-8"),
  );
  expect(written.integration_branch).toBe("develop");
}, 60_000);
```

Conventions to mirror:

- `describe(<symbol-or-command> — <one-line behaviour>)`, BDD-style `it('<does X>')`.
- Action fns return a structured **report** object (e.g. `report.steps[]` with `.status`
  of `ok | warn | skipped | planned`); tests assert against that, plus the filesystem.
- Every fs-touching test gets a per-test timeout of **`30_000` or `60_000` ms** as the
  third arg to `it(...)` (tmp-dir + sync work is slow).
- `nonInteractive: true` is passed to bypass `@clack/prompts`; the `--yes` path requires
  a pre-seeded `sdlc-config.json`.

### Mocking & fixtures

**Portal HTTP — mocked with MSW (`msw/node`).** Confirmed in `install.test.ts`,
`join.test.ts`, `git-provider.test.ts`, and `flag-polish.test.ts`. Pattern:

```ts
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const BASE_URL = "https://devaudit.test";
const handlers = [
  http.get(`${BASE_URL}/api/projects`, () => HttpResponse.json([])),
  http.post(`${BASE_URL}/api/projects`, async ({ request }) => {
    const body = (await request.json()) as { slug: string; name: string };
    return HttpResponse.json(
      { id: "…", slug: body.slug, name: body.name },
      { status: 201 },
    );
  }),
  http.get(`${BASE_URL}/api/projects/:id/api-keys`, () =>
    HttpResponse.json([]),
  ),
  http.post(`${BASE_URL}/api/projects/:id/api-keys`, () =>
    HttpResponse.json(
      {
        id: "key-1",
        name: "Onboarding-issued",
        plainTextKey: "dak_test_plain",
      },
      { status: 201 },
    ),
  ),
];
const server = setupServer(...handlers);

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" }); // any un-stubbed request FAILS the test
  process.env["DEVAUDIT_USER_TOKEN"] = "mctok_test_fixture";
  process.env["DEVAUDIT_BASE_URL"] = BASE_URL; // point the CLI at the mock origin
});
afterEach(() => server.resetHandlers(...handlers)); // per-test overrides via server.use(...)
afterAll(() => {
  server.close(); /* delete env vars */
});
```

Key idioms: `onUnhandledRequest: 'error'` (a stray real HTTP call is a hard failure);
per-test overrides via `server.use(http.get(... 401 ...))` (e.g. the "PAT rejected /
HTTP 401" case at `install.test.ts:296`); the CLI is pointed at the mock by setting
`DEVAUDIT_BASE_URL`. `git-provider.test.ts` additionally mocks `api.github.com` REST
endpoints to exercise the gh-less fallback path.

**`gh` CLI + child processes — mocked with `vi.mock('execa', …)`.** `msw` cannot
intercept the `gh` binary, so command tests replace `execa` with a fake that records
calls and returns canned `{ exitCode, stdout, stderr }` keyed on `(file, args)`:

```ts
const execaCalls: { file: string; args: readonly string[] }[] = [];
vi.mock("execa", () => ({
  execa: async (
    file: string,
    args: readonly string[] = [],
    _opts: unknown = {},
  ) => {
    execaCalls.push({ file, args });
    if (file === "which" || file === "where")
      return { exitCode: 0, stdout: `/usr/bin/${args[0]}`, stderr: "" };
    if (file === "gh" && args[0] === "repo" && args[1] === "view")
      return { exitCode: 0, stdout: "metasession-dev/fixture-app", stderr: "" };
    if (file === "gh") return { exitCode: 0, stdout: "", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  },
}));
```

Tests then assert on the recorded `execaCalls` (e.g. `git-provider.test.ts` checks
`setSecret` piped the value via `opts.input` over stdin). `git-provider.test.ts` also
flips module-level flags (`ghAvailable`, `ghRepoViewStdout`, `ghSecretListStdout`) and
calls `resetGhAvailabilityCache()` in `afterEach` to toggle the gh-present vs gh-missing
branches.

**Git provider — also faked at the object level.** `install.test.ts`/`join.test.ts`
inject `provider: makeFakeProvider()` (a hand-rolled object implementing
`getRepoMeta/setSecret/setVariable/hasSecret/applyBranchProtection/createPullRequest`)
that records `providerCalls[]`. This is the cleanest seam for asserting _which_ secrets
and branch-protection calls were made without touching `gh` at all. Dev-mode tests use a
`makeOnboardedProvider()` variant whose `hasSecret` returns `true`.

**Fixture consumer repos — real tmp dirs.** Every fs test builds a throwaway consumer
with `fs.mkdtemp(join(tmpdir(), 'cli-install-fixture-'))`, writes a `package.json`
(with the node-stack `devDependencies` pre-seeded so `syncStackDeps` reports "all
present" and never shells out to npm) and/or a seeded `sdlc-config.json`, `mkdir`s
`.husky/`, `scripts/`, `.github/workflows/`, runs the action, asserts on emitted files,
and `fs.rm(dir, { recursive: true, force: true })` in `finally`. A python fixture would
write `pyproject.toml` instead (stack detection keys off these two files; absence throws
`Could not detect stack`).

**Bundled-templates resolution in tests.** The unit suites do **not** run
`bundle:templates`. Instead they set `process.env['DEVAUDIT_INSTALLER_ROOT']` to the
repo root so `resolveInstallerRoot()` (`cli/src/lib/installer-root.ts`) reads the
**canonical** `sdlc/files/` directly from the checkout:

```ts
const INSTALLER_ROOT = resolve(HERE, "..", ".."); // install/update.test.ts → repo root
process.env["DEVAUDIT_INSTALLER_ROOT"] = INSTALLER_ROOT; // priority-1 override
```

`resolveInstallerRoot()` resolves in priority order: (1) `DEVAUDIT_INSTALLER_ROOT`,
(2) the package's own bundled snapshot (`cli/sdlc/`, produced by `bundle:templates` at
`prepack`), (3) the repo root (`cli/dist/index.js` → `../..`). The sentinel is the
presence of `sdlc/files`. The subprocess tests (`status`/`doctor`) don't touch templates,
so they need no override.

### How to run

**Local.**

```bash
cd cli
npm install --legacy-peer-deps   # plugin-sdk is a file: dep — build it first if needed
npm run build                    # tsup → dist/index.js (REQUIRED before subprocess tests run the bin)
npm test                         # = vitest run (all 10 files)
npm run test:watch               # = vitest (watch)
npx vitest run test/install.test.ts   # a single file
npm run typecheck                # = tsc --noEmit
```

**CI — `.github/workflows/cli.yml`** (triggers on push to `main` and on PRs touching
`cli/**`, `plugin-sdk/**`, or the workflow). Matrix: **`{ubuntu-latest, macos-latest,
windows-latest} × node 22`**, `fail-fast: false`, `shell: bash`, `working-directory:
cli`. Steps, in order:

1. `actions/checkout@v4`; `actions/setup-node@v4` (node 22, npm cache keyed on `cli/package-lock.json`).
2. Build **`plugin-sdk`** first (`npm install --legacy-peer-deps && npm run build`) — the
   CLI depends on it via `file:../plugin-sdk`.
3. `npm install --legacy-peer-deps` (in `cli/`).
4. **TypeScript:** `npx tsc --noEmit`.
5. **Build:** `npm run build` (so `bin/devaudit.js` can load `dist/`).
6. **Test:** `npm test` (Vitest).
7. **Smoke:** `node ./bin/devaudit.js --help` and `… --version`.

There is **no coverage gate, lint step, or `bundle:templates` step in CI** — typecheck +
build + vitest + the two smoke invocations are the full gate. `plugin-sdk.yml`,
`plugin-prisma.yml`, `plugin-evidence-export.yml` mirror this shape for their packages.

**Release / npm-publish path — `.github/workflows/release.yml`** (triggers on a
`v[0-9]+.[0-9]+.[0-9]+` tag push, or `workflow_dispatch` with a `version` input).
Publishes **4 packages** in dependency order:

1. `plugin-sdk` → install + build + `npm publish --provenance --access public`.
2. Rewrite `file:../plugin-sdk` → `^X.Y.Z` (the just-published version) in all 3
   dependents via `jq` (in-place, never committed back).
3. `cli` → `npm install --legacy-peer-deps && npm run build && npm publish --provenance …`.
   Publishing triggers npm's **`prepack`** lifecycle = `npm run build && npm run
bundle:templates`, which (a) re-bundles `dist/` and (b) copies the repo-root `sdlc/`
   and `scripts/upload-evidence.sh` into the package (`cli/tools/bundle-templates.mjs`),
   so the published tarball is self-contained (`files: [bin, dist, sdlc, scripts, …]`).
4. The two plugins publish the same way.
5. `gh release create $TAG --generate-notes`.

The version is whatever is committed in `package.json` (currently `0.1.54`); the tag
drives the release. There is no automated version-bump commit step in this workflow.

### Existing E2E coverage

**There is no true CLI end-to-end test layer committed to this repo that runs a real
`install`/`update` against a live consumer.** Confirmed by exhaustively reading every
workflow (`cli.yml`, `release.yml`, the three plugin workflows), `scripts/`,
`cli/scripts/`, and searching for any `e2e`/integration workflow or any reference to a
real consumer (`wgb`/`wawagardenbar`/`META-JOBS`) used as a test target — none exists.

What _does_ exist:

- The **closest-to-E2E automated tests** are the subprocess smokes in `status.test.ts`
  and `doctor.test.ts` (real `bin/devaudit.js` via `execa`) plus the `--help`/`--version`
  smoke steps in `cli.yml`. These exercise the real binary but only against a tmp-dir
  fixture (or no project), never a real repo, and never the network (portal mocked /
  absent).
- The full `install`/`update` flows are covered as **integration tests with mocked
  edges** (`runInstall`/`syncProject` directly, portal via msw, `gh`/git via `execa` or
  provider fakes, consumer = tmp dir). High coverage, but the seams (msw, execa) mean no
  real `gh`, no real network, no real npm/husky install runs in CI.
- The **real install/update-against-a-consumer story is manual/external.** Per
  `docs/consuming-projects.md`, the only live consumer is **wawagardenbar (wgb)**;
  META-ATS / META-AGENT / META-JOBS onboarding attempts were started then reverted and
  none currently runs SDLC gates against DevAudit. Operators run
  `npx @metasession.co/devaudit-cli@latest install|update <consumer-path>` by hand
  against those repos; that real-world exercise is **not** encoded as a test or workflow
  in this repo. `docs/e2e-local-db-ci.md` is unrelated to CLI E2E — it documents the
  E2E _gate the CLI generates inside consumer repos_ (the `e2e_setup_command` / `e2e_env`
  knobs that thread a local DB into the consumer's `ci.yml`), not testing of the `devaudit`
  binary itself.

Bottom line: the test pyramid today is **unit/integration-only** (with two subprocess
smokes); the top "real install against a tracer consumer" tier is a manual operator
procedure, not automation.

### Recommended CLI-E2E approach

> **Recommendation.** Add a dedicated **CLI-integration tier** that drives the real
> `bin/devaudit.js` via `execa` against a throwaway git fixture repo, with the portal
> stubbed and a `gh` shim on `PATH` — then, separately, a small **full-E2E** tier that
> runs a real `install`/`update` against a disposable "tracer" consumer. This fills the
> exact gap above while reusing every convention already in the repo.

**Layering (test pyramid).**

1. **Unit / action-fn integration — already present (✓).** Keep `runInstall`/`syncProject`/
   provider-fake/msw tests as the fast, broad base. No change.
2. **CLI integration via execa + fixtures — the recommended new layer.** New files under
   `cli/test/` (e.g. `cli-install.e2e.test.ts`) that:
   - Compute `BIN = resolve(HERE, '..', 'bin', 'devaudit.js')` and run
     `execa('node', [BIN, 'install', fixtureDir, '--yes'], { env, reject: false })`,
     exactly like `status.test.ts`.
   - **Build a throwaway _git_ fixture repo:** `fs.mkdtemp(...)`, write `package.json` /
     `sdlc-config.json`, and `git init` + an initial commit (so `gh repo view` / branch
     logic has a real remote to classify — set a fake `origin` with
     `git remote add origin git@github.com:metasession-dev/fixture-app.git`).
   - **Stub the portal:** since msw runs _in-process_ and can't reach the subprocess,
     either (a) start MSW inside the test and pass `DEVAUDIT_BASE_URL` pointing at a real
     local HTTP listener you control, or (b) stand up a tiny throwaway HTTP server
     (node `http`) in `beforeAll`, hand its URL to the CLI via
     `env.DEVAUDIT_BASE_URL` + `env.DEVAUDIT_USER_TOKEN='mctok_test_fixture'`. Option (b)
     is the cleaner fit for a subprocess.
   - **Shim `gh` (and optionally `git`) on `PATH`:** write a fake executable `gh` into a
     tmp `bin/` dir (e.g. a `#!/usr/bin/env node` script that echoes canned JSON for
     `repo view` / `secret list` and exits 0 for `secret set` / `variable set` / `api`),
     `chmod +x`, and prepend that dir to `env.PATH`. This replaces the `vi.mock('execa')`
     seam (which is unavailable across a process boundary) with a real on-disk shim.
   - **Assert on the trifecta:** `result.exitCode`, `result.stdout + result.stderr`
     substrings, **and** the fixture filesystem (e.g. `sdlc-config.json` rewritten with
     `integration_branch: 'develop'`; `SDLC/`, `.husky/`, `.github/workflows/ci.yml`
     emitted; `ci.yml` contains the project slug and no `{{…}}` placeholders) — mirroring
     `update.test.ts`'s file assertions but through the real binary.
   - **Prerequisite — `bundle:templates`.** A subprocess that does _not_ set
     `DEVAUDIT_INSTALLER_ROOT` resolves templates from the package's bundled snapshot
     (`cli/sdlc/`), which only exists after `npm run bundle:templates`. So either run
     `npm run build && npm run bundle:templates` in the test's global setup, **or** set
     `env.DEVAUDIT_INSTALLER_ROOT` to the repo root (priority-1 override, what the unit
     tests do) so `install`/`update` can resolve `sdlc/files/`. The former is the more
     faithful E2E (it proves the published-tarball layout works); the latter is faster.
     Either way `npm run build` must precede the test so `bin/devaudit.js` can load `dist/`.
3. **Full E2E against a tracer consumer — opt-in / nightly, not the PR gate.** A
   gated job (manual `workflow_dispatch` or scheduled) that checks out a small,
   purpose-built **tracer** consumer repo, runs the _real_ published-or-built CLI
   `install` then `update` against it with a **real** `gh` and a **dedicated test**
   DevAudit portal/project (never prod), and asserts the consumer's gates render and the
   secrets/branch-protection landed. Keep this out of the fast `cli.yml` matrix (it's slow,
   needs live creds, and is platform-sensitive); wire it as a separate workflow so a green
   run is an explicit release-readiness signal rather than a per-PR cost.

**Why this shape:** it preserves the repo's existing seams and idioms (tmp-dir fixtures,
`exitCode + stdout/stderr` assertions, file-tree assertions, `DEVAUDIT_BASE_URL` /
`DEVAUDIT_USER_TOKEN` env, the `bin/` path computation) while moving the mock boundary
_outward_ one layer at a time — from in-process function calls (tier 1) to a real
subprocess with on-disk `gh`/portal stubs (tier 2) to a real consumer with live
dependencies (tier 3) — which is exactly the coverage the current unit-only suite lacks.

---

## 3. Prioritized Requirements Index

195 requirements across the CLI, framework templates, and skills. **MoSCoW:** 87 Must · 77 Should · 27 Could · 4 Won't. Run **Must** first (CLI smoke), then **Should** (CLI critical), then **Could** (regression); **Won't** rows document unbuilt stubs (`org`, `config`, `upgrade`, inert `--org`).

| ID                           | Title                                                                                                 | Priority | Primary source                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| REQ-CLI-INSTALL-001          | install command registration, args, and option surface                                                | Must     | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-INSTALL-002          | Token resolution precedence and missing-token failure                                                 | Must     | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-INSTALL-003          | Project-path validation and banner                                                                    | Must     | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-INSTALL-004          | Step 1/11 auth-probe (PAT validation against portal)                                                  | Must     | `cli/src/install/auth-probe.ts`                                                                                               |
| REQ-CLI-INSTALL-005          | Step 2/11 stack detection (node vs python, working directory)                                         | Must     | `cli/src/install/detect-stack.ts`                                                                                             |
| REQ-CLI-INSTALL-006          | Step 3/11 plan collection — interactive prompts                                                       | Must     | `cli/src/install/prompts.ts`                                                                                                  |
| REQ-CLI-INSTALL-007          | Step 3/11 plan collection — non-interactive (-y/--yes) from sdlc-config.json                          | Should   | `cli/src/install/prompts.ts`                                                                                                  |
| REQ-CLI-INSTALL-008          | Step 4/11 write sdlc-config.json (operator mode, merge semantics)                                     | Must     | `cli/src/install/write-config.ts`                                                                                             |
| REQ-CLI-INSTALL-009          | Step 5/11 find-or-create DevAudit project (portal)                                                    | Must     | `cli/src/install/project.ts`                                                                                                  |
| REQ-CLI-INSTALL-010          | Step 6/11 issue project API key ("Onboarding-issued")                                                 | Must     | `cli/src/install/api-key.ts`                                                                                                  |
| REQ-CLI-INSTALL-011          | Step 7/11 set GitHub secrets and variables                                                            | Must     | `cli/src/install/github.ts`                                                                                                   |
| REQ-CLI-INSTALL-012          | Step 8/11 bootstrap hook framework (husky / pre-commit)                                               | Must     | `cli/src/install/hooks-bootstrap.ts`                                                                                          |
| REQ-CLI-INSTALL-013          | Step 9/11 configure branch protection                                                                 | Must     | `cli/src/install/branch-protection.ts`                                                                                        |
| REQ-CLI-INSTALL-014          | Step 10/11 sync SDLC templates into the consumer repo                                                 | Must     | `cli/src/install/sync-templates.ts`                                                                                           |
| REQ-CLI-INSTALL-015          | Step 11/11 done report (operator copy) and no governance auto-seed                                    | Must     | `cli/src/install/done-report.ts`                                                                                              |
| REQ-CLI-INSTALL-016          | Developer-mode auto-routing (four-bit detection skips steps 4/6/7/9)                                  | Must     | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-INSTALL-017          | --force-team-config pins operator mode (rotation lane)                                                | Should   | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-INSTALL-018          | --dry-run preview (no mutation, operator-max step set)                                                | Should   | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-INSTALL-019          | Plugin lifecycle hooks around install (beforeInstall/afterInstall)                                    | Could    | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-INSTALL-020          | --json machine-readable step stream                                                                   | Could    | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-JOIN-001             | join command registration and developer-mode pin                                                      | Must     | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-JOIN-002             | join pre-flight: refuses when sdlc-config.json is absent (exit 7)                                     | Must     | `cli/src/commands/join.ts`                                                                                                    |
| REQ-CLI-JOIN-003             | join runs developer-mode flow: skips 4/6/7/9, runs 8/10, prints developer done report                 | Must     | `cli/src/install/index.ts`                                                                                                    |
| REQ-CLI-JOIN-004             | join --dry-run and join -y propagation                                                                | Should   | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-UPDATE-001           | Sync framework templates into one consumer and report a summary, leaving the tree dirty               | Must     | `cli/src/commands/update.ts`                                                                                                  |
| REQ-CLI-UPDATE-002           | Idempotency: re-running yields the same synced-file count and no errors                               | Must     | `cli/src/update/index.ts`                                                                                                     |
| REQ-CLI-UPDATE-003           | Stage docs (\_common/\*.md) sync into SDLC/                                                           | Must     | `cli/src/update/stage-docs.ts`                                                                                                |
| REQ-CLI-UPDATE-004           | AI rule files: pointer files overwritten, CLAUDE.md/INSTRUCTIONS.md merged                            | Must     | `cli/src/update/ai-rules.ts`                                                                                                  |
| REQ-CLI-UPDATE-005           | Stack hooks + hook config files (host-conditioned via stack adapter)                                  | Should   | `cli/src/update/stack-hooks.ts`                                                                                               |
| REQ-CLI-UPDATE-006           | Stack dev-dependency install + Playwright postinstall injection (node only) (#245)                    | Should   | `cli/src/update/stack-deps.ts`                                                                                                |
| REQ-CLI-UPDATE-007           | Scripts merged into scripts/ (common + stack + upload-evidence.sh), executable                        | Should   | `cli/src/update/scripts.ts`                                                                                                   |
| REQ-CLI-UPDATE-008           | GitHub issue templates synced to .github/ISSUE_TEMPLATE/                                              | Could    | `cli/src/update/issue-templates.ts`                                                                                           |
| REQ-CLI-UPDATE-009           | Claude Code skills replaced wholesale into .claude/skills/                                            | Should   | `cli/src/update/skills.ts`                                                                                                    |
| REQ-CLI-UPDATE-010           | E2E evidence helper (node only) into e2e/helpers/                                                     | Could    | `cli/src/update/evidence-helper.ts`                                                                                           |
| REQ-CLI-UPDATE-011           | CI workflows generated from templates with token + block substitution                                 | Must     | `cli/src/update/ci-templates.ts`                                                                                              |
| REQ-CLI-UPDATE-012           | Optional E2E steps render only when configured (deterministic backward-compat)                        | Could    | `cli/src/update/ci-templates.ts`                                                                                              |
| REQ-CLI-UPDATE-013           | Post-sync validation surfaces non-fatal warnings                                                      | Should   | `cli/src/update/validation.ts`                                                                                                |
| REQ-CLI-UPDATE-014           | version argument is cosmetic; no tag created                                                          | Should   | `cli/src/commands/update.ts`                                                                                                  |
| REQ-CLI-UPDATE-015           | Multi-path: several consumers updated sequentially in one invocation                                  | Could    | `cli/src/commands/update.ts`                                                                                                  |
| REQ-CLI-UPDATE-016           | Plugin lifecycle hooks fire around the sync (beforeSync / afterSync)                                  | Could    | `cli/src/commands/update.ts`                                                                                                  |
| REQ-CLI-UPDATE-017           | Unknown stack/host adapter aborts before mutation                                                     | Must     | `cli/src/update/resolve-adapters.ts`                                                                                          |
| REQ-CLI-UPDATE-018           | --dry-run is accepted but does not suppress mutation in update                                        | Should   | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-UPDATE-019           | Suggested commit message includes [skip ci] to prevent automated syncs from triggering CI (#220)      | Should   | `cli/src/commands/update.ts`                                                                                                  |
| REQ-CLI-UPDATE-020           | devaudit update adds .e2e-gate-passed and .sdlc-implementer-invoked to consumer .gitignore (#226)     | Must     | `cli/src/update/gitignore.ts`                                                                                                  |
| REQ-CLI-STATUS-001           | Report installed-vs-expected framework state for a consumer (human output)                            | Should   | `cli/src/commands/status.ts`                                                                                                  |
| REQ-CLI-STATUS-002           | --json machine-readable status                                                                        | Should   | `cli/src/commands/status.ts`                                                                                                  |
| REQ-CLI-STATUS-003           | Not-a-consumer (missing sdlc-config.json) exits 7                                                     | Should   | `cli/src/commands/status.ts`                                                                                                  |
| REQ-CLI-DOCTOR-001           | Tool-presence preflight gates the exit code                                                           | Should   | `cli/src/commands/doctor.ts`                                                                                                  |
| REQ-CLI-DOCTOR-002           | Release close-out drift safety-net (non-gating; optional network)                                     | Could    | `cli/src/commands/doctor.ts`                                                                                                  |
| REQ-CLI-DOCTOR-003           | Plugin onDoctor hooks run after the built-in checks                                                   | Could    | `cli/src/commands/doctor.ts`                                                                                                  |
| REQ-CLI-DOCTOR-004           | doctor checks tools, not auth/config validity (scope note)                                            | Won't    | `cli/src/commands/doctor.ts`                                                                                                  |
| REQ-CLI-BOOTSTRAP-001        | Opt-in drop of governance starter templates into compliance/governance/                               | Must     | `cli/src/commands/bootstrap-governance.ts`                                                                                    |
| REQ-CLI-BOOTSTRAP-002        | Idempotent / non-destructive: existing files preserved, never overwritten                             | Must     | `cli/src/install/bootstrap-governance.ts`                                                                                     |
| REQ-CLI-BOOTSTRAP-003        | --dry-run plans without writing                                                                       | Should   | `cli/src/commands/bootstrap-governance.ts`                                                                                    |
| REQ-CLI-BOOTSTRAP-004        | --json machine-readable result                                                                        | Could    | `cli/src/commands/bootstrap-governance.ts`                                                                                    |
| REQ-CLI-PUSH-001             | Required positionals and portal upload contract                                                       | Must     | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-PUSH-002             | API key resolution and missing-key fast-fail (exit 3)                                                 | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-003             | Base URL resolution precedence and trailing-slash normalisation                                       | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-004             | Metadata assembly from --git-sha / --ci-run-id / --branch                                             | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-005             | Release / environment / category form fields                                                          | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-006             | Retry on 429/5xx with exponential backoff, capped at 3 attempts                                       | Must     | `cli/src/lib/ci-upload.ts`                                                                                                    |
| REQ-CLI-PUSH-007             | Retry-After header honoured for retryable responses                                                   | Must     | `cli/src/lib/ci-upload.ts`                                                                                                    |
| REQ-CLI-PUSH-008             | 4xx (other than 429) fast-fail, no retry                                                              | Must     | `cli/src/lib/ci-upload.ts`                                                                                                    |
| REQ-CLI-PUSH-009             | Per-file success/failure tally, summary, and exit code 4 on any failure                               | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-010             | --json machine-readable push result                                                                   | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-011             | Directory upload (recursive) vs single file                                                           | Must     | `cli/src/lib/ci-upload.ts`                                                                                                    |
| REQ-CLI-PUSH-012             | --dry-run previews without any HTTP or filesystem mutation                                            | Must     | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-013             | --dry-run --json structured plan payload                                                              | Should   | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-014             | Base-URL redirect handling / drift warning (parity note)                                              | Should   | `scripts/upload-evidence.sh`                                                                                                  |
| REQ-CLI-PUSH-015             | beforePush / afterPush plugin hooks fire around a real upload                                         | Could    | `cli/src/commands/push.ts`                                                                                                    |
| REQ-CLI-PUSH-016             | --test-cycle forwards testCycleId form field for portal cycle grouping (#209)                         | Should   | `cli/src/commands/push.ts`, `cli/src/lib/ci-upload.ts`                                                                        |
| REQ-CLI-PUSH-017             | Upload bodies are sourced from disk-backed blobs, not `fs.readFile()` whole-buffer preloading         | Should   | `cli/src/lib/ci-upload.ts`                                                                                                    |
| REQ-CLI-PUSH-018             | Starter-stub skip uses a small text prefix read, not whole-file buffering                             | Should   | `cli/src/lib/ci-upload.ts`                                                                                                    |
| REQ-CLI-AUTH-001             | auth login --token validates against the portal then caches at mode 0600                              | Must     | `cli/src/commands/auth/login.ts`                                                                                              |
| REQ-CLI-AUTH-002             | auth login interactive PAT paste with mctok\_ validation                                              | Should   | `cli/src/commands/auth/login.ts`                                                                                              |
| REQ-CLI-AUTH-003             | auth login rejects an invalid token (exit 3) without caching                                          | Must     | `cli/src/commands/auth/login.ts`                                                                                              |
| REQ-CLI-AUTH-004             | auth logout deletes the cached token                                                                  | Should   | `cli/src/commands/auth/logout.ts`                                                                                             |
| REQ-CLI-AUTH-005             | auth status resolves token source and verifies against portal                                         | Should   | `cli/src/commands/auth/status.ts`                                                                                             |
| REQ-CLI-AUTH-006             | auth status when not logged in (exit 3)                                                               | Should   | `cli/src/commands/auth/status.ts`                                                                                             |
| REQ-CLI-AUTH-007             | auth status when the portal rejects the cached token (exit 3)                                         | Should   | `cli/src/commands/auth/status.ts`                                                                                             |
| REQ-CLI-PLUGIN-001           | plugin list enumerates the store and reports load failures                                            | Should   | `cli/src/commands/plugin/list.ts`                                                                                             |
| REQ-CLI-PLUGIN-002           | plugin install <git-url> clones, npm-installs, validates manifest                                     | Should   | `cli/src/commands/plugin/install.ts`                                                                                          |
| REQ-CLI-PLUGIN-003           | plugin remove <name> deletes a plugin by package or directory name                                    | Should   | `cli/src/commands/plugin/remove.ts`                                                                                           |
| REQ-CLI-PLUGIN-004           | plugin update git-pulls + npm-installs each git-backed plugin                                         | Should   | `cli/src/commands/plugin/update.ts`                                                                                           |
| REQ-CLI-PLUGIN-005           | Manifest validation contract gates load/install                                                       | Could    | `plugin-sdk/src/manifest.ts`                                                                                                  |
| REQ-CLI-PLUGIN-006           | Plugin-contributed commands register under a derived namespace                                        | Could    | `cli/src/lib/plugin/commands.ts`                                                                                              |
| REQ-CLI-UPGRADE-001          | upgrade is a stub, not a real self-update (exit 1)                                                    | Could    | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-GLOBAL-001           | Global flags accepted on every command via applyCommonFlags                                           | Could    | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-GLOBAL-002           | --json switches to NDJSON logging + raw result objects                                                | Could    | `cli/src/lib/logger.ts`                                                                                                       |
| REQ-CLI-GLOBAL-003           | --no-color strips ANSI (sets NO_COLOR)                                                                | Could    | `cli/src/lib/logger.ts`                                                                                                       |
| REQ-CLI-GLOBAL-004           | --verbose raises log verbosity                                                                        | Could    | `cli/src/lib/logger.ts`                                                                                                       |
| REQ-CLI-GLOBAL-005           | --dry-run and -y/--yes thread into commands                                                           | Could    | `index.ts`                                                                                                                    |
| REQ-CLI-GLOBAL-006           | --org <slug> is accepted but currently inert                                                          | Won't    | `index.ts`                                                                                                                    |
| REQ-CLI-STUB-001             | org subcommands are not-yet-implemented stubs (exit 1)                                                | Won't    | `cli/src/index.ts`                                                                                                            |
| REQ-CLI-STUB-002             | config subcommands are not-yet-implemented stubs (exit 1)                                             | Won't    | `cli/src/index.ts`                                                                                                            |
| REQ-SKILL-IMPLEMENTER-001    | Trigger phrases fire the orchestrator (Phases 0–4)                                                    | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-002    | Resume phrase invokes Phase 5 separately                                                              | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-003    | Phase 0 emits a "Workflow Decision" block and routes                                                  | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-004    | Phase 0 writes inferred labels back to the issue                                                      | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-005    | Lightweight path drives non-tracked work to merge without ceremony                                    | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-006    | Phase 1 writes the implementation plan from the template at a fixed path                              | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-007    | Phase 1 delegates to requirements-aligner, adr-author, risk-register-keeper (steps 6→7→8)             | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-008    | Phase 1 updates RTM and posts a plan-summary comment                                                  | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-009    | Phase 1 PAUSE for HIGH/CRITICAL plan approval                                                         | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-010    | Phase 2 E2E delegation gate: pre-test-work declaration                                                | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-011    | Phase 2 E2E delegation self-audit before Phase 3                                                      | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-012    | Phase 2 gate-failure retry cap and no-bypass rule                                                     | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-013    | Phase 3 delegates the three per-REQ SoT artefacts then organises + uploads evidence                   | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-014    | Phase 4 opens the release PR and HARD STOPS for UAT review                                            | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-015    | Phase 4 four-eyes reviewer ≠ trigger user for HIGH/CRITICAL                                           | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-016    | Phase 5 finalise vs change-request loop branches on portal state                                      | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-017    | LAST/NEXT status sticky maintained on every transition + handoff                                      | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-018    | Over-scoped issue refused at Phase 1                                                                  | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-019    | Scope-expansion halt gate fires on any user request outside ACs, across all phases                   | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-020    | Phase 3 test-execution-summary.md includes Test Cycles section (ISO 29119-3 Test Completion Report)   | Should   | `sdlc/files/_common/3-compile-evidence.md`                                                                                    |
| REQ-SKILL-IMPLEMENTER-021    | Phase 3 delegates incident filing to e2e-test-engineer, never files inline (#210 AC10)               | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-022    | Phase 5 change-request loop classifies defect vs scope change, delegates defect filing (#210 AC11)   | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-023    | Compliance constraint: never file incidents inline — delegate to sub-skills (#210 AC13)              | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-024    | Phase 3 generates nil-incident report when no incidents occurred (#210 AC15-AC18)                    | Should   | `sdlc/files/_common/3-compile-evidence.md`                                                                                    |
| REQ-SKILL-IMPLEMENTER-025    | Phase 1 step 5b extracts test-scope.md + test-plan.md into compliance/evidence/ (#226)              | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-026    | Phase 3 step 6b copies implementation-plan.md to compliance/evidence/ (#226)                        | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-027    | Resume protocol: re-invoke after environment detours, idempotent state re-read (#226)               | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-028    | Native agent responsibilities + re-invocation boundary documented in SKILL.md (#226)               | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-029    | Phase 5 close-out: RTM → APPROVED - DEPLOYED, ticket → approved-releases/, commit + push (#226)     | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-030    | Commit-scoping rule: subject cites active REQ only, other REQs in body (#226)                       | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-SKILL-IMPLEMENTER-031    | Phase 4 blocker classification can run as an executable PR watch loop with persisted retry state (#304) | Must  | `sdlc/src/bin/devaudit-sdlc.js`, `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                       |
| REQ-FRAMEWORK-HOOK-004       | Pre-push hook runs validate-compliance-artifacts.sh for tracked commits (#226)                      | Must     | `sdlc/files/stacks/node/hooks/pre-push`                                                                                       |
| REQ-SKILL-E2E-001            | Trigger phrases fire the e2e pack maintainer / bootstrapper                                           | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-002            | Bootstrap (Phase 1b) only when no suite exists, with confirmation gates                               | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-003            | evidenceShot helper produces per-AC PNG + sidecar at the canonical path                               | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-004            | Three-tier classification places specs at tier-specific paths                                         | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-005            | Screenshot density scales by spec role (feature vs regression tier)                                   | Should   | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-006            | Transport-layer specs use test-execution-summary.md, not evidenceShot                                 | Should   | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-007            | Phase 4 never deletes a test without explicit confirmation                                            | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-008            | Phase 6 defect filing emits Framework attribution + applies the incident label                        | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-009            | Phase 6 checks every AC has a passing test and files missed requirements                              | Should   | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-010            | Phase 7 regression-pack graduation is implicit on merge                                               | Could    | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-E2E-011            | Phase 5½ evidence wiring validation: evidenceShot + @requirement + tagTest + .e2e-evidence-wired sentinel (#226) | Should | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-SKILL-GOVERNANCE-001     | Trigger phrases / MISSING-clause prompts route to the right doc                                       | Should   | `sdlc/files/_common/skills/governance-doc-author/SKILL.md`                                                                    |
| REQ-SKILL-GOVERNANCE-002     | Each doc class emits its artefact at the fixed path and closes its clause                             | Should   | `sdlc/files/_common/skills/governance-doc-author/SKILL.md`                                                                    |
| REQ-SKILL-GOVERNANCE-003     | Phase 5 commit + upload routes by tier; PAUSE for confirmation before push                            | Should   | `sdlc/files/_common/skills/governance-doc-author/SKILL.md`                                                                    |
| REQ-SKILL-GOVERNANCE-004     | One doc per invocation; Review Schedule ≠ quarterly execution                                         | Could    | `sdlc/files/_common/skills/governance-doc-author/SKILL.md`                                                                    |
| REQ-SKILL-REQALIGN-001       | Triggers + non-spontaneous firing; Stage 1 / Stage 3 hooks                                            | Should   | `sdlc/files/_common/skills/requirements-aligner/SKILL.md`                                                                     |
| REQ-SKILL-REQALIGN-002       | Phase 1 injects the SRS-items table into the plan and (conditionally) blocks approval                 | Should   | `sdlc/files/_common/skills/requirements-aligner/SKILL.md`                                                                     |
| REQ-SKILL-REQALIGN-003       | Phase 2 drops srs-alignment.md with frontmatter, trace table, and operator sign-off                   | Should   | `sdlc/files/_common/skills/requirements-aligner/SKILL.md`                                                                     |
| REQ-SKILL-ADR-001            | Triggers + Stage 1 / Stage 3 hooks; non-spontaneous firing                                            | Should   | `sdlc/files/_common/skills/adr-author/SKILL.md`                                                                               |
| REQ-SKILL-ADR-002            | Phase 1 applies the decision tree and drops docs/ADR/ADR-NNN-<slug>.md or a no-ADR rationale          | Should   | `sdlc/files/_common/skills/adr-author/SKILL.md`                                                                               |
| REQ-SKILL-ADR-003            | Phase 2 drops architecture-decision.md with outcome + operator sign-off                               | Should   | `sdlc/files/_common/skills/adr-author/SKILL.md`                                                                               |
| REQ-SKILL-RISK-001           | Triggers + Stage 1 (MEDIUM/HIGH) / incident-close / Stage 3 / solo_with_gap hooks                     | Should   | `sdlc/files/_common/skills/risk-register-keeper/SKILL.md`                                                                     |
| REQ-SKILL-RISK-002           | Phase 1 opens RISK-NNN rows and injects the reference list into the plan                              | Should   | `sdlc/files/_common/skills/risk-register-keeper/SKILL.md`                                                                     |
| REQ-SKILL-RISK-003           | Phase 3 drops risk-assessment.md with summary table + framework cross-refs + sign-off                 | Should   | `sdlc/files/_common/skills/risk-register-keeper/SKILL.md`                                                                     |
| REQ-SKILL-RISK-004           | Phase 2 post-incident entry cross-links incident report ↔ register both directions                    | Could    | `sdlc/files/_common/skills/risk-register-keeper/SKILL.md`                                                                     |
| REQ-SKILL-RISK-005           | Phase 4 solo_with_gap PAUSE: refuse approval until the control-gap entry is signed off                | Could    | `sdlc/files/_common/skills/risk-register-keeper/SKILL.md`                                                                     |
| REQ-FRAMEWORK-CIYML-001      | ci.yml triggers on develop PRs and develop code pushes                                                | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-002      | Single quality-gates job enforces TypeScript, SAST, dep-audit, E2E, build (node)                      | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-003      | SAST and dep-audit gates honour baseline/accepted-risk allowances                                     | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-004      | E2E origin tagging via E2E_NEW_SPECS diff against merge base                                          | Should   | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-005      | Gate outcomes summarised unconditionally to gate-outcomes.json                                        | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-006      | register-release job creates the UAT release record early                                             | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-007      | register-release syncs known requirements (title + risk class) from RTM.md                            | Should   | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-008      | upload-evidence job uploads gate evidence to the portal even on gate failure (stage 2)               | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-009      | Per-AC E2E screenshots uploaded scoped to in-scope REQs only + evidence-completeness gate (stage 2)   | Should   | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-010      | ci.yml does not upload committed compliance docs (single-owner rule)                                  | Should   | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-011      | Evidence-completeness gate: 3-scenario logic (A: hard error, B: spec-on-disk warning, C: unit-test warning) (#237) | Should | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-CIYML-012      | CI templates stamp --test-cycle on all uploads for portal cycle grouping (#209)                      | Should   | `sdlc/files/ci/ci.yml.template`, `sdlc/files/ci/compliance-evidence.yml.template`             |
| REQ-FRAMEWORK-CIYML-013      | register-release generates + uploads bundled_changes evidence for REQ-tagged releases (#220)          | Should   | `sdlc/files/ci/ci.yml.template`, `sdlc/files/_common/scripts/generate-bundled-changes.sh`     |
| REQ-FRAMEWORK-CIYML-014      | register-release does not create portal release records; creation deferred to upload-evidence (#226)  | Must     | `sdlc/files/ci/ci.yml.template`                                                                                               |
| REQ-FRAMEWORK-HOOK-001       | Pre-push hook checks for E2E evidence before allowing pushes with UI-facing file changes (#226)       | Should   | `sdlc/files/stacks/node/hooks/pre-push`                                                                                       |
| REQ-FRAMEWORK-HOOK-002       | Pre-push hook checks for sdlc-implementer-invoked sentinel on feat/fix/refactor/perf commits (#226)   | Should   | `sdlc/files/stacks/node/hooks/pre-push`                                                                                       |
| REQ-FRAMEWORK-HOOK-003       | Pre-push hook checks for .e2e-evidence-wired sentinel when e2e spec files changed (#226)              | Should   | `sdlc/files/stacks/node/hooks/pre-push`                                                                                       |
| REQ-FRAMEWORK-SKILL-001      | sdlc-implementer writes .sdlc-implementer-invoked sentinel at Phase 0 on tracked route (#226)         | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-FRAMEWORK-SKILL-002      | sdlc-implementer Phase 2 step 5b halts if E2E gate not run for UI-facing changes (#226)               | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-FRAMEWORK-SKILL-003      | sdlc-implementer Phase 1 step 9 stamps RTM row with sdlc-implementer@version provenance (#226)        | Must     | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-FRAMEWORK-SKILL-004      | e2e-test-engineer writes .e2e-gate-passed sentinel after successful E2E run or NOT_NEEDED (#226)      | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-FRAMEWORK-SKILL-005      | e2e-test-engineer Phase 6 pre-flight browser check + anti-deferral instruction (#238)                | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-FRAMEWORK-SKILL-006      | e2e-test-engineer Phase 5½ writes .e2e-evidence-wired sentinel after validating wiring (#226)         | Must     | `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md`                                                                        |
| REQ-FRAMEWORK-SKILL-007      | sdlc-implementer Phase 2 step 4b reconciles test-plan.md file paths with actual files (#241)         | Should   | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-FRAMEWORK-SKILL-008      | sdlc-implementer Phase 3 step 5b validates test-execution-summary.md gate states via validate-test-summary.sh (#240) | Must | `sdlc/files/_common/skills/sdlc-implementer/SKILL.md`                                                                         |
| REQ-FRAMEWORK-VALIDATE-001   | validate-commits.sh checks RTM provenance stamp for REQ-XXX in feat/fix/refactor/perf commits (#226)  | Must     | `sdlc/files/_common/scripts/validate-commits.sh`                                                                              |
| REQ-FRAMEWORK-VALIDATE-002   | validate-test-summary.sh rejects invalid gate states ('deferred', 'browsers not installed') in test-execution-summary.md (#240) | Must | `sdlc/files/_common/scripts/validate-test-summary.sh`                                                                         |
| REQ-FRAMEWORK-GITIGNORE-001  | gitignore.ts syncs .e2e-evidence-wired sentinel entry to consumer .gitignore (#226)                  | Must     | `cli/src/update/gitignore.ts`                                                                                                 |
| REQ-FRAMEWORK-EVIDENCE-001   | compliance-evidence.yml triggers on compliance pushes and E2E Regression completion                   | Must     | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-002   | base URL resolution prefers sdlc-config.json with reachability pre-flight                             | Must     | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-003   | Per-requirement evidence uploaded with correct evidence_type routing (stage 3)                        | Must     | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-004   | Audit-log export uploaded as audit_log evidence (90-day window)                                       | Should   | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-005   | Housekeeping stub auto-PR on bare-date pushes                                                         | Should   | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-006   | E2E Regression evidence uploaded on workflow_run with tier + stage metadata                           | Should   | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-007   | test-execution-summary.md template carries Test Cycles section (ISO 29119-3 Test Completion Report)  | Should   | `sdlc/files/_common/3-compile-evidence.md`                                                                                    |
| REQ-FRAMEWORK-EVIDENCE-008   | Incident export enriched with structured sections from PR/issue body (#210 AC6)                      | Should   | `sdlc/files/ci/incident-export.yml.template`                                                                                  |
| REQ-FRAMEWORK-EVIDENCE-009   | Completeness gate blocks incomplete incident reports with unresolved REPLACE markers (#210 AC9)       | Must     | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-010   | E2E regression incident filing with heuristic triage on test failure (#210 AC19-AC27)               | Should   | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-011   | Nil incident report generated and uploaded as compliance_document when no incidents (#210 AC15-AC18) | Should   | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-012   | Catch-all compliance_document fallback eliminated; unrecognized files skip-with-warning (#205)       | Must     | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-EVIDENCE-013   | Typed evidence_type per artifact: sast_report, dependency_audit, e2e_report, e2e_result, smoke_test, release_ticket, coverage_report, gate_outcome (#207) | Must | `sdlc/files/ci/compliance-evidence.yml.template`, `sdlc/files/ci/ci.yml.template` |
| REQ-FRAMEWORK-EVIDENCE-014   | workflow_run E2E upload recovers tracked release context from artifact metadata before falling back to `_compliance-docs` (#311) | Should | `sdlc/files/ci/compliance-evidence.yml.template`                                                                              |
| REQ-FRAMEWORK-VALIDATION-001 | compliance-validation.yml gates PRs to main on artifact + commit + test-summary validity (#240)       | Should   | `sdlc/files/ci/compliance-validation.yml.template`                                                                            |
| REQ-FRAMEWORK-VALIDATION-002 | ci-status-fallback emits the Quality Gates status on docs-only commits                                | Could    | `sdlc/files/ci/ci-status-fallback.yml.template`                                                                               |
| REQ-FRAMEWORK-VALIDATION-004 | ci-status-fallback declares the token permission needed to write commit statuses (`statuses: write`) | Must     | `sdlc/files/ci/ci-status-fallback.yml.template`                                                                               |
| REQ-FRAMEWORK-VALIDATION-003 | Governance auto-PR workflows (periodic-review, incident-export, close-out)                            | Could    | `sdlc/files/ci/periodic-review.yml.template`                                                                                  |
| REQ-FRAMEWORK-APPROVAL-001   | check-release-approval.yml runs as the PR-to-main merge gate                                          | Must     | `sdlc/files/ci/check-release-approval.yml.template`                                                                           |
| REQ-FRAMEWORK-APPROVAL-002   | Gate blocks merge unless the resolved release is approved                                             | Must     | `sdlc/files/ci/check-release-approval.yml.template`                                                                           |
| REQ-FRAMEWORK-APPROVAL-003   | Bootstrap mode passes the gate on the introducing PR                                                  | Must     | `sdlc/files/ci/check-release-approval.yml.template`                                                                           |
| REQ-FRAMEWORK-APPROVAL-004   | Gate links the PR to the release and posts a portal link comment                                      | Should   | `sdlc/files/ci/check-release-approval.yml.template`                                                                           |
| REQ-FRAMEWORK-POSTDEPLOY-001 | post-deploy-prod.yml runs read-only prod verification on push to main                                 | Should   | `sdlc/files/ci/post-deploy-prod.yml.template`                                                                                 |
| REQ-FRAMEWORK-POSTDEPLOY-002 | Promotes every in-scope release and uploads production evidence (stage 5)                             | Should   | `sdlc/files/ci/post-deploy-prod.yml.template`                                                                                 |
| REQ-FRAMEWORK-POSTDEPLOY-003 | Post-deploy smoke failure files incident issue with structured sections (#210 AC28-AC29)             | Should   | `sdlc/files/ci/post-deploy-prod.yml.template`                                                                                 |
| REQ-FRAMEWORK-LABELRET-001   | label-retention.yml enforces incident label survives to issue close (#210 AC1-AC5)                   | Must     | `sdlc/files/ci/label-retention.yml.template`                                                                                  |
| REQ-FRAMEWORK-FEATUREE2E-001 | feature-e2e.yml runs in-scope E2E on PRs to develop, uploads stage-2 origin=feature evidence          | Should   | `sdlc/files/ci/feature-e2e.yml.template`                                                                                      |
| REQ-FRAMEWORK-SDLCSTAGE-001  | upload-evidence.sh --sdlc-stage flag validates 1-5 and forwards as sdlcStage multipart field          | Should   | `scripts/upload-evidence.sh`                                                                                                  |
| REQ-FRAMEWORK-RENDER-001     | Scalar token substitution populates runner, slug, versions, gate params                               | Must     | `cli/src/lib/templates.ts:substituteTokens`                                                                                   |
| REQ-FRAMEWORK-RENDER-002     | Block substitution renders/omits services, env, E2E, and paths blocks                                 | Must     | `cli/src/lib/templates.ts:substituteBlocks`                                                                                   |
| REQ-FRAMEWORK-RENDER-003     | services block stripped when no database_service configured                                           | Must     | `cli/src/lib/templates.ts:stripServicesBlock`                                                                                 |
| REQ-FRAMEWORK-RENDER-004     | Python stack renders the stack-specific ci.yml with python gates                                      | Should   | `cli/src/update/ci-templates.ts`                                                                                              |
| REQ-FRAMEWORK-RENDER-005     | Railway host wiring: push-to-main deploy, prod URL from secret, no deploy step                        | Should   | `sdlc/files/hosts/railway/adapter.json`                                                                                       |
| REQ-FRAMEWORK-RENDER-006     | Sync removes superseded workflows and writes all CI_TEMPLATES present                                 | Should   | `cli/src/update/ci-templates.ts`                                                                                              |
| REQ-FRAMEWORK-CONTRACT-001   | Shared evidence-types.json contract file maintained in portal repo, synced to installer (#247)        | Must     | `contracts/evidence-types.json`, `cli/test/evidence-contract.test.ts`                                                         |
| REQ-FRAMEWORK-CONTRACT-002   | Installer-side contract test extracts evidence types from CI templates and validates against contract (#247) | Must | `cli/test/evidence-contract.test.ts`                                                                                          |
| REQ-FRAMEWORK-CONTRACT-003   | Cross-repo sync: portal dispatches on contract change, installer auto-PRs updated copy (#247)         | Should   | `.github/workflows/sync-evidence-contract.yml` (both repos)                                                                   |
| REQ-FRAMEWORK-CONTRACT-004   | CLI CI triggers on sdlc/files/ci/** and contracts/evidence-types.json changes (#247)                  | Must     | `.github/workflows/cli.yml`                                                                                                   |
| REQ-FRAMEWORK-ADAPTER-001    | Stack adapter resolved from sdlc-config.json, defaulting to node                                      | Must     | `cli/src/update/resolve-adapters.ts`                                                                                          |
| REQ-FRAMEWORK-ADAPTER-002    | Host adapter resolved from sdlc-config.json, defaulting to railway                                    | Must     | `cli/src/update/resolve-adapters.ts`                                                                                          |
| REQ-FRAMEWORK-ADAPTER-003    | Install-time stack auto-detection by manifest file (pyproject precedence over package.json)           | Must     | `cli/src/install/detect-stack.ts`                                                                                             |
| REQ-FRAMEWORK-ADAPTER-004    | Node adapter substitutes the node/npm/TypeScript gate command set                                     | Must     | `sdlc/files/stacks/node/adapter.json`                                                                                         |
| REQ-FRAMEWORK-ADAPTER-005    | Python adapter substitutes the python/pip/pytest gate command set                                     | Must     | `sdlc/files/stacks/python/adapter.json`                                                                                       |
| REQ-FRAMEWORK-ADAPTER-006    | Hook framework per stack: husky (node) vs pre-commit (python)                                         | Must     | `sdlc/files/stacks/node/adapter.json`                                                                                         |
| REQ-FRAMEWORK-ADAPTER-007    | Node hook config files have required content                                                          | Should   | `sdlc/files/stacks/node/hooks/{pre-commit,pre-push,commit-msg,commitlint.config.mjs,lint-staged.config.mjs,.prettierrc.json}` |
| REQ-FRAMEWORK-ADAPTER-008    | Python pre-commit config has required hook content                                                    | Should   | `sdlc/files/stacks/python/hooks/.pre-commit-config.yaml`                                                                      |
| REQ-FRAMEWORK-ADAPTER-009    | Node stack scripts copied; python declares none                                                       | Should   | `adapter.json`                                                                                                                |
| REQ-FRAMEWORK-ADAPTER-010    | Node dev-dependencies auto-installed + Playwright postinstall injected when missing (node only, #245) | Should   | `cli/src/update/stack-deps.ts`                                                                                                |
| REQ-FRAMEWORK-ADAPTER-011    | Railway host adapter substitutes deploy trigger, production-URL secret resolution and wait-for-deploy | Must     | `sdlc/files/hosts/railway/adapter.json`                                                                                       |
| REQ-FRAMEWORK-ADAPTER-012    | Host adapter loaded only by name; ci-templates consume the substituted deploy bits                    | Should   | `cli/src/lib/adapter.ts`                                                                                                      |
| REQ-FRAMEWORK-ADAPTER-013    | Malformed adapter manifest aborts the sync at parse time or schema validation (Ajv)                  | Should   | `cli/src/lib/adapter.ts`                                                                                                      |
| REQ-FRAMEWORK-ADAPTER-014    | Railway host adapter carries a schema-validated lean-runtime contract                                 | Should   | `sdlc/files/hosts/railway/adapter.json`, `sdlc/files/hosts/_schema/adapter.schema.json`                                      |
| REQ-FRAMEWORK-GOVERNANCE-001 | Governance starters are opt-in (NOT auto-seeded on install since v0.1.36)                             | Should   | `cli/src/install/index.ts`                                                                                                    |
| REQ-FRAMEWORK-GOVERNANCE-002 | bootstrap-governance copies the six starters, dropping .template, skip-if-exists                      | Should   | `cli/src/install/bootstrap-governance.ts`                                                                                     |
| REQ-FRAMEWORK-GOVERNANCE-003 | Each starter carries required frontmatter + the REPLACE banner                                        | Should   | `sdlc/files/_common/governance/{ai-disclosure,dpia,incident-report,periodic-review,risk-register,ropa}.md.template`           |
| REQ-FRAMEWORK-GOVERNANCE-004 | Each starter declares its evidence type and framework-clause coverage                                 | Should   | `sdlc/files/_common/governance/*.md.template`                                                                                 |
| REQ-FRAMEWORK-GOVERNANCE-005 | Governance starters are operator-uploaded, not CI-auto-uploaded                                       | Could    | `sdlc/files/_common/governance/ropa.md.template`                                                                              |
| REQ-FRAMEWORK-RULES-001      | Five AI rule-file targets written so every supported agent discovers the SDLC                         | Must     | `cli/src/update/ai-rules.ts`                                                                                                  |
| REQ-FRAMEWORK-RULES-002      | Cursor/Windsurf/Gemini rule files are pointer files that reference INSTRUCTIONS.md                    | Must     | `cli/src/update/ai-rules.ts`                                                                                                  |
| REQ-FRAMEWORK-RULES-003      | CLAUDE.md preserves project header, appends pointer, strips prior SDLC section                        | Must     | `cli/src/update/ai-rules.ts`                                                                                                  |
| REQ-FRAMEWORK-RULES-004      | INSTRUCTIONS.md is canonical; holds the real SDLC content from INSTRUCTIONS-SDLC.md                   | Must     | `cli/src/update/ai-rules.ts`                                                                                                  |
| REQ-FRAMEWORK-RULES-005      | AI rule-file sync is idempotent on update re-run                                                      | Must     | `cli/src/update/ai-rules.ts`                                                                                                  |
| REQ-FRAMEWORK-STAGE-001      | Stage docs and Tier-1 docs synced verbatim into the consumer's SDLC/                                  | Should   | `cli/src/update/stage-docs.ts`                                                                                                |
| REQ-FRAMEWORK-STAGE-002      | Post-sync validation warns on missing Tier-1 docs in SDLC/                                            | Should   | `cli/src/update/validation.ts`                                                                                                |
| REQ-FRAMEWORK-STAGE-003      | devaudit status reports presence of the framework files including stage docs and rule files           | Should   | `cli/src/commands/status.ts`                                                                                                  |

---

## 4. Requirements by Command, Template & Skill

Each subsection ends with an `Assumptions — <area>` block; cross-cutting ambiguities are consolidated in **Appendix A**.

### Command: install & join

Black-box SRS for `devaudit install [path]` (the full interactive onboarding flow) and `devaudit join [path]` (the explicit second-developer entry point). `install` runs an 11-step pipeline against a consumer repo: authenticate the PAT against the portal → detect node/python stack → collect (or default) a plan → write `sdlc-config.json` → find-or-create the portal project → issue an "Onboarding-issued" CI API key → set GitHub repo secrets/variables → bootstrap git hooks → apply branch protection → sync SDLC templates → print a done report. The same `runInstall` engine drives both commands; `join` pins `mode: 'developer'` (and adds one pre-flight guard) so the four destructive steps (4 write-config, 6 api-key, 7 secrets, 9 branch-protection) skip themselves and the team CI token is never rotated. Every requirement below is observable from outside the process: command + flags + env → stdout/stderr, process exit code, files created/changed under the consumer repo, and HTTP calls to the portal (`x-devaudit-token` header) plus `gh`/`git` subprocess invocations. All step trigger logic is in `cli/src/install/index.ts` (`runInstall`); per-step contracts cite the individual step files. The CLI surface (flags, exit codes) is registered in `cli/src/index.ts`.

#### REQ-CLI-INSTALL-001 — `install` command registration, args, and option surface

- **Priority:** Must — every E2E test invokes the binary through this surface.
- **Source:** `cli/src/index.ts` (`program.command('install [path]')`, `applyCommonFlags`); `cli/src/commands/install.ts` (`runInstallCommand`, `InstallOptions`)
- **Preconditions / inputs:** `devaudit install [path]` with optional positional `path` (defaults to cwd). Command options: `--token <token>`, `--base-url <url>`, `--force-team-config`. Global options merged via `cmd.optsWithGlobals()`: `--json`, `-y/--yes`, `--dry-run`, `-v/--verbose`, `--no-color`, `--org <slug>`.
- **Given** the binary is on PATH **When** `devaudit install --help` **Then** stdout lists the `install [path]` usage with `--token`, `--base-url`, `--force-team-config` descriptions and exit code is 0. **When** `devaudit install` is run with a valid setup **Then** `runInstallCommand` calls `runInstall` mapping `--yes`→`nonInteractive`, `--dry-run`→`dryRun`, `--force-team-config`→`forceTeamConfig`; only flags actually passed are forwarded (undefined flags are omitted from the options object).
- **Error paths:** Any error thrown inside `runInstall` is caught in `runInstallCommand`, logged via `log.error(message)` to stderr, then `process.exit(1)`.
- **Fixtures/env:** Fixture consumer repo with `package.json`; `DEVAUDIT_USER_TOKEN` env or `--token`; msw portal stub at `--base-url`; execa stub for `gh`/`which`/`git`.

#### REQ-CLI-INSTALL-002 — Token resolution precedence and missing-token failure

- **Priority:** Must — auth is the gate for the whole flow.
- **Source:** `cli/src/install/index.ts` (`resolveTokenForInstall`); `cli/src/lib/auth.ts` (`resolveToken`, `readAuth`)
- **Preconditions / inputs:** Token resolved in order: (1) `--token <token>` flag wins (baseUrl then `--base-url` or default `https://devaudit.metasession.co`); (2) else `resolveToken()` reads `DEVAUDIT_USER_TOKEN` env (with `DEVAUDIT_BASE_URL` env or default); (3) else `~/.config/devaudit/auth.json` (`AUTH_FILE`, version 1 record). `--base-url` overrides the resolved baseUrl when present.
- **Given** none of `--token`, `DEVAUDIT_USER_TOKEN`, or a cached `auth.json` is available **When** `devaudit install` **Then** `runInstall` throws `No DevAudit token found. Set DEVAUDIT_USER_TOKEN, pass --token, or run \`devaudit auth login\` first.`, which surfaces on stderr with exit code 1; no portal calls, no files written.
- **Error paths:** As above (exit 1). With `--token` set but invalid, the failure surfaces later in step 1 (REQ-CLI-INSTALL-004), not here.
- **Fixtures/env:** Run with `DEVAUDIT_USER_TOKEN` unset and `HOME`/config dir pointed at an empty temp dir so no `auth.json` exists.

#### REQ-CLI-INSTALL-003 — Project-path validation and banner

- **Priority:** Must — defines the cwd/`[path]` contract and the always-printed header.
- **Source:** `cli/src/install/index.ts` (`runInstall` path resolve + `isDir` guard, `banner`)
- **Preconditions / inputs:** `path` (or cwd) resolved to absolute. `projectName = basename(projectPath)`.
- **Given** `path` points to a non-existent directory **When** `devaudit install /no/such/dir` **Then** `runInstall` throws `Project path not found: <abs>` → stderr + exit 1, nothing mutated. **Given** a valid dir **Then** before step 1 the banner prints to stdout: `Metasession SDLC Onboarding`, `  Consumer:  <name>`, `  Path:      <abs>`, `  DevAudit:  <baseUrl>`; in dry-run it also prints `  DRY RUN — no mutations will be performed`.
- **Error paths:** Non-directory path → exit 1 with the `Project path not found` message.
- **Fixtures/env:** Temp dir fixture; assert banner lines appear on stdout in order.

#### REQ-CLI-INSTALL-004 — Step 1/11 auth-probe (PAT validation against portal)

- **Priority:** Must — first network call; gates all subsequent steps.
- **Source:** `cli/src/install/auth-probe.ts` (`runAuthProbe`); `cli/src/lib/devaudit-api.ts` (`DevAuditClient.listProjects`, header `x-devaudit-token`)
- **Preconditions / inputs:** Resolved token + baseUrl. Network call: `GET <baseUrl>/api/projects` with header `x-devaudit-token: <token>`.
- **Given** the portal returns 200 **When** step 1 runs **Then** a `1/11 Authenticate` step with status `ok` and message `PAT accepted at <baseUrl>` is recorded; `record()` logs `[1/11 Authenticate] PAT accepted at <baseUrl>` via `log.success`. Exit continues.
- **Error paths:** Portal returns 401 or 403 → `runAuthProbe` throws `PAT rejected (HTTP <status>). Issue a fresh token at <baseUrl>/settings/tokens and retry.` → caught in `runInstallCommand`, stderr + exit 1; no files written, no further steps. Any other HTTP/network error (e.g. 500, ECONNREFUSED) is re-thrown as-is → exit 1.
- **Fixtures/env:** msw handler `http.get(BASE_URL/api/projects)` returning `[]` (happy) or `status:401` (reject); assert the single GET fired with the token header.

#### REQ-CLI-INSTALL-005 — Step 2/11 stack detection (node vs python, working directory)

- **Priority:** Must — drives plan defaults and hook framework choice.
- **Source:** `cli/src/install/detect-stack.ts` (`detectStack`, `findPyproject`)
- **Preconditions / inputs:** Filesystem scan of `projectPath` (max depth 3, skipping `node_modules .git dist build .next .turbo`). Precedence: root `pyproject.toml`→python `.`; nested `pyproject.toml`→python with relative working dir; else root `package.json`→node `.`.
- **Given** the fixture has `package.json` at root **When** step 2 runs **Then** a `2/11 Detect stack` step status `ok` message `stack=node working_directory=. host=railway` is logged. **Given** root `pyproject.toml` **Then** `stack=python working_directory=. host=railway`. **Given** a nested `subdir/pyproject.toml` **Then** `working_directory=subdir`.
- **Error paths:** Neither `pyproject.toml` nor `package.json` within 3 levels → throws `Could not detect stack — no pyproject.toml or package.json found within 3 directory levels.` → stderr + exit 1, nothing mutated. (Verified by install.test.ts "throws when no package.json or pyproject.toml is found".)
- **Fixtures/env:** Node fixture (`package.json`) and python fixture (`pyproject.toml`); an empty temp dir for the error case.

#### REQ-CLI-INSTALL-006 — Step 3/11 plan collection — interactive prompts

- **Priority:** Must — defines the wizard's interactive contract when not `-y`.
- **Source:** `cli/src/install/prompts.ts` (`collectPlan`→`planFromPrompts`, `defaultSlug`, `prodUrlSecretDefault`)
- **Preconditions / inputs:** `nonInteractive=false` (no `-y`). Uses `@clack/prompts.group` with six text prompts: Project slug (default = slugified projectName), Node/Python version (default 20 / 3.11), Source dirs (default `app/ lib/` node, `src/ tests/` python), Working directory (default = detected wd; label "Working directory (blank = root)" when wd is `.`), Production URL secret name (default `<SLUG>_PROD_URL` derived from the entered slug), Production URL (default blank).
- **Given** an interactive TTY **When** the operator accepts defaults **Then** the resulting `InstallPlan` carries `projectSlug`, `runtimeVersion`, `sourceDirs`, `workingDirectory` (blank→`.`), `prodUrlSecretName`, `prodUrlValue`; step 3 logs `3/11 Configure` `slug=<slug> runtime=<ver>`.
- **Error paths:** Operator cancels a prompt (Ctrl-C) → `onCancel` writes `Cancelled.\n` to stderr and `process.exit(0)` (clean exit 0, partial — nothing mutated yet since destructive steps follow).
- **Fixtures/env:** Hard to drive in CI; E2E should prefer `-y` (REQ-CLI-INSTALL-007). For interactive coverage, a pty harness asserting the six prompt labels and the `Cancelled.` exit-0 path.

#### REQ-CLI-INSTALL-007 — Step 3/11 plan collection — non-interactive (`-y/--yes`) from sdlc-config.json

- **Priority:** Should — the CI-friendly path; required for headless E2E.
- **Source:** `cli/src/install/prompts.ts` (`collectPlan`→`planFromConfig`); `cli/src/lib/sdlc-config.ts` (`readSdlcConfig`)
- **Preconditions / inputs:** `nonInteractive=true` (`-y`). Reads existing `sdlc-config.json`. Slug from `cfg.project_slug` (else slugified name); runtime from `cfg.node_version`/`cfg.python_version` (else default); `source_dirs`, `working_directory`, `production_url_secret` from cfg or defaults; `prodUrlValue` always `''`.
- **Given** `-y` and an existing `sdlc-config.json` **When** `devaudit install -y` **Then** the plan is built from config (no prompts, no stdin read) and step 3 logs the slug/runtime.
- **Error paths:** `-y` with NO `sdlc-config.json` and not dry-run → throws `--yes requires an existing sdlc-config.json in the project directory. Run without --yes to create one interactively.` → stderr + exit 1. (In dry-run, missing config is tolerated.)
- **Fixtures/env:** Node fixture seeded with `sdlc-config.json` (`{project_slug, stack, host, node_version}`); a second fixture WITHOUT it to assert the exit-1 error.

#### REQ-CLI-INSTALL-008 — Step 4/11 write sdlc-config.json (operator mode, merge semantics)

- **Priority:** Must — primary on-disk artifact of onboarding.
- **Source:** `cli/src/install/write-config.ts` (`writeSdlcConfig`, `NODE_PATHS_IGNORE`/`PYTHON_PATHS_IGNORE`)
- **Preconditions / inputs:** `installMode='operator'`, not dry-run. Builds config as `{ ...defaultedIfNew, ...existing, ...wizardOwned }`. `wizardOwned` (always wins): `stack`, `host`, `project_slug`, `production_url_secret`, `<node_version|python_version>`, `working_directory`, `source_dirs`, and a `devaudit` block `{ base_url, project_slug, api_key_secret: 'DEVAUDIT_API_KEY' }`. `defaultedIfNew` seeds `runner: ubuntu-latest`, `integration_branch: develop`, `release_branch: main`, `sast_baseline: 0`, plus database/e2e/uat/approval/production_review scaffolding and stack-specific `paths_ignore`.
- **Given** operator mode **When** step 4 runs **Then** `<projectPath>/sdlc-config.json` is written as pretty 2-space JSON with trailing newline; step logs `4/11 Write sdlc-config.json` `ok` `wrote <path>`. Re-running over a rich existing config preserves all non-wizard keys (`runner`, `sast_baseline`, `accepted_dep_risks`, `database_*`, `app_env`, `build_env`, `e2e_*`, custom `paths_ignore`, `uat.*`, unknown `custom_field`) while `project_slug/stack/host/production_url_secret` come from the plan. (Verified by install.test.ts "preserves rich sdlc-config fields".)
- **Error paths:** Filesystem write failure propagates → exit 1.
- **Fixtures/env:** Node fixture; assert `sdlc-config.json` exists with `integration_branch=develop`, `release_branch=main`, wizard-owned fields from plan, and a seeded rich config's customizations preserved.

#### REQ-CLI-INSTALL-009 — Step 5/11 find-or-create DevAudit project (portal)

- **Priority:** Must — establishes the portal project the rest of the flow targets.
- **Source:** `cli/src/install/project.ts` (`findOrCreateProject`); `cli/src/lib/devaudit-api.ts` (`getProjectBySlug`→`listProjects`, `createProject`)
- **Preconditions / inputs:** operator mode, not dry-run. Network: `GET <baseUrl>/api/projects`; if no project with `slug===plan.projectSlug`, `POST <baseUrl>/api/projects` with body `{ slug, name }` (name = slug). Sets `plan.projectId`.
- **Given** the slug is absent on the portal **When** step 5 runs **Then** a project is created and step logs `5/11 Find or create DevAudit project` `ok` `project '<slug>' created (id <8chars>…)` (`data.created=true`). **Given** the slug already exists **Then** no POST fires; logs `project '<slug>' already exists (id <8chars>…) — skipping creation` (`data.created=false`).
- **Error paths:** Portal error on GET/POST throws `DevAuditApiError` (`<METHOD> <path> → HTTP <status>`) → exit 1; `sdlc-config.json` from step 4 remains on disk.
- **Fixtures/env:** msw: GET returns `[]` (→ create) or `[{slug}]` (→ skip); POST returns `{id, slug, name}` 201. Assert which calls fired.

#### REQ-CLI-INSTALL-010 — Step 6/11 issue project API key ("Onboarding-issued")

- **Priority:** Must — produces the CI uploader key stored as `DEVAUDIT_API_KEY`.
- **Source:** `cli/src/install/api-key.ts` (`issueApiKey`, `KEY_NAME='Onboarding-issued'`); `cli/src/lib/devaudit-api.ts` (`listApiKeys`, `issueApiKey` POST role `uploader`)
- **Preconditions / inputs:** operator mode, not dry-run, `plan.projectId` set by step 5. Network: `GET <baseUrl>/api/projects/<id>/api-keys`; if no live key named `Onboarding-issued` (revoked_at null), `POST .../api-keys` body `{ name: 'Onboarding-issued', role: 'uploader' }`. Stores `plan.apiKey = plainTextKey` (kept in memory only; never written to disk).
- **Given** no live Onboarding-issued key exists **When** step 6 runs **Then** a key is issued and step logs `6/11 Issue project API key` `ok` `issued (will be stored as repo secret DEVAUDIT_API_KEY)`. **Given** a live key already exists **Then** status `warn` message `'Onboarding-issued' API key already exists — revoke it in the portal and re-run, or set DEVAUDIT_API_KEY manually` and `plan.apiKey` stays unset (→ step 7 skips the `DEVAUDIT_API_KEY` secret). (Verified by install.test.ts "warns and skips API key issuance".)
- **Error paths:** Missing `plan.projectId` (step 5 skipped) throws `projectId missing from plan — step 5 must run before step 6.` Portal error → `DevAuditApiError` → exit 1.
- **Fixtures/env:** msw: api-keys GET returns `[]` (issue) or `[{name:'Onboarding-issued',revoked_at:null}]` (warn); POST returns `{id,name,plainTextKey}`.

#### REQ-CLI-INSTALL-011 — Step 7/11 set GitHub secrets and variables

- **Priority:** Must — wires the consumer repo's CI to the portal.
- **Source:** `cli/src/install/github.ts` (`setGithubSecrets`, `buildOperations`, `buildSkipped`); `cli/src/lib/git-provider/github.ts` (`setSecret`→`gh secret set`, `setVariable`→`gh variable set`)
- **Preconditions / inputs:** operator mode, not dry-run, a resolved GitHub provider. Operations in order: secret `DEVAUDIT_API_KEY` (only if `plan.apiKey` set), secret `DEVAUDIT_USER_TOKEN` = `ctx.token` (always), secret `<prodUrlSecretName>` (only if `plan.prodUrlValue` non-empty), variable `DEVAUDIT_BASE_URL` = `ctx.baseUrl` (always). Each secret runs `gh secret set <name>` (value piped via stdin) and the variable runs `gh variable set <name> --body <value>` in `projectPath`.
- **Given** provider present + apiKey issued **When** step 7 runs **Then** `gh secret set DEVAUDIT_API_KEY`, `gh secret set DEVAUDIT_USER_TOKEN`, `gh variable set DEVAUDIT_BASE_URL` fire; step logs `7/11 Set GitHub secrets and variables` `ok` `N item(s) set` (with `(skipped: DEVAUDIT_API_KEY (no new key issued); <secret> (no value provided))` appended when applicable).
- **Error paths:** No git provider resolved → step 7 is recorded `skipped` with message from `resolveProvider.reason` and `log.warn([7/11 …] SKIPPED <reason>)` (flow continues). `gh` missing entirely (provider falls back without `gh` and no `GH_TOKEN`) → `setSecret` throws `Setting a GitHub repo secret without \`gh\` CLI requires sodium encryption … Install \`gh\` CLI` → exit 1.
- **Fixtures/env:** execa stub recognising `gh secret set`/`gh variable set`; or fake provider recording `setSecret`/`setVariable` names. Assert `DEVAUDIT_API_KEY`, `DEVAUDIT_USER_TOKEN` secrets and `DEVAUDIT_BASE_URL` variable.

#### REQ-CLI-INSTALL-012 — Step 8/11 bootstrap hook framework (husky / pre-commit)

- **Priority:** Must — installs git hooks; runs in BOTH operator and developer mode.
- **Source:** `cli/src/install/hooks-bootstrap.ts` (`bootstrapHooks`, `bootstrapNode`, `bootstrapPython`, `commandExists`)
- **Preconditions / inputs:** not dry-run. Node: if `.husky/` already exists → `ok` `.husky/ already exists` (no exec); else if `npx` on PATH → `npx husky init` (cwd projectPath, stdio inherit) → `ok` `.husky/ bootstrapped`. Python: if `pre-commit` on PATH → `pre-commit install` then `pre-commit install --hook-type commit-msg` → `ok` `pre-commit hooks installed`.
- **Given** a node fixture without `.husky/` and `npx` available **When** step 8 runs **Then** `npx husky init` executes and `.husky/` is created on disk. **Given** node fixture WITH `.husky/` **Then** no exec, `ok`.
- **Error paths:** Node without `npx` on PATH → status `warn` `npx not on PATH — run \`npx husky init\` manually`(flow continues, exit unaffected). Python without`pre-commit`→`warn` `pre-commit not on PATH — run \`pip install pre-commit && pre-commit install\` manually`.
- **Fixtures/env:** execa stub for `which`/`npx`/`pre-commit`; for the warn path, stub `which` to fail. Assert `npx husky init` invocation and `.husky/` presence.

#### REQ-CLI-INSTALL-013 — Step 9/11 configure branch protection

- **Priority:** Must — enforces the compliance gates on the default branch.
- **Source:** `cli/src/install/branch-protection.ts` (`configureBranchProtection`, `REQUIRED_CHECKS`); `cli/src/lib/git-provider/github.ts` (`getRepoMeta`, `applyBranchProtection`→`gh api -X PUT /repos/:o/:r/branches/:b/protection`)
- **Preconditions / inputs:** operator mode, not dry-run, GitHub provider resolved. Resolves `owner/name/defaultBranch` via `gh repo view`, then PUTs branch-protection with required status checks `['Compliance Validation','DevAudit Release Approval','Quality Gates']`, `enforce_admins:false`, `required_pull_request_reviews` with `required_approving_review_count:0`.
- **Given** provider + resolvable repo **When** step 9 runs **Then** the `gh api … /protection` PUT fires on `<defaultBranch>` and step logs `9/11 Configure branch protection` `ok` `required checks on <branch>: Compliance Validation, DevAudit Release Approval, Quality Gates`. These three are the installer-defined authoritative branch-protection checks; external hosting-platform suites are informational unless the consumer deliberately configures otherwise.
- **Error paths:** `getRepoMeta` fails → `warn` `could not resolve git repo (<msg>) — configure manually` (flow continues). `applyBranchProtection` returns `{applied:false}` → `warn` `<gh stderr first line> — configure manually`. No provider at all → step recorded `skipped` (`9/11 Configure branch protection`) with the no-provider reason and `log.warn`.
- **Fixtures/env:** Fake provider with `getRepoMeta`→`{owner,name,defaultBranch:'main'}` and `applyBranchProtection`→`{applied:true}`; assert the call with `checks.length===3`.

#### REQ-CLI-INSTALL-014 — Step 10/11 sync SDLC templates into the consumer repo

- **Priority:** Must — writes the bulk of framework files (AI rules, hooks, scripts, CI, skills). Runs in BOTH modes.
- **Source:** `cli/src/install/sync-templates.ts` (`syncTemplates`); `cli/src/update/index.ts` (`syncProject`, SECTION_RUNNERS) — see the `update`-area SRS for the full file manifest (cross-area dependency).
- **Preconditions / inputs:** not dry-run. Delegates to `syncProject(projectPath)` which resolves adapters from `sdlc-config.json` and runs nine sections (stage docs, AI rules, stack hooks, stack deps, scripts, issue templates, skills, evidence helper, CI templates) plus validation.
- **Given** a synced consumer **When** step 10 runs **Then** framework files appear on disk — including AI-assistant pointer files (`CLAUDE.md`/`.cursorrules`/`.windsurfrules`/`GEMINI.md`/`INSTRUCTIONS.md` per `cli/src/update/ai-rules.ts`), `.claude/skills/*`, hooks, `scripts/*`, and CI workflows under `.github/workflows/` — and the step logs `10/11 Sync SDLC templates` `ok` `synced N files across M sections`.
- **Error paths:** `syncProject` throws `Project path not found` if the dir vanished (exit 1). Adapter resolution emits a deprecation warning when stack/host keys are missing from `sdlc-config.json` (non-fatal).
- **Fixtures/env:** Requires `DEVAUDIT_INSTALLER_ROOT` (or bundled snapshot) pointing at the template tree, as the install/join tests set. Assert `totalFilesSynced > 0` and pointer files present.

#### REQ-CLI-INSTALL-015 — Step 11/11 done report (operator copy) and no governance auto-seed

- **Priority:** Must — defines the success terminal output and the v0.1.36 governance opt-in contract.
- **Source:** `cli/src/install/done-report.ts` (`doneReport`, operator branch); `cli/src/install/index.ts` (governance auto-seed removed; `bootstrapGovernanceDocs` no longer called)
- **Preconditions / inputs:** operator mode (default). `doneReport` is synchronous (no I/O).
- **Given** a successful operator install **When** all steps complete **Then** step `11/11 Done` status `ok` prints the next-steps block to stdout: `<name> is onboarded.`, the `git checkout -b feat/sdlc-onboarding` / `git add -A` / `git commit -m "feat: onboard <slug> to Metasession SDLC"` / `git push` / `gh pr create --base main` sequence, and the post-merge compliance guidance. `data.mode='operator'`, `data.nextBranch='feat/sdlc-onboarding'`. The process completes with exit code 0. **And** `compliance/governance/` is NOT created (governance starters are opt-in via `devaudit bootstrap-governance`). (Verified by install.test.ts asserting `compliance/governance` absent after a full run.)
- **Error paths:** None (pure formatter).
- **Fixtures/env:** Full-run node fixture; assert stdout contains `is onboarded.` and `feat/sdlc-onboarding`, and that `compliance/governance/` does not exist.

#### REQ-CLI-INSTALL-016 — Developer-mode auto-routing (four-bit detection skips steps 4/6/7/9)

- **Priority:** Must — the second-dev safety contract for a bare `devaudit install` on an onboarded repo.
- **Source:** `cli/src/install/index.ts` (`detectInstallMode`); skip branches in `write-config.ts`, `api-key.ts`, `github.ts`, `branch-protection.ts`; `done-report.ts` (developer branch)
- **Preconditions / inputs:** `mode='auto'` (default), not dry-run, no `--force-team-config`. All FOUR bits must hold: (1) `sdlc-config.json` exists at projectPath; (2) `getProjectBySlug(plan.projectSlug)` returns a project; (3) a live `Onboarding-issued` API key exists for that project; (4) the repo has a `DEVAUDIT_USER_TOKEN` secret (`provider.hasSecret`→`gh secret list`). Any failure (or any portal error) → operator (safe default).
- **Given** all four bits true **When** `devaudit install` runs **Then** `log.info` prints `developer mode auto-detected (… DEVAUDIT_USER_TOKEN secret all present): destructive steps (4, 6, 7, 9) will skip. …`; steps 4/6/7/9 are recorded `skipped` (no `sdlc-config.json` rewrite, no key issuance, no `setSecret`/`setVariable`, no `applyBranchProtection`); steps 8 and 10 still run; the done report is `11/11 Done (developer mode)` (`data.mode='developer'`) listing what was deliberately skipped. (Verified by install.test.ts "developer mode: skips steps 4, 6, 7, 9".)
- **Error paths:** Missing `DEVAUDIT_USER_TOKEN` secret (bit 4 false) → falls back to operator; secrets + branch protection DO run (`setSecret` called, step 7 `ok`). (Verified by install.test.ts "developer mode falls back to operator when DEVAUDIT_USER_TOKEN secret is missing".)
- **Fixtures/env:** msw seeds project + Onboarding-issued key (`seedOnboardedPortal`); a provider whose `hasSecret`→true (`makeOnboardedProvider`). Assert no mutating provider calls fired.

#### REQ-CLI-INSTALL-017 — `--force-team-config` pins operator mode (rotation lane)

- **Priority:** Should — operator's deliberate secret-rotation override.
- **Source:** `cli/src/install/index.ts` (`detectInstallMode`, `forceTeamConfig` branch); `cli/src/commands/install.ts` / `cli/src/index.ts` (`--force-team-config`)
- **Preconditions / inputs:** `--force-team-config` flag. Overrides ALL detection (and `mode`) → operator.
- **Given** all four dev-mode bits would otherwise be true **When** `devaudit install --force-team-config` **Then** `log.info` prints `--force-team-config: running operator-mode (will rewrite repo secrets + branch protection).`; steps 4/6/7/9 run destructively (sdlc-config rewritten, `setSecret`/`setVariable` fire, `applyBranchProtection` fires); done report is `11/11 Done` (operator copy). (Verified by install.test.ts "--force-team-config: pins back to operator mode".)
- **Error paths:** Same destructive-step error paths as REQ-CLI-INSTALL-008..013.
- **Fixtures/env:** Onboarded portal + provider with `hasSecret`→true; assert `setSecret` and `applyBranchProtection` were called and done step is exactly `11/11 Done`.

#### REQ-CLI-INSTALL-018 — `--dry-run` preview (no mutation, operator-max step set)

- **Priority:** Should — preview safety; common E2E assertion.
- **Source:** `cli/src/install/index.ts` (`detectInstallMode` dry-run branch → operator); per-step `ctx.dryRun` branches in every step file
- **Preconditions / inputs:** `--dry-run`. Mode detection short-circuits to operator (no probes) so the report shows the maximum step set; `--force-team-config`/`mode=developer` still take effect. Banner prints `DRY RUN — no mutations will be performed`.
- **Given** `devaudit install --dry-run -y` **When** it runs **Then** steps 4/5/6/7/9/10 report status `planned` with "would …" messages (e.g. step 4 `would write <path> (stack=…, slug=…)`, step 5 `would create or find project slug='…'`, step 7 `would set secret:DEVAUDIT_API_KEY, … via github provider`, step 8 `would run \`npx husky init\``, step 10 `would run native syncProject() …`); NO `sdlc-config.json`is written, NO portal POST fires, NO provider mutating method or`pre-commit`/`npx` exec runs. (Verified by install.test.ts "dry-run produces a plan without mutating disk or calling execa".)
- **Error paths:** Auth probe (step 1) and stack detection (step 2) still execute in dry-run, so an invalid PAT or undetectable stack still exits 1.
- **Fixtures/env:** Node fixture; assert `fs.stat(sdlc-config.json)` rejects after the run and no mutating execa/provider calls recorded.

#### REQ-CLI-INSTALL-019 — Plugin lifecycle hooks around install (beforeInstall/afterInstall)

- **Priority:** Could — observable only when a plugin is installed; not part of the core flow.
- **Source:** `cli/src/install/index.ts` (`discoverPlugins`, `buildPluginContext`, `runHook 'beforeInstall'/'afterInstall'`)
- **Preconditions / inputs:** One or more plugins discovered in `~/.config/devaudit/plugins/`, not dry-run.
- **Given** a plugin exposing `beforeInstall`/`afterInstall` **When** `devaudit install` runs (not dry-run) **Then** `beforeInstall` fires after step 1 and `afterInstall` fires after step 11, each with a plugin context built from `projectPath`. In dry-run, neither hook fires.
- **Error paths:** Plugin load failures are surfaced earlier by the CLI bootstrap (`log.warn(Plugin at <dir> failed to load: <reason>)`) and do not abort install.
- **Fixtures/env:** A fixture plugin dir; assert hook side effects only when not dry-run.

#### REQ-CLI-INSTALL-020 — `--json` machine-readable step stream

- **Priority:** Could — alternate output mode; useful for E2E parsing.
- **Source:** `cli/src/index.ts` (`applyCommonFlags` preAction → `configureLogger({json})`); `cli/src/lib/logger.ts` (JSON reporter)
- **Preconditions / inputs:** `--json` global flag.
- **Given** `devaudit install --json …` **When** it runs **Then** every log line is emitted to stdout as a JSON object `{ level, tag, args, date }` (one per line) instead of human-formatted text; step messages still carry the `[N/11 …]` tags in `args`. Exit codes are unchanged from the non-JSON path.
- **Error paths:** Errors are emitted as JSON `error`-level records; exit 1 on fatal.
- **Fixtures/env:** Run with `--json`; assert each stdout line `JSON.parse`s and includes the step messages.

#### REQ-CLI-JOIN-001 — `join` command registration and developer-mode pin

- **Priority:** Must — the explicit second-developer entry point.
- **Source:** `cli/src/index.ts` (`program.command('join [path]')`); `cli/src/commands/join.ts` (`runJoinCommand`, `JoinOptions`)
- **Preconditions / inputs:** `devaudit join [path]` with options `--token`, `--base-url`, and globals `--dry-run`, `-y/--yes`. `runJoinCommand` resolves `projectPath` (path or cwd), then calls `runInstall({ mode: 'developer', … })`.
- **Given** `devaudit join --help` **Then** stdout describes it as the second-developer entry point that "Skips the operator-only steps (sdlc-config write, API key issuance, GitHub secret writes, branch protection)"; exit 0. **When** `devaudit join` runs on an onboarded repo **Then** `runInstall` is invoked with `mode:'developer'` pinned regardless of detection bits.
- **Error paths:** Errors from `runInstall` caught → `log.error` + `process.exit(1)`.
- **Fixtures/env:** Fixture with `sdlc-config.json`; assert `runInstall` receives `mode:'developer'`.

#### REQ-CLI-JOIN-002 — `join` pre-flight: refuses when sdlc-config.json is absent (exit 7)

- **Priority:** Must — guards against joining a non-onboarded project.
- **Source:** `cli/src/commands/join.ts` (`runJoinCommand`, `isFile` guard, `process.exit(7)`)
- **Preconditions / inputs:** `sdlc-config.json` absent at `projectPath`.
- **Given** a project directory WITHOUT `sdlc-config.json` **When** `devaudit join` **Then** stderr prints `No sdlc-config.json at <path>. This project hasn't been onboarded yet — the project operator should run \`devaudit install\`. See SDLC/joining-an-existing-project.md …`and the process exits with code **7** (distinct from the generic 1);`runInstall` is never entered and no portal/provider calls fire. (Verified by join.test.ts "exits 7 when sdlc-config.json is absent".)
- **Error paths:** This IS the error path (exit 7). All other half-onboarded states (missing portal project / key / secret) are NOT caught here — they route inside `runInstall`'s mode detection.
- **Fixtures/env:** Empty temp dir (no `sdlc-config.json`); spy on `process.exit` asserting code 7 and zero provider calls.

#### REQ-CLI-JOIN-003 — `join` runs developer-mode flow: skips 4/6/7/9, runs 8/10, prints developer done report

- **Priority:** Must — defines the on-disk + network footprint of a join.
- **Source:** `cli/src/install/index.ts` (`detectInstallMode` `mode==='developer'` branch); skip branches in steps 4/6/7/9; `done-report.ts` developer branch
- **Preconditions / inputs:** `mode:'developer'` pinned by join; `sdlc-config.json` present. Detection bits are NOT consulted (pinned overrides auto-detect) — works even if the portal returns no project.
- **Given** `devaudit join` on an onboarded repo **When** it runs **Then** `log.info` prints `mode=developer (pinned): destructive steps will skip — use \`devaudit install --force-team-config\` … if you need to rotate team secrets.`; steps 4/6/7/9 are `skipped`(existing`sdlc-config.json`untouched, no key issuance, no`setSecret`/`setVariable`, no branch protection); steps 1/2/3 run, step 8 bootstraps hooks, step 10 re-syncs templates; the done report is `11/11 Done (developer mode)` listing the re-synced templates + bootstrapped hooks and the deliberately-skipped team items; exit 0. (Verified by install.test.ts "mode: developer (pinned, the join code path)".)
- **Error paths:** An invalid PAT (step 1) or undetectable stack (step 2) still exits 1 — join does not bypass those gates. A filesystem/sync failure in step 10 exits 1.
- **Fixtures/env:** Fixture with `sdlc-config.json` + `package.json`; msw returning empty project list; assert no `setSecret` and step 7/9 `skipped`.

#### REQ-CLI-JOIN-004 — `join --dry-run` and `join -y` propagation

- **Priority:** Should — flag plumbing for the join lane.
- **Source:** `cli/src/index.ts` (join action `optsWithGlobals`); `cli/src/commands/join.ts` (maps `dryRun`, `nonInteractive`)
- **Preconditions / inputs:** `--dry-run` and/or `-y` globals on `devaudit join`.
- **Given** `devaudit join --dry-run` on an onboarded repo **When** it runs **Then** the pre-flight `sdlc-config.json` check still applies (exit 7 if absent), the banner shows `DRY RUN`, and the developer-mode flow reports `planned`/`skipped` steps with no mutations. **Given** `devaudit join -y` **Then** `nonInteractive=true` is forwarded so step 3 reads config without prompting.
- **Error paths:** Same exit-7 pre-flight as REQ-CLI-JOIN-002.
- **Fixtures/env:** Onboarded fixture; assert no disk/network mutation under `--dry-run` and no prompt under `-y`.

#### Assumptions — Install/Join

- The done-report "What ran" copy lists `.husky/` and template re-sync; whether step 8/10 actually mutate in developer mode depends on the same `ctx.dryRun` guards as operator mode (steps 8 and 10 have no `installMode` skip branch, so they run in developer mode unless dry-run). Treated as intended.
- `git remote` resolution (provider detection) happens lazily via `resolveProvider`/`detectProvider`; a repo with NO `origin` remote yields `provider: null` and a clean `reason` string, so steps 7 and 9 are recorded `skipped` (not a hard failure) while steps 4/5/6/8/10 still run. The task's "not a git repo" error path therefore manifests as skipped GH steps, not a non-zero exit, in the default `runInstall` engine. Confirmed from `index.ts` `resolveProvider` catch + the skipped-step branches.
- The task mentions a "dirty tree" error path; no working-tree cleanliness check exists anywhere in the install/join flow (no `git status --porcelain` gate). Assumed there is no dirty-tree precondition — install will run over uncommitted changes and the done report simply instructs the operator to `git status`/`git add -A`. Flagged as a possible spec gap rather than implemented behaviour.
- `prodUrlValue` is always collected as a prompt (or `''` in `-y`); it is never persisted to `sdlc-config.json`, only used transiently in step 7 to optionally set the `<prodUrlSecretName>` repo secret. So the production URL secret is only written when an operator typed a value at the interactive prompt — unobservable in headless `-y` runs.
- The `--org <slug>` global flag is registered in `applyCommonFlags` but is not read anywhere in the install/join code paths; treated as a no-op for this area.

### Commands: update, status, doctor, bootstrap-governance

Scope: black-box, externally-observable behaviour of the four `devaudit` subcommands `update [version] [paths...]`, `status [path]`, `doctor`, and `bootstrap-governance [path]`. Each requirement is expressed purely in terms of inputs the operator controls (the command line, the consumer repo on disk, and environment variables) and outputs that can be observed from outside the process: stdout/stderr text, the process exit code, filesystem deltas under the consumer project (files created / overwritten / preserved / removed), and any network calls. No internal data structures or private function contracts are asserted beyond what is reachable through these surfaces. Sources are the real CLI under `cli/src/` and the bundled framework templates under `sdlc/files/`; ground-truth behaviour is cross-checked against `cli/test/update.test.ts`, `cli/test/status.test.ts`, and `cli/test/doctor.test.ts`.

Command registration: `cli/src/index.ts` (`main`). Installer-root / template-source resolution: `cli/src/lib/installer-root.ts` (`resolveInstallerRoot`) — priority order is (1) `DEVAUDIT_INSTALLER_ROOT` env override, (2) the npm package's bundled `sdlc/` snapshot, (3) the DevAudit-Installer repo root; the sentinel is the presence of `sdlc/files`. Global flags applied to every command (`cli/src/index.ts`, `applyCommonFlags`): `--json`, `-y/--yes`, `--dry-run`, `-v/--verbose`, `--no-color`, `--org <slug>`.

---

#### REQ-CLI-UPDATE-001 — Sync framework templates into one consumer and report a summary, leaving the tree dirty

- **Priority:** Must — core purpose of `update`; this is the canonical template-sync path (the former `scripts/sync-sdlc.sh` was removed).
- **Source:** `cli/src/commands/update.ts` (`runUpdate`); `cli/src/update/index.ts` (`syncAll`, `syncProject`)
- **Preconditions / inputs:** A consumer directory that exists and (normally) contains `sdlc-config.json`. CLI invoked as `devaudit update <version> <path>` (or with the path defaulting to `.`). `DEVAUDIT_INSTALLER_ROOT` (or a bundled snapshot) must resolve to a tree containing `sdlc/files`.
- **Given** a valid consumer at `<path>` **When** `devaudit update v1.2.3 <path>` **Then** stdout/stderr shows `--- Syncing to: <projectName> (<absPath>) ---`, `Stack: <stack> | Host: <host>`, one line per section (`[2a] _common docs`, `[2b] AI rule pointers + INSTRUCTIONS.md`, `[2c] <stack> hooks`, `[2c-ii] <stack> deps`, `[2d] scripts`, `[2e] Issue templates`, `[2e-ii] Claude Code skills`, `[2e-iii] E2E evidence helper`, `[2f] CI workflows`), a `Total: N files synced` line, a `--- Validation ---` block, then `=== Sync Complete ===` and the "Next steps" block ending with `Do NOT auto-commit — review the changes first.`; **exit 0**; framework files are written/overwritten under `<path>` (see per-section reqs); **no git commit is made** (tree left dirty for operator review); **no network calls** in the base sync path.
- **Error paths:** Path not a directory → `syncProject` throws `Project path not found: <absPath>`, `syncAll` logs `ERROR syncing <p>: …` and rethrows; the top-level handler in `index.ts` prints the message and exits **1**. Unresolvable installer root → `resolveInstallerRoot` throws `Could not locate the SDLC templates (sdlc/files)…` → exit **1**.
- **Fixtures/env:** Temp consumer with `sdlc-config.json` (`project_slug`, `stack:"node"`, `host:"railway"`, plus CI keys), a `package.json` with all node dev-deps present, and pre-created `.husky/`, `scripts/`, `.github/workflows/` dirs (mirrors `buildFixture` in `cli/test/update.test.ts`). `DEVAUDIT_INSTALLER_ROOT` pointed at the repo root.

#### REQ-CLI-UPDATE-002 — Idempotency: re-running yields the same synced-file count and no errors

- **Priority:** Must — re-running must not drift or error; templates are regenerated deterministically.
- **Source:** `cli/src/update/index.ts` (`syncProject`); ground-truth `cli/test/update.test.ts` ("is idempotent — re-running produces no errors and same file count")
- **Preconditions / inputs:** As REQ-CLI-UPDATE-001; run the same `devaudit update` against the same consumer twice.
- **Given** a consumer already synced once **When** `devaudit update` is run a second time with the same inputs **Then** it completes with **exit 0**, and `totalFilesSynced` of the second run equals the first. Regenerated content is byte-stable for unchanged config (token/block substitution is deterministic; CI step builders emit identical output when `e2e_env`/`e2e_setup_command`/`e2e_projects`/`e2e_seed_command` are absent — see `cli/test/update.test.ts` "Backward compat" assertions).
- **Error paths:** None specific.
- **Fixtures/env:** Same fixture as REQ-CLI-UPDATE-001.

#### REQ-CLI-UPDATE-003 — Stage docs (`_common/*.md`) sync into `SDLC/`

- **Priority:** Must — Tier-1 docs and stage guides are the spine of the framework.
- **Source:** `cli/src/update/stage-docs.ts` (`syncStageDocs`)
- **Preconditions / inputs:** `sdlc/files/_common/*.md` present in installer root.
- **Given** the consumer **When** update runs **Then** `<path>/SDLC/` is created if missing and every `*.md` under `sdlc/files/_common/` is copied in (overwriting existing), e.g. `SDLC/0-project-setup.md`, `SDLC/Test_Policy.md`; section line reports `[2a] _common docs: <N> file(s) — synced to SDLC/`.
- **Error paths:** None (missing source dir → `listFiles` returns empty → 0 files).
- **Fixtures/env:** As REQ-CLI-UPDATE-001.

#### REQ-CLI-UPDATE-004 — AI rule files: pointer files overwritten, CLAUDE.md/INSTRUCTIONS.md merged

- **Priority:** Must — single-source-of-truth wiring for AI assistants; selective preservation matters.
- **Source:** `cli/src/update/ai-rules.ts` (`syncAiRules`, `writePointerFile`, `updateClaudeFile`, `updateInstructionsFile`)
- **Preconditions / inputs:** `sdlc/ai-rules/INSTRUCTIONS-SDLC.md` present.
- **Given** the consumer **When** update runs **Then**: `.cursorrules`, `.windsurfrules`, `GEMINI.md` are written wholesale (overwritten) to fixed pointer content referencing `INSTRUCTIONS.md`. `CLAUDE.md`: if absent, created from `CLAUDE_NEW`; if present, the project header is preserved, any prior `## SDLC Compliance Process (MANDATORY)` section is stripped, and the pointer tail is appended only if `INSTRUCTIONS.md` not already referenced. `INSTRUCTIONS.md`: if absent, created with a SoT header + the SDLC content; if present, the project section before `## SDLC Compliance Process (MANDATORY)` is preserved and the SDLC content is appended/replaced. Section line reports `[2b] … 5 file(s) — synced`.
- **Error paths:** `INSTRUCTIONS-SDLC.md` missing → section SKIPPED with message `INSTRUCTIONS-SDLC.md not found`, 0 files (non-fatal).
- **Fixtures/env:** As REQ-CLI-UPDATE-001; verifies all five files contain `INSTRUCTIONS.md` and INSTRUCTIONS.md contains `SDLC Compliance Process`.

#### REQ-CLI-UPDATE-005 — Stack hooks + hook config files (host-conditioned via stack adapter)

- **Priority:** Should — depends on the consumer already having bootstrapped the hook framework dir.
- **Source:** `cli/src/update/stack-hooks.ts` (`syncStackHooks`); adapter via `cli/src/lib/adapter.ts` (`loadStackAdapter`)
- **Preconditions / inputs:** Stack adapter declares `hook_install_dir` (e.g. `.husky`), `hooks` (e.g. `commit-msg`, `pre-commit`, `pre-push`), `hook_config_files` (e.g. `commitlint.config.mjs`, `lint-staged.config.mjs`, `.prettierrc.json`). The consumer's `<hook_install_dir>/` must already exist.
- **Given** a consumer with `.husky/` present **When** update runs **Then** each adapter hook present in `sdlc/files/stacks/<stack>/hooks/` is copied to `<hookDir>/<hook>` mode 0755, and each `hook_config_files` entry is copied to the repo root; section reports `[2c] node hooks: <N> file(s) — synced to .husky/`.
- **Error paths:** No `hook_install_dir` declared → SKIPPED (`no hook_install_dir declared`). Install dir absent → SKIPPED (`<dir>/ not found — bootstrap hook framework first`). Stack has no `hooks/` → SKIPPED (`stack has no hooks/`).
- **Fixtures/env:** Fixture pre-creates `.husky/`; test asserts `commit-msg`, `pre-commit`, `pre-push`, and the three root config files exist.

#### REQ-CLI-UPDATE-006 — Stack dev-dependency install + Playwright postinstall injection (node only)

- **Priority:** Should — convenience; only fires when deps are actually missing or postinstall is absent.
- **Source:** `cli/src/update/stack-deps.ts` (`syncStackDeps`, `ensurePostinstallScript`)
- **Preconditions / inputs:** `stack === 'node'`, a `package.json` present, adapter's `required_dev_dependencies` non-empty.
- **Given** a node consumer whose `package.json` already lists every required dev-dep **When** update runs **Then** **no subprocess runs**; section reports `[2c-ii] node deps … all present` (0 files). **Given** missing deps **Then** runs `npm install --save-dev <missing…>` (stdio inherited) in the consumer dir; on failure retries with `--legacy-peer-deps`; success reports the installed list (with a `(with --legacy-peer-deps)` note on the retry path). **Network:** `npm install` reaches the npm registry only when deps are missing.
- **Postinstall injection (#245):** After the dep check (whether deps were missing or all present), if `@playwright/test` is in the adapter's `required_dev_dependencies`, the section also calls `ensurePostinstallScript` which reads the consumer's `package.json` and checks `scripts.postinstall`: (a) if already `"playwright install chromium"` → no-op; (b) if absent → adds `"postinstall": "playwright install chromium"` and writes the file; (c) if present but doesn't mention `playwright install` → logs a warning and does **not** overwrite. The section message includes `, added postinstall` when the script was added. This ensures `npm ci` in the consumer repo auto-installs Chromium browsers without a separate `npx playwright install` step.
- **Error paths:** Both npm attempts fail → throws `Failed to install node deps. Fix manually: cd <path> && npm install --save-dev <missing>` → `syncAll` rethrows → exit **1**. Non-node stack → SKIPPED. No `package.json` → SKIPPED (`no package.json`). Existing postinstall without playwright → warning, continue (no overwrite).
- **Fixtures/env:** Fixture lists all node dev-deps so the test path is "all present" (no network). Separate fixture with `@playwright/test` in deps but no `postinstall` script → assert script added. Fixture with existing `postinstall` mentioning playwright → no-op. Fixture with existing `postinstall` not mentioning playwright → warning, no overwrite.

#### REQ-CLI-UPDATE-007 — Scripts merged into `scripts/` (common + stack + upload-evidence.sh), executable

- **Priority:** Should — operational helpers; gated on a pre-existing `scripts/` dir.
- **Source:** `cli/src/update/scripts.ts` (`syncScripts`)
- **Preconditions / inputs:** Consumer has a `scripts/` directory.
- **Given** a consumer with `scripts/` **When** update runs **Then** copies `_common/scripts/*.sh` (excluding `*.test.sh`) mode 0755, the adapter's `stack_scripts` from `stacks/<stack>/scripts/` mode 0755, and the repo's top-level `scripts/upload-evidence.sh` mode 0755; section reports `[2d] scripts: <N> file(s) — synced to scripts/`. Observable deltas include `scripts/upload-evidence.sh` and `scripts/validate-compliance-artifacts.sh`.
- **Error paths:** No `scripts/` dir → SKIPPED (`scripts/ not found`).
- **Fixtures/env:** Fixture pre-creates `scripts/`; test asserts `upload-evidence.sh` and `validate-compliance-artifacts.sh` exist.

#### REQ-CLI-UPDATE-008 — GitHub issue templates synced to `.github/ISSUE_TEMPLATE/`

- **Priority:** Could — supporting metadata.
- **Source:** `cli/src/update/issue-templates.ts` (`syncIssueTemplates`)
- **Preconditions / inputs:** `sdlc/files/_common/github/ISSUE_TEMPLATE/` exists in installer root.
- **Given** the consumer **When** update runs **Then** `.github/ISSUE_TEMPLATE/` is created and each `*.yml` is copied in (overwriting); reports `[2e] Issue templates: <N> file(s) — synced to .github/ISSUE_TEMPLATE/`.
- **Error paths:** Source dir absent → SKIPPED (0 files).
- **Fixtures/env:** As REQ-CLI-UPDATE-001.

#### REQ-CLI-UPDATE-009 — Claude Code skills replaced wholesale into `.claude/skills/`

- **Priority:** Should — rsync-`--delete` semantics; stale skill artifacts must not accumulate.
- **Source:** `cli/src/update/skills.ts` (`syncSkills`); `cli/src/lib/fs-utils.ts` (`copyDir` with `clean=true`)
- **Preconditions / inputs:** Skills under `sdlc/files/_common/skills/<name>/` and/or `sdlc/files/stacks/<stack>/skills/<name>/`.
- **Given** the consumer **When** update runs **Then** `.claude/skills/` is ensured; for each skill dir (skipping names starting with `_`) the destination `.claude/skills/<name>/` is **removed and recopied wholesale** (any operator-added stray files inside a managed skill dir are deleted); reports `[2e-ii] … <N> synced to .claude/skills/`. Zero skills found → SKIPPED.
- **Error paths:** None fatal.
- **Fixtures/env:** As REQ-CLI-UPDATE-001.

#### REQ-CLI-UPDATE-010 — E2E evidence helper (node only) into `e2e/helpers/`

- **Priority:** Could — node-stack-only; required for tsc on the consumer side.
- **Source:** `cli/src/update/evidence-helper.ts` (`syncEvidenceHelper`)
- **Preconditions / inputs:** `stack === 'node'`; source files `evidence.ts` + `evidence-shot-core.ts` under the `e2e-test-engineer` skill's `references/`.
- **Given** a node consumer **When** update runs **Then** `e2e/helpers/evidence.ts` and `e2e/helpers/evidence-shot-core.ts` are written (overwriting); reports synced count with any `missing:` note. Non-node stack → SKIPPED. No sources → SKIPPED.
- **Error paths:** None fatal (missing files reported in message).
- **Fixtures/env:** Test asserts both helper files exist.

#### REQ-CLI-UPDATE-011 — CI workflows generated from templates with token + block substitution

- **Priority:** Must — the compliance gates are produced here; correctness of substitution is load-bearing.
- **Source:** `cli/src/update/ci-templates.ts` (`syncCiTemplates`); `cli/src/lib/templates.ts` (`substituteTokens`, `substituteBlocks`, `stripServicesBlock`)
- **Preconditions / inputs:** Consumer has `sdlc-config.json` AND `.github/workflows/`. Config supplies `project_slug`, `production_url_secret`, `runner`, `source_dirs`, `sast_baseline`, `accepted_dep_risks`, `database_*`, `e2e_*`, optional `node_version`/`python_version`/`working_directory`/`paths_ignore`/`*_env`.
- **Given** a configured consumer **When** update runs **Then** for each template in the fixed list (`ci.yml`, `ci-status-fallback.yml`, `compliance-validation.yml`, `check-release-approval.yml`, `post-deploy-prod.yml`, `compliance-evidence.yml`, `close-out-release.yml`, `periodic-review.yml`, `incident-export.yml`) a stack-specific template (`ci/<stack>/<tmpl>`) is preferred over the default (`ci/<tmpl>`); the output drops `.template`, all `{{TOKEN}}` scalars and `{{BLOCK}}` lines are substituted, and the `services:` block is stripped when `database_service` is empty. The old workflows `test-on-pr.yml` and `check-uat-approval.yml` are **removed** if present. Observable: `.github/workflows/ci.yml` contains the slug and no residual `{{…}}`; `periodic-review.yml` and `incident-export.yml` exist; `compliance-evidence.yml` references `/api/ci/projects/<slug>/audit-log/export`. Reports `[2f] CI workflows: <N> generated`.
- **Error paths:** No `sdlc-config.json` → SKIPPED (`no sdlc-config.json`). No `.github/workflows/` → SKIPPED (`.github/workflows/ not found`). A template missing from both stack and default location → silently skipped (not counted).
- **Fixtures/env:** Fixture asserts no `{{PROJECT_SLUG}}`/`{{NODE_VERSION}}` remain, backward-compat E2E tokens dropped, cron/governance lines present.

#### REQ-CLI-UPDATE-012 — Optional E2E steps render only when configured (deterministic backward-compat)

- **Priority:** Could — opt-in CI elaboration; default output must be byte-identical to pre-feature.
- **Source:** `cli/src/update/ci-templates.ts` (`buildE2eSetupStep`, `buildE2eDevServerStep`, `buildE2eTestStep`, `buildAuthenticatedE2eStep`)
- **Preconditions / inputs:** `e2e_setup_command`, `e2e_env`, `e2e_projects`, `e2e_seed_command` in config.
- **Given** none of those keys set **When** update runs **Then** no `E2E setup` / `Authenticated E2E` steps render, dev-server + E2E steps carry no extra env, and `ci.yml` contains `- name: Start dev server\n        run: <cmd> &`. **Given** `e2e_setup_command`/`e2e_env` set **Then** a `run: |` setup block and threaded `env:` appear on the dev-server and blocking E2E steps. **Given** `e2e_projects`/`e2e_seed_command` set **Then** report-only `continue-on-error: true` seed + authenticated-E2E steps are injected after the blocking smoke gate (writing `e2e-auth-results.json`).
- **Error paths:** None.
- **Fixtures/env:** `cli/test/update.test.ts` covers all three permutations.

#### REQ-CLI-UPDATE-013 — Post-sync validation surfaces non-fatal warnings

- **Priority:** Should — advisory; never gates the sync.
- **Source:** `cli/src/update/validation.ts` (`runValidation`); `cli/src/update/index.ts`
- **Preconditions / inputs:** Synced consumer with `.github/workflows/` and/or `SDLC/`.
- **Given** a synced consumer **When** validation runs **Then** stdout shows `All validation checks passed` or one `WARN` per issue: dead `event_name == pull_request` conditions in push-only workflows, package.json-based version usage, runtime downloads from `raw.githubusercontent.com/metasession-dev/devaudit`, and missing Tier-1 docs (`SDLC/Test_Policy.md`, `Test_Strategy.md`, `Test_Architecture.md`). **Warnings never change the exit code.**
- **Error paths:** None.
- **Fixtures/env:** As REQ-CLI-UPDATE-001.

#### REQ-CLI-UPDATE-014 — `version` argument is cosmetic; no tag created

- **Priority:** Should — explicit non-behaviour (operators may expect tagging).
- **Source:** `cli/src/commands/update.ts` (`runUpdate`); `cli/src/index.ts` (update action, `looksLikeVersion`)
- **Preconditions / inputs:** `devaudit update [version] [paths...]`. Both args optional: paths default to `.`, version defaults to the running CLI version.
- **Given** `devaudit update v9.9.9 <path>` **When** it runs **Then** stdout logs `Version (informational, no tag created): v9.9.9`; **no git tag is created** and no network call results from the version arg. Single-arg disambiguation: a token matching `^v?\d+(\.\d+)` is treated as the version; otherwise a lone token is treated as a path and version falls back to the CLI version.
- **Error paths:** None.
- **Fixtures/env:** Any consumer.

#### REQ-CLI-UPDATE-015 — Multi-path: several consumers updated sequentially in one invocation

- **Priority:** Could — batch operation; fail-fast on first error.
- **Source:** `cli/src/commands/update.ts`; `cli/src/update/index.ts` (`syncAll` loop)
- **Preconditions / inputs:** `devaudit update <version> <pathA> <pathB> …` with two or more valid consumers.
- **Given** two valid consumers **When** `devaudit update v1 <A> <B>` **Then** each is synced in order (each emits its own `--- Syncing to: … ---` block), one shared `=== Sync Complete ===` summary follows, **exit 0**. If any consumer throws, `syncAll` logs `ERROR syncing <p>: …` and rethrows immediately → exit **1**, leaving earlier consumers already mutated (no rollback).
- **Error paths:** As above — partial application on failure.
- **Fixtures/env:** Two temp consumer fixtures.

#### REQ-CLI-UPDATE-016 — Plugin lifecycle hooks fire around the sync (beforeSync / afterSync)

- **Priority:** Could — only active when plugins are installed.
- **Source:** `cli/src/commands/update.ts` (`runUpdate`); `cli/src/lib/plugin/index.ts`, `hooks.ts` (`runHook`)
- **Preconditions / inputs:** One or more plugins discovered under `~/.config/devaudit/plugins/` exposing `beforeSync`/`afterSync` hooks.
- **Given** a discovered plugin **When** `devaudit update` runs **Then** for each project path a `beforeSync` hook runs before `syncAll` and an `afterSync` hook runs after; a hook that throws is caught and surfaced as a `WARN` (`Plugin '<pkg>' hook '<hook>' threw: …`) and does **not** abort the sync. With zero plugins, no hook overhead and identical output to the base path.
- **Error paths:** Hook throw → warning only, sync continues.
- **Fixtures/env:** Plugin install dir with a test plugin (otherwise no-op).

#### REQ-CLI-UPDATE-017 — Unknown stack/host adapter aborts before mutation

- **Priority:** Must — must fail loudly rather than half-sync against a missing adapter.
- **Source:** `cli/src/update/resolve-adapters.ts` (`resolveAdapters`); ground-truth `cli/test/update.test.ts` ("rejects an unknown stack")
- **Preconditions / inputs:** `sdlc-config.json` naming a `stack`/`host` with no matching `sdlc/files/stacks/<stack>/adapter.json` or `hosts/<host>/adapter.json`.
- **Given** `stack: "cobol"` **When** update runs **Then** `resolveAdapters` throws `stack adapter not found: stacks/cobol/adapter.json. Available: <list>` (analogous message for an unknown host) before any section runs; `syncAll` rethrows → exit **1**. Missing/partial `stack`/`host` keys (config present but keys absent, or no config) default to `node`+`railway` and emit a `DEPRECATED: stack/host keys missing …` warning.
- **Error paths:** As above.
- **Fixtures/env:** Temp consumer with a bad stack value.

#### REQ-CLI-UPDATE-018 — `--dry-run` is accepted but does not suppress mutation in `update`

- **Priority:** Should — documents an observed gap so E2E does not assert a no-op.
- **Source:** `cli/src/index.ts` (update action ignores `globals.dryRun`); `cli/src/commands/update.ts` (`runUpdate` has no dry-run branch)
- **Preconditions / inputs:** `devaudit update --dry-run <path>`.
- **Given** `--dry-run` on the `update` command **When** it runs **Then** the flag is parsed (global option) but **not forwarded** to `runUpdate`; the sync proceeds and mutates the tree exactly as a normal run. (Contrast `bootstrap-governance`, which honours `--dry-run`.) See Assumptions.
- **Error paths:** None.
- **Fixtures/env:** Any consumer; assert files were written despite `--dry-run`.

---

#### REQ-CLI-STATUS-001 — Report installed-vs-expected framework state for a consumer (human output)

- **Priority:** Should — read-only inspection; primary diagnostic surface.
- **Source:** `cli/src/commands/status.ts` (`runStatus`); `cli/src/lib/sdlc-config.ts` (`readSdlcConfig`, `checkFrameworkFiles`)
- **Preconditions / inputs:** `devaudit status [path]`; path defaults to `process.cwd()`, resolved to absolute. Consumer should contain `sdlc-config.json`.
- **Given** a consumer with `sdlc-config.json` **When** `devaudit status <path>` **Then** stdout shows `Inspecting <absPath>`, `sdlc-config.json found.`, a key block (`Project slug`, `Stack`, `Host`, optional `Node version`/`Python version`/`Working dir`/`Source dirs`, `DevAudit URL`, `UAT enabled`, `Approval mode`; unset scalars render `(unset)`), then a `✓`/`✗` line per framework file (the fixed list: `INSTRUCTIONS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `GEMINI.md`, `SDLC/0-project-setup.md`, `SDLC/5-deploy-main.md`, `scripts/upload-evidence.sh`, `compliance/RTM.md`, `.github/workflows/ci.yml`), and a trailing `All checked framework files are present.` or `<N> framework file(s) missing. Re-sync with …`. **Exit 0.** **Read-only: no filesystem writes, no network.**
- **Error paths:** See REQ-CLI-STATUS-003 for missing config.
- **Fixtures/env:** Temp consumer with `sdlc-config.json` containing `project_slug`, `stack`, `host`, `node_version`, `devaudit.base_url` (mirrors `cli/test/status.test.ts`).

#### REQ-CLI-STATUS-002 — `--json` machine-readable status

- **Priority:** Should — needed for CI assertions and tooling.
- **Source:** `cli/src/commands/status.ts` (`runStatus` JSON branch); `cli/src/lib/logger.ts` (`isJsonMode`, `emitJsonResult`)
- **Preconditions / inputs:** `devaudit status <path> --json`.
- **Given** an onboarded consumer **When** `--json` is set **Then** exactly one JSON object is written to stdout: `{ ok:true, projectPath, project_slug, stack, host, node_version, python_version, working_directory, source_dirs, devaudit_base_url, uat_enabled, approval_mode, files_present:[…], files_missing:[…] }` (unset scalars null; `uat_enabled` defaults false). No human log lines. **Exit 0.**
- **Error paths:** Missing config → `{ ok:false, reason:"not_onboarded", projectPath }` then exit **7** (REQ-CLI-STATUS-003).
- **Fixtures/env:** As REQ-CLI-STATUS-001 with `--json`.

#### REQ-CLI-STATUS-003 — Not-a-consumer (missing sdlc-config.json) exits 7

- **Priority:** Should — distinct exit code lets callers detect "not onboarded".
- **Source:** `cli/src/commands/status.ts` (`runStatus`); ground-truth `cli/test/status.test.ts` ("warns when no sdlc-config.json")
- **Preconditions / inputs:** `devaudit status <emptyDir>` where no `sdlc-config.json` exists.
- **Given** a directory without `sdlc-config.json` **When** `devaudit status` runs **Then** human mode prints `Inspecting <path>`, `No sdlc-config.json found here. This project is not onboarded to DevAudit.`, `Run \`devaudit install\` to onboard.`; JSON mode emits `{ ok:false, reason:"not_onboarded", projectPath }`; **exit 7** either way. No filesystem writes, no network.
- **Error paths:** A present-but-malformed `sdlc-config.json` (invalid JSON) causes `JSON.parse` to throw (not ENOENT) → propagates to the top-level handler → exit **1** (see Assumptions).
- **Fixtures/env:** Empty temp dir.

---

#### REQ-CLI-DOCTOR-001 — Tool-presence preflight gates the exit code

- **Priority:** Should — operator self-check; the gate is the required-tools result.
- **Source:** `cli/src/commands/doctor.ts` (`runDoctor`, `checkCommand`, `checkNodeVersion`); ground-truth `cli/test/doctor.test.ts`
- **Preconditions / inputs:** `devaudit doctor`. Environment `PATH`. No config required.
- **Given** any environment **When** `devaudit doctor` runs **Then** stdout shows `Running devaudit doctor — checking required tools...` then a `✓`/`✗` line for each of: `node` (`v<ver> (require >=22)`, ok iff major ≥ 22), `git --version`, `gh --version`, `jq --version`, `curl --version` (ok iff each subprocess exits 0; detail is the tool's first stdout line, or `exited <code>` / the spawn error). **If all required tools pass → `All required tools present.` and exit 0; otherwise → `One or more required tools are missing…` and exit 6.** Network: none for the tool checks themselves.
- **Error paths:** A missing tool / spawn failure marks that check `✗` and forces exit **6**. (Test accepts only 0 or 6.)
- **Fixtures/env:** Runs in a bare env; `cli/test/doctor.test.ts` asserts exit ∈ {0,6} and that `node` appears in output.

#### REQ-CLI-DOCTOR-002 — Release close-out drift safety-net (non-gating; optional network)

- **Priority:** Could — advisory reconciliation; never affects the tool-gate exit.
- **Source:** `cli/src/commands/doctor.ts` (`checkReleaseCloseoutDrift`)
- **Preconditions / inputs:** Run from a consumer cwd. Reads `sdlc-config.json` and `compliance/pending-releases/` relative to **cwd**. Network only when slug + `devaudit.base_url` + `DEVAUDIT_API_KEY` are all available.
- **Given** a consumer cwd **When** doctor runs **Then** an extra `releases` line is printed: `skipped (not a consumer project)` if no `sdlc-config.json`; `no pending-releases/` if the dir is absent; `no pending release tickets` if none match `RELEASE-TICKET-REQ-<n>.md`; `<N> pending ticket(s); portal drift check skipped (set DEVAUDIT_API_KEY + devaudit.base_url)` when creds are missing; `<N> pending ticket(s); none released on the portal` when reconciled clean. If any pending REQ is `released` on the portal, the line is `⚠` with `released on the portal but still in pending-releases/: … — run ./scripts/close-out-release.sh <REQ>` plus a follow-up WARN. **This result never changes the exit code** (gate is REQ-CLI-DOCTOR-001).
- **Network:** `GET <base>/api/ci/releases/resolve?projectSlug=<slug>&versionPrefix=<REQ>` with `Authorization: Bearer <DEVAUDIT_API_KEY>`, 10s abort timeout per REQ; non-2xx / timeout silently skips that REQ.
- **Error paths:** Network/timeout → that REQ skipped (no failure).
- **Fixtures/env:** `cli/test/doctor.test.ts` builds a cwd with `sdlc-config.json` + `compliance/pending-releases/RELEASE-TICKET-REQ-099.md`, unsets `DEVAUDIT_API_KEY`, and asserts output contains `pending ticket(s)` with exit ∈ {0,6}.

#### REQ-CLI-DOCTOR-003 — Plugin `onDoctor` hooks run after the built-in checks

- **Priority:** Could — only with plugins installed; non-gating.
- **Source:** `cli/src/commands/doctor.ts` (`runDoctor` plugin block); `cli/src/lib/plugin/hooks.ts`
- **Preconditions / inputs:** Discovered plugins exposing `onDoctor`.
- **Given** an installed plugin **When** doctor runs **Then** its `onDoctor` hook runs with a context scoped to `process.cwd()`; a throwing hook is caught and warned, not fatal. With no plugins, no extra output. The exit code remains governed solely by the required-tools result.
- **Error paths:** Hook throw → warning only.
- **Fixtures/env:** Plugin install dir with a test plugin.

#### REQ-CLI-DOCTOR-004 — `doctor` checks tools, not auth/config validity (scope note)

- **Priority:** Won't — clarifies that the command's `--help` blurb ("auth state, config validity") overstates current behaviour.
- **Source:** `cli/src/commands/doctor.ts` (`runDoctor`); `cli/src/index.ts` (doctor description)
- **Preconditions / inputs:** `devaudit doctor`.
- **Given** the current implementation **When** doctor runs **Then** it verifies only the five required tools (+ the non-gating release-drift line + plugin hooks). It does **not** validate the cached auth token (`~/.config/devaudit/auth.json`) or parse `sdlc-config.json` for validity, despite the command description claiming "auth state, config validity." E2E should assert tool checks only. See Assumptions.
- **Error paths:** N/A.
- **Fixtures/env:** N/A.

---

#### REQ-CLI-BOOTSTRAP-001 — Opt-in drop of governance starter templates into `compliance/governance/`

- **Priority:** Must — explicit, non-destructive seeding of the governance docs; the v0.1.36 replacement for the removed auto-seed install step.
- **Source:** `cli/src/commands/bootstrap-governance.ts` (`runBootstrapGovernance`); `cli/src/install/bootstrap-governance.ts` (`bootstrapGovernanceDocs`)
- **Preconditions / inputs:** `devaudit bootstrap-governance [path]`; path defaults to `process.cwd()`, resolved absolute. Source templates at `sdlc/files/_common/governance/*.md.template` (six: `ai-disclosure`, `dpia`, `incident-report`, `periodic-review`, `risk-register`, `ropa`).
- **Given** a consumer with no existing governance docs **When** `devaudit bootstrap-governance <path>` **Then** `<path>/compliance/governance/` is created and each `*.md.template` is copied with the `.template` suffix dropped (e.g. `ropa.md.template` → `compliance/governance/ropa.md`); each copied file retains its `STARTER TEMPLATE — REPLACE BEFORE COMMITTING` banner. stdout (human) prints a `[Bootstrap governance docs] <N> starter(s) copied to compliance/governance/ — STARTERS, edit before production (see docs/governance-templates.md)`. **Exit 0.** **No network calls.**
- **Error paths:** Source dir missing → `warn` status, message `source directory not found: <dir> (…)`. No `*.md.template` files → `warn` status `no .md.template files in <dir>`. (Status command does not set a non-zero exit; see Assumptions.)
- **Fixtures/env:** Temp consumer dir; installer root resolving `sdlc/files/_common/governance/`.

#### REQ-CLI-BOOTSTRAP-002 — Idempotent / non-destructive: existing files preserved, never overwritten

- **Priority:** Must — the entire opt-in rationale hinges on never clobbering operator-edited governance docs.
- **Source:** `cli/src/install/bootstrap-governance.ts` (`bootstrapGovernanceDocs`, skip-if-exists via `isFile`)
- **Preconditions / inputs:** Some `compliance/governance/*.md` already present on disk.
- **Given** a consumer where `compliance/governance/ropa.md` already exists **When** bootstrap runs (again) **Then** existing targets are **skipped** (left byte-for-byte unchanged) and only absent ones are written; message becomes `<copied> copied, <skipped> kept (already on disk) — STARTERS, edit before production …`. Re-running after a full first pass copies 0 and keeps all. **Exit 0.** Implication: `devaudit update` never re-runs this (governance docs are not part of the sync), so operator edits survive updates.
- **Error paths:** None.
- **Fixtures/env:** Temp consumer pre-seeded with one governance file.

#### REQ-CLI-BOOTSTRAP-003 — `--dry-run` plans without writing

- **Priority:** Should — preview before committing the starters.
- **Source:** `cli/src/commands/bootstrap-governance.ts` (forwards `globals.dryRun`); `cli/src/install/bootstrap-governance.ts` (dryRun branch)
- **Preconditions / inputs:** `devaudit bootstrap-governance --dry-run [path]`.
- **Given** `--dry-run` **When** it runs **Then** **no files are written** and **no directory is created**; status is `planned`, human output `[Bootstrap governance docs] (dry-run) would copy <N> starter(s) to compliance/governance/ (skip-if-exists)`. **Exit 0.**
- **Error paths:** Same warn paths as REQ-CLI-BOOTSTRAP-001 take precedence (checked before the dry-run branch).
- **Fixtures/env:** Temp consumer; assert no `compliance/governance/` created.

#### REQ-CLI-BOOTSTRAP-004 — `--json` machine-readable result

- **Priority:** Could — tooling/CI consumption.
- **Source:** `cli/src/commands/bootstrap-governance.ts` (`isJsonMode`/`emitJsonResult`); `StepResult` shape in `cli/src/install/types.ts`
- **Preconditions / inputs:** `devaudit bootstrap-governance --json [path]`.
- **Given** `--json` **When** it runs **Then** exactly one JSON object is emitted: the `StepResult` `{ step:"Bootstrap governance docs", status:"ok"|"warn"|"planned", message, data }` where `data` carries `{ copied:[…], skipped:[…], targetDir:"compliance/governance" }` on success (or `{ templates:[…] }` on dry-run). **Exit 0.** No human log lines.
- **Error paths:** Warn paths emit `status:"warn"` with the diagnostic message; still exit 0.
- **Fixtures/env:** As REQ-CLI-BOOTSTRAP-001 with `--json`.

---

#### Assumptions — Update/Status/Doctor/Bootstrap

- **`update --dry-run` is not honoured.** The `update` action in `cli/src/index.ts` never forwards `globals.dryRun` to `runUpdate`, and `runUpdate` has no dry-run branch, so `devaudit update --dry-run` mutates the tree like a normal run. Captured as REQ-CLI-UPDATE-018; treated as current (possibly unintended) behaviour, not a bug to assert as desirable.
- **`doctor` does not check auth/config despite its description.** `cli/src/index.ts` describes doctor as verifying "auth state, config validity," but `runDoctor` only runs the five tool checks + the non-gating release-drift line + plugin hooks. Captured as REQ-CLI-DOCTOR-004 (Won't) to flag the doc/behaviour mismatch for E2E.
- **Governance banner wording differs between code comment and templates.** `cli/src/install/bootstrap-governance.ts`'s docstring says the banner reads "STARTER TEMPLATE — REPLACE BEFORE GOING TO PRODUCTION," but the actual templates under `sdlc/files/_common/governance/*.md.template` say "STARTER TEMPLATE — REPLACE BEFORE COMMITTING." Requirements assert the on-disk template text (the externally observable artifact).
- **Malformed `sdlc-config.json` exit code unverified.** `readSdlcConfig`/`resolveAdapters` `JSON.parse` a syntactically-bad config and let the error propagate; for `status` and `update` this surfaces via the top-level handler as exit 1 (inferred, not covered by an existing test).
- **`bootstrap-governance` warn paths still exit 0.** `runBootstrapGovernance` never calls `process.exit`; even `status:"warn"` (missing source dir / no templates) returns normally → exit 0. E2E should not expect a non-zero code for those.
- **Network surface.** Among these four commands, only `update` (via `syncStackDeps`'s conditional `npm install`) and `doctor` (via the optional release-drift `GET /api/ci/releases/resolve`) make outbound calls, and both only under specific preconditions; `status` and `bootstrap-governance` are fully local.
- **Cross-area deps:** these commands share `resolveInstallerRoot` (`DEVAUDIT_INSTALLER_ROOT` / bundled snapshot — same as `install`/`join`), `readSdlcConfig` (consumer-config contract shared with `install`), the stack/host adapter loader (`cli/src/lib/adapter.ts`), the plugin lifecycle (`beforeSync`/`afterSync`/`onDoctor` — shared with the install flow), and `bootstrapGovernanceDocs` (shared with the former install step 11/12). `update`'s output and the framework-file list in `status` are coupled to the same `sdlc/files/` template set.

### Commands: push, auth, plugin, upgrade, global flags & stubs

Black-box SRS for the `devaudit` CLI areas: evidence upload (`push`), authentication (`auth login|logout|status`), plugin lifecycle (`plugin list|install|remove|update`), self-update (`upgrade`), the global flags applied to every command, and the stubbed `org`/`config` command groups. Requirements are derived only from externally observable behaviour: the command line + flags + environment variables → stdout/stderr, process exit code, filesystem deltas (the auth cache and plugin store), and HTTP calls to the DevAudit portal. They are reverse-engineered from `cli/src/index.ts` (commander wiring, global flags, `preAction` hook, `upgrade` stub), `cli/src/commands/push.ts`, `cli/src/lib/ci-upload.ts`, `cli/src/lib/devaudit-api.ts`, `cli/src/lib/auth.ts`, `cli/src/lib/paths.ts`, `cli/src/commands/auth/{login,logout,status}.ts`, `cli/src/commands/plugin/{list,install,remove,update}.ts`, `cli/src/lib/plugin/{load,discover,commands}.ts`, `cli/src/commands/stub.ts`, `cli/src/lib/logger.ts`, and the shell reference `scripts/upload-evidence.sh`. CLI under test is package version **0.1.54** (`cli/package.json`).

Key cross-cutting facts (asserted once, relied on below):

- Config root is resolved by `env-paths('devaudit', { suffix: '' })` (`cli/src/lib/paths.ts`). On Linux this is `~/.config/devaudit/`. `AUTH_FILE = <config>/auth.json`, `PLUGINS_DIR = <config>/plugins`, `CONFIG_FILE = <config>/config.json`. Tests MUST override `HOME`/`XDG_CONFIG_HOME` (or pass `{ root }` to the plugin command functions, which accept it) to sandbox these.
- Default portal base URL is `https://devaudit.metasession.co` (`DEFAULT_BASE_URL` in `push.ts`, `auth.ts`, `login.ts`).
- Logger (`cli/src/lib/logger.ts`): `--json` mode replaces all `consola` output with one NDJSON record per call written to stdout as `{level,tag,args,date}`; `emitJsonResult()` writes a single raw `JSON.stringify(payload)+"\n"` to stdout. `--no-color` sets `process.env.NO_COLOR='1'`. `--verbose` raises log level 3→5. The `preAction` hook configures the logger from `cmd.optsWithGlobals()` before any action runs.

---

#### REQ-CLI-PUSH-001 — Required positionals and portal upload contract

- **Priority:** Must — core evidence-upload path; the reason the command exists.
- **Source:** `cli/src/index.ts` (`program.command('push <project-slug> <requirement-id> <evidence-type> <file>')`), `cli/src/commands/push.ts` (`runPush`), `cli/src/lib/ci-upload.ts` (`uploadEvidence`, `uploadOne`).
- **Preconditions / inputs:** Four required positionals: `<project-slug> <requirement-id> <evidence-type> <file>`. API key present (see PUSH-002). `<file>` exists.
- **Given** a readable file and a valid API key **When** `devaudit push acme REQ-001 test_report ./report.txt --api-key dak_x` **Then** the CLI POSTs `multipart/form-data` to `<baseUrl>/api/evidence/upload` with header `authorization: Bearer dak_x` and form fields `file` (Blob, filename = `basename(file)`), `projectSlug`, `requirementId`, `evidenceType`, and `metadata` (JSON string, `{}` when no `--git-sha/--ci-run-id/--branch`); on 2xx stdout shows `Uploading … → <baseUrl>`, a per-file `✓ <file> (HTTP 200)`, a blank line, then `Uploaded: 1 succeeded, 0 failed.`; exit code 0; no filesystem deltas.
- **Error paths:** missing positionals → commander prints usage to stderr + exits non-zero (commander default). If `uploadEvidence` finds zero files it throws `DevAuditApiError("No files at <path>")` → caught by top-level handler in `index.ts` → message to stderr, exit 1.
- **Fixtures/env:** msw POST handler on `<baseUrl>/api/evidence/upload`; temp file; `--api-key` or `DEVAUDIT_API_KEY`.

#### REQ-CLI-PUSH-002 — API key resolution and missing-key fast-fail (exit 3)

- **Priority:** Must — auth gate for every upload.
- **Source:** `cli/src/commands/push.ts` (`runPush`, lines ~67–75).
- **Preconditions / inputs:** Key resolved as `options.apiKey ?? process.env.DEVAUDIT_API_KEY` (i.e. `--api-key` overrides env).
- **Given** neither `--api-key` nor `DEVAUDIT_API_KEY` is set **When** `devaudit push acme REQ-001 test_report ./f.txt` **Then** (non-JSON) stderr: `DEVAUDIT_API_KEY env var is required (or pass --api-key).` plus an info line pointing at `<portal>/projects/<slug>/settings → API Key Management`; **exit code 3**; no HTTP call made. **And** in `--json` mode it instead emits `{"ok":false,"reason":"missing_api_key"}` to stdout then exits 3.
- **Error paths:** this requirement IS the error path.
- **Fixtures/env:** ensure `DEVAUDIT_API_KEY` unset; capture stdout for JSON variant; spy on `process.exit`.

#### REQ-CLI-PUSH-003 — Base URL resolution precedence and trailing-slash normalisation

- **Priority:** Must — controls where evidence is sent.
- **Source:** `cli/src/commands/push.ts` (`baseUrl = options.baseUrl ?? process.env.DEVAUDIT_BASE_URL ?? DEFAULT_BASE_URL`), `cli/src/lib/ci-upload.ts` (`opts.baseUrl.replace(/\/$/, '')`).
- **Given** `--base-url https://portal.test/` (trailing slash) **When** push runs **Then** the POST URL is exactly `https://portal.test/api/evidence/upload` (single slash). Precedence: `--base-url` > `DEVAUDIT_BASE_URL` > `https://devaudit.metasession.co`.
- **Error paths:** n/a (resolution only).
- **Fixtures/env:** msw handler asserting the resolved URL; set/clear `DEVAUDIT_BASE_URL`.

#### REQ-CLI-PUSH-004 — Metadata assembly from --git-sha / --ci-run-id / --branch

- **Priority:** Must — provenance fields consumers rely on.
- **Source:** `cli/src/commands/push.ts` (`buildMetadata`), `cli/src/lib/ci-upload.ts` (`form.set('metadata', JSON.stringify(opts.metadata ?? {}))`).
- **Given** `--git-sha abc --ci-run-id 99 --branch main` **When** push runs **Then** the `metadata` form field is `{"gitSha":"abc","ciRunId":"99","branch":"main"}`. Omitted flags are omitted from the object; with none set, `metadata` is `{}`.
- **Error paths:** n/a.
- **Fixtures/env:** msw handler parsing the multipart `metadata` field.

#### REQ-CLI-PUSH-005 — Release / environment / category form fields

- **Priority:** Must — gate-relevant fields forwarded to the portal.
- **Source:** `cli/src/commands/push.ts` (maps `--release`→`releaseVersion`, `--create-release-if-missing`→`createReleaseIfMissing`, `--environment`→`environment`, `--category`→`evidenceCategory`), `cli/src/lib/ci-upload.ts` (`uploadOne` form.set calls).
- **Given** `--release v1.0.0 --create-release-if-missing --environment uat --category ci_pipeline` **When** push runs **Then** the form additionally contains `releaseVersion=v1.0.0`, `createReleaseIfMissing=true`, `environment=uat`, `evidenceCategory=ci_pipeline`. Each field is only set when its flag is present; `createReleaseIfMissing` is sent only when truthy.
- **Error paths:** The CLI enforces the same coherence checks as the shell for these flags: `--environment` without `--release` exits 2 with an invalid-arguments message, and `--release` without `--category` does the same.
- **Fixtures/env:** msw handler inspecting form fields.

#### REQ-CLI-PUSH-006 — Retry on 429/5xx with exponential backoff, capped at 5 attempts by default

- **Priority:** Must — rate-limit resilience for CI bursts (devaudit#263 analogue).
- **Source:** `cli/src/lib/ci-upload.ts` (`RETRYABLE_STATUSES = {429,500,502,503,504}`, `DEFAULT_MAX_ATTEMPTS = 5`, `INITIAL_BACKOFF_MS = 1000`, `uploadOne` retry loop).
- **Given** the portal returns 429 (or 500/502/503/504) on attempts 1–2 then 200 **When** push runs **Then** the file is retried (backoff 1000ms then 2000ms), ultimately succeeds, prints `✓ … (HTTP 200)`, exit 0. Backoff doubles each attempt.
- **Error paths:** if all retry attempts return a retryable status, the loop exits and the last response becomes a failure result (status = last code) → `✗` line, `failCount>0` → exit 4 (PUSH-009). Default cap is **5** attempts, overridable by `UPLOAD_MAX_ATTEMPTS`, and backoff is in milliseconds.
- **Fixtures/env:** msw handler returning sequenced statuses; fake timers to avoid real 1–2s waits.

#### REQ-CLI-PUSH-007 — Retry-After header honoured for retryable responses

- **Priority:** Must — respects portal-supplied throttle window.
- **Source:** `cli/src/lib/ci-upload.ts` (`retryAfter = Number.parseInt(res.headers.get('retry-after'))`; `wait = finite>0 ? retryAfter*1000 : backoff`).
- **Given** a 429 with `Retry-After: 2` **When** push retries **Then** the CLI waits `2*1000`ms before the next attempt instead of the default backoff. Non-numeric / absent / ≤0 `Retry-After` falls back to the exponential backoff value.
- **Error paths:** malformed header → fallback backoff (no crash).
- **Fixtures/env:** msw handler setting `Retry-After`; fake timers asserting the delay.

#### REQ-CLI-PUSH-008 — 4xx (other than 429) fast-fail, no retry

- **Priority:** Must — auth/validation errors won't self-heal.
- **Source:** `cli/src/lib/ci-upload.ts` (`uploadOne`: only `RETRYABLE_STATUSES` retry; everything else returns `{ok:false,status,error:errText}` immediately).
- **Given** the portal returns 401 / 403 / 404 / 422 **When** push runs **Then** exactly one POST is made (no retry), the result is a failure carrying the response body text as `error`, stdout shows `✗ <file> (HTTP 4xx): <body>`, summary `Uploaded: 0 succeeded, 1 failed.`, **exit code 4**.
- **Error paths:** this IS the error path; body-read failure substitutes `(no body)`.
- **Fixtures/env:** msw handlers per status; assert a single request hit.

#### REQ-CLI-PUSH-009 — Per-file success/failure tally, summary, and exit code 4 on any failure

- **Priority:** Must — overall result contract.
- **Source:** `cli/src/commands/push.ts` (`okCount`/`failCount` loop; `if (failCount > 0) process.exit(4)`).
- **Given** N files where some succeed and some fail **When** push runs **Then** stdout prints one `✓`/`✗` line per file, then `Uploaded: <ok> succeeded, <fail> failed.`; exit 0 iff `failCount === 0`, else **exit 4**. (Files are uploaded sequentially in directory-listing order.)
- **Error paths:** mixed results still exit 4 if any failed.
- **Fixtures/env:** msw handler returning per-file outcomes.

#### REQ-CLI-PUSH-010 — `--json` machine-readable push result

- **Priority:** Must — CI consumes this.
- **Source:** `cli/src/commands/push.ts` (final `emitJsonResult({ ok, uploaded, failed, results:[{file,ok,status,error}] })`).
- **Given** `--json` on a real (non-dry-run) push **When** it completes **Then** stdout contains a single JSON object `{"ok":<failed===0>,"uploaded":N,"failed":M,"results":[{file,ok,status,error|null}]}`. (Human `✓/✗` lines still emit as NDJSON via the JSON logger reporter; the `emitJsonResult` object is the authoritative result line.) Exit code still 4 if any failed.
- **Error paths:** missing-key JSON variant → `{"ok":false,"reason":"missing_api_key"}` (PUSH-002).
- **Fixtures/env:** capture stdout, parse last JSON object.

#### REQ-CLI-PUSH-011 — Directory upload (recursive) vs single file

- **Priority:** Must — directory uploads are the common CI shape.
- **Source:** `cli/src/lib/ci-upload.ts` (`collectFiles`: file→`[file]`; directory→`readdir` + recursive descent through `entry.isDirectory()`).
- **Given** `<file>` is a directory containing files + subdirectories **When** push runs **Then** every nested regular file is uploaded as a separate POST (parity with the shell script's `find -type f`). A single-file path uploads exactly that file.
- **Error paths:** empty directory → `uploadEvidence` throws `No files at <path>` → exit 1 (top-level handler).
- **Fixtures/env:** temp dir with a nested subdir; assert nested files are POSTed too.

#### REQ-CLI-PUSH-012 — `--dry-run` previews without any HTTP or filesystem mutation

- **Priority:** Must — safe preview; explicitly tested in `flag-polish.test.ts`.
- **Source:** `cli/src/commands/push.ts` (`runDryRun`; gated by `options.dryRun` before key resolution).
- **Given** `--dry-run` (global flag, threaded into `PushOptions.dryRun`) **When** `devaudit push acme REQ-001 test_report <dir>` **Then** NO POST is made; (non-JSON) stdout: `[dry-run] Would upload N file(s) for acme/REQ-001 (test_report) → <baseUrl>` followed by one `· <file>` line per collected file; exit 0. **And** dry-run does NOT require an API key (it runs before the key check).
- **Error paths:** if `<file>` does not exist, `collectFiles` `fs.stat` rejects → top-level handler → exit 1.
- **Fixtures/env:** msw with `onUnhandledRequest:'error'` to prove no upload; temp dir of files.

#### REQ-CLI-PUSH-013 — `--dry-run --json` structured plan payload

- **Priority:** Should — JSON preview for CI dry-runs; tested in `flag-polish.test.ts`.
- **Source:** `cli/src/commands/push.ts` (`runDryRun` JSON branch).
- **Given** `--dry-run --json` **When** push runs **Then** stdout is a single object `{dryRun:true, projectSlug, requirementId, evidenceType, baseUrl, files:[{path}], metadata, release?, environment?, category?}` (release/environment/category present only when their flags are set); no POST; exit 0.
- **Error paths:** n/a.
- **Fixtures/env:** capture stdout; assert `files.length` matches collected files and `uploadHits` is empty.

#### REQ-CLI-PUSH-014 — Base-URL redirect handling / drift warning (parity note)

- **Priority:** Should — both the shell reference and the CLI now surface host-drift warnings before upload.
- **Source:** `scripts/upload-evidence.sh` (`probe_base_url_drift`, `curl -X POST -L --max-redirs 3`); `cli/src/commands/push.ts` (`probeBaseUrlDrift` call before upload); `cli/src/lib/ci-upload.ts` (`probeBaseUrlDrift`).
- **Given** the portal host issues a 301/302 to a new host **When** the shell script runs **Then** it prints a `WARNING: DEVAUDIT_BASE_URL host '<old>' redirects to '<new>' …` block (issue #143) but still uploads (curl follows the redirect). **When the CLI runs**, it first probes `<baseUrl>/api/health` with `redirect:'manual'`; if that redirects cross-host it emits a warning via the logger, then continues to upload using `fetch`, which follows redirects by default. E2E should assert both the warning and the successful upload-through-redirect behaviour.
- **Error paths:** redirect loop — `fetch` caps redirects internally (no `--max-redirs 3` equivalent surfaced).
- **Fixtures/env:** msw 301→200 chain for the CLI; for shell parity, a curl-level redirect fixture.

#### REQ-CLI-PUSH-015 — beforePush / afterPush plugin hooks fire around a real upload

- **Priority:** Could — plugin integration on the push path.
- **Source:** `cli/src/commands/push.ts` (`discoverPlugins().loaded`; `runHook(plugins,'beforePush',ctx)` before upload, `'afterPush'` after).
- **Given** an installed plugin declaring `beforePush`/`afterPush` hooks **When** a non-dry-run push runs **Then** `beforePush` runs before the first POST and `afterPush` after the summary, with a context built from `projectPath = cwd`. Dry-run does NOT invoke hooks. Hook errors are isolated per-plugin (do not abort the push) per `runHook`'s error isolation (`plugin.test.ts`).
- **Error paths:** a throwing hook is reported but push continues.
- **Fixtures/env:** temp `PLUGINS_DIR` with a fixture plugin; assert hook ordering relative to upload.

#### REQ-CLI-PUSH-016 — `--test-cycle` forwards `testCycleId` form field for portal cycle grouping

- **Priority:** Should — enables the portal to group evidence by test cycle (ISO/IEC/IEEE 29119-3 per-cycle Test Execution Logs / Test Status Reports); additive/optional, no regression without it (DevAudit-Installer#209).
- **Source:** `cli/src/commands/push.ts` (`PushOptions.testCycle`, forwarded as `testCycleId` to `uploadEvidence`), `cli/src/lib/ci-upload.ts` (`UploadOptions.testCycleId`, `buildUploadForm` sets `form.set('testCycleId', opts.testCycleId)`), `cli/src/index.ts` (`.option('--test-cycle <id>', …)`).
- **Preconditions / inputs:** `--test-cycle <id>` flag on the `push` command. The value is an opaque grouping key (typically a GitHub Actions `run_id`).
- **Given** `--test-cycle 1234567` **When** push runs **Then** the multipart form additionally contains `testCycleId=1234567`. **Given** no `--test-cycle` flag **When** push runs **Then** the form omits `testCycleId` entirely (the portal defaults to `null` — legacy/ungrouped). The field is orthogonal to `evidenceType`, `evidenceCategory`, and `sdlcStage`.
- **Error paths:** n/a — the value is an opaque string; no client-side validation.
- **Fixtures/env:** msw handler asserting the form field presence/absence.

#### REQ-CLI-PUSH-017 — Upload bodies are sourced from disk-backed blobs, not `fs.readFile()` whole-buffer preloading

- **Priority:** Should — this is the installer-side memory reduction for large CI/local uploads (issue #331).
- **Source:** `cli/src/lib/ci-upload.ts` (`createUploadSource`, `buildUploadForm`, `uploadOne`, `uploadPresigned`).
- **Preconditions / inputs:** Any normal `push` upload path.
- **Given** a readable evidence file **When** `uploadEvidence` prepares the request body **Then** it creates a disk-backed `Blob` source (`openAsBlob` on Node 22+) and reuses that blob across multipart retries or the presigned PUT flow, instead of calling `fs.readFile()` to preload the whole file into heap memory. The presigned metadata request still sends `fileSizeBytes` and `mimeType`, but those come from file stat / mime derivation, not a preloaded buffer.
- **Error paths:** If the runtime cannot provide a disk-backed blob, the helper may fall back to `fs.readFile()` compatibility mode; the observable contract is that supported Node 22+ runtimes take the blob-backed path.
- **Fixtures/env:** unit test spying on `fs.readFile` while asserting successful multipart and presigned uploads without that function being called.

#### REQ-CLI-PUSH-018 — Starter-stub skip uses a small text prefix read, not whole-file buffering

- **Priority:** Should — this avoids loading full files just to decide “skip vs upload” (issue #331).
- **Source:** `cli/src/lib/ci-upload.ts` (`isTextLikeEvidenceFile`, `readFilePrefix`, `isUneditedStub`).
- **Preconditions / inputs:** A governance/compliance starter file that still contains the `STARTER TEMPLATE … REPLACE BEFORE` banner.
- **Given** a text-like evidence file (`.md`, `.txt`, `.json`, `.yml`, `.yaml`, `.csv`, `.html`, `.xml`, `.log`) **When** uploadEvidence checks whether it is still an unedited starter stub **Then** it reads only a small prefix from disk, matches the starter banner there, and returns `{ skipped: true }` without uploading. Binary/non-text evidence files do not go through this text decode path.
- **Error paths:** If the banner is absent in the prefix, the file proceeds to the normal upload path.
- **Fixtures/env:** unit test with a starter markdown stub; assert `skipped: true`, no fetch call, and no `fs.readFile()` buffering.

---

#### REQ-CLI-AUTH-001 — `auth login --token` validates against the portal then caches at mode 0600

- **Priority:** Must — token acquisition + secure cache are core security behaviour.
- **Source:** `cli/src/commands/auth/login.ts` (`runAuthLogin`), `cli/src/lib/auth.ts` (`writeAuth`), `cli/src/lib/devaudit-api.ts` (`DevAuditClient.listProjects` → `GET /api/projects` with header `x-devaudit-token`).
- **Preconditions / inputs:** `--token mctok_…` (or `DEVAUDIT_USER_TOKEN` env). `--base-url` defaults to `https://devaudit.metasession.co` (commander default in `index.ts`).
- **Given** a token the portal accepts **When** `devaudit auth login --token mctok_abc` **Then** the CLI sends `GET <baseUrl>/api/projects` with header `x-devaudit-token: mctok_abc`; on success it writes `~/.config/devaudit/auth.json` containing `{"version":1,"token":"mctok_abc","base_url":"<baseUrl>"}` (pretty-printed + trailing newline); the parent dir is created `mode 0o700`, the file `mode 0o600`; stdout: `Logged in. Token cached at ~/.config/devaudit/auth.json (mode 0600).`; exit 0.
- **Error paths:** see AUTH-003.
- **Fixtures/env:** msw `GET /api/projects`; temp `HOME`; assert `(await fs.stat(authFile)).mode & 0o777 === 0o600` and parsed contents shape.

#### REQ-CLI-AUTH-002 — `auth login` interactive PAT paste with `mctok_` validation

- **Priority:** Should — the human onboarding flow (CI uses `--token`/env).
- **Source:** `cli/src/commands/auth/login.ts` (`clack.password` with `validate`).
- **Given** no `--token` and no `DEVAUDIT_USER_TOKEN` **When** `devaudit auth login` (TTY) **Then** stdout prints the `Open <baseUrl>/settings/tokens …` + `Paste the mctok_… value …` guidance and prompts via a masked password input; the validator rejects empty (`Token is required.`) and any value not starting with `mctok_` (`Token should start with 'mctok_'.`). On accept it proceeds to validation+cache (AUTH-001).
- **Error paths:** Ctrl-C / cancel (`clack.isCancel`) → stderr `Cancelled.`, **exit 0** (clean cancel, not error).
- **Fixtures/env:** hard to E2E non-interactively → prefer `--token`/env in CI; document prompt contract for completeness. (Assumption: tests cover the `--token` path instead.)

#### REQ-CLI-AUTH-003 — `auth login` rejects an invalid token (exit 3) without caching

- **Priority:** Must — must not persist a known-bad token.
- **Source:** `cli/src/commands/auth/login.ts` (catch on `DevAuditApiError` with `status 401||403`).
- **Given** the portal returns 401 or 403 to `GET /api/projects` **When** `devaudit auth login --token mctok_bad` **Then** stderr: `Token rejected by portal (HTTP <status>). Check it was copied correctly + is not revoked.`; **exit 3**; `auth.json` is NOT written/modified.
- **Error paths:** any non-401/403 error is rethrown → top-level handler → message to stderr, exit 1.
- **Fixtures/env:** msw returning 401/403; assert no auth.json created.

#### REQ-CLI-AUTH-004 — `auth logout` deletes the cached token

- **Priority:** Should — credential removal.
- **Source:** `cli/src/commands/auth/logout.ts` (`runAuthLogout`), `cli/src/lib/auth.ts` (`deleteAuth`).
- **Given** `~/.config/devaudit/auth.json` exists **When** `devaudit auth logout` **Then** the file is unlinked; stdout: `Removed cached token at <AUTH_FILE>.`; exit 0. **Given** no cached file, stdout: `No cached token to remove.`; exit 0 (idempotent, no error).
- **Error paths:** ENOENT is treated as "did not exist" (returns false), not an error; other unlink errors propagate → exit 1.
- **Fixtures/env:** temp `HOME`; pre-seed (or omit) auth.json; assert deletion.

#### REQ-CLI-AUTH-005 — `auth status` resolves token source and verifies against portal

- **Priority:** Should — diagnostic; tested in `flag-polish.test.ts` (JSON path).
- **Source:** `cli/src/commands/auth/status.ts` (`runAuthStatus`), `cli/src/lib/auth.ts` (`resolveToken`: env `DEVAUDIT_USER_TOKEN` wins over the cached file).
- **Given** a cached token (or `DEVAUDIT_USER_TOKEN`) the portal accepts **When** `devaudit auth status` **Then** (non-JSON) stdout shows `Token source:` (= `DEVAUDIT_USER_TOKEN env var` when from env, else `~/.config/devaudit/auth.json`), `Portal: <baseUrl>`, `Verifying token against portal...`, then `Token is valid. Accessible projects: <N>` and up to 10 `• <slug>` lines (`… and K more` if >10); exit 0. **In `--json`** it emits a single `{ok:true,source,baseUrl,projects:[slugs]}` (verified by `flag-polish.test.ts`).
- **Error paths:** see AUTH-006/007.
- **Fixtures/env:** msw `GET /api/projects` returning a project list; set `DEVAUDIT_USER_TOKEN` + `DEVAUDIT_BASE_URL` or seed auth.json.

#### REQ-CLI-AUTH-006 — `auth status` when not logged in (exit 3)

- **Priority:** Should — clear "logged out" signal.
- **Source:** `cli/src/commands/auth/status.ts` (`!resolved` branch).
- **Given** no `DEVAUDIT_USER_TOKEN` and no `auth.json` **When** `devaudit auth status` **Then** (non-JSON) stderr: `Not logged in. Run \`devaudit auth login\` or set DEVAUDIT_USER_TOKEN.`; **exit 3**. In `--json`: `{"ok":false,"reason":"not_logged_in"}` to stdout, exit 3.
- **Error paths:** this IS the error path.
- **Fixtures/env:** clear env + empty temp HOME.

#### REQ-CLI-AUTH-007 — `auth status` when the portal rejects the cached token (exit 3)

- **Priority:** Should — stale/revoked token detection.
- **Source:** `cli/src/commands/auth/status.ts` (catch `DevAuditApiError`).
- **Given** a resolvable token that the portal rejects (any `DevAuditApiError`) **When** `devaudit auth status` **Then** (non-JSON) stderr: `Portal rejected the token (HTTP <status>). Re-run \`devaudit auth login\`.`; **exit 3**. In `--json`: `{"ok":false,"reason":"portal_rejected","status":<n>}`, exit 3. A non-API (unexpected) error → `{"ok":false,"reason":"unexpected","message":…}`/`Unexpected error: …`, **exit 1**.
- **Error paths:** distinguishes portal-rejection (exit 3) from unexpected errors (exit 1).
- **Fixtures/env:** msw returning 401/403 (→ DevAuditApiError) vs a network failure (→ unexpected).

---

#### REQ-CLI-PLUGIN-001 — `plugin list` enumerates the store and reports load failures

- **Priority:** Should — visibility into installed plugins; tested in `plugin-commands.test.ts`.
- **Source:** `cli/src/commands/plugin/list.ts` (`runPluginList`), `cli/src/lib/plugin/discover.ts` (`discoverPlugins`).
- **Given** `~/.config/devaudit/plugins/` (or `--root`-equivalent `{root}`) **When** `devaudit plugin list` **Then** stdout prints `Plugin directory: <root>`; if empty (no loaded, no failures) → `  (no plugins installed)`; otherwise a `Loaded:` section with `  ✓ <pkg>@<ver> hooks=[…] commands=[…]` per valid plugin, and a `Failed to load:` section with `  ✗ <dir> — <reason>` per invalid plugin. Exit 0 regardless. No filesystem mutation; no HTTP.
- **Error paths:** a missing plugins dir is treated as empty (`discoverPlugins` returns empty on ENOENT).
- **Fixtures/env:** temp plugins root with valid + invalid (missing `devaudit` field) fixture dirs.

#### REQ-CLI-PLUGIN-002 — `plugin install <git-url>` clones, npm-installs, validates manifest

- **Priority:** Should — the install lifecycle; tested in `plugin-commands.test.ts`.
- **Source:** `cli/src/commands/plugin/install.ts` (`runPluginInstall`, `deriveDirName`), `cli/src/lib/plugin/load.ts` (`loadPluginFromDir`).
- **Preconditions / inputs:** `<source>` is a Git URL (registry resolution is NOT implemented). Target dir name = last path segment with `.git` stripped.
- **Given** a valid plugin repo **When** `devaudit plugin install git@github.com:foo/devaudit-plugin-x.git` **Then** the CLI `mkdir -p`s the plugins root, runs `git clone --depth 1 <source> <root>/<name>` (`stdio: inherit`); if the clone contains `package.json` it runs `npm install --legacy-peer-deps` in the target; it then validates via `loadPluginFromDir`; on success stdout: `Installed: <pkg>@<ver> at <target>`; exit 0. Filesystem delta: a new `<root>/<name>/` directory.
- **Error paths:** target already exists → stderr `Plugin directory already exists: <target>. Run \`devaudit plugin remove <name>\` first.`, **exit 2**. `git clone`fails → stderr`git clone failed: …`, **exit 6**. `npm install`non-zero → stderr`npm install failed — leaving the plugin dir in place for inspection.`, **exit 5** (dir left behind). Manifest validation fails → stderr `Plugin validation failed: …`, the target dir is `rm -rf`'d, **exit 9**. Underivable name → **exit 2**.
- **Fixtures/env:** mock `execa` (as the tests do) so `git clone`/`npm install` are stubbed and the clone fixture writes a valid `package.json`+`plugin.js`; temp `{root}`.

#### REQ-CLI-PLUGIN-003 — `plugin remove <name>` deletes a plugin by package or directory name

- **Priority:** Should — removal lifecycle; tested in `plugin-commands.test.ts`.
- **Source:** `cli/src/commands/plugin/remove.ts` (`runPluginRemove`).
- **Given** an installed plugin **When** `devaudit plugin remove <name>` **Then** the CLI matches `<name>` against each plugin's `packageName` OR its directory basename (loaded and failed-to-load alike), `rm -rf`s the matched dir, prints `Removed plugin at <dir>`, exit 0. Filesystem delta: the dir is gone.
- **Error paths:** no match → stderr `No plugin found matching '<name>'.` + `Run \`devaudit plugin list\` …`, **exit 2** (the dir is not touched).
- **Fixtures/env:** temp `{root}` with a fixture plugin; assert `fs.access` rejects after removal.

#### REQ-CLI-PLUGIN-004 — `plugin update` git-pulls + npm-installs each git-backed plugin

- **Priority:** Should — update lifecycle; tested in `plugin-commands.test.ts`.
- **Source:** `cli/src/commands/plugin/update.ts` (`runPluginUpdate`, `updateOne`).
- **Given** installed plugins (some git checkouts, some not) **When** `devaudit plugin update` **Then** stdout: `Updating N plugin(s)...`; for each plugin with a `.git` dir it runs `git pull --ff-only` (cwd = plugin dir) and, if `package.json` exists, `npm install --legacy-peer-deps`; per-plugin lines: `  ✓ <p> — updated` (pulled changes), `  · <p> — already up to date` (when `git pull` stdout matches `Already up to date`), `  ⚠ <p> — not a git checkout, skipped` (no `.git`), or `  ✗ <p> — <detail>` (pull or post-pull npm install failed). Exit 0 (no aggregate failure exit code). Non-git plugins are NOT pulled.
- **Error paths:** zero installed plugins → stdout `No plugins installed.`, exit 0. `git pull` non-zero → status `failed` with first stderr line. `npm install` non-zero after a successful pull → `failed` (`npm install failed after pull`).
- **Fixtures/env:** mock `execa`; temp `{root}` with one `gitDir:true` and one plain fixture; assert exactly one `git pull` + one `npm install`.

#### REQ-CLI-PLUGIN-005 — Manifest validation contract gates load/install

- **Priority:** Could — defines what a "valid plugin" is (the SDK contract); tested in `plugin.test.ts` + `plugin-sdk`.
- **Source:** `plugin-sdk/src/manifest.ts` (`validateManifest`), `cli/src/lib/plugin/load.ts` (`loadPluginFromDir`).
- **Given** a plugin dir **When** it is discovered/installed **Then** validity requires: non-empty `name`, `version`, `main` strings in package.json; a `devaudit` object with `apiVersion === '1'` (the only supported version); optional `commands[]` (each `{name,description}`, name matching `/^[a-z][a-z0-9-]*$/`) and `hooks[]` (recognised lifecycle names). Additionally the resolved `main` module must `default`-export an object with `apiVersion === '1'` and a non-empty `name` (runtime check). Any failure → discovery records it as a load failure / install aborts (PLUGIN-002).
- **Error paths:** missing `devaudit` field → `package.json must include a top-level \`devaudit\` object`; runtime apiVersion mismatch → `apiVersion '<x>' at runtime, expected '1'` (tested).
- **Fixtures/env:** fixture plugins with malformed manifests; assert failure reasons match.

#### REQ-CLI-PLUGIN-006 — Plugin-contributed commands register under a derived namespace

- **Priority:** Could — plugins extend the CLI surface.
- **Source:** `cli/src/lib/plugin/commands.ts` (`registerPluginCommands`, `pluginNamespace` strips `@scope/` and `devaudit-plugin-` prefix), `cli/src/index.ts` (called after stub/auth/plugin wiring).
- **Given** a loaded plugin `devaudit-plugin-foo` declaring command `bar` **When** the CLI builds **Then** `devaudit foo bar [args...]` becomes available; invoking it calls the plugin's command impl with a context (cwd) and the args array; a thrown impl error prints `Plugin '<pkg>' command '<bar>' failed: <msg>` to stderr and exits 1. Plugins with zero manifest commands add no group.
- **Error paths:** impl error → exit 1.
- **Fixtures/env:** fixture plugin with a `commands` entry; assert help text includes the namespace (`plugin.test.ts` pattern).

---

#### REQ-CLI-UPGRADE-001 — `upgrade` is a stub, not a real self-update (exit 1)

- **Priority:** Could — documents that self-update is NOT yet implemented (the prompt's premise that `upgrade` performs an npm self-update is FALSE for v0.1.54).
- **Source:** `cli/src/index.ts` (`.command('upgrade')` → `makeStub({command:'upgrade', summary:'Self-update via npm or the platform package manager. Workstream A milestone 8.', trackedIn: TRACKING_ISSUE})`), `cli/src/commands/stub.ts` (`makeStub`).
- **Given** any invocation **When** `devaudit upgrade` **Then** it performs NO npm install and NO network call; stderr/stdout (via logger): `\`devaudit upgrade\` is not implemented yet.`(warn), then the summary`Self-update via npm or the platform package manager. Workstream A milestone 8.`, then `Tracked in: https://github.com/metasession-dev/DevAudit-Installer/issues/1`, then the "File an issue …" line; **exit 1**.
- **Error paths:** the stub itself is the terminal state (always exit 1).
- **Fixtures/env:** spy `process.exit`; assert no child process / HTTP. (Note: there is no separate `cli/test/update.test.ts` coverage for `upgrade`; `update.test.ts` covers the unrelated `devaudit update` template-sync command.)

---

#### REQ-CLI-GLOBAL-001 — Global flags accepted on every command via `applyCommonFlags`

- **Priority:** Could — flags are wired once on the root program and merged with `optsWithGlobals()`.
- **Source:** `cli/src/index.ts` (`applyCommonFlags`: `--json`, `-y/--yes`, `--dry-run`, `-v/--verbose`, `--no-color`, `--org <slug>`).
- **Given** any subcommand **When** a global flag is passed (before or after the subcommand) **Then** it is honoured because the `preAction` hook reads `cmd.optsWithGlobals()`. `-V/--version` prints `CLI_VERSION` (0.1.54); `--help`/`-h` prints commander help.
- **Error paths:** unknown options → commander usage error on stderr, non-zero exit.
- **Fixtures/env:** invoke through `main(argv)` with assorted flag positions.

#### REQ-CLI-GLOBAL-002 — `--json` switches to NDJSON logging + raw result objects

- **Priority:** Could — machine output mode.
- **Source:** `cli/src/lib/logger.ts` (`build` JSON reporter; `isJsonMode`, `emitJsonResult`), `preAction` hook in `index.ts`.
- **Given** `--json` **When** any command logs **Then** every log call is written to stdout as one JSON line `{level,tag,args,date}`, and command result summaries use `emitJsonResult` (a bare `JSON.stringify(payload)+"\n"`). Consumers should parse the last well-formed JSON object (the result), as human lines are also JSON-encoded.
- **Error paths:** n/a.
- **Fixtures/env:** capture stdout; `findJsonLine`-style parse (per `flag-polish.test.ts`).

#### REQ-CLI-GLOBAL-003 — `--no-color` strips ANSI (sets NO_COLOR)

- **Priority:** Could — plain output for logs/CI.
- **Source:** `cli/src/lib/logger.ts` (`if (opts.noColor) process.env.NO_COLOR='1'`), `index.ts` (`noColor: opts.color === false` — commander exposes `--no-color` as `color=false`).
- **Given** `--no-color` **When** any command runs **Then** `NO_COLOR=1` is set in-process and consola emits uncoloured output; exit unchanged.
- **Error paths:** n/a.
- **Fixtures/env:** assert `process.env.NO_COLOR` set and output free of ANSI escapes.

#### REQ-CLI-GLOBAL-004 — `--verbose` raises log verbosity

- **Priority:** Could — extra detail.
- **Source:** `cli/src/lib/logger.ts` (`level = verbose ? 5 : 3`).
- **Given** `-v/--verbose` **When** any command runs **Then** debug/verbose-level messages (level 4–5) become visible; default suppresses them.
- **Error paths:** n/a.
- **Fixtures/env:** a command that logs at debug level; assert presence/absence.

#### REQ-CLI-GLOBAL-005 — `--dry-run` and `-y/--yes` thread into commands

- **Priority:** Could — preview / non-interactive acceptance.
- **Source:** `index.ts` (push/install/join read `globals.dryRun`/`globals.yes` from `optsWithGlobals()`).
- **Given** `--dry-run` **When** `push` runs **Then** preview only (see PUSH-012). `-y/--yes` is forwarded to `install`/`join` to accept interactive defaults (CI-friendly); it has no effect on `push`/`auth`/`plugin` which take no prompts on these paths.
- **Error paths:** n/a.
- **Fixtures/env:** assert `dryRun`/`yes` propagation into the action option objects.

#### REQ-CLI-GLOBAL-006 — `--org <slug>` is accepted but currently inert

- **Priority:** Won't — declared as "override active org context for this invocation" but no command in this area consumes it (org context is part of the not-yet-built workstream B).
- **Source:** `index.ts` (`new Option('--org <slug>', …)`); no reader in push/auth/plugin code paths.
- **Given** `--org acme` on `push`/`auth`/`plugin` **When** the command runs **Then** the flag parses without error but has NO observable effect on HTTP calls or filesystem; behaviour is identical to omitting it.
- **Error paths:** n/a (silently inert).
- **Fixtures/env:** assert behaviour is unchanged with/without `--org`.

---

#### REQ-CLI-STUB-001 — `org` subcommands are not-yet-implemented stubs (exit 1)

- **Priority:** Won't — placeholders; the contract is the "not implemented" message + exit 1.
- **Source:** `cli/src/index.ts` (`org list`, `org switch <slug>`, `org policy list`, `org policy apply [path]`, `org report --format`), all via `makeStub` (`cli/src/commands/stub.ts`).
- **Given** any of `devaudit org list|switch <slug>|policy list|policy apply|report` **When** invoked **Then** output (via logger): warn `\`devaudit <command>\` is not implemented yet.`, the per-stub summary line (e.g. `org switch`→`Updates ~/.config/devaudit/config.json.`), `Tracked in: https://github.com/metasession-dev/DevAudit-Installer/issues/1`, then `File an issue at https://github.com/metasession-dev/DevAudit-Installer/issues …`; **exit 1**. No filesystem/HTTP side effects.
- **Error paths:** the stub is terminal (always exit 1); required args still enforced by commander first (e.g. `org switch` with no `<slug>` → usage error before the stub runs).
- **Fixtures/env:** spy `process.exit(1)`; assert the message lines.

#### REQ-CLI-STUB-002 — `config` subcommands are not-yet-implemented stubs (exit 1)

- **Priority:** Won't — placeholders.
- **Source:** `cli/src/index.ts` (`config get <key>`, `config set <key> <value>`, `config list`) via `makeStub`.
- **Given** any of `devaudit config get|set|list` **When** invoked **Then** same stub contract as STUB-001 with per-command summaries (`config get` → `Reads ~/.config/devaudit/config.json.`; `config set` → `Writes to ~/.config/devaudit/config.json (mode 0600).`; `config list` → `Lists all CLI config keys with their current values.`); **exit 1**; `config.json` is NOT read or written despite the messaging.
- **Error paths:** terminal exit 1; commander enforces required `<key>`/`<value>` first.
- **Fixtures/env:** assert exit 1 + message; assert `~/.config/devaudit/config.json` is untouched.

---

#### Assumptions — Push/Auth/Plugin/Global

- **`upgrade` is a stub, not a self-updater.** The task brief describes `upgrade` as "self-update to latest npm release". In v0.1.54 it is wired to `makeStub` and only prints a "not implemented" message + exits 1 (REQ-CLI-UPGRADE-001). I documented the actual stub behaviour, not the aspirational one.
- **CLI vs `scripts/upload-evidence.sh` parity gaps** (documented where load-bearing): the CLI now implements the base-URL **drift warning**, recursive directory traversal, starter-stub skip, `releaseBranch`/`releaseTitle`/`changeType`/`gateStatus`/`--meta-key` form fields, and the `--environment requires --release` / `--release requires --category` validations. The remaining notable gaps are: the CLI still does **not** validate `--sdlc-stage 1-5` client-side because that flag belongs to the shell contract, and the shell remains the CI-authoritative path for stage stamping. The shell sends `releaseBranch=<branch>` while the CLI also keeps `branch` in metadata. These are stated as facts from the two sources, not as defects.
- **API key header / format:** the upload uses `Authorization: Bearer <key>` (`ci-upload.ts`); the portal-validation calls in `devaudit-api.ts` use header `x-devaudit-token`. The shell docs describe project keys as `mc_…` and PATs as `mctok_…`; the CLI only validates the `mctok_` prefix on interactive login (AUTH-002) — `--api-key`/`DEVAUDIT_API_KEY` values are not format-checked.
- **`auth login --base-url` default:** set as a commander option default (`'https://devaudit.metasession.co'`) in `index.ts`, so `runAuthLogin` always receives a base URL; the `?? DEFAULT_BASE_URL` fallback inside `login.ts` is belt-and-suspenders.
- **`auth status` env precedence:** `resolveToken` lets `DEVAUDIT_USER_TOKEN` override the cached file, and `DEVAUDIT_BASE_URL` overrides the file's `base_url` only for the env-token path. Tests must clear these envs to exercise the file path.
- **Interactive `auth login` prompt** (AUTH-002) is impractical to E2E headlessly; assumed coverage is via `--token`/`DEVAUDIT_USER_TOKEN`.
- **`--org` is inert** in this command area (GLOBAL-006) — no reader exists in push/auth/plugin code; treated as parse-only.
- **Exit-code map (this area):** 0 success; 1 generic/top-level error, stub terminal, plugin-command impl error; 2 plugin name/dir conflict or no-match; 3 missing API key (push), token rejected (login/status), not-logged-in (status); 4 one-or-more upload failures (push); 5 plugin npm install failed; 6 git clone failed; 9 plugin manifest validation failed. (7 = `status` not-onboarded belongs to the `status` command, out of this area but observed in `flag-polish.test.ts`.)
- **Cross-area deps:** `push` invokes the plugin subsystem (`discoverPlugins`, `beforePush`/`afterPush` hooks) — overlaps the plugin area and the plugin-lifecycle SRS. `auth`/`push`/`status` all share `DevAuditClient` (`devaudit-api.ts`) and the portal endpoints `GET /api/projects` (auth) and `POST /api/evidence/upload` (push) — coordinate the msw portal stub across auth/push/status test suites. `paths.ts` (`AUTH_FILE`, `PLUGINS_DIR`, `CONFIG_FILE`) is shared by auth, plugin, and the config stubs — a single temp-HOME/XDG sandbox fixture serves all three.

### Framework Skills (.claude/skills/\*)

Scope note: The six entries below are **Claude Code skills** — directories under `sdlc/files/_common/skills/<name>/` that `devaudit install` / `devaudit update` sync verbatim into a consumer repo's `.claude/skills/<name>/`. Each skill's entire observable contract lives in its `SKILL.md`: a YAML frontmatter (`name`, `description`) validated by `sdlc/files/_common/skills/_schema/skill.schema.json`, plus free-form Markdown body that Claude reads as instructions. Because these are agent instructions, every requirement here is framed black-box: a trigger phrase or stage-reached event fires the skill; the skill emits an artefact at a known path with required sections/frontmatter, delegates to a named sub-skill, or pauses for a human. An E2E test can assert each one as "after invoking skill X on REQ-Y, file Z exists at path P containing section S" or "the orchestrator output the literal delegation line before any `e2e/**/*.spec.ts` edit". Requirements derive ONLY from the SKILL.md specs (and the shipped reference files where they are part of the observable contract); nothing is invented. `sdlc-implementer` (the orchestrator) requirements are **Must**; `e2e-test-engineer`'s pack contract is **Must**; the four SoT/governance authoring skills' artefact contracts are **Should**; cross-link/edge details are **Could**.

#### REQ-SKILL-IMPLEMENTER-001 — Trigger phrases fire the orchestrator (Phases 0–4)

- **Priority:** Must — the skill's discovery hinges on its `description` trigger phrases; without them the whole SDLC automation is unreachable.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (frontmatter `description`; § The workflow)
- **Preconditions / inputs:** a GitHub issue `#N`; a consumer repo with the skill synced; `sdlc-config.json` present.
- **Given** a synced consumer repo and issue `#N` **When** the operator says any of "implement issue #N under the SDLC", "run the SDLC for issue #N", "automate REQ-XXX from issue to release", or "do the SDLC stages for [issue]" **Then** the skill activates and begins at Phase 0 (Workflow triage) — fetching the issue via `gh issue view <N> --json labels,title,body` before assigning any `REQ-XXX`.
- **Error paths:** invoked for partial work (stage-1 planning only, or test work alone) → the skill is the wrong entry point; spec directs the user to the manual walkthrough or to `e2e-test-engineer` directly.
- **Fixtures/env:** consumer repo with `.claude/skills/sdlc-implementer/`; a sample GitHub issue; `sdlc-config.json` with `integration_branch`/`release_branch`.

#### REQ-SKILL-IMPLEMENTER-002 — Resume phrase invokes Phase 5 separately

- **Priority:** Must — Phase 5 is a distinct human-gated re-entry; the resume trigger is its only entry point.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (frontmatter `description` "Resume phrase"; § Phase 5)
- **Preconditions / inputs:** a REQ that has already reached the Phase 4 hard stop (release PR open, UAT requested).
- **Given** an issue paused at the Phase 4 UAT gate **When** the operator says "resume REQ-XXX" (or "REQ-XXX UAT done", or re-fires the skill on the same issue) **Then** the skill enters Phase 5, reads portal release state via `curl …/api/projects/<slug>/releases/<version>`, and branches on approval status.
- **Error paths:** resume fired before any Phase 4 stop → no release record to read; skill should report state and not act.
- **Fixtures/env:** a portal release record in `pending` / `approved` / `changes-requested` state.

#### REQ-SKILL-IMPLEMENTER-003 — Phase 0 emits a "Workflow Decision" block and routes

- **Priority:** Must — triage is the gate that stops every issue defaulting to maximum ceremony; it is directly observable as a posted block.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 0 — Workflow triage; "Workflow Decision" announcement template)
- **Preconditions / inputs:** a fetched issue with labels/title/body.
- **Given** issue `#N` fetched **When** Phase 0 runs **Then** the skill announces a "Workflow decision — #N" block containing exactly these fields: Change type, Commit type, Requirement (REQ-XXX or none), Risk, Path, Gates/evidence, Your approvals, Skipped — and then routes: **tracked** → Phase 1; **housekeeping/trivial** → Lightweight path; **compliance-doc-only** → Lightweight path against the existing REQ.
- **Error paths:** classification ambiguous → pause for explicit confirmation; operator may reclassify ("treat this as housekeeping" / "this is HIGH risk").
- **Fixtures/env:** issues seeded with `type:*`/`risk:*` labels, conventional-commit-prefixed titles, and template-typed bodies to exercise the precedence rules.

#### REQ-SKILL-IMPLEMENTER-004 — Phase 0 writes inferred labels back to the issue

- **Priority:** Should — observable side effect; not load-bearing for the cycle but specified as a mandatory step.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 0 step 6)
- **Preconditions / inputs:** a classification result from step 2.
- **Given** Phase 0 has classified the change **When** routing completes **Then** the skill applies the inferred `type:*`/`risk:*` labels — `gh label create <label> --force` (idempotent) then `gh issue edit <N> --add-label <label>` — so the issue ends up labelled.
- **Error paths:** label-seeding step never ran → `--force` create makes it idempotent, no failure.
- **Fixtures/env:** a repo where the labels do not pre-exist.

#### REQ-SKILL-IMPLEMENTER-005 — Lightweight path drives non-tracked work to merge without ceremony

- **Priority:** Must — the off-ramp is the explicit anti-over-ceremony behaviour and has a distinct observable shape (no REQ, no evidence pack, no UAT four-eyes).
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Lightweight path, steps 1–9)
- **Preconditions / inputs:** Phase 0 routed to housekeeping/trivial/compliance-doc-only.
- **Given** a housekeeping/doc-only issue **When** the Lightweight path runs **Then** the skill branches off `$INTEGRATION_BRANCH` with a `chore/` `docs/` `ci/` `build/` `test/` `compliance/` prefix, runs all gates locally (never `--no-verify`), commits with a housekeeping type and **no** `[REQ-XXX]` (compliance: references existing REQ), opens a PR into `$INTEGRATION_BRANCH`, and guides review→merge — with **no** RTM row, evidence pack, UAT four-eyes, or Production approval.
- **Error paths:** the change touches runtime behaviour in `app/`/`lib/` → stop and reclassify as tracked (commit-type rule is the backstop); a `ci:` change → verify-via-dispatch (`gh workflow run <file> --ref <branch>`) before merge.
- **Fixtures/env:** a docs-only issue and a `ci:`-workflow-tweak issue; current generated `ci.yml` with PR-time Quality Gates plus an older post-merge-only fixture to exercise step 7's legacy "no PR-time checks" reporting.

#### REQ-SKILL-IMPLEMENTER-006 — Phase 1 writes the implementation plan from the template at a fixed path

- **Priority:** Must — the implementation plan is the primary Stage-1 artefact and closes four framework clauses on upload.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 1 step 5; clause table)
- **Preconditions / inputs:** tracked route; REQ-XXX assigned (next free in `compliance/RTM.md`); risk classified per `Test_Policy.md`.
- **Given** a tracked issue with REQ-XXX assigned **When** Phase 1 runs **Then** the skill creates `compliance/plans/REQ-XXX/implementation-plan.md` from `sdlc/files/_common/Implementation_Plan_TEMPLATE.md`, retaining the Framework-attribution section that closes **ISO 29119 §3.4** (acceptance criteria + verification strategy), **ISO 27001 A.8.25** (threat model + secrets/deps), **GDPR Art. 25** (data flows + lawful basis + retention, or explicit "no personal data"), and **EU AI Act Art. 11** (model provenance + oversight, or explicit "no AI in scope"); HIGH/CRITICAL additionally include threat model (STRIDE), four-eyes attestation slot, rollback plan.
- **Error paths:** a clause genuinely doesn't apply → mark `N/A — <reason>`, never delete the section (empty stubs break the audit trail).
- **Fixtures/env:** the synced `Implementation_Plan_TEMPLATE.md`; an empty `compliance/RTM.md`.

#### REQ-SKILL-IMPLEMENTER-007 — Phase 1 delegates to requirements-aligner, adr-author, risk-register-keeper (steps 6→7→8)

- **Priority:** Must — the delegation chain is the observable contract that the plan's SRS-ID / ADR / risk sections are produced by sub-skills, not inline.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 1 steps 6, 7, 8; § Sub-skill return semantics)
- **Preconditions / inputs:** the implementation plan exists; risk class known.
- **Given** the plan is drafted **When** Phase 1 steps 6→7→8 run as one flowing sequence (no pause between) **Then** the skill invokes `Skill(name:"requirements-aligner")` to populate the AC table's SRS-ID column, `Skill(name:"adr-author")` to decide ADR-worthiness and inject an ADR-NNN reference or no-ADR rationale, and `Skill(name:"risk-register-keeper")` for MEDIUM/HIGH classifications to inject the RISK-NNN reference list — each via the standard Claude Code Skill mechanism, never authored inline.
- **Error paths:** stopping after a sub-skill's "Return to the running sdlc-implementer context" line is the documented bug; the orchestrator must keep going (opt-in-to-pause, not opt-out).
- **Fixtures/env:** all three sub-skills synced; a MEDIUM-risk REQ to exercise the risk-register-keeper branch.

#### REQ-SKILL-IMPLEMENTER-008 — Phase 1 updates RTM and posts a plan-summary comment

- **Priority:** Should — observable artefacts (RTM row + issue comment) but supporting rather than gate-defining.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 1 steps 9, 10)
- **Preconditions / inputs:** plan written; sub-skills returned.
- **Given** the plan is complete **When** Phase 1 finishes authoring **Then** the skill updates `compliance/RTM.md` with REQ-XXX (title, risk class, linked issue, placeholder test cases) and posts a plan-summary issue comment containing: TL;DR, Risk class + signals, Acceptance criteria (with SRS-IDs), Architectural decisions (ADR-NNN or no-ADR rationale), Risk register entries (RISK-NNN list), Technical approach, Dependencies, Test scope.
- **Error paths:** none specified.
- **Fixtures/env:** a writable `compliance/RTM.md`.

#### REQ-SKILL-IMPLEMENTER-009 — Phase 1 PAUSE for HIGH/CRITICAL plan approval

- **Priority:** Must — this is the first explicit human pause point and a hard compliance constraint.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 1 step 11; § Sub-skill return semantics bullet 1; § Compliance constraints #3)
- **Preconditions / inputs:** risk class computed in Phase 1 step 2.
- **Given** a tracked REQ at the end of Phase 1 **When** the risk class is HIGH or CRITICAL (or `--require-plan-approval` / `DEVAUDIT_REQUIRE_PLAN_APPROVAL=1` is set) **Then** the skill pauses for human plan approval before any code is written; LOW and MEDIUM pass through to Phase 2 automatically.
- **Error paths:** forcing pause-on for all classes via the flag/env var must hold even for LOW/MEDIUM.
- **Fixtures/env:** a HIGH-risk REQ; a LOW-risk REQ with `DEVAUDIT_REQUIRE_PLAN_APPROVAL=1` to assert the override.

#### REQ-SKILL-IMPLEMENTER-010 — Phase 2 E2E delegation gate: pre-test-work declaration

- **Priority:** Must — structurally-enforced delegation contract (devaudit#132); the literal line is directly assertable in the transcript.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Sub-skill invocation contract; § Phase 2 step 3)
- **Preconditions / inputs:** Phase 2 reached; the change needs e2e/visual-regression coverage.
- **Given** the orchestrator is about to create or edit ANY `e2e/**/*.spec.ts` file **When** that test work is reached **Then** it must first output the single literal line verbatim — `Delegating e2e test work to e2e-test-engineer.` — then immediately invoke `Skill(name:"e2e-test-engineer", args:"<change summary + plan pointer compliance/plans/REQ-XXX/implementation-plan.md>")`, and **must not** author or edit any `e2e/**/*.spec.ts` in its own tool calls.
- **Error paths:** authoring a spec inline is the inertia trap → STOP and re-invoke the skill.
- **Fixtures/env:** a UI-facing MEDIUM+ REQ that requires e2e; transcript capture to assert the literal line precedes any spec edit.

#### REQ-SKILL-IMPLEMENTER-011 — Phase 2 E2E delegation self-audit before Phase 3

- **Priority:** Must — the post-hoc gate that catches a missed delegation; observable as a per-spec attestation over the diff.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 2 step 9)
- **Preconditions / inputs:** Phase 2 implementation landed; a feature branch diff vs `$INTEGRATION_BRANCH`.
- **Given** Phase 2 is complete **When** the skill runs `git diff "$INTEGRATION_BRANCH"...HEAD --name-only` **Then** for every `e2e/**/*.spec.ts` entry it states one of: "Authored via e2e-test-engineer skill invocation on turn N" (with a verifiable turn pointer) or "Pre-existing file; only mechanical edits applied directly"; if a spec fits neither category it must STOP, not proceed to Phase 3, revert the direct edits (`git checkout "$INTEGRATION_BRANCH" -- <file>`), and redo via `Skill(name:"e2e-test-engineer")`.
- **Error paths:** fabricating a turn pointer or omitting a file is worse than the original gap (pollutes the audit trail with false attribution).
- **Fixtures/env:** a branch with a directly-authored spec to assert the STOP path fires.

#### REQ-SKILL-IMPLEMENTER-012 — Phase 2 gate-failure retry cap and no-bypass rule

- **Priority:** Must — observable as: after 3 failed gate attempts the skill halts and surfaces output; no bypass tokens appear.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 2 steps 5–6; § Principles "Never bypass a gate")
- **Preconditions / inputs:** a local gate (lint/tsc/unit/semgrep/audit/e2e) is failing.
- **Given** a failing gate **When** Phase 2 iterates **Then** the skill retries up to N=3 (read failure → propose fix → apply → re-run); on exhausted attempts it halts with full failure output and surfaces to the human — never using `--no-verify`, `eslint-disable`, `@ts-expect-error`, or `xfail`.
- **Error paths:** a structurally-wrong gate → halt and surface the blocker (fix the gate, not the bypass).
- **Fixtures/env:** a REQ whose change deterministically fails a fast gate.

#### REQ-SKILL-IMPLEMENTER-013 — Phase 3 delegates the three per-REQ SoT artefacts then organises + uploads evidence

- **Priority:** Must — the evidence-pack composition (three sub-skill artefacts at fixed paths + uploads) is the core auditable output of Stage 3.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 3 steps 1–8)
- **Preconditions / inputs:** Phase 2 landed; REQ-XXX known.
- **Given** Phase 3 reached **When** the skill runs steps 1→2→3 (one flowing sequence) **Then** it invokes `requirements-aligner` (drops `compliance/evidence/REQ-XXX/srs-alignment.md`, `evidence_type=srs_alignment`), `adr-author` (`compliance/evidence/REQ-XXX/architecture-decision.md`, `evidence_type=architecture_decision`), and `risk-register-keeper` (`compliance/evidence/REQ-XXX/risk-assessment.md`, `evidence_type=risk_assessment`); then organises all artefacts under `compliance/evidence/REQ-XXX/` with date-prefixed naming and uploads each via `devaudit push <slug> REQ-XXX <evidence-type> <file> …`.
- **Error paths:** uploads not landing → step 7 verifies via portal `/requirements/REQ-XXX/evidence` listing.
- **Fixtures/env:** the three sub-skills synced; a `devaudit` CLI shim; a portal slug.

#### REQ-SKILL-IMPLEMENTER-014 — Phase 4 opens the release PR and HARD STOPS for UAT review

- **Priority:** Must — the second explicit human pause; the UAT review gate is the load-bearing control and must never be skipped or merged with the check red.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 4 steps 1, 4–6; § Sub-skill return semantics bullet 2; § Compliance constraints #1)
- **Preconditions / inputs:** evidence uploaded; branch targets resolved from `sdlc-config.json`.
- **Given** Stage 3 complete **When** Phase 4 runs **Then** the skill opens the release PR into `$RELEASE_BRANCH` (`--base $RELEASE_BRANCH --head $INTEGRATION_BRANCH`, e.g. `develop → main`) with a body containing Closes #N, REQ-XXX, Risk, Evidence link, (HIGH/CRITICAL) four-eyes attestation + rollback reference, test plan, SDLC checklist; comments the resume instruction on the issue; then **hard stops** — it does not merge; the next action is the human reviewing on the portal.
- **Error paths:** external gate hangs for unrelated reasons → cancel-and-admin-merge allowed only when all three hold (≥3 other gates green, no scope overlap, fallback verification exists), documented on PR + release ticket `## Verification`.
- **Fixtures/env:** `sdlc-config.json` with `integration_branch` and `release_branch` configured; `check-release-approval.yml` present.

#### REQ-SKILL-IMPLEMENTER-015 — Phase 4 four-eyes reviewer ≠ trigger user for HIGH/CRITICAL

- **Priority:** Must — segregation-of-duties is a hard compliance constraint (SOC 2 CC8) and an observable halt.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 4 step 2; § Compliance constraints #2)
- **Preconditions / inputs:** risk class HIGH or CRITICAL; configured UAT reviewer.
- **Given** a HIGH/CRITICAL release PR **When** the configured UAT reviewer equals the skill-trigger user **Then** the skill halts with a configuration error ("HIGH/CRITICAL risk requires an independent UAT reviewer …"); on solo-operator teams the supported interpretation is actor-type (AI trigger vs human approver) documented under `## Sign-off (dual-actor)`.
- **Error paths:** missing independent reviewer and no dual-actor attestation → four-eyes claim is performative; halt.
- **Fixtures/env:** a HIGH REQ with reviewer == trigger user to assert the halt.

#### REQ-SKILL-IMPLEMENTER-016 — Phase 5 finalise vs change-request loop branches on portal state

- **Priority:** Must — Phase 5 is the release-outcome gate; full UAT re-review on change-requests is a hard constraint.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 5; § Compliance constraints #4)
- **Preconditions / inputs:** `resume REQ-XXX`; a portal release in a known state.
- **Given** Phase 5 invoked **When** portal state is **UAT approved** **Then** the skill merges with `--merge` (squash/rebase blocked), watches `post-deploy-prod.yml`, verifies production smoke evidence (`--environment production`) landed, PATCHes the release to `released`, comments + closes the issue. **When** state is **changes requested** **Then** it adds `## Change-request iteration N` to the implementation plan, re-runs Phase 2 (same e2e delegation) + Phase 3 (new artefacts only), pushes to the same branch (no force-push), re-requests UAT review, and hard-stops again. **When** still pending → report and do not act.
- **Error paths:** production smoke fails → do NOT mark Released; file an `[INCIDENT]` defect, page on-call, follow rollback plan.
- **Fixtures/env:** portal releases in approved / changes-requested / pending states; a `post-deploy-prod.yml`.

#### REQ-SKILL-IMPLEMENTER-017 — LAST/NEXT status sticky maintained on every transition + handoff

- **Priority:** Should — navigability convention; observable as an idempotent marker-tagged issue comment but not gate-defining.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ SDLC navigability — LAST/NEXT status sticky; per-phase "Update SDLC status sticky" steps)
- **Preconditions / inputs:** an issue number; `scripts/update-sdlc-status.sh` synced.
- **Given** a stage transition or operator-action handoff **When** it occurs **Then** the skill invokes `bash scripts/update-sdlc-status.sh "$ISSUE_NUM" "<LAST: past-tense, identifiers>" "<NEXT: names the actor>"` — idempotently editing the single marker-tagged comment (never duplicating) — and leads the in-chat turn with the matching `**LAST:** / **NEXT:**` two-line shape; on divergence the comment is canonical.
- **Error paths:** updating on every internal step spams the sticky → update only at transition/handoff cadence.
- **Fixtures/env:** the synced `scripts/update-sdlc-status.sh`.

#### REQ-SKILL-IMPLEMENTER-018 — Over-scoped issue refused at Phase 1

- **Priority:** Should — observable halt with a split proposal; protects the one-issue contract.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 1 step 4; § Principles "Issue too big? Refuse at Phase 1")
- **Preconditions / inputs:** an issue spanning multiple distinct deliverables.
- **Given** an issue that decomposes into multiple requirements **When** Phase 1 detects over-scoping **Then** the skill halts with a clear split proposal and does not proceed past Phase 1 (never silently sub-divides into multiple REQs).
- **Error paths:** none — halting is the specified behaviour.
- **Fixtures/env:** a multi-deliverable issue (e.g. "SAML SSO + dashboard reorg + DB migration").

#### REQ-SKILL-IMPLEMENTER-019 — Scope-expansion halt gate fires on any user request outside ACs, across all phases

- **Priority:** Should — observable halt when a user requests work outside the current REQ's acceptance criteria during any phase (DevAudit-Installer#171); generalises the change-request loop's scope-expansion halt (change-request-loop.md §"If the change-request is fundamentally a different REQ") to all phases, not just Phase 5.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Scope-expansion halt gate): fires on every user work request while a REQ is active. Reads the current REQ's `test-scope.md` (or `implementation-plan.md` § Acceptance Criteria), checks whether the request maps to an existing AC. If no — halts with a scope-expansion message and waits for the user to choose: (a) file a separate issue, (b) amend REQ-XXX's scope (with a warning that Stage 3+ evidence is invalidated), or (c) abandon the request. Distinct from Phase 2 step 4's "plan deviation" rule (approach deviations, not scope expansions).
- **Preconditions / inputs:** An active REQ in any phase (2–5); a user request that may or may not map to an existing AC.
- **Given** a user request that maps to an existing AC **When** the scope-expansion gate checks **Then** the agent proceeds (or enters the change-request loop if in Phase 5). **Given** a user request that does NOT map to any existing AC **When** the gate checks **Then** the agent halts with the scope-expansion message and does not implement the change until the user picks (a), (b), or (c). **Given** the user picks (b) amend scope **When** evidence is already compiled (Stage 3+) **Then** the agent warns that existing evidence is invalidated and must be re-compiled.
- **Error paths:** The agent must not implement the out-of-scope change before the user decides — the inertia trap is the failure mode this gate exists to interrupt.
- **Fixtures/env:** A REQ in Phase 2 with a user request for a behaviour not in any AC; a REQ in Phase 3 with a user request to add an evidence artefact not in the plan; a REQ in Phase 5 where the request maps to an existing AC (proceeds to change-request loop).

#### REQ-SKILL-IMPLEMENTER-020 — Phase 3 test-execution-summary.md includes Test Cycles section (ISO 29119-3 Test Completion Report)

- **Priority:** Should — the Test Completion Report (ISO/IEC/IEEE 29119-3 §4.14) is the encompassing artefact summarising all test cycles for a release; the Test Cycles section is what distinguishes it from a single-run log (DevAudit-Installer#209).
- **Source:** `sdlc/files/_common/3-compile-evidence.md` (Step 1a — Generate Test Execution Summary; Step 4a — Query portal for test cycle data), `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 3 step 4a): the `test-execution-summary.md` template includes a `## Test Cycles` section after `## Gate Results`, carrying a table of cycles (CI Run, Gate Status, E2E Result, Coverage, Date) and a final assessment line. The `sdlc-implementer` skill populates this table by querying the portal API for all evidence records for this release grouped by `testCycleId` (Step 4a) — the operator does not hand-assemble cycle data. If the portal doesn't yet support `testCycleId` grouping (pre-deployment of devaudit#535), the skill falls back to local CI run IDs from `compliance/evidence/REQ-XXX/` artefact filenames and notes the fallback.
- **Preconditions / inputs:** At least one CI run (test cycle) has completed for the release; cycle data available from the portal API or local `compliance/evidence/REQ-XXX/` directory.
- **Given** a release with N completed test cycles **When** the `sdlc-implementer` skill runs Phase 3 Step 4a **Then** it queries the portal API for evidence grouped by `testCycleId` and populates the Test Cycles table from the response — the operator does not manually assemble cycle data. **Given** the portal does not yet support `testCycleId` grouping **When** Step 4a runs **Then** the skill falls back to local CI run IDs from artefact filenames and notes the fallback in the summary. **Given** a release with a single cycle **When** Stage 3 generates the summary **Then** the Test Cycles section lists that one cycle. **Given** a release where a cycle failed **When** Stage 3 generates the summary **Then** the final assessment notes the failure and any outstanding incidents.
- **Error paths:** No cycle data available from portal or local → the section is populated with placeholder rows and a note that cycle data was unavailable; the summary still uploads (the Test Completion Report is required evidence, not optional). The skill must not skip Step 4a — even an empty query result is recorded, preventing silent gaps in the audit trail.
- **Fixtures/env:** A REQ with 2 completed CI runs (cycle data from portal stub or local evidence directory); a REQ with a single cycle; a REQ with a failed cycle.

#### REQ-SKILL-IMPLEMENTER-021 — Phase 3 delegates incident filing to e2e-test-engineer, never files inline (#210 AC10)

- **Priority:** Must — the sdlc-implementer must not file incident issues directly; incident filing is delegated to `e2e-test-engineer` which emits the `### Framework attribution` section and applies the `incident` label.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` Phase 3: when a test failure is discovered during evidence compilation, the skill delegates to `e2e-test-engineer` to file the incident issue rather than filing it inline.
- **Preconditions / inputs:** Test failure discovered during Phase 3 evidence compilation.
- **Given** a test failure during Phase 3 **When** the skill discovers it **Then** it invokes `e2e-test-engineer` to file the incident issue with `incident` label and `### Framework attribution` section; the skill does not file the issue itself.
- **Error paths:** e2e-test-engineer unavailable → halt with "Cannot file incident — e2e-test-engineer skill required for incident filing."
- **Fixtures/env:** Phase 3 with a test failure; verify issue is filed by e2e-test-engineer, not sdlc-implementer.

#### REQ-SKILL-IMPLEMENTER-022 — Phase 5 change-request loop classifies defect vs scope change, delegates defect filing (#210 AC11)

- **Priority:** Must — the change-request loop must distinguish defects (implementation doesn't match ACs) from scope changes (user wants more), and delegate defect filing to `e2e-test-engineer`.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` Phase 5 change-request loop: classifies each change request as **defect** (delegate to `e2e-test-engineer` to file incident before fixing) or **scope change** (use the existing scope-expansion halt gate).
- **Preconditions / inputs:** Change-request comments from the PR or portal release page.
- **Given** a change request classified as a defect **When** the change-request loop processes it **Then** it delegates to `e2e-test-engineer` to file the incident issue before fixing; **Given** a change request classified as a scope change **When** the loop processes it **Then** it triggers the scope-expansion halt gate.
- **Error paths:** Misclassification risk — the skill must err on the side of "defect" when ambiguous (filing an incident is safer than silently absorbing a defect as scope change).
- **Fixtures/env:** Change request that is a defect (expect incident filed by e2e-test-engineer); change request that is a scope change (expect halt gate).

#### REQ-SKILL-IMPLEMENTER-023 — Compliance constraint: never file incidents inline — delegate to sub-skills (#210 AC13)

- **Priority:** Must — the sdlc-implementer must never file incident issues directly; it must delegate to `e2e-test-engineer` or `governance-doc-author` for incident filing.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` compliance constraints #7: "Never file incidents inline. Delegate incident filing to `e2e-test-engineer` (test-related incidents) or `governance-doc-author` (governance/process incidents). The sdlc-implementer orchestrates; sub-skills execute."
- **Preconditions / inputs:** Any phase where an incident is discovered.
- **Given** an incident is discovered during any phase **When** the skill needs to file it **Then** it delegates to the appropriate sub-skill (`e2e-test-engineer` for test-related, `governance-doc-author` for governance/process); it never files the issue itself.
- **Error paths:** N/A — this is a constraint, not a flow.
- **Fixtures/env:** Incident discovered in Phase 2, 3, 5; verify delegation to sub-skill in each case.

#### REQ-SKILL-IMPLEMENTER-024 — Phase 3 generates nil-incident report when no incidents occurred (#210 AC15-AC18)

- **Priority:** Should — when no incidents occurred during the release cycle, a nil-incident report must be generated as a positive attestation.
- **Source:** `sdlc/files/_common/3-compile-evidence.md` Step 4b: nil-report generation walkthrough; `sdlc/files/_common/governance/nil-incident-report.md.template`: when no `incident-report-*.md` files exist, generates `nil-incident-report.md` with the release version, date, and "no incidents" attestation.
- **Preconditions / inputs:** No incident reports in `compliance/governance/`; release version and date available.
- **Given** a release with no incidents **When** Phase 3 Step 4b runs **Then** `nil-incident-report.md` is generated from the template with the release version and date; the file is uploaded as `compliance_document` evidence. **Given** incident reports exist **Then** Step 4b is skipped.
- **Error paths:** Template missing → warning, continue.
- **Fixtures/env:** Release with no incidents (expect nil report generated and uploaded); release with incidents (expect no nil report).

#### REQ-SKILL-IMPLEMENTER-031 — Phase 4 blocker classification can run as an executable PR watch loop with persisted retry state (#304)

- **Priority:** Must — the phase-4 handoff must be able to keep classifying blocked/waiting PRs without relying on a one-shot manual `gh` read.
- **Source:** `sdlc/src/bin/devaudit-sdlc.js` (`--watch-pr` path), `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 4 blocker classification / executable loop)
- **Preconditions / inputs:** A release PR number, repo name, and optionally release/version context (`--repo`, `--release`, `--project-slug`, `--base-url`).
- **Given** a blocked or waiting release PR **When** the operator or skill runs `node SDLC/bin/devaudit-sdlc.js --watch-pr=<N> ...` **Then** the watcher polls `gh pr view` / `gh pr checks`, classifies the blocker truthfully, persists retry state to `.sdlc-pr-watch.json`, re-runs likely flaky workflows within bounded retry counts, and re-runs the Release Approval Gate when the portal is already approved but GitHub has not yet converged. **Given** `--once` is supplied **Then** it performs a single classification pass and exits without the bounded poll loop.
- **Error paths:** Missing required args or unreachable GitHub/portal state cause a classified halt; the watcher must not claim a PR is ready while checks are still pending or blocked.
- **Fixtures/env:** Green PR, pending PR, flaky-failing PR, and portal-approved-but-gate-stale PR fixtures; assert `.sdlc-pr-watch.json` persistence.

#### REQ-SKILL-E2E-001 — Trigger phrases fire the e2e pack maintainer / bootstrapper

- **Priority:** Must — discovery of the test-pack skill, including its invocation by `sdlc-implementer` Phase 2.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (frontmatter `description`; § The workflow Phase 1)
- **Preconditions / inputs:** a change (issue/PR/branch/pasted description) and a consumer repo.
- **Given** a consumer repo with the skill synced **When** the operator says "add e2e tests for [ticket]", "update the test pack", "what tests do we need for this issue", "are any tests obsolete", "run the e2e tests and file issues", "add visual regression coverage", "set up e2e tests for this project", or "bootstrap an e2e suite" — OR `sdlc-implementer` invokes it in Phase 2 **Then** the skill activates at Phase 1 (Orient): detect test stack, detect issue tracker, take in the change.
- **Error paths:** invoked for unit/component/API-only or performance tests → out of scope; the skill should decline.
- **Fixtures/env:** a repo with a Playwright/Cypress config (or none, to exercise bootstrap); a `gh`-resolvable issue.

#### REQ-SKILL-E2E-002 — Bootstrap (Phase 1b) only when no suite exists, with confirmation gates

- **Priority:** Must — bootstrap is a distinct, observable branch that ends with one passing smoke test; it pauses for a framework-choice "yes".
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 1b — Bootstrap)
- **Preconditions / inputs:** Phase 1 found no e2e framework, no test directory, no relevant deps.
- **Given** a repo with no e2e suite **When** Phase 1b runs **Then** the skill proposes a framework with a one-line rationale and **gets explicit confirmation** before installing, installs via the official installer, lays out the test directory, configures best-practice options, writes one Page Object + one smoke test that **must pass** before continuing, wires runner scripts, and offers a CI job **without committing it without confirmation**.
- **Error paths:** on a DevAudit project `.github/workflows/ci.yml` is generated/do-not-edit → drive the E2E gate from `sdlc-config.json` (`e2e_setup_command`/`e2e_env`), then `devaudit update`; never hand-edit `ci.yml`.
- **Fixtures/env:** an empty repo with a frontend framework signal; a DevAudit project to assert the no-hand-edit rule.

#### REQ-SKILL-E2E-003 — evidenceShot helper produces per-AC PNG + sidecar at the canonical path

- **Priority:** Must — the evidence-capture convention is the load-bearing proof an AC was verified; path + filename + sidecar are exactly assertable.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Evidence vs failure forensics); `references/evidence.ts`
- **Preconditions / inputs:** a Playwright `page`; the helper shipped into `e2e/helpers/evidence.ts` by the SDLC sync.
- **Given** a passing test that proves AC<n> **When** the spec calls `evidenceShot(page, 'REQ-XXX', n, '<kebab-slug>')` immediately after the AC-proving assertion **Then** a PNG lands at `compliance/evidence/REQ-XXX/screenshots/REQ-XXX-AC<n>-<slug>.png` plus a sidecar `<filename>.meta.json` carrying `{ origin, reqId, ac, slug, specFile, capturedAt }`; `origin` auto-detects `feature` vs `regression` from `process.env.E2E_NEW_SPECS`.
- **Error paths:** capitalised slug, underscores, or spaces throw (slug must be `[a-z0-9-]+`); the AC number is a separate argument, not embedded in the slug.
- **Fixtures/env:** a repo with `e2e/helpers/evidence.ts` synced; `E2E_NEW_SPECS` set and unset to exercise both origins.

#### REQ-SKILL-E2E-004 — Three-tier classification places specs at tier-specific paths

- **Priority:** Must — tier choice maps to gating point and is recorded in evidence; the file location is directly assertable.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 3 "Classify each spec into a tier")
- **Preconditions / inputs:** scenarios designed in Phase 3; MoSCoW priority of each.
- **Given** a designed scenario **When** the skill classifies its tier **Then** it lands the spec at `e2e/smoke/*.spec.ts` (cross-cutting "app is up" sanity, runs on every push to integration), `e2e/critical/*.spec.ts` (Must-priority headline flow, runs on PR-to-release-branch), or `e2e/<area>/*.spec.ts` (Should/Could/edge, runs nightly + post-merge + dispatch); when undecided between critical and regression, defaults to **regression**; the tier choice is recorded in `test-execution-summary.md` § Test design.
- **Error paths:** putting a Should-priority spec in critical inflates every PR-to-main wait — defensible-tier check happens at the WAIT CHECKPOINT.
- **Fixtures/env:** an `e2e/` tree; a Must- and a Should-priority AC.

#### REQ-SKILL-E2E-005 — Screenshot density scales by spec role (feature vs regression tier)

- **Priority:** Should — observable as stage screenshots present on feature runs and auto-suppressed on regression runs.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Screenshot density per spec role); `references/evidence.ts` (`tier`, `shouldSuppressEvidenceShot`)
- **Preconditions / inputs:** a spec authoring multiple `evidenceShot` calls.
- **Given** a feature-branch spec **When** it calls `evidenceShot(…, { tier: 'feature' })` for intermediate stages plus a default-tier (`'always'`) canonical anchor **Then** all stage shots fire while the spec is a feature artefact and auto-suppress once it joins the regression pack (`E2E_NEW_SPECS` no longer matches), while the canonical anchor always fires.
- **Error paths:** reviewer says evidence feels thin on a HIGH-risk REQ → tier `'feature'` stages are missing; add them on the feature branch.
- **Fixtures/env:** a spec run with the file present and absent from `E2E_NEW_SPECS`.

#### REQ-SKILL-E2E-006 — Transport-layer specs use test-execution-summary.md, not evidenceShot

- **Priority:** Should — an explicit carve-out (devaudit#127); observable as a summary table row standing in for the screenshot.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Specs with no page object — transport-layer evidence)
- **Preconditions / inputs:** a spec exercising a webhook / socket / DB transport boundary with no `page`.
- **Given** a transport-layer spec under `e2e/` **When** it cannot call `evidenceShot` (no Playwright `page`) **Then** its evidence form is the per-spec row in `test-execution-summary.md` (spec → pass/fail → asserted behaviour in operator-facing terms), the test title uses the `[REQ-XXX][ACn]` bracket convention, and the screenshot check is N/A for it.
- **Error paths:** pairing with a thin UI shim buys back screenshot evidence; otherwise the transport spec stands alone and the portal screenshots panel correctly shows zero.
- **Fixtures/env:** a webhook-signature or socket-broadcast spec; a `test-execution-summary.md`.

#### REQ-SKILL-E2E-007 — Phase 4 never deletes a test without explicit confirmation

- **Priority:** Must — destructive-action pause; the conservative-deletion rule is a hard human gate.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 4 — Reconcile; § Principles "Confirm before destructive or public actions")
- **Preconditions / inputs:** existing tests in the touched area.
- **Given** a reconcile pass **When** the skill identifies obsolete tests **Then** it presents three lists (To add / To update / To delete, each delete with a one-line rationale) and **does not delete anything** until a clear "yes, delete those"; a failing test is not obsolete (signal, not garbage).
- **Error paths:** deleting on 95% confidence is disallowed — wait for the explicit yes.
- **Fixtures/env:** a suite with one genuinely-superseded spec and one merely-failing spec.

#### REQ-SKILL-E2E-008 — Phase 6 defect filing emits Framework attribution + applies the incident label

- **Priority:** Must — the defect→incident_report pipeline is an observable evidence path closing framework clauses on issue close.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Filing defects; § Framework classification + the incident label); `references/incident-classification.md`
- **Preconditions / inputs:** a Phase 6 application-defect or missed-AC failure; a tracker integration.
- **Given** a defect to file **When** the skill files it **Then** the issue body embeds a `### Framework attribution` section always ticking `ISO29119.3.5.4` (baseline) plus conditional clauses (`SOC2.CC7.2` ops, `GDPR.Art-33`/`Art-34` PII, EU AI Act `Art-9/14/15` AI), and it applies the `incident` label at filing time (creating it idempotently: `gh label list … | grep -qx incident || gh label create incident …`) after operator confirmation, so close-with-label → `incident-export.yml` → `compliance-evidence.yml` flips the clauses MISSING→COVERED.
- **Error paths:** never silently drop the artefact for "just a bug" — the baseline `ISO29119.3.5.4` row is mandatory; never pad with false GDPR/security ticks.
- **Fixtures/env:** a `gh`-backed repo without a pre-existing `incident` label; a non-PII bug and a PII-exposure defect to exercise the conditional ticks.

#### REQ-SKILL-E2E-009 — Phase 6 checks every AC has a passing test and files missed requirements

- **Priority:** Should — observable as a missed-requirement defect when an AC has no passing test.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 6 "Then check for missed requirements")
- **Preconditions / inputs:** numbered ACs from Phase 2; a completed run.
- **Given** a green/partly-green run **When** Phase 6 reconciles ACs **Then** for each numbered AC the skill confirms at least one _passing_ test covers it; an AC with no passing test (unwritten or failing) is filed as a missed requirement.
- **Error paths:** failures must be triaged into flake/test-bug/app-defect/seed-gap/visual-intended/visual-unintended buckets before any action; terminal statuses `failed|timedOut|interrupted` all count.
- **Fixtures/env:** a REQ with one AC deliberately uncovered.

#### REQ-SKILL-E2E-010 — Phase 7 regression-pack graduation is implicit on merge

- **Priority:** Could — a property of the pipeline rather than an action, but observable in origin tagging.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 7 — Regression-pack handoff)
- **Preconditions / inputs:** a green run, ACs proved, the new spec merged to develop.
- **Given** a new spec under `tests/e2e/` or `e2e/` **When** it is committed and merged to develop **Then** it is in the regression pack with no separate graduation step (no `regression/` dir, no `@regression` tag, no manifest); the feature-branch captures stay tagged `feature`, post-merge develop runs tag captures `regression` (empty `E2E_NEW_SPECS`).
- **Error paths:** none — the skill surfaces this in the final report, it takes no explicit action.
- **Fixtures/env:** a merged spec; a develop run with empty `E2E_NEW_SPECS`.

#### REQ-SKILL-E2E-011 — Phase 5½ evidence wiring validation: evidenceShot + @requirement + test title tags

- **Priority:** Should — prevents specs from passing Phase 6's "AC covered" check without producing portal evidence (DevAudit-Installer#170); the skill-side complement to CIYML-011 (CI-side gate).
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 5½ — Evidence wiring validation): for each in-scope REQ and its ACs from Phase 2's scenario table, checks (1) `@requirement REQ-XXX` annotations in spec files, (2) at least one `evidenceShot(page, 'REQ-XXX', <ac>, ...)` call per AC in UI specs (API-only specs exempt), (3) `[REQ-XXX]` tag in test titles or `test.info().annotations`. If any check fails, halts with a gap report and does not proceed to Phase 6 until resolved. Exemptions (e.g. API-only, transport-only) must be explicit decisions recorded in the test-execution-summary.
- **Preconditions / inputs:** Authored/modified spec files for in-scope REQs; Phase 2's scenario table with numbered ACs.
- **Given** a spec file covering REQ-X **When** Phase 5½ checks **Then** it must carry `@requirement REQ-X`, at least one `evidenceShot()` per AC (for UI specs), and `[REQ-X]` in test titles/annotations. **Given** all checks pass **Then** the skill writes a `.e2e-evidence-wired` sentinel file in the repo root (gitignored, local-only signal). **Given** any check fails **Then** the skill halts with a gap report and does not proceed to Phase 6. **Given** an AC is API-only (no visual surface) **When** the user confirms the exemption **Then** the exemption is recorded in the test-execution-summary and the sentinel notes the skipped AC.
- **Error paths:** Missing `evidenceShot()` for a UI AC → halt; missing `@requirement` annotation → halt; missing `[REQ-XXX]` tag → halt. All must be fixed before Phase 6. Missing `.e2e-evidence-wired` sentinel → pre-push hook blocks push of e2e spec files.
- **Fixtures/env:** A spec with all wiring correct (passes, sentinel written); a spec missing `evidenceShot()` for AC2 (halts); a spec missing `@requirement` (halts); an API-only spec with an explicit exemption (passes, sentinel notes skip).

#### REQ-SKILL-GOVERNANCE-001 — Trigger phrases / MISSING-clause prompts route to the right doc

- **Priority:** Should — discovery + Phase 0 routing across five doc classes.
- **Source:** `sdlc/files/_common/skills/governance-doc-author/SKILL.md` (frontmatter `description`; § Phase 0 — Route)
- **Preconditions / inputs:** a governance trigger phrase or a portal MISSING-clause prompt.
- **Given** a synced consumer **When** the operator says "create/refresh the RoPA", "write a DPIA", "update the AI disclosure", "set up the periodic security review schedule", "incident-report template", or asks how to close `GDPR.Art-30`/`GDPR.Art-35`/`EUAIA.Art-13`/`SOC2.CC4.1`/`ISO27001.A.12.1` shown MISSING **Then** Phase 0 routes to the matching doc (ROPA/DPIA/AI_DISCLOSURE/REVIEW_SCHEDULE/INCIDENT_TEMPLATE); "register a new risk" / "document a control gap" **delegates to `risk-register-keeper`**.
- **Error paths:** ambiguous trigger → ask; per-incident report request → remind that those come from `incident-export.yml`, not this skill.
- **Fixtures/env:** a consumer repo with the governance starters; a portal matrix showing MISSING clauses.

#### REQ-SKILL-GOVERNANCE-002 — Each doc class emits its artefact at the fixed path and closes its clause

- **Priority:** Should — the five doc→path→clause mappings are the skill's core observable contract.
- **Source:** `sdlc/files/_common/skills/governance-doc-author/SKILL.md` (§ doc table; § Phase 3 Author; § Phase 4 Verify attribution)
- **Preconditions / inputs:** the starter template present (Phase 1 confirms; else offer `devaudit bootstrap-governance`).
- **Given** a routed doc class **When** Phases 3–4 run **Then** the skill fills the starter at its path — `compliance/governance/ropa.md` (closes `GDPR.Art-30`), `compliance/governance/dpia.md` (or `dpia-<reqid>.md`, `GDPR.Art-35`), `compliance/governance/ai-disclosure.md` (`EUAIA.Art-13`), `SDLC/Periodic_Security_Review_Schedule.md` (`ISO27001.A.12.1`), `compliance/governance/incident-report.md` (`ISO29119.3.5.4` baseline) — replacing every `REPLACE —` marker, ticking the Framework checklist only when honestly true, and confirming the per-clause non-stub section before commit.
- **Error paths:** a required section still stub → **do not commit**; surface the gap and ask the operator for the missing input.
- **Fixtures/env:** each starter template synced; a populated codebase to derive RoPA/DPIA source data.

#### REQ-SKILL-GOVERNANCE-003 — Phase 5 commit + upload routes by tier; PAUSE for confirmation before push

- **Priority:** Should — the commit/upload split (manual portal form for Tier 1/2 vs CI auto for Tier 3) plus the confirm-before-push pause.
- **Source:** `sdlc/files/_common/skills/governance-doc-author/SKILL.md` (§ Phase 5 — Commit + verify; § Principles "Confirm before destructive or public actions")
- **Preconditions / inputs:** a non-stub authored doc; a working branch.
- **Given** an authored governance doc **When** Phase 5 runs **Then** the skill shows the diff and **confirms before committing**, commits as `compliance(governance): refresh <doc> for <reason>`, pushes, and drives the right upload: Tier 1/2 (RoPA/DPIA/AI Disclosure/Review Schedule) → operator uses the portal Upload form with the exact evidence type (`ropa`/`dpia`/`ai_disclosure`/`compliance_document`); Tier 3 (Incident template, periodic-review, incident-report-<n>) → CI `compliance-evidence.yml` auto-uploads on push.
- **Error paths:** none beyond the stub-block in REQ-SKILL-GOVERNANCE-002.
- **Fixtures/env:** a portal Upload form; a `compliance-evidence.yml`.

#### REQ-SKILL-GOVERNANCE-004 — One doc per invocation; Review Schedule ≠ quarterly execution

- **Priority:** Could — guardrail behaviours; observable as a refusal to batch and a clarifying question.
- **Source:** `sdlc/files/_common/skills/governance-doc-author/SKILL.md` (§ Phase 6; § Principles "One doc per invocation")
- **Preconditions / inputs:** a request that batches docs or conflates the schedule with its execution.
- **Given** a request to refresh multiple docs at once **When** the skill runs **Then** it handles one doc per invocation; and when asked for "the periodic review" it clarifies whether the operator means `Periodic_Security_Review_Schedule.md` (the plan — in scope) or `periodic-review.md` (the quarterly execution — out of scope, auto-generated by `periodic-review.yml`).
- **Error paths:** none — clarification is the specified behaviour.
- **Fixtures/env:** a request mixing RoPA + DPIA + AI disclosure.

#### REQ-SKILL-REQALIGN-001 — Triggers + non-spontaneous firing; Stage 1 / Stage 3 hooks

- **Priority:** Should — discovery and the no-spontaneous-fire contract with `sdlc-implementer`.
- **Source:** `sdlc/files/_common/skills/requirements-aligner/SKILL.md` (frontmatter `description`; § Phase 0 — Route)
- **Preconditions / inputs:** a REQ; `docs/SRS.md` present; the parent skill or operator invoking.
- **Given** a synced consumer **When** the operator says "align SRS for REQ-XXX", "what SRS items did this REQ need?", "is the SRS in sync with this branch?", or "audit SRS drift across this branch" — OR `sdlc-implementer` delegates at Stage 1 (plan APPROVAL) or Stage 3 (evidence) **Then** the skill routes to Phase 1 (Stage-1), Phase 2 (Stage-3), Phase 3 (per-REQ ad-hoc), or Phase 4 (branch-wide); it **does not fire spontaneously**.
- **Error paths:** asked to author SRS prose from scratch → out of scope (proposes IDs+stubs only).
- **Fixtures/env:** a `docs/SRS.md` with existing `REQ-AREA-NNN` items.

#### REQ-SKILL-REQALIGN-002 — Phase 1 injects the SRS-items table into the plan and (conditionally) blocks approval

- **Priority:** Should — the plan-injection table + the asymmetric Stage-1 block are the observable Stage-1 contract.
- **Source:** `sdlc/files/_common/skills/requirements-aligner/SKILL.md` (§ Phase 1 steps 1–6; § Configuration)
- **Preconditions / inputs:** the REQ's implementation plan AC table + working-tree diff.
- **Given** a plan at Stage 1 **When** Phase 1 runs **Then** the skill fuzzy-matches each AC against `docs/SRS.md`, allocates next-free `REQ-AREA-NNN` per area for unmatched ACs, and injects a `## SRS items proposed/touched` table (AC | SRS item | Status | Notes); approval blocks until each AC has an existing item / a new stub / an `@srs-deferred: <reason>` annotation — blocking governed by `sdlc-config.json:requirements_aligner.block_on_stage_1` (default `false`, ramp-up audit-only for first 5 runs).
- **Error paths:** low-confidence match → surface the candidate and ask (false-positive matches hide the gap).
- **Fixtures/env:** a plan with one AC matching SRS and one with no match; `sdlc-config.json` toggling `block_on_stage_1`.

#### REQ-SKILL-REQALIGN-003 — Phase 2 drops srs-alignment.md with frontmatter, trace table, and operator sign-off

- **Priority:** Should — the per-REQ Tier-3 artefact is the hard Stage-3 gate; its frontmatter + sections are exactly assertable.
- **Source:** `sdlc/files/_common/skills/requirements-aligner/SKILL.md` (§ Phase 2 steps 1–3; § Principles "Block at Stage 3")
- **Preconditions / inputs:** the post-approval plan + diff.
- **Given** Stage 3 reached **When** Phase 2 runs **Then** the skill writes `compliance/evidence/REQ-XXX/srs-alignment.md` with frontmatter (`req`, `generated_by: requirements-aligner`, `generated_at`), an `## ACs traced` table, and an `## Operator sign-off` block (three checkboxes + Reviewer + Date); CI uploads it as `evidence_type=srs_alignment`; control then returns synchronously to `sdlc-implementer` (no pause).
- **Error paths:** the Stage-3 artefact is the asymmetric hard gate (`block_on_stage_3: true` default) — missing it leaks; `@srs-deferred` is allowed only in the Stage-1 plan, not here.
- **Fixtures/env:** an approved plan; a writable `compliance/evidence/REQ-XXX/`.

#### REQ-SKILL-ADR-001 — Triggers + Stage 1 / Stage 3 hooks; non-spontaneous firing

- **Priority:** Should — discovery and the delegation contract.
- **Source:** `sdlc/files/_common/skills/adr-author/SKILL.md` (frontmatter `description`; § Phase 0 — Route)
- **Preconditions / inputs:** a REQ; `docs/ADR/`; the parent skill or operator invoking.
- **Given** a synced consumer **When** the operator says "draft an ADR for REQ-XXX", "does this REQ need an ADR?", or "is the architectural decision documented?" — OR `sdlc-implementer` delegates at Stage 1 or Stage 3 **Then** the skill routes to Phase 1 (Stage-1), Phase 2 (Stage-3), or Phase 3 (ad-hoc audit); it does not fire spontaneously.
- **Error paths:** asked to author full ADR prose end-to-end → out of scope (drafts a stub only).
- **Fixtures/env:** a `docs/ADR/` with existing ADR-NNN files (or absent, to assert ADR-001 bootstrap).

#### REQ-SKILL-ADR-002 — Phase 1 applies the decision tree and drops docs/ADR/ADR-NNN-<slug>.md or a no-ADR rationale

- **Priority:** Should — the ADR-worthiness verdict + the SoT ADR file (or negative annotation) are the Stage-1 observable output.
- **Source:** `sdlc/files/_common/skills/adr-author/SKILL.md` (§ Phase 1 steps 2–8)
- **Preconditions / inputs:** the REQ's plan + diff; the file list it touches.
- **Given** a plan at Stage 1 **When** Phase 1 runs **Then** the skill applies the decision tree (new dependency / new external service / new DB-cache-queue / pattern change >3 files / schema change / HIGH-CRITICAL risk / `file_paths_signal_architecture` match ⇒ ADR; bug-fix≤3-files / single-file refactor / styling / dep-bump / docs ⇒ no ADR), and on an ADR verdict allocates next `ADR-NNN` (bootstraps `docs/ADR/` + ADR-001 if absent), drafts `docs/ADR/ADR-NNN-<slug>.md` with frontmatter (`adr_id`, `status: "Proposed"`, `date`, `related_reqs`, `supersedes`, `superseded_by`) and Status/Context/Decision/Consequences/Alternatives considered/Cross-references sections, and injects an ADR-NNN reference into the plan's `## Architecture decisions`; on a no-ADR verdict it injects "No ADR needed — <rationale>".
- **Error paths:** ambiguous verdict → surface candidate + ask, never silently default; the section must always carry one annotation or the other (empty = silent-drift failure).
- **Fixtures/env:** a REQ adding a new dependency (ADR), a typo-fix REQ (no ADR), and an empty `docs/ADR/`.

#### REQ-SKILL-ADR-003 — Phase 2 drops architecture-decision.md with outcome + operator sign-off

- **Priority:** Should — the per-REQ Tier-3 artefact; frontmatter + Outcome + sign-off are assertable.
- **Source:** `sdlc/files/_common/skills/adr-author/SKILL.md` (§ Phase 2 steps 1–3)
- **Preconditions / inputs:** the post-approval plan + diff.
- **Given** Stage 3 reached **When** Phase 2 runs **Then** the skill writes `compliance/evidence/REQ-XXX/architecture-decision.md` with frontmatter (`req`, `generated_by: adr-author`, `generated_at`), an `## Outcome` of either "Produced ADR-NNN: <title> (`docs/ADR/ADR-NNN-<slug>.md`)" or "No ADR needed — <rationale>", a `## Detail` block, and an `## Operator sign-off` (three checkboxes + Reviewer + Date); CI uploads it as `evidence_type=architecture_decision`; control returns synchronously to the orchestrator.
- **Error paths:** `block_on_stage_3: true` default — the artefact must exist before Stage 3 completes.
- **Fixtures/env:** an approved plan with a known ADR verdict.

#### REQ-SKILL-RISK-001 — Triggers + Stage 1 (MEDIUM/HIGH) / incident-close / Stage 3 / solo_with_gap hooks

- **Priority:** Should — discovery and the four invocation entry points.
- **Source:** `sdlc/files/_common/skills/risk-register-keeper/SKILL.md` (frontmatter `description`; § Phase 0 — Route)
- **Preconditions / inputs:** a REQ or a closed incident; `compliance/risk-register.md` (or its starter); risk class.
- **Given** a synced consumer **When** the operator says "draft a risk-register entry for REQ-XXX" / "is the risk register up to date for this branch?" — OR `sdlc-implementer` delegates at Stage 1 for MEDIUM/HIGH or Stage 3 — OR `incident-export.yml` fires at incident close — OR approval mode is `solo_with_gap` **Then** the skill routes to Phase 1, Phase 2 (post-incident), Phase 3 (Stage-3), Phase 4 (`solo_with_gap` check), or Phase 5 (ad-hoc); it does not fire spontaneously.
- **Error paths:** asked for canonical risk-treatment prose or full STRIDE/LINDDUN → out of scope (drafts stubs only).
- **Fixtures/env:** a `compliance/risk-register.md` (present and absent, to assert bootstrap from `risk-register.md.template`).

#### REQ-SKILL-RISK-002 — Phase 1 opens RISK-NNN rows and injects the reference list into the plan

- **Priority:** Should — the canonical register row + the plan's "Risk register entries" sub-section are the Stage-1 observable output.
- **Source:** `sdlc/files/_common/skills/risk-register-keeper/SKILL.md` (§ Phase 1 steps 1–5; § Configuration `stage_1_min_risk_class`)
- **Preconditions / inputs:** risk class MEDIUM or HIGH (LOW skipped); the plan §4 + diff.
- **Given** a MEDIUM/HIGH plan at Stage 1 **When** Phase 1 runs **Then** the skill identifies discrete risks, allocates next-free `RISK-NNN` (bootstraps the register from `risk-register.md.template` if absent), drafts canonical rows (Status / Opened / Owner / Description / Inherent L×I / Mitigations / Residual L×I / Framework cross-refs / Review due / Cross-links) in `compliance/risk-register.md`, and replaces the plan's Risks/Considerations bullets with a `### Risk register entries` RISK-NNN reference list; `@risk-deferred: <reason>` allowed for LOW×LOW surfaces; blocks approval per `block_on_stage_1` (default `false`).
- **Error paths:** LOW REQs skip the Stage-1 hook entirely (`stage_1_min_risk_class: 'MEDIUM'`).
- **Fixtures/env:** a HIGH REQ; an absent register to assert bootstrap.

#### REQ-SKILL-RISK-003 — Phase 3 drops risk-assessment.md with summary table + framework cross-refs + sign-off

- **Priority:** Should — the per-REQ Tier-3 artefact; the hard Stage-3 gate.
- **Source:** `sdlc/files/_common/skills/risk-register-keeper/SKILL.md` (§ Phase 3 steps 1–3)
- **Preconditions / inputs:** the post-approval plan + diff; RISK-NNN entries opened in Phase 1.
- **Given** Stage 3 reached **When** Phase 3 runs **Then** the skill writes `compliance/evidence/REQ-XXX/risk-assessment.md` with frontmatter (`req`, `generated_by: risk-register-keeper`, `generated_at`), a `## Summary` table (RISK-NNN | Title | Status this cycle | Residual L×I), `## Framework cross-references`, and an `## Operator sign-off` (three checkboxes + Reviewer + Date); CI uploads it as `evidence_type=risk_assessment`; control returns synchronously to the orchestrator.
- **Error paths:** `block_on_stage_3: true` default — the artefact is the hard gate.
- **Fixtures/env:** an approved MEDIUM/HIGH REQ with ≥1 open RISK-NNN.

#### REQ-SKILL-RISK-004 — Phase 2 post-incident entry cross-links incident report ↔ register both directions

- **Priority:** Could — incident-driven branch; observable as a new register row plus a `risk_register_entry:` frontmatter line on the incident file.
- **Source:** `sdlc/files/_common/skills/risk-register-keeper/SKILL.md` (§ Phase 2 steps 1–3)
- **Preconditions / inputs:** a closed `incident`-labelled report exported to `compliance/governance/incident-report-N.md`.
- **Given** an exported incident report **When** Phase 2 runs **Then** the skill drafts a residual-risk entry with status MITIGATED / OPEN / ACCEPTED per outcome, the register entry references `incident-report-N.md`, and the incident report's frontmatter gains a `risk_register_entry: RISK-NNN` line (bidirectional audit trail).
- **Error paths:** none specified beyond status-semantics correctness.
- **Fixtures/env:** a closed incident exported by `incident-export.yml`.

#### REQ-SKILL-RISK-005 — Phase 4 solo_with_gap PAUSE: refuse approval until the control-gap entry is signed off

- **Priority:** Could — a conditional human gate tied to approval mode; observable as a refused approval.
- **Source:** `sdlc/files/_common/skills/risk-register-keeper/SKILL.md` (§ Phase 4 steps 1–4; § Principles "solo_with_gap is a deliberate trade-off")
- **Preconditions / inputs:** `sdlc-config.json:approval.mode = 'solo_with_gap'`; a release about to be approved.
- **Given** a `solo_with_gap` project **When** a release is about to be approved **Then** the skill greps the register for a control-gap entry (Framework cross-ref `SOC2.CC8.1`, description referencing solo/self-approval); if absent it drafts one (Status ACCEPTED, compensating-controls list) and **refuses approval until the operator signs it off**.
- **Error paths:** mode ≠ `solo_with_gap` → exit, no check needed.
- **Fixtures/env:** a `sdlc-config.json` with `approval.mode: 'solo_with_gap'` and a register lacking the gap entry.

#### Assumptions — Skills

- **Frontmatter validation belongs to the schema, not a per-skill requirement.** `_schema/skill.schema.json` validates `name` (kebab, 2–64) and `description` (≥50 chars) for every SKILL.md. Treated as a single cross-cutting fixture rather than one requirement per skill; an E2E suite can assert each skill's frontmatter validates against the schema as a setup check.
- **`requirements-aligner` / `adr-author` / `risk-register-keeper` evidence-type clause closures are stated as "per META-COMPLY `framework-registry-auditor` review" and may ship orphan-by-design in v1.** Requirements assert the `evidence_type` tag and upload path (observable from the consumer side) but NOT a specific clause closure, since the specs explicitly defer that mapping to the portal side.
- **Exact section order within `compliance/risk-register.md` rows and the governance starters is template-defined, not SKILL.md-defined.** The skills fill `REPLACE` markers in starters shipped via `devaudit bootstrap-governance`; requirements assert the named sections/fields the SKILL.md enumerates, not a byte-exact template layout (the template files were not all read in full here).
- **`sdlc-implementer` references several CI workflow files (`check-release-approval.yml`, `post-deploy-prod.yml`, `compliance-evidence.yml`, `incident-export.yml`) and the `devaudit` CLI as external collaborators.** These are environment fixtures the E2E tests must stub/provide; their internal behaviour is out of scope for the SKILL black-box contract.
- **No contradictions found** between the six specs. The sub-skill return semantics ("Returns to the running sdlc-implementer context" = keep going, do not pause) is consistently echoed in all three SoT-skill Phase-2/3 steps and in the orchestrator's § Sub-skill return semantics.

### CI Workflow Templates (.github/workflows/\*)

These requirements specify the **black-box, observable contract** of the CI workflow `.yml.template` files shipped under `sdlc/files/ci/` of the DevAudit-Installer. They are not run as-is. On `devaudit install` / `devaudit update`, `cli/src/update/ci-templates.ts:syncCiTemplates()` reads the consumer's `sdlc-config.json`, resolves a token map + block map, picks the stack-specific template if `sdlc/files/ci/<stack>/<name>` exists (else the default `sdlc/files/ci/<name>`), substitutes tokens (`cli/src/lib/templates.ts:substituteTokens`), substitutes multi-line blocks (`substituteBlocks`), optionally strips the `services:` block when no DB is configured (`stripServicesBlock`), and writes the rendered file to `<consumer>/.github/workflows/<name>.yml`. Two units of observability therefore exist for every requirement: (1) **rendered file content** — what text appears/disappears in the consumer's workflow file after substitution; and (2) **runtime behaviour** — what the rendered workflow does when GitHub Actions runs it in the consumer repo (gates pass/fail, evidence POSTed to the DevAudit portal, release status advanced, PRs blocked/opened). Currently the only detected host is `railway` and stack is `node` or `python` (`cli/src/install/detect-stack.ts`); the substitution engine, however, is host/stack-agnostic and driven entirely by `sdlc-config.json` keys.

Area codes: FRAMEWORK-CIYML (ci.yml quality gates + evidence job), FRAMEWORK-EVIDENCE (compliance-evidence.yml), FRAMEWORK-VALIDATION (compliance-validation.yml + secondary governance workflows), FRAMEWORK-APPROVAL (check-release-approval.yml merge gate), FRAMEWORK-POSTDEPLOY (post-deploy-prod.yml), FRAMEWORK-RENDER (token/block substitution semantics).

---

#### REQ-FRAMEWORK-CIYML-001 — ci.yml triggers on develop PRs and develop code pushes

- **Priority:** Must — the main pipeline's scope (which commits run the heavy gates) is the foundational contract.
- **Source:** `sdlc/files/ci/ci.yml.template` (`on: pull_request: branches: [develop]`, `push: branches: [develop]`, `paths-ignore: {{PATHS_IGNORE}} - 'sdlc-config.json'`, `workflow_dispatch`)
- **Preconditions / inputs:** Consumer repo with rendered `ci.yml`; `paths_ignore` array in `sdlc-config.json`.
- **Given** the rendered `ci.yml` **When** a PR targets `develop` **Then** the `CI Pipeline` workflow runs and reports the `Quality Gates` check on the PR. **When** the PR head branch starts with `chore/close-out-` **Then** the heavy `quality-gates` job is skipped because the branch is administrative release reconciliation rather than feature/release implementation. **When** a commit is pushed to `develop` touching only paths in `paths-ignore` (rendered from `{{PATHS_IGNORE}}`) plus `sdlc-config.json` **Then** the push-side `CI Pipeline` workflow does NOT run; **When** a pushed commit touches any non-ignored path **Then** it runs. The workflow is also dispatchable manually (`workflow_dispatch`) and uses a `concurrency` group `${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`. Release registration and evidence upload jobs are skipped on `pull_request` events.
- **Error paths:** A push to a branch other than `develop` produces no run (PRs to main inherit status via branch protection per the header comment).
- **Fixtures/env:** Rendered consumer repo on `develop`; a docs-only commit fixture and a code commit fixture.

#### REQ-FRAMEWORK-CIYML-002 — Single quality-gates job enforces TypeScript, SAST, dep-audit, E2E, build (node)

- **Priority:** Must — these are the mandatory merge gates the whole framework exists to enforce.
- **Source:** `sdlc/files/ci/ci.yml.template` job `quality-gates` steps: `TypeScript Check` (id `typescript`, `npx tsc --noEmit`), `SAST Scan` (id `sast`), `Dependency Audit` (id `dep-audit`), `E2E Tests` (rendered from `{{E2E_TEST_STEP}}`), `Build Check` (id `build`, `npm run build`).
- **Preconditions / inputs:** node stack; rendered `ci.yml`; `{{RUNNER}}`, `{{NODE_VERSION}}`, `{{SOURCE_DIRS}}`, `{{SAST_BASELINE}}`, `{{ACCEPTED_DEP_RISKS}}` substituted.
- **Given** the rendered `ci.yml` runs **When** `npx tsc --noEmit` reports any error **Then** the `typescript` step (and the job) fails. **When** the SAST findings count `> {{SAST_BASELINE}}` **Then** the `sast` step emits `::error::New SAST findings` and exits 1. **When** unaccepted high/critical npm-audit vulns `!= 0` (after removing `{{ACCEPTED_DEP_RISKS}}` names) **Then** the `dep-audit` step exits 1. **When** Playwright tests fail or `npm run build` fails **Then** the respective step fails. All five must pass for `quality-gates` to be green.
- **Error paths:** Each gate exits 1 on violation; an unparseable `sast-results.json`/`dependency-audit.json` falls back to count `0`/`unknown` (stderr redirected to `/dev/null`, DevAudit #48) so warnings cannot corrupt the JSON.
- **Fixtures/env:** Rendered node consumer with a tsc error / a seeded high-sev dependency / a failing spec to exercise each gate.

#### REQ-FRAMEWORK-CIYML-003 — SAST and dep-audit gates honour baseline/accepted-risk allowances

- **Priority:** Must — without the baseline/allowlist the gate would be all-or-nothing and unusable on real repos.
- **Source:** `sdlc/files/ci/ci.yml.template` `SAST Scan` (`BASELINE={{SAST_BASELINE}}`; fail iff `FINDINGS > BASELINE`) and `Dependency Audit` (`ACCEPTED="{{ACCEPTED_DEP_RISKS}}"`; high/critical vulns whose package name is in `ACCEPTED` are excluded).
- **Preconditions / inputs:** `sast_baseline` (default `0`) and `accepted_dep_risks` (default `""`) from `sdlc-config.json` / stack adapter defaults.
- **Given** a rendered `ci.yml` with `{{SAST_BASELINE}}=N` **When** semgrep returns exactly `N` findings **Then** the SAST gate passes; at `N+1` it fails. **Given** `{{ACCEPTED_DEP_RISKS}}="pkgA pkgB"` **When** only `pkgA`/`pkgB` carry high/critical vulns **Then** the dep-audit gate passes (count 0).
- **Error paths:** Empty `ACCEPTED` → empty set → no exclusions.
- **Fixtures/env:** Rendered repo with baseline `>0` and a known accepted-risk package.

#### REQ-FRAMEWORK-CIYML-004 — E2E origin tagging via E2E_NEW_SPECS diff against merge base

- **Priority:** Should — observable in the workflow env and downstream screenshot metadata, but not a pass/fail gate itself.
- **Source:** `sdlc/files/ci/ci.yml.template` steps `Compute new-spec list for E2E origin tagging` (writes `E2E_NEW_SPECS` to `$GITHUB_ENV` via `git diff --diff-filter=A` of `tests/e2e/**` / `e2e/**` spec files against `git merge-base`), `fetch-depth: 0` on checkout.
- **Preconditions / inputs:** Full git history (`fetch-depth: 0`); consumer's `evidenceShot` helper reads `E2E_NEW_SPECS`.
- **Given** the rendered `ci.yml` runs **When** new `*.spec.ts(x)` files exist relative to the merge base **Then** `E2E_NEW_SPECS` lists them and captures from those specs are tagged `origin=feature`; **When** none (post-merge on develop/main) **Then** the list is empty and every capture tags `origin=regression`.
- **Error paths:** A `git merge-base` failure falls back to `git rev-parse HEAD` (empty diff).
- **Fixtures/env:** Rendered repo with a new spec added on a branch vs a clean merge-base.

#### REQ-FRAMEWORK-CIYML-005 — Gate outcomes summarised unconditionally to gate-outcomes.json

- **Priority:** Must — the portal's "ran-and-failed vs never-ran" distinction (DevAudit-Installer#96) depends on this artefact.
- **Source:** `sdlc/files/ci/ci.yml.template` step `Summarise gate outcomes` (`if: always()`) writes `gate-outcomes.json` with `${{ steps.<id>.outcome }}` for `typescript`/`sast`/`dependency_audit`/`build`; `upload-artifact@v4` (`if: always()`) bundles it (+ sast/dep/e2e JSON, playwright-report, coverage, per-AC screenshots) as `ci-results`, retention 90 days.
- **Preconditions / inputs:** node stack rendered `ci.yml`.
- **Given** any gate failed earlier **When** the job reaches `Summarise gate outcomes` **Then** the step still runs (`always()`) and records each step's `outcome` (`success`/`failure`/`skipped`); the `ci-results` artifact is uploaded regardless of job result.
- **Error paths:** `upload-artifact` is `continue-on-error: true` so an upload hiccup does not fail the job.
- **Fixtures/env:** Rendered repo where an early gate fails; assert `gate-outcomes.json` still produced.

#### REQ-FRAMEWORK-CIYML-006 — register-release job creates the UAT release record early

- **Priority:** Must — the approval gate (APPROVAL-002) can only resolve a release that this job registers.
- **Source:** `sdlc/files/ci/ci.yml.template` job `register-release` (`if: vars.DEVAUDIT_BASE_URL != ''`): derives version via `scripts/derive-release-version.sh`, then `bash scripts/upload-evidence.sh {{PROJECT_SLUG}} _compliance-docs compliance_document README.md --release <version> --create-release-if-missing --environment uat --category planning`; outputs `version`.
- **Preconditions / inputs:** Repo Variable `DEVAUDIT_BASE_URL` set; secret `DEVAUDIT_API_KEY` set; `scripts/derive-release-version.sh` + `scripts/upload-evidence.sh` present.
- **Given** the rendered `ci.yml` runs on develop **When** `DEVAUDIT_BASE_URL` variable is non-empty **Then** `register-release` derives a release version (REQ-XXX tag on latest commit, else bare-date), ensures the release exists in the portal (UAT, `--create-release-if-missing`), and exposes it as job output `version`. **When** the variable is empty **Then** the whole job is skipped.
- **Error paths:** `Validate DevAudit env` exits 1 if either `DEVAUDIT_BASE_URL` or `DEVAUDIT_API_KEY` is empty; the `Ensure release exists` upload is `|| true` (best-effort).
- **Fixtures/env:** Portal stub accepting the ensure-release upload; `DEVAUDIT_BASE_URL` variable + `DEVAUDIT_API_KEY` secret.

#### REQ-FRAMEWORK-CIYML-007 — register-release syncs known requirements (title + risk class) from RTM.md

- **Priority:** Should — enriches portal rendering; portal tolerates nulls so absence is non-fatal.
- **Source:** `sdlc/files/ci/ci.yml.template` step `Sync known requirements from RTM`: for each `REQ-[0-9]+` row in `compliance/RTM.md` derives `title` (release-ticket H1, else linked issue title via `gh issue view`) and `riskClass` (first LOW/MEDIUM/HIGH/CRITICAL token), `PATCH ${BASE}/api/ci/projects/{{PROJECT_SLUG}}/known-requirements` with `{requirements:[…]}`.
- **Preconditions / inputs:** `compliance/RTM.md` present with REQ rows; `GH_TOKEN: github.token`; valid API key.
- **Given** an RTM with REQ rows **When** `register-release` runs **Then** a PATCH to `/known-requirements` carries each REQ's id/title/riskClass (nulls allowed); **When** RTM has no REQ rows or is absent **Then** the step exits 0 without a PATCH.
- **Error paths:** Missing `RTM.md` → early `exit 0`; HTTP code is logged but not gated.
- **Fixtures/env:** RTM fixture + portal stub recording the PATCH body.

#### REQ-FRAMEWORK-CIYML-008 — upload-evidence job uploads gate evidence to the portal even on gate failure (stage 2)

- **Priority:** Must — tamper-resistant CI evidence is the core deliverable; failed gates must still leave an audit trail (DevAudit-Installer#96, #132).
- **Source:** `sdlc/files/ci/ci.yml.template` job `upload-evidence` (`needs: [quality-gates, register-release]`, `if: always() && !cancelled() && vars.DEVAUDIT_BASE_URL != '' && needs.register-release.result == 'success'`): maps `gate-outcomes.json` to `gateStatus` (`success→passed`, `failure→failed`, else `skipped`) and uploads via `scripts/upload-evidence.sh` — `sast-results.json` as `sast_report`/`security_scan`, `dependency-audit.json` as `dependency_audit`/`security_scan`, `e2e-results.json` as `e2e_result`/`ci_pipeline`, `playwright-report.zip` as `test_report`, coverage as `test_report`, all with `--environment uat` + `--release <register-release.version>` + `--sdlc-stage 2` (implement & test stage). The `--sdlc-stage 2` flag is set once on the shared `FLAGS` variable and reused by every upload in the job.
- **Preconditions / inputs:** `register-release` succeeded; `DEVAUDIT_BASE_URL` variable + `DEVAUDIT_API_KEY` secret set; `ci-results` artifact (or regenerated fallback).
- **Given** quality-gates ran (pass or fail) **When** `upload-evidence` runs **Then** each gate artefact is POSTed to the portal carrying `--gate-status` derived from `gate-outcomes.json` and `sdlcStage=2`, so a failed gate uploads `gateStatus=failed` (not "missing"). **When** any `upload()` call fails **Then** `UPLOAD_FAILURES` increments and the step exits 1 at the end (a release missing gate evidence cannot pass UAT, DevAudit #132).
- **Error paths:** Artifact download is `continue-on-error: true` and the step regenerates SAST/dep JSON if missing; the job is skipped entirely if `register-release` did not succeed or the base-URL variable is empty.
- **Fixtures/env:** Portal stub asserting evidence_type + gateStatus + sdlcStage per upload; a failing-gate fixture to assert non-missing upload.

#### REQ-FRAMEWORK-CIYML-009 — Per-AC E2E screenshots uploaded scoped to in-scope REQs only (stage 2)

- **Priority:** Should — per-requirement evidence rendering; scoping bug (#147) makes mis-scoping observably fail (red step).
- **Source:** `sdlc/files/ci/ci.yml.template` `upload-evidence` screenshot loop: `SHOT_REQS` derived from `compliance/pending-releases/RELEASE-TICKET-REQ-*.md`; per REQ globs only `ci-evidence/compliance/evidence/<REQ>/screenshots/*.png`, uploads each as `screenshot`/`test_report` with `--release <REQ>`, `--meta-key origin=<feature|regression>` (from the `<png>.meta.json` sidecar), and `--sdlc-stage 2` (inherited from the shared `FLAGS` variable). A failed screenshot upload bumps `UPLOAD_FAILURES`. REQs with zero screenshots are tracked in `ZERO_Screenshot_REQS` and checked against the Playwright JSON report (`ci-evidence/e2e-results.json`) for tagged tests — if a REQ has zero screenshots AND zero tagged tests, `EVIDENCE_GAPS` increments and the step exits 1 (DevAudit-Installer#169).
- **Preconditions / inputs:** Pending release tickets present; screenshots named `REQ-XXX-AC<n>-<slug>.png` (portal validates this shape — others 400); `ci-evidence/e2e-results.json` from the downloaded `ci-results` artifact.
- **Given** a pending release ticket for REQ-X **When** `upload-evidence` runs **Then** only `compliance/evidence/REQ-X/screenshots/*.png` are uploaded (scoped, `--release REQ-X`), legacy out-of-scope folders ignored; a mis-named PNG that the portal 400s turns the step red. **Given** REQ-X has zero screenshots **When** the evidence-completeness gate checks the Playwright JSON **Then** if zero tests are tagged with REQ-X (in title or annotations), `EVIDENCE_GAPS` increments and the step exits 1 — the release cannot proceed to UAT with no traceable evidence. **Given** REQ-X has zero screenshots but ≥1 tagged test **Then** the gate passes (screenshot gap is non-blocking).
- **Error paths:** No pending tickets → loop skipped; missing sidecar → upload without origin meta; missing `e2e-results.json` → `TAGGED_COUNT=0` (fails the gate if screenshots are also zero).
- **Fixtures/env:** Pending ticket + correctly-named PNG + sidecar; plus a mis-named PNG to assert the red path; plus a REQ with zero screenshots and zero tagged tests to assert the evidence-completeness gate.

#### REQ-FRAMEWORK-CIYML-010 — ci.yml does not upload committed compliance docs (single-owner rule)

- **Priority:** Should — prevents duplicate append-only rows; ownership boundary with compliance-evidence.yml (#45).
- **Source:** `sdlc/files/ci/ci.yml.template` `upload-evidence` trailing NOTE block: committed planning docs (RTM/test-plan/test-cases, release tickets, per-REQ evidence folders) are intentionally NOT uploaded here; only run-generated gate evidence (security_scan / ci_pipeline / test_report) is.
- **Preconditions / inputs:** Both `ci.yml` and `compliance-evidence.yml` rendered; a push touching both code and `compliance/`.
- **Given** a push touching code + `compliance/` **When** both workflows run **Then** `ci.yml` uploads only run-generated gate evidence and `compliance-evidence.yml` is the sole uploader of committed compliance docs (no duplicate rows).
- **Error paths:** N/A (negative requirement — assert absence of doc uploads from ci.yml).
- **Fixtures/env:** Portal stub counting rows per doc across both workflows.

#### REQ-FRAMEWORK-CIYML-011 — Evidence-completeness gate: 3-scenario logic with unit test evidence (#237)

- **Priority:** Should — prevents releases reaching UAT with no traceable per-REQ evidence (DevAudit-Installer#169); complements E2E-011 (skill-side prevention) as the CI-side safety net.
- **Source:** `sdlc/files/ci/ci.yml.template` `upload-evidence` job: after the screenshot loop, REQs in `ZERO_Screenshot_REQS` are checked against `ci-evidence/e2e-results.json` using a Python script that counts tests tagged with the REQ. If `TAGGED_COUNT == 0`, the gate runs a 3-scenario fallback: (A) no evidence at all → hard error, (B) E2E specs on disk → non-blocking warning (#195), (C) `test-execution-summary.md` exists → non-blocking warning (#237, relaxed by #349). When unit test files with `@requirement` exist, the warning mentions them; otherwise the summary alone still downgrades the gate for test-maintenance REQs. After all REQs are checked, if `EVIDENCE_GAPS > 0`, the step exits 1.
- **Preconditions / inputs:** `ci-evidence/e2e-results.json` from the downloaded `ci-results` artifact; pending release tickets (`SHOT_REQS`); at least one REQ with zero screenshots in `ZERO_Screenshot_REQS`.
- **Given** REQ-X has zero screenshots and zero tagged tests and no E2E specs on disk and no unit test files with `@requirement` and no `test-execution-summary.md` (Scenario A) **When** the gate runs **Then** `EVIDENCE_GAPS` increments and the step exits 1. **Given** REQ-X has zero tagged tests but E2E spec files on disk reference it (Scenario B) **When** the gate runs **Then** a non-blocking `::warning::` is emitted and `EVIDENCE_GAPS` does not increment. **Given** REQ-X has zero tagged tests and a `test-execution-summary.md` exists (Scenario C), whether or not unit test files with `@requirement` exist on disk, **When** the gate runs **Then** a non-blocking `::warning::` is emitted and `EVIDENCE_GAPS` does not increment. This covers test-maintenance REQs whose evidence is an existing spec tagged for an earlier REQ. **Given** REQ-X has zero screenshots but ≥1 tagged test **Then** the gate passes (non-blocking). **Given** `e2e-results.json` is missing **Then** `TAGGED_COUNT=0` (falls through to 3-scenario logic).
- **Error paths:** Missing `e2e-results.json` → Python script returns 0 (enters 3-scenario logic); Python parse error → 0 (enters 3-scenario logic).
- **Fixtures/env:** A REQ with zero screenshots and no evidence at all (Scenario A, fails); a REQ with E2E specs on disk but not in smoke tier (Scenario B, warning); a REQ with only `test-execution-summary.md` for a test-maintenance change (Scenario C, warning); a REQ with unit test files + summary but no E2E (Scenario C, warning); a REQ with zero screenshots but tagged tests (passes); missing `e2e-results.json` (enters 3-scenario logic).

#### REQ-FRAMEWORK-CIYML-012 — CI templates stamp `--test-cycle` on all uploads for portal cycle grouping

- **Priority:** Should — enables the portal to group evidence by test cycle (DevAudit-Installer#209); additive/optional, no regression for portals that don't yet accept `testCycleId`.
- **Source:** `sdlc/files/ci/ci.yml.template` (`FLAGS` variable in `upload-evidence` job: `--test-cycle ${{ github.run_id }}` appended alongside `--ci-run-id` and `--sdlc-stage`; also added to `FANOUT_FLAGS`), `sdlc/files/ci/compliance-evidence.yml.template` (same `FLAGS` addition), `scripts/upload-evidence.sh` (`--test-cycle` flag parsed → `TEST_CYCLE` → forwarded as `testCycleId` form field).
- **Preconditions / inputs:** CI run on a rendered consumer repo; `DEVAUDIT_BASE_URL` + `DEVAUDIT_API_KEY` configured.
- **Given** a CI run with `github.run_id=1234567` **When** the `upload-evidence` job runs **Then** every `upload-evidence.sh` invocation carries `--test-cycle 1234567`, which forwards `testCycleId=1234567` as a form field to the portal. **Given** the portal does not yet accept `testCycleId` **When** an upload arrives **Then** the portal silently drops the unknown field (tolerant-read, same pattern as `sdlcStage`) — no error, no regression.
- **Error paths:** Missing `--test-cycle` flag → `testCycleId` omitted from the form; portal defaults to `null` (legacy/ungrouped).
- **Fixtures/env:** Rendered consumer repo; portal stub asserting `testCycleId` form field on each upload; portal stub ignoring `testCycleId` (tolerant-read).

---

#### REQ-FRAMEWORK-EVIDENCE-001 — compliance-evidence.yml triggers on compliance pushes and E2E Regression completion

- **Priority:** Must — the load-bearing push-early evidence path (sdlc-v1.22.0+).
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` (`on: push: branches:[develop] paths:['compliance/**']`, `workflow_dispatch`, `workflow_run: workflows:['E2E Regression'] types:[completed]`).
- **Preconditions / inputs:** Rendered consumer; an `E2E Regression` workflow may exist in the consumer.
- **Given** the rendered `compliance-evidence.yml` **When** a develop push touches `compliance/**` (or manual dispatch) **Then** the `upload-compliance-evidence` job runs (gated `if: github.event_name != 'workflow_run'`); **When** the `E2E Regression` workflow completes **Then** only the `upload-e2e-regression-evidence` job runs (`if: github.event_name == 'workflow_run'`) — never both on one event (avoids double-upload, #149).
- **Error paths:** Concurrency group keyed on `${{ github.workflow }}-${{ github.ref }}-${{ github.event.workflow_run.id || '' }}` with cancel-in-progress.
- **Fixtures/env:** Rendered repo; a `compliance/**` push fixture and a `workflow_run` event fixture.

#### REQ-FRAMEWORK-EVIDENCE-002 — base URL resolution prefers sdlc-config.json with reachability pre-flight

- **Priority:** Must — destination misconfiguration must fail fast and visibly (the push-early design intent).
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` step `Resolve DevAudit base URL`: prefers `jq '.devaudit.base_url' sdlc-config.json`, falls back to repo Variable `DEVAUDIT_BASE_URL` (deprecated warning), else skip; pre-flight `curl -I "${BASE%/}/"` — 2xx/3xx proceeds, else `::error::` + exit 1; missing `DEVAUDIT_API_KEY` → skip with warning. Exports `DEVAUDIT_BASE_URL` to `$GITHUB_ENV` for `upload-evidence.sh`.
- **Preconditions / inputs:** `sdlc-config.json` `devaudit.base_url`; secret `DEVAUDIT_API_KEY`.
- **Given** the workflow **When** `devaudit.base_url` is set and reachable **Then** `skip=false` and uploads proceed; **When** the URL returns a non-2xx/3xx HTTP code (dead alias/wrong host) **Then** the step errors and exits 1; **When** no base URL or no API key is configured **Then** `skip=true` and uploads are skipped (warning, not failure).
- **Error paths:** Unreachable host = hard fail; missing config = soft skip.
- **Fixtures/env:** Portal stub returning 200 / 404 / unreachable; with and without `DEVAUDIT_API_KEY`.

#### REQ-FRAMEWORK-EVIDENCE-003 — Per-requirement evidence uploaded with correct evidence_type routing (stage 3)

- **Priority:** Must — the framework-coverage matrix attributes clauses by evidence_type (DevAudit-Installer#146/#101/#119/#120/#121).
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` `Upload compliance documents` step: planning docs (RTM/test-plan/test-cases) → `compliance_document`/`planning`; per-REQ artefacts in `compliance/evidence/<REQ>/*.md` routed by basename — `test-execution-summary.md`/`test-summary-report.md`→`test_report`, `srs-alignment.md`→`srs_alignment`, `architecture-decision.md`→`architecture_decision`, `risk-assessment.md`→`risk_assessment`, default→`compliance_document`. Each per-REQ upload uses `--release <REQ_ID>` (per-requirement release attribution, #135). All uploads carry `--sdlc-stage 3` (compile-evidence stage), set via the shared `FLAGS` variable.
- **Preconditions / inputs:** Pending release tickets define in-scope REQs; per-REQ evidence folders present.
- **Given** an in-scope REQ with these artefacts **When** the workflow runs **Then** each file uploads under its dedicated evidence_type against release `<REQ_ID>` with `sdlcStage=3`, so the portal attributes SOC2.CC3.2 / ISO27001.A.8.25 etc. correctly. **When** no pending tickets exist **Then** per-requirement upload is skipped (avoids re-uploading the whole catalogue, #135/#133).
- **Error paths:** Pending ticket but no `compliance/evidence/<REQ>/` → warning, continue; each upload `|| echo Warning` (soft).
- **Fixtures/env:** Pending ticket + per-REQ artefact set of each basename; portal stub asserting evidence_type + sdlcStage per file.

#### REQ-FRAMEWORK-EVIDENCE-004 — Audit-log export uploaded as audit_log evidence (90-day window)

- **Priority:** Should — closes ISO27001.A.8.16 / EUAIA.Art-12 / GDPR.Art-32; soft-fails so it cannot break the pipeline.
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` audit-log block: `curl -sSf -H Authorization ".../api/ci/projects/{{PROJECT_SLUG}}/audit-log/export"` then `upload-evidence.sh … audit_log … --category compliance_document`.
- **Preconditions / inputs:** API key with read access (`resolveCiUploadAuth`); portal export endpoint.
- **Given** the workflow **When** the audit-log export succeeds **Then** it's uploaded as `audit_log`; **When** the export 4xx/5xx or is unreachable **Then** a `::warning::` is emitted and the three clauses stay MISSING until the next run (no job failure).
- **Error paths:** Export failure is soft (warning only).
- **Fixtures/env:** Portal stub serving / failing the export endpoint.

#### REQ-FRAMEWORK-EVIDENCE-005 — Housekeeping stub auto-PR on bare-date pushes

- **Priority:** Should — auto-generates release-ticket + security-summary stubs for ticketless housekeeping releases (DevAudit-Installer#116).
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` step `Auto-generate housekeeping stubs (if needed)` (job `permissions: contents:write, pull-requests:write`; `GH_TOKEN: github.token`): only when version matches `^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$` and stubs absent, generates `RELEASE-TICKET-<v>.md` + `security-summary-<v>.md`, pushes branch `chore/housekeeping-release-<v>`, opens a PR (idempotent — updates existing PR/branch in place).
- **Preconditions / inputs:** Bare-date version (no REQ-XXX in commit subjects); `scripts/generate-housekeeping-release-ticket.sh` + `scripts/generate-security-summary.sh`.
- **Given** a housekeeping (bare-date) develop push with missing stubs **When** the workflow runs **Then** it commits stubs to a chore branch and opens/updates a PR for operator sign-off; **When** stubs already exist or version is REQ-tagged **Then** the step exits 0 (no PR).
- **Error paths:** Uses `github.token` directly (not a possibly-stale PAT — the 2026-06-07 401 chain regression); no diff → exit 0.
- **Fixtures/env:** Repo on a bare-date push with no stubs; gh stub recording PR create.

#### REQ-FRAMEWORK-EVIDENCE-006 — E2E Regression evidence uploaded on workflow_run with tier + stage metadata

- **Priority:** Should — surfaces critical/regression-tier E2E sweeps to the portal under the right release (#149).
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` job `upload-e2e-regression-evidence` (`if: github.event_name == 'workflow_run'`, `permissions: actions:read`): checks out `github.event.workflow_run.head_sha`, downloads artifact `e2e-regression-report` via `run-id`, derives release, uploads `e2e-regression-results.json` as `e2e_result` and the **full zipped** `playwright-report.zip` as `e2e_report` per in-scope REQ with `--meta-key tier=<critical|regression|…>` (pull_request→critical+stage 2, push→regression+stage 5, else tier=event-name with no stage). The event-derived `--sdlc-stage` is appended to `FLAGS` only when non-empty.
- **Preconditions / inputs:** A consumer `E2E Regression` workflow producing the named artifact; in-scope REQ tickets at the triggering SHA.
- **Given** the `E2E Regression` workflow completed **When** this job runs **Then** the JSON + zipped report bundle upload against each in-scope REQ (fallback `_compliance-docs`) with the correct `tier` meta and event-derived `sdlcStage` (2 for PR-triggered critical runs, 5 for push-to-main regression runs); the portal receives the whole Playwright report (screenshots/traces included), not a shell HTML. The JSON `e2e_result` is canonical evidence; the `e2e_report` upload is a human-facing convenience and may soft-fail on portal-side large-body limits without invalidating the run.
- **Error paths:** Missing artifact dir → individual uploads skipped; no base URL/API key → skip.
- **Fixtures/env:** `workflow_run` event fixture + `e2e-regression-report` artifact stub + portal stub.

#### REQ-FRAMEWORK-EVIDENCE-014 — workflow_run E2E upload recovers tracked release context from artifact metadata before falling back to `_compliance-docs` (#311)

- **Priority:** Should — a regression run that happened before the release ticket landed on the triggering SHA must still attach to the truthful tracked release when the artifact clearly names it.
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` (`upload-e2e-regression-evidence`): after scanning pending release tickets at the triggering SHA, parses `e2e-regression-results.json` for `REQ-XXX` identifiers, populates `REQS`, and if exactly one REQ is recovered while the derived release is still a bare-date `vYYYY.MM.DD(.n)` release, overrides `DERIVED_RELEASE` to that tracked `REQ-XXX` before upload.
- **Preconditions / inputs:** `workflow_run` event with no in-scope pending release ticket at the triggering SHA, but a Playwright JSON artifact that contains one or more `REQ-XXX` references.
- **Given** no pending ticket exists yet at the triggering SHA **When** the artifact names exactly one tracked requirement **Then** the workflow uploads against that `REQ-XXX` release rather than leaving the evidence attached to a bare-date housekeeping release. **Given** no REQ can be recovered from tickets or artifact metadata **Then** the workflow falls back to `_compliance-docs`.
- **Error paths:** Artifact parse failure or zero recovered REQs simply preserves the fallback path; the job does not hard-fail on metadata recovery alone.
- **Fixtures/env:** `workflow_run` fixture with empty pending tickets + artifact mentioning one `REQ-XXX`; another fixture with no recoverable REQ.

#### REQ-FRAMEWORK-EVIDENCE-007 — `test-execution-summary.md` template carries Test Cycles section (ISO 29119-3 Test Completion Report)

- **Priority:** Should — the Test Completion Report is the encompassing artefact after all test cycles; the Test Cycles section is the cycle-aggregation view that distinguishes it from per-cycle logs (DevAudit-Installer#209, ISO/IEC/IEEE 29119-3 §4.14).
- **Source:** `sdlc/files/_common/3-compile-evidence.md` (Step 1a template): the `test-execution-summary.md` markdown template includes a `## Test Cycles` section (table: Cycle | CI Run | Gate Status | E2E Result | Coverage | Date) followed by a `**Final assessment:**` line. The section is populated at Stage 3 by the `sdlc-implementer` skill (or operator) after all cycles for a release are complete.
- **Preconditions / inputs:** The release has at least one completed test cycle; cycle data is available from the portal API or from local evidence directories.
- **Given** the `test-execution-summary.md` template in `3-compile-evidence.md` **When** Stage 3 generates the file **Then** it contains a `## Test Cycles` section with a table row per cycle and a final assessment line. **Given** a release with multiple cycles (e.g. initial run + re-run after flake fix) **When** the summary is generated **Then** each cycle appears as a separate row with its own gate status, E2E result, coverage, and date. **Given** a release with a single cycle **When** the summary is generated **Then** the table has one row.
- **Error paths:** No cycle data available → the section carries placeholder rows with a note; the summary still uploads as required evidence.
- **Fixtures/env:** A REQ with 2 completed CI runs; a REQ with a single cycle; a REQ with a failed cycle (final assessment notes the failure).

---

#### REQ-FRAMEWORK-EVIDENCE-008 — Incident export enriched with structured sections from PR/issue body (#210 AC6)

- **Priority:** Should — incident reports must carry structured root-cause/impact/containment/lessons sections for SOC2.CC7.2 / ISO29119.3.5.4 / GDPR.Art-33 compliance.
- **Source:** `sdlc/files/ci/incident-export.yml.template` Path A: when an `incident`-labelled issue closes, the workflow exports the issue body into `compliance/governance/incident-report-<n>.md` with structured sections (`### Root cause`, `### Impact`, `### Containment`, `### Lessons learned`) extracted from the issue body and PR comments.
- **Preconditions / inputs:** Issue closed with `incident` label; `permissions: contents:write, pull-requests:write`.
- **Given** an incident issue with `incident` label is closed **When** the workflow fires **Then** it generates `incident-report-<n>.md` with the structured sections populated from the issue body; **When** sections are missing from the issue body **Then** REPLACE markers are inserted for human attestation.
- **Error paths:** PR-create failure degrades to warning; idempotent no-op when no diff.
- **Fixtures/env:** Issue-close event fixture with `incident` label; issue body with/without structured sections.

#### REQ-FRAMEWORK-EVIDENCE-009 — Completeness gate blocks incomplete incident reports with unresolved REPLACE markers (#210 AC9)

- **Priority:** Must — an incident report with unresolved REPLACE markers is not valid evidence; the gate must block the release.
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` completeness gate step: scans `compliance/governance/incident-report-*.md` for unresolved `REPLACE` markers; if any are found, the gate fails with `::error::` listing the file and marker count.
- **Preconditions / inputs:** Incident report files in `compliance/governance/`.
- **Given** an incident report with unresolved REPLACE markers **When** the completeness gate runs **Then** the gate fails and the release is blocked; **Given** all REPLACE markers are resolved **Then** the gate passes.
- **Error paths:** This requirement is itself the error path.
- **Fixtures/env:** Incident report with REPLACE markers (expect gate failure); incident report with all markers resolved (expect pass).

#### REQ-FRAMEWORK-EVIDENCE-010 — E2E regression incident filing with heuristic triage on test failure (#210 AC19-AC27)

- **Priority:** Should — E2E regression failures must file an incident issue with structured triage sections for traceability.
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` E2E regression incident step: on E2E test failure, the workflow files a GitHub issue with `incident` label and structured sections (`### Framework attribution`, `### Failing scenarios`, `### Heuristic triage`, `### Test cycle`); the triage heuristics classify the failure (flaky, environment, regression, or unknown).
- **Preconditions / inputs:** E2E regression workflow with failing tests; `GH_TOKEN` with issue-write permission.
- **Given** an E2E regression run with test failures **When** the incident step runs **Then** it files a GitHub issue with `incident` label, structured sections, and `testCycleId` cross-reference; **When** the failure is classified as flaky **Then** the triage section notes the flaky classification; **When** the failure is a regression **Then** the triage section identifies the likely causing commit.
- **Error paths:** Issue-create failure degrades to warning; no in-scope REQs → skip.
- **Fixtures/env:** E2E regression with failing tests; portal/gh stubs recording issue creation.

#### REQ-FRAMEWORK-EVIDENCE-011 — Nil incident report generated and uploaded when no incidents occurred (#210 AC15-AC18)

- **Priority:** Should — a per-release "no incidents" attestation is required evidence when no incidents occurred during the release cycle.
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` nil-report step: when no `incident-report-*.md` files exist in `compliance/governance/`, generates `nil-incident-report.md` from `nil-incident-report.md.template` and uploads it as `compliance_document`; `sdlc/files/_common/3-compile-evidence.md` Step 4b documents the nil-report generation walkthrough.
- **Preconditions / inputs:** No incident reports in `compliance/governance/`; `nil-incident-report.md.template` present.
- **Given** a release with no incidents **When** the evidence compile step runs **Then** `nil-incident-report.md` is generated with the release version and date, and uploaded as `compliance_document`; **Given** incident reports exist **Then** the nil report is not generated.
- **Error paths:** Template missing → warning, continue.
- **Fixtures/env:** Release with no incidents (expect nil report); release with incidents (expect no nil report).

#### REQ-FRAMEWORK-EVIDENCE-012 — Catch-all compliance_document fallback eliminated; unrecognized files skip-with-warning (#205)

- **Priority:** Must — the catch-all `compliance_document` fallback caused evidence_type collisions, making the portal's per-type panels show incorrect content (DevAudit-Installer#205).
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template` evidence routing: unrecognized file basenames no longer default to `compliance_document`; instead they are skipped with a `::warning::` naming the file and stating it has no evidence_type mapping.
- **Preconditions / inputs:** Per-REQ evidence folders with files.
- **Given** an unrecognized file basename in `compliance/evidence/<REQ>/` **When** the routing runs **Then** the file is skipped with a warning (not uploaded as `compliance_document`); **Given** a recognized basename **Then** it uploads under its dedicated evidence_type.
- **Error paths:** Unrecognized file → warning, continue (not a hard failure).
- **Fixtures/env:** Evidence folder with recognized and unrecognized basenames; portal stub asserting only recognized files are uploaded.

#### REQ-FRAMEWORK-EVIDENCE-013 — Typed evidence_type per artifact (#207)

- **Priority:** Must — each artifact type must upload under its dedicated evidence_type so the portal's per-type panels render correctly (DevAudit-Installer#207).
- **Source:** `sdlc/files/ci/compliance-evidence.yml.template`, `sdlc/files/ci/ci.yml.template`, `sdlc/files/ci/python/ci.yml.template`: SAST → `sast_report`, dependency audit → `dependency_audit`, E2E HTML report → `e2e_report`, E2E JSON results → `e2e_result`, smoke test → `smoke_test`, release ticket → `release_ticket`, coverage report → `coverage_report`, gate outcomes → `gate_outcome`. Each upload carries the correct `--category` and `--evidence_type`.
- **Preconditions / inputs:** CI artifacts in `ci-evidence/`; in-scope REQs from pending release tickets.
- **Given** a CI run producing SAST, dep-audit, E2E, coverage, and gate-outcome artifacts **When** the upload step runs **Then** each artifact uploads under its dedicated evidence_type (not a shared `audit_log` or `compliance_document`); the portal receives correctly typed evidence for each panel.
- **Error paths:** Individual upload failures are soft (`|| echo Warning`); `UPLOAD_FAILURES` tracked across all uploads.
- **Fixtures/env:** CI run with all artifact types; portal stub asserting evidence_type per upload.

---

#### REQ-FRAMEWORK-CONTRACT-001 — Shared evidence-types.json contract file (#247)

- **Priority:** Must — the contract file is the single source of truth for evidence type names shared between the installer CI templates and the portal's `EvidenceType` union.
- **Source:** `contracts/evidence-types.json` (canonical copy in portal repo `metasession-dev/devaudit`); synced copy in installer repo at `contracts/evidence-types.json`.
- **Preconditions / inputs:** Portal repo's `contracts/evidence-types.json` defines `evidence_types` (array of `{ value, label, category, ac_proof, group }`), `evidence_categories` (array matching portal's `EvidenceCategory` union), and `release_shapes` (patterns matching `classifyReleaseShape()`).
- **Given** the portal repo **When** `contracts/evidence-types.json` is modified on `develop` **Then** the portal-side contract test (`tests/unit/contract/evidence-contract.test.ts`) validates that every type in the contract is in `VALID_EVIDENCE_TYPES` and vice versa, every category matches the `EvidenceCategory` union, and release shape patterns match `classifyReleaseShape()`. **Given** the installer repo **When** the contract test runs **Then** `contracts/evidence-types.json` is loaded from the local copy and every evidence type extracted from CI templates must exist in the contract's `evidence_types` array.
- **Error paths:** Contract file missing → test fails with "Contract file not found". Type mismatch → test fails listing the diff. Category mismatch → test fails listing the diff.
- **Fixtures/env:** Contract JSON file on disk; portal `EVIDENCE_TYPE_REGISTRY` loaded in test.

#### REQ-FRAMEWORK-CONTRACT-002 — Installer-side contract test extracts evidence types from CI templates (#247)

- **Priority:** Must — prevents drift where a CI template sends an evidence type the portal doesn't recognize.
- **Source:** `cli/test/evidence-contract.test.ts` (`extractEvidenceTypes`, `preprocess`, `collectTemplateFiles`).
- **Preconditions / inputs:** `contracts/evidence-types.json` present in repo root; `sdlc/files/ci/*.yml.template` files present.
- **Given** the installer repo **When** the contract test runs **Then** it recursively collects all `.yml.template` files under `sdlc/files/ci/`, preprocesses each (normalizes CRLF → LF, joins line continuations `\` + newline → space, strips comments), and extracts evidence types via regex patterns matching: (a) `upload-evidence.sh ... <TYPE>` positional args, (b) `EVTYPE=<type>` assignments in case statements, (c) `upload_project_doc ... <TYPE>` patterns. The test asserts every extracted type exists in the contract's `evidence_types` array. Types in the contract but not sent by the installer are informational only (forward compatibility, not a failure).
- **Error paths:** Extracted type not in contract → `AssertionError: Expected CI templates to send "<type>": expected false to be true`. No CI templates found → test fails with "No CI template files found". Contract file missing → test fails with "Contract file not found".
- **Fixtures/env:** Real `sdlc/files/ci/` directory; real `contracts/evidence-types.json`. Test resolves paths via `__dirname` (not `process.cwd()`) for CI compatibility.

#### REQ-FRAMEWORK-CONTRACT-003 — Cross-repo sync workflow (#247)

- **Priority:** Should — automates the second PR when the portal contract changes, removing manual sync burden.
- **Source:** `.github/workflows/sync-evidence-contract.yml` (both repos).
- **Preconditions / inputs:** Portal repo: `INSTALLER_DISPATCH_TOKEN` secret (PAT with `repo` scope on `metasession-dev/DevAudit-Installer`). Installer repo: `repository_dispatch` trigger enabled.
- **Given** the portal repo **When** `contracts/evidence-types.json` changes on `develop` **Then** `sync-evidence-contract.yml` fires a `repository_dispatch` event (type: `evidence-contract-updated`) to `metasession-dev/DevAudit-Installer` with `client_payload` containing source, SHA, and commit message. **Given** the installer repo **When** it receives the dispatch **Then** `sync-evidence-contract.yml` fetches the latest contract from `raw.githubusercontent.com/metasession-dev/devaudit/develop/contracts/evidence-types.json`, checks for diff against the local copy, and if changed: creates a branch `chore/sync-evidence-contract`, commits the updated file, force-pushes (with lease), and opens or updates a PR to `develop`. Also triggerable manually via `workflow_dispatch`.
- **Error paths:** PAT missing or expired → dispatch fails with 401 (portal side). Fetch from raw.githubusercontent.com fails → workflow fails (installer side). No diff → workflow exits with "Contract file is already up to date". PR already open → branch updated in place, no duplicate PR created.
- **Fixtures/env:** Both repos on `develop`; `INSTALLER_DISPATCH_TOKEN` secret configured in portal repo.

#### REQ-FRAMEWORK-CONTRACT-004 — CLI CI triggers on CI template and contract file changes (#247)

- **Priority:** Must — ensures the contract test runs when CI templates are modified, not just when `cli/` code changes.
- **Source:** `.github/workflows/cli.yml` (`on.push.paths`, `on.pull_request.paths`).
- **Preconditions / inputs:** PR or push touching files in `sdlc/files/ci/**`, `contracts/evidence-types.json`, `cli/**`, `plugin-sdk/**`, or `.github/workflows/cli.yml`.
- **Given** a PR that adds a new evidence type to a `.yml.template` in `sdlc/files/ci/` without touching `cli/` **When** the PR opens **Then** `cli.yml` CI triggers (because `sdlc/files/ci/**` is in the paths trigger) and the contract test (`evidence-contract.test.ts`) runs, catching the new type if it's not in the contract. **Given** a PR that updates `contracts/evidence-types.json` **When** the PR opens **Then** CI triggers and the contract test validates the updated file.
- **Error paths:** Paths not matched → CI does not run (no false trigger). Contract test failure → PR check fails, blocking merge.
- **Fixtures/env:** PR touching only `sdlc/files/ci/ci.yml.template`; PR touching only `contracts/evidence-types.json`.

---

#### REQ-FRAMEWORK-VALIDATION-001 — compliance-validation.yml gates PRs to main on artifact + commit validity

- **Priority:** Should — a merge-gate but delegated entirely to consumer-side scripts (black-box: it must run them on PRs to main).
- **Source:** `sdlc/files/ci/compliance-validation.yml.template` (`on: pull_request: branches:[main]`): job `compliance-validation` runs `bash scripts/validate-compliance-artifacts.sh origin/main`, then `bash scripts/validate-test-summary.sh origin/main`, then `bash scripts/validate-commits.sh origin/main` with `fetch-depth: 0`.
- **Preconditions / inputs:** PR targeting `main`; `scripts/validate-compliance-artifacts.sh` + `scripts/validate-test-summary.sh` + `scripts/validate-commits.sh` present.
- **Given** the rendered `compliance-validation.yml` **When** a PR to `main` is opened/updated **Then** all three validation scripts run against `origin/main`; a non-zero exit from any one fails the check (blocking merge under branch protection). It does NOT run on develop pushes (validation only makes sense when work is merge-ready).
- **Error paths:** Any script exits non-zero → job fails.
- **Fixtures/env:** Rendered repo with a PR to main; complete vs incomplete compliance artifact fixtures; test-execution-summary.md with valid vs invalid gate states.

#### REQ-FRAMEWORK-VALIDATION-002 — ci-status-fallback emits the Quality Gates status on docs-only commits

- **Priority:** Could — secondary; keeps branch protection from stalling but enforces nothing.
- **Source:** `sdlc/files/ci/ci-status-fallback.yml.template` (`on: push: branches:[develop] paths: {{PATHS_IGNORE}} - 'sdlc-config.json'`): job named `quality-gates` on `ubuntu-latest` (hardcoded, not `{{RUNNER}}`) emits a passing `Quality Gates` status via the GitHub commit-status API.
- **Preconditions / inputs:** Same `{{PATHS_IGNORE}}` list as `ci.yml`, used as `paths:` (the inverse trigger of ci.yml's `paths-ignore`).
- **Given** the rendered fallback **When** a develop commit touches only the ignored paths **Then** it emits a passing `Quality Gates` status so a develop→main PR's branch protection check is satisfied without running the heavy gates; mixed commits trigger both ci.yml and this (same status name).
- **Error paths:** N/A (always passes).
- **Fixtures/env:** Docs-only develop commit fixture.

#### REQ-FRAMEWORK-VALIDATION-004 — ci-status-fallback declares the token permission needed to write commit statuses (`statuses: write`)

- **Priority:** Must — the fallback is only truthful if the workflow token can actually create the `Quality Gates` status it promises to emit.
- **Source:** `sdlc/files/ci/ci-status-fallback.yml.template`, GitHub commit-status REST endpoint used by the workflow step.
- **Preconditions / inputs:** Generated fallback workflow running under `github.token` / `GITHUB_TOKEN`.
- **Given** the workflow emits a commit status via the GitHub API **When** the rendered workflow is inspected **Then** it declares the workflow-level permission required for that call (`statuses: write`; `contents: read` sufficient otherwise) rather than relying on repo-default token scopes.
- **Error paths:** Missing `statuses: write` causes the runtime failure mode `403 Resource not accessible by integration`; this is a workflow defect, not a consumer misconfiguration.
- **Fixtures/env:** Rendered workflow file content; a docs-only push fixture asserting the status-post step succeeds.

#### REQ-FRAMEWORK-VALIDATION-003 — Governance auto-PR workflows (periodic-review, incident-export, close-out)

- **Priority:** Could — secondary governance automation; each opens a human-reviewed PR.
- **Source:** `sdlc/files/ci/periodic-review.yml.template` (`on: schedule cron '0 9 1 */3 *' + workflow_dispatch` → quarterly auto-PR of `compliance/governance/periodic-review.md`, SOC2.CC4.1/ISO27001.A.12.1); `incident-export.yml.template` (`on: issues: types:[closed]`, `if: contains(labels,'incident')` → auto-PR exporting the issue to `compliance/governance/incident-report-<n>.md`, ISO29119.3.5.4/SOC2.CC7.2/GDPR.Art-33/34); `close-out-release.yml.template` (`on: repository_dispatch type release-closed + workflow_dispatch` → runs `scripts/close-out-release.sh`, opens close-out PR to develop).
- **Preconditions / inputs:** `permissions: contents:write, pull-requests:write`; bot identity `devaudit-bot`; `incident` label created by operator; `scripts/close-out-release.sh` present.
- **Given** the respective trigger **When** it fires **Then** the workflow regenerates/exports the artefact and opens (or updates in place) a PR to `develop` carrying REPLACE markers requiring human attestation; an idempotent no-op (no diff) opens no PR. The close-out PR uses the reserved branch pattern `chore/close-out-*`, and installer-generated heavy PR workflows are expected to treat that branch class as administrative reconciliation rather than feature/release validation.
- **Error paths:** `close-out-release.yml` requires a valid `^REQ-[0-9]{3,}$`, else `::error::` exit 1; PR-create failures degrade to warnings.
- **Fixtures/env:** Cron/dispatch/issue-close/repository_dispatch event fixtures; gh stub.

---

#### REQ-FRAMEWORK-APPROVAL-001 — check-release-approval.yml runs as the PR-to-main merge gate

- **Priority:** Must — this is the four-eyes release-approval gate that blocks production merge.
- **Source:** `sdlc/files/ci/check-release-approval.yml.template` (`on: pull_request: branches:[main]`, `workflow_dispatch`): job `check-approval` (`name: DevAudit Release Approval`) on `{{RUNNER}}`, env `PROJECT_SLUG: {{PROJECT_SLUG}}`, checks out `github.event.pull_request.head.sha` with `fetch-depth: 0`.
- **Preconditions / inputs:** PR from develop to main; `DEVAUDIT_API_KEY` secret; `devaudit.base_url` in sdlc-config.json (or deprecated Variable).
- **Given** the rendered `check-release-approval.yml` **When** a PR to main is opened **Then** the gate runs against the PR head SHA (not the synthetic merge commit, so `derive-release-version.sh` sees the `[REQ-XXX]` tag, #81).
- **Error paths:** No base URL configured → `::error::` exit 1.
- **Fixtures/env:** Rendered repo with a develop→main PR; portal stub.

#### REQ-FRAMEWORK-APPROVAL-002 — Gate blocks merge unless the resolved release is approved

- **Priority:** Must — the load-bearing blocking behaviour of the entire compliance flow.
- **Source:** `sdlc/files/ci/check-release-approval.yml.template` step `Resolve current release` (`if: BOOTSTRAP_MODE != 'true'`): derives prefix via `derive-release-version.sh`, polls `GET ${BASE}/api/ci/releases/resolve?projectSlug=…&versionPrefix=…` up to 6× × 10s; reads `.latest.status`; passes only when status ∈ `{uat_approved, prod_review, prod_approved, released}`, else `::error::` exit 1.
- **Preconditions / inputs:** A registered release (from ci.yml `register-release`); a reviewer has approved in the portal.
- **Given** a PR to main with a resolvable release **When** the release status is approved (`uat_approved`+) **Then** the gate passes and merge is allowed; **When** the status is unapproved (e.g. `uat_pending`) **Then** the gate fails and merge is blocked. **When** no release resolves after 6 attempts **Then** `::error::No release found … Push to develop first` + exit 1.
- **Error paths:** Race with `register-release` handled by the 6×10s retry; no release = hard fail.
- **Fixtures/env:** Portal stub returning each status value; assert pass/fail per status.

#### REQ-FRAMEWORK-APPROVAL-003 — Bootstrap mode passes the gate on the introducing PR

- **Priority:** Must — without it the first PR introducing the framework could never merge (#301).
- **Source:** `sdlc/files/ci/check-release-approval.yml.template` step `Resolve DevAudit base URL`: missing `DEVAUDIT_API_KEY` → `::notice::` + `BOOTSTRAP_MODE=true` + exit 0; project probe `GET /api/ci/projects/<slug>` — 404 cross-checked against `/api/ci/releases/resolve?versionPrefix=v`: both 404 → bootstrap (gate passes); resolve 2xx while projects 404 → `::error::` fail-closed (portal bug, #74/#75); 401/403 → fail.
- **Preconditions / inputs:** First framework-introducing PR (no API key yet, or project not yet auto-created).
- **Given** the gate **When** the API key secret is unset OR the project 404s on both endpoints **Then** `BOOTSTRAP_MODE=true`, the gate passes, and the resolve/link/SHA steps are skipped (`if: BOOTSTRAP_MODE != 'true'`). **When** the projects endpoint 404s but releases/resolve confirms the project (2xx) **Then** the gate fails closed (avoids silently bypassing four-eyes).
- **Error paths:** 401/403 on either probe → invalid key → exit 1; unexpected codes → exit 1.
- **Fixtures/env:** Portal stub with/without project; with/without API key.

#### REQ-FRAMEWORK-APPROVAL-004 — Gate links the PR to the release and posts a portal link comment

- **Priority:** Should — traceability side-effects; not the blocking decision itself.
- **Source:** `sdlc/files/ci/check-release-approval.yml.template` steps `Link PR to release` (`PATCH ${BASE}/api/ci/releases/<id>` with `prInfo`), `Post release link on PR` (`gh pr comment`/patch existing `**DevAudit Release:**` comment), `SHA comparison` (warn if `approved_sha != PR head sha`), `Create refreshed PR check run (workflow_dispatch / repository_dispatch re-trigger)` (creates a fresh success check run on the approved SHA via `gh api … /check-runs`).
- **Preconditions / inputs:** Non-bootstrap; `github.token` for `gh`; pull_request or workflow_dispatch event.
- **Given** a non-bootstrap PR **When** the gate passes **Then** the release record is PATCHed with the PR url/number, a `**DevAudit Release:**` comment is posted/updated, and a SHA-drift `::warning::` appears if the approved SHA differs from PR HEAD. **When** re-triggered via `workflow_dispatch` or `repository_dispatch` **Then** a fresh success `DevAudit Release Approval` check run is created on the approved PR head SHA.
- **Error paths:** `gh` failures degrade to `|| true` / warnings; no open PR on dispatch → status update skipped.
- **Fixtures/env:** PR fixture + portal/gh stubs; an approved-SHA mismatch fixture.

---

#### REQ-FRAMEWORK-POSTDEPLOY-001 — post-deploy-prod.yml runs read-only prod verification on push to main

- **Priority:** Should — production verification + promotion; read-only by design.
- **Source:** `sdlc/files/ci/post-deploy-prod.yml.template` (`on: push: branches:[main]`, `workflow_dispatch` with `release` input): job `production-evidence`, env `PROD_URL: secrets.{{PRODUCTION_URL_SECRET}}`. Steps wait for prod (curl until 2xx/3xx, 30×10s), run read-only smoke (health curl + security-header grep, writes `prod-smoke-results.json`); never runs E2E/DB/API mutations.
- **Preconditions / inputs:** railway host (push-to-main auto-deploy); `{{PRODUCTION_URL_SECRET}}` secret set; `DEVAUDIT_API_KEY`.
- **Given** the rendered `post-deploy-prod.yml` **When** a commit lands on main **Then** it polls `${PROD_URL}/` until healthy then asserts the health check returns 2xx/3xx (else `::error::Production health check failed` exit 1) and writes smoke evidence JSON; **When** prod never comes up **Then** the wait loop exhausts and the subsequent health check fails.
- **Error paths:** Health check <200 or ≥400 = hard fail; security-header grep is non-blocking (`|| true`).
- **Fixtures/env:** Prod URL stub returning healthy/unhealthy; `{{PRODUCTION_URL_SECRET}}` secret.

#### REQ-FRAMEWORK-POSTDEPLOY-002 — Promotes every in-scope release and uploads production evidence (stage 5)

- **Priority:** Should — advances release status to the terminal state, the last step of the release lifecycle.
- **Source:** `sdlc/files/ci/post-deploy-prod.yml.template` steps `Resolve in-scope releases` (all `compliance/pending-releases/RELEASE-TICKET-REQ-*.md`, or `release` input, or bare-date fallback) and `Promote in-scope releases`: per release resolves version, uploads `prod-smoke-results.json` as `test_report`/`--environment production` with `--sdlc-stage 5` and the release ticket as `compliance_document`/`release_artifact` with `--sdlc-stage 5`, then `PATCH /api/ci/releases/<id>` to `${TERMINAL_STATUS}`.
- **Preconditions / inputs:** `sdlc-config.json` `production_review.terminal_status` ∈ {`prod_review` (default), `released`}; pending release tickets or `release` dispatch input.
- **Given** a develop→main merge bundling several REQs **When** the workflow runs **Then** ALL in-scope releases are promoted to `${TERMINAL_STATUS}` (not just the first) with production smoke + ticket evidence attached (both carrying `sdlcStage=5`); status PATCH is idempotent. **When** `terminal_status` is invalid **Then** `::error::` exit 1. **When** `prod_review` **Then** a human must click Approve/Mark-as-Released in the portal; **When** `released` **Then** auto-release (v1.21.x behaviour).
- **Error paths:** No `release_id` resolved → `::warning::` skip status patch for that release; evidence uploads `|| echo Warning` (soft).
- **Fixtures/env:** Portal stub recording PATCH status + uploads (asserting `sdlcStage=5`); multi-REQ pending-tickets fixture; both terminal_status values.

---

#### REQ-FRAMEWORK-POSTDEPLOY-003 — Post-deploy smoke failure files incident issue with structured sections (#210 AC28-AC29)

- **Priority:** Should — production smoke failures must file an incident issue for traceability and post-incident review.
- **Source:** `sdlc/files/ci/post-deploy-prod.yml.template` incident step: on smoke test failure, the workflow files a GitHub issue with `incident` label and structured sections (`### Framework attribution`, `### Smoke failure detail`, `### Production URL`, `### Release version`); the issue is cross-referenced with the release ticket.
- **Preconditions / inputs:** Smoke test failure; `GH_TOKEN` with issue-write permission; `incident` label exists.
- **Given** a post-deploy smoke test failure **When** the incident step runs **Then** it files a GitHub issue with `incident` label, structured sections, and release version cross-reference; **When** the smoke test passes **Then** no incident is filed.
- **Error paths:** Issue-create failure degrades to warning (smoke failure still fails the job).
- **Fixtures/env:** Smoke test failure fixture; gh stub recording issue creation; smoke pass fixture (expect no issue).

---

#### REQ-FRAMEWORK-LABELRET-001 — label-retention.yml enforces incident label survives to issue close (#210 AC1-AC5)

- **Priority:** Must — the `incident` label must survive to issue close so `incident-export.yml` fires and evidence lands on the portal.
- **Source:** `sdlc/files/ci/label-retention.yml.template`: runs on `issues: types: [labeled, unlabeled, reopened]`; if the `incident` label is removed from an issue that had it, the workflow re-applies it with a comment explaining the enforcement. A daily cron scan catches any issues where the label was removed between events (belt-and-suspenders). Opt-in via `sdlc-config.json: incident_label_retention: true`.
- **Preconditions / inputs:** `incident` label exists in the repo; `sdlc-config.json` with `incident_label_retention: true`; `GH_TOKEN` with label-write permission.
- **Given** an issue with `incident` label **When** the label is removed **Then** the workflow re-applies it within seconds and posts a comment explaining the enforcement; **Given** the daily cron runs **When** it finds an issue that lost the label **Then** it re-applies it. **Given** `incident_label_retention` is not set or false **Then** the workflow does not run.
- **Error paths:** Label-write failure → warning (non-blocking); issue not found → skip.
- **Fixtures/env:** Issue with `incident` label removed (expect re-applied); issue without `incident` label (expect no action); opt-out config fixture.

---

#### REQ-FRAMEWORK-SDLCSTAGE-001 — `upload-evidence.sh --sdlc-stage` flag validates 1-5 and forwards as `sdlcStage` multipart field

- **Priority:** Should — the SDLC-stage dimension lets the portal group evidence by stage and drive a stage-aware completeness matrix; the flag is optional and backwards-compatible (older portals ignore it).
- **Source:** `scripts/upload-evidence.sh` (`SDLC_STAGE` variable, arg parser `--sdlc-stage) SDLC_STAGE="$2"; shift 2`, validation `[[ "$SDLC_STAGE" =~ ^[1-5]$ ]]`, CURL_ARGS `-F "sdlcStage=${SDLC_STAGE}"`).
- **Preconditions / inputs:** `--sdlc-stage <1-5>` passed on the command line; the portal's `POST /api/evidence/upload` endpoint.
- **Given** a valid `--sdlc-stage` value (1-5) **When** the uploader runs **Then** the multipart form includes `sdlcStage=<value>` so the portal can store and display it. **Given** an invalid value (e.g. `9`, `abc`) **When** the uploader runs **Then** it prints `Error: --sdlc-stage must be an integer 1-5 (got: <value>)` to stderr and exits 1 before any HTTP call. **Given** the flag is omitted **Then** no `sdlcStage` field is sent (older portals are unaffected; the portal defaults to `unspecified` server-side).
- **Error paths:** Invalid value → exit 1 with the validation error message; absent flag → no field sent (no error).
- **Fixtures/env:** Stub portal asserting the `sdlcStage` form field; invoke `upload-evidence.sh` with valid (1-5), invalid (9, abc), and omitted values.
- **Stage mapping (reference — encoded by the CI templates):**

  | Source | Stage |
  |--------|-------|
  | `ci.yml` gate evidence + per-AC evidenceShot screenshots | **2** (implement & test) |
  | `compliance-evidence.yml` committed docs (RTM, plans, srs/adr/risk, test-exec-summary, tickets, audit-log) | **3** (compile-evidence) |
  | `compliance-evidence.yml` E2E report — PR-to-develop | **2** (implement & test) |
  | `compliance-evidence.yml` E2E report — push-to-main | **5** (deploy) |
  | `feature-e2e.yml` feature-branch run | **2** (implement & test, `origin=feature`) |
  | `post-deploy-prod.yml` smoke + ticket | **5** (deploy) |

---

#### REQ-FRAMEWORK-FEATUREE2E-001 — `feature-e2e.yml` runs in-scope E2E on PRs to develop, uploads stage-2 origin=feature evidence

- **Priority:** Should — surfaces feature-branch E2E regressions during the feature cycle (issue #174) rather than at the release gate; evidence is tagged `origin=feature` so the portal does NOT count it as release/UAT evidence.
- **Source:** `sdlc/files/ci/feature-e2e.yml.template` (`on: pull_request: branches: [develop]`): job `detect-req` parses `REQ-[0-9]+` from `github.head_ref` and checks for matching `@requirement REQ-XXX` tags in `e2e/**/*.spec.ts`; job `run-feature-e2e` (needs `detect-req`, `if: has_tests == 'true'`) includes a `services:` block (`{{DATABASE_SERVICE}}`/`{{DATABASE_IMAGE}}`/`{{DATABASE_PORT}}`), `{{DATABASE_ENV}}`/`{{APP_ENV}}` env blocks, `{{DATABASE_URI_STEP}}` for dynamic port resolution, `{{E2E_SETUP_STEP}}` for pre-test seeding, dev server startup (`{{E2E_DEV_SERVER_STEP}}`) + `wait-on http://localhost:3000`, `E2E_NEW_SPECS` computation for origin tagging, and `{{E2E_FEATURE_TEST_STEP}}` (built by `buildFeatureE2eTestStep` in `ci-templates.ts`) which runs `npx playwright test --grep "$REQ_ID" --reporter=json,html` with `e2e_env` threaded onto the Playwright process. Zips `playwright-report/` into `playwright-report.zip` and uploads via `scripts/upload-evidence.sh` as `test_report` with `--sdlc-stage 2`, `--meta-key "origin=feature"`, `--release "$REQ_ID"`, `--create-release-if-missing`, `--environment uat`. Registered in `cli/src/update/ci-templates.ts` `CI_TEMPLATES` array as `'feature-e2e.yml.template'`. Block tokens are substituted by `substituteBlocks` and `services:` is stripped by `stripServicesBlock` when no `database_service` is configured — same rendering pipeline as `ci.yml.template`.
- **Preconditions / inputs:** PR to `develop` with a branch name containing `REQ-XXX`; E2E specs tagged `@requirement REQ-XXX`; `DEVAUDIT_API_KEY` secret + base URL (from `sdlc-config.json` or `DEVAUDIT_BASE_URL` var); `sdlc-config.json` with `database_service`, `e2e_start_command`, `e2e_setup_command` (optional), `e2e_env` (optional) for infrastructure rendering.
- **Given** a PR to develop from branch `feature/REQ-123-some-feature` **When** E2E specs tagged `@requirement REQ-123` exist **Then** the workflow starts the database service container, runs E2E setup (if configured), starts the dev server, waits for it, computes `E2E_NEW_SPECS`, runs only the tagged specs (`--grep`), zips the Playwright report, and uploads it as `test_report` with `sdlcStage=2` and `origin=feature` metadata. **Given** the branch name has no `REQ-XXX` match or no tagged specs exist **Then** `has_tests=false` and the E2E job is skipped. **Given** DevAudit is not configured (no base URL or API key) **Then** a `::warning::` is emitted and the upload is skipped (exit 0, not a failure). **Given** no `database_service` in config **Then** `stripServicesBlock` removes the `services:` block and `{{DATABASE_*}}` tokens render empty (DevAudit-Installer#186).
- **Error paths:** Upload failure → `::warning::feature E2E report upload failed` (soft, does not fail the job); missing `playwright-report/` dir → upload skipped; missing `e2e-results.json` → evidence-completeness gate in `ci.yml` (CIYML-011) will flag the REQ.
- **Fixtures/env:** Rendered consumer with a `feature/REQ-123-*` branch + tagged E2E specs + `database_service: mongodb`; portal stub asserting `sdlcStage=2` + `origin=feature` metadata; a branch without `REQ-XXX` to assert the skip path; a config without `database_service` to assert `stripServicesBlock`.

---

#### REQ-FRAMEWORK-RENDER-001 — Scalar token substitution populates runner, slug, versions, gate params

- **Priority:** Must — every workflow's correctness depends on tokens being substituted; an unsubstituted `{{TOKEN}}` is a broken workflow.
- **Source:** `cli/src/lib/templates.ts:substituteTokens` (plain `split/join` per `{{KEY}}`); `cli/src/update/ci-templates.ts` token map: `PROJECT_SLUG`, `PRODUCTION_URL_SECRET`, `NODE_VERSION`, `PYTHON_VERSION`, `WORKING_DIRECTORY`, `WORKING_DIR_PREFIX`, `RUNNER`, `SOURCE_DIRS`, `SAST_BASELINE`, `ACCEPTED_DEP_RISKS`, `DATABASE_SERVICE/IMAGE/PORT`, `E2E_PROJECT`, `E2E_START_COMMAND`.
- **Preconditions / inputs:** `sdlc-config.json` with the listed keys (defaults from `sdlc/files/stacks/<stack>/adapter.json` `config_keys.defaults`).
- **Given** a consumer config (e.g. `runner: ubuntu-latest`, `project_slug: foo`) **When** `syncCiTemplates` renders a template **Then** every `{{RUNNER}}`→`ubuntu-latest`, `{{PROJECT_SLUG}}`→`foo`, `{{SAST_BASELINE}}`→config value, etc.; the rendered file contains no residual `{{…}}` scalar tokens.
- **Error paths:** Missing keys render to empty string (`?? ''`).
- **Fixtures/env:** Sample `sdlc-config.json`; assert rendered file substring matches.

#### REQ-FRAMEWORK-RENDER-002 — Block substitution renders/omits services, env, E2E, and paths blocks

- **Priority:** Must — block tokens carry whole YAML sections; an empty block must drop its line (else invalid YAML).
- **Source:** `cli/src/lib/templates.ts:substituteBlocks` (a line containing `{{KEY}}` is replaced wholesale; empty replacement drops the line — prevents stray newlines in `env:` blocks, WGB v0.1.34); block map in `ci-templates.ts`: `PATHS_IGNORE`, `DATABASE_ENV`, `APP_ENV`, `BUILD_ENV`, `DATABASE_URI_STEP`, `E2E_SETUP_STEP`, `E2E_DEV_SERVER_STEP`, `E2E_TEST_STEP`, `E2E_FEATURE_TEST_STEP`, `E2E_AUTHENTICATED_STEP`.
- **Preconditions / inputs:** `database_env`/`app_env`/`build_env`/`paths_ignore`/`e2e_*` config keys (any may be absent).
- **Given** a config without `app_env`/`build_env` **When** rendered **Then** the `{{APP_ENV}}`/`{{BUILD_ENV}}` lines are dropped entirely (no blank line). **Given** `e2e_env` present **When** rendered **Then** `E2E_TEST_STEP`/dev-server/setup steps carry the env block at indent 10. **Given** `e2e_setup_command` absent **Then** no setup step is rendered (existing projects regenerate identical ci.yml).
- **Error paths:** Empty block string → line dropped; non-empty → block inserted.
- **Fixtures/env:** Configs with/without each block key; assert presence/absence of the section.

#### REQ-FRAMEWORK-RENDER-003 — services block stripped when no database_service configured

- **Priority:** Must — a `services:` block referencing an empty service name is invalid; node consumers without a DB must omit it.
- **Source:** `cli/src/lib/templates.ts:stripServicesBlock` (removes `^ {4}services:` through the next blank line); applied in `ci-templates.ts` `if (!cfg.database_service) content = stripServicesBlock(content)`. Default config (`write-config.ts`) sets `database_service:''`; railway adapter lists `database_*` as optional.
- **Preconditions / inputs:** `database_service` empty (default) vs set (e.g. `mongodb`).
- **Given** `database_service:''` **When** `ci.yml`/python `ci.yml` is rendered **Then** the entire `services:` block is removed from the output. **Given** `database_service:'mongodb'` + `database_port` **Then** the `services:` block remains with substituted `{{DATABASE_SERVICE/IMAGE/PORT}}` and the `DATABASE_URI_STEP` block renders the dynamic-port URI step (`buildDbUriStep` emits a step only when `database_service==='mongodb'`).
- **Error paths:** Empty service but block not stripped would yield invalid YAML — the strip prevents this.
- **Fixtures/env:** Config with and without `database_service`; assert `services:` present/absent.

#### REQ-FRAMEWORK-RENDER-004 — Python stack renders the stack-specific ci.yml with python gates

- **Priority:** Should — node vs python is the primary stack divergence and must be observable in the rendered gates.
- **Source:** `cli/src/update/ci-templates.ts` template resolution (`sdlc/files/ci/<stack>/<name>` preferred over default); `sdlc/files/ci/python/ci.yml.template` (the only stack-specific override) with gates `ruff check` / `ruff format --check` / `mypy` / `semgrep` / `pip-audit` / `pytest --junit-xml` / `python -m build`; `defaults.run.working-directory: {{WORKING_DIRECTORY}}`; artifacts prefixed `{{WORKING_DIR_PREFIX}}`; uploads junit.xml as `e2e_result`. `sdlc/files/stacks/python/adapter.json` config defaults (`python_version:'3.11'`, `source_dirs:'src/'`).
- **Preconditions / inputs:** `ctx.stack === 'python'` (from `detect-stack.ts`, pyproject.toml detected); `python_version`, `working_directory` keys.
- **Given** a python consumer **When** CI templates are synced **Then** the rendered `ci.yml` uses `setup-python@v5`, runs ruff/mypy/semgrep/pip-audit/pytest/build as the gates (not tsc/npm/playwright), sets the job `working-directory`, and prefixes artifact paths with `WORKING_DIR_PREFIX`. **Given** a node consumer **Then** the default `sdlc/files/ci/ci.yml.template` (tsc + Playwright E2E) is used. All other templates (compliance-evidence, approval, post-deploy, etc.) have no python override and render from the shared default.
- **Error paths:** No stack-specific file → falls back to default template.
- **Fixtures/env:** Node and python `sdlc-config.json` fixtures; assert which gate steps appear.

#### REQ-FRAMEWORK-RENDER-005 — Railway host wiring: push-to-main deploy, prod URL from secret, no deploy step

- **Priority:** Should — host adapter dictates the deploy/verify shape observable in post-deploy-prod.yml.
- **Source:** `sdlc/files/hosts/railway/adapter.json` (`deploy_trigger: push_to_main`, `production_url_from: secret`, `production_url_secret_key: production_url_secret`, `wait_for_deploy` = the curl-poll loop, `required_secrets:[DEVAUDIT_API_KEY]`); matches `sdlc/files/ci/post-deploy-prod.yml.template` (`on: push: branches:[main]`, `PROD_URL: secrets.{{PRODUCTION_URL_SECRET}}`, the 30×10s wait loop). `detect-stack.ts` hardcodes `host:'railway'`.
- **Preconditions / inputs:** Host railway (current sole host); `production_url_secret` config key naming the repo secret.
- **Given** a railway consumer **When** post-deploy-prod.yml is rendered **Then** it triggers on push to main (Railway auto-deploys; no explicit CI deploy step), reads `PROD_URL` from the secret named by `{{PRODUCTION_URL_SECRET}}`, and waits for prod via the curl-until-2xx/3xx loop that matches the adapter's `wait_for_deploy`.
- **Error paths:** A non-railway host would supply a different deploy contract (out of scope until added).
- **Fixtures/env:** railway-config fixture; assert prod-URL secret reference + wait loop.

#### REQ-FRAMEWORK-RENDER-006 — Sync removes superseded workflows and writes all CI_TEMPLATES present

- **Priority:** Should — stale renamed workflows must be cleaned up; the full set must be regenerated each update.
- **Source:** `cli/src/update/ci-templates.ts`: `OLD_WORKFLOWS_TO_REMOVE = ['test-on-pr.yml','check-uat-approval.yml']` deleted if present; `CI_TEMPLATES` list of 11 templates iterated (including `feature-e2e.yml.template`), each rendered to `<name>.yml` in `.github/workflows/`; sync skipped if no `sdlc-config.json` or no `.github/workflows/` dir.
- **Preconditions / inputs:** Consumer has `sdlc-config.json` + `.github/workflows/`.
- **Given** an `update` run **When** `syncCiTemplates` executes **Then** `test-on-pr.yml` + `check-uat-approval.yml` are removed if present, and each available CI template is (re)written stripped of its `.template` suffix; **When** `sdlc-config.json` or `.github/workflows/` is absent **Then** the section is skipped (filesSynced 0).
- **Error paths:** A template with neither stack nor default file present is silently skipped (`continue`).
- **Fixtures/env:** Consumer with the old workflows present; assert removal + full regeneration count.

---

#### Cross-area dependencies

- CIYML-006 (register-release) → APPROVAL-002: the approval gate's `releases/resolve` can only succeed if `register-release` (or a compliance-evidence.yml upload) created the release first; the 6×10s retry in APPROVAL-002 exists precisely to cover this race.
- CIYML-008 / EVIDENCE-003 share the **same release identity** via `scripts/derive-release-version.sh` (DevAudit #310): both must converge on one release record. APPROVAL-002 and POSTDEPLOY-002 reuse the same derivation for resolve/promote (#81).
- EVIDENCE-001 (workflow_run on `E2E Regression`) depends on a consumer-owned `E2E Regression` workflow that is NOT in this CI template set (3-tier gating model, v0.1.53) — an external producer.
- POSTDEPLOY-002 advances status set up by APPROVAL-002 (`uat_approved`→`prod_review`/`released`); the status enum is shared portal state.
- All EVIDENCE/APPROVAL/POSTDEPLOY base-URL resolution depends on `sdlc-config.json devaudit.base_url` (preferred) — a shared config contract; RENDER requirements ensure the slug/secret tokens that those API calls embed are substituted.
- All uploads route through `scripts/upload-evidence.sh` and `scripts/derive-release-version.sh` — consumer-side scripts shipped by the same installer (separate SRS area), so these CI requirements assume those scripts' contracts.
- SDLCSTAGE-001 (`--sdlc-stage` flag) is consumed by CIYML-008/009 (stage 2), EVIDENCE-003 (stage 3), EVIDENCE-006 (event-derived 2/5), FEATUREE2E-001 (stage 2), and POSTDEPLOY-002 (stage 5) — all depend on the uploader forwarding `sdlcStage` correctly.
- FEATUREE2E-001 depends on RENDER-006: the `feature-e2e.yml.template` must be registered in `CI_TEMPLATES` to be rendered on install/update.
- CIYML-011 (evidence-completeness gate) ← E2E-011 (Phase 5½ evidence wiring validation): the skill-side gate is the root-cause fix; the CI-side gate is the safety net. E2E-011 prevents specs from reaching CI without `evidenceShot()`/`@requirement` wiring; CIYML-011 catches any that slip through by checking the Playwright JSON for tagged tests.
- FEATUREE2E-001 depends on RENDER-002/RENDER-003: the `feature-e2e.yml.template` uses the same block tokens (`DATABASE_ENV`, `APP_ENV`, `E2E_SETUP_STEP`, `E2E_DEV_SERVER_STEP`, `E2E_FEATURE_TEST_STEP`) and `stripServicesBlock` as `ci.yml.template` — the rendering pipeline must substitute and strip correctly for the workflow to be valid (DevAudit-Installer#186).

#### Notable findings

- **Failed gates still upload evidence** (CIYML-008, `if: always() && !cancelled()`, gateStatus=failed) — counter-intuitive but deliberate (#96/#132): `status=failed` IS the audit trail; suppressing it let broken releases ship.
- **Two distinct "missing-evidence fails the job" mechanisms** via `UPLOAD_FAILURES` (CIYML-008 gate+screenshot loop; EVIDENCE-006 E2E loop) — a portal 400 (e.g. mis-named screenshot) turns the release PR red rather than silently warning.
- **Node ci.yml gates `register-release`/`upload-evidence` on the repo _Variable_ `DEVAUDIT_BASE_URL`** (`vars.DEVAUDIT_BASE_URL != ''`), whereas compliance-evidence.yml / approval / post-deploy prefer `sdlc-config.json devaudit.base_url`. So a consumer that moved base_url to sdlc-config.json (the v1.23.0 direction) will have ci.yml's evidence jobs SKIP unless the deprecated Variable is also still set. This is an inconsistency worth flagging to test authors (see Assumptions).
- **Python ci.yml uploads SAST/dep as `audit_log`** (not the precise `sast_report`/`dependency_audit` types the node ci.yml uses post-#370) — the python template predates that refinement, so the portal's SAST vs Dependency panels may show identical content for python consumers (the exact bug #387 fixed for node).
- **Bootstrap fail-closed cross-check** (APPROVAL-003): a projects-endpoint 404 that releases/resolve contradicts (2xx) FAILS the gate rather than bootstrapping — explicitly preferring a hard stop over silently bypassing four-eyes (#74/#75).
- **Python register-release uses a different version-derivation** (bare-date + `nextSequenceVersion` from the portal) than node's `derive-release-version.sh` (REQ-tag), so python consumers' release identity is date-sequence-based, not REQ-based.
- **SDLC-stage dimension is shell-only.** The `--sdlc-stage` flag and `sdlcStage` multipart field exist only in `scripts/upload-evidence.sh`; the CLI `push` command (`ci-upload.ts`) does NOT send `sdlcStage`. CI templates all use the shell script (not the CLI), so stage stamping works in CI but not via `devaudit push`.
- **Feature-E2E evidence is display-only.** `feature-e2e.yml` uploads with `origin=feature` metadata; the portal must NOT count this as release/UAT evidence (pre-merge guard, issue #174). This is a portal-side contract — the installer only sets the metadata.
- **Feature-E2E template now mirrors ci.yml infrastructure.** `feature-e2e.yml.template` uses the same block tokens (`DATABASE_ENV`, `APP_ENV`, `E2E_SETUP_STEP`, `E2E_DEV_SERVER_STEP`, `E2E_FEATURE_TEST_STEP`) and `stripServicesBlock` as `ci.yml.template` — without these, any consumer with a database, seeding, or auth env vars would see the workflow fail before tests execute (DevAudit-Installer#186).
- **Two-layer evidence completeness: skill + CI.** E2E-011 (Phase 5½) prevents specs from reaching CI without `evidenceShot()`/`@requirement` wiring; CIYML-011 catches any that slip through by checking the Playwright JSON for tagged tests when screenshots are zero. The skill gate is the root-cause fix; the CI gate is the safety net (DevAudit-Installer#169, #170).
- **Scope-expansion halt generalised to all phases.** IMPLEMENTER-019 extends the change-request loop's scope-expansion halt (change-request-loop.md) to fire on any user work request while a REQ is active, not just during Phase 5's `uat_changes_requested` state. Without this, scope-expanding requests during Phase 2–4 were silently implemented (DevAudit-Installer#171).

#### Assumptions — CI Templates

- The behaviour of `scripts/upload-evidence.sh`, `scripts/derive-release-version.sh`, `scripts/validate-compliance-artifacts.sh`, `scripts/validate-commits.sh`, `scripts/close-out-release.sh`, and the housekeeping/security-summary generators is treated as an external contract (separate SRS area); these requirements assert only that the workflows invoke them with the documented arguments/flags.
- The `E2E Regression` workflow consumed by EVIDENCE-006 is assumed to be a consumer-owned workflow outside this template set (referenced by name only); its artifact name `e2e-regression-report` and file layout are assumed stable.
- The CIYML-008 vs EVIDENCE-002 base-URL gating divergence (repo Variable `vars.DEVAUDIT_BASE_URL` vs `sdlc-config.json devaudit.base_url`) appears to be an in-progress migration rather than intended permanent behaviour; flagged as a possible defect, not encoded as a required behaviour.
- Only `railway` host and `node`/`python` stacks exist today; RENDER-005's host requirement is written against railway as the sole concrete host. The substitution engine itself is host-agnostic, so additional hosts would add adapter.json contracts without changing the substitution requirements.
- The `{{PATHS_IGNORE}}` token in `ci.yml` (`paths-ignore`) and `ci-status-fallback.yml` (`paths`) is rendered from the same `paths_ignore` array, making them exact inverses; this is assumed intentional (mixed commits trigger both with the same `Quality Gates` status name).

### Stack/Host Adapters, Governance Starters & AI Rule Files

This section specifies the black-box, observable contract of the DevAudit-Installer framework for three concerns that the `devaudit install` and `devaudit update` (and the standalone `devaudit bootstrap-governance`) commands render into a consuming repository: (1) **stack and host adapters** — how the installer picks node-vs-python and railway, and what quality-gate commands, hook frameworks, dev-deps, hooks and deploy bits each adapter substitutes; (2) the six **governance starter templates** — their required frontmatter, the "STARTER TEMPLATE — REPLACE BEFORE COMMITTING" banner, declared evidence type and framework clauses, and their opt-in / skip-if-exists semantics; and (3) the **single-source-of-truth AI rule files** synced per agent (CLAUDE.md, .cursorrules, .windsurfrules, GEMINI.md, INSTRUCTIONS.md) — the discovery contract that lets each agent find the SDLC. It also covers the verbatim sync of the stage docs (`0-project-setup.md` … `5-deploy-main.md`) and Tier-1 docs, and what `devaudit status` checks for their presence.

The observable contract is derived entirely from source: adapter manifests under `sdlc/files/stacks/` and `sdlc/files/hosts/`, the loader/resolver in `cli/src/lib/adapter.ts` and `cli/src/update/`, the install detector in `cli/src/install/detect-stack.ts`, the governance templates under `sdlc/files/_common/governance/`, and the rule-file writer `cli/src/update/ai-rules.ts`. Both `install` and `update` share the same render path: `cli/src/install/sync-templates.ts` calls `syncProject()` from `cli/src/update/index.ts`, so every requirement below applies identically on install and on update unless stated otherwise.

---

#### REQ-FRAMEWORK-ADAPTER-001 — Stack adapter resolved from sdlc-config.json, defaulting to node

- **Priority:** Must — the stack selection drives every downstream gate command, hook set and dev-dep list; a wrong stack renders the wrong contract.
- **Source:** `cli/src/update/resolve-adapters.ts` (`resolveAdapters`)
- **Preconditions / inputs:** A consumer project path; an optional `sdlc-config.json` at the project root carrying a `stack` key.
- **Given** a consumer with `sdlc-config.json` containing `"stack": "python"` **When** `update` (or `install`, via `syncProject`) runs **Then** `resolveAdapters` reads `cfg.stack` and resolves the manifest at `sdlc/files/stacks/python/adapter.json`; **Given** the `stack` key is absent or `sdlc-config.json` is missing entirely **Then** `stack` defaults to `'node'` and `deprecatedDefaults` is set true (logged as `DEPRECATED: stack/host keys missing … defaulted to node+railway` in `cli/src/update/index.ts`).
- **Error paths:** If the resolved `sdlc/files/stacks/<stack>/adapter.json` does not exist, `resolveAdapters` throws `stack adapter not found: stacks/<stack>/adapter.json. Available: <list>` where the list comes from `listStacks` (directories under `sdlc/files/stacks/` not starting with `_`).
- **Fixtures/env:** node fixture repo (no `stack` key → defaults to node), python fixture repo (`stack: python`), a fixture with an unknown `stack: go` to exercise the not-found throw.

#### REQ-FRAMEWORK-ADAPTER-002 — Host adapter resolved from sdlc-config.json, defaulting to railway

- **Priority:** Must — the host adapter governs deploy trigger, production-URL resolution and required secrets that downstream CI templates consume.
- **Source:** `cli/src/update/resolve-adapters.ts` (`resolveAdapters`); `cli/src/lib/adapter.ts` (`loadHostAdapter`, `listHosts`)
- **Preconditions / inputs:** Consumer project path; optional `host` key in `sdlc-config.json`.
- **Given** `sdlc-config.json` with `"host": "railway"` (or no `host` key) **When** `update`/`install` runs **Then** `host` resolves to `railway` and `sdlc/files/hosts/railway/adapter.json` is confirmed to exist; **Given** the `host` key is absent **Then** `host` defaults to `'railway'` and `deprecatedDefaults` is set true.
- **Error paths:** Missing `sdlc/files/hosts/<host>/adapter.json` throws `host adapter not found: hosts/<host>/adapter.json. Available: <list>` (list from `listHosts`).
- **Fixtures/env:** railway fixture (host present and host absent both → railway); fixture with `host: vercel` to exercise the not-found throw (only `railway` ships).

#### REQ-FRAMEWORK-ADAPTER-003 — Install-time stack auto-detection by manifest file (pyproject precedence over package.json)

- **Priority:** Must — `install` must derive the correct stack from filesystem signals before any `sdlc-config.json` exists.
- **Source:** `cli/src/install/detect-stack.ts` (`detectStack`, `findPyproject`)
- **Preconditions / inputs:** A fresh consumer checkout (no `sdlc-config.json` yet); a manifest file somewhere within 3 directory levels.
- **Given** a `pyproject.toml` at the project root **When** `install` runs detection **Then** the result is `stack=python`, `working_directory='.'`; **Given** no root `pyproject.toml` but one nested within `MAX_DEPTH`=3 levels (skipping `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`) **Then** `stack=python` with `working_directory` = the relative dir of the found pyproject; **Given** no pyproject anywhere but a root `package.json` **Then** `stack=node`, `working_directory='.'`. Python is checked before node, so a repo with both manifests detects as python. The detection result message always appends `host=railway`.
- **Error paths:** No `pyproject.toml` or `package.json` within 3 levels → throws `Could not detect stack — no pyproject.toml or package.json found within 3 directory levels.`
- **Fixtures/env:** node fixture (root `package.json` only), python fixture (root `pyproject.toml`), nested-python fixture (pyproject under `service/`), both-manifests fixture (expect python), empty fixture (expect throw).

#### REQ-FRAMEWORK-ADAPTER-004 — Node adapter substitutes the node/npm/TypeScript gate command set

- **Priority:** Must — the node adapter is the canonical substitution surface; wrong commands break CI gates.
- **Source:** `sdlc/files/stacks/node/adapter.json`
- **Preconditions / inputs:** Resolved `stack=node`.
- **Given** the node adapter is loaded **Then** it declares: `manifest_file=package.json`; `install="npm ci"`; `type_check="npx tsc --noEmit"`; `sast="npx semgrep scan --config auto --json"`; `dep_audit="npm audit --json --audit-level=high"`; `test="npm test"`; `build="npm run build"`; `runtime_setup.action="actions/setup-node@v4"` with `node-version={{NODE_VERSION}}`, `cache=npm`; `evidence_paths.sast="ci-evidence/sast-results.json"`, `dep_audit="ci-evidence/dependency-audit.json"`, `test="ci-evidence/e2e-results.json"`; and `config_keys.required` = `node_version, source_dirs, sast_baseline, accepted_dep_risks, e2e_project, e2e_start_command` with defaults `node_version=20, source_dirs="app/ lib/", e2e_project="chromium", e2e_start_command="npm run dev"`.
- **Error paths:** N/A (static manifest); malformed JSON would fail at `JSON.parse` in `loadStackAdapter` — see ADAPTER-013.
- **Fixtures/env:** node fixture repo; assert rendered CI/config carries these exact tokens (cross-ref FRAMEWORK-CI for the render).

#### REQ-FRAMEWORK-ADAPTER-005 — Python adapter substitutes the python/pip/pytest gate command set

- **Priority:** Must — python is the second shipped stack; its substitutions must differ observably from node.
- **Source:** `sdlc/files/stacks/python/adapter.json`
- **Preconditions / inputs:** Resolved `stack=python`.
- **Given** the python adapter is loaded **Then** it declares: `manifest_file=pyproject.toml`; `install="pip install -e \".[dev]\""`; `type_check="mypy src/"`; `sast="semgrep scan --config auto --json"` (no `npx`); `dep_audit="pip-audit --format=json --strict"`; `test="pytest --junit-xml=ci-evidence/junit.xml"`; `build="python -m build"`; `runtime_setup.action="actions/setup-python@v5"` with `python-version={{PYTHON_VERSION}}`, `cache=pip`; `evidence_paths.test="ci-evidence/junit.xml"` (node uses `e2e-results.json`); and `config_keys.required` = `python_version, source_dirs, sast_baseline, accepted_dep_risks` (no e2e keys) with defaults `python_version="3.11", source_dirs="src/"`.
- **Error paths:** See ADAPTER-013.
- **Fixtures/env:** python fixture repo; diff against node fixture to assert the node-vs-python observable delta (install cmd, type_check tool, dep_audit tool, test runner, evidence test path, runtime action, e2e keys present-vs-absent).

#### REQ-FRAMEWORK-ADAPTER-006 — Hook framework per stack: husky (node) vs pre-commit (python)

- **Priority:** Must — the hook framework choice changes which hook files land and where.
- **Source:** `sdlc/files/stacks/node/adapter.json`, `sdlc/files/stacks/python/adapter.json`; `cli/src/update/stack-hooks.ts` (`syncStackHooks`)
- **Preconditions / inputs:** Resolved stack; the consumer has bootstrapped the hook framework (the install dir exists).
- **Given** `stack=node` **Then** the adapter declares `hook_framework="husky"`, `hook_install_dir=".husky"`, `hooks=["commit-msg","pre-commit","pre-push"]`, `hook_config_files=["commitlint.config.mjs","lint-staged.config.mjs",".prettierrc.json"]`; **Given** `stack=python` **Then** `hook_framework="pre-commit"`, `hook_install_dir=".git/hooks"`, `hooks=[]` (empty — pre-commit manages its own hook installation), `hook_config_files=[".pre-commit-config.yaml"]`. **When** `syncStackHooks` runs **Then** each name in `hooks` is copied from `sdlc/files/stacks/<stack>/hooks/<name>` to `<hook_install_dir>/<name>` with mode `0o755`, and each `hook_config_files` entry is copied to the consumer repo root.
- **Error paths:** If `<hook_install_dir>/` does not exist in the consumer (`isDir` false), the section is SKIPPED with message `<dir>/ not found — bootstrap hook framework first` (0 files). If the stack has no `hooks/` directory, SKIPPED `stack has no hooks/`. Individual `hooks`/`hook_config_files` entries that don't exist on the source side are silently passed over (guarded by `exists`).
- **Fixtures/env:** node fixture with `.husky/` present (expect 3 hooks + 3 config files synced), node fixture without `.husky/` (expect SKIPPED), python fixture with `.git/hooks/` present (expect 0 hooks + `.pre-commit-config.yaml` only).

#### REQ-FRAMEWORK-ADAPTER-007 — Node hook config files have required content

- **Priority:** Should — the rendered husky configs are part of the observable contract; their content enforces conventional commits and lint-staged.
- **Source:** `sdlc/files/stacks/node/hooks/{pre-commit,pre-push,commit-msg,commitlint.config.mjs,lint-staged.config.mjs,.prettierrc.json}`
- **Preconditions / inputs:** `stack=node`, `.husky/` exists.
- **Given** the node hooks are synced **Then** `.husky/pre-commit` runs `npx lint-staged`; `commit-msg` invokes commitlint; `commitlint.config.mjs`, `lint-staged.config.mjs` and `.prettierrc.json` are placed at repo root verbatim. (Exact body asserted by file-equality, not paraphrase.)
- **Error paths:** N/A — verbatim copy.
- **Fixtures/env:** node fixture with `.husky/`; assert copied file bytes equal source bytes.

#### REQ-FRAMEWORK-ADAPTER-008 — Python pre-commit config has required hook content

- **Priority:** Should — the rendered `.pre-commit-config.yaml` is the python equivalent of the husky stack and must carry ruff/mypy/conventional-commit/pytest hooks.
- **Source:** `sdlc/files/stacks/python/hooks/.pre-commit-config.yaml`
- **Preconditions / inputs:** `stack=python`.
- **Given** the python config is synced **Then** `.pre-commit-config.yaml` declares ruff (lint+format) and `ruff-format`, mirrors-mypy with `--strict`, `conventional-pre-commit` at the `commit-msg` stage, the standard pre-commit-hooks set (trailing-whitespace, end-of-file-fixer, check-yaml/toml, check-added-large-files `--maxkb=500`, check-merge-conflict, detect-private-key), and a local `pytest-fast` hook at the `pre-push` stage. Verbatim copy.
- **Error paths:** N/A.
- **Fixtures/env:** python fixture with `.git/hooks/`; assert file-equality.

#### REQ-FRAMEWORK-ADAPTER-009 — Node stack scripts copied; python declares none

- **Priority:** Should — `stack_scripts` is a per-stack helper-script surface; node ships one, python ships none, and that difference is observable.
- **Source:** node `adapter.json` (`stack_scripts: ["check-requirement-jsdoc.sh"]`), python `adapter.json` (`stack_scripts: []`); `sdlc/files/stacks/node/scripts/check-requirement-jsdoc.sh`; the script-sync section (`cli/src/update/scripts.ts`).
- **Preconditions / inputs:** Resolved stack.
- **Given** `stack=node` **Then** `check-requirement-jsdoc.sh` is available from `sdlc/files/stacks/node/scripts/` for placement into the consumer's `scripts/`; **Given** `stack=python` **Then** `stack_scripts` is empty and no per-stack script is rendered.
- **Error paths:** Missing source script is guarded (skip-if-not-exists pattern).
- **Fixtures/env:** node fixture (expect `scripts/check-requirement-jsdoc.sh`), python fixture (expect absent). Note: `cli/src/update/scripts.ts` was not read in full for this section — see Assumptions.

#### REQ-FRAMEWORK-ADAPTER-010 — Node dev-dependencies auto-installed when missing (node only)

- **Priority:** Should — the adapter's `required_dev_dependencies` are auto-installed for node so the gate commands have their tooling.
- **Source:** `cli/src/update/stack-deps.ts` (`syncStackDeps`); node `adapter.json` `required_dev_dependencies`
- **Preconditions / inputs:** `stack=node`; `package.json` present; some declared dev-deps missing from `devDependencies`.
- **Given** `stack=node` and `package.json` is missing one or more of `husky, @commitlint/cli, @commitlint/config-conventional, lint-staged, prettier, eslint, typescript, @playwright/test` **When** `syncStackDeps` runs **Then** it runs `npm install --save-dev <missing…>` in the project; if that exits non-zero it retries with `--legacy-peer-deps`; the section reports the installed list. **Given** all are present **Then** message `all present`, 0 files. **Given** `stack=python` **Then** the section is SKIPPED entirely (`if (ctx.stack !== 'node')`), even though the python adapter declares `required_dev_dependencies` (`pytest, ruff, mypy, pip-audit, pre-commit`) — those are installed via `pip install -e ".[dev]"`, not by this section.
- **Error paths:** Both `npm install` attempts failing → throws `Failed to install <stack> deps. Fix manually: cd <path> && npm install --save-dev <missing…>` (aborts the sync). Missing `package.json` → SKIPPED `no package.json`.
- **Fixtures/env:** node fixture missing `prettier` (expect install attempt), node fixture with all deps present (expect `all present`), python fixture (expect SKIPPED). Network/npm must be available or stubbed.

#### REQ-FRAMEWORK-ADAPTER-011 — Railway host adapter substitutes deploy trigger, production-URL secret resolution and wait-for-deploy

- **Priority:** Must — host substitution is what makes the deploy/verify portion of the rendered CI host-correct.
- **Source:** `sdlc/files/hosts/railway/adapter.json`
- **Preconditions / inputs:** Resolved `host=railway`.
- **Given** the railway adapter is loaded **Then** it declares: `deploy_trigger="push_to_main"` (Railway auto-deploys on push to main — no explicit deploy CI step); `production_url_from="secret"` with `production_url_secret_key="production_url_secret"` (the sdlc-config key naming the GitHub Secret that holds the URL); a `wait_for_deploy` shell snippet that curls `${PROD_URL}/` up to 30 times (10s apart) until HTTP is 2xx/3xx; `required_secrets=["DEVAUDIT_API_KEY"]`; `config_keys.required=[production_url_secret, runner]` with `config_keys.optional=[database_service, database_image, database_port, database_env]` and default `runner="ubuntu-latest"`.
- **Error paths:** Per the host schema (`sdlc/files/hosts/_schema/adapter.schema.json`), `production_url_from="secret"` requires `production_url_secret_key` (enforced via `allOf`/`if-then` at authoring time only, not at runtime — see ADAPTER-013).
- **Fixtures/env:** railway fixture; assert the host adapter values feed the deploy/verify render (cross-ref FRAMEWORK-CI — `post-deploy-prod.yml.template` / `ci.yml` consume `production_url_secret` and the wait snippet).

#### REQ-FRAMEWORK-ADAPTER-012 — Host adapter is loaded as a validated manifest; ci-templates consume the substituted deploy bits

- **Priority:** Should — establishes the boundary: this area resolves+loads the host adapter; the actual deploy-step rendering is owned by FRAMEWORK-CI.
- **Source:** `cli/src/lib/adapter.ts` (`loadHostAdapter`); `cli/src/update/ci-templates.ts` (reads `production_url_secret`, `runner`, database\_\* from `sdlc-config.json`)
- **Preconditions / inputs:** Resolved host; `sdlc-config.json` carrying the host's required config keys.
- **Given** `host=railway` **Then** the loaded `HostAdapter` object is the validated manifest for that host (including any optional `runtime_contract` metadata), while the deploy-trigger, production-URL and wait-for-deploy snippets are consumed downstream when CI templates are rendered using `sdlc-config.json` values (`production_url_secret`, `runner`, `database_service`/`database_image`/`database_port`/`database_env`). The observable with-vs-without-railway difference (deploy step, prod-URL secret reference, DB service container) lands in the rendered `.github/workflows/*.yml`.
- **Error paths:** N/A in this area.
- **Fixtures/env:** railway fixture with full `sdlc-config.json`; cross-ref FRAMEWORK-CI for the rendered-workflow assertions.

#### REQ-FRAMEWORK-ADAPTER-013 — Malformed adapter manifest aborts the sync at parse time or schema validation

- **Priority:** Should — adapters are first-party and rarely malformed, but runtime schema validation catches contributor errors early (DevAudit-Installer#158).
- **Source:** `cli/src/lib/adapter.ts` (`loadStackAdapter`, `loadHostAdapter` — `JSON.parse` + Ajv validation against `adapter.schema.json`); `cli/src/update/resolve-adapters.ts` (existence checks); `sdlc/files/stacks/_schema/adapter.schema.json`, `sdlc/files/hosts/_schema/adapter.schema.json` (enforced at runtime via Ajv).
- **Preconditions / inputs:** A resolved stack/host whose `adapter.json` is syntactically invalid, schema-invalid, or absent.
- **Given** `sdlc/files/stacks/<stack>/adapter.json` contains invalid JSON **When** `loadStackAdapter`/`loadHostAdapter` runs **Then** `JSON.parse` throws and the sync aborts; **Given** the file is absent **Then** `resolveAdapters` throws the `… adapter not found … Available: …` error before load. **Given** the file is parseable but schema-invalid (e.g. missing `required` properties, bad `runtime_setup.action` pattern) **Then** Ajv validation fails and the sync aborts with a clear error listing all schema violations.
- **Error paths:** This requirement is itself the error path.
- **Fixtures/env:** fixture installer-root with a stack `adapter.json` containing a syntax error (expect abort); a fixture with a parseable-but-schema-invalid adapter (expect abort with schema error); a fixture with a valid adapter (expect success).

#### REQ-FRAMEWORK-ADAPTER-014 — Railway host adapter carries a schema-validated lean-runtime contract

- **Priority:** Should — this is the installer-side upstream contract for Railway memory hygiene (issue #331).
- **Source:** `sdlc/files/hosts/railway/adapter.json` (`runtime_contract`), `sdlc/files/hosts/_schema/adapter.schema.json`.
- **Preconditions / inputs:** Resolved `host=railway`.
- **Given** the railway host adapter is loaded **Then** it carries a `runtime_contract` object declaring: `preferred_web_runtime="compiled JavaScript or framework standalone output"`, `forbid_typescript_runtime=true`, `prefer_standalone_output=true`, and a non-empty `scheduler_placement` rule instructing operators to keep scheduled/background jobs out of the long-lived web process. This contract is advisory prose for consumers today, but it is schema-validated and versioned in the adapter manifest so it cannot silently drift.
- **Error paths:** A malformed `runtime_contract` (wrong types, missing keys, empty required strings) fails schema validation at adapter-load time per ADAPTER-013.
- **Fixtures/env:** adapter-validator test asserting the bundled Railway adapter passes and a malformed `runtime_contract` fails with a schema error.

---

#### REQ-FRAMEWORK-GOVERNANCE-001 — Governance starters are opt-in (NOT auto-seeded on install since v0.1.36)

- **Priority:** Should — placeholder governance docs must never be auto-seeded as if they were real evidence; they ship only on explicit request.
- **Source:** `cli/src/install/index.ts` (comment: `bootstrapGovernanceDocs` is no longer called from the default install flow); `cli/src/install/bootstrap-governance.ts` (`bootstrapGovernanceDocs`); `cli/src/commands/bootstrap-governance.ts` (`devaudit bootstrap-governance`)
- **Preconditions / inputs:** A consumer running `install`, `update`, or the standalone `bootstrap-governance` command.
- **Given** a consumer runs `devaudit install` **Then** the six governance starters are NOT copied (the default install flow no longer calls `bootstrapGovernanceDocs`); **Given** a consumer runs `devaudit update` **Then** they are NOT copied (governance is not one of the `SECTION_RUNNERS` in `cli/src/update/index.ts`); **Given** a consumer runs `devaudit bootstrap-governance [path]` **Then** the starters are copied (see GOVERNANCE-002). The command is owned by another SRS section; this requirement only asserts the opt-in boundary.
- **Error paths:** N/A.
- **Fixtures/env:** node/python fixture — run `install`, assert `compliance/governance/` is NOT created; run `bootstrap-governance`, assert it IS.

#### REQ-FRAMEWORK-GOVERNANCE-002 — bootstrap-governance copies the six starters, dropping `.template`, skip-if-exists

- **Priority:** Should — the opt-in render must be idempotent and must never overwrite operator-edited governance docs.
- **Source:** `cli/src/install/bootstrap-governance.ts` (`bootstrapGovernanceDocs`)
- **Preconditions / inputs:** `installerRoot` with `sdlc/files/_common/governance/*.md.template`; consumer project path; optional `--dry-run`.
- **Given** `devaudit bootstrap-governance <path>` on a project with no `compliance/governance/` **Then** all six `*.md.template` files (read from `sdlc/files/_common/governance`, sorted) are copied to `compliance/governance/` with the `.template` suffix dropped (e.g. `ropa.md.template` → `compliance/governance/ropa.md`); **Given** a target file already exists on disk (`isFile` true) **Then** it is skipped (added to `skipped[]`, never overwritten) and the result message reports `<n> copied, <m> kept (already on disk)`. **Given** `--dry-run` **Then** status `planned` with `would copy <n> starter(s) … (skip-if-exists)` and no writes.
- **Error paths:** Source dir not found → status `warn` `source directory not found: <dir>`. Zero `.md.template` files → status `warn` `no .md.template files in <dir>`.
- **Fixtures/env:** clean fixture (expect 6 copied), fixture with pre-existing `compliance/governance/ropa.md` (expect ropa skipped, 5 copied), `--dry-run` fixture (expect no writes).

#### REQ-FRAMEWORK-GOVERNANCE-003 — Each starter carries required frontmatter + the REPLACE banner

- **Priority:** Should — the banner and frontmatter make the placeholder status unambiguous on disk and in the portal's rendered evidence view; auditors reject unedited stubs.
- **Source:** `sdlc/files/_common/governance/{ai-disclosure,dpia,incident-report,periodic-review,risk-register,ropa}.md.template`
- **Preconditions / inputs:** Starters copied via GOVERNANCE-002.
- **Given** each copied starter **Then** it begins with a YAML frontmatter block and an immediately-following blockquote banner containing `⚠️ **STARTER TEMPLATE — REPLACE BEFORE COMMITTING.`. Per-file required frontmatter keys:
  - `ai-disclosure.md`: `title, provider, intended_purpose, last_reviewed_at, review_cadence_days (180), risk_class`.
  - `dpia.md`: `title, processing_activity, controller, last_reviewed_at, review_cadence_days (365), risk_level`.
  - `incident-report.md`: `title, incident_id, severity, detected_at, resolved_at, involves_personal_data, reported_to_supervisory_authority, notification_window_72h, last_reviewed_at`.
  - `periodic-review.md`: `title, period_start, period_end, reviewer, last_reviewed_at, review_cadence_days (90)`.
  - `risk-register.md`: `title, project, maintained_by, scoring_matrix, last_reviewed_at, review_cadence_days (90)`.
  - `ropa.md`: `title, controller, controller_contact, last_reviewed_at, review_cadence_days (365), processing_activities ([])`.
- **Error paths:** N/A — verbatim copy; absence of banner/frontmatter would be a source-template defect.
- **Fixtures/env:** post-bootstrap fixture; assert each file's first non-empty lines match the frontmatter keys and the banner string.

#### REQ-FRAMEWORK-GOVERNANCE-004 — Each starter declares its evidence type and framework-clause coverage

- **Priority:** Should — the declared evidence type + clauses are the contract that maps each governance doc to the compliance matrix it closes.
- **Source:** `sdlc/files/_common/governance/*.md.template`; `cli/src/install/bootstrap-governance.ts` (docstring mapping)
- **Preconditions / inputs:** Starters copied.
- **Given** each starter **Then** its body declares **Framework coverage** and (where applicable) **Evidence type**:
  - `ai-disclosure.md` → evidence type `ai_disclosure`; clause `EUAIA.Art-13`; cadence 180 days.
  - `dpia.md` → evidence type `dpia`; clause `GDPR.Art-35`; cadence 365 days.
  - `ropa.md` → evidence type `ropa`; clause `GDPR.Art-30`; cadence 365 days.
  - `incident-report.md` → clauses `ISO29119.3.5.4`, `SOC2.CC7.2`, `GDPR.Art-33`, `GDPR.Art-34` (per the bootstrap docstring); one incident per file.
  - `periodic-review.md` → clauses `SOC2.CC4.1`, `ISO27001.A.12.1`; auto-regenerated quarterly by `.github/workflows/periodic-review.yml` (human attestation still required).
  - `risk-register.md` → clauses `SOC2.CC3.2`, `SOC2.CC3.4`, `ISO27001.A.5.1`, `ISO27001.A.6.2`, `GDPR.Art-32`; maintained by the `risk-register-keeper` skill.
- **Error paths:** N/A.
- **Fixtures/env:** post-bootstrap fixture; grep each file for its evidence-type token and clause IDs.

#### REQ-FRAMEWORK-GOVERNANCE-005 — Governance starters are operator-uploaded, not CI-auto-uploaded

- **Priority:** Could — the templates state CI does NOT upload them (since v0.1.39); a placeholder must not flip a matrix clause to COVERED automatically.
- **Source:** `sdlc/files/_common/governance/ropa.md.template`, `dpia.md.template`, `ai-disclosure.md.template` ("kept in-repo for review; CI does NOT upload it" / "Tier-2 governance docs are operator-uploaded only since DevAudit-Installer v0.1.39")
- **Preconditions / inputs:** Starters present in `compliance/governance/`.
- **Given** a governance starter on disk **Then** the template's "Uploading this artefact" section states the file is kept in-repo for review and is uploaded only manually via the portal Upload Evidence form (per evidence type), not by CI. This is documentary contract content within the rendered file, not CLI behaviour.
- **Error paths:** N/A.
- **Fixtures/env:** post-bootstrap fixture; assert the "CI does NOT upload" wording is present in ropa/dpia/ai-disclosure.

---

#### REQ-FRAMEWORK-RULES-001 — Five AI rule-file targets written so every supported agent discovers the SDLC

- **Priority:** Must — the rule-file discovery contract is the entry point that makes any agent enforce the SDLC; missing or wrong paths break discovery.
- **Source:** `cli/src/update/ai-rules.ts` (`syncAiRules`)
- **Preconditions / inputs:** `installerRoot` with `sdlc/ai-rules/INSTRUCTIONS-SDLC.md` present; a consumer project path. Runs on both `install` and `update` (section `2b` in `cli/src/update/index.ts`).
- **Given** `INSTRUCTIONS-SDLC.md` exists **When** `syncAiRules` runs **Then** exactly five targets are written at the consumer root: `.cursorrules` (Cursor), `.windsurfrules` (Windsurf), `GEMINI.md` (Gemini CLI), `CLAUDE.md` (Claude Code), and `INSTRUCTIONS.md` (canonical, consumed by any LLM agent); the section reports `filesSynced: 5`.
- **Error paths:** If `sdlc/ai-rules/INSTRUCTIONS-SDLC.md` is absent, the section is SKIPPED with `INSTRUCTIONS-SDLC.md not found` and 0 files.
- **Fixtures/env:** node/python fixture; assert all five files exist at the project root after `update`.

#### REQ-FRAMEWORK-RULES-002 — Cursor/Windsurf/Gemini rule files are pointer files that reference INSTRUCTIONS.md

- **Priority:** Must — the pointer pattern keeps a single source of truth; each agent's file must point to the canonical doc.
- **Source:** `cli/src/update/ai-rules.ts` (`CURSOR_POINTER`, `WINDSURF_POINTER`, `GEMINI_POINTER`, `writePointerFile`)
- **Preconditions / inputs:** `syncAiRules` running.
- **Given** the sync runs **Then** `.cursorrules` is overwritten with the `# Cursor Rules` pointer naming `INSTRUCTIONS.md` as the **Single Source of Truth**; `.windsurfrules` with the equivalent `# Windsurf Rules` pointer; `GEMINI.md` with the `# GEMINI.md` pointer (guidance to Gemini CLI + `See ./INSTRUCTIONS.md`). All three are fully overwritten on every run (idempotent — same bytes each time).
- **Error paths:** N/A.
- **Fixtures/env:** fixture with pre-existing hand-edited `.cursorrules` (expect it overwritten to the canonical pointer); assert each pointer contains the literal `INSTRUCTIONS.md` link.

#### REQ-FRAMEWORK-RULES-003 — CLAUDE.md preserves project header, appends pointer, strips prior SDLC section

- **Priority:** Must — Claude Code's CLAUDE.md often carries project-specific content that must survive re-sync while still gaining the pointer.
- **Source:** `cli/src/update/ai-rules.ts` (`updateClaudeFile`, `CLAUDE_NEW`, `CLAUDE_POINTER_TAIL`, `SDLC_HEADER`)
- **Preconditions / inputs:** Optional pre-existing `CLAUDE.md`.
- **Given** no `CLAUDE.md` exists **Then** it is created from `CLAUDE_NEW` (a `# CLAUDE.md` header + the `## Project Standards` pointer tail naming `INSTRUCTIONS.md`); **Given** a `CLAUDE.md` already exists **Then** any content from the legacy `## SDLC Compliance Process (MANDATORY)` header (`SDLC_HEADER`) onward is stripped, and if the body does not already mention `INSTRUCTIONS.md` the `CLAUDE_POINTER_TAIL` is appended. Project-specific content above the SDLC header is preserved.
- **Error paths:** N/A.
- **Fixtures/env:** fixture with a `CLAUDE.md` containing a project header + an old inlined SDLC section (expect: project header kept, old SDLC section removed, pointer tail present, no duplicate pointer on a second run).

#### REQ-FRAMEWORK-RULES-004 — INSTRUCTIONS.md is canonical; holds the real SDLC content from INSTRUCTIONS-SDLC.md

- **Priority:** Must — INSTRUCTIONS.md is the single source the four other files point to; it must contain the actual SDLC process content.
- **Source:** `cli/src/update/ai-rules.ts` (`updateInstructionsFile`); source content `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`
- **Preconditions / inputs:** `sdlcContent` = the bytes of `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`; optional pre-existing `INSTRUCTIONS.md`.
- **Given** no `INSTRUCTIONS.md` exists **Then** it is created with the `# Project Instructions & Standards (Single Source of Truth)` header followed by the full `INSTRUCTIONS-SDLC.md` content (which begins with `## SDLC Compliance Process (MANDATORY)` and lists the `SDLC/0-…`…`SDLC/5-…` workflow files plus the `sdlc-implementer` skill entry point); **Given** an `INSTRUCTIONS.md` already exists **Then** content from the `SDLC_HEADER` onward is truncated and the fresh `sdlcContent` is re-appended (so project-specific content above the SDLC section is preserved and the SDLC section is replaced, not duplicated).
- **Error paths:** Covered by RULES-001's skip when the source file is missing.
- **Fixtures/env:** fixture with no INSTRUCTIONS.md (expect canonical content), fixture with a project-prefaced INSTRUCTIONS.md + an old SDLC section (expect SDLC section replaced once, project preface kept). NOTE: the source is `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`, NOT the DevAudit-Installer repo's own root `INSTRUCTIONS.md` nor `sdlc/files/_common/implementing-an-sdlc-issue.md` — those two are the installer's own docs, not the per-agent rule source. See Assumptions.

#### REQ-FRAMEWORK-RULES-005 — AI rule-file sync is idempotent on update re-run

- **Priority:** Must — re-running `update` must not duplicate pointers or drift the canonical content.
- **Source:** `cli/src/update/ai-rules.ts` (`updateClaudeFile` `body.includes('INSTRUCTIONS.md')` guard; `updateInstructionsFile` truncate-then-append)
- **Preconditions / inputs:** A project already synced once.
- **Given** `update` is run a second time **Then** the three pointer files are rewritten to identical bytes; `CLAUDE.md` gains no duplicate pointer tail (guarded by the `INSTRUCTIONS.md` substring check); `INSTRUCTIONS.md`'s SDLC section is truncated and re-appended so the file content is stable across runs.
- **Error paths:** N/A.
- **Fixtures/env:** any synced fixture; run `update` twice, assert byte-identical results for all five files.

---

#### REQ-FRAMEWORK-STAGE-001 — Stage docs and Tier-1 docs synced verbatim into the consumer's SDLC/

- **Priority:** Should — the stage workflows and Tier-1 policy docs are the procedure the AI rule files point at; they must land verbatim in `SDLC/`.
- **Source:** `cli/src/update/stage-docs.ts` (`syncStageDocs`); source dir `sdlc/files/_common/`
- **Preconditions / inputs:** Consumer project path. Runs on both `install` and `update` (section `2a`).
- **Given** `update`/`install` runs **Then** `SDLC/` is created (`ensureDir`) and every `*.md` file under `sdlc/files/_common/` is copied verbatim into `SDLC/<basename>` — including the six stage docs `0-project-setup.md` … `5-deploy-main.md`, the Tier-1 docs `Test_Policy.md`, `Test_Strategy.md`, `Test_Architecture.md`, `Periodic_Security_Review_Schedule.md`, and templates (`Test_Plan_TEMPLATE.md`, `README_TEMPLATE.md`, `Implementation_Plan_TEMPLATE.md`, `implementing-an-sdlc-issue.md`, `joining-an-existing-project.md`). The count of files synced equals the number of `*.md` files in `_common/`.
- **Error paths:** N/A — verbatim copy; the source is first-party.
- **Fixtures/env:** node/python fixture; assert `SDLC/0-project-setup.md` … `SDLC/5-deploy-main.md` and the four Tier-1 docs exist and equal source bytes.

#### REQ-FRAMEWORK-STAGE-002 — Post-sync validation warns on missing Tier-1 docs in SDLC/

- **Priority:** Should — the operator should be warned (non-fatally) if the Tier-1 trio failed to land before committing.
- **Source:** `cli/src/update/validation.ts` (`runValidation`, `TIER_1_DOCS`)
- **Preconditions / inputs:** Post-sync; an `SDLC/` directory in the consumer.
- **Given** `SDLC/` exists but is missing any of `Test_Policy.md`, `Test_Strategy.md`, `Test_Architecture.md` **Then** `runValidation` adds a warning `Missing Tier 1 doc: SDLC/<doc>` (the warning is surfaced, the sync is not failed). NOTE: validation checks only the three Test\_\* Tier-1 docs, not `Periodic_Security_Review_Schedule.md`.
- **Error paths:** This requirement is a warning path, not a hard error.
- **Fixtures/env:** fixture where one Tier-1 doc is deleted post-sync (expect the matching warning); clean fixture (expect `All validation checks passed`).

#### REQ-FRAMEWORK-STAGE-003 — `devaudit status` reports presence of the framework files including stage docs and rule files

- **Priority:** Should — `status` is the consumer-facing health check confirming the rendered contract is in place.
- **Source:** `cli/src/commands/status.ts` (`runStatus`, `FRAMEWORK_FILES`, `checkFrameworkFiles`)
- **Preconditions / inputs:** A consumer with `sdlc-config.json`.
- **Given** `devaudit status [path]` on an onboarded project **Then** it reports present/missing for the fixed `FRAMEWORK_FILES` list: `INSTRUCTIONS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `GEMINI.md`, `SDLC/0-project-setup.md`, `SDLC/5-deploy-main.md`, `scripts/upload-evidence.sh`, `compliance/RTM.md`, `.github/workflows/ci.yml`. If any are missing it prints `<n> framework file(s) missing. Re-sync with \`devaudit update <version> <path>\``. **Given** no `sdlc-config.json`**Then** it warns`not onboarded` and exits with code 7.
- **Error paths:** Missing `sdlc-config.json` → exit 7; missing framework files → non-fatal warning, but the per-file ✓/✗ list is the observable assertion surface. NOTE: `status` checks only two of the six stage docs (`0-project-setup.md`, `5-deploy-main.md`) and all five AI rule files; it does NOT check Tier-1 docs (that's validation's job, STAGE-002).
- **Fixtures/env:** fully-synced fixture (expect all ✓), fixture with `GEMINI.md` removed (expect ✗ + missing-count warning), fixture without `sdlc-config.json` (expect exit 7).

---

#### REQ-FRAMEWORK-HOOK-003 — Pre-push hook checks for .e2e-evidence-wired sentinel when e2e spec files changed (#226)

- **Priority:** Should — prevents pushing E2E spec files without evidence wiring validation (Phase 5½).
- **Source:** `sdlc/files/stacks/node/hooks/pre-push` (section 2, after the E2E gate check): `git diff --name-only "$RANGE" -- 'e2e/**/*.spec.ts'` detects E2E spec changes; if any are found and `.e2e-evidence-wired` sentinel file is missing, the hook exits 1 with an actionable error message.
- **Preconditions / inputs:** Push to the integration branch; `e2e/**/*.spec.ts` files in the diff range.
- **Given** a push containing changes to `e2e/**/*.spec.ts` files **When** the pre-push hook runs **Then** it checks for `.e2e-evidence-wired` sentinel (written by `e2e-test-engineer` Phase 5½). **Given** the sentinel is missing **Then** the hook exits 1 with "Evidence wiring validation (Phase 5½) was not run" and lists the changed spec files. **Given** the sentinel exists **Then** the hook prints "E2E evidence wiring check passed" and continues. **Given** no E2E spec files changed **Then** the check is skipped entirely.
- **Error paths:** Missing `.e2e-evidence-wired` → exit 1; bypass with `--no-verify` (last resort).
- **Fixtures/env:** A push with e2e spec changes and no sentinel (blocked); a push with e2e spec changes and sentinel present (passes); a push with no e2e spec changes (check skipped).

#### REQ-FRAMEWORK-SKILL-005 — e2e-test-engineer Phase 6 pre-flight browser check + anti-deferral instruction (#238)

- **Priority:** Must — prevents the agent from deferring E2E execution to CI by claiming browsers are not installed.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 6 — Execute and report): pre-flight check `npx playwright install --dry-run 2>&1 | grep -q "is already installed" || npx playwright install`; explicit anti-deferral instruction: "Do not defer E2E execution to CI because browsers are not installed. Installing browsers takes ~30 seconds; deferring breaks the evidence trail."
- **Preconditions / inputs:** Playwright installed in the consumer repo; E2E suite about to run.
- **Given** the skill reaches Phase 6 **When** the pre-flight check runs **Then** it verifies browser availability and installs if missing. **Given** browsers are not installed **Then** the skill installs them (`npx playwright install` or `npx playwright install --with-deps` with operator approval for sudo). **Given** the install fails **Then** the skill asks the operator for help, not defers to CI. **Given** the agent attempts to write "Deferred to CI" **Then** the gate state vocabulary instruction (#240) and `validate-test-summary.sh` reject it.
- **Error paths:** Browser install failure → ask operator; missing system deps → `--with-deps` (requires sudo, ask operator).
- **Fixtures/env:** A repo with browsers already installed (pre-flight passes); a repo without browsers (pre-flight installs); a repo with missing system deps (asks operator).

#### REQ-FRAMEWORK-SKILL-006 — e2e-test-engineer Phase 5½ writes .e2e-evidence-wired sentinel after validating wiring (#226)

- **Priority:** Must — provides the machine-enforced signal that evidence wiring was validated, backing the pre-push hook (HOOK-003) and sdlc-implementer step 5b check.
- **Source:** `sdlc/files/_common/skills/e2e-test-engineer/SKILL.md` (§ Phase 5½ — Write the evidence-wiring sentinel): after all checks pass, writes `.e2e-evidence-wired` in repo root with `echo "WIRED $(date -u +%Y-%m-%dT%H:%M:%SZ) REQ-XXX" > .e2e-evidence-wired`. If an AC was explicitly skipped, notes it in the sentinel content. The file is gitignored (GITIGNORE-001) and never committed.
- **Preconditions / inputs:** All Phase 5½ checks pass (or explicit exemptions recorded).
- **Given** all Phase 5½ checks pass **When** the skill writes the sentinel **Then** `.e2e-evidence-wired` exists in the repo root with a timestamp and REQ ID. **Given** an AC was explicitly skipped (e.g. API-only) **Then** the sentinel notes the skip: `WIRED <timestamp> REQ-XXX (AC3 skipped — API-only)`. **Given** the sentinel is missing **Then** the pre-push hook (HOOK-003) blocks the push and sdlc-implementer step 5b halts.
- **Error paths:** Phase 5½ checks fail → sentinel not written → downstream enforcement blocks.
- **Fixtures/env:** All checks pass (sentinel written); one AC skipped with exemption (sentinel notes skip); checks fail (no sentinel, downstream blocks).

#### REQ-FRAMEWORK-SKILL-007 — sdlc-implementer Phase 2 step 4b reconciles test-plan.md file paths with actual files (#241)

- **Priority:** Should — catches test-plan drift early so `validate-compliance-artifacts.sh` doesn't fail at PR time.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 2 step 4b): after writing/updating tests, diff actual test file paths against `compliance/evidence/REQ-XXX/test-plan.md`. For each path: if file exists → OK; if missing but equivalent test covering same AC found → update test-plan.md; if missing and no equivalent → HALT. Commit updated test-plan.md alongside test code. This is file-path reconciliation only — the step 5b AC consistency check handles AC drift separately.
- **Preconditions / inputs:** `test-plan.md` authored during Stage 1 with predicted file paths; tests written/updated during Phase 2 step 3-4.
- **Given** test-plan.md references `e2e/foo.spec.ts` and the file exists **Then** no action needed. **Given** test-plan.md references `e2e/foo.spec.ts` but the test was added to `e2e/bar.spec.ts` covering the same AC **Then** update test-plan.md to reference `e2e/bar.spec.ts`. **Given** test-plan.md references `e2e/foo.spec.ts` but no test file exists and no equivalent test covering the same AC was found **Then** HALT with actionable error. **Given** test-plan.md is already accurate **Then** no changes needed.
- **Error paths:** Unreconcilable mismatch (no equivalent test) → HALT; operator must create the file, update test-plan.md, or remove the entry.
- **Fixtures/env:** A test-plan with accurate paths (passes); a test-plan with drifted paths but equivalent tests found (updated); a test-plan with no equivalent test (halts).

#### REQ-FRAMEWORK-SKILL-008 — sdlc-implementer Phase 3 step 5b validates test-execution-summary.md gate states via validate-test-summary.sh (#240)

- **Priority:** Must — prevents invalid gate states from reaching the portal by running the validator before evidence upload.
- **Source:** `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (§ Phase 3 step 5b): runs `bash scripts/validate-test-summary.sh origin/main` before uploading evidence. If the validator fails, fixes the summary before proceeding. E2E gate results must be PASS, FAIL, NOT_NEEDED (with reason), or SKIPPED (with rationale). The word "deferred" must never appear in test-execution-summary.md.
- **Preconditions / inputs:** `compliance/evidence/REQ-XXX/test-execution-summary.md` exists; `scripts/validate-test-summary.sh` synced to consumer.
- **Given** the skill reaches Phase 3 step 5b **When** it runs the validator **Then** invalid gate states ('deferred', 'browsers not installed', SKIPPED/NOT_NEEDED without rationale) are caught and the skill fixes them before proceeding. **Given** the validator passes **Then** the skill proceeds to evidence upload. **Given** the validator fails **Then** the skill fixes the summary and re-runs the validator.
- **Error paths:** Validator fails → fix and re-run; validator script missing → skill should note the gap (CI will catch it on PR).
- **Fixtures/env:** A summary with valid gate states (passes); a summary with 'deferred' (fails, skill fixes); a summary with SKIPPED but no rationale (fails, skill fixes).

#### REQ-FRAMEWORK-VALIDATE-002 — validate-test-summary.sh rejects invalid gate states in test-execution-summary.md (#240)

- **Priority:** Must — the CI-side enforcement that backs the skill-side prohibition on invalid gate states.
- **Source:** `sdlc/files/_common/scripts/validate-test-summary.sh`: extracts REQ-XXX from commit messages, finds `compliance/evidence/REQ-XXX/test-execution-summary.md`, checks for: (1) 'deferred' anywhere in file (case-insensitive), (2) 'browsers not installed', (3) 'Deferred to CI', (4) E2E gate table rows with 'defer' in result column, (5) SKIPPED/NOT_NEEDED without rationale. Exits 1 if any check fails.
- **Preconditions / inputs:** PR with REQ-XXX in commit messages; `test-execution-summary.md` exists for the REQ.
- **Given** a summary containing 'deferred' anywhere **Then** the validator exits 1. **Given** a summary containing 'browsers not installed' **Then** the validator exits 1. **Given** a summary with E2E gate result SKIPPED but no rationale in the Details column **Then** the validator exits 1. **Given** a summary with E2E gate result NOT_NEEDED but no rationale **Then** the validator exits 1. **Given** a summary with all valid gate states and rationales **Then** the validator exits 0. **Given** no REQ-XXX in commit messages **Then** the validator skips (exit 0). **Given** no test-execution-summary.md for the REQ **Then** the validator skips that REQ (exit 0).
- **Error paths:** Any invalid gate state → exit 1; missing file → skip (validate-compliance-artifacts.sh checks existence).
- **Fixtures/env:** 11 test cases in `validate-test-summary.test.sh`: clean PASS, deferred, Deferred to CI, browsers not installed, NOT_NEEDED with rationale, SKIPPED with rationale, SKIPPED without rationale, no REQ references, no summary file, e2e deferred in assessment, NOT_NEEDED without rationale.

#### REQ-FRAMEWORK-GITIGNORE-001 — gitignore.ts syncs .e2e-evidence-wired sentinel entry to consumer .gitignore (#226)

- **Priority:** Must — ensures the evidence-wiring sentinel is never committed to consumer repos.
- **Source:** `cli/src/update/gitignore.ts` (`SENTINEL_ENTRIES` array includes `.e2e-evidence-wired` alongside `.e2e-gate-passed` and `.sdlc-implementer-invoked`); `syncGitignore` function adds missing entries under the `# DevAudit sentinel files` marker.
- **Preconditions / inputs:** Consumer repo with a `.gitignore` file (or none — created if needed).
- **Given** `devaudit update` runs on a consumer repo **When** `syncGitignore` executes **Then** `.e2e-evidence-wired` is added to `.gitignore` if not already present. **Given** the entry already exists **Then** no duplicate is added (idempotent). **Given** no `.gitignore` exists **Then** one is created with the sentinel entries.
- **Error paths:** File system errors → sync fails gracefully.
- **Fixtures/env:** A consumer repo without `.gitignore` (created); a repo with `.gitignore` but missing the entry (added); a repo with the entry already present (no-op).

---

#### Assumptions — Adapters/Governance/Rules

- **Runtime JSON-Schema validation of adapters** is enforced via Ajv in `cli/src/lib/adapter.ts` (DevAudit-Installer#158). Both `loadStackAdapter` and `loadHostAdapter` compile the appropriate `adapter.schema.json` and validate the parsed adapter before returning it. Schema-invalid adapters are rejected with a clear error listing all violations.
- **`cli/src/update/scripts.ts` not fully read.** ADAPTER-009 infers that `stack_scripts` (node's `check-requirement-jsdoc.sh`) is rendered into the consumer's `scripts/` by the `2d` section runner (`syncScripts`); the exact target path and skip semantics were taken from the adapter manifest + schema description (`copied to the consumer's scripts/ directory`), not from reading `scripts.ts` line-by-line.
- **Host-adapter deploy substitution rendering is owned by FRAMEWORK-CI.** This area resolves and loads the host adapter (by name) and documents the substituted fields; the actual placement of `deploy_trigger`/`production_url`/`wait_for_deploy` into `.github/workflows/*.yml` happens in `cli/src/update/ci-templates.ts` (section `2f`), which is scoped to the CI SRS section. ADAPTER-011/012 assert the contract values and the cross-area boundary, not the rendered-YAML bytes.
- **`bootstrap-governance` command surface owned by another section.** GOVERNANCE-001/002 reference `cli/src/commands/bootstrap-governance.ts` only to establish the opt-in boundary and idempotent copy behaviour of `bootstrapGovernanceDocs`; the command's CLI flags/output formatting are owned elsewhere.
- **`incident-report` GDPR.Art-34 clause** is taken from the `bootstrap-governance.ts` docstring; the template's own visible "Framework coverage" list shown in source begins with `ISO29119.3.5.4`, `SOC2.CC7.2`, `GDPR.Art-33` (the head of the list was read; Art-34 is asserted from the docstring mapping).
- **Version provenance (v0.1.36 opt-in, v0.1.39 operator-upload, etc.)** is taken from the template banners and `bootstrap-governance.ts` comments as documentary fact, not independently verified against a changelog.

---

## Appendix A — Assumptions & Ambiguities

Behaviours below are **implicit, possibly unintended, or divergent from stated intent / the issue brief**. They are flagged for a human decision; tests should assert _current_ behaviour (as captured in §4) and link here. Each §4 subsection also carries its own `Assumptions — <area>` block.

### A.1 Likely bugs / divergences (verify before relying on intent)

- **`update --dry-run` is a no-op.** `cli/src/index.ts` never forwards `globals.dryRun` to `runUpdate`, and `runUpdate` has no dry-run branch — so `update --dry-run` **mutates the tree like a normal run**. (`bootstrap-governance --dry-run` _does_ preview correctly.)
- **CLI `push` ≠ `scripts/upload-evidence.sh`.** The major historical parity gaps are now closed: the CLI implements the drift-warning probe, recursive directory upload, starter-stub skip, metadata/release fields, and default retry budget. The remaining meaningful difference is that CI still uses the shell as the authoritative stage-stamping path (`--sdlc-stage` / `sdlcStage`) and the shell documents lower-level transport knobs (`curl -L`, `--max-redirs`) that the CLI leaves to platform `fetch` defaults.
- **Base-URL gating inconsistency in `ci.yml`.** The node template's evidence jobs gate on the repo **Variable** `vars.DEVAUDIT_BASE_URL`, while every other workflow prefers `sdlc-config.json` `devaudit.base_url`. A consumer that migrated base-URL into `sdlc-config.json` (the v1.23.0 direction) **silently SKIPs** the register/upload jobs unless the deprecated Variable is also still set.
- **Python `ci.yml` mislabels security evidence.** It uploads SAST + dep-audit results as `audit_log` rather than the precise `sast_report` / `dependency_audit` types, so the portal's two panels can show identical content (devaudit#387 — unfixed for python). Python also derives a bare-date release version rather than the REQ-tag.
- **Adapter-schema validation is now runtime-enforced.** `cli/src/lib/adapter.ts` compiles the host/stack schemas with Ajv and rejects parseable-but-schema-invalid manifests at load time.
- **`doctor` description overstates behaviour.** Its registered description claims it checks "auth state, config validity," but `runDoctor` only checks five tools on PATH (`node ≥ 22`, `git`, `gh`, `jq`, `curl`) plus a non-gating release-drift line — no token or config validation.
- **Python stack dev-deps are declared but never auto-installed** — `syncStackDeps` early-returns for any non-node stack; python deps come via `pip install -e ".[dev]"` (operator-run), not the CLI.

### A.2 Divergences from the issue brief (the brief assumed these; the code differs)

- **`upgrade` is not a self-updater** — in v0.1.54 it is a `makeStub` command (prints "not implemented" + tracking issue → exit 1). Marked `Won't`.
- **The AI-rule source is `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`**, not the repo's own root `INSTRUCTIONS.md` or `implementing-an-sdlc-issue.md` (those are the installer's own docs).
- **`install` and `update` share one render path** (`install/sync-templates.ts` → `syncProject()`), so every template/sync requirement applies to both.
- **The drift warning the brief attributes to `devaudit push`** is now real CLI behaviour too: `runPush` calls `probeBaseUrlDrift()` before upload and logs a warning on cross-host redirects.
- **No true CLI-E2E layer is encoded in this repo** — the real install/update-against-consumer coverage (wgb; META-JOBS reverted per `docs/consuming-projects.md`) is manual/external.

### A.3 Exit-code & flow quirks (load-bearing — assert exactly)

- **Distinct exit codes** carry meaning and are asserted in the existing suite: `join` not-onboarded → **7**; `status` not-onboarded → **7**; `doctor` missing-tool → **6**; `push`/`auth` missing-key / rejected token / not-logged-in → **3**; upload failure → **4**; plugin `npm install` failure → **5**; git clone → **6**; manifest validation → **9**; generic errors → **1**.
- **Dev-mode auto-routing is a strict four-bit AND** (config file + portal project + live `Onboarding-issued` key + `DEVAUDIT_USER_TOKEN` repo secret); any miss or any portal error **falls back to operator** (safe default). `--dry-run` forces **operator** mode so the preview shows the maximal step set. The destructive steps skipped in dev mode are exactly **4, 6, 7, 9**; steps **8 (hooks) and 10 (sync)** run in both modes.
- **`install` has no dirty-tree check**, and **"not a git repo" yields `provider: null` → GitHub steps 7/9 are reported `skipped`, not a non-zero exit.**
- **`--org <slug>` is registered but inert** across the CLI (workstream B unbuilt). Marked `Won't`.
- **Two portal auth header schemes:** evidence upload uses `Authorization: Bearer`; PAT validation (`devaudit-api.ts`) uses `x-devaudit-token`. Only interactive `auth login` enforces the `mctok_` prefix; `--api-key`/env keys are unchecked.

### A.4 Skill-contract subtleties

- **The `e2e-test-engineer` delegation contract is double-gated** (devaudit#132): a verbatim pre-edit transcript line (`Delegating e2e test work to e2e-test-engineer.`) **plus** a post-hoc per-spec self-audit over the git diff — both directly assertable, the strongest black-box hook in the skill set.
- **`evidenceShot` is fully observable** from the shipped `references/evidence.ts`: output `compliance/evidence/REQ-XXX/screenshots/REQ-XXX-AC<n>-<slug>.png` + a sidecar `.meta.json`; slug constrained to `[a-z0-9-]+`; `feature`/`regression` origin auto-detected from `E2E_NEW_SPECS`.
- **The three SoT skills defer framework-clause closure** to META-COMPLY's `framework-registry-auditor` and may ship "orphan-by-design" artefacts — so requirements assert the `evidence_type` tag + upload path, **not** clause closure.
- **`sdlc-implementer` has exactly three named pause points** (Phase 1 step 11 HIGH/CRITICAL plan approval; Phase 4 step 5 release-PR hard stop; Phase 5 separate `resume`). Everything else is silent continuation (opt-in-to-pause).
- **The governance starter banner** reads "STARTER TEMPLATE — REPLACE BEFORE COMMITTING" on disk; a `bootstrap-governance.ts` docstring quotes the older "REPLACE BEFORE GOING TO PRODUCTION" — assert the on-disk text.

### A.5 Operational notes

- **Failed CI gates still upload evidence** (`if: always() && !cancelled()`, `gateStatus=failed`) — deliberate (devaudit#96/#132); `status=failed` is the audit trail.
- **`check-release-approval` is fail-closed:** a projects-404 contradicted by a `releases/resolve` 2xx **fails** the gate rather than bootstrapping — preferring a hard stop over bypassing four-eyes.
- **`status` and `compliance-validation` check different doc subsets** — `status` inspects 2 of 6 stage docs + all 5 rule files (not Tier-1); `validation` warns on the three `Test_*` Tier-1 docs only.

---

## Appendix B — E2E Test Environment

### B.1 External dependencies — stand up / stub

| Dependency               | Mode for tests | How                                                                                                                                   |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| DevAudit portal HTTP API | stub           | **msw** `setupServer` (unit) with `onUnhandledRequest:'error'`, CLI pointed via `DEVAUDIT_BASE_URL`; or a local HTTP stub for CLI-E2E |
| `gh` CLI                 | mock / shim    | `vi.mock('execa')` recording calls + an injected fake provider (unit); an on-disk `gh` shim prepended to `PATH` (CLI-E2E)             |
| `git`                    | real / mock    | real `git init` temp repo, or execa mock                                                                                              |
| `npm`                    | sandbox / mock | allow inside the throwaway fixture, or mock `syncStackDeps` / `plugin update`                                                         |
| `sdlc/files/` templates  | real snapshot  | set `DEVAUDIT_INSTALLER_ROOT` → repo root (skips `bundle:templates`), or run `npm run bundle:templates` first                         |
| PAT / auth cache         | temp HOME      | point `XDG_CONFIG_HOME` / HOME at an `fs.mkdtemp` dir so `~/.config/devaudit/{auth.json,plugins/}` is sandboxed                       |

### B.2 Core fixtures

- **A node consumer repo** (`package.json`, `git init`) and **a python consumer repo** (`pyproject.toml`/`requirements.txt`) — to exercise stack detection + node-vs-python rendered deltas.
- **A clean (un-onboarded) consumer** and **an already-onboarded consumer** (with `sdlc-config.json`, a portal project, an `Onboarding-issued` key marker, and a `DEVAUDIT_USER_TOKEN` secret marker) — to exercise operator vs developer-mode auto-routing and `join`.
- **A portal stub** serving: PAT validation (`GET /api/projects`), project create, CI-key issuance, evidence upload (`POST /api/evidence/upload`, incl. a 429-then-200 sequence to test retry), and `GET /api/ci/releases/resolve`.
- **A `gh` shim / fake provider** asserting secret-set + branch-protection calls without touching GitHub.
- **Plugin fixtures:** a local git repo as a plugin source (install), and a seeded `~/.config/devaudit/plugins/` (list/remove/update).
- **Auth fixtures:** a valid and an invalid PAT (only interactive login enforces the `mctok_` prefix).

### B.3 Suggested mocking strategy & test layering

- **Unit (present):** import the action function (`runInstall`, `syncProject`, `runDoctor`, …); msw for the portal, `vi.mock('execa')` / fake provider for `gh`/`git`, temp fixture repos, `DEVAUDIT_INSTALLER_ROOT` for templates. Assert the returned report + the fixture filesystem.
- **CLI integration (recommended):** `execa('node', [bin/devaudit.js, …], { reject:false })` against a throwaway `git init` fixture, with a local HTTP portal stub + an on-disk `gh` shim on `PATH` (the cross-process replacement for `vi.mock`). Assert **exit code + stdout/stderr + filesystem deltas**. Requires a prior `npm run build` (the bin loads `dist/`) and `bundle:templates`-or-`DEVAUDIT_INSTALLER_ROOT`.
- **Full E2E (recommended, nightly — not the PR gate):** a real `install`/`update` against a dedicated _tracer consumer_ repo, asserting the rendered CI workflows + rule files + a real portal (or a high-fidelity stub). Keep off the PR critical path.
- **Template-render tests:** render each CI template + adapter combo (node/python × railway) and assert the rendered file content (tokens substituted, services block stripped where applicable) — these are pure-function tests needing no network.
