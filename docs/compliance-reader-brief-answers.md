# Answers to the compliance reader brief

**Status:** prepared answers, not an independent review. They come from reading what DevAudit does and how, in the code of this repository and of the portal, and from general knowledge of the standards. They are a considered starting position for the maintainer. They are not a substitute for a qualified, independent compliance reader, and they are not legal advice. Where the right answer depends on a professional judgement or on law, the answer says so.

Questions: [`compliance-reader-brief.md`](./compliance-reader-brief.md).

## What DevAudit does, as far as these questions need it

A project's release process leaves records: the plan, the tests that ran, the risks accepted, who approved a release. DevAudit checks, per clause, whether the records a clause looks for exist, and shows the result as **evidence readiness**. It does not decide compliance. The checks are public data (`contracts/frameworks/*.json`), so a reader can see exactly what each clause looks for.

Two facts decide the answers below:

1. **Approval independence is decided in the portal, by comparing the approver with the release's creator and its submitter** (`lib/approvals/is-self-approval.ts` in the portal). It does not compare the approver with whoever wrote the code. For a release created by CI, the creator is in practice the identity behind the CI key.
2. **The evidence for `ISO27001.A.12.1` is a periodic review schedule and a quarterly review record**, not operating procedures, change management, capacity or environment separation (the periodic review workflow describes it as the periodic review of controls and procedures).

## Question 1: `ISO27001.A.12.1` in the 2022 edition

**Answer: map it to `A.5.36` only.** Do not map it to `A.5.35` or `A.5.37`.

- The 2013 control A.12.1 had four parts, which the 2022 edition split up: documented operating procedures (now A.5.37), change management (A.8.32), capacity management (A.8.6) and separation of development, test and operational environments (A.8.31). The evidence this clause checks matches none of those four.
- What it checks is that a schedule of periodic reviews exists and that a review was done within the last year. That is the shape of **A.5.36, compliance with policies, rules and standards**, which looks for regular reviews.
- **A.5.35** (independent review of information security) needs the review to be independent of the people being reviewed. The quarterly review is run by the team itself, and DevAudit does not evidence independence. Mapping it would overclaim.
- **A.5.37** is about operating procedures for running systems. A schedule of reviews is a documented procedure, but not that kind. Leave it out.

**Also change the clause's title, not only its note.** "Operational procedures and responsibilities" is the whole of the 2013 control, and the evidence covers a small slice of it. Keep the ID (it is stable and in documents projects already have) and say what is evidenced. Suggested note: *"ID from the 2013 edition. The evidence here (a periodic review schedule and a quarterly review) supports ISO/IEC 27001:2022 A.5.36. It does not evidence the 2013 control's operating procedures, change management, capacity or environment separation; change management is covered by A.8.32."*

## Question 2: the wording

| String | Verdict | Replace with |
| --- | --- | --- |
| SOC 2 edition note, "AICPA TSC 2017" | Fine, but incomplete | "AICPA Trust Services Criteria (2017, revised points of focus 2022)" |
| ISO 27001 edition note, "ISO/IEC 27001:2022" | Fine | no change |
| `SOC2.CC8.1` description | **Change** | "Evidence of independent approval of a change: a release approval made by someone other than the release's creator or submitter. A release approved by its own creator or submitter (allowed only where the project's approval policy permits it, with a recorded gap) is recorded as a self-approval and shown as a gap." |
| `ISO27001.A.8.32` description | **Change** | "Evidence of independent approval of a change: a release approval made by someone other than the release's creator or submitter, with the reviewer recorded. A self-approved release is recorded as a self-approval and shown as a gap." |
| Gap, presets A and B | **Change** | "You approve your own releases. DevAudit records this as a gap in the evidence for SOC 2 CC8.1 and ISO 27001 A.8.32; an auditor may ask what compensating control you have." |
| Gap, preset C | Fine | no change |
| Gap, preset D | **Change** | "The full regression runs once, before merge, and not again after the deploy. A problem that appears only in the deployed environment can be caught only by the post-deploy production smoke check and the quarterly review, not by the full pack." |
| Setup evidence table | Fine | one word: say "enforced by the portal" for "the approver differs from the creator" |

