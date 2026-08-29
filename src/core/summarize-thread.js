/**
 * Session summarize helpers — Wave 2 Worker bridge (R2 → agentsam_memory).
 * Edge summarize-thread remains 410; callers use agentsam-session-summarize.js.
 */
import { isHyperdriveUsable, runHyperdriveQuery } from '../../backend/services/database/hyperdrive.js';
import {
  maybeSummarizeSessionAfterCompaction,
  summarizeSessionFromR2,
  MIN_MESSAGES_FOR_SESSION_SUMMARY,
  DEFAULT_MAX_MESSAGES,
} from './agentsam-session-summarize.js';

/**
 * @param {any} env
 * @param {{ session_id: string, tenant_id?: string|null, workspace_id?: string|null, max_messages?: number }} payload
 * @deprecated Edge invoke retired — forwards to Worker-side summarizeSessionFromR2
 */
export async function invokeSummarizeThreadEdgeFunction(env, payload) {
  const sessionId = String(payload?.session_id || '').trim();
  const workspaceId = String(payload?.workspace_id || '').trim();
  if (!sessionId || !workspaceId) {
    return { ok: false, skipped: true, reason: 'missing_session_or_workspace' };
  }
  const result = await summarizeSessionFromR2(env, {
    sessionId,
    workspaceId,
    tenantId: payload.tenant_id,
    maxMessages: payload.max_messages,
    force: false,
  });
  return { ok: Boolean(result.ok || result.skipped), status: 200, result };
}

/**
 * @param {any} env
 * @param {string} sessionId
 */
export async function sessionHasSummaryRow(env, sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !isHyperdriveUsable(env)) return false;
  const key = `conversation_summary:${sid}`;
  const out = await runHyperdriveQuery(
    env,
    `SELECT 1 AS ok FROM agentsam.agentsam_memory_oai3large_1536
      WHERE memory_key = $1 LIMIT 1`,
    [key],
  );
  if (out.ok && (out.rows || []).length) return true;
  // Legacy public.session_summaries (may already be gone)
  const legacy = await runHyperdriveQuery(
    env,
    `SELECT 1 AS ok FROM public.session_summaries WHERE session_id = $1 LIMIT 1`,
    [sid],
  ).catch(() => ({ ok: false, rows: [] }));
  return Boolean(legacy.ok && (legacy.rows || []).length);
}

/**
 * After chat compaction — Worker summarize (never throws).
 * @param {any} env
 * @param {{ sessionId: string, messageCount: number, tenantId?: string|null, workspaceId?: string|null, userId?: string|null, ctx?: any }} opts
 */
export async function maybeSummarizeThreadAfterCompaction(env, opts) {
  return maybeSummarizeSessionAfterCompaction(env, {
    sessionId: opts.sessionId,
    messageCount: opts.messageCount,
    tenantId: opts.tenantId,
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    ctx: opts.ctx,
  });
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} sessionId
 */
export async function d1SessionContext(db, sessionId) {
  try {
    const row = await db
      .prepare(
        `SELECT conversation_id, user_id, workspace_id, tenant_id
           FROM agentsam_chat_sessions WHERE conversation_id = ? LIMIT 1`,
      )
      .bind(sessionId)
      .first();
    if (!row) return null;
    return {
      session_id: String(row.conversation_id),
      tenant_id: row.tenant_id != null ? String(row.tenant_id) : null,
      workspace_id: row.workspace_id != null ? String(row.workspace_id) : null,
      user_id: row.user_id != null ? String(row.user_id) : null,
      message_count: 0,
    };
  } catch {
    return null;
  }
}

/**
 * Chat sessions needing summary (D1 meta + missing memory_key in PG).
 * @param {any} env
 * @param {{ limit?: number }} [opts]
 */
