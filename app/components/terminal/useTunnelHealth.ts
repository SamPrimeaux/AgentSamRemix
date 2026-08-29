import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { TerminalSessionPaneHandle } from '../TerminalSessionPane';

export type TunnelHealth = { healthy: boolean; connections: number };

export function useTunnelHealth(
  primaryPaneRef: RefObject<TerminalSessionPaneHandle | null>,
  opts?: { statusPath?: string | null },
) {
  const [restarting, setRestarting] = useState(false);
  const [tunnelHealth, setTunnelHealth] = useState<TunnelHealth | null>(null);
  const statusPath = opts?.statusPath?.trim() || '/api/tunnel/status/disconnected';

  const fetchTunnelStatus = useCallback(
    (writeToTerminal = false) => {
      void fetch(statusPath, { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((j) => {
          setTunnelHealth({ healthy: j?.healthy === true, connections: j?.connections ?? 0 });
          if (!writeToTerminal) return;
          const ok = j?.healthy === true;
          const conns = j?.connections ?? 0;
          const marker = j?.marker != null ? String(j.marker) : 'disconnected';
          primaryPaneRef.current?.writeAnsi(
            `\r\n${ok ? '\x1b[38;5;82m' : '\x1b[38;5;208m'}  ◈ ${marker}\x1b[0m — ${
              ok ? `healthy · ${conns} connection${conns !== 1 ? 's' : ''}` : 'unreachable'
            }\r\n`,
          );
        })
        .catch(() => setTunnelHealth(null));
    },
    [primaryPaneRef, statusPath],
  );

  // Initial value only — after that, tunnel_health messages pushed down the
  // primary terminal socket (see onTunnelHealth prop below) keep this fresh.
  // No interval here anymore; the AGENT_SESSION DO alarm owns the cadence.
  useEffect(() => {
    fetchTunnelStatus(false);
  }, [fetchTunnelStatus]);

  const handleTunnelRestart = useCallback(async () => {
    setRestarting(true);
    primaryPaneRef.current?.writeAnsi('\r\n\x1b[38;5;208m  ◌ Requesting tunnel restart…\x1b[0m');
    try {
      const res = await fetch('/api/tunnel/restart', { method: 'POST', credentials: 'same-origin' });
      const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
      if (data.ok) {
        primaryPaneRef.current?.writeAnsi('\x1b[38;5;82m  ✓ Restart requested — re-checking in 4s…\x1b[0m');
        setTimeout(() => fetchTunnelStatus(true), 4000);
      } else {
        primaryPaneRef.current?.writeAnsi(`\x1b[38;5;196m  ✗ ${data.error ?? 'Failed'}\x1b[0m`);
      }
    } catch (e: unknown) {
      primaryPaneRef.current?.writeAnsi(
        `\x1b[38;5;196m  ✗ Network error: ${e instanceof Error ? e.message : String(e)}\x1b[0m`,
      );
    } finally {
      setRestarting(false);
    }
  }, [fetchTunnelStatus, primaryPaneRef]);

  return {
    tunnelHealth,
    setTunnelHealth,
    restarting,
    fetchTunnelStatus,
    handleTunnelRestart,
  };
}
