const TERMINAL_WS_TAG = 'terminal';

export function closeTerminalSessionInD1(session) {
  const sid = session.cachedTerminalSessionId;
  if (!sid || !session.env?.DB) return;
  void session.env.DB.prepare(
    `UPDATE terminal_sessions SET status = 'closed', closed_at = unixepoch(), updated_at = unixepoch()
     WHERE id = ? AND status != 'closed'`,
  ).bind(sid).run().catch((e) => console.warn('[terminal_session close]', e?.message));
}

export async function insertTerminalHistoryRow(session, direction, content, opts = {}) {
  if (!session.env?.DB || !session.cachedTerminalSessionId) return;
  let tenantId = String(session.ptSessionTenantId || '').trim();
  if (!tenantId && session.ptSessionUserId) {
    tenantId = String((await session.resolvePtyTenantForSession(session.ptSessionUserId)) || '').trim();
  }
  if (!tenantId) {
    console.warn('[terminal_history] skip: tenant_id unresolved');
    return;
  }
  const truncated = String(content || '').slice(0, 4000);
  if (!session.historySequence || session.historySequence < 1) {
    try {
      const row = await session.env.DB.prepare(
        'SELECT COALESCE(MAX(sequence), 0) AS m FROM terminal_history WHERE terminal_session_id = ?',
      ).bind(session.cachedTerminalSessionId).first();
      const m = Number(row?.m ?? 0);
      session.historySequence = Number.isFinite(m) && m > 0 ? m : 0;
    } catch { session.historySequence = 0; }
  }
  session.historySequence += 1;
  const seq = session.historySequence;
  const id = 'th_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const triggeredBy = opts.triggeredBy || 'user';
  const agentSid = session.ctx?.id?.toString?.() || null;
  const exitCode = opts.exitCode != null ? opts.exitCode : null;
  const now = Math.floor(Date.now() / 1000);
  try {
    if (exitCode != null && direction === 'output') {
      await session.env.DB.prepare(
        `INSERT INTO terminal_history (id, terminal_session_id, tenant_id, sequence, direction, content, exit_code, triggered_by, agent_session_id, recorded_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(id, session.cachedTerminalSessionId, tenantId, seq, direction, truncated, exitCode, triggeredBy, agentSid, now).run();
    } else {
      await session.env.DB.prepare(
        `INSERT INTO terminal_history (id, terminal_session_id, tenant_id, sequence, direction, content, triggered_by, agent_session_id, recorded_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).bind(id, session.cachedTerminalSessionId, tenantId, seq, direction, truncated, triggeredBy, agentSid, now).run();
    }
  } catch (e) { console.warn('[terminal_history]', e?.message); }
}

export async function recordExecTerminalHistory(session, command, outputText, exitCode) {
  const cmd = String(command || '').slice(0, 4000);
  const out = String(outputText || '').slice(0, 4000);
  const ec = exitCode != null && Number.isFinite(Number(exitCode)) ? Number(exitCode) : null;
  await insertTerminalHistoryRow(session, 'input', cmd, { triggeredBy: 'agent' });
  await insertTerminalHistoryRow(session, 'output', out, { triggeredBy: 'agent', exitCode: ec });
}

export function recordPtyOutputChunk(session, text) {
  if (!text || !session.env?.DB || !session.cachedTerminalSessionId) return;
  session._ptyOutBuf = (session._ptyOutBuf || '') + text;
  if (session._ptyOutFlushTimer) clearTimeout(session._ptyOutFlushTimer);
  session._ptyOutFlushTimer = setTimeout(() => flushPtyOutputBuffer(session), 900);
  if (session._ptyOutBuf.length >= 4000) flushPtyOutputBuffer(session);
}

export function flushPtyOutputBuffer(session) {
  if (session._ptyOutFlushTimer) {
    clearTimeout(session._ptyOutFlushTimer);
    session._ptyOutFlushTimer = null;
  }
  const buf = (session._ptyOutBuf || '').trim();
  session._ptyOutBuf = '';
  if (!buf) return;
  void insertTerminalHistoryRow(session, 'output', buf.slice(0, 4000), { triggeredBy: 'user' });
}

export function maybeFinalizeTerminalSession(session, reason) {
  if (session.ctx.getWebSockets(TERMINAL_WS_TAG).length > 0) return;
  try { flushPtyOutputBuffer(session); } catch {}
  void insertTerminalHistoryRow(session, 'system', reason, { triggeredBy: 'system' });
  closeTerminalSessionInD1(session);
}
