import { useCallback, useEffect, useState } from 'react';
import { createAgentClient } from '@inneranimalmedia/client-core';
import {
  IAM_AGENT_CHAT_SESSIONS_REFRESH,
} from '../agentChatConstants';
import type { AgentSessionRow } from '../agentSessionsCatalog';
import { conversationIdFromSession, sessionSortMs } from '../agentSessionsCatalog';

const agentClient = createAgentClient();

export type AgentChatProjectOption = { id: string; name: string; chat_project_id?: string | null };

async function sessionMutation(id: string, method: 'PATCH' | 'DELETE', body?: Record<string, unknown>) {
  const r = await fetch(`/api/agent/sessions/${encodeURIComponent(id)}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(typeof j.error === 'string' ? j.error : `Session ${method} failed (${r.status})`);
  }
}

export async function patchAgentSession(id: string, patch: Record<string, unknown>) {
  await sessionMutation(id, 'PATCH', patch);
}

export async function deleteAgentSession(id: string) {
  await sessionMutation(id, 'DELETE');
}

/**
 * Canonical Agent Sam session list — sidebar teaser and /dashboard/chats share this hook.
 * List transport uses client-core AgentSessionSummary (same contract as mobile).
 */
export function useAgentChatSessions(opts?: { limit?: number; refreshKey?: number }) {
  const limit = opts?.limit ?? 40;
  const [sessions, setSessions] = useState<AgentSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<AgentChatProjectOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await agentClient.listSessions({ limit })) as AgentSessionRow[];
      const deduped = [...rows
        .reduce((map, row) => {
          const id = conversationIdFromSession(row);
          if (!id) return map;
          const prev = map.get(id);
          if (!prev) map.set(id, row);
          return map;
        }, new Map<string, AgentSessionRow>())
        .values()];
      deduped.sort((a, b) => sessionSortMs(b) - sessionSortMs(a));
      setSessions(deduped);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load, opts?.refreshKey]);

  useEffect(() => {
    const onRefresh = () => void load();
    window.addEventListener(IAM_AGENT_CHAT_SESSIONS_REFRESH, onRefresh);
    return () => {
      window.removeEventListener(IAM_AGENT_CHAT_SESSIONS_REFRESH, onRefresh);
    };
  }, [load]);

  useEffect(() => {
    void fetch('/api/projects', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : rows?.projects || [];
        setProjects(
          list
            .map((p: { id?: string; name?: string; chat_project_id?: string | null }) => ({
              id: String(p.id || '').trim(),
              name: String(p.name || 'Project').trim(),
              chat_project_id: p.chat_project_id ? String(p.chat_project_id).trim() : null,
            }))
            .filter((p: AgentChatProjectOption) => p.id),
        );
      })
      .catch(() => setProjects([]));
  }, []);

  return {
    sessions,
    loading,
    projects,
    reload: load,
    patchSession: patchAgentSession,
    deleteSession: deleteAgentSession,
    setSessions,
  };
}
