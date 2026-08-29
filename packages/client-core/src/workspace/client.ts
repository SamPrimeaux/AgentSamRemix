import type { WorkspaceListResponse, WorkspaceSummary } from '../../../platform-contracts/src/index';
import { createApiClient, type ApiClientOptions } from '../api/fetch';

function normalizeWorkspace(raw: Record<string, unknown>): WorkspaceSummary {
  const id = String(raw.id || '').trim();
  const name = String(raw.name || raw.display_name || raw.slug || id).trim() || id;
  const slug = String(raw.slug || id.replace(/^ws_/, '') || id).trim();
  return {
    id,
    name,
    slug,
    status: String(raw.status || 'active'),
    github_repo: typeof raw.github_repo === 'string' ? raw.github_repo : null,
    root_path: typeof raw.root_path === 'string' ? raw.root_path : null,
    database_studio_name: typeof raw.database_studio_name === 'string' ? raw.database_studio_name : null,
  };
}

export function createWorkspaceClient(options: ApiClientOptions = {}) {
  const api = createApiClient(options);
  return {
    async list(): Promise<WorkspaceListResponse> {
      const payload = await api.json<{ data?: Record<string, unknown>[]; current?: string | null }>('/api/settings/workspaces');
      return {
        data: Array.isArray(payload.data) ? payload.data.map(normalizeWorkspace).filter((row) => row.id) : [],
        current: typeof payload.current === 'string' && payload.current.trim() ? payload.current.trim() : null,
      };
    },
    async setActive(workspaceId: string): Promise<void> {
      const id = workspaceId.trim();
      if (!id) throw new Error('workspace_id_required');
      const response = await api.request('/api/settings/workspaces/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error(`workspace_switch_http_${response.status}`);
    },
  };
}
