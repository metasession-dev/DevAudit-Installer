export interface CommandContribution {
  readonly name: string;
  readonly description: string;
}

const COMMAND_NAME_RE = /^[a-z][a-z0-9-]*$/;

export function isValidCommandName(value: unknown): value is string {
  return typeof value === 'string' && COMMAND_NAME_RE.test(value);
}
