# Who Can Do What, and With Which Key

> **Scope:** `metasession-dev/DevAudit-Installer` (this repo, public — framework + CLI), `metasession-dev/devaudit` (the portal product, private), and a consumer project running the synced SDLC (e.g. `wawagardenbar-app`).
> **Status:** Internal reference. Verified against DevAudit-Installer at `v0.3.39` — workflow files, CLI source, and live GitHub/npm state, not general GitHub knowledge. Anything that couldn't be verified programmatically is marked as such rather than guessed. Re-check after any change to `.github/workflows/`, `branch-protection-checks.ts`, or the portal's approval logic.

A map of every actor, credential, and gate across this repo's release pipeline — GitHub's permission system and the DevAudit portal's, and the handful of places they touch.

> **Blog publishing fields** — the devaudit.ai blog stores posts as `{slug, title, excerpt, body, tags[], author}`, none of it derived automatically from this file. Paste these into the CMS admin form:
> - **Title:** Who Can Do What, and With Which Key
> - **Slug:** `who-can-do-what-and-with-which-key`
> - **Excerpt:** A map of every actor, credential, and gate across DevAudit-Installer's release pipeline — GitHub's permission system and the DevAudit portal's, and the handful of places they touch.
> - **Author:** Metasession
> - **Tags:** `security`, `ci-cd`, `engineering`
>
> The blog's Markdown renderer is `react-markdown` + `remark-gfm` only — no `rehype-raw` (raw HTML renders as literal text) and no Mermaid plugin. Everything below is written to stay inside those limits: the diagram is a real image, not a fenced `mermaid` block, and there's no raw HTML anywhere in the body. The OG/social image is auto-generated server-side from title + author on a fixed template — there's no hero-image field to fill in.

---

## 1. The actors

Six kinds of identity touch a release. Two never leave GitHub, two never leave the portal, and two — the developer and the AI agent working alongside them — only ever act as one human's identity, on either side.

| Actor | System | What it can do | Credential |
| --- | --- | --- | --- |
| **Developer / operator** | Both | A real human with a GitHub account and a DevAudit account. Pushes code, opens PRs, runs `devaudit install`. The one identity that legitimately holds credentials in both systems. | personal git access · `DEVAUDIT_USER_TOKEN` |
| **AI coding agent** | GitHub-side | Claude Code, Cursor, Windsurf, etc. Has no credential of its own — it acts under the developer's already-authenticated git session. Its contribution is attributed, not authenticated: a `Co-Authored-By` trailer, not a login. | none — rides the developer's own |
| **GitHub Actions bot** | GitHub-side | Shows up as `github-actions[bot]`. Every workflow run gets a fresh `GITHUB_TOKEN`, scoped by that workflow's own `permissions:` block, that expires the moment the job ends. | `GITHUB_TOKEN` (ephemeral, per-run) |
| **PR reviewer** | GitHub-side | A human with write access who approves the pull request itself — the code-review gate. Distinct from and unrelated to the portal's release approval below. | personal git/GitHub access |
| **Release approver** | Portal-side | A human who signs off on the release itself inside the DevAudit portal — a live-behavior gate, not a code-review gate. In `dual_actor` mode, the portal refuses if this is the same person who cut the release. | `DEVAUDIT_USER_TOKEN` (portal login) |
| **Auditor** | Portal-side | Scoped, read-only. Browses evidence by project, requirement, and release. Never has a GitHub identity, never sees source code, secrets, or anything outside their scoped project. | scoped portal login only |

---

## 2. One release, two permission systems

The mechanism worth seeing: a release zig-zags between GitHub's world and the portal's world several times before it ships, and a different credential is doing the work at nearly every step. Every node below carries the credential that authenticates it.

![A tracked requirement moving from first commit through released to close-out, crossing between GitHub and the DevAudit portal four times via DEVAUDIT_API_KEY, with personal git access, GITHUB_TOKEN, branch protection, DEVAUDIT_USER_TOKEN, and INSTALLER_DISPATCH_TOKEN each labeled at the step that uses them; an auditor reads the portal lane independently with a scoped login and never touches GitHub; NPM_TOKEN is shown separately as an unrelated pipeline triggered by version tags](images/permissions-release-flow-diagram.png)