export async function listD1SessionsNeedingSummary(env, opts = {}) {
  const db = env?.DB;
  if (!db) return [];
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 100));
  try {
    const { results } = await db
      .prepare(
        `SELECT conversation_id AS session_id, tenant_id, workspace_id, user_id,
                COALESCE(digest_count, 0) AS digest_count
           FROM agentsam_chat_sessions
          WHERE r2_messages_key IS NOT NULL
          ORDER BY updated_at DESC
          LIMIT ?`,
      )
      .bind(limit * 3)
      .all();
    const rows = results || [];
    const need = [];
    for (const r of rows) {
      const sessionId = String(r.session_id || '').trim();
      if (!sessionId) continue;
      if (await sessionHasSummaryRow(env, sessionId)) continue;
      need.push({
        session_id: sessionId,
        tenant_id: r.tenant_id != null ? String(r.tenant_id) : null,
        workspace_id: r.workspace_id != null ? String(r.workspace_id) : null,
        user_id: r.user_id != null ? String(r.user_id) : null,
        message_count: Math.max(MIN_MESSAGES_FOR_SESSION_SUMMARY + 1, Number(r.digest_count) || 0),
      });
      if (need.length >= limit) break;
    }
    return need;
  } catch (e) {
    console.warn('[summarize-thread] listD1SessionsNeedingSummary', e?.message ?? e);
    return [];
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {any} env
 * @param {Array<{ session_id: string, tenant_id?: string|null, workspace_id?: string|null, user_id?: string|null, message_count?: number }>} sessions
 * @param {{ batchSize?: number, delayMs?: number }} [opts]
 */
export async function queueSummarizeThreadBatch(env, sessions, opts = {}) {
  const batchSize = Math.min(10, Math.max(1, Number(opts.batchSize) || 5));
  const delayMs = Math.max(0, Number(opts.delayMs) || 500);
  const results = [];
  for (let i = 0; i < sessions.length; i += batchSize) {
    const chunk = sessions.slice(i, i + batchSize);
    for (const s of chunk) {
      if (!s.workspace_id) {
        results.push({ session_id: s.session_id, invoked: false, reason: 'missing_workspace' });
        continue;
      }
      const out = await maybeSummarizeSessionAfterCompaction(env, {
        sessionId: s.session_id,
        messageCount: Number(s.message_count) || MIN_MESSAGES_FOR_SESSION_SUMMARY + 1,
        tenantId: s.tenant_id,
        workspaceId: s.workspace_id,
        userId: s.user_id,
      });
      results.push({ session_id: s.session_id, ...out });
    }
    if (i + batchSize < sessions.length && delayMs > 0) await sleep(delayMs);
  }
  return results;
}

/**
 * On-demand /summarize — Worker bridge (never throws).
 * @param {any} env
 * @param {{
 *   sessionId: string,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   messageCount?: number,
 *   force?: boolean,
 *   max_messages?: number,
 * }} opts
 */
export async function summarizeThreadOnDemand(env, opts) {
  const sessionId = String(opts?.sessionId || '').trim();
  const workspaceId = String(opts?.workspaceId || '').trim();
  const messageCount = Number(opts?.messageCount) || 0;
  const force = opts?.force === true;

  if (!sessionId) return { invoked: false, reason: 'missing_session_id' };
  if (!workspaceId) return { invoked: false, reason: 'missing_workspace_id' };
  if (!force && messageCount > 0 && messageCount < MIN_MESSAGES_FOR_SESSION_SUMMARY) {
    return { invoked: false, reason: 'below_message_threshold' };
  }

  try {
    if (!force && (await sessionHasSummaryRow(env, sessionId))) {
      return { invoked: false, reason: 'summary_exists' };
    }
    const result = await summarizeSessionFromR2(env, {
      sessionId,
      workspaceId,
      tenantId: opts.tenantId,
      userId: opts.userId,
      maxMessages: opts.max_messages,
      force,
    });
    return { invoked: true, ok: Boolean(result.ok || result.skipped), result };
  } catch (e) {
    console.warn('[summarize-thread] on_demand', sessionId, e?.message ?? e);
    return { invoked: false, reason: 'error', error: String(e?.message || e) };
  }
}

export { MIN_MESSAGES_FOR_SESSION_SUMMARY, DEFAULT_MAX_MESSAGES };
