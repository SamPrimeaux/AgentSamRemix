import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen,
  HardDrive,
  Link2,
  RefreshCw,
  Settings,
  Unplug,
} from 'lucide-react';
import type { DriveConnectionStatus } from '../../lib/library/libraryApi';

type Props = {
  driveStatus: DriveConnectionStatus | null;
  localFolderName: string | null;
  localNeedsReconnect?: boolean;
  onConnectDrive: () => void;
  onDisconnectDrive: () => Promise<{ ok: boolean; error?: string }>;
  onConnectLocal: () => void | Promise<void>;
  onRefreshStatus: () => Promise<DriveConnectionStatus>;
  onToast: (msg: string) => void;
};

export function LibraryConnectMenu({
  driveStatus,
  localFolderName,
  localNeedsReconnect = false,
  onConnectDrive,
  onDisconnectDrive,
  onConnectLocal,
  onRefreshStatus,
  onToast,
}: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void onRefreshStatus();
  }, [open, onRefreshStatus]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const driveConnected = !!driveStatus?.connected;
  const driveLabel = driveConnected
    ? driveStatus?.email || driveStatus?.displayName || 'Connected'
    : 'Not connected';

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      const out = await onDisconnectDrive();
      if (out.ok) {
        onToast('Google Drive disconnected');
        setOpen(false);
      } else {
        onToast(out.error || 'Could not disconnect Drive');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lib-connect-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`icon-btn lib-connect-gear${open ? ' active' : ''}`}
        title="Connections"
        aria-label="Manage connections"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Settings size={18} strokeWidth={1.75} />
      </button>

      {open ? (
        <div className="lib-connect-menu" role="menu" onClick={(e) => e.stopPropagation()}>
          <div className="lib-connect-menu-head">
            <strong>Connections</strong>
            <span>Per-user OAuth · Drive API v3</span>
          </div>

          <div className="lib-connect-section">
            <div className="lib-connect-row">
              <HardDrive size={16} strokeWidth={1.75} aria-hidden />
              <div className="lib-connect-row-body">
                <span className="lib-connect-label">Google Drive</span>
                <span className={`lib-connect-status${driveConnected ? ' on' : ''}`}>{driveLabel}</span>
              </div>
            </div>
            {driveConnected ? (
              <>
                <button
                  type="button"
                  className="lib-connect-action"
                  disabled={busy}
                  onClick={() => {
                    onConnectDrive();
                    onToast('Complete sign-in in the popup window');
                  }}
                >
                  <RefreshCw size={15} strokeWidth={1.75} />
                  Reconnect Drive
                </button>
                <button type="button" className="lib-connect-action danger" disabled={busy} onClick={() => void handleDisconnect()}>
                  <Unplug size={15} strokeWidth={1.75} />
                  Disconnect Drive
                </button>
              </>
            ) : (
              <button
                type="button"
                className="lib-connect-action primary"
                onClick={() => {
                  onConnectDrive();
                  onToast('Sign in with Google to connect Drive');
                }}
              >
                <Link2 size={15} strokeWidth={1.75} />
                Connect Google Drive
              </button>
            )}
          </div>

          <div className="lib-connect-section">
            <div className="lib-connect-row">
              <FolderOpen size={16} strokeWidth={1.75} aria-hidden />
              <div className="lib-connect-row-body">
                <span className="lib-connect-label">Local folder</span>
                <span className={`lib-connect-status${localFolderName && !localNeedsReconnect ? ' on' : ''}`}>
                  {localNeedsReconnect
                    ? `${localFolderName || 'Folder'} — reconnect required`
                    : localFolderName || 'Not linked'}
                </span>
              </div>
            </div>
            <button type="button" className="lib-connect-action" onClick={() => void onConnectLocal()}>
              <FolderOpen size={15} strokeWidth={1.75} />
              {localNeedsReconnect ? 'Reconnect folder' : localFolderName ? 'Change local folder' : 'Choose local folder'}
            </button>
          </div>

          <button
            type="button"
            className="lib-connect-action muted"
            onClick={() => {
              setOpen(false);
              navigate('/dashboard/settings/integrations');
            }}
          >
            <Settings size={15} strokeWidth={1.75} />
            All integrations
          </button>

          <button type="button" className="lib-connect-action muted" onClick={() => void onRefreshStatus()}>
            <RefreshCw size={15} strokeWidth={1.75} />
            Refresh status
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default LibraryConnectMenu;
