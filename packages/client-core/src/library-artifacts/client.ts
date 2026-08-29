import { createApiClient, type ApiClientOptions } from '../api/fetch';

export type ArtifactSummary = {
  id: string | null;
  name: string;
  description?: string | null;
  artifact_type?: string | null;
  artifact_status?: string | null;
  validation_status?: string | null;
  workspace_id?: string | null;
  project_key?: string | null;
  preview_url?: string | null;
  thumbnail_url?: string | null;
  updated_at?: string | null;
};

export function createArtifactsClient(options: ApiClientOptions = {}) {
  const api = createApiClient(options);
  return {
    async list(input: { workspaceId?: string | null; limit?: number } = {}): Promise<ArtifactSummary[]> {
      const query = new URLSearchParams();
      if (input.workspaceId?.trim()) query.set('workspace_id', input.workspaceId.trim());
      query.set('limit', String(input.limit || 20));
      const payload = await api.json<{ artifacts?: ArtifactSummary[] }>(`/api/agent/artifacts?${query.toString()}`);
      return Array.isArray(payload.artifacts) ? payload.artifacts : [];
    },
  };
}
