import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface RequirementSummary {
  readonly requirement_id: string;
  readonly evidence_count: number;
  readonly latest_upload: string | null;
}

export interface ComplianceEvidence {
  readonly id: string;
  readonly requirement_id: string;
  readonly file_path: string;
  readonly file_name: string;
  readonly file_size_bytes: number | null;
  readonly mime_type: string | null;
  readonly uploaded_at: string;
}

export interface SignedUrlResponse {
  readonly signedUrl: string;
}

export class EvidenceApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'EvidenceApiError';
  }
}

export interface EvidenceApiOptions {
  readonly baseUrl: string;
  readonly token: string;
}

export class EvidenceApi {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(opts: EvidenceApiOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token;
  }

  async listRequirements(projectSlug: string): Promise<readonly RequirementSummary[]> {
    const url = `${this.baseUrl}/api/evidence?projectSlug=${encodeURIComponent(projectSlug)}`;
    const res = await this.fetchJson<RequirementSummary[]>(url);
    return res;
  }

  async listEvidence(projectSlug: string, requirementId: string): Promise<readonly ComplianceEvidence[]> {
    const params = new URLSearchParams({ projectSlug, requirementId });
    const url = `${this.baseUrl}/api/evidence?${params.toString()}`;
    return this.fetchJson<ComplianceEvidence[]>(url);
  }

  async getSignedUrl(filePath: string): Promise<string> {
    const url = `${this.baseUrl}/api/evidence/download?filePath=${encodeURIComponent(filePath)}`;
    const res = await this.fetchJson<SignedUrlResponse>(url);
    return res.signedUrl;
  }

  async download(signedUrl: string, destPath: string): Promise<number> {
    const res = await fetch(signedUrl);
    if (!res.ok || !res.body) {
      throw new EvidenceApiError(`Download failed: HTTP ${res.status}`, res.status);
    }
    const handle = await fs.open(destPath, 'w');
    let bytes = 0;
    try {
      const nodeStream = Readable.fromWeb(res.body as never);
      nodeStream.on('data', (chunk: Buffer | string) => {
        bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      });
      await pipeline(nodeStream, handle.createWriteStream());
    } finally {
      await handle.close();
    }
    return bytes;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: { 'x-devaudit-token': this.token } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new EvidenceApiError(`GET ${url} → HTTP ${res.status}${text ? ': ' + text : ''}`, res.status);
    }
    return (await res.json()) as T;
  }
}
