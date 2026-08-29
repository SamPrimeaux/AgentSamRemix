/**
 * @file app/dashboard/components/WorkspaceTerminalTile.tsx
 *
 * Quick-launch tile shown in the workspace list and "Also open" footer.
 * Displays per-workspace terminal status inline (no separate status fetch needed —
 * parent passes splashStatus from useTerminalWorkspace).
 *
 * One click → activates workspace + opens terminal scoped to it.
 *
 * Used in:
 *   - WorkspaceLauncher (replaces the plain "Open" button)
 *   - Workspace "Also open" / multi-repo footer rows
 *   - Any future workspace grid/list
 */

import React from 'react';
import { Terminal, GitBranch, Clock, Cpu, Wifi, WifiOff, Box } from 'lucide-react';
import type { WorkspaceTerminalPrefs } from '../hooks/useTerminalWorkspace';

type LaneStatus = 'ready' | 'offline' | 'pending' | 'error' | 'checking';

type LaneSummary = {
  local:   { ready: boolean; platform?: string | null };
  cloud:   { ready: boolean; via_pty_service?: boolean };
  sandbox: { ready: boolean };
};

export type WorkspaceTerminalTileProps = {
  workspaceId: string;
  displayName: string;
  slug?: string | null;
  githubRepo?: string | null;
  /** From useTerminalWorkspace or localStorage */
  prefs?: WorkspaceTerminalPrefs | null;
  /** Lane summary — if provided, shows live status dots */
  lanes?: LaneSummary | null;
  /** Overall PTY readiness */
  canRunPty?: boolean;
  /** Whether this is the currently active workspace */
  isActive?: boolean;
  /** Compact mode for "Also open" footer */
  compact?: boolean;
  onOpen: (workspaceId: string) => void;
  className?: string;
};

const LANE_ICONS = {
  user_hosted_tunnel: Wifi,
  platform_vm:        Cpu,
  sandbox:            Box,
} as const;

