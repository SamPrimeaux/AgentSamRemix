import React, { useEffect, useState } from 'react';

const LS_LAST_SESSION = 'iam_pwa_last_session_snapshot';

type LastSessionSnapshot = {
  workspaceId?: string | null;
  displayName?: string | null;
  savedAt?: number;
};

export function persistLastSessionSnapshot(snapshot: LastSessionSnapshot): void {
  try {
    const payload = { ...snapshot, savedAt: Date.now() };
    sessionStorage.setItem(LS_LAST_SESSION, JSON.stringify(payload));
    localStorage.setItem(LS_LAST_SESSION, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

export function readLastSessionSnapshot(): LastSessionSnapshot | null {
  try {
    const raw =
      sessionStorage.getItem(LS_LAST_SESSION) || localStorage.getItem(LS_LAST_SESSION);
    if (!raw) return null;
    return JSON.parse(raw) as LastSessionSnapshot;
  } catch {
    return null;
  }
}

export function OfflineReconnectBanner() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [lastSession, setLastSession] = useState<LastSessionSnapshot | null>(null);

  useEffect(() => {
    setLastSession(readLastSessionSnapshot());
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (online) return null;

  const workspaceLabel = lastSession?.displayName || lastSession?.workspaceId || 'your workspace';

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20000,
        padding: '10px 16px',
        textAlign: 'center',
        fontSize: 13,
        fontWeight: 600,
        background: 'rgba(230, 172, 0, 0.92)',
        color: '#00212b',
        borderBottom: '1px solid rgba(0,0,0,0.12)',
      }}
    >
      Reconnecting… Showing read-only shell for {workspaceLabel}. Live Agent Sam and APIs need network.
    </div>
  );
}
