/** Recent-files localStorage helpers for App shell (Wave 2 E1). */
import type { RecentFileEntry } from '../src/ideWorkspace';

export const IAM_RECENT_FILES_LS_KEY = 'iam_recent_files';
export const IAM_RECENT_FILES_LS_CAP = 10;

export function isRecentFileEntry(x: unknown): x is RecentFileEntry {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as RecentFileEntry).id === 'string' &&
    typeof (x as RecentFileEntry).name === 'string' &&
    typeof (x as RecentFileEntry).openedAt === 'number'
  );
}

export function readRecentFilesFromLocalStorage(): RecentFileEntry[] {
  try {
    const raw = localStorage.getItem(IAM_RECENT_FILES_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentFileEntry).slice(0, IAM_RECENT_FILES_LS_CAP);
  } catch {
    return [];
  }
}

export function persistRecentFileToLocalStorage(entry: RecentFileEntry): void {
  try {
    const prev = readRecentFilesFromLocalStorage();
    const next = [entry, ...prev.filter((e) => e.id !== entry.id)].slice(0, IAM_RECENT_FILES_LS_CAP);
    localStorage.setItem(IAM_RECENT_FILES_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

