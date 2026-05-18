# Bootstrap Reference

Detailed guidance for setting up an e2e suite from scratch. Read this when Phase 1b of `SKILL.md` is in play.

## Contents
1. Framework selection matrix (by tech stack)
2. Visual regression tool selection
3. Official installer commands
4. Best-practice configuration
5. Directory structure templates
6. CI snippets
7. Anti-patterns to avoid

---

## 1. Framework selection matrix

Recommend a primary, mention the runner-up, get user confirmation before installing. These recommendations reflect current best practice for new projects; if the team has a strong preference, follow it.

### Web apps — JavaScript / TypeScript

| Stack | Primary | Runner-up | Rationale |
|---|---|---|---|
| React / Next.js / Remix | **Playwright** | Cypress | Fast, parallel by default, multi-browser, first-party TS, built-in visual regression, excellent trace viewer. |
| Vue / Nuxt | **Playwright** | Cypress | Same reasons. |
| Angular | **Playwright** | Cypress | Playwright has overtaken Cypress as the Angular community default; Cypress still common in established Angular shops. |
| Svelte / SvelteKit | **Playwright** | — | SvelteKit's official template ships Playwright. |
| Static sites / SSG | **Playwright** | Cypress | Either works; Playwright is simpler to set up. |
| Legacy multi-browser-grid needs | **WebdriverIO** | Selenium | Needed when integrating with existing Sauce Labs / BrowserStack grids or non-Chromium-family browsers beyond what Playwright covers. |
| Anything requiring real IE11 (rare) | **Selenium** | — | Only Selenium still targets IE. |

### Mobile

| Stack | Primary | Runner-up | Rationale |
|---|---|---|---|
| React Native | **Detox** | Appium | Native, fast, integrates with RN test infra. |
| Native iOS / Android cross-platform | **Appium** | Maestro | Industry standard; Maestro is gaining popularity for simpler flows. |
| Mobile web | **Playwright** (mobile emulation) | Appium (for real-device need) | Playwright covers viewport + UA emulation; Appium for real-device touch interactions. |

### Desktop

| Stack | Primary | Runner-up | Rationale |
|---|---|---|---|
| Electron | **Playwright** | WebdriverIO + Electron service | Playwright has first-party Electron support. |
| Tauri | **WebdriverIO** + Tauri driver | — | Official path. |

### Backend-rendered / non-JS web apps

| Stack | Primary | Runner-up | Rationale |
|---|---|---|---|
| Python (Django, Flask, FastAPI with templates) | **pytest-playwright** | Selenium + pytest | Same Playwright engine, idiomatic for Python test suites. |
| Ruby on Rails | **Capybara + Cuprite** | Capybara + Selenium | Cuprite uses CDP, faster than Selenium. |
| Java (Spring etc.) | **Playwright for Java** | Selenium + JUnit/TestNG | Playwright Java is mature; Selenium still dominant in enterprise Java. |
| .NET | **Playwright for .NET** | Selenium + NUnit/xUnit | Playwright .NET is well-supported. |
| PHP (Laravel, Symfony) | **Playwright via PHP** or **Pest browser plugin** | Codeception | Pest's browser plugin is gaining ground for Laravel. |

### When to question the default

- **Team already uses Cypress productively elsewhere** — stick with Cypress for consistency.
- **Heavy iframe / cross-origin needs** — Cypress historically struggled here; Playwright handles it. (Cypress has improved but Playwright is smoother.)
- **Component testing matters too** — Cypress has a unified e2e + component runner; with Playwright you'd add a separate component test setup.

---

## 2. Visual regression tool selection

Only add visual regression if the user asked for it or the originating issue is visually significant. Default off for greenfield bootstrap unless explicitly requested.

| Need | Recommendation | Notes |
|---|---|---|
| Default for Playwright | **`toHaveScreenshot()` built-in** | Zero extra deps; baselines stored in repo. Configure `threshold` and `maxDiffPixels`. |
| Default for Cypress | **`cypress-image-snapshot`** | Or `cypress-visual-regression`. Both store baselines in repo. |
| Default for WebdriverIO | **`@wdio/visual-service`** | Maintained, image-comparison-based. |
| Default for BackstopJS-style standalone | **BackstopJS** | Use only if not integrating with an e2e framework above. |
| Cross-team approval workflow needed | **Percy** or **Chromatic** | Cloud, web-based diff review. Chromatic is Storybook-friendly. Percy is generic. |
| Heavy use of AI-assisted diffing / dynamic content | **Applitools** | Commercial, ML-based comparison, handles dynamic content gracefully. Higher cost. |

Baseline strategy on first bootstrap: generate baselines locally, then have the user verify each one before committing. Never auto-approve baselines in CI on first run.

---

## 3. Official installer commands

Always prefer the official installer — it gives the framework's authors' recommended defaults, which the skill should not override without reason.

