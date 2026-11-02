# DevAudit: brief for the compliance reader

**Purpose:** four short questions to answer before DevAudit's next release is published. Nothing here asks you to certify anything. The wording below is shown to users in the command line tool, on the public website and in the portal, so we want a compliance professional to confirm it is fair and not an overclaim.

**What DevAudit is, in one paragraph.** DevAudit is an open-source software-delivery framework (Apache-2.0) and a paid evidence portal. A project's release process produces records: who approved a release, which tests ran, what risks were accepted. DevAudit maps those records to clauses of SOC 2, ISO/IEC 27001, ISO/IEC/IEEE 29119, GDPR and the EU AI Act, and shows which clauses a project has evidence for. It measures **evidence readiness, not compliance**: it never says a project is "compliant" or "certified", and an unprovable clause is shown as "unknown", never "missing". The auditor decides what the evidence means.

**What the clause list is.** A public file per standard (`contracts/frameworks/*.json`, registry version 2026-10-30). Each clause has an ID, a short published title, DevAudit's own description of the evidence that supports it, and a rule the software can check. It does not reproduce any standard's text.

---

## Question 1: which 2022 control does `ISO27001.A.12.1` map to?

DevAudit uses the ID `ISO27001.A.12.1` ("Operational procedures and responsibilities"), which is a **2013-edition** control number, in a file whose edition is ISO/IEC 27001:2022. We kept the ID because it is already in documents projects have, and renumbering would change them. The clause carries the note: *"ID from the 2013 edition; 2022 equivalent to be confirmed by the compliance reader."*

What the clause counts as evidence:
- the file `Periodic_Security_Review_Schedule.md` is on file and was refreshed within the last year;
- the most recent execution of a procedure review is on file (a quarterly review record), and a review older than a year is shown as expired.

**Which 2022 controls, if any, does that evidence support?** Our shortlist:

| 2022 control | Title | Fits? |
| --- | --- | --- |
| A.5.37 | Documented operating procedures | ☐ yes ☐ no |
| A.5.35 | Independent review of information security | ☐ yes ☐ no |
| A.5.36 | Compliance with policies, rules and standards | ☐ yes ☐ no |
| none | the evidence does not map to a 2022 control | ☐ |

Your answer becomes a list of 2022 equivalents on the clause, or we leave the note as it is.

---

## Question 2: is this wording acceptable?

For each string, tick "fine" or write the replacement.

**Edition notes**
- SOC 2: "AICPA TSC 2017"  ☐ fine ☐ replace with: ________
- ISO 27001: "ISO/IEC 27001:2022"  ☐ fine ☐ replace with: ________

**`SOC2.CC8.1` (Change management, segregation of duties)**
> Met by a release approval made by someone other than the release's creator or submitter. A release approved by its own creator or submitter, where the project's approval policy allows it with a recorded gap, is recorded as a self-approval instead and is shown as a gap.

☐ fine ☐ replace with: ________

**`ISO27001.A.8.32` (Change management)**
> Met by a release approval made by someone other than the release's creator or submitter, with the reviewer recorded. A self-approved release is recorded as a self-approval instead and is shown as a gap.

☐ fine ☐ replace with: ________

**The gap shown for a project whose author approves their own releases (presets A and B)**
> You approve your own releases. DevAudit records this as a control gap for SOC 2 CC8.1 and ISO 27001 A.8.32; an auditor will ask for a compensating control.

☐ fine ☐ replace with: ________

**The gap shown for a team preset where a different person approves (preset C)**
> A passing test pack does not prove the right tests exist (`devaudit doctor` reports acceptance-criteria coverage), and how long evidence is kept is a portal setting.

☐ fine ☐ replace with: ________

**The gap shown for the preset that runs the full regression once, before merge (preset D)**
> The full regression runs once, before merge. DevAudit does not run it again after the deploy, so a problem that appears only in the deployed environment is found by production evidence and the quarterly review, not by the full pack.

☐ fine ☐ replace with: ________

**What each setup says it produces and what gap it carries** (shown to the person choosing a setup)

| Setup | Evidence produced | Gap carried |
| --- | --- | --- |
| A, solo, fast feedback | an approval record per release; smoke and feature test results per change; a quarterly review | no segregation of duties; no full-regression evidence; no human production confirmation |
| B, safety net | A, plus critical-test results before every release, full-regression results per deploy and per night, and a human production confirmation | no segregation of duties; the full regression detects problems after release rather than preventing them |
| C, team with a compliance lead | the approver differs from the creator (enforced); a full green regression attached before approval; two human production events; a continuous history | evidence retention is a portal setting; a passing test pack does not prove the right tests exist |
| D, the same team, full pack run once before merge | as C, without the full regression recorded after the deploy | as C, and the full pack is not run again after the deploy |

☐ fine ☐ comments: ________

---

## Question 3: is our reading of change-management fair?

We decided that `SOC2.CC8.1` and `ISO27001.A.8.32` are met **only** by a release approval from someone other than the release's creator or submitter. The portal records an independent approval as one kind of event and a self-approval as another, and the two clauses count only the first. So a project where the author approves their own release shows both clauses as **not covered** (a recorded gap), and a project where a different person approves shows them as covered. Earlier approvals on the portal were labelled the same way by a one-off backfill, and those events are marked as backfilled.

**Is that a fair and defensible reading of change-management segregation of duties?**  ☐ yes ☐ yes, with this change: ________ ☐ no, because: ________

---

## Question 4: no copyrighted text

The registry holds **clause IDs, short published titles and DevAudit's own descriptions**, published under Apache-2.0. It does not quote or paraphrase closely any standard's body text.

**Do you confirm the registry reproduces no standard's copyrighted text?**  ☐ yes ☐ no, these entries should change: ________

---

## What happens with your answers

They become small text edits in the clause files and the setup descriptions, made before the release is published. Nothing else in the product depends on them. If you would like to see the files, they are public: `contracts/frameworks/soc-2.json` and `iso-27001.json`, and the setup wording in `core/src/presets.ts`, in the DevAudit-Installer repository on GitHub.

Reader: ______________________  Date: ____________  Role / organisation: ______________________
