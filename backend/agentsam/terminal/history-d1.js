import { getAuthUser, fetchAuthUserTenantId } from '../../../src/core/auth.js';
import { shouldSkipTerminalHistoryInput, looksLikeSecretTerminalLine } from './history-policy.js';

export async function writeTerminalHistory(env, request, sessionId, commandText, outputText, exitCode) {
  if (!env.DB) return;
  const terminalSessionId = await resolveTerminalSessionIdForHistory(env, request);
  const authUser = await getAuthUser(request, env).catch(() => null);
  let tenantId = authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== '' ? String(authUser.tenant_id).trim() : null;
  if (!tenantId && authUser?.id) {
    tenantId = await fetchAuthUserTenantId(env, authUser.id).catch(() => null);
  }
  if (!terminalSessionId || !tenantId) {
    console.warn('[terminal_history] skip: terminal_session_missing', {
      terminalSessionId: terminalSessionId || null,
      tenantId: tenantId || null,
      agentSessionId: sessionId || null,
    });
    return;
  }

  // Validate FK target exists (terminal_sessions.id). If it doesn't, avoid FK violations.
  try {
    const exists = await env.DB.prepare('SELECT 1 AS ok FROM terminal_sessions WHERE id = ? LIMIT 1')
      .bind(terminalSessionId)
      .first();
    if (!exists?.ok) {
      console.warn('[terminal_history] skip: parent_missing', { terminalSessionId, tenantId, agentSessionId: sessionId || null });
      return;
    }
  } catch (e) {
    console.warn('[terminal_history] skip: terminal_session_check_failed', { terminalSessionId, error: e?.message ?? String(e) });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  let seq = 0;
  try {
    const seqRow = await env.DB.prepare(
      'SELECT COALESCE(MAX(sequence), 0) AS m FROM terminal_history WHERE terminal_session_id = ?'
    ).bind(terminalSessionId).first();
    seq = Number(seqRow?.m ?? 0);
    if (!Number.isFinite(seq)) seq = 0;
  } catch (_) {
    seq = 0;
  }
  const input = String(commandText || '').slice(0, 5000);
  if (input && !shouldSkipTerminalHistoryInput(input)) {
    seq += 1;
    await env.DB.prepare(
      `INSERT INTO terminal_history (id, terminal_session_id, tenant_id, sequence, direction, content, triggered_by, agent_session_id, recorded_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        'th_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16),
        terminalSessionId,
        tenantId,
        seq,
        'input',
        input,
        'agent',
        sessionId,
        now,
      )
      .run();
  }
  const out = String(outputText || '').slice(0, 10000);
  if (out && !looksLikeSecretTerminalLine(out)) {
    seq += 1;
    await env.DB.prepare(
      `INSERT INTO terminal_history (id, terminal_session_id, tenant_id, sequence, direction, content, exit_code, triggered_by, agent_session_id, recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        'th_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16),
        terminalSessionId,
        tenantId,
        seq,
        'output',
        out,
        exitCode ?? null,
        'agent',
        sessionId,
        now,
      )
      .run();
  }
}

export async function resolveTerminalSessionIdForHistory(env, request) {
  try {
    const authUser = await getAuthUser(request, env);
    if (authUser?.id) {
      const tsRow = await env.DB
        .prepare(`SELECT id FROM terminal_sessions WHERE user_id = ? AND status = 'active' LIMIT 1`)
        .bind(authUser.id)
        .first();
      if (tsRow?.id) return tsRow.id;
    }
  } catch (_) {}
  return null;
}
