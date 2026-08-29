import type { AgentSessionSummary, ClientEnvironment } from '../../../platform-contracts/src/index';
import { createApiClient, type ApiClientOptions } from '../api/fetch';
import { detectClientEnvironment } from '../platform/capabilities';
import { consumeSse } from './sse';

/** Integer unix epoch seconds — mirrors Worker `toEpochSeconds` for client boundary. */
function toEpochSeconds(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    const n = value > 1e12 ? value / 1000 : value;
    const sec = Math.trunc(n);
    return sec > 0 ? sec : undefined;
  }
  const raw = String(value).trim();
  if (!raw) return undefined;
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    const sec = Math.trunc(n > 1e12 ? n / 1000 : n);
    return sec > 0 ? sec : undefined;
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return undefined;
  const sec = Math.trunc(ms / 1000);
  return sec > 0 ? sec : undefined;
}

function normalizeAgentSessionSummary(row: AgentSessionSummary): AgentSessionSummary {
  return {
    ...row,
    started_at: toEpochSeconds(row.started_at),
    updated_at: toEpochSeconds(row.updated_at),
  };
}

export type SendAgentMessageInput = {
  message: string;
  workspaceId: string;
  conversationId?: string | null;
  model?: string;
  mode?: 'ask' | 'plan' | string;
  environment?: ClientEnvironment;
  signal?: AbortSignal;
  onText?: (text: string) => void;
  onEvent?: (event: Record<string, unknown>) => void;
};

export function createAgentClient(options: ApiClientOptions = {}) {
  const api = createApiClient(options);
  return {
    async listSessions(opts?: { limit?: number }): Promise<AgentSessionSummary[]> {
      const limit = Number.isFinite(Number(opts?.limit)) ? Math.max(1, Math.min(200, Number(opts?.limit))) : undefined;
      const path = limit ? `/api/agent/sessions?limit=${limit}` : '/api/agent/sessions';
      const payload = await api.json<AgentSessionSummary[] | { sessions?: AgentSessionSummary[] }>(path);
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload.sessions) ? payload.sessions : [];
      return rows.map(normalizeAgentSessionSummary);
    },
    async listModels(): Promise<Record<string, unknown>[]> {
      const payload = await api.json<Record<string, unknown>[] | { models?: Record<string, unknown>[] }>('/api/agent/models?show_in_picker=1');
      return Array.isArray(payload) ? payload : Array.isArray(payload.models) ? payload.models : [];
    },
    async sendMessage(input: SendAgentMessageInput): Promise<void> {
      const message = input.message.trim();
      const workspaceId = input.workspaceId.trim();
      if (!message) throw new Error('message_required');
      if (!workspaceId) throw new Error('workspace_id_required');
      const environment = input.environment || detectClientEnvironment();
      const form = new FormData();
      form.append('message', message);
      form.append('mode', input.mode || 'ask');
      if (input.model?.trim()) form.append('model', input.model.trim());
      form.append('conversationId', input.conversationId?.trim() || '');
      form.append('workspace_id', workspaceId);
      form.append('contextMode', 'workspace');
      form.append('workspaceContext', JSON.stringify({ workspaceId, client_surface: environment.surface, client_capabilities: environment.capabilities }));
      form.append('runtime_lane', 'full_compile');
      const response = await api.request('/api/agent/chat', {
        method: 'POST',
        body: form,
        signal: input.signal,
        headers: { 'x-iam-workspace-id': workspaceId },
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`agent_chat_http_${response.status}${detail ? `:${detail.slice(0, 240)}` : ''}`);
      }
      if (!response.body) throw new Error('agent_chat_empty_stream');
      await consumeSse(response.body, {
        onEvent: (event) => input.onEvent?.(event),
        onText: (text) => input.onText?.(text),
      });
    },
  };
}
