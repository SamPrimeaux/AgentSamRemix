import React from 'react';
import type { AgentMode, ModePresenceIconKey } from './agentModePresenceMap';
import { ChatPresenceIcon } from './ChatPresenceIcon';
import { normalizeChatPresenceState } from './normalizeChatPresenceState';
import './agentPresenceInline.css';

export type AgentPresenceInlineProps = {
  mode?: AgentMode;
  state?: string | null;
  title: string;
  meta?: string;
  expanded?: boolean;
  onToggle?: () => void;
  statusLabel?: string;
  size?: 'sm' | 'md';
  /** Override shimmer label font size (px). */
  titleFontSizePx?: number;
  /** CSS hover stop pill — subagent rows only. */
  onStop?: (e: React.MouseEvent) => void;
  onClick?: () => void;
  cardStatus?: 'thinking' | 'working' | 'blocked' | 'done' | 'error';
  /** Direct lane icon — skips generic state → icon fallback. */
  iconKey?: ModePresenceIconKey;
  /** When set, overrides cardStatus-derived shimmer (from resolveInlinePresenceDisplay). */
  shimmer?: boolean;
};

function shouldShimmer(
  cardStatus: AgentPresenceInlineProps['cardStatus'],
  shimmerOverride: boolean | undefined,
  state: string | null | undefined,
  mode: AgentMode,
): boolean {
  if (typeof shimmerOverride === 'boolean') return shimmerOverride;
  if (cardStatus === 'thinking' || cardStatus === 'working') return true;
  if (cardStatus === 'blocked' || cardStatus === 'done' || cardStatus === 'error') return false;
  const normalized = normalizeChatPresenceState(state, mode);
  return !['idle', 'complete', 'failed', 'approval_required'].includes(normalized);
}

export function AgentPresenceInline({
  mode = 'agent',
  state,
  title,
  meta,
  expanded,
  onToggle,
  statusLabel,
  size = 'md',
  titleFontSizePx,
  onStop,
  onClick,
  cardStatus,
  iconKey,
  shimmer: shimmerOverride,
}: AgentPresenceInlineProps) {
  /** 2× prior sizes so loading-state SVGs read clearly in the thread. */
  const iconPx = size === 'sm' ? 32 : 44;
  const textSize = titleFontSizePx ?? (size === 'sm' ? 12 : 12);
  const metaSize = size === 'sm' ? 11 : 11;
  const shimmer = shouldShimmer(cardStatus, shimmerOverride, state, mode);
  const rowClass = `agent-inline-row min-w-0 flex-1${onClick ? ' agent-inline-row--clickable' : ''}`;

  const inner = (
    <div className={rowClass} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      <ChatPresenceIcon mode={mode} state={state} iconKey={iconKey} size={iconPx} cardStatus={cardStatus} className="shrink-0" />
      <div className="min-w-0 flex-1 pr-14">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`truncate ${shimmer ? 'agent-presence-label--shimmer' : ''}`}
            style={{
              fontSize: textSize,
              fontWeight: shimmer ? 500 : 450,
              color: shimmer ? undefined : 'var(--color-text-secondary, var(--dashboard-muted, #8a8a9e))',
            }}
          >
            {title}
          </span>
          {statusLabel ? (
            <span
              className="shrink-0"
              style={{
                fontSize: 9,
                fontWeight: 900,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                padding: '3px 7px',
                borderRadius: 999,
                border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
                color: 'var(--text-muted, #8a8a9e)',
                background: 'color-mix(in srgb, var(--bg-app, #0b0b10) 88%, transparent)',
              }}
            >
              {statusLabel}
            </span>
          ) : null}
        </div>
        {meta ? (
          <div
            className="truncate"
            style={{
              marginTop: 1,
              fontSize: metaSize,
              color: 'var(--text-muted, #8a8a9e)',
              fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
            }}
          >
            {meta}
          </div>
        ) : null}
      </div>
      {onStop ? (
        <button
          type="button"
          className="stop-pill"
          onClick={(e) => {
            e.stopPropagation();
            onStop(e);
          }}
        >
          stop
        </button>
      ) : null}
      {typeof expanded === 'boolean' ? (
        <span
          className="shrink-0"
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRight: '2px solid var(--text-muted, #8a8a9e)',
            borderBottom: '2px solid var(--text-muted, #8a8a9e)',
            transform: expanded ? 'rotate(-135deg)' : 'rotate(45deg)',
            opacity: 0.6,
            marginLeft: 2,
            transition: 'transform 140ms ease',
          }}
        />
      ) : null}
    </div>
  );

  if (!onToggle) return inner;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full text-left"
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
      }}
    >
      {inner}
    </button>
  );
}
