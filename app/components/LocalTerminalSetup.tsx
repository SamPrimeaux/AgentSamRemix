import React, { useCallback, useEffect, useState } from 'react';
import {
  detectLocalTerminalDefaults,
  LOCAL_SHELL_OPTIONS,
  type LocalTerminalConnection,
  type LocalTerminalPlatform,
} from '../src/lib/localTerminalDefaults';

export type TerminalTarget = 'platform_vm' | 'user_hosted_tunnel' | 'sandbox';

export type TerminalTargetsPayload = {
  can_run_pty: boolean;
  local: {
    target_type: 'user_hosted_tunnel';
    ready: boolean;
    configured: boolean;
    connection_id: string | null;
    shell?: string | null;
    error_code?: string | null;
  };
  cloud: {
    target_type: 'platform_vm';
    ready: boolean;
    configured: boolean;
    connection_id: string | null;
    error_code?: string | null;
  };
  sandbox?: {
    target_type: 'sandbox';
    ready: boolean;
    configured: boolean;
    connection_id: string | null;
    ws_url_present?: boolean;
    error_code?: string | null;
  };
};

export async function fetchTerminalTargets(workspaceId: string): Promise<TerminalTargetsPayload | null> {
  try {
    const qs = new URLSearchParams({ workspace_id: workspaceId.trim() });
    const r = await fetch(`/api/terminal/connections/targets?${qs}`, { credentials: 'same-origin' });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    if (!j || typeof j !== 'object') return null;
    return j as TerminalTargetsPayload;
  } catch {
    return null;
  }
}

export async function fetchLocalTerminalConnection(workspaceId: string): Promise<{
  isActive: boolean;
  shell?: string;
}> {
  try {
    const qs = new URLSearchParams({ workspace_id: workspaceId.trim() });
    const r = await fetch(`/api/terminal/connections/local?${qs}`, { credentials: 'same-origin' });
    if (!r.ok) return { isActive: false };
    const j = await r.json().catch(() => ({}));
    const conn = j?.connection as LocalTerminalConnection | null | undefined;
    const isActive = conn?.is_active === true && conn?.ws_url_present === true;
    const connShell = typeof conn?.shell === 'string' ? conn.shell.trim() : undefined;
    return { isActive, shell: connShell || undefined };
  } catch {
    return { isActive: false };
  }
}

interface LocalTerminalSettingsPanelProps {
  workspaceId?: string;
}

