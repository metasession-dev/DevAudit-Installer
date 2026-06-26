# Your AI Skill Is a Post-It Note, Not a Supervisor

**Long-form parent:** The Fire-and-Forget Skill Problem: Why AI Coding Agents Lose Control of the SDLC
**Platform:** LinkedIn, Dev.to
**Read time:** ~2 minutes

---

You invoke an AI skill to drive a feature through your SDLC. Phase 1: planning. Phase 2: implementation. So far, so good. Then MongoDB won't start.

The skill's instructions don't cover "what to do when MongoDB won't start." So you — the native AI agent — fix it yourself. Port conflict, stale lock, missing binary. Sorted. E2E tests pass. You commit, merge, push.

CI fails. Three missing compliance artifacts. The RTM was never updated. The release ticket was never moved. The portal approval was never verified.

What happened? The skill was a post-it note. It told you what to do, but it couldn't supervise you doing it. Once you hit the MongoDB problem, you went off-script and never came back. The skill had no way to say "hey, re-invoke me when you're done debugging."

## The root cause

AI skills in current IDE platforms (Claude Code, Cursor, Windsurf) are **stateless instruction injections**. When invoked, the skill's markdown is injected into the agent's context. The agent reads it and executes. But the skill has:

- No persistent state — it doesn't track progress
- No execution monitoring — it can't see what you're doing
- No re-invoke triggers — nothing tells you to go back to it
- No environment access — it can't run commands or inspect state

Once the agent hits an environment blocker (MongoDB, Playwright, dev server), it solves the problem directly and continues on its own. The skill is fire-and-forget. The agent has momentum and domain knowledge gaps. Compliance steps get missed.

## The ideal fix

A **command manifest** architecture where the skill is the persistent controller. The skill declares commands it needs run, the native agent executes them and returns output, and the skill decides what to do next. The skill stays in control throughout — it delegates execution, not decision-making.

This requires platform support that doesn't exist yet. No current AI IDE supports skills making sequential command requests to the native agent with results returned to the skill.

## What you can actually do

A belt-and-suspenders approach:

1. **Resume protocol** — the skill's instructions explicitly say "after any environment detour, re-invoke me with `resume REQ-XXX — re-enter at Phase N`." The skill reconstructs state from the filesystem (git log, existing artifacts, RTM status) and continues from where it left off.

2. **Pre-push hooks** — a git hook runs `validate-compliance-artifacts.sh` before allowing a push. Missing `test-scope.md`, `test-plan.md`, `implementation-plan.md`? Push blocked. The hook can't invoke the skill, but it can prevent the consequences of the skill not being invoked.

3. **Phase 5 as an explicit skill step** — post-merge close-out (RTM update, release ticket move, portal verification) is a mandatory skill-driven step, not something the native agent might remember. The boundary section states: "PR merged to main ≠ done."

The prose-level changes work when the skill is invoked and followed. The machine-enforced changes catch the case where it isn't. Together, they cover the gap until platforms support persistent skill controllers.

---

*Read the full article → devaudit.ai/blog/fire-and-forget-skill-problem*

*See the SDLC → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)*
