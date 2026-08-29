import React, { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Terminal as TerminalIcon, Trash2, X } from 'lucide-react';

type Lane = 'local' | 'remote' | 'sandbox';
type Panel = 'output' | 'environment';
type LaneInfo = {
  ok: boolean;
  state: string;
  connection?: {
    id?: string;
    name?: string;
    targetType?: string;
    platform?: string;
    shell?: string;
    defaultCwd?: string;
  } | null;
  environment?: { state?: string; sandboxId?: string; wakesOnFirstExec?: boolean };
};
type Status = {
  ok: boolean;
  preferredLane?: Lane;
  lanes?: Record<Lane, LaneInfo>;
};

type ExecResult = {
  ok?: boolean;
  text?: string;
  error?: string | null;
  exitCode?: number;
  transport?: string;
  target?: string;
  lane?: Lane;
  cwd?: string;
  sandboxId?: string;
};

interface TerminalDrawerProps {
  mobileDock?: boolean;
}

const LANE_LABELS: Record<Lane, string> = {
  local: 'Local',
  remote: 'VM',
  sandbox: 'Sandbox',
};

const INITIAL_OUTPUT = 'Choose an explicit execution lane. Agent Sam never silently hops between machines.';
const MIN_SHEET_VH = 38;
const DEFAULT_SHEET_VH = 58;
const MAX_SHEET_VH = 92;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const TerminalDrawer: React.FC<TerminalDrawerProps> = ({ mobileDock = false }) => {
  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(DEFAULT_SHEET_VH);
  const [panel, setPanel] = useState<Panel>('output');
  const [lane, setLane] = useState<Lane>('local');
  const [cwd, setCwd] = useState('');
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState(INITIAL_OUTPUT);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [sandboxTouched, setSandboxTouched] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number; lastHeight: number } | null>(null);

  useEffect(() => {
    fetch('/api/exec/status', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((raw) => {
        const data = raw as Status;
        setStatus(data);
        const preferred = data.preferredLane && data.lanes?.[data.preferredLane]
          ? data.preferredLane
          : 'local';
        setLane(preferred);
        setCwd(data.lanes?.[preferred]?.connection?.defaultCwd || '');
      })
      .catch(() => setStatus({ ok: false }));
  }, []);

  useEffect(() => {
    if (!mobileDock) return;
    const offset = open ? `${maximized ? MAX_SHEET_VH : sheetHeight}dvh` : '58px';
    document.documentElement.style.setProperty('--as-mobile-terminal-offset', offset);
    return () => document.documentElement.style.removeProperty('--as-mobile-terminal-offset');
  }, [mobileDock, open, maximized, sheetHeight]);

  const laneInfo = status?.lanes?.[lane];
  const laneReady = Boolean(laneInfo?.ok);
  const laneState = laneInfo?.state || 'loading';

  const laneSummary = useMemo(() => {
    if (!laneInfo?.connection) return `${LANE_LABELS[lane]} · ${laneState}`;
    const platform = laneInfo.connection.platform || laneInfo.connection.targetType || '';
    return `${LANE_LABELS[lane]} · ${platform} · ${laneState}`;
  }, [lane, laneInfo, laneState]);

  async function chooseLane(nextLane: Lane) {
    setLane(nextLane);
    const next = status?.lanes?.[nextLane];
    setCwd(next?.connection?.defaultCwd || '');
    await fetch('/api/exec/preference', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lane: nextLane }),
    }).catch(() => undefined);
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!command.trim() || running || !laneReady) return;
    const submitted = command.trim();
    setRunning(true);
    setOpen(true);
    setPanel('output');
    const wakeNote = lane === 'sandbox' && !sandboxTouched
      ? '\nSpinning up isolated Linux environment…'
      : '';
    if (lane === 'sandbox') setSandboxTouched(true);
    setOutput((prev) => `${prev}${wakeNote}\n\n[${LANE_LABELS[lane]}] $ ${submitted}`);
    setCommand('');
    try {
      const res = await fetch('/api/exec/run', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lane, command: submitted, cwd: cwd.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({})) as ExecResult;
      const receipt = [data.transport, data.target, Number.isFinite(data.exitCode) ? `exit ${data.exitCode}` : null]
        .filter(Boolean)
        .join(' · ');
      setOutput((prev) => `${prev}\n${data.text || data.error || `HTTP ${res.status}`}${receipt ? `\n[${receipt}]` : ''}`);
    } catch (error) {
      setOutput((prev) => `${prev}\n${error instanceof Error ? error.message : 'execution_failed'}`);
    } finally {
      setRunning(false);
    }
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!open || window.innerWidth > 800) return;
    const startHeight = maximized ? MAX_SHEET_VH : sheetHeight;
    dragRef.current = { startY: event.clientY, startHeight, lastHeight: startHeight };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function continueDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || window.innerWidth > 800) return;
    const viewportHeight = Math.max(window.innerHeight, 1);
    const deltaVh = ((drag.startY - event.clientY) / viewportHeight) * 100;
    const next = clamp(drag.startHeight + deltaVh, MIN_SHEET_VH, MAX_SHEET_VH);
    drag.lastHeight = next;
    setMaximized(false);
    setSheetHeight(next);
  }

  function endDrag() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || window.innerWidth > 800) return;
    const next = drag.lastHeight;
    if (next < 43) {
      setOpen(false);
      setMaximized(false);
      setSheetHeight(DEFAULT_SHEET_VH);
      return;
    }
    if (next > 78) {
      setMaximized(true);
      setSheetHeight(MAX_SHEET_VH);
      return;
    }
    setSheetHeight(next < 53 ? 48 : 62);
  }

  const style = {
    '--as-terminal-sheet-height': `${maximized ? MAX_SHEET_VH : sheetHeight}dvh`,
  } as CSSProperties;

  return (
    <div
      className={`as-terminal ${mobileDock ? 'as-terminal-mobile-dock' : ''} ${open ? 'as-terminal-open' : ''} ${maximized ? 'as-terminal-maximized' : ''}`}
      style={style}
    >
      <button
        className="as-terminal-mobile-grabber"
        type="button"
        aria-label="Drag terminal sheet"
        onClick={() => setOpen(true)}
        onPointerDown={beginDrag}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span />
      </button>

      <div className="as-terminal-heading">
        <button className="as-terminal-handle" onClick={() => setOpen((value) => !value)} type="button">
          <TerminalIcon className="as-terminal-title-icon" size={18} strokeWidth={1.8} />
          <span className="as-terminal-title-copy">
            <strong>Terminal</strong>
            <small className={laneReady ? 'as-status-good' : 'as-status-bad'}>{laneSummary}</small>
          </span>
          <span className="as-terminal-open-label">{open ? 'Close' : 'Open'}</span>
        </button>

        <div className="as-terminal-mobile-actions">
          {open && (
            <button
              type="button"
              aria-label={maximized ? 'Restore terminal sheet' : 'Maximize terminal sheet'}
              onClick={() => {
                setMaximized((value) => !value);
                if (!maximized) setSheetHeight(MAX_SHEET_VH);
              }}
            >
              {maximized ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
            </button>
          )}
          <button type="button" aria-label="Close terminal" onClick={() => { setOpen(false); setMaximized(false); }}>
            <X size={21} />
          </button>
        </div>
      </div>

      {open && (
        <div className="as-terminal-body">
          <div className="as-terminal-controls">
            <div className="as-lane-switcher" aria-label="Execution lane">
              {(Object.keys(LANE_LABELS) as Lane[]).map((item) => {
                const info = status?.lanes?.[item];
                return (
                  <button
                    key={item}
                    type="button"
                    className={lane === item ? 'active' : ''}
                    onClick={() => void chooseLane(item)}
                    title={`${info?.connection?.name || LANE_LABELS[item]} · ${info?.state || 'unknown'}`}
                  >
                    <i className={info?.ok ? 'ready' : ''} />
                    {LANE_LABELS[item]}
                  </button>
                );
              })}
            </div>
            <div className="as-terminal-cwd">
              <span>cwd</span>
              <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={lane === 'sandbox' ? '/workspace' : '/path/to/repo'} />
            </div>
          </div>

          <div className="as-terminal-tabs">
            <div>
              <button type="button" className={panel === 'output' ? 'active' : ''} onClick={() => setPanel('output')}>Output</button>
              <button type="button" className={panel === 'environment' ? 'active' : ''} onClick={() => setPanel('environment')}>Environment</button>
            </div>
            {panel === 'output' && (
              <button className="as-terminal-clear" type="button" onClick={() => setOutput(INITIAL_OUTPUT)} aria-label="Clear terminal output">
                <Trash2 size={15} />
                <span>Clear</span>
              </button>
            )}
          </div>

          {panel === 'output' ? (
            <pre>{output}</pre>
          ) : (
            <div className="as-terminal-environment">
              {(Object.keys(LANE_LABELS) as Lane[]).map((item) => {
                const info = status?.lanes?.[item];
                const detail = info?.connection?.name || info?.connection?.platform || info?.connection?.targetType || info?.environment?.sandboxId || 'Not registered';
                return (
                  <button key={item} type="button" className={lane === item ? 'active' : ''} onClick={() => void chooseLane(item)}>
                    <span className={`as-terminal-env-dot ${info?.ok ? 'ready' : ''}`} />
                    <span>
                      <strong>{LANE_LABELS[item]}</strong>
                      <small>{detail}</small>
                    </span>
                    <em>{info?.state || 'unknown'}</em>
                  </button>
                );
              })}
            </div>
          )}

          <form onSubmit={run} className="as-terminal-input">
            <span>$</span>
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder={laneReady ? 'git status' : `${LANE_LABELS[lane]} unavailable`} />
            <button disabled={running || !command.trim() || !laneReady}>{running ? 'Running…' : 'Run'}</button>
          </form>
        </div>
      )}
    </div>
  );
};
