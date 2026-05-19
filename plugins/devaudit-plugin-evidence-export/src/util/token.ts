const DEFAULT_BASE_URL = 'https://devaudit.metasession.co';

export interface ResolvedAuth {
  readonly token: string;
  readonly baseUrl: string;
}

export function resolveAuth(sdlcBaseUrl: string | undefined): ResolvedAuth {
  const token = process.env['DEVAUDIT_USER_TOKEN'];
  if (!token) {
    throw new Error(
      'DEVAUDIT_USER_TOKEN env var is required. Run `devaudit auth login` or set the env var directly.',
    );
  }
  const baseUrl = process.env['DEVAUDIT_BASE_URL'] ?? sdlcBaseUrl ?? DEFAULT_BASE_URL;
  return { token, baseUrl };
}
