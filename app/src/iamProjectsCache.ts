import type { OverviewProject } from '../client-api/projects';
import { IAM_PROJECTS_CACHE_LS_PREFIX } from './lib/sessionStorageKeys';

export type IamProjectsCachePayload = {
  workspaceId: string;
  fetchedAt: number;
  projects: OverviewProject[];
};

function storageKey(workspaceId: string) {
  return `${IAM_PROJECTS_CACHE_LS_PREFIX}:${workspaceId.trim()}`;
}

export function readIamProjectsCache(workspaceId: string | null | undefined): IamProjectsCachePayload | null {
  if (typeof window === 'undefined') return null;
  const ws = workspaceId?.trim();
  if (!ws) return null;
  try {
    const raw = localStorage.getItem(storageKey(ws));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IamProjectsCachePayload;
    if (!parsed || !Array.isArray(parsed.projects)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function invalidateIamProjectsCache(workspaceId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  const ws = workspaceId?.trim();
  if (!ws) return;
  try {
    localStorage.removeItem(storageKey(ws));
  } catch {
    /* ignore */
  }
}

export function removeProjectFromIamProjectsCache(
  workspaceId: string | null | undefined,
  projectId: string,
): void {
  if (typeof window === 'undefined') return;
  const ws = workspaceId?.trim();
  const id = projectId?.trim();
  if (!ws || !id) return;
  const cached = readIamProjectsCache(ws);
  if (!cached?.projects?.length) return;
  const next = cached.projects.filter((p) => String(p.id) !== id);
  if (next.length === cached.projects.length) return;
  writeIamProjectsCache(ws, next);
}

export function writeIamProjectsCache(workspaceId: string, projects: OverviewProject[]): void {
  if (typeof window === 'undefined') return;
  const ws = workspaceId.trim();
  if (!ws) return;
  try {
    const payload: IamProjectsCachePayload = {
      workspaceId: ws,
      fetchedAt: Date.now(),
      projects,
    };
    localStorage.setItem(storageKey(ws), JSON.stringify(payload));
  } catch {
    /* quota */
  }
}
