/**
 * Terminal session lifecycle ops — close, purge, input history.
 */
import { shouldSkipTerminalHistoryInput } from '../../backend/agentsam/terminal/history-policy.js';

/**
 * @param {Record<string, unknown>} env
 * @param {string} sessionId
 * @param {string} userId
 */
export async function closeTerminalSessionRecord(env, sessionId, userId) {
  if (!env?.DB || !sessionId || !userId) return false;
  try {
    await env.DB.prepare(
      `UPDATE terminal_sessions
       SET status = 'closed', closed_at = unixepoch(), updated_at = unixepoch()
       WHERE id = ? AND user_id = ? AND status != 'closed'`,
    )
      .bind(String(sessionId).trim(), String(userId).trim())
      .run();
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Delete closed / stale terminal_sessions (on-connect + cron).
 * @param {Record<string, unknown>} env
 * @returns {Promise<number>}
 */
export async function purgeStaleTerminalSessions(env) {
  if (!env?.DB) return 0;
  try {
    const r = await env.DB.prepare(
      `DELETE FROM terminal_sessions
       WHERE status = 'closed'
         AND closed_at IS NOT NULL
         AND closed_at < unixepoch() - 86400`,
    ).run();
    return Number(r.meta?.changes ?? r.changes ?? 0) || 0;
  } catch (e) {
    console.warn('[purgeStaleTerminalSessions]', e?.message ?? e);
    return 0;
  }
}

/**
 * Recent terminal input lines for cross-session shell history (user-scoped).
 * Not injected into live PTYs (connect-time seeding removed — security + UX).
 * @param {Record<string, unknown>} env
 * @param {string} userId
 * @param {number} [limit]
 */
export async function getTerminalInputHistory(env, userId, limit = 200) {
  if (!env?.DB || !userId) return [];
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 200);
  const uid = String(userId).trim();
  try {
    const res = await env.DB.prepare(
      `SELECT th.content, th.recorded_at
       FROM terminal_history th
       INNER JOIN terminal_sessions ts ON ts.id = th.terminal_session_id
       WHERE ts.user_id = ? AND th.direction = 'input'
         AND th.content IS NOT NULL AND trim(th.content) != ''
       ORDER BY th.recorded_at DESC
       LIMIT ?`,
    )
      .bind(uid, lim)
      .all();
    const rows = res?.results || [];
    const seen = new Set();
    const commands = [];
    for (const row of rows) {
      const raw = String(row.content || '').replace(/[\r\n]+$/, '').trim();
      if (!raw || raw.startsWith('/') || seen.has(raw) || shouldSkipTerminalHistoryInput(raw)) continue;
      seen.add(raw);
      commands.push(raw);
    }
    return commands.reverse();
  } catch (e) {
    console.warn('[getTerminalInputHistory]', e?.message ?? e);
    return [];
  }
}
