/** Browser localStorage keys for workspace picker recents — must be user-scoped (see App workspace bootstrap). */
export const LS_IAM_RECENT_WORKSPACES = 'iam_recent_workspaces';
export const LS_IAM_RECENT_WORKSPACES_USER = 'iam_recent_workspaces_user';

/**
 * Call after the session user is known. Clears cross-user stale data; stamps `LS_IAM_RECENT_WORKSPACES_USER`.
 * If there was no prior user stamp (legacy), drops the recent list once so another account's IDs are not reused.
 */
export function prepareRecentWorkspacesForSession(sessionUserId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  const uid = typeof sessionUserId === 'string' ? sessionUserId.trim() : '';
  if (!uid) return;
  try {
    const stored = localStorage.getItem(LS_IAM_RECENT_WORKSPACES_USER);
    if (stored && stored !== uid) {
      localStorage.removeItem(LS_IAM_RECENT_WORKSPACES);
      localStorage.removeItem(LS_IAM_RECENT_WORKSPACES_USER);
    } else if (!stored) {
      localStorage.removeItem(LS_IAM_RECENT_WORKSPACES);
    }
    localStorage.setItem(LS_IAM_RECENT_WORKSPACES_USER, uid);
  } catch {
    /* ignore */
  }
}

/** Only trust `iam_recent_workspaces` when it was written for this session user. */
export function getTrustedRecentWorkspaceId(sessionUserId: string | null | undefined): string {
  if (typeof window === 'undefined') return '';
  const uid = typeof sessionUserId === 'string' ? sessionUserId.trim() : '';
  if (!uid) return '';
  try {
    const storedUserId = localStorage.getItem(LS_IAM_RECENT_WORKSPACES_USER);
    const raw = localStorage.getItem(LS_IAM_RECENT_WORKSPACES);
    const recent = raw ? (JSON.parse(raw) as Array<{ id?: string }>) : [];
    if (storedUserId !== uid) return '';
    const rid = Array.isArray(recent) && recent[0]?.id ? String(recent[0].id).trim() : '';
    return rid;
  } catch {
    return '';
  }
}

export function persistRecentWorkspaceSwitch(
  sessionUserId: string | null | undefined,
  ws: {
    id: string;
    display_name: string;
    slug: string;
    workspace_type?: string | null;
    updated_at?: number | null;
  },
): void {
  if (typeof window === 'undefined') return;
  const uid = typeof sessionUserId === 'string' ? sessionUserId.trim() : '';
  if (!uid) return;
  try {
    const raw = localStorage.getItem(LS_IAM_RECENT_WORKSPACES);
    const prev = raw ? (JSON.parse(raw) as unknown) : [];
    const arr = Array.isArray(prev) ? prev : [];
    const entry = {
      id: ws.id,
      display_name: ws.display_name,
      workspace_type: ws.workspace_type ?? 'ide',
      slug: ws.slug,
      updated_at:
        ws.updated_at != null && Number.isFinite(Number(ws.updated_at))
          ? Number(ws.updated_at)
          : Math.floor(Date.now() / 1000),
    };
    const next = [entry, ...arr.filter((x: { id?: string }) => x?.id !== ws.id)].slice(0, 5);
    localStorage.setItem(LS_IAM_RECENT_WORKSPACES, JSON.stringify(next));
    localStorage.setItem(LS_IAM_RECENT_WORKSPACES_USER, uid);
  } catch {
    /* ignore */
  }
}

export type RecentWorkspaceEntry = {
  id: string;
  display_name: string;
  slug: string;
  workspace_type?: string | null;
  updated_at?: number | null;
};

export function readRecentWorkspacesFromLocalStorage(
  sessionUserId: string | null | undefined,
): RecentWorkspaceEntry[] {
  if (typeof window === 'undefined') return [];
  const uid = typeof sessionUserId === 'string' ? sessionUserId.trim() : '';
  if (!uid) return [];
  try {
    const storedUserId = localStorage.getItem(LS_IAM_RECENT_WORKSPACES_USER);
    if (storedUserId !== uid) return [];
    const raw = localStorage.getItem(LS_IAM_RECENT_WORKSPACES);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is RecentWorkspaceEntry => {
        if (!x || typeof x !== 'object') return false;
        const row = x as RecentWorkspaceEntry;
        return typeof row.id === 'string' && row.id.trim() !== '';
      })
      .slice(0, 5);
  } catch {
    return [];
  }
}

export function clearRecentWorkspacesLocal(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LS_IAM_RECENT_WORKSPACES);
    localStorage.removeItem(LS_IAM_RECENT_WORKSPACES_USER);
  } catch {
    /* ignore */
  }
}
