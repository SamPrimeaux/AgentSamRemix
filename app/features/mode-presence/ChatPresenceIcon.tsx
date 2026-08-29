import React from 'react';
import type { AgentMode } from '../../components/ChatAssistant/types';
import { AgentModePresenceIcon } from './AgentModePresenceIcon';
import { normalizeChatPresenceState } from './normalizeChatPresenceState';
import type { ModePresenceIconKey } from './agentModePresenceMap';

export type ChatPresenceIconProps = {
  mode?: AgentMode;
  state?: string | null;
  /** Direct icon when lane/tool is known — skips generic state fallback. */
  iconKey?: ModePresenceIconKey;
  size?: number;
  className?: string;
  cardStatus?: 'thinking' | 'working' | 'blocked' | 'done' | 'error';
};

/** Unified chat presence glyph — mode colors + lab motion (Loading States + Mode Presence libraries). */
export function ChatPresenceIcon({
  mode = 'agent',
  state,
  iconKey,
  size = 16,
  className = '',
  cardStatus,
}: ChatPresenceIconProps) {
  const normalized = normalizeChatPresenceState(state, mode, { cardStatus });

  return (
    <AgentModePresenceIcon
      mode={mode}
      state={normalized}
      iconKey={iconKey}
      size={size}
      className={className}
      aria-label=""
    />
  );
}
