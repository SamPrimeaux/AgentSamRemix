import { createApiClient, type ApiClientOptions } from '../api/fetch';

export type ProjectSummary = {
  id: string;
  name: string;
  description?: string | null;
  client_name?: string | null;
  status?: string | null;
  workspace_id?: string | null;
  github_repo?: string | null;
  progress?: number | null;
  updated_at?: string | null;
};

export function createProjectsClient(options: ApiClientOptions = {}) {
  const api = createApiClient(options);
  return {
    async list(workspaceId?: string | null): Promise<ProjectSummary[]> {
      const query = workspaceId?.trim() ? `?workspace_id=${encodeURIComponent(workspaceId.trim())}` : '';
      const payload = await api.json<{ projects?: ProjectSummary[] }>(`/api/projects${query}`, { cache: 'no-store' });
      return Array.isArray(payload.projects) ? payload.projects : [];
    },
  };
}
