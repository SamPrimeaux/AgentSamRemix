/**
 * Context digest writer for agentsam_escalation transitions (handoff/spawn).
 * Single funnel — escalation status → digest row (not scattered hook/handoff writers).
 */
import { upsertContextDigest } from '../services/bootstrap/context-digest.js';
import { writeAgentsamErrorLog } from '../telemetry/error-log.js';

const TOOL_LOG_LIMIT = 24;
const ERROR_LOG_LIMIT = 12;

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {unknown} env
 * @param {{
 *   agentRunId?: string|null,
 *   conversationId?: string|null,
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 * }} scope
 */
export async function buildEscalationDigestSourceMaterial(env, scope = {}) {
  if (!env?.DB) return { sourceMaterial: '', digestText: '' };

  const agentRunId = trim(scope.agentRunId);
  const conversationId = trim(scope.conversationId);
  const workspaceId = trim(scope.workspaceId);
  const tenantId = trim(scope.tenantId);

  const toolLines = [];
  const errorLines = [];

  if (agentRunId || conversationId) {
    try {
      const binds = [];
      let where = '1=0';
      if (agentRunId) {
        where = 'agent_run_id = ?';
        binds.push(agentRunId);
      } else if (conversationId) {
        where = 'conversation_id = ?';
        binds.push(conversationId);
      }
      const { results } = await env.DB.prepare(
        `SELECT tool_key, status, duration_ms, error_message, output_summary, created_at_unix
           FROM agentsam_tool_call_log
          WHERE ${where}
          ORDER BY created_at_unix DESC
          LIMIT ?`,
      )
        .bind(...binds, TOOL_LOG_LIMIT)
        .all();
      for (const row of results || []) {
        const key = trim(row.tool_key) || 'tool';
        const st = trim(row.status) || '?';
        const err = trim(row.error_message);
        const summary = trim(row.output_summary);
        toolLines.push(
          `- ${key} [${st}]${err ? ` err=${err.slice(0, 120)}` : ''}${summary ? ` → ${summary.slice(0, 160)}` : ''}`,
        );
      }
    } catch (e) {
      console.warn('[escalation-context-digest] tool_call_log', e?.message ?? e);
    }
  }

  if (workspaceId && tenantId && (conversationId || agentRunId)) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT error_type, error_code, error_message, source, created_at
           FROM agentsam_error_log
          WHERE workspace_id = ?
            AND tenant_id = ?
            AND (session_id = ? OR source_id = ? OR source_id = ?)
          ORDER BY created_at DESC
          LIMIT ?`,
      )
        .bind(
          workspaceId,
          tenantId,
          conversationId || '',
          conversationId || '',
          agentRunId || '',
          ERROR_LOG_LIMIT,
        )
        .all();
      for (const row of results || []) {
        const typ = trim(row.error_type) || 'error';
        const code = trim(row.error_code);
        const msg = trim(row.error_message);
        errorLines.push(`- [${typ}${code ? `/${code}` : ''}] ${msg.slice(0, 200)}`);
      }
    } catch (e) {
      console.warn('[escalation-context-digest] error_log', e?.message ?? e);
    }
  }

  const sections = [];
  if (toolLines.length) {
    sections.push('## Recent tool calls', toolLines.join('\n'));
  }
  if (errorLines.length) {
    sections.push('## Recent errors', errorLines.join('\n'));
  }
  const digestText = sections.join('\n\n').trim().slice(0, 6000);
  const sourceMaterial = [
    workspaceId ? `workspace_id: ${workspaceId}` : '',
    tenantId ? `tenant_id: ${tenantId}` : '',
    conversationId ? `conversation_id: ${conversationId}` : '',
    agentRunId ? `agent_run_id: ${agentRunId}` : '',
    digestText,
  ]
    .filter(Boolean)
    .join('\n');

  return { sourceMaterial, digestText };
}

/**
 * @param {unknown} env
 * @param {string} escalationId
 * @param {{ status?: string }} [opts]
 */
export async function writeEscalationContextDigest(env, escalationId, opts = {}) {
  const escId = trim(escalationId);
  if (!env?.DB || !escId) return null;

  let row;
  try {
    row = await env.DB.prepare(
      `SELECT id, tenant_id, workspace_id, conversation_id, agent_run_id,
              kind, reason, from_route_key, to_route_key, from_model_key, to_model_key,
              spawn_job_id, spawn_session_id, status
         FROM agentsam_escalation
        WHERE id = ?
        LIMIT 1`,
    )
      .bind(escId)
      .first();
  } catch (e) {
    console.warn('[escalation-context-digest] load', e?.message ?? e);
    return null;
  }
  if (!row?.id) return null;

  const kind = trim(row.kind);
  if (kind !== 'handoff' && kind !== 'spawn') return null;

  const status = trim(opts.status || row.status);
  if (status !== 'accepted' && status !== 'running') return null;

  const workspaceId = trim(row.workspace_id);
  const tenantId = trim(row.tenant_id);
  if (!workspaceId || !tenantId) return null;

  const { sourceMaterial, digestText: signalText } = await buildEscalationDigestSourceMaterial(env, {
    agentRunId: row.agent_run_id,
    conversationId: row.conversation_id,
    workspaceId,
    tenantId,
  });

  const header = [
    `# Escalation ${kind}`,
    row.reason ? `reason: ${row.reason}` : '',
    row.from_route_key || row.to_route_key
      ? `route: ${row.from_route_key || '?'} → ${row.to_route_key || '?'}`
      : '',
    row.from_model_key || row.to_model_key
      ? `model: ${row.from_model_key || '?'} → ${row.to_model_key || '?'}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const digestText = [header, signalText].filter(Boolean).join('\n\n').trim().slice(0, 6000);
  if (!digestText) return null;

  const digestType = kind === 'handoff' ? 'handoff' : 'session';
  try {
    const written = await upsertContextDigest(env, {
      workspaceId,
      digestType,
      digestText,
      sourceMaterial: sourceMaterial || digestText,
      sessionId: row.conversation_id,
      parentRunId: row.agent_run_id,
      escalationId: escId,
      namespace: 'agentsam_escalation',
      generationModel: row.to_model_key || row.from_model_key || null,
    });
    return written?.id ?? null;
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.warn('[escalation-context-digest] upsert', msg);
    await writeAgentsamErrorLog(env, {
      workspaceId,
      tenantId,
      sessionId: row.conversation_id,
      errorType: 'context_digest_upsert_failed',
      errorCode: 'escalation_digest_write',
      errorMessage: msg.slice(0, 2000),
      source: 'escalation_context_digest',
      sourceId: escId,
      contextJson: JSON.stringify({ kind, status, agent_run_id: row.agent_run_id }),
    });
    return null;
  }
}
