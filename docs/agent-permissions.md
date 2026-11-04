# Keeping agent sessions away from your personal access token

**Recommended, not required.** This is the fourth layer of the credential model in [`credentials.md`](./credentials.md). The first three say agents never use the personal access token (PAT): the `sdlc-implementer` skill never runs the PAT commands, `doctor --fix` portal changes need an interactive terminal, and `doctor` reports a PAT left in the environment. This layer removes the access itself, for agents that support permission rules, so a skill that is ignored or a prompt that is injected still cannot reach the PAT.

**It is defence in depth, not a sandbox.** A permission rule matches the command text the agent writes, or the file path of a built-in file tool. A determined agent with a general shell has other ways (see [Limits](#limits)). The installer never writes your agent settings: `devaudit doctor` only *reports* whether the rules are present (the `agent-permissions` line, informational, never a failure).

## What it stops

| An agent session tries to | With the rules |
| --- | --- |
| run `devaudit install`, `join`, `uninstall`, `auth ...`, `doctor --fix` or `doctor --fleet` (also as `npx @metasession.co/devaudit-cli ...`, and with global flags first, such as `devaudit --json doctor --fix`) | refused |
| read, edit or write anything in the DevAudit config folder (`auth.json`, `viewer-keys.json`), with a file tool or a recognised file command such as `cat` | refused |
| run `devaudit doctor`, `release status`, `release check`, `update`, `push` | still allowed |

## Claude Code

### `devaudit agent-permissions apply`

Instead of pasting, run it yourself (an agent never runs it):

```bash
devaudit agent-permissions apply                 # user scope (the default)
devaudit agent-permissions apply --scope local   # just you, this project
devaudit agent-permissions apply --scope project # shared with everyone who can commit
devaudit agent-permissions apply --include-env-files
```

It shows the rules it would add, the file and the count, and asks for a confirmation at a terminal. It merges into `permissions.deny`: existing entries are neither removed nor reordered, only missing rules are appended, and every other key (including `allow` and `ask`) is kept. Before it changes anything it writes a timestamped backup of the original beside the file (`settings.json.devaudit-backup-<time>`), then writes atomically and keeps the file mode. It is idempotent: a second run says "already present" and writes nothing and makes no backup.

| Scope | File | Notes |
| --- | --- | --- |
| `user` (default) | `~/.claude/settings.json` | All your projects. The stronger scope: an agent that can edit a project file could weaken a rule there. |
| `project` | `<repo>/.claude/settings.json` | Shared with everyone who can commit; offered, but weaker. |
| `local` | `<repo>/.claude/settings.local.json` | Just you, this project. |

Without a terminal (no TTY, `CI` set, `--json`) it refuses unless `--yes` is given (exit `8`). A settings file that does not parse as JSON is refused and left untouched (exit `1`). It never writes outside these three paths. `install`, `join` and `update` offer it once ("Add the recommended agent protection rules to your user settings? [Y/n/never]"); "never" is remembered on this machine in the CLI config folder (`agentPermissionsOffer`), not in the repository, and the offer is silent with no terminal, in CI, with `--dry-run`, or when every rule is already present. You do not need a locally installed `devaudit` for the rules to matter: they also match `npx --yes @metasession.co/devaudit-cli ...`, with global flags first.

#### The opt-in `env-files` group

`--include-env-files` also denies `Read` of `.env` and `.env.*` files, which can hold uploader or portal keys in a consuming repository. It is **not** part of the default rules and doctor does not count it unless applied. The trade-off: it keeps an agent away from keys in `.env` files, and it also blocks legitimate local-development reads of those files (the agent cannot read your `.env` to help debug configuration).

### Pasting the rules yourself

Paste this into `.claude/settings.json` (this project, shared with everyone who can commit), `.claude/settings.local.json` (this project, just you) or `~/.claude/settings.json` (all your projects). A deny rule at any scope wins over an allow rule at any other.

```json
{
  "permissions": {
    "deny": [
      "Bash(devaudit install*)",
      "Bash(devaudit * install*)",
      "Bash(devaudit join*)",
      "Bash(devaudit * join*)",
      "Bash(devaudit uninstall*)",
      "Bash(devaudit * uninstall*)",
      "Bash(devaudit auth *)",
      "Bash(devaudit * auth *)",
      "Bash(devaudit doctor *--fix*)",
      "Bash(devaudit * doctor *--fix*)",
      "Bash(devaudit doctor *--fleet*)",
      "Bash(devaudit * doctor *--fleet*)",
      "Bash(npx *devaudit-cli install*)",
      "Bash(npx *devaudit-cli * install*)",
      "Bash(npx *devaudit-cli join*)",
      "Bash(npx *devaudit-cli * join*)",
      "Bash(npx *devaudit-cli uninstall*)",
      "Bash(npx *devaudit-cli * uninstall*)",
      "Bash(npx *devaudit-cli auth *)",
      "Bash(npx *devaudit-cli * auth *)",
      "Bash(npx *devaudit-cli doctor *--fix*)",
      "Bash(npx *devaudit-cli * doctor *--fix*)",
      "Bash(npx *devaudit-cli doctor *--fleet*)",
      "Bash(npx *devaudit-cli * doctor *--fleet*)",
      "Read(~/.config/devaudit/**)",
      "Read(~/Library/Preferences/devaudit/**)",
      "Read(//**/AppData/Roaming/devaudit/**)"
    ]
  }
}
```

How the rules read (syntax checked against the [Claude Code permissions documentation](https://code.claude.com/docs/en/permissions) on 2026-10-28):

- `Bash(devaudit auth *)` matches `devaudit auth` followed by anything, and the bare command. `Bash(devaudit * auth *)` covers a global flag between the program and the subcommand. `*` may stand anywhere in the rule and matches any text, including spaces.
- `Bash(npx *devaudit-cli ...)` covers `npx @metasession.co/devaudit-cli ...` and `npx --yes @metasession.co/devaudit-cli ...`. `npx` is not one of the wrappers Claude Code strips before matching, so it needs its own rules.
- A deny rule applies when **any** part of a compound command matches (`cd x && devaudit auth status` is refused).
- `Read(...)` paths use gitignore syntax: `~/` is your home directory, `//` an absolute path. In **user** settings a single leading `/` anchors at `~/.claude/`, not at the filesystem root, which is why the rules above use `~/` and `//`. The three rules are the Linux, macOS and Windows locations of the config folder; the ones that do not apply to you are harmless.
- A `Read` deny also blocks `Edit` and `Write` on the same path, so one rule protects the folder from reading and from writing.
- Who controls what: the project file can be changed by anyone with commit access; your user file only by you; organisations can enforce rules for everyone in [managed settings](https://code.claude.com/docs/en/permissions#managed-settings).

### Tested on a real agent

`scripts/agent-permissions-smoke.sh` starts headless `claude -p` sessions with these rules **and deliberately broad allow rules** (`Bash(devaudit *)`, `Bash(npx *)`, `Bash(cat *)`, `Read`), so the only thing that can stop a command is a deny rule. A fake `devaudit` and `npx` that only print a marker stand in for the real ones, and the credential folder is a throwaway directory with a harmless canary file; your real folder is never touched. Run by hand on Claude Code 2.1.311 on 2026-10-28:

| Case | Result |
| --- | --- |
| `devaudit auth status`, `install`, `join`, `uninstall`, `doctor --fix --yes`, `doctor --fleet --json`, `devaudit --json doctor --fix`, `npx @metasession.co/devaudit-cli join --yes` | all 8 refused |
| read the canary with the `Read` tool; `cat` the canary | both refused |
| `devaudit doctor --json`, `devaudit release status --json`, read a project file | all 3 ran (the allow rules work) |
| `sh -c 'devaudit auth status'` | **not blocked**: a documented limit |
| `env devaudit auth status` | blocked in this version; the documentation does not promise it |

Re-run it after a Claude Code upgrade or a change to the rules (`bash scripts/agent-permissions-smoke.sh`). It needs `claude` signed in, `jq` and Node 22.6 or later, costs a few cents per case, and is not part of CI.

## Other agents

What each vendor documents (first read 2026-10-28, re-checked 2026-10-30: unchanged). **We have not exercised these**; only the Claude Code rules above are tested, and `devaudit agent-permissions apply` writes only Claude Code settings: Cursor's `Shell(...)` rules match the first word of a command, so a subcommand rule cannot be expressed; Gemini CLI's policy files are TOML in a separate folder; Windsurf documents no file for its terminal deny list. For these agents `devaudit doctor` says "no documented mechanism for Gemini CLI, Cursor or Windsurf that `apply` can write; nothing to apply".

**Gemini CLI.** A policy file can deny a shell command by prefix. Put it in your user policy folder (the workspace tier is documented as currently disabled, so a project file has no effect), for example `~/.gemini/policies/devaudit.toml`:

```toml
[[rule]]
toolName = "run_shell_command"
commandPrefix = "devaudit auth"
decision = "deny"
priority = 100

[[rule]]
toolName = "run_shell_command"
commandPrefix = "devaudit install"
decision = "deny"
priority = 100
```

Add one rule per prefix (`join`, `uninstall`, `doctor --fix`, `doctor --fleet`). A prefix rule matches only a command that *starts* with it, so `devaudit --json doctor --fix` is not covered. A policy that denies reading a file path is not documented, so we ship none.

**Cursor (CLI).** `.cursor/cli.json` (project) or `~/.cursor/cli-config.json` (user) take `permissions.deny` rules. `Read(<path>)` rules are documented, and absolute paths can point outside the project, so deny your config folder by its absolute path (write your own home directory in, as `~` is not documented):

```jsonc
{ "permissions": { "deny": ["Read(/home/you/.config/devaudit/**)"] } }
```

`Shell(...)` rules are keyed on the first word of the command, so denying `devaudit` would also stop `devaudit doctor` and `release status`; matching on a subcommand is not documented, so we recommend no shell rule. The documentation does not say whether the Cursor IDE agent reads these files.

**Windsurf (Devin Desktop).** An ignore file (`.devinignore`, or the legacy `.codeiumignore`) at the workspace root stops the agent viewing, editing or creating the listed paths. That covers files inside the workspace; the config folder is outside it, and the pages we could read describe no deny list for terminal commands. We have no recommended rule.

Where a vendor documents no mechanism, there is nothing to configure: keep the PAT out of the agent's reach by other means (below).

## Limits

- **Not a sandbox.** Rules govern the agent tool's own commands and file tools. They do not match the same program written another way: `/usr/bin/devaudit ...`, `sh -c '...'` (shown above), `node cli/bin/devaudit.js ...`, or a script that calls the portal itself.
- **The environment is out of reach.** A token exported as `DEVAUDIT_USER_TOKEN` is inherited by every process started from that shell, and no file rule can hide an environment variable. Do not export it: `devaudit auth login` keeps it in the config folder, plugins now get it from the CLI instead of asking you to export it, and `devaudit doctor` warns when it is set.
- **A project file is only as strong as its commit access,** and an agent that can edit `.claude/settings.json` could in principle weaken it; user and managed settings are the stronger place.
- **Out of scope here:** OS-level isolation (a separate OS user, a container, Claude Code's own [sandboxing](https://code.claude.com/docs/en/sandboxing)) for agent sessions, and scoped PATs (a portal feature). They are the next step if defence in depth is not enough.

## Checking what you have

`devaudit doctor` prints one `agent-permissions` line (Claude Code only; for other agents it says there is no documented mechanism `apply` can write): all rules present, or how many are missing and in which group (`pat-commands`, `credential-store`), and names the fix, `devaudit agent-permissions apply`. It is informational and never changes any file itself; `devaudit doctor --guided` offers the same fix as a tier A option that calls the same function, while `doctor --fix` only prints it (tier C), so scripts keep their exit codes.
