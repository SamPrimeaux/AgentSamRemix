/**
 * Append-only auth / OAuth audit trail (D1 auth_event_log).
 */

async function sha256Short(text) {
  const t = String(text || '');
  if (!t) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 48);
}

/**
 * @param {*} env
 * @param {object} opts
 * @param {string} opts.eventType
 * @param {string} [opts.status]
 * @param {string} [opts.tenantId]
 * @param {string} [opts.userId]
 * @param {string} [opts.provider]
 * @param {Record<string, unknown>} [opts.metadata]
 * @param {Request} [opts.request]
 */
export async function logAuthEvent(env, opts) {
  if (!env?.DB) return;
  const eventType = String(opts.eventType || '').trim();
  if (!eventType) return;
  const id = `ael_${crypto.randomUUID().replace(/-/g, '')}`;
  let ipHash = null;
  let uaHash = null;
  if (opts.request) {
    ipHash = await sha256Short(opts.request.headers.get('cf-connecting-ip') || '');
    uaHash = await sha256Short(opts.request.headers.get('user-agent') || '');
  }
  try {
    await env.DB.prepare(
      `INSERT INTO auth_event_log (id, tenant_id, user_id, event_type, status, provider, metadata_json, ip_hash, user_agent_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(
        id,
        opts.tenantId ?? null,
        opts.userId ?? null,
        eventType,
        opts.status || 'ok',
        opts.provider ?? null,
        JSON.stringify(opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {}),
        ipHash,
        uaHash,
      )
      .run();
  } catch (e) {
    console.warn('[logAuthEvent]', eventType, e?.message ?? e);
  }
}
