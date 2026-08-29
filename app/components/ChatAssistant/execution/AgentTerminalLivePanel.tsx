/**
 * AgentTerminalLivePanel — shows Agent Sam's live computer use in real time.
 *
 * Subscribes to the DO SSE stream (same path as DesignStudio) filtered by
 * workspace_id. Renders each terminal_output event as an ANSI-aware log line
 * with the command header, stdout, and a "LIVE" badge while active.
 *
 * Wire into ChatAssistant: when a tool_trace with tool_name matching
 * agentsam_terminal_* appears, mount this panel inline.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as TerminalIcon, Wifi, WifiOff, X, Maximize2 } from 'lucide-react';

export type TerminalLiveEvent = {
  type: 'terminal_output';
  command: string;
  stdout: string;
  stderr?: string;
  exit_code: number | null;
  exec_host?: string | null;
  ts: number;
};

type LineEntry = {
  id: number;
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  exec_host: string | null;
  ts: number;
};

interface AgentTerminalLivePanelProps {
  /** Workspace ID to subscribe to — used as the DO sentinel key. */
  workspaceId: string;
  /** Optional run_id for the SSE stream — falls back to workspaceId. */
  runId?: string;
  /** Called when user closes the panel. */
  onClose?: () => void;
  /** Compact single-line mode for inline chat use. */
  compact?: boolean;
  /** Max lines to keep in memory. Default 200. */
  maxLines?: number;
}

const MAX_DEFAULT = 200;

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[mGKHF]/g, '');
}

/** Simple ANSI → span renderer (just colors, no full terminal emulation). */
function AnsiLine({ text }: { text: string }) {
  const plain = stripAnsi(text);
  return <span className="font-mono text-[11px] text-[var(--dashboard-muted)] leading-snug whitespace-pre-wrap break-all">{plain}</span>;
}

export const AgentTerminalLivePanel: React.FC<AgentTerminalLivePanelProps> = ({
  workspaceId,
  runId,
  onClose,
  compact = false,
  maxLines = MAX_DEFAULT,
}) => {
  const [lines, setLines] = useState<LineEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastActivity, setLastActivity] = useState<number>(0);
  const [expanded, setExpanded] = useState(!compact);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const counterRef = useRef(0);

  const effectiveRunId = runId || ('terminal_live:' + workspaceId);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    // Subscribe to the terminal live events SSE stream
    const url = `/api/agent/terminal/events?workspace_id=${encodeURIComponent(workspaceId)}`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      try {
        const envelope = JSON.parse(e.data);
        if (envelope?.type !== 'terminal_output') return;
        const ev = envelope as TerminalLiveEvent;
        setLastActivity(Date.now());
        setLines((prev) => {
          const next: LineEntry = {
            id: ++counterRef.current,
            command: ev.command || '',
            stdout: ev.stdout || '',
            stderr: ev.stderr || '',
            exit_code: ev.exit_code ?? null,
            exec_host: ev.exec_host || null,
            ts: ev.ts,
          };
          const updated = [...prev, next];
          return updated.length > maxLines ? updated.slice(-maxLines) : updated;
        });
      } catch (_) {}
    };
  }, [effectiveRunId, workspaceId, maxLines]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [connect]);

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    if (expanded) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, expanded]);

  const isLive = connected && Date.now() - lastActivity < 10_000;

  if (compact && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-2 px-2 py-1 rounded-md border border-[var(--dashboard-border)] bg-[var(--scene-bg)] text-[11px] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
      >
        <TerminalIcon size={12} />
        <span>Agent terminal</span>
        {lines.length > 0 && <span className="opacity-60">{lines.length} cmds</span>}
        {isLive && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
      </button>
    );
  }

  return (
    <div
      className="rounded-xl border border-[var(--dashboard-border)] bg-[var(--terminal-surface)] overflow-hidden flex flex-col"
      style={{ minHeight: compact ? 120 : 220, maxHeight: 480 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--dashboard-border)] bg-[var(--terminal-chrome)] shrink-0">
        <TerminalIcon size={13} className="text-emerald-400 shrink-0" />
        <span className="text-[11px] font-semibold text-[var(--dashboard-text)] flex-1 truncate">
          Agent Sam — Terminal
        </span>
        {/* LIVE badge */}
        <div className="flex items-center gap-1.5">
          {connected ? (
            <Wifi size={11} className="text-emerald-400" />
          ) : (
            <WifiOff size={11} className="text-[var(--dashboard-muted)]" />
          )}
          {isLive ? (
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          ) : (
            <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--dashboard-muted)]">
              {connected ? 'READY' : 'OFFLINE'}
            </span>
          )}
        </div>
        {compact && (
          <button onClick={() => setExpanded(false)} className="ml-1 text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]">
            <X size={12} />
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className="ml-1 text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Output */}
      <div className="iam-terminal-live-output flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {lines.length === 0 && (
          <p className="text-[11px] text-[var(--dashboard-muted)] italic pt-2">
            Waiting for Agent Sam to run commands…
          </p>
        )}
        {lines.map((ln) => (
          <div key={ln.id} className="space-y-0.5">
            {/* Command header */}
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-mono text-[11px] select-none">$</span>
              <span className="font-mono text-[11px] text-white break-all">{ln.command}</span>
              {ln.exec_host && (
                <span className="ml-auto text-[9px] text-[var(--dashboard-muted)] shrink-0 font-mono">
                  {ln.exec_host}
                </span>
              )}
              {ln.exit_code != null && ln.exit_code !== 0 && (
                <span className="ml-1 text-[9px] font-bold text-red-400 shrink-0">
                  [{ln.exit_code}]
                </span>
              )}
            </div>
            {/* stdout */}
            {ln.stdout && (
              <div className="pl-4 border-l border-[#2a2a2a]">
                {ln.stdout.split('\n').slice(0, 40).map((line, i) => (
                  <div key={i}>
                    <AnsiLine text={line} />
                  </div>
                ))}
                {ln.stdout.split('\n').length > 40 && (
                  <span className="text-[10px] text-[var(--dashboard-muted)] italic">
                    … {ln.stdout.split('\n').length - 40} more lines
                  </span>
                )}
              </div>
            )}
            {/* stderr */}
            {ln.stderr && (
              <div className="pl-4 border-l border-red-900/40">
                {ln.stderr.split('\n').slice(0, 10).map((line, i) => (
                  <div key={i}>
                    <span className="font-mono text-[11px] text-red-400 leading-snug whitespace-pre-wrap break-all">
                      {stripAnsi(line)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default AgentTerminalLivePanel;
