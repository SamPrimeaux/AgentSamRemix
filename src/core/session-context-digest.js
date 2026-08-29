/**
 * Session / conversation context digest writer — embed-first, no LLM summarize.
 * Wire from chat archive/delete or explicit close — not cicd-event / KV.
 */

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(input ?? '')));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} payload
 * @param {string} payload.workspace_id
 * @param {string} payload.session_id conversation_id
 * @param {string} [payload.user_id]
 * @param {string} [payload.tenant_id]
 * @param {string} [payload.summary]
 * @param {number} [payload.duration_ms]
 */
export async function writeSessionContextDigest(env, payload) {
  if (!env?.DB) return;
  const workspaceId =
    payload?.workspace_id != null && String(payload.workspace_id).trim()
      ? String(payload.workspace_id).trim()
      : '';
  const sessionId =
    payload?.session_id != null && String(payload.session_id).trim()
      ? String(payload.session_id).trim()
      : '';
  if (!workspaceId || !sessionId) return;

  const userId =
    payload?.user_id != null && String(payload.user_id).trim()
      ? String(payload.user_id).trim()
      : null;

  const msgLimit = 32;
  let toolRows = [];
  let messageRows = [];

  try {
    const tools = await env.DB.prepare(
      `SELECT tool_key, status, output_summary, duration_ms
       FROM agentsam_tool_call_log
       WHERE conversation_id = ?
       ORDER BY created_at_unix DESC
       LIMIT 24`,
    )
      .bind(sessionId)
      .all();
    toolRows = tools.results || [];
  } catch {
    toolRows = [];
  }

  try {
    const msgs = await env.DB.prepare(
      `SELECT role, content, created_at
       FROM agent_messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
      .bind(sessionId, msgLimit)
      .all();
    messageRows = (msgs.results || []).reverse();
  } catch {
    messageRows = [];
  }

  const toolLines = toolRows.map((r) => {
    const name = String(r.tool_key || 'tool');
    const st = String(r.status || 'unknown');
    const summary =
      r.output_summary != null && String(r.output_summary).trim()
        ? ` — ${String(r.output_summary).trim().slice(0, 120)}`
        : '';
    return `- ${name} (${st})${summary}`;
  });

  const msgLines = messageRows.map((m) => {
    const role = String(m.role || 'unknown');
    const text = String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 280);
    return `- [${role}] ${text}`;
  });

  const sourceMaterial = [
    `session_id: ${sessionId}`,
    `workspace_id: ${workspaceId}`,
    payload?.summary != null ? `session_summary: ${String(payload.summary).slice(0, 500)}` : '',
    payload?.duration_ms != null ? `duration_ms: ${payload.duration_ms}` : '',
    'tool_calls:',
    toolLines.length ? toolLines.join('\n') : '(none recorded)',
    'conversation:',
    msgLines.length ? msgLines.join('\n') : '(no messages)',
  ]
    .filter(Boolean)
    .join('\n');

  const sourceHash = await sha256Hex(sourceMaterial);

  const digestText = [
    '# Session digest (deterministic)',
    payload?.summary ? `- ${String(payload.summary).slice(0, 400)}` : '',
    toolLines.length ? `## Tools\n${toolLines.slice(0, 12).join('\n')}` : '',
    msgLines.length ? `## Recent messages\n${msgLines.slice(-8).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim()
    .slice(0, 12_000);
  if (!digestText) return;

  const rawBytes = new TextEncoder().encode(sourceMaterial).length;
  const reducedBytes = new TextEncoder().encode(digestText).length;
  const tokenEstimate = Math.ceil(reducedBytes / 4);
  try {
    const { upsertContextDigest } = await import(
      '../../backend/services/bootstrap/context-digest.js'
    );
    const { embedCompactionDigestSummary } = await import(
      '../../backend/services/bootstrap/compaction-digest-embed.js'
    );
    const digestRow = await upsertContextDigest(env, {
      workspaceId,
      digestType: 'session',
      digestText,
      sourceMaterial,
      sourceHash,
      sessionId,
      generationModel: null,
      namespace: 'agent_session',
      rawSizeBytes: rawBytes,
      reducedSizeBytes: reducedBytes,
      tokenCount: tokenEstimate,
      sourceUpdatedAtUnix: Math.floor(Date.now() / 1000),
    });
    const embedMeta = await embedCompactionDigestSummary(env, {
      workspaceId,
      conversationId: sessionId,
      summaryText: sourceMaterial,
      digestId: digestRow?.id || null,
      sourceHash,
      userId,
      tenantId:
        payload?.tenant_id != null && String(payload.tenant_id).trim()
          ? String(payload.tenant_id).trim()
          : null,
    }).catch((e) => {
      console.warn('[context_digest] embed', e?.message ?? e);
      return null;
    });
    if (digestRow?.id && embedMeta?.embedding_model && env?.DB) {
      const { pragmaTableInfo } =
        await import('../../backend/services/retention.js');
      const cols = await pragmaTableInfo(env.DB, 'agentsam_context_digest');
      if (cols.has('embedding_model')) {
        await env.DB.prepare(
          `UPDATE agentsam_context_digest
              SET embedding_model = ?,
                  embedding_dimensions = ?,
                  updated_at_unix = unixepoch()
            WHERE id = ?`,
        )
          .bind(
            String(embedMeta.embedding_model),
            Number(embedMeta.embedding_dimensions) || 1536,
            digestRow.id,
          )
          .run()
          .catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[context_digest] upsert', e?.message ?? e);
  }
}
