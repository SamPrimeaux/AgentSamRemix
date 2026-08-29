/**
 * Local app-library prefs (icons, hide, pin order) — user-scoped.
 * Does not replace D1 workspaces; only presentation for Workspace home.
 */

const LS_APP_LIBRARY = 'iam_app_library_v1';
const LS_APP_LIBRARY_USER = 'iam_app_library_user';

export type AppLibraryPrefs = {
  /** workspace/app id → data URL or https icon */
  icons: Record<string, string>;
  /** hidden ids */
  hidden: string[];
  /** manual pin order (ids) — highest relevance first */
  pins: string[];
  /** optional display name overrides */
  labels: Record<string, string>;
};

const EMPTY: AppLibraryPrefs = { icons: {}, hidden: [], pins: [], labels: {} };

function storageKeyForUser(uid: string): string {
  return `${LS_APP_LIBRARY}:${uid}`;
}

export function loadAppLibraryPrefs(sessionUserId: string | null | undefined): AppLibraryPrefs {
  if (typeof window === 'undefined') return { ...EMPTY };
  const uid = String(sessionUserId || '').trim();
  if (!uid) return { ...EMPTY };
  try {
    const stamped = localStorage.getItem(LS_APP_LIBRARY_USER);
    if (stamped && stamped !== uid) {
      localStorage.removeItem(storageKeyForUser(stamped));
    }
    localStorage.setItem(LS_APP_LIBRARY_USER, uid);
    const raw = localStorage.getItem(storageKeyForUser(uid));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<AppLibraryPrefs>;
    return {
      icons: parsed.icons && typeof parsed.icons === 'object' ? parsed.icons : {},
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.map(String) : [],
      pins: Array.isArray(parsed.pins) ? parsed.pins.map(String) : [],
      labels: parsed.labels && typeof parsed.labels === 'object' ? parsed.labels : {},
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveAppLibraryPrefs(
  sessionUserId: string | null | undefined,
  prefs: AppLibraryPrefs,
): void {
  if (typeof window === 'undefined') return;
  const uid = String(sessionUserId || '').trim();
  if (!uid) return;
  try {
    localStorage.setItem(LS_APP_LIBRARY_USER, uid);
    localStorage.setItem(storageKeyForUser(uid), JSON.stringify(prefs));
  } catch {
    /* quota */
  }
}

/** Prefer active + recent + pinned; default top-N clones by relevance. */
export function rankAppLibraryIds(opts: {
  allIds: string[];
  activeId?: string | null;
  recentIds: string[];
  pins: string[];
  hidden: string[];
}): string[] {
  const hidden = new Set(opts.hidden);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (id: string) => {
    const k = String(id || '').trim();
    if (!k || hidden.has(k) || seen.has(k)) return;
    if (!opts.allIds.includes(k)) return;
    seen.add(k);
    out.push(k);
  };
  if (opts.activeId) push(opts.activeId);
  for (const id of opts.pins) push(id);
  for (const id of opts.recentIds) push(id);
  for (const id of opts.allIds) push(id);
  return out;
}
