import {
  LOCAL_DIR_HANDLE_IDB_KEY,
  LOCAL_DIR_HANDLE_IDB_NAME,
  LOCAL_DIR_HANDLE_IDB_STORE,
  LOCAL_DIR_HINT_IDB_KEY,
  LOCAL_DIR_HINT_IDB_STORE,
} from '../sessionStorageKeys';

type PermissionState = 'granted' | 'denied' | 'prompt';

type HandleWithPermission = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: string }) => Promise<string>;
  requestPermission?: (o: { mode: string }) => Promise<string>;
};

function openNativeWsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DIR_HANDLE_IDB_NAME, 2);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOCAL_DIR_HANDLE_IDB_STORE)) {
        db.createObjectStore(LOCAL_DIR_HANDLE_IDB_STORE);
      }
      // Do not create LOCAL_DIR_HINT_IDB_STORE — legacy wipe-only if it already exists.
    };
  });
}

export async function loadPersistedLocalDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openNativeWsDb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(LOCAL_DIR_HANDLE_IDB_STORE, 'readonly');
      const req = tx.objectStore(LOCAL_DIR_HANDLE_IDB_STORE).get(LOCAL_DIR_HANDLE_IDB_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

export async function persistLocalDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openNativeWsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOCAL_DIR_HANDLE_IDB_STORE, 'readwrite');
    tx.objectStore(LOCAL_DIR_HANDLE_IDB_STORE).put(handle, LOCAL_DIR_HANDLE_IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function clearPersistedLocalDirectoryHandle(): Promise<void> {
  try {
    const db = await openNativeWsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_DIR_HANDLE_IDB_STORE, 'readwrite');
      tx.objectStore(LOCAL_DIR_HANDLE_IDB_STORE).delete(LOCAL_DIR_HANDLE_IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
}

/** Wipe legacy D1 session-id hints left from older Local Explorer builds — do not write. */
export async function clearLegacyServerWorkspaceIdHint(): Promise<void> {
  try {
    const db = await openNativeWsDb();
    if (!db.objectStoreNames.contains(LOCAL_DIR_HINT_IDB_STORE)) {
      db.close();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_DIR_HINT_IDB_STORE, 'readwrite');
      tx.objectStore(LOCAL_DIR_HINT_IDB_STORE).delete(LOCAL_DIR_HINT_IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export async function pickLocalDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof window.showDirectoryPicker !== 'function') return null;
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await persistLocalDirectoryHandle(handle);
    return handle;
  } catch {
    return null;
  }
}

/** Query only — safe on page load (no user activation required). */
export async function queryLocalReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState | 'unsupported'> {
  const h = handle as HandleWithPermission;
  if (typeof h.queryPermission !== 'function') return 'unsupported';
  const state = await h.queryPermission({ mode: 'read' });
  if (state === 'granted' || state === 'denied' || state === 'prompt') return state;
  return 'denied';
}

/**
 * Must run synchronously inside a click/tap handler — browsers reject otherwise.
 * Never call from useEffect, OAuth callbacks, or post-load refresh paths.
 */
export async function requestLocalReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState | 'unsupported'> {
  const h = handle as HandleWithPermission;
  if (typeof h.queryPermission !== 'function') return 'unsupported';
  let state = await h.queryPermission({ mode: 'read' });
  if (state === 'granted') return 'granted';
  if (typeof h.requestPermission !== 'function') return 'denied';
  state = await h.requestPermission({ mode: 'read' });
  if (state === 'granted' || state === 'denied' || state === 'prompt') return state;
  return 'denied';
}

/** @deprecated Prefer queryLocalReadPermission + explicit reconnect click. */
export async function ensureLocalReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const state = await queryLocalReadPermission(handle);
  return state === 'granted' || state === 'unsupported';
}

export async function resolveLocalSubdirectoryHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  opts?: { create?: boolean },
): Promise<FileSystemDirectoryHandle | null> {
  if (!path.trim()) return root;
  const parts = path.split('/').filter(Boolean);
  let current = root;
  const create = opts?.create === true;
  for (const part of parts) {
    try {
      current = await current.getDirectoryHandle(part, create ? { create: true } : undefined);
    } catch {
      return null;
    }
  }
  return current;
}
