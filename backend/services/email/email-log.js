/**
 * email_logs helpers — external_message_id + provider (replaces ambiguous resend_id).
 */

export function looksLikeGmailMessageId(id) {
  const s = String(id || '').trim();
  return /^[0-9a-f]{10,}$/i.test(s);
}

/** @param {Record<string, unknown> | null | undefined} row */
export function emailLogExternalId(row) {
  const ext = row?.external_message_id != null ? String(row.external_message_id).trim() : '';
  if (ext) return ext;
  const legacy = row?.resend_id != null ? String(row.resend_id).trim() : '';
  return legacy || '';
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 * @param {string} [fallbackId]
 */
export function emailLogProvider(row, fallbackId = '') {
  const explicit = row?.provider != null ? String(row.provider).trim().toLowerCase() : '';
  if (explicit) return explicit;
  const id = fallbackId || emailLogExternalId(row);
  if (!id) return null;
  return looksLikeGmailMessageId(id) ? 'gmail' : 'resend';
}

/**
 * @param {Record<string, unknown>} env
 * @param {{
 *   to: string,
 *   from: string,
 *   subject: string,
 *   status?: string,
 *   externalMessageId?: string | null,
 *   provider?: string | null,
 *   userId?: string | null,
 *   tenantId?: string | null,
 *   textContent?: string | null,
 *   id?: string | null,
 * }} opts
 */
export async function insertEmailLog(env, opts) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };
  const externalMessageId =
    opts.externalMessageId != null ? String(opts.externalMessageId).trim() : '';
  const provider =
    (opts.provider != null ? String(opts.provider).trim().toLowerCase() : '') ||
    emailLogProvider(null, externalMessageId) ||
    null;
  const id = opts.id != null && String(opts.id).trim() ? String(opts.id).trim() : crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO email_logs (
         id, to_email, from_email, subject, status,
         external_message_id, provider, resend_id,
         text_content, user_id, tenant_id, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        id,
        opts.to,
        opts.from,
        opts.subject,
        opts.status || 'sent',
        externalMessageId || null,
        provider,
        externalMessageId || null,
        opts.textContent != null ? String(opts.textContent) : null,
        opts.userId || null,
        opts.tenantId || null,
      )
      .run();
    return { ok: true, id, externalMessageId, provider };
  } catch (e) {
    console.warn('[insertEmailLog]', e?.message ?? e);
    return { ok: false, reason: e?.message ?? String(e) };
  }
}
