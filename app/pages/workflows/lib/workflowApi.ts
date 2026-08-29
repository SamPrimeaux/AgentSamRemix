import type {
  WorkflowGraph,
  WorkflowListItem,
  WorkflowRunDetail,
} from '../workflowTypes';
import { mapGraphPayload } from './workflowGraphAdapter';

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof (data as { error?: string }).error === 'string'
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function createWorkflow(body: {
  display_name: string;
  workflow_key?: string;
  description?: string;
}): Promise<{ ok: boolean; id: string; workflow_key: string; display_name: string }> {
  return apiJson('/api/agentsam/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function fetchWorkflowList(): Promise<WorkflowListItem[]> {
  const data = await apiJson<WorkflowListItem[] | { workflows?: WorkflowListItem[] }>(
    '/api/agentsam/workflows',
  );
  if (Array.isArray(data)) return data;
  return Array.isArray(data.workflows) ? data.workflows : [];
}

export async function fetchWorkflowGraph(registryId: string): Promise<WorkflowGraph> {
  const data = await apiJson<Record<string, unknown>>(
    `/api/agentsam/workflows/${encodeURIComponent(registryId)}`,
  );
  return mapGraphPayload(data as Parameters<typeof mapGraphPayload>[0]);
}

export async function fetchWorkflowRun(runId: string): Promise<WorkflowRunDetail> {
  return apiJson<WorkflowRunDetail>(`/api/agentsam/workflow-runs/${encodeURIComponent(runId)}`);
}

export async function saveCanvasLayout(
  registryId: string,
  positions: Record<string, { x: number; y: number }>,
): Promise<{ ok?: boolean; updated?: number; dag_workflow_id?: string }> {
  return apiJson(`/api/agentsam/workflows/${encodeURIComponent(registryId)}/layout`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions }),
  });
}

export async function createNode(
  registryId: string,
  body: {
    node_key: string;
    title?: string;
    node_type: string;
    handler_key?: string;
    description?: string;
  },
): Promise<void> {
  await apiJson(`/api/agentsam/workflows/${encodeURIComponent(registryId)}/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function updateNode(
  registryId: string,
  nodeKey: string,
  body: Record<string, unknown>,
): Promise<void> {
  await apiJson(
    `/api/agentsam/workflows/${encodeURIComponent(registryId)}/nodes/${encodeURIComponent(nodeKey)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export async function deleteNode(registryId: string, nodeKey: string): Promise<void> {
  await apiJson(
    `/api/agentsam/workflows/${encodeURIComponent(registryId)}/nodes/${encodeURIComponent(nodeKey)}`,
    { method: 'DELETE' },
  );
}

export async function createEdge(registryId: string, from: string, to: string): Promise<void> {
  await apiJson(`/api/agentsam/workflows/${encodeURIComponent(registryId)}/edges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_node_key: from, to_node_key: to }),
  });
}

export async function deleteEdge(registryId: string, edgeId: string): Promise<void> {
  await apiJson(
    `/api/agentsam/workflows/${encodeURIComponent(registryId)}/edges/${encodeURIComponent(edgeId)}`,
    { method: 'DELETE' },
  );
}

export async function patchWorkflow(
  registryId: string,
  body: {
    display_name?: string;
    description?: string;
    signed_off?: boolean;
    requires_approval?: boolean;
  },
): Promise<{ ok?: boolean; signed_off?: boolean }> {
  return apiJson(`/api/agentsam/workflows/${encodeURIComponent(registryId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
