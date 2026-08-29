import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, ChevronDown, ChevronUp,
  Terminal as TerminalIcon, Wifi, WifiOff, RefreshCw,
  Plus, Columns2, ChevronRight,
} from 'lucide-react';
import type { TerminalConnectionStatus, TerminalSessionPaneHandle } from '../TerminalSessionPane';
import type { TerminalTarget } from '../LocalTerminalSetup';
import { SHELL_CHOICES, statusMessage, type ShellTab } from './shellTypes';
import type { TunnelHealth } from './useTunnelHealth';

const LANE_OPTIONS = [
  { action: 'local' as const, label: 'Local', hint: 'Your machine · localpty' },
  { action: 'cloud' as const, label: 'VM', hint: 'GCP · iam-tunnel' },
  { action: 'sandbox' as const, label: 'Sandbox', hint: 'CF container' },
];

export type TerminalShellChromeProps = {
  activeTab: ShellTab;
  setActiveTab: (t: ShellTab) => void;
  errorCount: number;
  warningCount: number;
  /** null = user has not chosen a lane yet (do not invent platform_vm). */
  terminalTarget: TerminalTarget | null;
  connectionTargetLabel: string;
  /** Server binding receipt — lane · host when Connected (no cwd/pwd). */
  bindingTrustLabel?: string | null;
  targetMenuOpen: boolean;
  setTargetMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  targetMenuRef: React.RefObject<HTMLDivElement | null>;
  mobileTargetMenuRef: React.RefObject<HTMLDivElement | null>;
  switchTerminalLane: (action: 'local' | 'cloud' | 'sandbox') => void;
  showSplash: boolean;
  setupWizardActive: boolean;
  primaryStatus: TerminalConnectionStatus;
  secondaryStatus: TerminalConnectionStatus;
  primarySessionId: string | null;
  uptime: number;
  fmtUptime: (s: number) => string;
  splitEnabled: boolean;
  setSplitEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  primaryPaneRef: React.RefObject<TerminalSessionPaneHandle | null>;
  secondaryPaneRef: React.RefObject<TerminalSessionPaneHandle | null>;
  tunnelHealth: TunnelHealth | null;
  restarting: boolean;
  handleTunnelRestart: () => void;
  shellPref: string;
  setShellPref: (path: string) => void;
  plusMenuRef: React.RefObject<HTMLDivElement | null>;
  plusMenuOpen: boolean;
  setPlusMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  splitSubOpen: boolean;
  setSplitSubOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleConfigureTerminalSettings: () => void;
  isDrawer: boolean;
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  onClose: () => void;
};

