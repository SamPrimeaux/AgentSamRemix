import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  ExternalLink,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { ActiveFile } from '../types';
import {
  connectGoogleDrive,
  fetchDriveConnectionStatus,
  fetchDriveListing,
  isDriveFolder,
  type DriveApiFile,
} from '../src/lib/library/libraryApi';

type FolderCrumb = { id: string; name: string };

function driveFileIcon(file: DriveApiFile) {
  return isDriveFolder(file) ? Folder : HardDrive;
}

export const DriveExplorerPanel: React.FC<{
  onOpenInEditor?: (file: ActiveFile) => void;
  embedded?: boolean;
}> = ({ onOpenInEditor, embedded = false }) => {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<DriveApiFile[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([{ id: 'root', name: 'My Drive' }]);

  const currentFolder = folderStack[folderStack.length - 1] ?? { id: 'root', name: 'My Drive' };

  const loadStatus = useCallback(async () => {
    const st = await fetchDriveConnectionStatus();
    setConnected(st.connected);
    setStatusError(st.connected ? null : st.error || 'not_connected');
  }, []);

  const loadFiles = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setListError(null);
    try {
      const res = await fetchDriveListing({
        view: 'my-drive',
        folderId: currentFolder.id,
      });
      if (!res.ok) {
        setFiles([]);
        setListError(res.error || 'Failed to load Drive files');
        if (res.unauthorized) setConnected(false);
        return;
      }
      const sorted = [...res.files].sort((a, b) => {
        const af = isDriveFolder(a) ? 0 : 1;
        const bf = isDriveFolder(b) ? 0 : 1;
        if (af !== bf) return af - bf;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      setFiles(sorted);
    } catch (e) {
      setFiles([]);
      setListError(e instanceof Error ? e.message : 'Failed to load Drive files');
    } finally {
      setLoading(false);
    }
  }, [connected, currentFolder.id]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (connected) void loadFiles();
  }, [connected, loadFiles]);

  const openFolder = useCallback((file: DriveApiFile) => {
    if (!isDriveFolder(file)) return;
    setFolderStack((prev) => [...prev, { id: file.id, name: file.name }]);
  }, []);

  const openFile = useCallback(
    async (file: DriveApiFile) => {
      if (isDriveFolder(file)) {
        openFolder(file);
        return;
      }
      const mime = file.mimeType || '';
      const isImage = mime.startsWith('image/');
      const isText = mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript');
      if (onOpenInEditor && isImage) {
        onOpenInEditor({
          name: file.name,
          content: '',
          originalContent: '',
          driveFileId: file.id,
          isImage: true,
          previewUrl: `/api/integrations/gdrive/raw?fileId=${encodeURIComponent(file.id)}`,
        });
        return;
      }
      if (onOpenInEditor && isText) {
        try {
          const res = await fetch(`/api/integrations/gdrive/file?fileId=${encodeURIComponent(file.id)}`, {
            credentials: 'same-origin',
          });
          const data = await res.json();
          if (res.ok && typeof data.content === 'string') {
            onOpenInEditor({
              name: file.name,
              content: data.content,
              originalContent: data.content,
              driveFileId: file.id,
            });
            return;
          }
        } catch {
          /* fall through */
        }
      }
      window.open(
        `/api/integrations/gdrive/raw?fileId=${encodeURIComponent(file.id)}`,
        '_blank',
        'noopener,noreferrer',
      );
    },
    [onOpenInEditor, openFolder],
  );

  const crumbs = useMemo(() => folderStack, [folderStack]);

  if (connected === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Checking Drive…
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center">
        <FolderOpen size={22} className="text-[var(--solar-green)] opacity-80" aria-hidden />
        <p className="text-[11px] text-muted leading-relaxed max-w-[220px]">
          Connect Google Drive to browse folders and open files in the editor.
        </p>
        {statusError ? (
          <p className="text-[10px] text-[var(--solar-orange)]">{statusError}</p>
        ) : null}
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-[var(--text-main)] text-[var(--bg-panel)] text-[11px] font-semibold hover:brightness-110"
          onClick={() => {
            void connectGoogleDrive().then(() => void loadStatus());
          }}
        >
          <ExternalLink size={12} aria-hidden />
          Connect Drive
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col h-full min-h-0 text-main overflow-hidden ${
        embedded ? 'bg-transparent' : 'bg-[var(--dashboard-panel)]'
      }`}
    >
      {!embedded ? (
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
          {crumbs.map((crumb, idx) => (
            <React.Fragment key={crumb.id}>
              {idx > 0 ? <ChevronRight size={10} className="shrink-0 text-muted" /> : null}
              <button
                type="button"
                className={`shrink-0 text-[10px] truncate max-w-[88px] ${
                  idx === crumbs.length - 1
                    ? 'text-[var(--solar-cyan)] font-semibold'
                    : 'text-muted hover:text-main'
                }`}
                onClick={() => setFolderStack(crumbs.slice(0, idx + 1))}
                title={crumb.name}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void loadFiles()}
          disabled={loading}
          className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 shrink-0"
          title="Refresh"
          aria-label="Refresh Drive files"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      ) : (
        <div className="shrink-0 px-2 py-1 border-b border-[var(--border-subtle)]/30 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0 overflow-x-auto flex-1">
            {crumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.id}>
                {idx > 0 ? <ChevronRight size={10} className="shrink-0 text-muted" /> : null}
                <button
                  type="button"
                  className={`shrink-0 text-[10px] truncate max-w-[96px] ${
                    idx === crumbs.length - 1
                      ? 'text-[var(--solar-cyan)] font-semibold'
                      : 'text-muted hover:text-main'
                  }`}
                  onClick={() => setFolderStack(crumbs.slice(0, idx + 1))}
                  title={crumb.name}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void loadFiles()}
            disabled={loading}
            className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 shrink-0"
            title="Refresh"
            aria-label="Refresh Drive files"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-1 py-1">
        {loading && files.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-muted">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            Loading…
          </div>
        ) : listError ? (
          <p className="px-3 py-4 text-[11px] text-[var(--solar-orange)]">
            {listError}
            {listError.toLowerCase().includes('not connected') || listError.toLowerCase().includes('unauthorized') ? (
              <>
                {' '}
                <button
                  type="button"
                  className="underline font-semibold"
                  onClick={() => {
                    void connectGoogleDrive().then(() => void loadStatus());
                  }}
                >
                  Reconnect Drive
                </button>
              </>
            ) : null}
          </p>
        ) : files.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-muted">This folder is empty.</p>
        ) : (
          files.map((file) => {
            const Icon = driveFileIcon(file);
            return (
              <button
                key={file.id}
                type="button"
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-[var(--bg-hover)] group"
                onClick={() => void openFile(file)}
                title={file.name}
              >
                <Icon
                  size={13}
                  className={
                    isDriveFolder(file)
                      ? 'text-[var(--solar-yellow)] shrink-0'
                      : 'text-muted shrink-0'
                  }
                />
                <span className="text-[11px] truncate flex-1">{file.name}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default DriveExplorerPanel;
