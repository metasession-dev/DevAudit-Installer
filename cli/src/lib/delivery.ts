/**
 * DevAudit-Installer#1272, #1273, #1274 — the names and defaults a DevAudit Delivery run shares between
 * `devaudit install --delivery`, the generated `devaudit-delivery.yml`, `devaudit delivery report` and
 * `devaudit doctor`. One place, so the workflow, the secrets and the checks cannot disagree.
 */

/** The generated workflow, under `.github/workflows/`. */
export const DELIVERY_WORKFLOW_FILE = 'devaudit-delivery.yml';

/** The prompt of the headless session, rendered at sync and read by the workflow. */
export const DELIVERY_PROMPT_FILE = '.devaudit/delivery-prompt.md';

/** Repository secret holding the key the headless Claude Code session authenticates with (#1272). */
export const DELIVERY_AGENT_API_SECRET = 'DEVAUDIT_AGENT_API_KEY';

/** Repository secret holding the portal key the agent works under, distinct from `DEVAUDIT_API_KEY` (#1274). */
export const DELIVERY_AGENT_PORTAL_SECRET = 'DEVAUDIT_AGENT_PORTAL_KEY';

/** Optional repository secret: a token that lets the agent's pushes and pull requests start workflows. */
export const DELIVERY_AGENT_GITHUB_SECRET = 'DEVAUDIT_AGENT_GITHUB_TOKEN';

/** Name of the portal API key the agent works under; the portal refuses a second active key of one name. */
export const DELIVERY_AGENT_KEY_NAME = 'delivery-agent';

/**
 * The default name of the git author of every commit in a delivery run (#1274, #1286); `delivery.agent_git_name`
 * overrides it. There is no default address: it comes from the token's own GitHub identity (the App's bot noreply
 * address from the portal, or the machine user's `<id>+<login>@users.noreply.github.com`), never an invented one.
 */
export const DELIVERY_GIT_NAME_DEFAULT = 'DevAudit Agent';

/** Where the agent's GitHub token comes from (`delivery.github_token_source`, #1286): the repository secret, or the portal's GitHub App. */
export const DELIVERY_GITHUB_TOKEN_SOURCES = ['secret', 'app'] as const;
export type DeliveryGithubTokenSource = (typeof DELIVERY_GITHUB_TOKEN_SOURCES)[number];

/** A portal-issued GitHub token is reused until this long before it expires; one lasts about an hour. */
export const DELIVERY_TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;

/** The Claude Code CLI version the delivery workflow installs. Bump it deliberately; `doctor` compares it. */
export const DELIVERY_CLAUDE_CODE_VERSION = '2.1.322';

export const DELIVERY_DEFAULT_MAX_TURNS = 200;
export const DELIVERY_DEFAULT_MAX_MINUTES = 90;
export const DELIVERY_MAX_TURNS_RANGE = { min: 10, max: 1000 } as const;
export const DELIVERY_MAX_MINUTES_RANGE = { min: 10, max: 360 } as const;

/** The phases a delivery run reports to the portal. */
export const DELIVERY_PHASES = ['running', 'awaiting_approval', 'succeeded', 'failed'] as const;
export type DeliveryPhase = (typeof DELIVERY_PHASES)[number];

/**
 * The prompt file shipped to the repository. `@@ISSUE_NUMBER@@` and `@@RUN_ID@@` are filled by the workflow from the
 * dispatch payload when it starts the session (the `@@` form cannot collide with a workflow expression).
 */
export const DELIVERY_PROMPT_TEMPLATE = `Run the sdlc-implementer skill on GitHub issue #@@ISSUE_NUMBER@@. This is DevAudit delivery run @@RUN_ID@@. Follow the headless rules in the skill.
`;
