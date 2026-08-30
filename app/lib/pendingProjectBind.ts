/**
 * One-shot explicit project bind for the next Agent Sam chat POST.
 * Not sessionStorage — survives only until takePendingProjectBind() (or page reload).
 * Project-page composer does not use this; it stamps project_id on its own FormData.
 */

import {
  SESSION_PROJECT_ID_KEY,
  SESSION_PROJECT_NAME_KEY,
} from '../src/lib/sessionStorageKeys';

export type PendingProjectBind =
  | { kind: 'set'; projectId: string; source: 'project_surface' | 'agent_new_url' | 'context_hub' }
  | { kind: 'clear' };

let pending: PendingProjectBind | null = null;

function clearSessionProjectLabelKeys(): void {
  try {
    sessionStorage.removeItem(SESSION_PROJECT_ID_KEY);
    sessionStorage.removeItem(SESSION_PROJECT_NAME_KEY);
  } catch {
    /* ignore */
  }
}

export function setPendingProjectBind(next: PendingProjectBind | null): void {
  pending = next;
}

/** Read and clear — at most one chat send consumes the bind (and the UI label keys). */
export function takePendingProjectBind(): PendingProjectBind | null {
  const out = pending;
  pending = null;
  if (out) clearSessionProjectLabelKeys();
  return out;
}

export function peekPendingProjectBind(): PendingProjectBind | null {
  return pending;
}

export function clearPendingProjectBind(): void {
  pending = null;
  clearSessionProjectLabelKeys();
}