```bash
# Playwright (Node)
npm init playwright@latest
# Picks language, test dir, GitHub Actions, browsers.

# Playwright (Python)
pip install pytest-playwright
playwright install

# Cypress
npm install --save-dev cypress
npx cypress open  # first run sets up structure

# WebdriverIO
npm init wdio@latest .

# Detox (React Native)
npm install --save-dev detox
detox init

# Appium
npm install --save-dev appium @wdio/cli
# Then use wdio installer

# Selenium (Java, Maven)
# Add selenium-java + junit-jupiter to pom.xml; no CLI installer.
```

Match the package manager: `npm` → `npm install`, `pnpm` → `pnpm add`, `yarn` → `yarn add`.

---

## 4. Best-practice configuration

### Playwright (`playwright.config.ts`)

Key settings to set up beyond the installer defaults:

- `baseURL` — pointing at the project's dev server (`http://localhost:3000`, `5173`, `4200`, etc. depending on framework).
- `retries: process.env.CI ? 2 : 0` — flake tolerance in CI only.
- `workers: process.env.CI ? 2 : undefined` — explicit CI worker count.
- `reporter: [['html'], ['list']]` — and add `['junit', ...]` if CI needs JUnit XML.
- `use.trace: 'on-first-retry'` — full trace on flake.
- `use.screenshot: 'only-on-failure'`.
- `use.video: 'retain-on-failure'`.
- `webServer` — auto-start the dev server before tests; saves CI config complexity.
- `projects` — at least Chromium; add Firefox/WebKit if cross-browser matters; add a mobile viewport project if relevant.
- `expect.toHaveScreenshot` — set `threshold` (default 0.2 is usually too lax for UI work; try 0.1) and `maxDiffPixels` for noise tolerance.

### Cypress (`cypress.config.ts`)

- `baseUrl`.
- `viewportWidth`, `viewportHeight` — set explicitly so visual diffs are stable.
- `retries: { runMode: 2, openMode: 0 }`.
- `video: false` (or `true` with `videoCompression`) — videos are large; opt in deliberately.
- `screenshotOnRunFailure: true`.
- For visual regression with `cypress-image-snapshot`: configure `failureThreshold` and `failureThresholdType: 'percent'`.

### Universal

- Pin framework versions in `package.json` (no `^` for the test runner) — flake from runner updates is real.
- Add the test browsers to `.gitignore` if downloaded outside `node_modules`.
- Add baseline images to git if visual regression is set up.

---

## 5. Directory structure templates

### Playwright (TypeScript)

```
e2e/
├── tests/
│   ├── auth/
│   │   └── login.spec.ts
│   └── home.smoke.spec.ts
├── pages/
│   └── login.page.ts
├── fixtures/
│   ├── auth.fixture.ts
│   └── test-data.ts
├── helpers/
│   └── api-setup.ts
└── visual/
    └── home.visual.spec.ts
playwright.config.ts
```

Playwright idiom is fixtures over POMs. POMs work; fixtures are more native. Use whichever the user prefers, but be consistent.

### Cypress

```
cypress/
├── e2e/
│   ├── auth/
│   │   └── login.cy.ts
│   └── home.smoke.cy.ts
├── support/
│   ├── commands.ts        # custom commands
│   ├── e2e.ts             # global setup
│   └── pages/
│       └── login.page.ts
├── fixtures/
│   └── users.json
└── snapshots/             # visual baselines if using image-snapshot
cypress.config.ts
```

Cypress idiom is custom commands (`cy.login(...)`) over POMs, but POMs are fine and increasingly common.

---

## 6. CI snippets

Offer these as suggestions, get user confirmation before writing or committing.

### GitHub Actions — Playwright

```yaml
name: E2E
on: [push, pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 'lts/*' }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
```

### GitHub Actions — Cypress

Use the official `cypress-io/github-action` — handles caching and parallelisation. Equivalent shape; see Cypress docs for current syntax (it changes more often than other CI integrations).

### GitLab CI / CircleCI / Jenkins

Each framework's docs have reference pipelines; link the user to them rather than hand-writing from scratch. The shape is always: install deps → install browsers → start dev server (or rely on `webServer` config) → run tests → upload artifacts.

---

## 7. Anti-patterns to avoid

- **Don't write your own framework wrapper.** Use the framework's idioms directly. Wrappers ossify and the framework upgrades pass them by.
- **Don't add every browser.** Start with one (Chromium); add others when the user has a real reason (cross-browser bugs reported, multi-browser SLA).
- **Don't enable video by default.** It's expensive in CI; opt in for the suites that need it.
- **Don't auto-approve visual baselines.** Bake in a manual approval step on first generation and on diff.
- **Don't put real credentials in fixtures.** Use environment variables, dotfiles (`.env.test`, gitignored), or per-environment auth state files.
- **Don't ignore the trace viewer / debug tools.** Playwright's trace viewer and Cypress's time-travel debugger are the reason these tools exist; lean on them for triage.
- **Don't skip the smoke test on bootstrap.** A passing smoke test is the proof the setup is real. Without it you're handing the user broken infrastructure.
