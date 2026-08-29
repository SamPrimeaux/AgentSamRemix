import React, { useMemo } from 'react';
import { Loader2, Zap } from 'lucide-react';
import {
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  LS_AGENT_CHAT_CONVERSATION_ID,
} from '../../../agentChatConstants';
import type { AgentSessionRow } from '../../../agentSessionsCatalog';
import { groupSessionsByBucket, relativeSessionTime, sessionDisplayTitle } from '../../../agentSessionsCatalog';

type WorkspaceRow = { id: string; name: string };

export type AgentMobileHomePanelProps = {
  sessions: AgentSessionRow[];
  sessionsLoading: boolean;
  workspaces: WorkspaceRow[];
  activeWorkspaceId: string | null;
  onQuickstart?: () => void;
};

function mobileSessionGroups(rows: AgentSessionRow[]): { label: string; items: AgentSessionRow[] }[] {
  const groups = groupSessionsByBucket(rows);
  const primary = groups.filter((g) => g.label === 'Today' || g.label === 'This Week');
  const olderItems = groups
    .filter((g) => g.label === 'Older' || g.label === 'This Month')
    .flatMap((g) => g.items);
  if (olderItems.length > 0) {
    primary.push({ label: 'Older', items: olderItems });
  }
  return primary;
}

/** Workspace / project label only — never github owner/name (chats are not repo-scoped). */
function sessionScopeLabel(
  s: AgentSessionRow,
  workspaces: WorkspaceRow[],
  activeWorkspaceId: string | null,
): string {
  const projectName = s.project_name?.trim();
  if (projectName) return projectName;
  const wsId = s.workspace_id?.trim();
  if (wsId) {
    const row = workspaces.find((w) => w.id === wsId);
    if (row?.name?.trim()) return row.name.trim();
  }
  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  if (active?.name?.trim()) return active.name.trim();
  return 'Workspace';
}

function modelLabel(s: AgentSessionRow): string {
  const m = s.last_model_key?.trim() || s.model_key?.trim() || s.model_used?.trim();
  return m || '—';
}

const chipClass =
  'shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--dashboard-border)] bg-[var(--dashboard-card)]/50 text-[11px] font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-[var(--dashboard-card)] transition-colors whitespace-nowrap';

export function AgentMobileHomePanel({
  sessions,
  sessionsLoading,
  workspaces,
  activeWorkspaceId,
  onQuickstart,
}: AgentMobileHomePanelProps) {
  const resumableSessions = useMemo(
    () => sessions.filter((s) => s.conversation_id),
    [sessions],
  );
  const sessionGroups = useMemo(() => mobileSessionGroups(resumableSessions), [resumableSessions]);

  const selectConversation = (id: string) => {
    if (!id) return;
    try {
      localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, id);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, { detail: { id } }));
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full bg-[var(--dashboard-panel)]">
      <div className="shrink-0 px-3 pb-2 bg-[var(--dashboard-panel)]">
        <div className="flex gap-2 overflow-x-auto chat-hide-scroll [scrollbar-width:none] -mx-1 px-1">
          <button type="button" className={chipClass} onClick={() => onQuickstart?.()}>
            <Zap size={12} className="text-[var(--solar-yellow)]" />
            Quickstart
          </button>
          <button
            type="button"
            className={chipClass}
            onClick={() => {
              window.location.href = '/dashboard/artifacts';
            }}
          >
            View Artifacts
          </button>
          <button
            type="button"
            className={chipClass}
            onClick={() => {
              window.location.href = '/dashboard/projects';
            }}
          >
            Open Project
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain chat-hide-scroll px-3 pb-4 bg-[var(--dashboard-panel)]">
        {sessionsLoading ? (
          <div className="py-6 flex justify-center">
            <Loader2 size={18} className="animate-spin text-[var(--dashboard-muted)]" />
          </div>
        ) : resumableSessions.length === 0 ? (
          <p className="text-[11px] text-[var(--dashboard-muted)] py-2">
            No recent sessions — start a conversation above.
          </p>
        ) : (
          sessionGroups.map((g) => (
            <div key={g.label} className="mb-3">
              <div className="text-[0.6875rem] uppercase tracking-widest text-[var(--dashboard-muted)] py-1.5">
                {g.label}
              </div>
              {g.items.map((s) => {
                const conversationId = String(s.conversation_id || '').trim();
                if (!conversationId) return null;
                return (
                  <button
                    key={conversationId}
                    type="button"
                    onClick={() => selectConversation(conversationId)}
                    className="w-full text-left min-h-[52px] py-2 border-b border-[var(--dashboard-border)] flex items-start gap-2 transition-colors hover:bg-[var(--bg-hover)] rounded-sm"
                  >
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="text-[0.8125rem] text-[var(--dashboard-text)] truncate">
                        {sessionDisplayTitle(s)}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[0.6875rem] text-[var(--dashboard-muted)]">
                        <span className="truncate max-w-[45%]">
                          {sessionScopeLabel(s, workspaces, activeWorkspaceId)}
                        </span>
                        <span className="opacity-50">·</span>
                        <span className="truncate">{modelLabel(s)}</span>
                      </div>
                    </div>
                    <span className="text-[0.6875rem] text-[var(--dashboard-muted)] shrink-0 tabular-nums pt-1">
                      {relativeSessionTime(s)}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
