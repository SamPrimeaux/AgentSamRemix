import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ActiveFile } from '../types';
import {
  flattenVisibleLocalFileTree,
  findLocalNodeByPath,
  mapLocalNodeByPath,
  readLocalDirectoryEntries,
  type LocalFileNode,
  type LocalFileTreeRow,
} from '../src/lib/localFileTree';
import { toRepoRelativePath } from '../src/lib/agentSamFsChanges';
import {
  clearLegacyServerWorkspaceIdHint,
  clearPersistedLocalDirectoryHandle,
  loadPersistedLocalDirectoryHandle,
  persistLocalDirectoryHandle,
} from '../src/lib/library/localHandleStore';
import { LS_LAST_LOCAL_FOLDER_NAME } from '../src/lib/sessionStorageKeys';

function persistLastLocalFolderNameOnly(name: string): void {
    try {
        const n = name?.trim();
        if (n) localStorage.setItem(LS_LAST_LOCAL_FOLDER_NAME, n);
    } catch {
        /* quota / private mode */
    }
}

function loadLastLocalFolderNameOnly(): string | null {
    try {
        const n = localStorage.getItem(LS_LAST_LOCAL_FOLDER_NAME)?.trim();
        return n || null;
    } catch {
        return null;
    }
}

function clearLastLocalFolderNameOnly(): void {
    try {
        localStorage.removeItem(LS_LAST_LOCAL_FOLDER_NAME);
    } catch {
        /* ignore */
    }
}

async function hydrateLocalRootChildren(
    setRootDir: React.Dispatch<React.SetStateAction<LocalFileNode | null>>,
    dirHandle: FileSystemDirectoryHandle,
): Promise<void> {
    try {
        const children = await readLocalDirectoryEntries(dirHandle);
        setRootDir((prev) =>
            prev && prev.handle === dirHandle
                ? { ...prev, loading: false, children }
                : prev,
        );
    } catch (e) {
        console.error('[FilesRail] directory read failed:', e);
        setRootDir((prev) =>
            prev && prev.handle === dirHandle
                ? { ...prev, loading: false, children: [] }
                : prev,
        );
    }
}

async function queryLocalHandlePermission(
    handle: FileSystemDirectoryHandle,
    mode: 'read' | 'readwrite' = 'readwrite',
): Promise<'granted' | 'denied' | 'prompt'> {
    if (typeof (handle as FileSystemDirectoryHandle & { queryPermission?: unknown }).queryPermission !== 'function') {
        return 'denied';
    }
    return (await (
        handle as FileSystemDirectoryHandle & {
            queryPermission: (o: { mode: string }) => Promise<string>;
        }
    ).queryPermission({ mode })) as 'granted' | 'denied' | 'prompt';
}

async function requestLocalHandlePermission(
    handle: FileSystemDirectoryHandle,
    mode: 'read' | 'readwrite' = 'readwrite',
): Promise<'granted' | 'denied' | 'prompt'> {
    if (typeof (handle as FileSystemDirectoryHandle & { requestPermission?: unknown }).requestPermission !== 'function') {
        return 'denied';
    }
    return (await (
        handle as FileSystemDirectoryHandle & {
            requestPermission: (o: { mode: string }) => Promise<string>;
        }
    ).requestPermission({ mode })) as 'granted' | 'denied' | 'prompt';
}

export type LocalFsaController = {
  rootDir: LocalFileNode | null;
  localResumeHint: { folderName: string } | null;
  localTreeRows: LocalFileTreeRow[];
  onLocalTreeRowClick: (row: LocalFileTreeRow) => void;
  handleOpenFolder: () => Promise<void>;
  handleReconnectPersistedFolder: () => Promise<void>;
  disconnectNativeFolder: () => Promise<void>;
  handleCreateLocalFile: () => Promise<void>;
  handleCreateLocalFolder: () => Promise<void>;
  refreshLocalTree: () => Promise<void>;
};