export function TerminalShellChrome({
  activeTab,
  setActiveTab,
  errorCount,
  warningCount,
  terminalTarget,
  connectionTargetLabel,
  bindingTrustLabel = null,
  targetMenuOpen,
  setTargetMenuOpen,
  targetMenuRef,
  mobileTargetMenuRef,
  switchTerminalLane,
  showSplash,
  setupWizardActive,
  primaryStatus,
  secondaryStatus,
  primarySessionId,
  uptime,
  fmtUptime,
  splitEnabled,
  setSplitEnabled,
  primaryPaneRef,
  secondaryPaneRef,
  tunnelHealth,
  restarting,
  handleTunnelRestart,
  shellPref,
  setShellPref,
  plusMenuRef,
  plusMenuOpen,
  setPlusMenuOpen,
  splitSubOpen,
  setSplitSubOpen,
  handleConfigureTerminalSettings,
  isDrawer,
  isCollapsed,
  setIsCollapsed,
  onClose,
}: TerminalShellChromeProps) {
  const shellShort =
    shellPref.replace(/^\/bin\//, '').replace(/^\/usr\/bin\//, '') || shellPref;
  const mobileLaneBtnRef = useRef<HTMLButtonElement | null>(null);
  const [mobileLaneMenuPos, setMobileLaneMenuPos] = useState<{
    bottom: number;
    right: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!targetMenuOpen) {
      setMobileLaneMenuPos(null);
      return;
    }
    const update = () => {
      const el = mobileLaneBtnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport;
      const layoutH = vv ? vv.height + vv.offsetTop : window.innerHeight;
      const layoutW = vv ? vv.width + vv.offsetLeft : window.innerWidth;
      // Open upward into the chat area — terminal chrome sits at the bottom on phone.
      setMobileLaneMenuPos({
        bottom: Math.max(8, layoutH - r.top + 6),
        right: Math.max(8, layoutW - r.right),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [targetMenuOpen]);

  const mobileLaneMenu =
    targetMenuOpen &&
    mobileLaneMenuPos &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        data-iam-lane-menu="1"
        role="menu"
        className="fixed z-[400] min-w-[176px] rounded-md border border-[var(--dashboard-border)] bg-[var(--bg-elevated)] py-1 shadow-2xl"
        style={{
          bottom: mobileLaneMenuPos.bottom,
          right: mobileLaneMenuPos.right,
        }}
      >
        {LANE_OPTIONS.map((opt) => {
          const active =
            (opt.action === 'local' && terminalTarget === 'user_hosted_tunnel') ||
            (opt.action === 'cloud' && terminalTarget === 'platform_vm') ||
            (opt.action === 'sandbox' && terminalTarget === 'sandbox');
          return (
            <button
              key={opt.action}
              type="button"
              role="menuitem"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => switchTerminalLane(opt.action)}
              className={`w-full px-3 py-2.5 text-left text-[11px] font-mono touch-manipulation ${
                active
                  ? 'bg-[var(--solar-cyan)]/10 text-[var(--solar-cyan)]'
                  : 'text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-hover)]'
              }`}
            >
              <div>{opt.label}</div>
              <div className={`text-[9px] ${active ? 'opacity-70' : 'text-[var(--dashboard-muted)]'}`}>
                {opt.hint}
              </div>
            </button>
          );
        })}
      </div>,
      document.body,
    );

  return (
    <div
      className="iam-terminal-chrome-row relative z-[60] h-9 min-h-9 shrink-0 flex items-center justify-between px-2 pl-3 border-b border-[var(--dashboard-border)] select-none gap-2 overflow-visible text-[var(--dashboard-topbar-text)]"
      style={{ background: 'var(--terminal-chrome)' }}
    >
      <div className="iam-terminal-chrome-tabs flex items-center gap-2 min-w-0 flex-1">
        <div className="flex items-stretch gap-0 shrink-0 min-w-0">
          {(['terminal', 'output', 'problems'] as ShellTab[]).map((tab) => {
            const badge =
              tab === 'problems' && errorCount + warningCount > 0
                ? errorCount > 0
                  ? errorCount
                  : warningCount
                : null;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`relative px-3 py-2 text-[10px] font-bold tracking-[0.14em] uppercase transition-colors flex items-center gap-1.5 max-phone:px-[10px] max-phone:py-[6px] max-phone:text-[11px] max-phone:font-medium max-phone:tracking-[0.04em] max-phone:normal-case ${
                  activeTab === tab
                    ? 'text-[var(--solar-cyan)]'
                    : 'text-[var(--terminal-tab-muted)] hover:text-main'
                }`}
              >
                {tab === 'terminal' && <TerminalIcon size={9} />}
                {tab}
                {badge !== null && (
                  <span className="px-1 py-0.5 rounded text-[8px] bg-[var(--solar-red)]/20 text-[var(--solar-red)] border border-[var(--solar-red)]/30">
                    {badge}
                  </span>
                )}
                {activeTab === tab && (
                  <span className="absolute bottom-0 left-1 right-1 h-0.5 rounded-sm bg-[var(--solar-cyan)] shadow-[0_0_6px_var(--solar-cyan)]" />
                )}
              </button>
            );
          })}
        </div>

        <div className="hidden sm:flex items-center h-5 w-px bg-[var(--border-subtle)] shrink-0" />

        <div className="relative hidden sm:block shrink-0" ref={targetMenuRef}>
          <button
            type="button"
            onClick={() => setTargetMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-[var(--border-subtle)] text-[10px] font-mono uppercase tracking-wide text-muted hover:text-main hover:border-[var(--solar-cyan)]/40 hover:bg-[var(--bg-hover)] transition-colors"
            title="Switch terminal lane"
            aria-haspopup="menu"
            aria-expanded={targetMenuOpen}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                terminalTarget === 'user_hosted_tunnel'
                  ? 'bg-[var(--solar-yellow)]'
                  : terminalTarget === 'sandbox'
                    ? 'bg-[var(--solar-green)]'
                    : 'bg-[var(--solar-cyan)]'
              }`}
            />
            {connectionTargetLabel}
            <ChevronDown size={10} className={`opacity-70 transition-transform ${targetMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {targetMenuOpen && (
            <div
              role="menu"
              className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-[148px] rounded-md border border-[var(--border-subtle)] bg-[var(--terminal-surface)] py-1 shadow-lg"
            >
              {(
                [
                  { action: 'local' as const, label: 'Local', hint: 'Mac · localpty', active: terminalTarget === 'user_hosted_tunnel' },
                  { action: 'cloud' as const, label: 'VM', hint: 'GCP · iam-tunnel', active: terminalTarget === 'platform_vm' },
                  { action: 'sandbox' as const, label: 'Sandbox', hint: 'Isolated container', active: terminalTarget === 'sandbox' },
                ]
              ).map((opt) => (
                <button
                  key={opt.action}
                  type="button"
                  role="menuitem"
                  onClick={() => switchTerminalLane(opt.action)}
                  className={`w-full px-3 py-1.5 text-left text-[10px] font-mono transition-colors ${
                    opt.active
                      ? 'bg-[var(--solar-cyan)]/10 text-[var(--solar-cyan)]'
                      : 'text-muted hover:bg-[var(--bg-hover)] hover:text-main'
                  }`}
                >
                  <div className="uppercase tracking-wide">{opt.label}</div>
                  <div className="text-[9px] opacity-60 normal-case tracking-normal">{opt.hint}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-center h-5 w-px bg-[var(--border-subtle)] shrink-0" />

        <div className="hidden sm:flex items-center gap-1.5 shrink-0 min-w-0">
          {showSplash || setupWizardActive ? (
            <span className="text-[10px] font-mono text-muted flex items-center gap-1.5 truncate">
              <span className="h-2 w-2 rounded-full shrink-0 bg-[var(--text-muted)]/50" />
              Ready
            </span>
          ) : null}
          {!showSplash &&
            !setupWizardActive &&
            (primaryStatus === 'connecting' || primaryStatus === 'reconnecting') && (
            <span className="text-[10px] font-mono text-[var(--solar-yellow)] flex items-center gap-1.5 truncate">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--solar-yellow)] opacity-40" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--solar-yellow)]" />
              </span>
              {statusMessage(primaryStatus)}
            </span>
          )}
          {!showSplash && !setupWizardActive && primaryStatus === 'connected' && (
            <span className="text-[10px] font-mono text-[var(--solar-green)] flex items-center gap-1.5 truncate min-w-0">
              <span className="iam-online-dot h-2 w-2 rounded-full bg-[var(--solar-green)] inline-block shrink-0" />
              {statusMessage(primaryStatus)} · {fmtUptime(uptime)}
              {bindingTrustLabel ? (
                <span className="text-muted/70 truncate" title={bindingTrustLabel}>
                  {' '}
                  · {bindingTrustLabel}
                </span>
              ) : null}
              {primarySessionId && (
                <span className="text-muted/40 hidden md:inline shrink-0">
                  {' '}
                  · {primarySessionId.slice(0, 6)}…
                </span>
              )}
            </span>
          )}
          {!showSplash &&
            !setupWizardActive &&
            primaryStatus !== 'connected' &&
            primaryStatus !== 'connecting' &&
            primaryStatus !== 'reconnecting' && (
              <span className="text-[10px] font-mono text-[var(--solar-red)] flex items-center gap-1.5 truncate">
                <WifiOff size={10} />
                {statusMessage(primaryStatus)}
              </span>
            )}
          {splitEnabled && (
            <span className="text-[9px] font-mono text-muted shrink-0 hidden lg:inline">
              · split · {statusMessage(secondaryStatus)}
            </span>
          )}
        </div>

        {(primaryStatus === 'offline' ||
          primaryStatus === 'disconnected' ||
          primaryStatus === 'backend_unavailable' ||
          primaryStatus === 'timed_out') && (
          <button
            type="button"
            onClick={() => primaryPaneRef.current?.reconnectClean()}
            className="hidden sm:inline-flex items-center gap-1.5 ml-1 px-2 py-1 rounded border border-[var(--border-subtle)] text-[10px] font-mono text-muted hover:text-[var(--solar-cyan)] hover:border-[var(--solar-cyan)]/30 hover:bg-[var(--bg-hover)] transition-colors shrink-0"
            title="Retry terminal connection"
          >
            <RefreshCw size={11} />
            Retry
          </button>
        )}

        {tunnelHealth && (
          <>
            <div className="hidden md:flex items-center h-5 w-px bg-[var(--border-subtle)] shrink-0" />
            <div className="hidden md:flex items-center gap-1.5 shrink-0">
              {tunnelHealth.healthy ? (
                <Wifi size={9} className="text-[var(--solar-green)]" />
              ) : (
                <WifiOff size={9} className="text-[var(--solar-red)]" />
              )}
              <span
                className={`text-[9px] font-mono ${tunnelHealth.healthy ? 'text-[var(--solar-green)]' : 'text-[var(--solar-red)]'}`}
              >
                {tunnelHealth.healthy ? `Tunnel ×${tunnelHealth.connections}` : 'Tunnel ✗'}
              </span>
              <button
                onClick={handleTunnelRestart}
                disabled={restarting}
                title="Restart Cloudflare Tunnel"
                className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-muted hover:text-[var(--solar-yellow)] transition-colors disabled:opacity-40"
              >
                <RefreshCw size={9} className={restarting ? 'animate-spin' : ''} />
              </button>
            </div>
          </>
        )}
      </div>

      {activeTab === 'terminal' && (
      <div
        ref={mobileTargetMenuRef}
        className="flex sm:hidden items-center gap-1.5 shrink-0 relative z-[70]"
      >
        <button
          ref={mobileLaneBtnRef}
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPlusMenuOpen(false);
            setTargetMenuOpen((v) => !v);
          }}
          className="inline-flex min-h-8 items-center gap-1 rounded border border-[var(--dashboard-border)] px-2 text-[10px] font-mono text-[var(--dashboard-topbar-text)] touch-manipulation"
          title="Switch terminal lane"
          aria-haspopup="menu"
          aria-expanded={targetMenuOpen}
          aria-label={`Terminal lane: ${connectionTargetLabel}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${
            primaryStatus === 'connected' ? 'bg-[var(--solar-green)]' :
            primaryStatus === 'connecting' || primaryStatus === 'reconnecting' ? 'bg-[var(--solar-yellow)]' :
            'bg-[var(--solar-red)]'
          }`} />
          {connectionTargetLabel}
          <ChevronDown size={10} className={`opacity-70 transition-transform ${targetMenuOpen ? 'rotate-180' : ''}`} />
        </button>
        {(primaryStatus === 'connecting' || primaryStatus === 'reconnecting') && (
          <span className="text-[9px] font-mono text-[var(--solar-yellow)] shrink-0">
            {statusMessage(primaryStatus)}
          </span>
        )}
        {(primaryStatus === 'offline' || primaryStatus === 'disconnected' || primaryStatus === 'backend_unavailable' || primaryStatus === 'timed_out') && (
          <button
            type="button"
            onClick={() => primaryPaneRef.current?.reconnectClean()}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[var(--dashboard-border)] text-[var(--dashboard-topbar-text)] touch-manipulation"
            title={`Retry ${connectionTargetLabel} terminal`}
            aria-label={`Retry ${connectionTargetLabel} terminal`}
          >
            <RefreshCw size={12} />
          </button>
        )}
        {mobileLaneMenu}
      </div>
      )}

      <div className="iam-terminal-chrome-actions flex items-center gap-1 shrink-0">
        {activeTab === 'terminal' && (
          <>
            <span
              className="hidden sm:inline text-[10px] font-mono text-muted max-w-[72px] truncate"
              title={shellPref}
            >
              {shellShort}
            </span>
            <div className="relative block" ref={plusMenuRef}>
              <button
                type="button"
                title="Terminal menu (shell, split, settings)"
                className="inline-flex shrink-0 items-center justify-center p-1.5 rounded border border-[var(--border-subtle)] text-muted hover:text-[var(--solar-cyan)] hover:border-[var(--solar-cyan)]/40 hover:bg-[var(--bg-hover)]"
                onClick={() => setPlusMenuOpen((v) => !v)}
              >
                <Plus size={15} strokeWidth={2} />
              </button>
              {plusMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 py-1 min-w-[220px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-lg z-[80] text-left"
                  role="menu"
                >
                  <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted">
                    Lane
                  </div>
                  {(
                    [
                      { action: 'local' as const, label: 'Local', hint: 'Mac · localpty' },
                      { action: 'cloud' as const, label: 'VM', hint: 'GCP · iam-tunnel' },
                      { action: 'sandbox' as const, label: 'Sandbox', hint: 'Isolated container' },
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.action}
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-[var(--bg-hover)] text-main touch-manipulation"
                      onClick={() => {
                        setPlusMenuOpen(false);
                        switchTerminalLane(opt.action);
                      }}
                    >
                      <div className="uppercase tracking-wide">{opt.label}</div>
                      <div className="text-[9px] opacity-60 normal-case tracking-normal">{opt.hint}</div>
                    </button>
                  ))}
                  <div className="h-px bg-[var(--border-subtle)] my-1" />
                  <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted">
                    Shell
                  </div>
                  {SHELL_CHOICES.map(({ label, path }) => (
                    <button
                      key={path}
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-[var(--bg-hover)] text-main"
                      onClick={() => {
                        setShellPref(path);
                        setPlusMenuOpen(false);
                        primaryPaneRef.current?.reconnectClean();
                        if (splitEnabled) secondaryPaneRef.current?.reconnectClean();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                  <div className="h-px bg-[var(--border-subtle)] my-1" />
                  <button
                    type="button"
                    role="menuitem"
                    className="hidden sm:flex w-full text-left px-3 py-1.5 text-[11px] hover:bg-[var(--bg-hover)] text-main items-center justify-between gap-2"
                    onClick={() => setSplitSubOpen((s) => !s)}
                  >
                    Split terminal
                    <ChevronRight size={14} className={splitSubOpen ? 'rotate-90' : ''} />
                  </button>
                  {splitSubOpen && (
                    <div className="pl-2 pb-1 border-l border-[var(--border-subtle)] ml-3 mr-1">
                      <button
                        type="button"
                        className="w-full text-left px-2 py-1 text-[11px] font-mono rounded hover:bg-[var(--bg-hover)]"
                        onClick={() => {
                          setSplitEnabled(true);
                          setPlusMenuOpen(false);
                          setSplitSubOpen(false);
                        }}
                      >
                        Side by side
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-2 py-1 text-[11px] font-mono rounded hover:bg-[var(--bg-hover)] text-muted"
                        onClick={() => {
                          setPlusMenuOpen(false);
                          primaryPaneRef.current?.writeToTerminal(
                            'Stacked split: use the bottom drawer height resize for now; horizontal split is active.',
                          );
                        }}
                      >
                        Stacked (use panel resize)
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[var(--bg-hover)] text-main"
                    onClick={() => {
                      setPlusMenuOpen(false);
                      primaryPaneRef.current?.writeToTerminal(
                        'JavaScript Debug Terminal: use Cursor/VS Code locally for Node attach; this web PTY runs through ExecOS.',
                      );
                    }}
                  >
                    JavaScript Debug Terminal
                  </button>
                  <div className="h-px bg-[var(--border-subtle)] my-1" />
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[var(--bg-hover)] text-main"
                    onClick={() => void handleConfigureTerminalSettings()}
                  >
                    Configure Terminal Settings
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[var(--bg-hover)] text-main"
                    onClick={() => {
                      setPlusMenuOpen(false);
                      primaryPaneRef.current?.writeToTerminal(
                        `Default shell for new connections: ${shellPref} (saved in this browser).`,
                      );
                    }}
                  >
                    Select Default Profile
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              title={splitEnabled ? 'Single terminal' : 'Split terminal (side by side)'}
              className={`hidden sm:inline-flex shrink-0 p-1.5 rounded border transition-colors ${
                splitEnabled
                  ? 'border-[var(--solar-cyan)]/50 bg-[var(--solar-cyan)]/10 text-[var(--solar-cyan)]'
                  : 'border-transparent text-muted hover:text-[var(--solar-cyan)] hover:border-[var(--solar-cyan)]/20'
              }`}
              onClick={() => setSplitEnabled((v) => !v)}
            >
              <Columns2 size={15} strokeWidth={2} />
            </button>
          </>
        )}

        {!isDrawer && (
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="shrink-0 p-1.5 max-phone:p-[6px] rounded hover:bg-[var(--bg-hover)] text-muted hover:text-main transition-colors"
            title={isCollapsed ? 'Expand terminal' : 'Minimize terminal'}
          >
            {isCollapsed ? <ChevronUp size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-1.5 max-phone:p-[6px] rounded hover:bg-[var(--bg-hover)] text-muted hover:text-[var(--solar-red)] transition-colors"
          title="Close"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
