# One Process, Many Shapes: How DevAudit's SDLC Bends to Your Team, and What It Refuses to Bend

![Four adjustable settings (who approves, what blocks, where it runs, which standards) around a fixed audit shape that does not change, with four presets along the bottom](images/configurable-sdlc-hero.png)

> **Primary persona:** CTO + Lead Developer
> **Funnel stage:** MOFU — Consideration
> **Format:** Technical explainer (~2300 words)
> **Secondary persona callout:** Compliance officer — see "What does not bend"
> **Cross-links:** [/sdlc](https://devaudit.ai/sdlc) · [/onboarding](https://devaudit.ai/onboarding) · [docs/presets.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/presets.md) · [docs/configure.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/configure.md) · [docs/consuming-projects.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/consuming-projects.md) · [docs/doctor.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/doctor.md)

---

A solo developer shipping a product on their own and a team with a compliance lead are not the same team. Give both the same SDLC and one of two things happens. The solo developer routes around the ceremony, and the process stops existing. Or the regulated team inherits a process built for one person, and it fails the first audit.

DevAudit's answer is to make the process configurable, and to be strict about which parts. This article covers what you can change, why that is needed, how to change it safely, what stays fixed, how we check that a configuration actually works, and where the limits are.

## Why one fixed process fails

Real teams differ in four ways that matter to an SDLC.

- **Who approves a release.** A solo developer cannot have a second approver. A team that needs SOC 2 or ISO 27001 evidence has to have one, because those standards look for a release to be approved by someone other than the person who created it.
- **How fast feedback has to be.** A full end-to-end suite can take close to an hour. Some teams will wait for it before every merge. Others need a fast gate and a wider check afterwards.
- **Where and how it deploys.** Different hosts, different languages, different CI runners.
- **Which standards you have to evidence.** One customer asks for SOC 2, another for GDPR or the EU AI Act.

Hard-code any one answer and the process is wrong for somebody. Leave every answer open and you cannot say what a release actually went through, which is the opposite of an audit trail. So DevAudit makes the answers settings, writes them down in a file that lives in your repository, and keeps the shape of the evidence the same whatever you choose.

## What you can configure

The settings live in `sdlc-config.json`, committed with your code. `devaudit configure` reads and changes 56 of them, each with a type, allowed values and validation. Most are plumbing, such as a Node version or a port. The ones that change how the SDLC behaves fall into six groups.

| Decision | What you choose | Settings |
| --- | --- | --- |
| **Who approves a release** | The author, with the gap recorded, or a different person | `approval.mode` (`dual_actor`, `solo_with_gap`), `release_branch_required_reviews`, `production_review.terminal_status` |
| **What blocks a release** | Which test tier gates the release pull request, whether the full pack also runs after deploy, whether it runs nightly | `release_gate_tier` (`none`, `smoke`, `critical`, `full`), `post_deploy_full_regression`, `scheduled_full_regression`, `e2e_regression_enabled`, `test_tier_smoke`, `test_tier_critical`, `test_tier_full`, `test_runner` |
| **Where it runs** | The deploy host and how a deploy is triggered and read back, the CI runner, the branches | `host`, `deploy_command`, `deploy_trigger`, `deployed_sha_url`, `production_url_secret`, `runner`, `integration_branch`, `release_branch` |
| **How much ceremony per change** | Whether the human UAT pack is written for a requirement: by risk, always, or never | `uat.human_pack` (`risk`, `always`, `never`) |
| **Which standards you evidence** | SOC 2, ISO 27001, ISO 29119, GDPR, EU AI Act | `compliance_frameworks` |
| **Where the tests get their data** | A fresh database per run, a shared environment used only by the tests, or a shared one other people use | `e2e_data_isolation`, `e2e_seed_paths`, `e2e_reset_command`, `e2e_preflight_command`, `e2e_leak_check_command` |

The risk class of each requirement then sets how much of the process applies to it. A MEDIUM or HIGH requirement needs an implementation plan in its evidence, and by default the UAT pack too. A HIGH or CRITICAL plan is approved by a person before any code is written.

The stack is chosen at install: Node or Python.

## Start from a preset

Most teams should not pick 56 settings. A preset is a bundle of settings chosen together, and `devaudit install` and `devaudit configure` offer the ones that fit your repository.

| Preset | For | Before a merge to the release branch | Who approves |
| --- | --- | --- | --- |
| **A** Solo, fast feedback | One developer who approves their own releases | No regression gate; approval only | The author, gap recorded |
| **B** Safety net | A solo developer or small team that wants the important journeys tested | The critical tests block | The author, gap recorded |
| **C** Team with a compliance lead | A team where someone other than the author approves | The full tests block | A different person |
| **D** Full gate, tested once | The same team as C, with the full pack run once, before merge | The full tests block | A different person |

`custom` is always offered, for when none fits. Which preset is suggested follows one rule shared by `devaudit scan`, `install` and `doctor`: no smoke tests found suggests A, a need for SOC 2 or ISO 27001 with a full pack suggests C, and so on. Preset D is never suggested. It is chosen on purpose.

Every preset answers the same five moments: a feature pull request opens, work merges to the integration branch, a release pull request opens, the release is approved and deployed, and a timer fires.

Look at the "who approves" column. Presets A and B let the author approve their own release. DevAudit does not hide that. It records the control gap against the clauses that look for independent approval, SOC 2 CC8.1 and ISO 27001 A.8.32, and the agent will not hand a release over for approval until a control-gap entry is in the risk register and the release ticket carries a "solo, recorded gap" sign-off. An auditor is shown the gap instead of left to find it. A weaker setting records itself.

## How to change it: a ladder

There are four ways to change the SDLC, and they are ordered. Use the first one that does the job.

**1. Pick or switch a preset.** `devaudit configure` with no arguments asks the guided questions with your current answers, shows a before and after summary, and writes only what changed.

**2. Set one key.** `devaudit configure set` validates the value, shows what the next `devaudit update` will regenerate, and with `--dry-run` writes nothing.

```bash
devaudit configure list                          # every key, with its current value
devaudit configure set approval.mode dual_actor
devaudit configure set release_gate_tier full
devaudit configure set uat.human_pack never --dry-run
devaudit update                                  # regenerate the workflows
```

A change that your repository's own evidence contradicts needs a confirmation or a recorded `--reason`. The test-gate settings default to today's behaviour, so a project that sets none of them gets the workflows it already had.

**3. Carry a local change.** If a generated file needs something no setting offers, you have two options. A hand-edit is never overwritten: `devaudit update` leaves your file alone, writes the new framework version beside it as `<file>.devaudit-new`, and records a conflict for you to review. For a change you want to keep across updates, a patch in `.devaudit-patches/` is re-applied after each sync. Each patch is expected to carry a companion `.patch.json` naming the upstream issue it bridges, and the sync warns about one that does not, which keeps a patch what it should be: a temporary bridge, not a quiet fork.

**4. Extend it.** Hosts are adapters: manifests validated against a schema, with Railway and Vercel shipped. The `custom` host takes your own deploy command, trigger and way of reading the deployed commit. Plugins hook nine points in the CLI's lifecycle (before and after install, update, push and sync, plus `onDoctor`). The AI skills that drive the workflow follow an authoring contract, so a team can add its own.

### An illustrative path

A two-person team starts on preset B: critical tests gate the release, and the author approves. A customer asks for SOC 2. The team runs `devaudit configure`, moves to preset C, and sets `approval.mode` to `dual_actor`. `devaudit doctor` then checks that the move is coherent. Its `standards-fit` check no longer reports the self-approval gap, and its `approval-policy` check compares the repository's setting with the portal's, which for a different approver needs a second portal admin. The change is a configuration diff in a pull request, with a reviewer and a date, not a migration.

## What does not bend

Configurable does not mean negotiable. These hold for every preset and every combination of settings:

- **The approval gate on the release pull request is always on.** You choose who approves, never whether anyone does.
- **Smoke tests run and block** on feature pull requests and on the integration branch, through the required `Quality Gates` check.
- **Production evidence is collected** after the deploy, and the quarterly review runs.
- **The shape of the evidence is a shared contract.** 37 evidence types, two release shapes (tracked and housekeeping) and the clause mapping for five standards are the same for every project, however it is configured. The configuration decides which gates run and who approves. It does not change what an evidence record means.
- **A failed gate is always a recorded decision**: fix it, accept it with an owner and a review date, or defer the release. Nothing is accepted by default.

**For the compliance officer.** This is the point of the design: "the framework adapts; the audit shape doesn't". Two projects with very different settings produce evidence an auditor can read the same way, and the difference between them, such as a recorded self-approval gap, is stated in the evidence, not discovered afterwards.

## How we know a configuration works

A configurable process is only worth having if a wrong configuration is hard to reach and a right one is checked. There are five layers.

**1. On write.** Eleven validators refuse a value that cannot work: a schedule that is not a five-field cron, an integration branch that equals the release branch, a test tier that selects no tests, a host with no adapter, a secret name GitHub would reject, a folder that does not exist, and so on. A test fails if any setting is neither asked by an onboarding question nor explicitly declared as not asked, and `docs/presets.md` is generated from the preset data, with a test that fails when the two differ.

**2. At rest.** `devaudit doctor` compares the configuration with reality and reports, without gating anything and without applying a fix silently. `preset-drift` notices a project hand-edited away from its preset. `standards-fit` flags SOC 2 or ISO 27001 combined with self-approval. `approval-policy` compares the repository with the portal. `test-tiers` checks that each tier resolves to real tests and which acceptance criteria have a test. `stage3-evidence` warns about pending sign-offs and a missing UAT pack before the release pull request fails on them. `devaudit doctor --explain <check>` says why each matters.

**3. In the generated files.** The workflows DevAudit generates have to parse as YAML, stay under GitHub's size limit for a `run:` block, and pass a shell syntax check. The logic that decides which requirements an upload may name is run end to end against fixtures with the real scripts, not only read as text.

**4. Before every release, against real shapes.** The release gate runs the candidate version against its own checks, against clean Node and Python fixtures with no prior sync, and against isolated clones of real consumer repositories. Those clones are read-only by construction: the push URL is made invalid, the `gh` command is a stub that records and refuses writes, and portal credentials are removed. A change-driven layer maps what changed since the last tag to the surfaces it touches. Running `update` twice must change nothing the second time. The 1.13.0 run covered seven consumer repositories and both fixtures, and it found a real defect before release: `devaudit doctor --json` was cut off at 64 KiB when piped, on a repository with 22 pending release tickets. The clean fixtures had not shown it. It was fixed, the gate was run again, and the final run had no failures.

**5. On every sync.** Each file DevAudit writes is recorded with a hash in a manifest, which is how a local edit is detected and preserved, not overwritten.

## Why this is a good way to work

- **Start light, tighten later.** Moving from a solo preset to a team preset is a setting change reviewed in a pull request, not a re-platform.
- **Honest gaps.** A weaker configuration shows up as a recorded gap, which an auditor can weigh, and not as something found later.
- **Comparable evidence.** Projects with different settings still produce the same kinds of record.
- **Safe upgrades.** Defaults keep today's behaviour, the test-gate settings are never moved for you, and your edits survive an update.
- **One place to look.** The answer to "what process does this project follow?" is a file in the repository, with its history.

## Where the limits are

DevAudit produces evidence; the auditor decides. Configurable does not mean you can configure away the independence a standard asks for: you can choose self-approval, and DevAudit will record what that costs. Two stacks (Node and Python) and three host choices (Railway, Vercel, or a custom deploy command) ship today. Adding a new stack is adapter and template work, not a setting.

That is the same idea behind the whole framework: compliance as a byproduct, not a project. A process you can fit to your team, with the proof of what it did kept in the repository, is also the evidence that you followed it.

*DevAudit is in soft launch. The framework and CLI are open source; if you spot a gap in how any of this is documented, open an issue.*

**CTA:** Try it on your own repository and pick a preset → [devaudit.ai/onboarding](https://devaudit.ai/onboarding) · `npx @metasession.co/devaudit-cli install`
