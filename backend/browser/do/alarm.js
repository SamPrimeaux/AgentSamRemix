/**
 * Alarm handler for AgentBrowserLiveV1 — refresh Live View URL before expiry.
 */
import { handleLiveUrlRefresh } from './ensure.js';
import { getSessionRow, scheduleRefreshAlarm } from './session.js';

/**
 * @param {any} session
 */
export async function handleBrowserSessionAlarm(session) {
  const row = getSessionRow(session);
  if (!row || row.status === 'closed') return;
  if (row.status !== 'active' && row.status !== 'needs_human') return;

  const expiresAt = Number(row.devtools_url_expires_at) || 0;
  if (expiresAt && Date.now() < expiresAt - 30_000) {
    await scheduleRefreshAlarm(session, expiresAt);
    return;
  }

  await handleLiveUrlRefresh(session);
}
