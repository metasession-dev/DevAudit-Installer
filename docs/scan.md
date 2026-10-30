# `devaudit scan`

`devaudit scan` reads a repository and reports what it is **set up to evidence**, clause by clause, for the standards you choose: SOC 2, ISO 27001, ISO/IEC/IEEE 29119, GDPR and the EU AI Act. It reads files only. It never runs anything from the repository, never reads outside the repository root, and makes no network request by default.

It is a readiness report. It does not say a project is compliant, and it never shows a percentage or a pass mark: the clauses come from the [open framework registry](./framework-registry.md), and a clause that only the portal's release records can judge is reported as "needs the portal".

```bash
devaudit scan                        # asks which standards (in a terminal), prints the report
devaudit scan --framework soc-2,iso-27001
devaudit scan --json                 # the scan report (contracts/scan-report.schema.json)
devaudit scan --out scan-reports     # JSON, HTML, SARIF and a badge in that folder
devaudit scan --ci --max-missing 3   # exit 1 when more than 3 clauses are missing
```

## What a clause's state means

| State | Meaning |
| --- | --- |
| `evidenced` | The repository is set up to produce what the clause expects: the document exists, or a workflow uploads the evidence type |
| `partly` | Only an unmodified starter document exists, or the document was last changed longer ago than the clause allows (when git is available) |
| `missing` | Nothing in the repository provides it |
| `unknown` | The check could not be made (for example no requirements document to look in) |
| `needs_portal` | Only the portal can tell: it depends on release records such as who approved a release |

How the expectations are read: a document is looked for by name anywhere in the repository (not in `.git`, `node_modules` or build output) and compared with the starter template bundled in this package; an evidence type is "set up to produce" when a workflow under `.github/workflows/` uploads it. A clause's state follows from its expectations: all `evidenced` is `evidenced`, all `missing` is `missing`, anything else is `partly` (or `unknown` when nothing is evidenced and something is unknown); expectations that need the portal are ignored unless they are all that is left.

## Choosing the standards

`--framework <codes>` names them (`soc-2`, `iso-27001`, `iso-29119`, `gdpr`, `eu-ai-act`). Without it, a run in a terminal asks once, with the standards in `compliance_frameworks` as the default; a run with `--ci`, `--json` or no terminal uses `compliance_frameworks`, and with none evaluates no standards and reports the facts and the suggested preset only.

## Outputs

| Flag | Output |
| --- | --- |
| (none) | A report in the terminal |
| `--json` | The scan report: one format for the output, the cache and `install --from-scan` |
| `--html <file>` | An HTML report |
| `--sarif <file>` | SARIF 2.1.0: one result per clause that is not evidenced, level `warning` for `missing`, `note` for `partly` and `unknown`, `none` for `needs_portal` |
| `--badge <file>` | An SVG: `evidence readiness · <standard> · <evidenced> of <total>` per standard, in one neutral colour |
| `--out <dir>` | All four files in that folder |

Text taken from the repository (paths, reasons) is escaped in the HTML, SARIF and badge. Nothing is written into the repository unless `--out` or a file flag points there. The last report is also cached outside the repository, in the DevAudit cache folder under `scans/`, so `devaudit install` can reuse it.

## Flags and exit codes

- `--local` makes no network request (the default report does not either). `--github` adds read-only information about the release branch's required reviews through `gh`; the two cannot be combined (exit `2`).
- `--ci` never asks. With `--max-missing N` the command exits `1` when more than `N` clauses are `missing` across the selected standards (default `0`). `--max-missing` needs `--ci`.
- Exit `0`: a report was produced (and, with `--ci`, the number missing is within the limit). Exit `1`: too many missing, or the repository could not be read. Exit `2`: invalid flags, or an unknown standard.

## Saving the report and getting help (the account step)

In a terminal, without `--local`, `--ci` or `--json`, the report is followed by an offer: **"Save this report and get help fixing it? Create your free DevAudit account [Y/n]"**. On yes, in this order:

1. **Sign in** through the browser (a device sign-in: you open a link, check the code and approve the machine; the command line never sees a password). Skipped when a valid personal access token already exists (the `devaudit auth login` cache or `DEVAUDIT_USER_TOKEN`). The token is saved the way `devaudit auth login` saves it and is never printed.
2. **Create the project** (the free plan has one project and one admin).
3. **Issue your own read-only viewer key**, saved the way `install` saves it.
4. **Upload the report** (exactly the file in the cache, nothing renamed).

Then: **"Set up the suggested preset now? Yes / Change one thing / Not now"**. Yes runs the guided install with the scan's answers (the cached report) and the suggested preset; "change one thing" runs it with the preset question open; "not now" prints the command to run later.

- Without a terminal the offer is skipped with "To create an account, run `devaudit scan` in your own terminal."
- Declined, or `--local`: guided install needs a portal project, so it is not offered. You are pointed at the local fixes (`devaudit bootstrap-governance`, `devaudit configure`) and told that onboarding needs an account.
- **Already onboarded** (`sdlc-config.json` names the project): nothing is created. "Save this report to <project>?" uploads with your personal access token (a viewer key is read-only and cannot upload). Without a token it prints "Run `devaudit auth login` to save this report to <project>." and uploads nothing; the next step is `devaudit configure`.
- A portal that does not have a step yet (sign-in or report saving) is reported in one plain line and the rest carries on.

## The suggested preset

The report carries the preset that fits what was found (A, B, C or `custom`; never D, which is offered, not suggested), with its reason. It is the same rule `devaudit install` and `devaudit doctor` use; a scan makes no portal call, so A and B are suggested with the note that they need portal support for a solo approver. See [`presets.md`](./presets.md).