/** Settings-only local terminal provisioning and tunnel activation (not embedded in XTermShell). */
export function LocalTerminalSettingsPanel({ workspaceId }: LocalTerminalSettingsPanelProps) {
  const defaults = detectLocalTerminalDefaults();
  const [localConn, setLocalConn] = useState<LocalTerminalConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [activating, setActivating] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showTunnelForm, setShowTunnelForm] = useState(false);
  const [platform, setPlatform] = useState<LocalTerminalPlatform>(defaults.platform);
  const [shell, setShell] = useState(defaults.shell);
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchLocal = useCallback(async () => {
    if (!workspaceId?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ workspace_id: workspaceId.trim() });
      const res = await fetch(`/api/terminal/connections/local?${qs}`, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLocalConn(null);
        return;
      }
      const conn = data?.connection as LocalTerminalConnection | null;
      setLocalConn(conn);
      if (conn?.platform === 'macos' || conn?.platform === 'windows' || conn?.platform === 'linux') {
        setPlatform(conn.platform);
      }
      if (conn?.shell) setShell(conn.shell);
    } catch {
      setLocalConn(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchLocal();
  }, [fetchLocal]);

  const localReady = !!(localConn?.is_active && localConn?.ws_url_present);

  const handleProvision = async () => {
    setProvisioning(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/terminal/connections/provision', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          target_type: 'user_hosted_tunnel',
          platform,
          shell,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Setup failed');
        return;
      }
      setLocalConn(data.connection as LocalTerminalConnection);
      setShowSetup(false);
      setShowTunnelForm(true);
      setSuccess('Connection row created — paste your tunnel WebSocket URL below.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup failed');
    } finally {
      setProvisioning(false);
    }
  };

  const handleActivate = async () => {
    if (!tunnelUrl.trim()) {
      setError('Enter your tunnel WebSocket URL');
      return;
    }
    setActivating(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/terminal/connections/activate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          connection_id: localConn?.id,
          ws_url: tunnelUrl.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Activation failed');
        return;
      }
      setShowTunnelForm(false);
      setSuccess('Local terminal active. Use the terminal welcome screen → Start local.');
      await fetchLocal();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activation failed');
    } finally {
      setActivating(false);
    }
  };

  const shellOptions = LOCAL_SHELL_OPTIONS[platform] ?? LOCAL_SHELL_OPTIONS.linux;

  if (!workspaceId?.trim()) {
    return (
      <p className="text-[11px] text-muted font-mono">
        Select a workspace to configure a local terminal tunnel.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-4 max-w-lg">
      <div>
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-main">
          Local terminal (ExecOS / localpty)
        </h3>
        <p className="mt-1 text-[11px] text-muted leading-relaxed">
          Run ExecOS on your Mac through the localpty lane, then activate the WebSocket URL here.
          The terminal panel picks up the active connection automatically — no URL paste in the shell.
        </p>
      </div>

      <div className="flex items-center gap-2 text-[10px] font-mono">
        <span
          className={`inline-flex h-2 w-2 rounded-full ${localReady ? 'bg-[var(--solar-green)]' : 'bg-[var(--text-muted)]/40'}`}
        />
        {loading
          ? 'Checking connection…'
          : localReady
            ? 'Active — available from terminal welcome → Start local'
            : localConn
              ? 'Provisioned — tunnel URL not active yet'
              : 'Not configured'}
      </div>

      {!localConn && (
        <button
          type="button"
          className="text-[11px] font-mono px-3 py-2 rounded border border-[var(--solar-yellow)]/40 text-[var(--solar-yellow)] hover:bg-[var(--solar-yellow)]/10"
          onClick={() => setShowSetup(true)}
        >
          Set up local terminal
        </button>
      )}

      {showSetup && !localConn && (
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
          <label className="block text-[10px] font-mono text-muted">
            Platform
            <select
              className="mt-1 w-full rounded border border-[var(--border-subtle)] bg-[var(--terminal-surface)] px-2 py-1.5 text-[11px] text-main"
              value={platform}
              onChange={(e) => {
                const p = e.target.value as LocalTerminalPlatform;
                setPlatform(p);
                setShell(LOCAL_SHELL_OPTIONS[p][0].value);
              }}
            >
              <option value="macos">macOS</option>
              <option value="windows">Windows</option>
              <option value="linux">Linux</option>
            </select>
          </label>
          <label className="block text-[10px] font-mono text-muted">
            Shell
            <select
              className="mt-1 w-full rounded border border-[var(--border-subtle)] bg-[var(--terminal-surface)] px-2 py-1.5 text-[11px] text-main"
              value={shell}
              onChange={(e) => setShell(e.target.value)}
            >
              {shellOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={provisioning}
            className="w-full py-2 rounded text-[11px] font-mono bg-[var(--solar-cyan)]/15 border border-[var(--solar-cyan)]/40 text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/25 disabled:opacity-50"
            onClick={() => void handleProvision()}
          >
            {provisioning ? 'Creating…' : 'Create connection row'}
          </button>
        </div>
      )}

      {(showTunnelForm || (localConn && !localConn.is_active)) && (
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
          <label className="block text-[10px] font-mono text-muted">
            Tunnel WebSocket URL
            <input
              type="url"
              placeholder="wss://your-tunnel-hostname"
              className="mt-1 w-full rounded border border-[var(--border-subtle)] bg-[var(--terminal-surface)] px-2 py-1.5 text-[11px] font-mono text-main"
              value={tunnelUrl}
              onChange={(e) => setTunnelUrl(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={activating}
            className="w-full py-2 rounded text-[11px] font-mono bg-[var(--solar-green)]/15 border border-[var(--solar-green)]/40 text-[var(--solar-green)] hover:bg-[var(--solar-green)]/25 disabled:opacity-50"
            onClick={() => void handleActivate()}
          >
            {activating ? 'Saving…' : 'Activate local terminal'}
          </button>
        </div>
      )}

      {localConn && !showTunnelForm && localConn.is_active && (
        <button
          type="button"
          className="text-[10px] text-muted hover:text-main font-mono"
          onClick={() => {
            setShowTunnelForm(true);
            setTunnelUrl('');
          }}
        >
          Update tunnel URL
        </button>
      )}

      {error && <p className="text-[10px] font-mono text-[var(--solar-red)]">{error}</p>}
      {success && <p className="text-[10px] font-mono text-[var(--solar-green)]">{success}</p>}
    </div>
  );
}
