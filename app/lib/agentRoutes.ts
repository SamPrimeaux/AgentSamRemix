/** Agent IDE shell routes (ChatAssistant + workspace stay mounted). */
import { IAM_AGENT_SYNC_CONVERSATION_URL } from '../agentChatConstants';

export const AGENT_HOME_PATH = '/dashboard/agent';
/** Composer-only fresh thread — no persisted session id in URL until first send. */
export const AGENT_NEW_CHAT_PATH = '/dashboard/agent/new';
export const AGENT_EDITOR_PATH = '/dashboard/agent/editor';
export const AGENT_WORKSPACE_PATH = '/dashboard/agent/workspace';
export const AGENT_QUICKSTART_PATH = '/dashboard/agent/quickstart';
export const LEGACY_AGENT_EXAMPLES_PATH = '/dashboard/agent/examples';
export const EXAMPLES_PATH = '/dashboard/examples';

export const AGENT_TAB_QUERY = 'tab';
export type AgentHomeTab = 'recent' | 'workspaces';

/** Bare `/dashboard/agent` (no tab) is the atmospheric home — not a workspace tab. */
export function agentHomeWithTab(tab: AgentHomeTab): string {
  return `${AGENT_HOME_PATH}?${AGENT_TAB_QUERY}=${encodeURIComponent(tab)}`;
}

export function getAgentTabFromSearch(search: string): AgentHomeTab | null {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(AGENT_TAB_QUERY);
  const tab = String(raw || '').trim();
  if (tab === 'workspaces' || tab === 'recent') return tab;
  return null;
}

export function isAgentAtmosphericHome(pathname: string, search: string): boolean {
  return isAgentHomePath(pathname) && getAgentTabFromSearch(search) === null;
}

/** Claude-like center chat: bare home, /new, or active conversation — not workspace tab routes. */
export function isAgentCenterChatHome(pathname: string, search: string): boolean {
  if (getAgentTabFromSearch(search) !== null) return false;
  const p = normalizePath(pathname);
  if (p === AGENT_HOME_PATH || p === AGENT_NEW_CHAT_PATH) return true;
  return isAgentConversationPath(pathname);
}

export function isAgentEditorPath(pathname: string): boolean {
  return normalizePath(pathname) === AGENT_EDITOR_PATH;
}

export function isAgentWorkspacePath(pathname: string): boolean {
  return normalizePath(pathname) === AGENT_WORKSPACE_PATH;
}


export function agentPathTab(pathname: string): AgentHomeTab | null {
  if (isAgentWorkspacePath(pathname)) return 'recent';
  return null;
}

export function isAgentWorkspaceBrowserPath(pathname: string, search: string): boolean {
  if (isAgentWorkspacePath(pathname)) return true;
  return isAgentHomePath(pathname) && getAgentTabFromSearch(search) !== null;
}

export function resolveAgentWorkspaceTab(pathname: string, search: string): AgentHomeTab {
  const fromPath = agentPathTab(pathname);
  if (fromPath) return fromPath;
  const fromQuery = getAgentTabFromSearch(search);
  if (fromQuery) return fromQuery;
  if (isAgentWorkspacePath(pathname)) {
    const qTab = getAgentTabFromSearch(search);
    if (qTab === 'workspaces') return 'workspaces';
    return 'recent';
  }
  return 'recent';
}

export function normalizePath(pathname: string): string {
  const p = String(pathname || '').trim();
  if (!p) return AGENT_HOME_PATH;
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

/** True when the main editor should show Agent workspace/quickstart (not lazy dashboard Routes). */
export function isAgentShellPath(pathname: string): boolean {
  const p = normalizePath(pathname);
  if (p === LEGACY_AGENT_EXAMPLES_PATH) return false;
  return p === AGENT_HOME_PATH || p === AGENT_QUICKSTART_PATH || p.startsWith(`${AGENT_HOME_PATH}/`);
}

export function isAgentHomePath(pathname: string): boolean {
  return normalizePath(pathname) === AGENT_HOME_PATH;
}

export function isAgentNewChatPath(pathname: string): boolean {
  return normalizePath(pathname) === AGENT_NEW_CHAT_PATH;
}

/** `/dashboard/agent/:conversationId` — active thread deep link (set via replaceState after first send). */
export function isAgentConversationPath(pathname: string): boolean {
  const p = normalizePath(pathname);
  if (p === AGENT_HOME_PATH || p === AGENT_NEW_CHAT_PATH) return false;
  if (!p.startsWith(`${AGENT_HOME_PATH}/`)) return false;
  const tail = p.slice(`${AGENT_HOME_PATH}/`.length);
  if (!tail || tail.includes('/')) return false;
  const reserved = new Set(['editor', 'workspace', 'systems', 'quickstart', 'examples', 'new']);
  return !reserved.has(tail.toLowerCase());
}

export function agentConversationPath(conversationId: string): string {
  const id = String(conversationId || '').trim();
  return id ? `${AGENT_HOME_PATH}/${encodeURIComponent(id)}` : AGENT_NEW_CHAT_PATH;
}

/** Parse `/dashboard/agent/{uuid}` from pathname — SSOT for deep-link hydration. */
export function parseAgentConversationIdFromPath(pathname: string): string | null {
  if (!isAgentConversationPath(pathname)) return null;
  const p = normalizePath(pathname);
  const tail = p.slice(`${AGENT_HOME_PATH}/`.length);
  try {
    return decodeURIComponent(tail).trim() || null;
  } catch {
    return tail.trim() || null;
  }
}

/** Ask App (React Router) to sync URL — avoids replaceState / router desync. */
export function requestAgentConversationUrlSync(conversationId: string): void {
  if (typeof window === 'undefined') return;
  const id = String(conversationId || '').trim();
  if (!id) return;
  window.dispatchEvent(new CustomEvent(IAM_AGENT_SYNC_CONVERSATION_URL, { detail: { id } }));
}

/** @deprecated Use {@link requestAgentConversationUrlSync} — kept for callers not yet migrated. */
export function replaceAgentConversationUrl(conversationId: string): void {
  requestAgentConversationUrlSync(conversationId);
}

export function isAgentQuickstartPath(pathname: string): boolean {
  return normalizePath(pathname) === AGENT_QUICKSTART_PATH;
}

/**
 * Routes that keep dashboard content mounted beside the agent rail
 * (stay put on new chat / resume / first-send conversation URL sync).
 */
export function isContextPreservingAgentRailPath(pathname: string): boolean {
  const p = normalizePath(pathname);
  return (
    p === '/dashboard/artifacts' ||
    p.startsWith('/dashboard/artifacts/') ||
    p === '/dashboard/chats' ||
    p === '/dashboard/tasks' ||
    p === '/dashboard/collaborate' ||
    p === '/dashboard/mail' ||
    p === '/dashboard/projects' ||
    p.startsWith('/dashboard/projects/') ||
    p === '/dashboard/home' ||
    p === '/dashboard/overview' ||
    p === '/dashboard/library' ||
    p === '/dashboard/database' ||
    p.startsWith('/dashboard/database/') ||
    // Design Studio: keep 3D canvas + docked Agent Sam rail (do not navigate to /agent/{id}).
    p === '/dashboard/designstudio' ||
    p.startsWith('/dashboard/designstudio/') ||
    p === '/dashboard/workmode'
  );
}

/** @deprecated Prefer {@link isContextPreservingAgentRailPath} — kept for older call sites. */
export function isLibraryShellPath(pathname: string): boolean {
  return isContextPreservingAgentRailPath(pathname);
}
