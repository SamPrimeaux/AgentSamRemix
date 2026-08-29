import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { r2ParentPrefix } from './formatLibrary';
import {
  connectGoogleDrive,
  connectGoogleDriveForManage,
  disconnectGoogleDrive,
  fetchDriveConnectionStatus,
  fetchR2BucketNames,
  fetchR2StorageLabel,
  type DriveConnectionStatus,
} from './libraryApi';
import {
  loadPersistedLocalDirectoryHandle,
  persistLocalDirectoryHandle,
  pickLocalDirectoryHandle,
  queryLocalReadPermission,
  requestLocalReadPermission,
} from './localHandleStore';
import { listLibrarySources } from './providers';
import type {
  DriveView,
  LibraryDisplayKind,
  LibraryFilters,
  LibraryItem,
  LibraryRail,
  SourceFilter,
} from './types';
import {
  DEFAULT_LIBRARY_FILTERS,
  NAV_DRIVE_VIEW,
  NAV_RAIL_MAP,
  RAIL_TITLES,
} from './types';

const DRIVE_VIEW_TITLES: Record<DriveView, string> = {
  'my-drive': 'Google Drive',
  'shared-with-me': 'Shared with me',
  'shared-drives': 'Shared drives',
  'shared-drive': 'Shared drive',
  trash: 'Trash',
  starred: 'Starred',
};

