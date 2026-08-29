/**
 * Bind / unbind rules for Agent Sam conversation ids.
 * The shell tab can show a greeting while ChatAssistant still POSTs the previous thread.
 *
 * Path checks stay local so this module has no import graph (unit tests + Vite).
 * Keep in sync with AGENT_HOME_PATH / AGENT_NEW_CHAT_PATH in agentRoutes.ts.
 */
const AGENT_HOME_PATH = '/dashboard/agent';
const AGENT_NEW_CHAT_PATH = '/dashboard/agent/new';

function normalizePath(pathname: string): string {
  const raw = String(pathname || '').split('?')[0].trim();
  if (!raw) return '/';
  return raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
}

/** Host went from a bound thread to unbound — ChatAssistant must drop the send id. */
export function hostSyncShouldClearConversationId(
  prevHostId: string | null | undefined,
  nextHostId: string,
): boolean {
  const prev = String(prevHostId || '').trim();
  const next = String(nextHostId || '').trim();
  return Boolean(prev) && !next;
}

function isAtmosphericOrNewChat(pathname: string, search = ''): boolean {
  const p = normalizePath(pathname);
  if (p === AGENT_NEW_CHAT_PATH) return true;
  if (p !== AGENT_HOME_PATH) return false;
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('tab');
  return !String(q || '').trim();
}

/** URL says this is a fresh thread — never re-read the previously active conversation. */
export function isUnboundAgentChatPath(pathname: string, search = ''): boolean {
  return isAtmosphericOrNewChat(pathname, search);
}

/**
 * Host sync must not copy a conversation id onto ChatAssistant while the URL is unbound.
 * That re-read after reset is how New Agent keeps POSTing the prior thread.
 */
export function hostSyncShouldBindHostId(
  pathname: string,
  search: string,
  nextHostId: string,
): boolean {
  if (isUnboundAgentChatPath(pathname, search)) return false;
  return Boolean(String(nextHostId || '').trim());
}

/**
 * On an unbound URL, drop a send id that matches the stale host (re-attach).
 * Keep a different id — first-send mint before `/agent/{uuid}` URL sync.
 */
export function sendIdAfterUnboundHostSync(nextHostId: string, currentSendId: string): string {
  const host = String(nextHostId || '').trim();
  const cur = String(currentSendId || '').trim();
  if (!host) return cur;
  if (!cur || cur === host) return '';
  return cur;
}

/** Send path: ignore a leftover live id while the URL is still /new or atmospheric home. */
export function liveConversationIdForSend(
  pathname: string,
  search: string,
  liveId: string,
): string {
  if (isUnboundAgentChatPath(pathname, search)) return '';
  return String(liveId || '').trim();
}

/**
 * Do not hydrate a send id from localStorage on atmospheric /new —
 * that is how a poisoned thread survives a fresh greeting.
 */
export function initialAgentConversationIdFromStorage(
  lsValue: string | null | undefined,
  pathname: string,
  search = '',
): string {
  if (isAtmosphericOrNewChat(pathname, search)) return '';
  return String(lsValue || '').trim();
}
