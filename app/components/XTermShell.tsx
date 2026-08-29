import React, {
  useEffect, useRef, useState, useImperativeHandle,
  forwardRef, useCallback,
} from 'react';
import {
  X, TriangleAlert, CircleCheck,
} from 'lucide-react';
import {
  TerminalSessionPane,
  TerminalSessionPaneHandle,
} from './TerminalSessionPane';
import {
  DEFAULT_PRODUCT,
  type ShellTab,
  type XTermShellHandle,
  type XTermShellProps,
} from './terminal/shellTypes';
import { useTerminalPanelHeight } from './terminal/useTerminalPanelHeight';
import { useTerminalLaneConnect } from './terminal/useTerminalLaneConnect';
import { useTunnelHealth } from './terminal/useTunnelHealth';
import { TerminalShellChrome } from './terminal/TerminalShellChrome';

export type { ShellTab, XTermShellHandle } from './terminal/shellTypes';

// ─── Main Component ───────────────────────────────────────────────────────────
export const XTermShell = forwardRef<XTermShellHandle, XTermShellProps>(
  (
    {
      onClose,
      problems = [],
      outputLines = [],
      onProblemsTabOpen,
      iamOrigin,
      workspaceCdCommand,
      agentDashboardUrl: _agentDashboardUrlProp,
      showIamWelcomeBar: _showIamWelcomeBar = true,
      workspaceLabel = '',
      workspaceId,
      targetType: targetTypeProp,
      onTargetTypeChange,
      splashStatus: splashStatusProp,
      splashStatusLoading = false,
      onConnected,
      productLabel: _productLabel = DEFAULT_PRODUCT,
      layout = 'page',
      workspaceContext: _workspaceContext = null,
      onOutputLine,
      sessionUserId: sessionUserIdProp,
      autoConnect = false,
    },
    ref,
  ) => {
    const primaryPaneRef = useRef<TerminalSessionPaneHandle>(null);
    const secondaryPaneRef = useRef<TerminalSessionPaneHandle>(null);
    const sessionUserId = sessionUserIdProp?.trim() || null;

    const {
      height,
      isCollapsed,
      setIsCollapsed,
      shellRootRef,
      handleDragStart,
      isDrawer,
    } = useTerminalPanelHeight(layout);

    const [activeTab, setActiveTab] = useState<ShellTab>('terminal');
    const problemsTabOpenedRef = useRef(false);
    const [resolvingProblemId, setResolvingProblemId] = useState<string | null>(null);
    const [bulkResolving, setBulkResolving] = useState(false);

    /** Dismiss = DELETE agentsam_error_log row(s), then refetch from SSOT. */
    const dismissProblems = useCallback(
      async (payload: {
        id?: string;
        older_than_days?: number;
        resolve_all?: boolean;
      }) => {
        const ws = String(workspaceId || '').trim();
        if (!ws) {
          console.warn('[problems] workspace_id required to delete agentsam_error_log rows');
          return false;
        }
        const res = await fetch('/api/agent/problems/resolve', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-IAM-Workspace-Id': ws,
          },
          body: JSON.stringify({ ...payload, workspace_id: ws }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.warn('[problems] delete failed', res.status, err);
          return false;
        }
        // Re-read from agentsam_error_log — no client-side hide cache
        onProblemsTabOpen?.();
        return true;
      },
      [onProblemsTabOpen, workspaceId],
    );

    useEffect(() => {
      if (activeTab !== 'problems') {
        problemsTabOpenedRef.current = false;
        return;
      }
      if (problemsTabOpenedRef.current) return;
      problemsTabOpenedRef.current = true;
      onProblemsTabOpen?.();
    }, [activeTab, onProblemsTabOpen]);

    const lane = useTerminalLaneConnect({
      workspaceId,
      workspaceLabel,
      iamOrigin,
      workspaceCdCommand,
      targetTypeProp,
      onTargetTypeChange,
      splashStatusProp,
      splashStatusLoading,
      onConnected,
      sessionUserId,
      autoConnect,
      isCollapsed,
      setIsCollapsed,
      activeTab,
      setActiveTab,
      primaryPaneRef,
      secondaryPaneRef,
    });

    const {
      tunnelHealth,
      setTunnelHealth,
      restarting,
      handleTunnelRestart,
    } = useTunnelHealth(primaryPaneRef, {
      statusPath:
        lane.terminalTarget === 'user_hosted_tunnel'
          ? '/api/tunnel/status/local'
          : lane.terminalTarget === 'sandbox'
            ? '/api/tunnel/status/sandbox'
            : lane.terminalTarget === 'platform_vm'
              ? '/api/tunnel/status/remote'
              : '/api/tunnel/status/disconnected',
    });

    useImperativeHandle(ref, () => ({
      writeToTerminal: (text: string) => {
        setIsCollapsed(false);
        setActiveTab('terminal');
        primaryPaneRef.current?.writeToTerminal(text);
      },
      runCommand: (cmd: string) => {
        setIsCollapsed(false);
        setActiveTab('terminal');
        primaryPaneRef.current?.runCommand(cmd);
      },
      setActiveTab: (t: ShellTab) => {
        setActiveTab(t);
        setIsCollapsed(false);
      },
      disconnect: () => {
        primaryPaneRef.current?.disconnectQuiet();
        if (lane.splitEnabled) secondaryPaneRef.current?.disconnectQuiet();
        lane.setPrimaryStatus('disconnected');
        lane.setSecondaryStatus('disconnected');
      },
    }), [
      lane.splitEnabled,
      lane.setPrimaryStatus,
      lane.setSecondaryStatus,
      setIsCollapsed,
      workspaceId,
    ]);

    const errorCount = problems.filter((p) => p.severity === 'error').length;
    const warningCount = problems.filter((p) => p.severity === 'warning').length;

    return (
      <>
        <style>{`
          .iam-scanlines::after {
            content: '';
            position: absolute; inset: 0;
            background: repeating-linear-gradient(
              to bottom,
              transparent, transparent 2px,
              rgba(0,0,0,0.05) 2px, rgba(0,0,0,0.05) 4px
            );
            pointer-events: none; z-index: 1;
          }
          @keyframes iam-pulse-cyan {
            0%, 100% { box-shadow: 0 0 4px var(--solar-cyan); }
            50%       { box-shadow: 0 0 12px var(--solar-cyan); }
          }
          .iam-online-dot { animation: iam-pulse-cyan 2s ease-in-out infinite; }
          .iam-terminal-chrome-fill {
            flex: 1 1 0%;
            min-height: 0;
            min-width: 0;
            display: flex;
            flex-direction: column;
            background: var(--terminal-surface);
          }
        `}</style>

        <div
          ref={shellRootRef}
          className="iam-terminal-shell-root iam-scanlines relative flex flex-col shadow-[0_-4px_20px_rgba(0,0,0,0.3)] shrink-0 border-t border-[var(--dashboard-border)]"
          style={{
            height: isDrawer ? '100%' : isCollapsed ? '36px' : `${height}px`,
            background: 'var(--terminal-chrome)',
            transition: isDrawer ? 'none' : 'height 0.2s ease-out',
            zIndex: 50,
            ...(isDrawer ? { flex: '1 1 0%', minHeight: 0 } : null),
          }}
        >
          {!isDrawer && !isCollapsed && (
            <div
              className="iam-terminal-height-resizer h-5 max-phone:h-5 w-full shrink-0 cursor-ns-resize group flex items-center justify-center touch-none select-none"
              style={{ touchAction: 'none' }}
              onPointerDown={handleDragStart}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Drag to resize terminal"
              title="Drag to resize terminal"
            >
              <div className="iam-terminal-resize-pill h-px w-16 max-phone:h-1 rounded-full bg-[var(--dashboard-border)] group-hover:bg-[var(--solar-cyan)] group-active:bg-[var(--solar-cyan)] group-hover:w-24 transition-all duration-200" />
            </div>
          )}

          <TerminalShellChrome
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            errorCount={errorCount}
            warningCount={warningCount}
            terminalTarget={lane.terminalTarget}
            connectionTargetLabel={lane.connectionTargetLabel}
            bindingTrustLabel={lane.bindingTrustLabel}
            targetMenuOpen={lane.targetMenuOpen}
            setTargetMenuOpen={lane.setTargetMenuOpen}
            targetMenuRef={lane.targetMenuRef}
            mobileTargetMenuRef={lane.mobileTargetMenuRef}
            switchTerminalLane={lane.switchTerminalLane}
            showSplash={lane.showSplash}
            setupWizardActive={lane.setupWizardActive}
            primaryStatus={lane.primaryStatus}
            secondaryStatus={lane.secondaryStatus}
            primarySessionId={lane.primarySessionId}
            uptime={lane.uptime}
            fmtUptime={lane.fmtUptime}
            splitEnabled={lane.splitEnabled}
            setSplitEnabled={lane.setSplitEnabled}
            primaryPaneRef={primaryPaneRef}
            secondaryPaneRef={secondaryPaneRef}
            tunnelHealth={tunnelHealth}
            restarting={restarting}
            handleTunnelRestart={handleTunnelRestart}
            shellPref={lane.shellPref}
            setShellPref={lane.setShellPref}
            plusMenuRef={lane.plusMenuRef}
            plusMenuOpen={lane.plusMenuOpen}
            setPlusMenuOpen={lane.setPlusMenuOpen}
            splitSubOpen={lane.splitSubOpen}
            setSplitSubOpen={lane.setSplitSubOpen}
            handleConfigureTerminalSettings={lane.handleConfigureTerminalSettings}
            isDrawer={isDrawer}
            isCollapsed={isCollapsed}
            setIsCollapsed={setIsCollapsed}
            onClose={onClose}
          />

          {!isCollapsed && (
            <div className="iam-terminal-chrome-fill flex-1 min-h-0 overflow-hidden relative">
              <div className="flex flex-1 min-h-0 min-w-0 flex-col md:flex-row">
                <div
                  className={`relative iam-terminal-chrome-fill ${lane.splitEnabled ? 'md:w-1/2 md:max-w-[50%]' : 'w-full'}`}
                >
                  <div className="absolute inset-0 flex flex-col min-h-0 min-w-0">
                    <TerminalSessionPane
                      ref={primaryPaneRef}
                      workspaceId={workspaceId}
                      targetType={lane.terminalTarget ?? undefined}
                      hostedConnectionId={lane.hostedConnectionId}
                      shell={lane.shellPref}
                      ptySlot=""
                      visible={lane.terminalAreaVisible}
                      connectEnabled={lane.terminalConnectEnabled}
                      onConnectionChange={lane.setPrimaryStatus}
                      onSessionIdChange={lane.setPrimarySessionId}
                      onBindingChange={lane.setTerminalBinding}
                      onTerminalOutputLine={onOutputLine}
                      onHardFailure={lane.handleTerminalHardFailure}
                      onTunnelHealth={setTunnelHealth}
                    />
                  </div>
                </div>

                {lane.splitEnabled && (
                  <>
                    <div
                      className="hidden md:block w-px shrink-0 bg-[var(--border-subtle)]"
                      aria-hidden
                    />
                    <div
                      className={`relative iam-terminal-chrome-fill border-t md:border-t-0 border-[var(--border-subtle)] md:border-0 ${lane.splitEnabled ? 'md:w-1/2 md:max-w-[50%]' : ''}`}
                    >
                      <div className="absolute top-1 left-2 z-[5] pointer-events-none text-[9px] font-mono uppercase tracking-wider text-muted/80">
                        Session 2
                      </div>
                      <div className="absolute inset-0 flex flex-col min-h-0 min-w-0">
                        <TerminalSessionPane
                          ref={secondaryPaneRef}
                          workspaceId={workspaceId}
                          targetType={lane.terminalTarget ?? undefined}
                          hostedConnectionId={lane.hostedConnectionId}
                          shell={lane.shellPref}
                          ptySlot="s2"
                          visible={lane.terminalAreaVisible}
                          connectEnabled={lane.terminalConnectEnabled}
                          onConnectionChange={lane.setSecondaryStatus}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {activeTab === 'output' && (
                <div className="iam-terminal-output-panel absolute inset-0 overflow-y-auto custom-scrollbar px-4 py-3 font-mono text-[11px] leading-relaxed text-main bg-[var(--terminal-surface)] z-[20]">
                  {outputLines.length === 0 ? (
                    <p className="text-muted/40 text-xs italic mt-4">No output yet.</p>
                  ) : (
                    outputLines.map((line, i) => (
                      <div
                        key={i}
                        className="mb-1 border-l-2 border-transparent pl-2 hover:border-[var(--solar-cyan)]/30"
                      >
                        {line}
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'problems' && (
                <div className="iam-terminal-problems-panel absolute inset-0 overflow-y-auto custom-scrollbar p-4 space-y-2 bg-[var(--terminal-surface)] z-[20]">
                  {problems.length > 0 && (
                    <div className="flex items-center justify-end gap-2 pb-1">
                      <button
                        type="button"
                        disabled={bulkResolving}
                        onClick={() => {
                          setBulkResolving(true);
                          void dismissProblems({ older_than_days: 7 }).finally(() => setBulkResolving(false));
                        }}
                        className="text-[10px] font-mono px-2 py-1 rounded border border-[var(--border-subtle)] text-muted hover:text-main hover:bg-[var(--bg-hover)] disabled:opacity-40"
                      >
                        {bulkResolving ? 'Deleting…' : 'Delete 7d+ stale'}
                      </button>
                      <button
                        type="button"
                        disabled={bulkResolving}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Permanently delete all ${problems.length} problem(s) from agentsam_error_log for this workspace?`,
                            )
                          ) {
                            return;
                          }
                          setBulkResolving(true);
                          void dismissProblems({ resolve_all: true }).finally(() => setBulkResolving(false));
                        }}
                        className="text-[10px] font-mono px-2 py-1 rounded border border-[var(--solar-red)]/30 text-[var(--solar-red)] hover:bg-[var(--solar-red)]/10 disabled:opacity-40"
                      >
                        {bulkResolving ? 'Deleting…' : `Delete all (${problems.length})`}
                      </button>
                    </div>
                  )}
                  {problems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted opacity-40 gap-2">
                      <CircleCheck size={28} />
                      <p className="text-xs font-mono">No problems detected</p>
                    </div>
                  ) : (
                    problems.map((p, i) => (
                      <div
                        key={p.id ?? `${p.file}-${p.line}-${i}`}
                        className={`flex items-start gap-2 p-2 rounded bg-[var(--bg-panel)] border-l-2 ${
                          p.severity === 'error' ? 'border-[var(--solar-red)]' : 'border-[var(--solar-yellow)]'
                        }`}
                      >
                        <TriangleAlert
                          size={13}
                          className={
                            p.severity === 'error' ? 'text-[var(--solar-red)]' : 'text-[var(--solar-yellow)]'
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-main font-mono">{p.msg}</div>
                          <div className="text-[10px] text-muted font-mono">
                            {p.ts ? (
                              <span>{p.ts}</span>
                            ) : null}
                            {p.ts && (p.file || p.line) ? ' · ' : null}
                            {p.line > 0 ? `${p.file}:${p.line}` : p.file || 'error'}
                          </div>
                        </div>
                        {p.id ? (
                          <button
                            type="button"
                            title="Delete from agentsam_error_log"
                            disabled={resolvingProblemId === p.id}
                            onClick={() => {
                              setResolvingProblemId(p.id!);
                              void dismissProblems({ id: p.id }).finally(() => setResolvingProblemId(null));
                            }}
                            className="shrink-0 p-1 rounded text-muted hover:text-main hover:bg-[var(--bg-hover)] disabled:opacity-40"
                          >
                            <X size={12} strokeWidth={2} />
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

      </>
    );
  },
);

XTermShell.displayName = 'XTermShell';
