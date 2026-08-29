/**
 * Minimal chat loading row — animated mode-presence SVG + shimmer label + elapsed.
 * Keeps long “Working…” waits from looking hung (no DO/outbox spam required).
 */
import React, { useEffect, useState } from 'react';
import type { AgentMode } from '../../components/ChatAssistant/types';
import type { AgentPresenceState, ModePresenceIconKey } from './agentModePresenceMap';
import { AgentModePresenceIcon } from './AgentModePresenceIcon';
import './agentPresenceInline.css';

export type AgentPresenceGlyphRowProps = {
  mode?: AgentMode;
  state?: AgentPresenceState | string | null;
  iconKey?: ModePresenceIconKey;
  label?: string;
  /** Icon box size in px — default 22 (readable pulse; thread uses compact). */
  size?: number;
  className?: string;
  /** When true (default), shimmer label + icon motion + live elapsed. */
  active?: boolean;
  /** Epoch ms when the wait started — drives “· 12s” so time visibly advances. */
  startedAt?: number | null;
};

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function AgentPresenceGlyphRow({
  mode = 'agent',
  state,
  iconKey,
  label,
  size = 22,
  className = '',
  active = true,
  startedAt = null,
}: AgentPresenceGlyphRowProps) {
  const aria = label?.trim() || 'Working';
  const [elapsedMs, setElapsedMs] = useState(() =>
    startedAt && active ? Math.max(0, Date.now() - startedAt) : 0,
  );

  useEffect(() => {
    if (!active || !startedAt) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(Math.max(0, Date.now() - startedAt));
    const id = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAt));
    }, 250);
    return () => clearInterval(id);
  }, [active, startedAt]);

  const showElapsed = active && startedAt != null && elapsedMs >= 500;
  const title = label?.trim() || (active ? 'Working…' : '');

  return (
    <div
      className={`iam-presence-glyph-row flex items-center gap-2.5 min-w-0 py-1.5${
        active ? ' iam-presence-glyph-row--active' : ''
      } ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={showElapsed ? `${aria} ${formatElapsed(elapsedMs)}` : aria}
    >
      <span className="iam-presence-glyph-mark shrink-0" style={{ width: size, height: size }}>
        <span className="iam-presence-glyph-spinner" aria-hidden />
        <AgentModePresenceIcon
          mode={mode}
          state={state as AgentPresenceState | undefined}
          iconKey={iconKey}
          size={size}
          motion={active}
          aria-label=""
          className="iam-presence-glyph-icon"
        />
      </span>
      {title ? (
        <span className="min-w-0 flex items-baseline gap-1.5">
          <span
            className={`truncate text-[13px] font-medium leading-snug${
              active ? ' agent-presence-label--shimmer' : ' text-[var(--dashboard-text)]'
            }`}
          >
            {title}
          </span>
          {showElapsed ? (
            <span className="iam-presence-glyph-elapsed shrink-0 tabular-nums">
              {formatElapsed(elapsedMs)}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
