interface DevAuditClientOptions {
  readonly token: string;
  readonly baseUrl: string;
}

export interface DevAuditProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /**
   * devaudit-installer#861 — used by `devaudit doctor --fleet` to resolve a
   * project to a local checkout. Stored as a plain string on the portal
   * (`compliance_projects.repo_url`), never verified against actual GitHub
   * ownership — treat it as a hint, not an authorization boundary. The
   * authorization boundary is `/api/projects` itself only ever returning
   * projects this token's user can access (org membership or an explicit
   * access grant), enforced portal-side.
   */
  readonly repo_url?: string | null;
}

export interface ApiKeyIssued {
  readonly id: string;
  readonly name: string;
  readonly plainTextKey: string;
}

export interface ApiKeySummary {
  readonly id: string;
  readonly name: string;
  readonly revoked_at: string | null;
  /** ISO timestamp, or null/absent for a key that never expires. */
  readonly expires_at?: string | null;
}

/**
 * metasession-dev/devaudit#921 — the key list includes revoked and expired
 * keys, so "a live key with this name" means not revoked and not past its
 * `expires_at`.
 */
export function isActiveApiKey(key: ApiKeySummary, now: Date = new Date()): boolean {
  if (key.revoked_at !== null) return false;
  if (key.expires_at) {
    const t = Date.parse(key.expires_at);
    if (!Number.isNaN(t) && t <= now.getTime()) return false;
  }
  return true;
}

export class DevAuditApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'DevAuditApiError';
  }

  /** The portal's JSON `{ "error": "..." }` text, or null when the body has none. */
  get portalMessage(): string | null {
    try {
      const parsed = JSON.parse(this.body) as { error?: unknown };
      return typeof parsed.error === 'string' && parsed.error.trim() !== '' ? parsed.error.trim() : null;
    } catch {
      return null;
    }
  }
}

/**
 * Plain-language reason a viewer-key request was refused. Since
 * metasession-dev/devaudit#921 a member may issue their own viewer key, so a
 * 403 means the five-active-key cap or no access to the project (the portal's
 * message says which); on an older portal it means "admins only".
 */
export function viewerKeyRefusal(err: DevAuditApiError, name: string): string {
  const said = err.portalMessage;
  if (err.status === 409) return `a live key named '${name}' already exists on the portal (409)${said ? `: ${said}` : ''}`;
  if (err.status === 403) return `the portal refused to issue a viewer key (403): ${said ?? 'check your access to this project with a project admin'}`;
  return `the portal rejected the request (HTTP ${err.status})${said ? `: ${said}` : ''}`;
}

export class DevAuditClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(opts: DevAuditClientOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
  }

  async listProjects(): Promise<readonly DevAuditProject[]> {
    const res = await this.request('GET', '/api/projects');
    const json = (await res.json()) as { projects?: DevAuditProject[] } | DevAuditProject[];
    if (Array.isArray(json)) return json;
    return json.projects ?? [];
  }

  async getProjectBySlug(slug: string): Promise<DevAuditProject | null> {
    const list = await this.listProjects();
    return list.find((p) => p.slug === slug) ?? null;
  }

  async createProject(slug: string, name: string): Promise<DevAuditProject> {
    const res = await this.request('POST', '/api/projects', { slug, name });
    return (await res.json()) as DevAuditProject;
  }

  async listApiKeys(projectId: string): Promise<readonly ApiKeySummary[]> {
    const res = await this.request('GET', `/api/projects/${projectId}/api-keys`);
    const json = (await res.json()) as ApiKeySummary[] | { keys?: ApiKeySummary[] };
    if (Array.isArray(json)) return json;
    return json.keys ?? [];
  }

  async issueApiKey(
    projectId: string,
    name: string,
    role: 'uploader' | 'viewer' = 'uploader',
  ): Promise<ApiKeyIssued> {
    const res = await this.request('POST', `/api/projects/${projectId}/api-keys`, {
      name,
      role,
    });
    return (await res.json()) as ApiKeyIssued;
  }

  /**
   * devaudit-installer#778 — revoke a project-scoped API key, used by
   * `devaudit uninstall` to disconnect a repo from a project. A 404 (the
   * project or key is already gone — e.g. the portal project itself was
   * hard-deleted, which cascades the key already) is treated as success,
   * not an error: the goal state — "this key can no longer authenticate" —
   * already holds.
   */
  async revokeApiKey(projectId: string, keyId: string): Promise<void> {
    try {
      await this.request('DELETE', `/api/projects/${projectId}/api-keys/${keyId}`);
    } catch (err) {
      if (err instanceof DevAuditApiError && err.status === 404) return;
      throw err;
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { 'x-devaudit-token': this.token };
    let payload: string | undefined;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(url, { method, headers, body: payload });
    if (!res.ok) {
      const text = await res.text();
      throw new DevAuditApiError(`${method} ${path} → HTTP ${res.status}`, res.status, text);
    }
    return res;
  }
}
