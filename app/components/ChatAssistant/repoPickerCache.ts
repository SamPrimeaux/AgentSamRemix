import { CHAT_GH_REPOS_CACHE_KEY } from '../../src/lib/sessionStorageKeys';

const CACHE_TTL_MS = 5 * 60 * 1000;

export type GhRepoRow = {
  id: string | number;
  full_name: string;
  name: string;
  default_branch?: string;
};

type CachePayload = { at: number; repos: GhRepoRow[] };

export function readGhReposCache(): GhRepoRow[] | null {
  try {
    const raw = sessionStorage.getItem(CHAT_GH_REPOS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload;
    if (!parsed?.at || !Array.isArray(parsed.repos)) return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.repos;
  } catch {
    return null;
  }
}

export function writeGhReposCache(repos: GhRepoRow[]): void {
  try {
    const payload: CachePayload = { at: Date.now(), repos };
    sessionStorage.setItem(CHAT_GH_REPOS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode */
  }
}
