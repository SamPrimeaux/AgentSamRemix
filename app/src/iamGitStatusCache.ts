/** Session-scoped git status from GET /api/agent/git/status — 5 minute TTL. */
export { IAM_GIT_STATUS_SESSION_KEY } from './lib/sessionStorageKeys';
import { IAM_GIT_STATUS_SESSION_KEY } from './lib/sessionStorageKeys';
export const IAM_GIT_STATUS_TTL_MS = 5 * 60 * 1000;

export type IamGitStatusCache = {
  fetchedAt: number;
  branch?: string;
  repo?: string;
  repo_full_name?: string;
};

function isCache(v: unknown): v is IamGitStatusCache {
  if (!v || typeof v !== 'object') return false;
  const o = v as IamGitStatusCache;
  return typeof o.fetchedAt === 'number';
}

export function readIamGitStatusCache(): IamGitStatusCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(IAM_GIT_STATUS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isCache(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeIamGitStatusCache(payload: Omit<IamGitStatusCache, 'fetchedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      IAM_GIT_STATUS_SESSION_KEY,
      JSON.stringify({ ...payload, fetchedAt: Date.now() }),
    );
  } catch {
    /* ignore quota */
  }
}

export function isIamGitStatusCacheFresh(cache: IamGitStatusCache | null): cache is IamGitStatusCache {
  if (!cache) return false;
  return Date.now() - cache.fetchedAt < IAM_GIT_STATUS_TTL_MS;
}

export function clearIamGitStatusCache(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(IAM_GIT_STATUS_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
