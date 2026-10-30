# The open framework registry

Which compliance clauses DevAudit can show evidence for, and what the evidence has to be, is published here as data: `contracts/frameworks/`. It covers SOC 2, ISO 27001, ISO/IEC/IEEE 29119, GDPR and the EU AI Act. The DevAudit portal, `devaudit scan` and `devaudit doctor` read the same files, so a clause reads the same everywhere, and anyone (an auditor, a prospective customer, a contributor) can see what a clause expects without access to the portal.

DevAudit helps teams implement and demonstrate controls consistently. The registry says what evidence a clause looks for; it does not say a project is compliant, and nothing in it reproduces the text of a standard.

## Licence

The files are public, in this repository and in the npm package (`@metasession.co/devaudit-cli`, folder `frameworks/`), under the repository's Apache-2.0 licence (see `LICENSE`). A contribution is licensed under Apache-2.0 too: see "Licensing of contributions" in `CONTRIBUTING.md`.

## Format

One file per framework, `contracts/frameworks/<code>.json`, checked against `contracts/frameworks/schema.json`:

| Field | Meaning |
| --- | --- |
| `registryVersion` | The date (`YYYY-MM-DD`) of the last change to the file |
| `transcribedFrom` | Where the content was last transcribed from, for provenance |
| `code`, `name`, `longName` | The framework code used in `compliance_frameworks` (`soc-2`, `iso-27001`, `iso-29119`, `gdpr`, `eu-ai-act`) and its names |
| `edition` | **Required.** The edition the clause IDs come from, for example `ISO/IEC 27001:2022` or `AICPA TSC 2017` |
| `clauses[]` | The clauses |

A clause has `id`, `title` (the short published control title only) and `expects[]`, plus these optional fields:

- `idEdition`: the edition the ID comes from, only when it differs from the framework's `edition`. For example `ISO27001.A.12.1` is an ID from the 2013 edition of ISO 27001.
- `note`: one sentence. **Required whenever `idEdition` is present.**
- `equivalents2022`: an array of clause IDs from the framework's own edition that replace this one. Empty or absent until the compliance reader answers; nobody guesses it.

Each entry of `expects` has a `kind`:

| `kind` | Satisfied by |
| --- | --- |
| `evidence_type_any` | Evidence of any of the listed `types` (each is in `contracts/evidence-types.json`), optionally refreshed within `freshnessDays` |
| `evidence_filename_any` | A document with one of the listed `fileNames` in the compliance documents, optionally refreshed within `freshnessDays` |
| `audit_event_any` | An audit event of one of the listed `eventTypes` (for example `release.independently_approved` for the change-management clauses `SOC2.CC8.1` and `ISO27001.A.8.32`) |
| `requirement_meta` | A property of the requirement, for example that every high-risk requirement has a plan |
| `portal_invariant` | A control that is part of how the portal works |
| `any_of` | Any one of the listed `expectations` |

Descriptions are DevAudit's own words and say what a control needs ("an audit log entry for each approval, naming the approver"), not how the portal stores it. A test fails on backtick-quoted `*.ts` file names, `compliance_` table names and `/api/` paths in any registry file.

## Contributing

A clause change changes what DevAudit tells people about their compliance, so it is **HIGH risk** under the SDLC: open an issue first, explain the standard's wording you rely on in your own words, and expect a compliance review before it merges. Run `npx vitest run test/framework-registry.test.ts` from `cli/` before opening the pull request.

When a file under `contracts/frameworks/` changes on `develop`, the workflow `framework-registry-dispatch.yml` sends the repository dispatch `framework-registry-updated` with `{ sha, registryVersion }` to the portal repository, so the portal can refresh its copy. It needs the `DEVAUDIT_INSTALLER_REGISTRY_DISPATCH` secret and says so, and succeeds, when it is not set.