function LaneDot({ ready, title }: { ready: boolean; title: string }) {
  return (
    <span
      title={title}
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
        ready ? 'bg-[var(--solar-cyan)]' : 'bg-[var(--border-subtle)]'
      }`}
    />
  );
}

function formatLastConnected(ts: number | null | undefined): string {
  if (!ts) return '';
  const sec = ts > 1e12 ? Math.floor(ts / 1000) : ts;
  const now = Math.floor(Date.now() / 1000);
  const d = Math.max(0, now - sec);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

/**
 * Compact inline chip for the "Also open" footer.
 */
export function WorkspaceTerminalChip({
  workspaceId,
  displayName,
  prefs,
  onOpen,
}: Pick<WorkspaceTerminalTileProps, 'workspaceId' | 'displayName' | 'prefs' | 'onOpen'>) {
  return (
    <button
      type="button"
      onClick={() => onOpen(workspaceId)}
      title={`Open terminal for ${displayName}`}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)]/60 hover:border-[var(--solar-cyan)]/40 hover:bg-[var(--bg-hover)]/40 transition-colors text-[11px] font-mono text-muted hover:text-main"
    >
      <Terminal size={10} className="shrink-0" />
      <span className="truncate max-w-[120px]">{displayName}</span>
      {prefs?.lastConnectedAt ? (
        <span className="text-[9px] opacity-60">{formatLastConnected(prefs.lastConnectedAt)}</span>
      ) : null}
    </button>
  );
}

/**
 * Full tile for workspace list / launcher.
 */
export function WorkspaceTerminalTile({
  workspaceId,
  displayName,
  slug,
  githubRepo,
  prefs,
  lanes,
  canRunPty,
  isActive = false,
  compact = false,
  onOpen,
  className = '',
}: WorkspaceTerminalTileProps) {
  const repoShort = githubRepo
    ? githubRepo.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '')
    : null;

  const PreferredIcon = prefs?.targetType ? (LANE_ICONS[prefs.targetType] ?? Terminal) : Terminal;

  const anyReady = lanes
    ? lanes.local.ready || lanes.cloud.ready || lanes.sandbox.ready
    : canRunPty !== false;

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => onOpen(workspaceId)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left w-full ${
          isActive
            ? 'border-[var(--solar-cyan)]/50 bg-[var(--solar-cyan)]/5 text-main'
            : 'border-[var(--border-subtle)] bg-[var(--bg-app)]/40 hover:border-[var(--solar-cyan)]/30 hover:bg-[var(--bg-hover)]/40 text-muted hover:text-main'
        } ${className}`}
      >
        <PreferredIcon size={14} className={isActive ? 'text-[var(--solar-cyan)]' : ''} />
        <span className="flex-1 min-w-0 text-[12px] font-mono truncate">
          {slug || displayName}
        </span>
        {lanes ? (
          <span className="flex items-center gap-1 shrink-0">
            <LaneDot ready={lanes.local.ready}   title="Local" />
            <LaneDot ready={lanes.cloud.ready}   title="Cloud VM" />
            <LaneDot ready={lanes.sandbox.ready} title="Sandbox" />
          </span>
        ) : null}
        {isActive ? (
          <span className="text-[9px] text-[var(--solar-cyan)] font-bold uppercase shrink-0">
            active
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div
      className={`flex flex-col sm:flex-row items-stretch gap-2 p-2.5 sm:p-3 rounded-xl border transition-colors ${
        isActive
          ? 'border-[var(--solar-cyan)]/40 bg-[var(--solar-cyan)]/5'
          : 'border-[var(--border-subtle)] bg-[var(--bg-app)]/40 hover:bg-[var(--bg-hover)]/50'
      } ${className}`}
    >
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <PreferredIcon
            size={14}
            className={`shrink-0 ${isActive ? 'text-[var(--solar-cyan)]' : 'text-muted'}`}
          />
          <span className="font-bold text-[var(--text-heading)] truncate text-[13px] sm:text-sm min-w-0">
            {displayName || slug}
          </span>
          {isActive ? (
            <span className="text-[9px] text-[var(--solar-cyan)] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[var(--solar-cyan)]/10 shrink-0">
              active
            </span>
          ) : null}
        </div>

        <div className="text-[10px] sm:text-[11px] text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5 min-w-0 pl-5">
          {repoShort ? (
            <span className="flex items-center gap-1 truncate">
              <GitBranch size={9} /> {repoShort}
            </span>
          ) : null}
          {prefs?.lastConnectedAt ? (
            <span className="flex items-center gap-1 shrink-0">
              <Clock size={9} /> {formatLastConnected(prefs.lastConnectedAt)}
            </span>
          ) : null}
          {prefs?.cwd ? (
            <span className="font-mono truncate opacity-70">{prefs.cwd}</span>
          ) : null}
        </div>

        {/* Lane status dots */}
        {lanes ? (
          <div className="flex items-center gap-2 mt-1.5 pl-5">
            <span className="flex items-center gap-1 text-[10px] text-muted">
              <LaneDot ready={lanes.local.ready} title="Local tunnel" />
              <span className={lanes.local.ready ? 'text-[var(--solar-cyan)]' : ''}>
                {lanes.local.platform || 'Local'}
              </span>
            </span>
            <span className="flex items-center gap-1 text-[10px] text-muted">
              <LaneDot ready={lanes.cloud.ready} title="Cloud VM" />
              <span className={lanes.cloud.ready ? 'text-[var(--solar-cyan)]' : ''}>
                {lanes.cloud.via_pty_service ? 'VM · VPC' : 'VM'}
              </span>
            </span>
            <span className="flex items-center gap-1 text-[10px] text-muted">
              <LaneDot ready={lanes.sandbox.ready} title="Sandbox container" />
              <span className={lanes.sandbox.ready ? 'text-[var(--solar-cyan)]' : ''}>
                Sandbox
              </span>
            </span>
          </div>
        ) : null}
      </div>

      {/* Open button */}
      <button
        type="button"
        onClick={() => onOpen(workspaceId)}
        disabled={!anyReady && canRunPty === false}
        className={`shrink-0 w-full sm:w-auto self-center flex items-center justify-center gap-1.5 px-4 py-2 sm:py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 ${
          anyReady || canRunPty !== false
            ? 'bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/30'
            : 'bg-[var(--bg-hover)] text-muted cursor-not-allowed'
        }`}
        title={anyReady ? `Open terminal in ${displayName}` : 'Terminal not available for this workspace'}
      >
        <Terminal size={12} />
        {anyReady || canRunPty !== false ? 'Open' : 'Not ready'}
      </button>
    </div>
  );
}
