import type { AgentSessionRow } from '../agentSessionsCatalog';

export async function fetchAgentSessions(opts?: {
  limit?: number;
  projectId?: string | null;
  workspaceId?: string | null;
}): Promise<AgentSessionRow[]> {
  const params = new URLSearchParams();
  params.set('limit', String(opts?.limit ?? 80));
  if (opts?.projectId?.trim()) params.set('project_id', opts.projectId.trim());
  if (opts?.workspaceId?.trim()) params.set('workspace_id', opts.workspaceId.trim());
  const r = await fetch(`/api/agent/sessions?${params}`, { credentials: 'same-origin' });
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data) ? (data as AgentSessionRow[]) : [];
}

export function chatProjectIdForSession(session: AgentSessionRow, projectsTableId: string, chatProjectId?: string | null) {
  const pid = session.project_id?.trim() || '';
  if (!pid) return false;
  if (pid === projectsTableId) return true;
  if (chatProjectId && pid === chatProjectId) return true;
  return false;
}

export function chatAssignProjectId(projectsTableId: string, chatProjectId?: string | null): string {
  return chatProjectId?.trim() || projectsTableId;
}