**Why the changes**

- **"Met by" is the wrong word.** DevAudit says it measures evidence readiness and never compliance. A clause description that says a clause is "met" says the opposite. It is also too strong on its own terms: CC8.1 is about authorising, designing, testing, approving and implementing changes, and an independent approval is one piece of evidence for it, not all of it.
- **"control gap" and "an auditor will ask".** A control gap is a conclusion an auditor reaches after testing; DevAudit records a gap in its own evidence. "Will ask" predicts what an auditor does. "May ask what compensating control you have" is accurate.
- **Preset D: "found by production evidence".** Production evidence here is a read-only smoke check and a health probe. It does not find most problems, and DevAudit is not a monitoring product. The replacement says what it can actually catch.

**One more string, not in the brief, that needs the same attention.** When a team chooses "a different person approves", the guided install tells the user: *"No control gap from these choices: the approver differs from the author."* Two problems: it says "author" when the check compares with the release's creator and submitter, and "No control gap" can be read as a clean bill of health. Suggested: *"The approver differs from the person who created or submitted the release, so DevAudit records no gap for SOC 2 CC8.1 and ISO 27001 A.8.32. `devaudit doctor` checks the rest."* The matching message for a solo approver who needs SOC 2 or ISO 27001 says the two clauses "show as not covered"; say "show as gaps in the evidence".

## Question 3: is the change-management reading fair?

**Answer: yes, as a rule for what counts as evidence, with two conditions.**

- It is the usual expectation that the person approving a change is not the person who made it, and the usual treatment where a small team cannot staff that is a compensating control, not an automatic failure. DevAudit models that: a self-approval is a recorded gap and asks for a compensating control. It does not say the project fails.
- **Condition 1: say what is compared.** The rule compares the approver with the release's creator and submitter. A second person who submits a release can let the person who wrote the code approve it. The descriptions are accurate, but the clause title "(segregation of duties)" and the phrase "the approver differs from the author" suggest more. Use the wording in Question 2 and do not use "author". Consider comparing the approver with the change's commit or pull-request authors in a later version. Presets C and D already require one GitHub review on the release pull request, and GitHub does not let a pull request be approved by its author, which covers part of this.
- **Condition 2: show it as a gap, not as "not covered".** For a solo developer, segregation is impossible by construction. "Not covered" reads like a failure. "Gap (self-approved)" with the compensating-control prompt describes the situation and is what the product already intends.

## Question 4: no copyrighted text

**Answer: yes for the content, with one request and one limit.**

- **Checked in the files:** no description is longer than 300 characters, none contains a quotation, and each is written as what DevAudit needs to see, not as what a standard says. Titles are short control names with a few DevAudit parentheticals (for example "Change management (segregation of duties)"), which are DevAudit's own and should read as such.
- **The EU AI Act and the GDPR** are EU law and can be cited freely.
- **Request:** add a short notice to `docs/framework-registry.md`: the standards named are the property of their publishers, DevAudit is not affiliated with or endorsed by ISO, IEC, IEEE, the AICPA or the EU, and clause IDs and short titles are used only to identify the clause.
- **Limit:** whether the short control titles and clause numbers of ISO and AICPA publications are protected is a legal question that I cannot settle. Many vendors list them, but ISO and the AICPA do claim copyright in their publications. A lawyer or the compliance reader should confirm before the registry is published at scale.

## What would change in the repository if these answers are accepted

- `contracts/frameworks/soc-2.json`, `iso-27001.json`: the edition note, the two descriptions, and the `ISO27001.A.12.1` title, note and `equivalents2022`.
- `core/src/presets.ts`: the gap text for presets A, B and D.
- `cli/src/install/guided.ts`: the two compliance-line strings.
- `docs/framework-registry.md`: the notice.
- Tests and the portal's copy of the registry follow through the registry dispatch.
