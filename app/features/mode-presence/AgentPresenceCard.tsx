import React from 'react';
import type { AgentMode, AgentPresenceState } from './agentModePresenceMap';
import { AgentModePresenceIcon } from './AgentModePresenceIcon';

export type AgentPresenceCardProps = {
  mode?: AgentMode;
  state?: AgentPresenceState;
  title: string;
  description?: string;
  meta?: string;
  children?: React.ReactNode;
  compact?: boolean;
};

export function AgentPresenceCard({
  mode,
  state,
  title,
  description,
  meta,
  children,
  compact = false,
}: AgentPresenceCardProps) {
  return (
    <div
      className="rounded-2xl border border-[var(--dashboard-border,var(--border-subtle))] bg-[var(--scene-bg,var(--bg-panel))] shadow-[0_12px_36px_color-mix(in_srgb,#000_22%,transparent)]"
      style={{ padding: compact ? 10 : 14 }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 grid place-items-center"
          style={{
            width: compact ? 32 : 44,
            height: compact ? 32 : 44,
            color: 'var(--solar-cyan, #22d3ee)',
            filter: 'drop-shadow(0 0 12px color-mix(in srgb, var(--solar-cyan, #22d3ee) 35%, transparent))',
          }}
        >
          <AgentModePresenceIcon
            mode={mode}
            state={state}
            size={compact ? 28 : 40}
            motion={state !== 'complete' && state !== 'idle'}
            aria-label=""
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[var(--dashboard-text,var(--text-main))] truncate">
            {title}
          </div>
          {description ? (
            <div className="mt-0.5 text-[11px] text-[var(--dashboard-muted,var(--text-muted))] leading-snug">
              {description}
            </div>
          ) : null}
          {meta ? (
            <div className="mt-1 text-[10px] text-[var(--dashboard-muted,var(--text-muted))] font-mono truncate">
              {meta}
            </div>
          ) : null}
        </div>
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

