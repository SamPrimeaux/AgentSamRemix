/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { AgentPresence } from './presenceTypes';
import type { AgentMode } from '../../components/ChatAssistant/types';
import { ChatPresenceIcon } from '../mode-presence/ChatPresenceIcon';

export type AgentPresenceStatusProps = {
  presence: AgentPresence;
  mode?: AgentMode;
  /** Visually subtle badge for state (screen readers get label text). */
  showBadge?: boolean;
  /** Animated mode-presence icon beside the label. */
  showIcon?: boolean;
  className?: string;
};

export const AgentPresenceStatus: React.FC<AgentPresenceStatusProps> = ({
  presence,
  mode = 'agent',
  showBadge = true,
  showIcon = true,
  className = '',
}) => (
  <div className={`min-w-0 ${className}`} role="status" aria-live="polite" aria-atomic="true">
    <div className="flex items-center gap-2 min-w-0">
      {showIcon && presence.state !== 'idle' ? (
        <ChatPresenceIcon mode={mode} state={presence.state} size={14} className="shrink-0" />
      ) : null}
      {showBadge ? (
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-[var(--dashboard-border)]/80 text-[var(--dashboard-muted)] bg-[var(--scene-bg)]/90"
          data-presence-state={presence.state}
        >
          {presence.state.replace(/_/g, ' ')}
        </span>
      ) : null}
      <p className="text-[11px] text-[var(--dashboard-text)] leading-snug truncate m-0 flex-1">{presence.label}</p>
    </div>
    {presence.detail ? (
      <p className="text-[10px] text-[var(--dashboard-muted)] font-mono truncate m-0 mt-0.5 pl-[22px]" title={presence.detail}>
        {presence.detail}
      </p>
    ) : null}
  </div>
);
