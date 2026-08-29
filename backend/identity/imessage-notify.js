/**
 * User notification bridge for the local Mac Messages relay.
 * The Worker queues a row; the Mac daemon owns delivery.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function newToken() {
  return [...crypto.getRandomValues(new Uint8Array(4))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function resolveHandle(env, tenantId, explicitHandle) {
  const explicit = trim(explicitHandle);
  if (explicit) return explicit;
  if (env?.DB && tenantId) {
    const row = await env.DB.prepare(
      `SELECT self_handle FROM agentsam_imessage_poll_checkpoint
       WHERE tenant_id = ? AND self_handle IS NOT NULL AND trim(self_handle) != ''
       ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(tenantId)
      .first()
      .catch(() => null);
    if (row?.self_handle) return trim(row.self_handle);
  }
  return trim(env?.IMESSAGE_SELF_HANDLE);
}

export async function enqueueImessageNotification(env, opts = {}) {
  const tenantId = trim(opts.tenantId);
  const userId = trim(opts.userId);
  const text = trim(opts.text);
  if (!env?.DB || !tenantId || !userId || !text) {
    return { ok: false, reason: 'imessage_context_required' };
  }

  const toHandle = await resolveHandle(env, tenantId, opts.to);
  if (!toHandle) return { ok: false, reason: 'imessage_handle_required' };

  const now = Math.floor(Date.now() / 1000);
  const id = `imap_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const token = newToken();
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_imessage_approvals (
         id, tenant_id, workspace_id, user_id, token, prompt_text,
         to_handle, kind, status, expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'send', 'pending', ?, ?)`,
    )
      .bind(
        id,
        tenantId,
        trim(opts.workspaceId) || null,
        userId,
        token,
        text.slice(0, 5000),
        toHandle,
        now + 3600,
        now,
      )
      .run();
    return { ok: true, queued: true, id, token };
  } catch (error) {
    return { ok: false, reason: 'imessage_queue_failed', error: error?.message || String(error) };
  }
}
