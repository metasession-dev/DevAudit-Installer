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
