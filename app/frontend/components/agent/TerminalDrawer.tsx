import React, { FormEvent, useEffect, useMemo, useState } from 'react';

type Lane = 'local' | 'remote' | 'sandbox' | 'environment';
type RuntimeEnvironment = {
  active?: boolean;
  state?: string;
  environmentId?: string | null;
  sandboxId?: string;
  machineType?: string | null;
  zone?: string | null;
  expiresAt?: string | null;
  wakesOnFirstExec?: boolean;
};
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
  environment?: RuntimeEnvironment;
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
  environmentId?: string;
};

const LANE_LABELS: Record<Lane, string> = {
  local: 'Local',
  remote: 'VM',
  sandbox: 'Sandbox',
  environment: 'Environment',
};

export const TerminalDrawer: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [lane, setLane] = useState<Lane>('local');
  const [cwd, setCwd] = useState('');
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState('Choose an explicit execution lane. Agent Sam never silently hops between machines.');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [sandboxTouched, setSandboxTouched] = useState(false);
  const [environmentTouched, setEnvironmentTouched] = useState(false);

  async function refreshStatus(preferredOverride?: Lane) {
    try {
      const response = await fetch('/api/exec/status', { credentials: 'same-origin' });
      const data = await response.json() as Status;
      setStatus(data);
      const preferred = preferredOverride || (data.preferredLane && data.lanes?.[data.preferredLane]
        ? data.preferredLane
        : 'local');
      setLane(preferred);
      setCwd((current) => current || data.lanes?.[preferred]?.connection?.defaultCwd || '');
    } catch {
      setStatus({ ok: false });
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  const laneInfo = status?.lanes?.[lane];
  const laneReady = Boolean(laneInfo?.ok);
  const laneState = laneInfo?.state || 'loading';

  const laneSummary = useMemo(() => {
    if (!laneInfo?.connection) return `${LANE_LABELS[lane]} · ${laneState}`;
    const platform = laneInfo.connection.platform || laneInfo.connection.targetType || '';
    const env = lane === 'environment' && laneInfo.environment?.machineType
      ? ` · ${laneInfo.environment.machineType}`
      : '';
    return `${LANE_LABELS[lane]} · ${platform}${env} · ${laneState}`;
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

  async function destroyEnvironment() {
    if (running) return;
    setRunning(true);
    setOutput((prev) => `${prev}\n\n[Environment] Releasing disposable GCP environment…`);
    try {
      const response = await fetch('/api/exec/environment', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; state?: string; error?: string };
      setOutput((prev) => `${prev}\n${data.ok ? 'Environment released.' : data.error || `HTTP ${response.status}`}`);
      if (data.ok) setEnvironmentTouched(false);
      await refreshStatus('environment');
    } finally {
      setRunning(false);
    }
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!command.trim() || running || !laneReady) return;
    const submitted = command.trim();
    setRunning(true);

    let wakeNote = '';
    if (lane === 'sandbox' && !sandboxTouched) {
      wakeNote = '\nSpinning up isolated Cloudflare Linux…';
      setSandboxTouched(true);
    }
    if (lane === 'environment' && !laneInfo?.environment?.active && !environmentTouched) {
      wakeNote = '\nSpinning up GCP environment…';
      setEnvironmentTouched(true);
    }

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
      const receipt = [
        data.transport,
        data.target,
        data.environmentId ? data.environmentId : null,
        Number.isFinite(data.exitCode) ? `exit ${data.exitCode}` : null,
      ].filter(Boolean).join(' · ');
      setOutput((prev) => `${prev}\n${data.text || data.error || `HTTP ${res.status}`}${receipt ? `\n[${receipt}]` : ''}`);
      await refreshStatus(lane);
    } catch (error) {
      setOutput((prev) => `${prev}\n${error instanceof Error ? error.message : 'execution_failed'}`);
    } finally {
      setRunning(false);
    }
  }

  const workspaceLane = lane === 'sandbox' || lane === 'environment';
  const environmentActive = Boolean(status?.lanes?.environment?.environment?.active);

  return (
    <div className={`as-terminal ${open ? 'as-terminal-open' : ''}`}>
      <button className="as-terminal-handle" onClick={() => setOpen((v) => !v)} type="button">
        <span>Terminal</span>
        <span className={laneReady ? 'as-status-good' : 'as-status-bad'}>{laneSummary}</span>
        <span>{open ? 'Close' : 'Open'}</span>
      </button>
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
              <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={workspaceLane ? '/workspace' : '/path/to/repo'} />
            </div>
            {lane === 'environment' && environmentActive && (
              <button className="as-environment-release" type="button" onClick={() => void destroyEnvironment()} disabled={running}>
                Release
              </button>
            )}
          </div>
          <pre>{output}</pre>
          <form onSubmit={run} className="as-terminal-input">
            <span>$</span>
            <input autoFocus value={command} onChange={(e) => setCommand(e.target.value)} placeholder={laneReady ? 'git status' : `${LANE_LABELS[lane]} unavailable`} />
            <button disabled={running || !command.trim() || !laneReady}>{running ? 'Running…' : 'Run'}</button>
          </form>
        </div>
      )}
    </div>
  );
};