A tracked requirement moving from first commit to `released` and on to close-out. The four cross-boundary hops (down to evidence storage, up to the release gate, down to production evidence, up to close-out) are where a credential from one system authenticates a call into the other — three of them are `DEVAUDIT_API_KEY`; the fourth (the portal flipping to `released` triggering GitHub's close-out automation) is what actually invokes `GITHUB_TOKEN` or `INSTALLER_DISPATCH_TOKEN`. Every other node names the credential doing the work at that step, so nothing in the flow is unlabeled. The auditor, bottom, only ever touches the portal lane. `NPM_TOKEN`, top right, is deliberately drawn disconnected — it belongs to a different pipeline entirely (`release.yml` on a version-tag push), not to any single requirement's promotion.

---

## 3. Every credential, what it's worth if leaked

Ordered roughly by blast radius — what someone could do with it, not how often it's used. **Obtained from** is where the credential is minted; **placed as** is where it actually lives once it's in use.

| Credential | Obtained from | Placed as | Scope / blast radius | Consumed by |
| --- | --- | --- | --- | --- |
| **personal git access** | A human adds an SSH key to their GitHub account, or runs `gh auth login` | Local `~/.ssh/` key or the OS/`gh` credential store — never a repo secret | Whatever that GitHub account's repo role allows — for a write collaborator, every repo they can see. | Every `git push`, every `gh pr` command, in or out of CI |
| **`GITHUB_TOKEN`** | Minted automatically by GitHub Actions — no human ever requests it | Injected as an env var into the running job only; never written anywhere | This one repo only. Exactly what that workflow's own `permissions:` block grants (often just `contents: read`). Dies when the job ends. | Nearly every workflow — CI, linting, the release pipeline |
| **`INSTALLER_DISPATCH_TOKEN`** | A human generates a classic `repo`-scope (or fine-grained Contents+PRs read/write) PAT at github.com/settings/tokens | Pasted into repo **Settings → Secrets and variables → Actions** as `INSTALLER_DISPATCH_TOKEN` | Whatever that PAT is scoped to — this repo, if set up correctly. Exists specifically so a bot-opened PR isn't authored by the bot. | `hotfix-backmerge.yml`; consumer projects' `close-out-release.yml` |
| **`NPM_TOKEN`** | A human generates an access token on npmjs.com (or `npm token create`) | Pasted into repo **Settings → Secrets and variables → Actions** as `NPM_TOKEN` | Publish rights on the 5 `@metasession.co/*` packages. Nothing else. | `release.yml` only, on tag push |
| **`DEVAUDIT_USER_TOKEN`** — `mctok_…`, a PAT | A human issues it at devaudit.ai/settings/tokens | Exported locally (`export DEVAUDIT_USER_TOKEN=…`) for CLI use, **and** written as a repo secret by `devaudit install` itself | Carries the operator's full portal identity. Project creation, API-key issuance, and every audit-log entry it touches attribute to this person by name. | `devaudit install`/`join`, release approvals, portal login |
| **`DEVAUDIT_API_KEY`** | Minted automatically by the portal during `devaudit install`, authenticated via the operator's `DEVAUDIT_USER_TOKEN` — not requested directly by a human | Written as a repo secret by `devaudit install` itself, as `DEVAUDIT_API_KEY` | **One project.** A compromised key can upload junk evidence or poll status for that project — it cannot touch any other project on the portal. | Every generated CI workflow that uploads evidence or checks release status |

---

## 4. GitHub's side: repo roles, branch protection, and a quirk worth knowing

### Repo collaborator role

Read / write / admin, set in GitHub's own org and repo settings — outside anything DevAudit touches. This is the coarsest gate: it decides who can push at all, who can edit secrets, and who can change branch protection itself.

### Branch protection — what's actually configured

| Repo | Branch | Required reviews | Required status checks |
| --- | --- | --- | --- |
| Consumer project | `main` | 1 | `Quality Gates` |
| Consumer project | `develop` | 0 | `Quality Gates` |
| DevAudit-Installer | `main` | not readable via API | `enforce-gitflow`, `CodeQL` ×2, `Test` ×3 OS |
| DevAudit-Installer | `develop` | not readable via API | same set, plus template-lint checks on relevant PRs |

Consumer-project rows are set by `devaudit install`, via `cli/src/install/branch-protection.ts`. DevAudit-Installer's own rows (this repo) are configured directly in GitHub, not by the CLI.

Note on the two *not readable via API* cells: GitHub's branch-protection endpoint only answers for tokens with admin rights on the repo. I could confirm — empirically, by opening real PRs — that both branches are PR-only and gated on the checks listed; I could not confirm the exact configured reviewer count without admin API access, so it's left honest rather than guessed.

### Quality Gates, unpacked

The single required check named `Quality Gates` is one job that runs several real gates as steps: lint, typecheck, SAST, dependency audit, and E2E. GitHub only sees the one job name — the individual gates live inside it. A separate `ci-status-fallback.yml` emits the same `Quality Gates` status for docs-only commits, so branch protection is satisfied without re-running the heavy gates on a change that couldn't have broken them.

### The `action_required` quirk

> **Why INSTALLER_DISPATCH_TOKEN exists at all**
>
> GitHub won't let a workflow run using the default `GITHUB_TOKEN` auto-approve its own required checks on a PR it just opened — that PR sits at `action_required` until a human clicks "Approve and run", once, on GitHub. It's a built-in anti-abuse measure, not a bug. Authoring the PR as a real account's PAT instead (`INSTALLER_DISPATCH_TOKEN`) sidesteps it entirely, because the PR is then a normal human-authored PR as far as GitHub's own rule is concerned.

---

## 5. The portal's side: a separate system, on purpose

Nothing here is a GitHub permission. The portal has its own accounts, its own roles, and its own approval logic — enforced server-side, not by convention.

### Approval modes

| Mode | What it enforces | Where it shows up |
| --- | --- | --- |
| `dual_actor` | Server-side check: `approver_user_id != release_creator_user_id`. The same person cannot cut and approve a release. | Recommended default; used by the `wgb` project |
| `auto_low_risk` | LOW-risk requirements auto-approve once CI evidence is complete. MEDIUM/HIGH still require a human. | Teams that want ceremony proportional to risk |
| `solo_with_gap` | For genuinely solo developers. Doesn't fake a second reviewer — instead it *refuses to approve* until an explicit risk-register entry documents the control gap, so an auditor sees an acknowledged gap, not a silent bypass. | Solo projects, by design a visible trade-off |

### Auditor access

A scoped, read-only account, created per auditor per engagement. Sees the release-completeness matrix, the evidence-by-requirement drill-down, and the upload timeline. Does not see: source code, CI secrets, developer chat, or anything outside the projects they're scoped to. There's no GitHub identity underneath it at all — an auditor account can exist without the person ever touching this repo.

---

## 6. What's actually enforced, versus what the docs imply

Worth stating plainly, because it's easy to over-claim: today, exactly two human gates are mechanically enforced anywhere in this pipeline. Everything else is process, not a lock.

> **The two real gates**
>
> **Stage 4 — `main` branch review.** GitHub branch protection, 1 required reviewer, enforced by GitHub itself.
>
> **Stage 3 — `dual_actor` portal approval.** Server-side `approver_user_id != release_creator_user_id` check, enforced by the portal.

Playbook language elsewhere about an "independent reviewer" at Stage 2 (feature branch → `develop`) describes a practice, not a control — nothing in this installer or any generated CI template currently blocks a self-merge there. That's a known, tracked gap (see `docs/issues/stage2-independent-review-not-enforced.md`), not an oversight in this reference.

---

## 7. Worked example: one requirement, start to finish

The same sequence as the diagram above, spelled out — this is what actually happened for a real HIGH-risk requirement on `wgb`.

1. **Developer + AI agent commit and push** — Claude Code implements the requirement; commits carry `Co-Authored-By: Claude Sonnet 5`. No separate AI credential — it's the developer's own git session. *(GitHub · personal git access)*
2. **CI runs Quality Gates** — lint, typecheck, SAST, dependency audit, E2E — one job, one required status check. *(GitHub · `GITHUB_TOKEN`)*
3. **CI uploads evidence to the portal** — screenshots, test reports, SAST results — pushed to the one project this key belongs to. *(Portal · `DEVAUDIT_API_KEY`)*
4. **A different human reviews and approves in the portal** — `dual_actor` mode rejects the click if this is the same person who cut the release. *(Portal · `DEVAUDIT_USER_TOKEN`)*
5. **The Release Approval Gate unblocks the PR** — polls the portal for release status; only passes once it reads `uat_approved` or later. *(GitHub · `DEVAUDIT_API_KEY`)*
6. **PR merges** — branch protection's own gate: 1 required review, plus the green Quality Gates check. *(GitHub · branch protection)*
7. **Post-deploy smoke test runs and uploads its own evidence** — confirms production is healthy; the result becomes the evidence for the final approval. *(GitHub · `GITHUB_TOKEN` + `DEVAUDIT_API_KEY`)*
8. **Production approval, in the portal** — status flips to `released`. This is the terminal state the close-out workflow watches for. *(Portal · `DEVAUDIT_USER_TOKEN`)*
9. **Close-out PR opens and auto-merges** — if `INSTALLER_DISPATCH_TOKEN` is set, this happens unattended. If not, it sits at `action_required` until someone clicks approve once. *(GitHub · `GITHUB_TOKEN` or `INSTALLER_DISPATCH_TOKEN`)*
10. **Anytime: an auditor reviews the same evidence** — out of band, on their own schedule. Never touches GitHub — the portal is the entire interface. *(Portal only · scoped read-only login)*
