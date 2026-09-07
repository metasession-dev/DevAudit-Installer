interface DevAuditClientOptions {
  readonly token: string;
  readonly baseUrl: string;
}

export interface DevAuditProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
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

  async issueApiKey(projectId: string, name: string): Promise<ApiKeyIssued> {
    const res = await this.request('POST', `/api/projects/${projectId}/api-keys`, {
      name,
      role: 'uploader',
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
