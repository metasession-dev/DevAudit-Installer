import * as clack from '@clack/prompts';

/**
 * devaudit-installer#956 — TTY/CI/--json-aware prompt helper for `doctor --fix`.
 *
 * Rule: a prompt is shown ONLY when stdin and stdout are TTYs, `CI` is not
 * set, and `--json` is off. In every other mode `confirm`/`input` return
 * `null` WITHOUT touching the terminal, and the caller must treat the
 * proposal as unapplied unless an explicit flag (`--yes`, `--reason`) was given.
 * `null` also means "cancelled" (Ctrl-C / Esc), so cancel and non-interactive
 * collapse to one safe outcome: nothing is applied.
 *
 * Never use this for secrets: values are echoed and may be logged by the
 * terminal. Questions that look like they ask for a credential are refused.
 */

export interface PromptEnvironment {
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
  readonly ci: boolean;
  readonly json: boolean;
}

export interface PromptDriver {
  confirm(message: string): Promise<boolean | symbol>;
  text(message: string): Promise<string | symbol>;
  select(message: string, options: readonly { value: string; label: string }[]): Promise<string | symbol>;
  isCancel(value: unknown): boolean;
}

const clackDriver: PromptDriver = {
  confirm: (message) => clack.confirm({ message, initialValue: false }),
  text: (message) => clack.text({ message }),
  select: (message, options) =>
    clack.select<string>({ message, options: options.map((o) => ({ value: o.value, label: o.label })) }),
  isCancel: (value) => clack.isCancel(value),
};

let driver: PromptDriver = clackDriver;
let envOverride: PromptEnvironment | undefined;

/** Test seam: replace the clack driver and/or the detected environment. */
export function setPromptTestHooks(hooks: { driver?: PromptDriver; env?: PromptEnvironment } | null): void {
  driver = hooks?.driver ?? clackDriver;
  envOverride = hooks?.env;
}

export function isCiEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env['CI'];
  return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}

export function detectPromptEnvironment(json: boolean): PromptEnvironment {
  if (envOverride) return { ...envOverride, json: envOverride.json || json };
  return {
    stdinIsTty: Boolean(process.stdin.isTTY),
    stdoutIsTty: Boolean(process.stdout.isTTY),
    ci: isCiEnv(),
    json,
  };
}

export function canPrompt(json: boolean): boolean {
  const e = detectPromptEnvironment(json);
  return e.stdinIsTty && e.stdoutIsTty && !e.ci && !e.json;
}

/** Why prompting is unavailable (for operator-facing messages); null when it is available. */
export function nonInteractiveReason(json: boolean): string | null {
  const e = detectPromptEnvironment(json);
  if (e.json) return '--json never prompts';
  if (e.ci) return 'CI is set';
  if (!e.stdinIsTty || !e.stdoutIsTty) return 'no TTY';
  return null;
}

const SECRET_QUESTION = /\b(token|secret|password|passphrase|api[- _]?key|credential)s?\b/i;

function assertNotSecret(question: string): void {
  if (SECRET_QUESTION.test(question)) {
    throw new Error('prompt helper refuses to ask for secrets; read credentials from env or `devaudit auth login`');
  }
}

/** Yes/no. `null` = not asked (non-interactive) or cancelled; `false` = declined. */
export async function confirm(question: string, opts: { json?: boolean } = {}): Promise<boolean | null> {
  assertNotSecret(question);
  if (!canPrompt(opts.json ?? false)) return null;
  const answer = await driver.confirm(question);
  if (driver.isCancel(answer)) return null;
  return answer === true;
}

/** Free text (trimmed). `null` = not asked, cancelled, or left empty. */
export async function input(question: string, opts: { json?: boolean } = {}): Promise<string | null> {
  assertNotSecret(question);
  if (!canPrompt(opts.json ?? false)) return null;
  const answer = await driver.text(question);
  if (driver.isCancel(answer)) return null;
  const trimmed = String(answer).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Pick one of `options`. `null` = not asked or cancelled. */
export async function select(
  question: string,
  options: readonly { value: string; label: string }[],
  opts: { json?: boolean } = {},
): Promise<string | null> {
  assertNotSecret(question);
  if (!canPrompt(opts.json ?? false)) return null;
  const answer = await driver.select(question, options);
  if (driver.isCancel(answer)) return null;
  return String(answer);
}
