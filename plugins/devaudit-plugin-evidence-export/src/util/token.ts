import type { PluginContext } from '@metasession.co/devaudit-plugin-sdk';

const DEFAULT_BASE_URL = 'https://devaudit.ai';

export interface ResolvedAuth {
  readonly token: string;
  readonly baseUrl: string;
}

/**
 * The person's PAT, from the CLI (`ctx.getPersonalAuth`, devaudit-installer#1100), so nobody has to
 * export it into their shell. Older CLIs lack the accessor: fall back to `DEVAUDIT_USER_TOKEN`.
 * The token is never logged or written.
 */
export async function resolveAuth(ctx: PluginContext, sdlcBaseUrl: string | undefined): Promise<ResolvedAuth> {
  const fromCli = ctx.getPersonalAuth ? await ctx.getPersonalAuth() : null;
  const token = fromCli?.token ?? process.env['DEVAUDIT_USER_TOKEN'];
  if (!token) {
    throw new Error(
      'No personal access token available. Run `devaudit auth login` (the CLI then provides it to this plugin).',
    );
  }
  const baseUrl = process.env['DEVAUDIT_BASE_URL'] ?? sdlcBaseUrl ?? fromCli?.baseUrl ?? DEFAULT_BASE_URL;
  return { token, baseUrl };
}

/** True when a token is available from the CLI or the environment. Never returns the token. */
export async function hasAuth(ctx: PluginContext): Promise<boolean> {
  const fromCli = ctx.getPersonalAuth ? await ctx.getPersonalAuth() : null;
  return Boolean(fromCli?.token ?? process.env['DEVAUDIT_USER_TOKEN']);
}
