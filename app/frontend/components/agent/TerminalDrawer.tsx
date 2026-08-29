import React, { FormEvent, useEffect, useState } from 'react';

type Status = { ok: boolean; connection?: { name?: string; defaultCwd?: string; ready?: boolean } | null; health?: string };

export const TerminalDrawer: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [cwd, setCwd] = useState('');
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState('ExecOS terminal ready.');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch('/api/exec/status', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((raw) => {
        const data = raw as Status;
        setStatus(data);
        if (data?.connection?.defaultCwd) setCwd(data.connection.defaultCwd);
      })
      .catch(() => setStatus({ ok: false }));
  }, []);

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!command.trim() || running) return;
    const submitted = command.trim();
    setRunning(true);
    setOutput((prev) => `${prev}\n\n$ ${submitted}`);
    setCommand('');
    try {
      const res = await fetch('/api/exec/host', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: submitted, cwd: cwd.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({})) as { text?: string; error?: string };
      setOutput((prev) => `${prev}\n${data.text || data.error || `HTTP ${res.status}`}`);
    } catch (error) {
      setOutput((prev) => `${prev}\n${error instanceof Error ? error.message : 'execution_failed'}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={`as-terminal ${open ? 'as-terminal-open' : ''}`}>
      <button className="as-terminal-handle" onClick={() => setOpen((v) => !v)} type="button">
        <span>Terminal</span>
        <span className={status?.ok ? 'as-status-good' : 'as-status-bad'}>{status?.ok ? 'ExecOS ready' : 'ExecOS unavailable'}</span>
        <span>{open ? '⌄' : '⌃'}</span>
      </button>
      {open && (
        <div className="as-terminal-body">
          <div className="as-terminal-cwd">
            <span>cwd</span>
            <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/home/.../repo" />
          </div>
          <pre>{output}</pre>
          <form onSubmit={run} className="as-terminal-input">
            <span>$</span>
            <input autoFocus value={command} onChange={(e) => setCommand(e.target.value)} placeholder="git status" />
            <button disabled={running || !command.trim()}>{running ? 'Running…' : 'Run'}</button>
          </form>
        </div>
      )}
    </div>
  );
};
