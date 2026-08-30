/**
 * User-scoped workspace payload — persisted in localStorage (survives browser restarts).
 * Legacy key `iam_workspace` in sessionStorage is migrated once on read.
 * Key strings: app/src/lib/sessionStorageKeys.ts (SSOT).
 */
export {
  IAM_WORKSPACE_LS_PREFIX,
  IAM_WORKSPACE_SESSION_KEY,
  IAM_WORKSPACE_USER_PIN_PREFIX,
} from './lib/sessionStorageKeys';
import {
  IAM_WORKSPACE_LS_PREFIX,
  IAM_WORKSPACE_SESSION_KEY,
  IAM_WORKSPACE_USER_PIN_PREFIX,
} from './lib/sessionStorageKeys';

export type IamWorkspaceSettingsRow = {
  id: string;
  name?: string;
  display_name?: string;
  slug?: string;
  category?: string;
  brand?: string;
  github_repo?: string | null;
  root_path?: string | null;
  status?: string;
};

export type IamWorkspaceSessionPayload = {
  fetchedAt: number;
  sessionUserId: string | null;
  current: string | null;
  data: IamWorkspaceSettingsRow[];
  workspaceThemes?: Record<string, string>;
  workspaces?: Record<string, unknown>;
};

function isPayload(v: unknown): v is IamWorkspaceSessionPayload {
  if (!v || typeof v !== 'object') return false;
  const o = v as IamWorkspaceSessionPayload;
  return Array.isArray(o.data) && typeof o.fetchedAt === 'number';
}

function storageKeyForUser(userId: string | null | undefined): string {
  const uid = typeof userId === 'string' ? userId.trim() : '';
  return uid ? `${IAM_WORKSPACE_LS_PREFIX}:${uid}` : IAM_WORKSPACE_SESSION_KEY;
}

function readLegacySessionPayload(): IamWorkspaceSessionPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(IAM_WORKSPACE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readIamWorkspaceSession(userId?: string | null): IamWorkspaceSessionPayload | null {
  if (typeof window === 'undefined') return null;
  const key = storageKeyForUser(userId);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isPayload(parsed)) return parsed;
    }
  } catch {
    /* fall through */
  }

  const legacy = readLegacySessionPayload();
  if (legacy && (!userId || !legacy.sessionUserId || legacy.sessionUserId === userId)) {
    writeIamWorkspaceSession({ ...legacy, sessionUserId: userId ?? legacy.sessionUserId });
    try {
      sessionStorage.removeItem(IAM_WORKSPACE_SESSION_KEY);
    } catch {
      /* ignore */
    }
    return legacy;
  }
  return null;
}

export function writeIamWorkspaceSession(payload: IamWorkspaceSessionPayload): void {
  if (typeof window === 'undefined') return;
  const key = storageKeyForUser(payload.sessionUserId);
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

/** Best-effort read of the most recently cached workspace payload (sync, before auth/me). */
export function readLatestIamWorkspaceSession(): {
  payload: IamWorkspaceSessionPayload;
  userId: string | null;
} | null {
  if (typeof window === 'undefined') return null;
  let best: IamWorkspaceSessionPayload | null = null;
  let bestUserId: string | null = null;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(`${IAM_WORKSPACE_LS_PREFIX}:`)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (!isPayload(parsed) || parsed.data.length === 0) continue;
      const uid = key.slice(`${IAM_WORKSPACE_LS_PREFIX}:`.length) || null;
      if (!best || parsed.fetchedAt >= best.fetchedAt) {
        best = parsed;
        bestUserId = uid;
      }
    }
  } catch {
    /* ignore */
  }
  if (best) return { payload: best, userId: bestUserId };
  const legacy = readIamWorkspaceSession(null);
  if (legacy && legacy.data.length > 0) {
    return { payload: legacy, userId: legacy.sessionUserId ?? null };
  }
  return null;
}

/** Update active workspace id in local cache after selector switch (no API round-trip). */
export function patchIamWorkspaceSessionCurrent(
  workspaceId: string,
  patch?: Partial<IamWorkspaceSettingsRow>,
  userId?: string | null,
): void {
  const prev = readIamWorkspaceSession(userId ?? undefined);
  if (!prev) return;
  const id = workspaceId.trim();
  if (!id) return;
  let data = prev.data;
  if (patch && Object.keys(patch).length > 0) {
    const idx = data.findIndex((r) => r.id === id);
    if (idx >= 0) {
      data = data.slice();
      data[idx] = { ...data[idx], ...patch, id };
    } else if (patch.name || patch.display_name) {
      data = [{ id, ...patch }, ...data];
    }
  }
  writeIamWorkspaceSession({
    ...prev,
    sessionUserId: userId ?? prev.sessionUserId ?? null,
    current: id,
    data,
    fetchedAt: Date.now(),
  });
}

export function clearIamWorkspaceSession(userId?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(storageKeyForUser(userId));
    sessionStorage.removeItem(IAM_WORKSPACE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function userPinKey(userId: string | null | undefined): string | null {
  const uid = typeof userId === 'string' ? userId.trim() : '';
  return uid ? `${IAM_WORKSPACE_USER_PIN_PREFIX}:${uid}` : null;
}

/** Last workspace explicitly chosen in WorkspaceLauncher / status bar (not route-derived). */
export function readUserPinnedWorkspace(userId?: string | null): string | null {
  if (typeof window === 'undefined') return null;
  const key = userPinKey(userId);
  if (!key) return null;
  try {
    return localStorage.getItem(key)?.trim() || null;
  } catch {
    return null;
  }
}

export function writeUserPinnedWorkspace(userId: string | null | undefined, workspaceId: string | null): void {
  if (typeof window === 'undefined') return;
  const key = userPinKey(userId);
  if (!key) return;
  try {
    const id = workspaceId?.trim();
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