export function useLibraryWorkspace() {
  const [searchParams] = useSearchParams();
  const sessionId = (searchParams.get('session_id') || '').trim();

  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_LIBRARY_FILTERS);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [driveConnected, setDriveConnected] = useState<boolean | undefined>(undefined);
  const [driveStatus, setDriveStatus] = useState<DriveConnectionStatus | null>(null);
  const [driveView, setDriveView] = useState<DriveView>('my-drive');
  const [driveFolderId, setDriveFolderId] = useState('root');
  const [driveFolderStack, setDriveFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [sharedDriveId, setSharedDriveId] = useState<string | null>(null);
  const [r2Bucket, setR2Bucket] = useState('');
  const [r2Prefix, setR2Prefix] = useState('');
  const [r2Buckets, setR2Buckets] = useState<string[]>([]);
  const [storageLabel, setStorageLabel] = useState<string | null>(null);
  const [localDirHandle, setLocalDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [localPath, setLocalPath] = useState('');
  const [localFolderName, setLocalFolderName] = useState<string | null>(null);
  const [localNeedsReconnect, setLocalNeedsReconnect] = useState(false);

  const loadSeq = useRef(0);

  const activeRail = filters.rail;
  const pageTitle = useMemo(() => {
    if (activeRail === 'tickets') return RAIL_TITLES.tickets;
    if (activeRail === 'projects') return RAIL_TITLES.projects;
    if (activeRail === 'drive') {
      if (driveView === 'shared-drives' && !sharedDriveId) return DRIVE_VIEW_TITLES['shared-drives'];
      if (driveView === 'shared-with-me') {
        if (driveFolderStack.length) {
          return driveFolderStack[driveFolderStack.length - 1]?.name ?? DRIVE_VIEW_TITLES['shared-with-me'];
        }
        return DRIVE_VIEW_TITLES['shared-with-me'];
      }
      if (driveView === 'shared-drive' || sharedDriveId) {
        if (driveFolderStack.length) {
          return driveFolderStack[driveFolderStack.length - 1]?.name ?? DRIVE_VIEW_TITLES['shared-drive'];
        }
        return DRIVE_VIEW_TITLES['shared-drive'];
      }
      if (driveFolderStack.length) {
        return driveFolderStack[driveFolderStack.length - 1]?.name ?? RAIL_TITLES.drive;
      }
      return RAIL_TITLES.drive;
    }
    if (activeRail === 'r2' && r2Prefix) {
      const parts = r2Prefix.replace(/\/$/, '').split('/');
      return parts[parts.length - 1] || RAIL_TITLES.r2;
    }
    if (activeRail === 'local' && localPath) {
      const parts = localPath.split('/');
      return parts[parts.length - 1] || localFolderName || RAIL_TITLES.local;
    }
    return RAIL_TITLES[activeRail];
  }, [activeRail, driveView, driveFolderStack, sharedDriveId, r2Prefix, localPath, localFolderName]);

  const refreshDriveStatus = useCallback(async () => {
    const st = await fetchDriveConnectionStatus();
    setDriveStatus(st);
    setDriveConnected(st.connected);
    return st;
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setErrors([]);
    const controller = new AbortController();

    try {
      await refreshDriveStatus();
      const { items: nextItems, errors: nextErrors, driveConnected: dc } = await listLibrarySources({
        rail: filters.rail,
        query: filters.query,
        sessionId: sessionId || undefined,
        signal: controller.signal,
        driveFolderId,
        driveView,
        sharedDriveId,
        r2Bucket,
        r2Prefix,
        localDirHandle,
        localPath,
      });
      if (seq !== loadSeq.current) return;
      setItems(nextItems);
      setErrors(nextErrors);
      setDriveConnected(dc);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setItems([]);
      setErrors([e instanceof Error ? e.message : 'Library load failed']);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }

    return () => controller.abort();
  }, [
    filters.rail,
    filters.query,
    sessionId,
    driveFolderId,
    driveView,
    sharedDriveId,
    r2Bucket,
    r2Prefix,
    localDirHandle,
    localPath,
    refreshDriveStatus,
  ]);

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), filters.query ? 280 : 0);
    return () => window.clearTimeout(t);
  }, [refresh, filters.query]);

  useEffect(() => {
    void (async () => {
      const buckets = await fetchR2BucketNames();
      setR2Buckets(buckets);
      if (buckets.length && !r2Bucket) setR2Bucket(buckets[0]);
    })();
  }, [r2Bucket]);

  useEffect(() => {
    if (!r2Bucket) return;
    void (async () => {
      const label = await fetchR2StorageLabel(r2Bucket);
      setStorageLabel(label);
    })();
  }, [r2Bucket]);

  useEffect(() => {
    const rail = searchParams.get('rail');
    const bucket = searchParams.get('bucket')?.trim();
    const prefix = searchParams.get('prefix');
    if (rail === 'r2' && bucket) {
      setFilters((f) => ({ ...f, rail: 'r2', source: 'r2' }));
      setR2Bucket(bucket);
      if (prefix != null) setR2Prefix(prefix);
    } else if (rail === 'local') {
      setFilters((f) => ({ ...f, rail: 'local', source: 'local' }));
    }
  }, [searchParams]);

  useEffect(() => {
    void (async () => {
      const handle = await loadPersistedLocalDirectoryHandle();
      if (!handle) {
        setLocalNeedsReconnect(false);
        return;
      }
      const perm = await queryLocalReadPermission(handle);
      if (perm === 'granted' || perm === 'unsupported') {
        setLocalDirHandle(handle);
        setLocalFolderName(handle.name);
        setLocalNeedsReconnect(false);
      } else {
        setLocalDirHandle(null);
        setLocalFolderName(handle.name);
        setLocalNeedsReconnect(true);
      }
    })();
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'oauth_success' && e.data?.provider === 'google') void refresh();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [refresh]);

  const resetDriveNav = useCallback((view: DriveView) => {
    setDriveView(view);
    setDriveFolderId('root');
    setDriveFolderStack([]);
    setSharedDriveId(null);
  }, []);

  const setRail = useCallback((rail: LibraryRail) => {
    const source: SourceFilter =
      rail === 'all' || rail === 'projects' || rail === 'tickets' || rail === 'recent'
        ? 'all'
        : rail === 'starred' || rail === 'trash'
          ? 'drive'
          : (rail as SourceFilter);
    setFilters((f) => ({ ...f, rail, source }));
    if (rail === 'drive') {
      resetDriveNav('my-drive');
    } else {
      setDriveFolderId('root');
      setDriveFolderStack([]);
      setSharedDriveId(null);
    }
    setR2Prefix('');
    setLocalPath('');
  }, [resetDriveNav]);

  const setNavKey = useCallback(
    (navKey: string) => {
      const rail = NAV_RAIL_MAP[navKey];
      const nextDriveView = NAV_DRIVE_VIEW[navKey];
      if (rail) {
        const source: SourceFilter =
          rail === 'all' || rail === 'projects' || rail === 'tickets' || rail === 'recent'
            ? 'all'
            : rail === 'starred' || rail === 'trash'
              ? 'drive'
              : (rail as SourceFilter);
        setFilters((f) => ({ ...f, rail, source }));
        if (rail === 'drive' && nextDriveView) {
          resetDriveNav(nextDriveView);
        } else if (rail === 'trash' || rail === 'starred') {
          setDriveView(nextDriveView || (rail === 'trash' ? 'trash' : 'starred'));
          setDriveFolderId('root');
          setDriveFolderStack([]);
          setSharedDriveId(null);
          setFilters((f) => ({ ...f, source: 'drive' }));
        } else if (rail !== 'drive') {
          setR2Prefix('');
          setLocalPath('');
        }
        return;
      }
    },
    [resetDriveNav],
  );

  const setQuery = useCallback((query: string) => {
    setFilters((f) => ({ ...f, query }));
  }, []);

  const setSourceFilter = useCallback((source: SourceFilter) => {
    setFilters((f) => ({ ...f, source }));
  }, []);

  const setTypeFilter = useCallback((type: LibraryDisplayKind | 'all') => {
    setFilters((f) => ({ ...f, type }));
  }, []);

  const navigateIntoFolder = useCallback(
    (item: LibraryItem) => {
      if (item.kind !== 'folder') return;
      if (item.source === 'drive') {
        const isSharedDriveRoot = !!item.metadata?.isSharedDriveRoot;
        const driveId = String(item.metadata?.driveId ?? item.nativeId);
        if (isSharedDriveRoot || driveView === 'shared-drives') {
          setDriveView('shared-drive');
          setSharedDriveId(driveId);
          setDriveFolderId(driveId);
          setDriveFolderStack([{ id: driveId, name: item.name }]);
        } else {
          setDriveFolderId(item.nativeId);
          setDriveFolderStack((s) => [...s, { id: item.nativeId, name: item.name }]);
        }
        setFilters((f) => ({ ...f, rail: 'drive', source: 'drive' }));
        return;
      }
      if (item.source === 'r2') {
        const prefix = String(item.metadata?.prefix ?? item.nativeId);
        setR2Prefix(prefix.endsWith('/') ? prefix : `${prefix}/`);
        setR2Bucket(String(item.metadata?.bucket ?? r2Bucket));
        setFilters((f) => ({ ...f, rail: 'r2', source: 'r2' }));
        return;
      }
      if (item.source === 'local') {
        setLocalPath(item.nativeId);
        setFilters((f) => ({ ...f, rail: 'local', source: 'local' }));
      }
    },
    [driveView, r2Bucket],
  );

  const navigateUp = useCallback(() => {
    if (activeRail === 'drive') {
      if (driveFolderStack.length > 1) {
        const next = driveFolderStack.slice(0, -1);
        setDriveFolderStack(next);
        setDriveFolderId(next[next.length - 1]?.id ?? 'root');
        return;
      }
      if (driveView === 'shared-drive' || sharedDriveId) {
        resetDriveNav('shared-drives');
        return;
      }
      if (driveFolderStack.length === 1) {
        setDriveFolderStack([]);
        setDriveFolderId('root');
      }
      return;
    }
    if (activeRail === 'r2' && r2Prefix) {
      setR2Prefix(r2ParentPrefix(r2Prefix));
      return;
    }
    if (activeRail === 'local' && localPath) {
      const parts = localPath.split('/').filter(Boolean);
      parts.pop();
      setLocalPath(parts.join('/'));
    }
  }, [activeRail, driveFolderStack, driveView, sharedDriveId, r2Prefix, localPath, resetDriveNav]);

  const connectDrive = useCallback(async () => {
    const out = await connectGoogleDrive();
    if (out.ok) await refresh();
    return out;
  }, [refresh]);

  const connectDriveForManage = useCallback(async () => {
    const out = await connectGoogleDriveForManage();
    if (out.ok) await refresh();
    return out;
  }, [refresh]);

  const disconnectDrive = useCallback(async () => {
    const out = await disconnectGoogleDrive();
    if (out.ok) {
      await refresh();
    }
    return out;
  }, [refresh]);

  const connectLocalFolder = useCallback(async () => {
    const persisted = await loadPersistedLocalDirectoryHandle();
    if (persisted) {
      const perm = await requestLocalReadPermission(persisted);
      if (perm === 'granted' || perm === 'unsupported') {
        await persistLocalDirectoryHandle(persisted);
        setLocalDirHandle(persisted);
        setLocalFolderName(persisted.name);
        setLocalNeedsReconnect(false);
        setLocalPath('');
        setRail('local');
        void refresh();
        return;
      }
    }
    const handle = await pickLocalDirectoryHandle();
    if (!handle) return;
    setLocalDirHandle(handle);
    setLocalFolderName(handle.name);
    setLocalNeedsReconnect(false);
    setLocalPath('');
    setRail('local');
    void refresh();
  }, [refresh, setRail]);

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (filters.source !== 'all' && item.source !== filters.source) return false;
      if (filters.type !== 'all' && item.displayKind !== filters.type && item.kind === 'file') {
        return false;
      }
      if (filters.rail === 'starred' && !item.starred) return false;
      if (filters.rail === 'trash' && !item.trashed) return false;
      return true;
    });
  }, [items, filters.source, filters.type, filters.rail]);

  const folders = useMemo(
    () => visibleItems.filter((i) => i.kind === 'folder'),
    [visibleItems],
  );
  const files = useMemo(
    () => visibleItems.filter((i) => i.kind === 'file'),
    [visibleItems],
  );

  const canNavigateUp =
    (activeRail === 'drive' &&
      (driveFolderStack.length > 0 || driveView === 'shared-drive' || !!sharedDriveId)) ||
    (activeRail === 'r2' && !!r2Prefix) ||
    (activeRail === 'local' && !!localPath);

  return {
    sessionId,
    filters,
    items,
    folders,
    files,
    loading,
    errors,
    driveConnected,
    driveStatus,
    driveView,
    sharedDriveId,
    driveFolderStack,
    r2Bucket,
    r2Buckets,
    r2Prefix,
    storageLabel,
    localFolderName,
    localNeedsReconnect,
    pageTitle,
    canNavigateUp,
    setQuery,
    setNavKey,
    setRail,
    setSourceFilter,
    setTypeFilter,
    navigateIntoFolder,
    navigateUp,
    connectDrive,
    connectDriveForManage,
    disconnectDrive,
    connectLocalFolder,
    refresh,
    refreshDriveStatus,
  };
}
