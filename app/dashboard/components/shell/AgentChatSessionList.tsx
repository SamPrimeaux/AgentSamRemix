import { useMemo, type FC } from 'react';
import { Loader2 } from 'lucide-react';
import { conversationIdFromSession, sessionDisplayTitle } from '../../agentSessionsCatalog';
import type { AgentSessionRow } from '../../agentSessionsCatalog';
import { resumeAgentChatSession } from '../../lib/openAgentConversation';
import { useAgentChatSessions } from '../../hooks/useAgentChatSessions';
import { AgentChatSessionRowMenu } from './AgentChatSessionRowMenu';

const RECENT_TEASER_LIMIT = 8;

export const AgentChatSessionList: FC<{
  variant?: 'sidebar';
  expanded?: boolean;
  activeConversationId?: string | null;
  onSelect?: (conversationId: string, title?: string) => void;
  onDeletedActive?: (conversationId: string) => void;
  refreshKey?: number;
}> = ({
  variant = 'sidebar',
  expanded = true,
  activeConversationId,
  onSelect,
  onDeletedActive,
  refreshKey = 0,
}) => {
  const { sessions, loading, projects, reload, patchSession, deleteSession } = useAgentChatSessions({
    limit: 40,
    refreshKey,
  });

  const starred = useMemo(() => sessions.filter((s) => s.is_starred), [sessions]);
  const recents = useMemo(() => sessions.filter((s) => !s.is_starred), [sessions]);

  const selectConversation = (s: AgentSessionRow) => {
    const id = conversationIdFromSession(s);
    if (!id) return;
    const title = sessionDisplayTitle(s);
    if (onSelect) {
      onSelect(id, title);
      return;
    }
    resumeAgentChatSession({ id, title, force: true });
  };

  const renderRow = (s: AgentSessionRow) => {
    const id = conversationIdFromSession(s);
    if (!id) return null;
    const active = activeConversationId && id === activeConversationId;
    return (
      <div key={id} className="relative group flex items-center gap-0.5 min-h-[32px]">
        <button
          type="button"
          onClick={() => selectConversation(s)}
          title={sessionDisplayTitle(s)}
          className={`flex-1 min-w-0 text-left rounded-md transition-colors hover:bg-[var(--bg-hover)]/60 px-1.5 py-1 ${
            active ? 'bg-[var(--bg-elevated)] border-l-2 border-l-[var(--solar-cyan)]' : ''
          }`}
        >
          <div className="truncate text-[11px] font-medium text-main pr-6">
            {sessionDisplayTitle(s)}
          </div>
        </button>
        {expanded ? (
          <AgentChatSessionRowMenu
            session={s}
            projects={projects}
            onPatch={patchSession}
            onDelete={deleteSession}
            onReload={reload}
            activeConversationId={activeConversationId}
            onDeletedActive={onDeletedActive}
          />
        ) : null}
      </div>
    );
  };

  if (loading) {
    return (
      <div className={`flex justify-center ${variant === 'sidebar' ? 'py-2' : 'py-4'}`}>
        <Loader2 size={16} className="animate-spin text-muted" />
      </div>
    );
  }

  if (!sessions.length) {
    return (
      <p className="px-2 text-[10px] text-muted leading-snug">
        Send a message in Agent Sam to start a chat.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-h-0 max-h-[42vh] overflow-y-auto chat-hide-scroll px-1">
      {starred.length > 0 ? (
        <div>
          <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted opacity-70">
            Starred
          </div>
          {starred.map((s) => renderRow(s))}
        </div>
      ) : null}
      <div>
        <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted opacity-70">
          Recents
        </div>
        {recents.slice(0, RECENT_TEASER_LIMIT).map((s) => renderRow(s))}
      </div>
      <style>{`.chat-hide-scroll::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
};