export function useLocalFsaFolder({
  onFileSelect,
  onOpenInEditor,
  onWorkspaceRootChange,
  nativeFolderOpenSignal = 0,
}: {
  onFileSelect: (file: ActiveFile) => void;
  onOpenInEditor?: (file: ActiveFile) => void;
  onWorkspaceRootChange?: (info: { folderName: string }) => void;
  nativeFolderOpenSignal?: number;
}): LocalFsaController {
    const [rootDir, setRootDir] = useState<LocalFileNode | null>(null);
    /**
     * When the directory handle cannot be revalidated, show vscode.dev-style resume copy.
     * Browser-local only (IndexedDB handle + localStorage name) — never a D1 workspace row.
     */
    const [localResumeHint, setLocalResumeHint] = useState<{ folderName: string } | null>(null);
    /** Local tunnel registry row is connected but last_verified_at is missing or older than 5 minutes. */
    // Stale tunnel warnings surface in the status bar (platformHealthIssues), not the explorer banner.

    const lastNativeFolderSignal = useRef(0);
    const directoryPickerActiveRef = useRef(false);
    const onWorkspaceRootChangeRef = useRef(onWorkspaceRootChange);
    onWorkspaceRootChangeRef.current = onWorkspaceRootChange;
    const lastNotifiedFolderRef = useRef<string | null>(null);

    const mountNativeRoot = useCallback((dirHandle: FileSystemDirectoryHandle) => {
        setLocalResumeHint(null);
        persistLastLocalFolderNameOnly(dirHandle.name);
        const root: LocalFileNode = {
            name: dirHandle.name,
            kind: 'directory',
            handle: dirHandle,
            isOpen: true,
            loading: true,
        };
        setRootDir(root);
        // Continuity handoff: App.tsx onExplorerWorkspaceRootChange →
        // POST /api/workspace/local-bind → switchWorkspace({sync:true}).
        // Notify only when folder name changes — avoids remount ↔ switchWorkspace toast loops.
        const name = root.name;
        if (lastNotifiedFolderRef.current !== name) {
            lastNotifiedFolderRef.current = name;
            onWorkspaceRootChangeRef.current?.({ folderName: name });
        }
        void hydrateLocalRootChildren(setRootDir, dirHandle);
    }, []);

    useEffect(() => {
        if (typeof indexedDB === 'undefined') return;
        void (async () => {
            await clearLegacyServerWorkspaceIdHint();
            const tryResumeHints = () => {
                const nameOnly = loadLastLocalFolderNameOnly();
                if (nameOnly) setLocalResumeHint({ folderName: nameOnly });
            };

            try {
                const h = await loadPersistedLocalDirectoryHandle();
                if (!h) {
                    tryResumeHints();
                    return;
                }
                // requestPermission requires a user gesture — never call it on page load.
                // Prefer readwrite; fall back to read so the tree remounts after refresh
                // when Chrome still grants read (Save/create request write on click).
                const rw = await queryLocalHandlePermission(h, 'readwrite');
                if (rw === 'granted') {
                    mountNativeRoot(h);
                    return;
                }
                const rd = await queryLocalHandlePermission(h, 'read');
                if (rd === 'granted') {
                    mountNativeRoot(h);
                    return;
                }
                persistLastLocalFolderNameOnly(h.name);
                setLocalResumeHint({ folderName: h.name });
            } catch (e) {
                console.warn('[FilesRail] native workspace restore skipped', e);
                tryResumeHints();
            }
        })();
        // Intentionally once on mount — remount on callback identity caused bind/toast spam.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mountNativeRoot is stable (empty deps)
    }, []);

    const localTreeRows = useMemo(
        () => (rootDir ? flattenVisibleLocalFileTree(rootDir) : []),
        [rootDir],
    );

    const handleOpenFolder = useCallback(async () => {
        if (directoryPickerActiveRef.current) return;
        directoryPickerActiveRef.current = true;
        try {
            // File System Access API (Chromium); not in all TS DOM libs
            const dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<any> }).showDirectoryPicker();

            mountNativeRoot(dirHandle);
            await persistLocalDirectoryHandle(dirHandle);
            persistLastLocalFolderNameOnly(dirHandle.name);
            await clearLegacyServerWorkspaceIdHint();

            if (localResumeHint && dirHandle.name !== localResumeHint.folderName) {
                console.warn(
                    '[FilesRail] selected folder name differs from last saved local hint',
                    dirHandle.name,
                    localResumeHint.folderName,
                );
            }
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            if (err instanceof Error && err.name === 'NotAllowedError') {
                console.warn('[FilesRail] directory picker blocked or already open');
                return;
            }
            console.error('Failed to open directory:', err);
        } finally {
            directoryPickerActiveRef.current = false;
        }
    }, [mountNativeRoot, localResumeHint]);

    const handleReconnectPersistedFolder = useCallback(async () => {
        if (directoryPickerActiveRef.current) return;
        try {
            const h = await loadPersistedLocalDirectoryHandle();
            if (!h) {
                await handleOpenFolder();
                return;
            }
            const perm = await requestLocalHandlePermission(h);
            if (perm !== 'granted') return;
            await persistLocalDirectoryHandle(h);
            mountNativeRoot(h);
        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') return;
            console.warn('[FilesRail] reconnect persisted folder failed', e);
        }
    }, [handleOpenFolder, mountNativeRoot]);

    const disconnectNativeFolder = useCallback(async () => {
        setRootDir(null);
        setLocalResumeHint(null);
        lastNotifiedFolderRef.current = null;
        onWorkspaceRootChangeRef.current?.({ folderName: '' });
        await clearPersistedLocalDirectoryHandle();
        await clearLegacyServerWorkspaceIdHint();
        clearLastLocalFolderNameOnly();
    }, []);

    useEffect(() => {
        if (nativeFolderOpenSignal === 0 || nativeFolderOpenSignal === lastNativeFolderSignal.current) return;
        lastNativeFolderSignal.current = nativeFolderOpenSignal;
        void handleOpenFolder();
    }, [nativeFolderOpenSignal, handleOpenFolder]);

    const refreshRootChildren = useCallback(async () => {
        if (!rootDir?.handle || rootDir.kind !== 'directory') return;
        setRootDir((prev) => (prev ? { ...prev, loading: true } : prev));
        await hydrateLocalRootChildren(setRootDir, rootDir.handle as FileSystemDirectoryHandle);
    }, [rootDir]);

    // Agent client_fs / Save landed bytes on disk — keep Files tree honest without a full remount.
    useEffect(() => {
        const onWritten = () => {
            void refreshRootChildren();
        };
        window.addEventListener('iam:local_fs_file_written', onWritten);
        return () => window.removeEventListener('iam:local_fs_file_written', onWritten);
    }, [refreshRootChildren]);

    const onLocalTreeRowClick = useCallback(
        async (row: LocalFileTreeRow) => {
            if (row.type === 'loading' || row.type === 'empty' || !rootDir) return;

            const nodePath = row.id;
            const node = findLocalNodeByPath(rootDir, nodePath);
            if (!node) return;

            if (node.kind === 'file') {
                const file = await (node.handle as FileSystemFileHandle).getFile();
                const { openLocalFileInEditor } = await import('../src/lib/mediaPreview');
                // FSA-relative path (strip root folder name if an older tree id still includes it).
                const relPath =
                  toRepoRelativePath(nodePath, rootDir.name) || file.name || nodePath;
                const openHandler = onOpenInEditor || onFileSelect;
                await openLocalFileInEditor(
                  file,
                  node.handle as FileSystemFileHandle,
                  relPath,
                  openHandler,
                );
                return;
            }

            if (node.isOpen) {
                setRootDir((prev) =>
                    prev ? mapLocalNodeByPath(prev, nodePath, '', (n) => ({ ...n, isOpen: false })) : prev,
                );
                return;
            }

            if (node.children !== undefined) {
                setRootDir((prev) =>
                    prev ? mapLocalNodeByPath(prev, nodePath, '', (n) => ({ ...n, isOpen: true })) : prev,
                );
                return;
            }

            setRootDir((prev) =>
                prev
                    ? mapLocalNodeByPath(prev, nodePath, '', (n) => ({
                          ...n,
                          isOpen: true,
                          loading: true,
                      }))
                    : prev,
            );
            try {
                const children = await readLocalDirectoryEntries(node.handle as FileSystemDirectoryHandle);
                setRootDir((prev) =>
                    prev
                        ? mapLocalNodeByPath(prev, nodePath, '', (n) => ({
                              ...n,
                              isOpen: true,
                              loading: false,
                              children,
                          }))
                        : prev,
                );
            } catch (e) {
                console.error('[FilesRail] expand failed:', e);
                setRootDir((prev) =>
                    prev
                        ? mapLocalNodeByPath(prev, nodePath, '', (n) => ({
                              ...n,
                              isOpen: true,
                              loading: false,
                              children: [],
                          }))
                        : prev,
                );
            }
        },
        [rootDir, onFileSelect, onOpenInEditor],
    );

    const handleCreateLocalFile = async () => {
        if (!rootDir?.handle) {
            void handleOpenFolder();
            return;
        }
        const name = window.prompt('File name:');
        if (!name) return;
        try {
            await rootDir.handle.getFileHandle(name, { create: true });
            await refreshRootChildren();
        } catch (e) {
            console.error('Local file creation failed:', e);
            alert('Failed to create file: ' + (e instanceof Error ? e.message : String(e)));
        }
    };

    const handleCreateLocalFolder = async () => {
        if (!rootDir?.handle) {
            void handleOpenFolder();
            return;
        }
        const name = window.prompt('Folder name:');
        if (!name) return;
        try {
            await rootDir.handle.getDirectoryHandle(name, { create: true });
            await refreshRootChildren();
        } catch (e) {
            console.error('Local folder creation failed:', e);
            alert('Failed to create folder: ' + (e instanceof Error ? e.message : String(e)));
        }
    };


    return {
      rootDir,
      localResumeHint,
      localTreeRows,
      onLocalTreeRowClick,
      handleOpenFolder,
      handleReconnectPersistedFolder,
      disconnectNativeFolder,
      handleCreateLocalFile,
      handleCreateLocalFolder,
      refreshLocalTree: refreshRootChildren,
    };
}
